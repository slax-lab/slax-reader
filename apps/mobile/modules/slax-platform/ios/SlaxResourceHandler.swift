import Foundation
import WebKit
import CryptoKit

enum SlaxCachePaths {
  static func file(root: URL, key: String, name: String) -> URL? {
    guard !key.isEmpty, key.unicodeScalars.allSatisfy({ CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-").contains($0) }),
          name.range(of: "^[a-f0-9]{32}\\..+$", options: .regularExpression) != nil,
          name.utf16.count <= 64, !name.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 || $0.value == 92 }) else { return nil }
    let parts = name.components(separatedBy: "/")
    guard parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return nil }
    var current = root.standardizedFileURL.resolvingSymlinksInPath()
    for part in ["bookmark", key, "images"] + parts {
      current.appendPathComponent(part)
      guard current.resolvingSymlinksInPath().path == current.path,
            (try? FileManager.default.attributesOfItem(atPath: current.path)[.type] as? FileAttributeType) != .typeSymbolicLink else { return nil }
    }
    return current
  }
}

/** Each page owns cancellable streams; a cancelled WK task never receives another callback. */
final class SlaxResourceHandler: NSObject, WKURLSchemeHandler {
  var hasResourceOwnership: () -> Bool = { false }
  var cacheKey = ""
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
  private var streams: [ObjectIdentifier: SlaxResourceStream] = [:]
  private var closed = false
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) { start(task) }
  func start(_ task: WKURLSchemeTask) {
    guard !closed, hasResourceOwnership() else { task.didFailWithError(URLError(.cancelled)); return }
    guard let security, let custom = task.request.url else { task.didFailWithError(URLError(.badURL)); return }
    let media = ["slaxmedia", "slaxmedias"].contains(custom.scheme ?? "")
    guard let original = media ? security.mediaOriginal(custom) : security.imageOriginal(custom),
      task.request.httpMethod == nil || task.request.httpMethod == "GET",
      task.request.value(forHTTPHeaderField: "Range").map({ !media || SlaxReaderSecurity.validRange($0) }) ?? true else { task.didFailWithError(URLError(.badURL)); return }
    let key = ObjectIdentifier(task as AnyObject)
    let expectedKey = cacheKey
    let active = { [weak self] in self.map { !$0.closed && $0.cacheKey == expectedKey && $0.hasResourceOwnership() } ?? false }
    let stream = SlaxResourceStream(task: task, original: original, cache: { [weak self] in self?.cacheFile(original: original) }, cached: { [weak self] in
      guard let self else { return nil }
      return [self.cacheFile(original: original), self.cacheFile(original: original, legacy: true)].compactMap { $0 }.first {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: $0.path) else { return false }
        return attributes[.type] as? FileAttributeType == .typeRegular && (attributes[.size] as? NSNumber)?.int64Value ?? 0 > 0
      }
    }, allowsNetwork: fixtureDirectory == nil, security: security, media: media, hasOwnership: active) { [weak self] in self?.streams.removeValue(forKey: key) }
    streams[key] = stream; stream.start()
  }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { streams.removeValue(forKey: ObjectIdentifier(task as AnyObject))?.cancel() }
  func cancelAll() { let previous = Array(streams.values); streams.removeAll(); previous.forEach { $0.cancel() } }
  func close() { closed = true; cancelAll() }
  private func cacheFile(original: URL, legacy: Bool = false) -> URL? {
    guard let root = fixtureDirectory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
    let string = original.absoluteString
    let hash = Insecure.MD5.hash(data: Data(string.utf8)).map { String(format: "%02x", $0) }.joined()
    let tail = string.contains(".") ? String(string.split(separator: ".", omittingEmptySubsequences: false).last ?? "") : ""
    let candidate = String(decoding: tail.components(separatedBy: "?")[0].components(separatedBy: "&")[0].utf16.prefix(10), as: UTF16.self).lowercased()
    let safeExtension = !candidate.isEmpty && !candidate.contains("..") && !candidate.unicodeScalars.contains { $0.value < 32 || $0.value == 127 || $0.value == 47 || $0.value == 92 }
    let ext = (legacy && !candidate.isEmpty) || safeExtension ? candidate : "jpg"
    return SlaxCachePaths.file(root: root, key: cacheKey, name: "\(hash).\(ext)")
  }
}

