import Foundation

struct SlaxPdfTransferError: Error { let code: String }

enum SlaxPdfTransfers {
  static let chunkBytes = 64 * 1024
  static let maxBytes = 50 * 1024 * 1024
  private static let lock = NSLock()
  private static var active: [String: SlaxPdfTransfer] = [:]
  private static let workers: OperationQueue = {
    let queue = OperationQueue(); queue.name = "SlaxPdfTransfer"; queue.qualityOfService = .utility; queue.maxConcurrentOperationCount = 6; return queue
  }()
  /// Background acquisition never takes the slots reserved for an open Reader's foreground ranges.
  static let backgroundSlots = 6, foregroundSlots = 4
  static func begin(owner: String, origin: String, allowHTTP: Bool, foreground: Bool = false) throws -> String {
    lock.lock(); defer { lock.unlock() }
    let running = active.values.filter { $0.foreground == foreground }.count
    guard running < (foreground ? foregroundSlots : backgroundSlots) else { throw SlaxPdfTransferError(code: "busy") }
    let id = UUID().uuidString
    let transfer = try SlaxPdfTransfer(owner: owner, origin: origin, allowHTTP: allowHTTP, foreground: foreground, lease: SlaxStorageOwner.capture(owner)) {
      lock.lock(); active.removeValue(forKey: id); lock.unlock()
    }
    active[id] = transfer
    let expiry = DispatchWorkItem { end(owner: owner, id: id) }; transfer.expiry = expiry
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 120, execute: expiry)
    return id
  }
  static func get(owner: String, id: String) throws -> SlaxPdfTransfer {
    lock.lock(); defer { lock.unlock() }
    guard let transfer = active[id], transfer.owner == owner else { throw SlaxPdfTransferError(code: "cancelled") }
    return transfer
  }
  static func end(owner: String, id: String) { try? get(owner: owner, id: id).cancel() }
  static func revokeAll() {
    lock.lock(); let transfers = Array(active.values); lock.unlock()
    transfers.forEach { $0.cancel() }
  }
  static func execute(_ work: @escaping () -> Void) { workers.addOperation(work) }
  static func count() -> Int { lock.lock(); defer { lock.unlock() }; return active.count }
}

final class SlaxPdfTransfer: NSObject, URLSessionDataDelegate, URLSessionDownloadDelegate {
  let owner: String
  let foreground: Bool
  var expiry: DispatchWorkItem?
  private let origin: URLComponents
  private let lease: SlaxStorageLease
  private let released: () -> Void
  private let condition = NSCondition()
  private var session: URLSession?
  private var task: URLSessionTask?
  private var response: [String: Any]?
  private var input: FileHandle?
  private var received = 0
  private var advertised: Int?
  private var completed = false
  private var opening = false
  private var reading = false
  private var ended = false
  private var submitted = false
  func reserve() -> Bool { condition.lock(); defer { condition.unlock() }; if submitted { return false }; submitted = true; return true }
  func completeOperation() { condition.lock(); submitted = false; condition.unlock() }
  private var error: SlaxPdfTransferError?

