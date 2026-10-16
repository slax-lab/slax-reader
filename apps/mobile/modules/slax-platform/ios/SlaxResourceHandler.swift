import Foundation
import WebKit

final class SlaxResourceHandler: NSObject, WKURLSchemeHandler {
  var hasResourceOwnership: () -> Bool = { false }
  var cacheKey = ""
  var resourceOwner: String?
  var security: SlaxReaderSecurity?
  private var fixtureDirectory: URL?
  var isFixture: Bool { fixtureDirectory != nil }
  func setFixtureDirectory(_ directory: URL?) throws {
    fixtureDirectory = nil
    guard let directory else { return }
    #if DEBUG
    guard directory.isFileURL, let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { throw URLError(.noPermissionsToReadFile) }
    let resolved = directory.standardizedFileURL.resolvingSymlinksInPath()
    let allowed = root.appendingPathComponent("slax-ui-fixtures").standardizedFileURL.resolvingSymlinksInPath().path + "/"
    guard resolved.path.hasPrefix(allowed), let data = try? Data(contentsOf: resolved.appendingPathComponent("slax-fixture.json")), let marker = try? JSONSerialization.jsonObject(with: data) as? [String: Any], marker["controlledFixture"] as? Bool == true, marker["fixtureVersion"] as? Int == 1 else { throw URLError(.noPermissionsToReadFile) }
    fixtureDirectory = resolved
    #else
    throw URLError(.noPermissionsToReadFile)
    #endif
  }
  private var streams: [ObjectIdentifier: SlaxResourceTask] = [:]
  private var closed = false
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) { start(task) }
  func start(_ task: WKURLSchemeTask) {
    guard !closed, hasResourceOwnership() else { task.didFailWithError(URLError(.cancelled)); return }
    guard let security, let custom = task.request.url else { task.didFailWithError(URLError(.badURL)); return }
    let media = ["slaxmedia", "slaxmedias"].contains(custom.scheme ?? "")
    guard let original = media ? security.mediaOriginal(custom) : security.imageOriginal(custom),
      task.request.httpMethod == nil || task.request.httpMethod == "GET",
      task.request.value(forHTTPHeaderField: "Range").map({ !media || SlaxReaderSecurity.validRange($0) }) ?? true else { task.didFailWithError(URLError(.badURL)); return }
    let key = ObjectIdentifier(task as AnyObject), expectedKey = cacheKey, owner = resourceOwner
    let active = { [weak self] in self.map { !$0.closed && $0.cacheKey == expectedKey && $0.resourceOwner == owner && $0.security == security && $0.hasResourceOwnership() } ?? false }
    let done = { [weak self] in self?.streams.removeValue(forKey: key); return }
    if media {
      let stream = SlaxResourceStream(task: task, original: original, allowsNetwork: fixtureDirectory == nil, security: security, hasOwnership: active, done: done)
      streams[key] = stream; stream.start()
    } else {
      guard let root = fixtureDirectory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { task.didFailWithError(URLError(.fileDoesNotExist)); return }
      let stream = SlaxWebImageTask(task: task, original: original, root: root, key: expectedKey, owner: owner, policy: security, allowsNetwork: fixtureDirectory == nil, hasOwnership: active, done: done)
      streams[key] = stream; stream.start()
    }
  }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { streams.removeValue(forKey: ObjectIdentifier(task as AnyObject))?.cancel() }
  func cancelAll() { let previous = Array(streams.values); streams.removeAll(); previous.forEach { $0.cancel() } }
  func close() { closed = true; cancelAll() }
}