final class SlaxResourceStream: NSObject, URLSessionDataDelegate {
  static func configuration() -> URLSessionConfiguration {
    let configuration = URLSessionConfiguration.ephemeral; configuration.timeoutIntervalForRequest = 30
    configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false; configuration.urlCredentialStorage = nil; configuration.urlCache = nil
    return configuration
  }
  let task: WKURLSchemeTask; let original: URL; let cache: () -> URL?; let cached: () -> URL?; let allowsNetwork: Bool; let hasOwnership: () -> Bool; let done: () -> Void
  private var session: URLSession?; private var network: URLSessionDataTask?
  private let stateLock = NSLock(); private var cancellation = false
  private var cancelled: Bool { stateLock.lock(); defer { stateLock.unlock() }; return cancellation }
  private var output: FileHandle?; private var temporary: URL?; private var response: URLResponse?
  private let security: SlaxReaderSecurity
  private var redirects = 0
  private var receivedBytes = 0
  private let maxImageBytes = 20 * 1024 * 1024
  private let media: Bool
  private let privateImage: Bool
  private var strictImage: Bool { privateImage || security.signedImageProxy(original) || response?.url.map(security.signedImageProxy) == true }
  private var byteLimit: Int { media ? 128 * 1024 * 1024 : strictImage ? maxImageBytes : Int.max }
  private var range: String? { media ? task.request.value(forHTTPHeaderField: "Range") : nil }
  private func permits(_ url: URL) -> Bool { media ? security.allowsMediaHop(url) : security.imageOriginal(url) != nil }
  init(task: WKURLSchemeTask, original: URL, cache: @escaping () -> URL?, cached: @escaping () -> URL?, allowsNetwork: Bool, security: SlaxReaderSecurity, media: Bool = false, privateImage: Bool = false, hasOwnership: @escaping () -> Bool, done: @escaping () -> Void) { self.task = task; self.original = original; self.cache = cache; self.cached = cached; self.allowsNetwork = allowsNetwork; self.security = security; self.media = media; self.privateImage = privateImage; self.hasOwnership = hasOwnership; self.done = done }
  private func active() -> Bool { if cancelled { return false }; if !hasOwnership() { cancel(); done(); return false }; return true }
  func start() {
    guard active() else { return }
    if !media, let cache = cached() {
      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        guard let self else { return }
        var responseStarted = false
        do {
          let input = try FileHandle(forReadingFrom: cache); defer { try? input.close() }
          let size = (try? FileManager.default.attributesOfItem(atPath: cache.path)[.size] as? NSNumber)?.int64Value ?? 0
          let mime = Self.mime(extension: cache.pathExtension)
          guard self.deliverChunk({ self.task.didReceive(URLResponse(url: self.task.request.url!, mimeType: mime, expectedContentLength: Int(size), textEncodingName: nil)) }) else { return }
          responseStarted = true
          while !self.cancelled, let data = try input.read(upToCount: 65536), !data.isEmpty { if !self.deliverChunk({ self.task.didReceive(data) }) { return } }
          self.deliver { self.task.didFinish(); self.done() }
        } catch { self.deliver { if responseStarted { self.task.didFailWithError(error); self.done() } else { self.startNetwork() } } }
      }
    } else { startNetwork() }
  }
  private func deliver(_ work: @escaping () -> Void) { DispatchQueue.main.async { [weak self] in guard let self, self.active() else { return }; work() } }
  /** The file worker keeps at most one 64 KiB chunk queued for WebKit. */
  private func deliverChunk(_ work: @escaping () -> Void) -> Bool {
    let completion = DispatchSemaphore(value: 0)
    DispatchQueue.main.async { [weak self] in defer { completion.signal() }; guard let self, self.active() else { return }; work() }
    completion.wait()
    return !cancelled
  }
  private func startNetwork() {
    guard active() else { return }
    guard allowsNetwork else { task.didFailWithError(URLError(.notConnectedToInternet)); done(); return }
    guard permits(original), range.map(SlaxReaderSecurity.validRange) ?? true else { task.didFailWithError(URLError(.noPermissionsToReadFile)); done(); return }
    let configuration = Self.configuration(); if media { configuration.timeoutIntervalForRequest = 120 }
    session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    var request = URLRequest(url: original); request.httpMethod = "GET"; request.httpShouldHandleCookies = false
    if media { request.setValue("identity", forHTTPHeaderField: "Accept-Encoding"); request.setValue(range, forHTTPHeaderField: "Range") }
    network = session?.dataTask(with: request); network?.resume()
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    redirects += 1
    guard active() else { completionHandler(nil); return }
    guard redirects <= 10, let url = request.url, permits(url) else {
      completionHandler(nil); self.task.didFailWithError(URLError(.noPermissionsToReadFile)); cancel(); done(); return
    }
    var clean = URLRequest(url: url); clean.httpMethod = "GET"; clean.httpShouldHandleCookies = false
    if media { clean.setValue("identity", forHTTPHeaderField: "Accept-Encoding"); clean.setValue(range, forHTTPHeaderField: "Range") }
    completionHandler(clean)
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
  }
  func cancel() {
    stateLock.lock(); if cancellation { stateLock.unlock(); return }; cancellation = true; stateLock.unlock()
    network?.cancel(); session?.invalidateAndCancel(); session = nil
    try? output?.close(); output = nil
    if let temporary { try? FileManager.default.removeItem(at: temporary) }; temporary = nil
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    guard active(), let url = response.url, permits(url) else { completionHandler(.cancel); cancel(); done(); return }
    self.response = response
    if media, let http = response as? HTTPURLResponse, http.statusCode == 416,
      let contentRange = http.value(forHTTPHeaderField: "Content-Range"), contentRange.range(of: "^bytes \\*/[0-9]+$", options: .regularExpression) != nil,
      let rangeResponse = HTTPURLResponse(url: task.request.url!, statusCode: 416, httpVersion: "HTTP/1.1", headerFields: ["Content-Range": contentRange]) {
      task.didReceive(rangeResponse); task.didFinish(); completionHandler(.cancel); cancel(); done(); return
    }
    let mime = response.mimeType?.lowercased() ?? ""
    let validMime = media ? ["video/mp4", "video/webm", "video/ogg"].contains(mime) : mime.hasPrefix("image/") || !strictImage && mime.isEmpty
    guard validMime, response.expectedContentLength <= byteLimit else { task.didFailWithError(URLError(.cannotDecodeContentData)); cancel(); done(); completionHandler(.cancel); return }
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { task.didFailWithError(URLError(.badServerResponse)); cancel(); done(); completionHandler(.cancel); return }
    if media {
      guard let http = response as? HTTPURLResponse else { task.didFailWithError(URLError(.badServerResponse)); completionHandler(.cancel); cancel(); done(); return }
      if http.statusCode == 206 && http.value(forHTTPHeaderField: "Content-Range")?.range(of: "^bytes [0-9]+-[0-9]+/[0-9]+$", options: .regularExpression) == nil { task.didFailWithError(URLError(.badServerResponse)); completionHandler(.cancel); cancel(); done(); return }
      var headers = ["Content-Type": mime, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'"]
      for name in ["Content-Length", "Content-Range", "Accept-Ranges"] { headers[name] = http.value(forHTTPHeaderField: name) }
      task.didReceive(HTTPURLResponse(url: task.request.url!, statusCode: http.statusCode, httpVersion: "HTTP/1.1", headerFields: headers)!)
    } else {
      task.didReceive(URLResponse(url: task.request.url!, mimeType: response.mimeType, expectedContentLength: Int(response.expectedContentLength), textEncodingName: response.textEncodingName))
    }
    if !media, let cache = cache(), Self.downloadImagesEnabled() {
      do {
        try FileManager.default.createDirectory(at: cache.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard self.cache() == cache else { completionHandler(.allow); return }
        let temporary = cache.deletingLastPathComponent().appendingPathComponent(".\(UUID().uuidString).download")
        if FileManager.default.createFile(atPath: temporary.path, contents: nil) { self.temporary = temporary; output = try FileHandle(forWritingTo: temporary) }
      } catch { output = nil }
    }
    completionHandler(.allow)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard active() else { return }
    receivedBytes += data.count
    guard receivedBytes <= byteLimit else { task.didFailWithError(URLError(.dataLengthExceedsMaximum)); cancel(); done(); return }
    task.didReceive(data)
    do { try output?.write(contentsOf: data) } catch { try? output?.close(); output = nil; if let temporary { try? FileManager.default.removeItem(at: temporary) }; temporary = nil }
  }
  func urlSession(_ session: URLSession, task networkTask: URLSessionTask, didCompleteWithError error: Error?) {
    guard active() else { return }
    try? output?.synchronize(); try? output?.close(); output = nil
    if let error { task.didFailWithError(error) }
    else {
      if let temporary, let cache = cache() { do { if FileManager.default.fileExists(atPath: cache.path) { try FileManager.default.removeItem(at: cache) }; try FileManager.default.moveItem(at: temporary, to: cache) } catch { } }
      task.didFinish()
    }
    if let temporary { try? FileManager.default.removeItem(at: temporary) }
    temporary = nil; session.finishTasksAndInvalidate(); self.session = nil; done()
  }
  private static func downloadImagesEnabled() -> Bool {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.slax.reader"), let data = try? Data(contentsOf: root.appendingPathComponent("slax.preferences.v1.json")), let snapshot = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let values = snapshot["values"] as? [String: Any] else { return true }
    return (values["download_images"] as? NSNumber)?.intValue != 0
  }
  private static func mime(extension ext: String) -> String {
    switch ext { case "png": "image/png"; case "gif": "image/gif"; case "webp": "image/webp"; case "svg": "image/svg+xml"; case "avif": "image/avif"; default: "image/jpeg" }
  }
}