  init(owner: String, origin: String, allowHTTP: Bool, foreground: Bool = false, lease: SlaxStorageLease, released: @escaping () -> Void) throws {
    guard let base = URLComponents(string: origin), let host = base.host, !host.isEmpty,
      base.user == nil, base.password == nil, base.query == nil, base.fragment == nil, ["", "/"].contains(base.path),
      base.scheme == "https" || allowHTTP && base.scheme == "http" && ["127.0.0.1", "localhost", "[::1]", "::1"].contains(host) else { throw SlaxPdfTransferError(code: "protocol") }
    self.owner = owner; self.foreground = foreground; self.origin = base; self.lease = lease; self.released = released
  }
  private func check() throws {
    if let error { throw error }
    do { try lease.check() } catch { throw SlaxPdfTransferError(code: "cancelled") }
  }
  private func request(_ raw: String, headers: [String: String]) throws -> URLRequest {
    guard let url = URLComponents(string: raw), url.scheme == origin.scheme, url.host == origin.host, url.port == origin.port,
      url.user == nil, url.password == nil, url.fragment == nil, url.percentEncodedPath == "/v1/bookmark/pdf",
      url.percentEncodedQuery?.range(of: "^bookmark_uid=[A-Za-z0-9_%.-]+$", options: .regularExpression) != nil, let target = url.url else { throw SlaxPdfTransferError(code: "protocol") }
    let allowed = Set(["authorization", "accept", "range", "x-client-type", "x-client-version"])
    var normalized: [String: String] = [:]
    for (key, value) in headers {
      let name = key.lowercased()
      guard allowed.contains(name), normalized[name] == nil, value.utf8.count <= 16384, !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else { throw SlaxPdfTransferError(code: "protocol") }
      normalized[name] = value
    }
    guard let bearer = normalized["authorization"], bearer.hasPrefix("Bearer "), bearer.count > 7,
      normalized["accept"] == "application/pdf", normalized["range"]?.range(of: "^bytes=[0-9]+-[0-9]+$", options: .regularExpression) != nil else { throw SlaxPdfTransferError(code: "protocol") }
    var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 120)
    request.httpMethod = "GET"; request.httpShouldHandleCookies = false
    normalized.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
    request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
    return request
  }
  func open(_ raw: String, headers: [String: String]) throws -> [String: Any] {
    let request = try request(raw, headers: headers)
    condition.lock()
    do {
      try check(); guard !opening else { throw SlaxPdfTransferError(code: "protocol") }; opening = true
      let configuration = URLSessionConfiguration.ephemeral
      configuration.httpShouldSetCookies = false; configuration.httpCookieStorage = nil; configuration.urlCache = nil
      configuration.urlCredentialStorage = nil; configuration.timeoutIntervalForRequest = 120; configuration.timeoutIntervalForResource = 120
      let delegate = OperationQueue(); delegate.name = "SlaxPdfDelegate"; delegate.qualityOfService = foreground ? .userInitiated : .utility; delegate.maxConcurrentOperationCount = 1
      let session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegate)
      self.session = session; let task = session.dataTask(with: request); self.task = task; task.resume()
      while response == nil && error == nil { condition.wait() }
      try check(); guard let response else { throw SlaxPdfTransferError(code: "protocol") }
      condition.unlock(); return response
    } catch { condition.unlock(); cancel(); throw error }
  }
  private let fileLock = NSLock()
  func read() throws -> Data? {
    condition.lock()
    if reading { condition.unlock(); throw SlaxPdfTransferError(code: "protocol") }
    reading = true
    do {
      try check(); guard opening else { throw SlaxPdfTransferError(code: "protocol") }
      while !completed && error == nil { condition.wait() }
      try check(); guard let input else { throw SlaxPdfTransferError(code: "protocol") }
      condition.unlock()
      let result: Data
      do {
        fileLock.lock(); defer { fileLock.unlock() }
        result = try input.read(upToCount: SlaxPdfTransfers.chunkBytes) ?? Data()
      } catch { condition.lock(); throw error }
      condition.lock(); try check(); reading = false; condition.unlock()
      if result.isEmpty { finish(); return nil }
      return result
    } catch { reading = false; condition.broadcast(); condition.unlock(); cancel(); throw error }
  }
  func cancel() {
    condition.lock(); if error == nil { error = SlaxPdfTransferError(code: "cancelled") }; condition.broadcast(); condition.unlock()
    lease.cancel(); finish()
  }
  private func finish() {
    condition.lock()
    if ended { condition.unlock(); return }; ended = true
    let session = self.session; self.session = nil; let task = self.task; self.task = nil
    let input = self.input; self.input = nil
    condition.unlock(); expiry?.cancel(); task?.cancel()
    DispatchQueue.global(qos: .utility).async {
      self.fileLock.lock(); try? input?.close(); self.fileLock.unlock()
      if let session { session.invalidateAndCancel() } else { self.released() }
    }
  }
  func urlSession(_ session: URLSession, didBecomeInvalidWithError error: Error?) { released() }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
  func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    condition.lock()
    do {
      try check(); guard let response = response as? HTTPURLResponse else { throw SlaxPdfTransferError(code: "protocol") }
      var headers: [String: String] = [:]
      for name in ["Content-Type", "Content-Length", "Content-Range", "ETag", "Retry-After", "Content-Encoding"] {
        if let value = response.value(forHTTPHeaderField: name) { guard value.utf8.count <= 8192 else { throw SlaxPdfTransferError(code: "protocol") }; headers[name] = value }
      }
      if [200, 206].contains(response.statusCode) {
        if let length = headers["Content-Length"] { guard let size = Int(length), (1...SlaxPdfTransfers.maxBytes).contains(size) else { throw SlaxPdfTransferError(code: "limit") }; advertised = size }
        guard headers["Content-Encoding"] == nil || headers["Content-Encoding"] == "identity" else { throw SlaxPdfTransferError(code: "protocol") }
      }
      self.response = ["status": response.statusCode, "headers": headers]; condition.broadcast(); condition.unlock()
      completionHandler([200, 206].contains(response.statusCode) ? .becomeDownload : .cancel)
    } catch {
      self.error = error as? SlaxPdfTransferError ?? SlaxPdfTransferError(code: "network"); condition.broadcast(); condition.unlock(); completionHandler(.cancel)
    }
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didBecome downloadTask: URLSessionDownloadTask) {
    condition.lock(); task = downloadTask; let cancelled = ended || error != nil; condition.unlock()
    if cancelled { downloadTask.cancel() }
  }
  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
    condition.lock()
    do {
      try check()
      guard totalBytesWritten <= SlaxPdfTransfers.maxBytes, totalBytesExpectedToWrite <= SlaxPdfTransfers.maxBytes,
        advertised.map({ totalBytesWritten <= $0 }) ?? true else { throw SlaxPdfTransferError(code: "limit") }
      condition.unlock()
    } catch { self.error = error as? SlaxPdfTransferError ?? SlaxPdfTransferError(code: "network"); condition.broadcast(); condition.unlock(); downloadTask.cancel() }
  }
  func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    do {
      let attributes = try FileManager.default.attributesOfItem(atPath: location.path)
      guard attributes[.type] as? FileAttributeType == .typeRegular, let size = attributes[.size] as? NSNumber,
        size.int64Value <= SlaxPdfTransfers.maxBytes else { throw SlaxPdfTransferError(code: "limit") }
      let file = try FileHandle(forReadingFrom: location)
      do { try FileManager.default.removeItem(at: location) } catch { try? file.close(); throw error }
      condition.lock()
      do {
        try check(); guard advertised.map({ size.intValue == $0 }) ?? true else { throw SlaxPdfTransferError(code: "protocol") }
        input = file; received = size.intValue; condition.unlock()
      } catch { condition.unlock(); try? file.close(); throw error }
    } catch { condition.lock(); self.error = error as? SlaxPdfTransferError ?? SlaxPdfTransferError(code: "network"); condition.broadcast(); condition.unlock() }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    condition.lock(); completed = true
    if self.error == nil && (response == nil || [200, 206].contains(response?["status"] as? Int ?? 0)) {
      if error != nil { self.error = SlaxPdfTransferError(code: "network") }
      else if advertised.map({ received != $0 }) == true { self.error = SlaxPdfTransferError(code: "protocol") }
    }
    condition.broadcast(); condition.unlock()
  }
}