final class SlaxResourceStream: NSObject, URLSessionDataDelegate, SlaxResourceTask {
  static func configuration() -> URLSessionConfiguration {
    let configuration = URLSessionConfiguration.ephemeral; configuration.timeoutIntervalForRequest = 120
    configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false; configuration.urlCredentialStorage = nil; configuration.urlCache = nil
    return configuration
  }
  let task: WKURLSchemeTask; let original: URL; let allowsNetwork: Bool; let hasOwnership: () -> Bool; let done: () -> Void
  private var session: URLSession?; private var network: URLSessionDataTask?
  private var cancelled = false
  private let security: SlaxReaderSecurity
  private var redirects = 0
  private var receivedBytes = 0
  private let byteLimit = 128 * 1024 * 1024
  private var range: String? { task.request.value(forHTTPHeaderField: "Range") }
  private func permits(_ url: URL) -> Bool { security.allowsMediaHop(url) }
  init(task: WKURLSchemeTask, original: URL, allowsNetwork: Bool, security: SlaxReaderSecurity, hasOwnership: @escaping () -> Bool, done: @escaping () -> Void) {
    self.task = task; self.original = original; self.allowsNetwork = allowsNetwork; self.security = security; self.hasOwnership = hasOwnership; self.done = done
  }
  private func active() -> Bool { if cancelled { return false }; if !hasOwnership() { cancel(); done(); return false }; return true }
  func start() {
    guard active() else { return }
    guard allowsNetwork else { task.didFailWithError(URLError(.notConnectedToInternet)); done(); return }
    guard permits(original), range.map(SlaxReaderSecurity.validRange) ?? true else { task.didFailWithError(URLError(.noPermissionsToReadFile)); done(); return }
    session = URLSession(configuration: Self.configuration(), delegate: self, delegateQueue: .main)
    var request = URLRequest(url: original); request.httpMethod = "GET"; request.httpShouldHandleCookies = false
    request.setValue("identity", forHTTPHeaderField: "Accept-Encoding"); request.setValue(range, forHTTPHeaderField: "Range")
    network = session?.dataTask(with: request); network?.resume()
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    redirects += 1
    guard active() else { completionHandler(nil); return }
    guard redirects <= 10, let url = request.url, permits(url) else {
      completionHandler(nil); self.task.didFailWithError(URLError(.noPermissionsToReadFile)); cancel(); done(); return
    }
    var clean = URLRequest(url: url); clean.httpMethod = "GET"; clean.httpShouldHandleCookies = false
    clean.setValue("identity", forHTTPHeaderField: "Accept-Encoding"); clean.setValue(range, forHTTPHeaderField: "Range")
    completionHandler(clean)
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
  }
  func cancel() { cancelled = true; network?.cancel(); session?.invalidateAndCancel(); session = nil }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    guard active(), let url = response.url, permits(url) else { completionHandler(.cancel); cancel(); done(); return }
    if let http = response as? HTTPURLResponse, http.statusCode == 416,
      let contentRange = http.value(forHTTPHeaderField: "Content-Range"), contentRange.range(of: "^bytes \\*/[0-9]+$", options: .regularExpression) != nil,
      let rangeResponse = HTTPURLResponse(url: task.request.url!, statusCode: 416, httpVersion: "HTTP/1.1", headerFields: ["Content-Range": contentRange]) {
      task.didReceive(rangeResponse); task.didFinish(); completionHandler(.cancel); cancel(); done(); return
    }
    let mime = response.mimeType?.lowercased() ?? ""
    guard ["video/mp4", "video/webm", "video/ogg"].contains(mime), response.expectedContentLength <= byteLimit else { task.didFailWithError(URLError(.cannotDecodeContentData)); cancel(); done(); completionHandler(.cancel); return }
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { task.didFailWithError(URLError(.badServerResponse)); completionHandler(.cancel); cancel(); done(); return }
    if http.statusCode == 206 && http.value(forHTTPHeaderField: "Content-Range")?.range(of: "^bytes [0-9]+-[0-9]+/[0-9]+$", options: .regularExpression) == nil { task.didFailWithError(URLError(.badServerResponse)); completionHandler(.cancel); cancel(); done(); return }
    var headers = ["Content-Type": mime, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'"]
    for name in ["Content-Length", "Content-Range", "Accept-Ranges"] { headers[name] = http.value(forHTTPHeaderField: name) }
    task.didReceive(HTTPURLResponse(url: task.request.url!, statusCode: http.statusCode, httpVersion: "HTTP/1.1", headerFields: headers)!)
    completionHandler(.allow)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard active() else { return }
    receivedBytes += data.count
    guard receivedBytes <= byteLimit else { task.didFailWithError(URLError(.dataLengthExceedsMaximum)); cancel(); done(); return }
    task.didReceive(data)
  }
  func urlSession(_ session: URLSession, task networkTask: URLSessionTask, didCompleteWithError error: Error?) {
    guard active() else { return }
    if let error { task.didFailWithError(error) } else { task.didFinish() }
    session.finishTasksAndInvalidate(); self.session = nil; done()
  }
}
