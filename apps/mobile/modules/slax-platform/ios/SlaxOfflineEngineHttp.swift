import Foundation

/// Cancellation scope of one engine operation; its lease gates every file commit made for it.
final class SlaxOfflineWork {
  let lease: SlaxStorageLease
  private let lock = NSLock()
  private var cancelled = false
  private var hooks: [UUID: () -> Void] = [:]
  init(lease: SlaxStorageLease) { self.lease = lease }
  var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
  @discardableResult func attach(_ hook: @escaping () -> Void) -> UUID? {
    lock.lock()
    if cancelled { lock.unlock(); hook(); return nil }
    let id = UUID(); hooks[id] = hook; lock.unlock(); return id
  }
  func detach(_ id: UUID?) { guard let id else { return }; lock.lock(); hooks.removeValue(forKey: id); lock.unlock() }
  func cancel() {
    lock.lock()
    if cancelled { lock.unlock(); return }
    cancelled = true; let pending = Array(hooks.values); hooks.removeAll(); lock.unlock()
    lease.cancel(); pending.forEach { $0() }
  }
  func check() throws {
    if isCancelled { throw SlaxOfflineError.cancelled }
    do { try lease.check() } catch { throw SlaxOfflineError.revoked }
  }
}

struct SlaxOfflineResponse {
  let status: Int
  let headers: [String: String]
  let body: Data
}

/// Ephemeral, cookie-less transport for article bodies and PDF metadata; redirects are surfaced, not followed.
final class SlaxOfflineHttp: NSObject, URLSessionDataDelegate {
  private final class Exchange {
    let limit: Int
    let oversized: SlaxOfflineError
    let work: SlaxOfflineWork
    let completion: (Result<SlaxOfflineResponse, SlaxOfflineError>) -> Void
    var status = 0
    var headers: [String: String] = [:]
    var body = Data()
    var failure: SlaxOfflineError?
    var headOnly = false
    var hook: UUID?
    var deadline: DispatchWorkItem?
    init(limit: Int, oversized: SlaxOfflineError, work: SlaxOfflineWork, completion: @escaping (Result<SlaxOfflineResponse, SlaxOfflineError>) -> Void) {
      self.limit = limit; self.oversized = oversized; self.work = work; self.completion = completion
    }
  }
  private let lock = NSLock()
  private var exchanges: [Int: Exchange] = [:]
  private var session: URLSession!

  override init() {
    super.init()
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = false; configuration.httpCookieStorage = nil; configuration.urlCache = nil; configuration.urlCredentialStorage = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData; configuration.timeoutIntervalForRequest = 60; configuration.timeoutIntervalForResource = 300
    configuration.httpMaximumConnectionsPerHost = 4; configuration.waitsForConnectivity = false
    let delegate = OperationQueue(); delegate.name = "SlaxOfflineHttp"; delegate.qualityOfService = .utility; delegate.maxConcurrentOperationCount = 1
    session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegate)
  }

  static func content(_ scope: SlaxOfflineScope, id: String, token: String) -> URLRequest? {
    guard let url = URL(string: scope.origin + "/v1/bookmark/content"), let body = try? JSONSerialization.data(withJSONObject: ["bookmark_uid": id]) else { return nil }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    request.httpMethod = "POST"; request.httpShouldHandleCookies = false; request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.setValue("*/*", forHTTPHeaderField: "Accept")
    request.setValue(scope.userAgent, forHTTPHeaderField: "User-Agent"); request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    return request
  }
  static func metadata(_ scope: SlaxOfflineScope, id: String, token: String) -> URLRequest? {
    guard let url = URL(string: scope.origin + "/v1/bookmark/metadata?bookmark_uid=" + id) else { return nil }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 120)
    request.httpMethod = "GET"; request.httpShouldHandleCookies = false
    request.setValue("application/json", forHTTPHeaderField: "Accept"); request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    request.setValue(scope.clientType, forHTTPHeaderField: "X-CLIENT-TYPE"); request.setValue(scope.clientVersion, forHTTPHeaderField: "X-CLIENT-VERSION")
    return request
  }

  func send(_ request: URLRequest, limit: Int, oversized: SlaxOfflineError, timeout: TimeInterval, work: SlaxOfflineWork, completion: @escaping (Result<SlaxOfflineResponse, SlaxOfflineError>) -> Void) {
    let task = session.dataTask(with: request), exchange = Exchange(limit: limit, oversized: oversized, work: work, completion: completion)
    lock.lock(); exchanges[task.taskIdentifier] = exchange; lock.unlock()
    let deadline = DispatchWorkItem { [weak self, weak task] in
      guard let self, let task else { return }
      self.lock.lock(); if let exchange = self.exchanges[task.taskIdentifier], exchange.failure == nil { exchange.failure = .timeout }; self.lock.unlock()
      task.cancel()
    }
    exchange.deadline = deadline
    exchange.hook = work.attach { [weak task] in task?.cancel() }
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + max(1, timeout), execute: deadline)
    task.resume()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
  func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    lock.lock()
    guard let exchange = exchanges[dataTask.taskIdentifier], let http = response as? HTTPURLResponse else { lock.unlock(); completionHandler(.cancel); return }
    exchange.status = http.statusCode
    for name in ["Content-Type", "Content-Length", "Retry-After"] { if let value = http.value(forHTTPHeaderField: name), value.utf8.count <= 8192 { exchange.headers[name] = value } }
    if !(200..<300).contains(http.statusCode) { exchange.headOnly = true; lock.unlock(); completionHandler(.cancel); return }
    if response.expectedContentLength > Int64(exchange.limit) { exchange.failure = exchange.oversized; lock.unlock(); completionHandler(.cancel); return }
    lock.unlock(); completionHandler(.allow)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    lock.lock()
    guard let exchange = exchanges[dataTask.taskIdentifier] else { lock.unlock(); return }
    if exchange.body.count + data.count > exchange.limit { if exchange.failure == nil { exchange.failure = exchange.oversized }; lock.unlock(); dataTask.cancel(); return }
    exchange.body.append(data); lock.unlock()
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    lock.lock(); let exchange = exchanges.removeValue(forKey: task.taskIdentifier); lock.unlock()
    guard let exchange else { return }
    exchange.deadline?.cancel(); exchange.work.detach(exchange.hook)
    if exchange.work.isCancelled { exchange.completion(.failure(.cancelled)); return }
    if let failure = exchange.failure { exchange.completion(.failure(failure)); return }
    if error != nil && !exchange.headOnly { exchange.completion(.failure(.network)); return }
    exchange.completion(.success(SlaxOfflineResponse(status: exchange.status, headers: exchange.headers, body: exchange.headOnly ? Data() : exchange.body)))
  }
}
