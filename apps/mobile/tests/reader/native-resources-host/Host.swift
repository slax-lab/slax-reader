import Foundation
import WebKit
import CryptoKit
import ExpoModulesCore

private final class Task: NSObject, WKURLSchemeTask {
  let request: URLRequest
  var bytes = Data()
  var finished = false
  var failed = false
  var responses = 0
  var chunks: [Int] = []
  var response: URLResponse?
  var onChunk: (() -> Void)?
  init(_ url: String, range: String? = nil) { var request = URLRequest(url: URL(string: url)!); request.setValue(range, forHTTPHeaderField: "Range"); self.request = request }
  func didReceive(_ response: URLResponse) { precondition(Thread.isMainThread); responses += 1; self.response = response }
  func didReceive(_ data: Data) { precondition(Thread.isMainThread); chunks.append(data.count); bytes.append(data); onChunk?() }
  func didFinish() { precondition(Thread.isMainThread); finished = true }
  func didFailWithError(_ error: Error) { precondition(Thread.isMainThread); failed = true }
}

@main struct Host {
  static func spin(_ until: () -> Bool) {
    let deadline = Date().addingTimeInterval(5)
    while !until() && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.005)) }
    precondition(until(), "Resource stream timed out")
  }
  static func main() throws {
    let manager = FileManager.default
    let caches = manager.urls(for: .cachesDirectory, in: .userDomainMask).first!
    let testHome = URL(fileURLWithPath: ProcessInfo.processInfo.environment["SLAX_RESOURCE_TEST_HOME"]!).resolvingSymlinksInPath().path
    precondition(caches.resolvingSymlinksInPath().path.hasPrefix(testHome + "/"))
    try SlaxStorageOwner.activate("synthetic-owner")
    let root = caches.appendingPathComponent("slax-ui-fixtures/cache-host-\(UUID().uuidString)")
    try manager.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? manager.removeItem(at: root) }
    try Data("{\"controlledFixture\":true,\"fixtureVersion\":1}".utf8).write(to: root.appendingPathComponent("slax-fixture.json"))
    let mediaHost = ProcessInfo.processInfo.environment["SLAX_MEDIA_HOST"]!
    let mediaPolicy = try SlaxReaderSecurity(["127.0.0.1", "localhost"], imageProxyOrigins: [mediaHost])
    func mediaURL(_ mode: String) -> URL {
      URL(string: mediaHost.replacingOccurrences(of: "http:", with: "slaxmedia:") + "/static/image?d=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&u=https%253A%252F%252Fpublic.test%252Fa.mp4&r=https%3A%2F%2Ffeed.test%2F" + mode)!
    }
    let mediaHandler = SlaxResourceHandler(); mediaHandler.security = mediaPolicy; mediaHandler.hasResourceOwnership = { true }
    for mode in ["range", "safe", "webm", "ogg"] {
      let task = Task(mediaURL(mode).absoluteString, range: "bytes=2-5")
      mediaHandler.start(task); spin { task.finished || task.failed }
      precondition(task.finished && task.bytes == Data("2345".utf8))
      let response = task.response as! HTTPURLResponse
      precondition(response.statusCode == 206 && response.value(forHTTPHeaderField: "Content-Range") == "bytes 2-5/10")
      precondition(response.value(forHTTPHeaderField: "Accept-Ranges") == "bytes" && response.value(forHTTPHeaderField: "Content-Length") == "4" && response.value(forHTTPHeaderField: "Set-Cookie") == nil)
    }
    for mode in ["redirect", "html"] {
      let task = Task(mediaURL(mode).absoluteString, range: "bytes=2-5")
      mediaHandler.start(task); spin { task.finished || task.failed }; precondition(task.failed && task.bytes.isEmpty)
    }
    let unsatisfied = Task(mediaURL("unsatisfied").absoluteString, range: "bytes=2-5")
    mediaHandler.start(unsatisfied); spin { unsatisfied.finished || unsatisfied.failed }
    precondition(unsatisfied.finished && (unsatisfied.response as? HTTPURLResponse)?.statusCode == 416 && unsatisfied.bytes.isEmpty)
    let slow = Task(mediaURL("slow").absoluteString, range: "bytes=2-5")
    mediaHandler.start(slow); spin { !slow.bytes.isEmpty || slow.failed }; precondition(!slow.failed)
    mediaHandler.cancelAll(); let before = slow.bytes
    RunLoop.main.run(until: Date().addingTimeInterval(0.6)); precondition(slow.bytes == before && !slow.finished)
    mediaHandler.close()
    let handler = SlaxResourceHandler()
    var owns = true
    handler.hasResourceOwnership = { owns }
    handler.cacheKey = "collection-owner-article"
    handler.security = try SlaxReaderSecurity(["auth.example", "api.example"])
    try handler.setFixtureDirectory(root)
    let policy = handler.security!
    let signedPolicy = try SlaxReaderSecurity(["api.example"], imageProxyOrigins: ["https://api.example"])
    let signed = URL(string: "https://api.example/static/image?m=rss&d=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&u=https%253A%252F%252Fpublic.test%252Fa.png&r=https%3A%2F%2Ffeed.test%2Fa")!
    precondition(signedPolicy.imageOriginal(signed) != nil && !signedPolicy.allows(signed))
    precondition(signedPolicy.imageOriginal(URL(string: signed.absoluteString + "&d=bad")!) == nil)
    precondition(signedPolicy.imageOriginal(URL(string: signed.absoluteString.replacingOccurrences(of: "/static/image?", with: "/account?"))!) == nil)
    for raw in ["https://auth.example/a", "https://sub.auth.example/a", "slaxstatics://api.example/a", "https://r.slax.com/a", "https://SLAX.COM.:443/a", "https://user@public.test/a"] { precondition(!policy.allows(URL(string: raw)!)) }
    for raw in ["https://auth.example.public.test/a", "https://public.test/a", "https://www.youtube.com/embed/abcdefghijk"] { precondition(policy.allows(URL(string: raw)!)) }
    precondition((try? SlaxReaderSecurity([])) == nil)
    let rules = try JSONSerialization.jsonObject(with: Data(policy.contentRules().utf8)) as! [[String: Any]]
    let filters = try rules.map { try NSRegularExpression(pattern: ($0["trigger"] as! [String: Any])["url-filter"] as! String, options: .caseInsensitive) }
    for raw in ["https://auth.example/a", "https://sub.auth.example/a", "https://SLAX.COM.:443/a"] { precondition(filters.contains { $0.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)) != nil }) }
    let wrong = "https://auth.example.public.test/a"
    precondition(!filters.contains { $0.firstMatch(in: wrong, range: NSRange(wrong.startIndex..., in: wrong)) != nil })
    var compiled = false, compileFailure: Error?
    let ruleId = "slax-reader-host-\(UUID().uuidString)"
    WKContentRuleListStore.default().compileContentRuleList(forIdentifier: ruleId, encodedContentRuleList: try policy.contentRules()) { list, error in compiled = list != nil; compileFailure = error }
    spin { compiled || compileFailure != nil }
    precondition(compiled, "WebKit rejected the protected-host rule list")
    WKContentRuleListStore.default().removeContentRuleList(forIdentifier: ruleId) { _ in }
    let configuration = SlaxResourceStream.configuration()
    precondition(configuration.httpCookieStorage == nil && !configuration.httpShouldSetCookies && configuration.urlCredentialStorage == nil && configuration.urlCache == nil)
    let redirectTask = Task("slaxstatics://public.test/a")
    let stream = SlaxResourceStream(task: redirectTask, original: URL(string: "https://public.test/a")!, allowsNetwork: true, security: policy, hasOwnership: { true }, done: {})
    let session = URLSession(configuration: configuration)
    let network = session.dataTask(with: URL(string: "https://public.test/a")!)
    let response = HTTPURLResponse(url: URL(string: "https://public.test/a")!, statusCode: 302, httpVersion: nil, headerFields: [:])!
    var dirty = URLRequest(url: URL(string: "https://public.test/b")!); dirty.setValue("synthetic", forHTTPHeaderField: "Cookie"); dirty.setValue("Bearer synthetic", forHTTPHeaderField: "Authorization")
    stream.urlSession(session, task: network, willPerformHTTPRedirection: response, newRequest: dirty) { clean in
      precondition(clean?.url == dirty.url && clean?.value(forHTTPHeaderField: "Cookie") == nil && clean?.value(forHTTPHeaderField: "Authorization") == nil && clean?.httpShouldHandleCookies == false)
    }
    stream.urlSession(session, task: network, willPerformHTTPRedirection: response, newRequest: URLRequest(url: URL(string: "https://auth.example/a")!)) { precondition($0 == nil) }
    precondition(redirectTask.failed)
    session.invalidateAndCancel()
    for mime in ["text/html", "application/json", "application/octet-stream", "image/png"] {
      let rejected = Task("slaxmedias://public.test/a")
      let mediaStream = SlaxResourceStream(task: rejected, original: URL(string: "https://public.test/a")!, allowsNetwork: true, security: policy, hasOwnership: { true }, done: {})
      mediaStream.urlSession(session, dataTask: network, didReceive: URLResponse(url: URL(string: "https://public.test/a")!, mimeType: mime, expectedContentLength: 5, textEncodingName: nil)) { precondition($0 == .cancel) }
      precondition(rejected.failed && rejected.responses == 0)
    }
    let missing = SlaxResourceHandler(); missing.hasResourceOwnership = { true }
    let refused = Task("slaxstatics://example.com/a"); missing.start(refused); precondition(refused.failed)
    for raw in ["slaxstatics://auth.example/a", "slaxstatics://r.slax.com/a"] { let denied = Task(raw); handler.start(denied); precondition(denied.failed && denied.responses == 0) }
    func legacyFile(_ url: String) -> URL {
      let hash = Insecure.MD5.hash(data: Data(url.utf8)).map { String(format: "%02x", $0) }.joined()
      let tail = url.components(separatedBy: ".").last!
      let ext = String(tail.components(separatedBy: "?")[0].components(separatedBy: "&")[0].prefix(10)).lowercased()
      return root.appendingPathComponent("bookmark/\(handler.cacheKey)/images/\(hash).\(ext)")
    }
    for url in ["https://example.com/image", "https://example.com/a.b/image?size=1", "https://example.com/image?size=1#x", "https://example.com/image#x", "https://example.com/a.png?x=.com/image"] {
      let file = legacyFile(url)
      try manager.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try Data("legacy-image".utf8).write(to: file)
      let task = Task(url.replacingOccurrences(of: "https://", with: "slaxstatics://"))
      handler.start(task); spin { task.finished || task.failed }
      precondition(task.finished && String(data: task.bytes, encoding: .utf8) == "legacy-image")
      let retained = try Data(contentsOf: file)
      precondition(retained == Data("legacy-image".utf8))
      let canceled = Task(task.request.url!.absoluteString)
      handler.start(canceled); handler.cancelAll()
      RunLoop.main.run(until: Date().addingTimeInterval(0.03))
      precondition(canceled.responses == 0 && canceled.bytes.isEmpty && !canceled.finished)
      let revoked = Task(task.request.url!.absoluteString)
      handler.start(revoked); owns = false
      RunLoop.main.run(until: Date().addingTimeInterval(0.03))
      precondition(revoked.responses == 0 && revoked.bytes.isEmpty && !revoked.finished)
      owns = true
    }
    let hash = String(repeating: "a", count: 32)
    precondition(SlaxCachePaths.file(root: root, key: "../foreign", name: "\(hash).jpg") == nil)
    for name in ["\(hash).com/../outside", "\(hash).com//image", "\(hash).com/./image", "\(hash).com/\\image"] {
      precondition(SlaxCachePaths.file(root: root, key: handler.cacheKey, name: name) == nil)
    }
    let outside = root.appendingPathComponent("outside")
    try manager.createDirectory(at: outside, withIntermediateDirectories: true)
    let secret = outside.appendingPathComponent("image")
    try Data("foreign".utf8).write(to: secret)
    let file = legacyFile("https://example.com/foreign")
    try manager.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try manager.createSymbolicLink(at: file, withDestinationURL: secret)
    let denied = Task("slaxstatics://example.com/foreign")
    handler.start(denied); spin { denied.finished || denied.failed }
    precondition(denied.failed && denied.bytes.isEmpty)
    let alias = root.appendingPathComponent("bookmark/alias")
    try manager.createSymbolicLink(at: alias, withDestinationURL: root.appendingPathComponent("bookmark/\(handler.cacheKey)"))
    precondition(SlaxCachePaths.file(root: root, key: "alias", name: "\(hash).jpg") == nil)
    let external = root.appendingPathComponent("bookmark/external")
    try manager.createDirectory(at: external, withIntermediateDirectories: true)
    try manager.createSymbolicLink(at: external.appendingPathComponent("images"), withDestinationURL: outside)
    precondition(SlaxCachePaths.file(root: root, key: "external", name: "\(hash).jpg") == nil)
    let bridge = SlaxCachePathsModule().definition().imageCacheFileUri
    let relative = "bookmark/\(handler.cacheKey)/images/\(hash).com/image"
    precondition(bridge(root.path, handler.cacheKey, relative) != nil)
    precondition(bridge(outside.path, handler.cacheKey, relative) == nil)
    precondition(bridge(root.path, "foreign", relative) == nil)
    precondition(bridge(root.path, "alias", "bookmark/alias/images/\(hash).jpg") == nil)
    precondition(bridge(root.path, "external", "bookmark/external/images/\(hash).jpg") == nil)
    let pdfBridge = SlaxCachePathsModule().definition().pdfCacheFileUri
    let support = manager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
    precondition(pdfBridge(support.path, "pdf/v1/account/document/manifest.json.entries/1.data") != nil)
    for path in ["pdf/../foreign", "pdf//document", "pdf/./document", "bookmark/document", "pdf/%2f/document"] { precondition(pdfBridge(support.path, path) == nil) }
    precondition(pdfBridge(outside.path, "pdf/v1/account/document") == nil)
    handler.close()
    let closed = Task("slaxstatics://example.com/image")
    handler.start(closed)
    precondition(closed.failed && closed.bytes.isEmpty)
    precondition(support.resolvingSymlinksInPath().path.hasPrefix(testHome + "/"))
    let imagePolicy = try SlaxReaderSecurity(["localhost", "auth.example"])
    let expectedImage = Data((0..<(256 * 1024 + 7)).map {UInt8($0 % 251)})
    func counts() -> [String: Int] { (try? JSONSerialization.jsonObject(with: Data(contentsOf: URL(string: mediaHost + "/image-counts")!)) as? [String: Int]) ?? [:] }
    func release(_ key: String) { _ = try? Data(contentsOf: URL(string: mediaHost + "/release-image?key=" + key)!) }
    func imageHandler(_ key: String) -> SlaxResourceHandler {
      let value = SlaxResourceHandler(); value.cacheKey = key; value.resourceOwner = "synthetic-owner"; value.security = imagePolicy; value.hasResourceOwnership = {true}; return value
    }
    func imageTask(_ path: String) -> Task { Task(mediaHost.replacingOccurrences(of: "http:", with: "slaxstatic:") + "/image-" + path) }
    let staging = caches.appendingPathComponent("slax-image-transfers"), abandoned = staging.appendingPathComponent("process-0000")
    try manager.createDirectory(at: abandoned, withIntermediateDirectories: true)
    try Data("partial".utf8).write(to: abandoned.appendingPathComponent("partial.tmp"))
    let untouched = root.appendingPathComponent("untouched"); try Data("keep".utf8).write(to: untouched)
    try manager.createSymbolicLink(at: abandoned.appendingPathComponent("link"), withDestinationURL: untouched)
    let operatorFile = staging.appendingPathComponent("operator-state"); try Data("keep".utf8).write(to: operatorFile)
    let native = SlaxImageModule().definition()
    func resolve(_ key: String, _ path: String, network: Bool = true) throws -> ExpoModulesCore.Promise {
      let id = try native.begin("synthetic-owner"), promise = ExpoModulesCore.Promise()
      native.resolve("synthetic-owner", id, ["directory": support.path, "key": key, "url": mediaHost + "/image-" + path,
        "hosts": ["localhost", "auth.example"], "proxies": [], "allowNetwork": network, "strict": true], promise)
      return promise
    }
    let web = imageHandler("shared-article"), shared = imageTask("held-shared")
    web.start(shared); spin {counts()["held-shared"] == 1}
    let pin = try SlaxImageResources.registry().acquire(owner: "synthetic-owner", url: URL(string: mediaHost + "/image-held-shared")!, policy: imagePolicy)
    let sharedPromise = try resolve("shared-article", "held-shared")
    release("held-shared"); spin {shared.finished || shared.failed}; spin {sharedPromise.value != nil || sharedPromise.error != nil}
    precondition(shared.finished && shared.bytes == expectedImage && shared.chunks.allSatisfy {$0 <= 65536})
    precondition(counts()["held-shared"] == 1 && sharedPromise.error == nil)
    let sharedURI = (sharedPromise.value as! [String: Any])["uri"] as! String
    let persisted = try Data(contentsOf: URL(string: sharedURI)!); precondition(persisted == expectedImage)
    pin.close(); web.close()
    let untouchedBytes = try Data(contentsOf: untouched), operatorBytes = try Data(contentsOf: operatorFile)
    precondition(!manager.fileExists(atPath: abandoned.path)); precondition(untouchedBytes == Data("keep".utf8) && operatorBytes == Data("keep".utf8))
    let offline = imageHandler("shared-article"), offlineTask = imageTask("held-shared"); offline.start(offlineTask); spin {offlineTask.finished || offlineTask.failed}
    precondition(offlineTask.finished && offlineTask.bytes == expectedImage && counts()["held-shared"] == 1); offline.close()
    let transient = imageHandler("transient-article"), cancelled = imageTask("held-retained")
    transient.start(cancelled); spin {counts()["held-retained"] == 1}
    let retained = try SlaxImageResources.registry().acquire(owner: "synthetic-owner", url: URL(string: mediaHost + "/image-held-retained")!, policy: imagePolicy)
    let retainedPromise = try resolve("retained-article", "held-retained")
    transient.close(); release("held-retained"); spin {retainedPromise.value != nil || retainedPromise.error != nil}
    precondition(cancelled.responses == 0 && cancelled.bytes.isEmpty && !cancelled.finished)
    precondition(counts()["held-retained"] == 1 && (retainedPromise.value as? [String: Any])?["uri"] != nil); retained.close()
    let interrupted = imageHandler("shared-article"), firstChunk = imageTask("held-shared")
    firstChunk.onChunk = {interrupted.close()}; interrupted.start(firstChunk); spin {!firstChunk.bytes.isEmpty}
    RunLoop.main.run(until: Date().addingTimeInterval(0.1)); precondition(firstChunk.chunks.count == 1 && !firstChunk.finished)
    let failedImage = imageHandler("bad-image"), invalidImage = imageTask("html"); failedImage.start(invalidImage); spin {invalidImage.failed || invalidImage.finished}; precondition(invalidImage.failed && invalidImage.bytes.isEmpty); failedImage.close()
    let missingMime = imageHandler("missing-mime"), mimeTask = imageTask("mime"); missingMime.start(mimeTask); spin {mimeTask.failed || mimeTask.finished}; precondition(mimeTask.finished && mimeTask.bytes == expectedImage); missingMime.close()
    let stale = imageHandler("old-account"), staleTask = imageTask("held-stale"); stale.start(staleTask); spin {counts()["held-stale"] == 1}
    try SlaxStorageOwner.activate("replacement-owner"); stale.close(); SlaxImageModule.revokeAll(); release("held-stale")
    RunLoop.main.run(until: Date().addingTimeInterval(0.2)); precondition(staleTask.responses == 0 && staleTask.bytes.isEmpty)
    let drained = try SlaxImageResources.registry().close(); precondition(drained.wait(timeout: .now() + 5) == .success)
    print("Production Swift resources: shared WebView/module images, bounded main delivery, cancellation, legacy paths, media and scoped recovery passed (macOS host only).")
  }
}
