import Foundation
import CryptoKit

struct Failure: Error { let code: String }
final class Recorder {
  let lock = NSLock()
  var events: [(Date, String, [String: Any])] = []
  func add(_ name: String, _ body: [String: Any]) { lock.lock(); events.append((Date(), name, body)); lock.unlock() }
  func snapshot() -> [(Date, String, [String: Any])] { lock.lock(); defer { lock.unlock() }; return events }
  func state(_ key: String) -> [String: Any]? {
    snapshot().filter { $0.1 == "onStatus" }.flatMap { ($0.2["items"] as? [[String: Any]]) ?? [] }.last { $0["key"] as? String == key }
  }
  func states(_ key: String) -> [String] {
    snapshot().filter { $0.1 == "onStatus" }.flatMap { ($0.2["items"] as? [[String: Any]]) ?? [] }.filter { $0["key"] as? String == key }.compactMap { $0["state"] as? String }
  }
}
func settle(_ body: (SlaxOfflineReply) -> Void) -> Result<Any?, Failure> {
  let signal = DispatchSemaphore(value: 0), lock = NSLock(); var out: Result<Any?, Failure>?
  body(SlaxOfflineReply(resolve: { value in lock.lock(); out = .success(value); lock.unlock(); signal.signal() },
    reject: { code, _ in lock.lock(); out = .failure(Failure(code: code)); lock.unlock(); signal.signal() }))
  precondition(signal.wait(timeout: .now() + 30) == .success, "Engine reply timed out")
  lock.lock(); defer { lock.unlock() }; return out!
}
func value(_ body: (SlaxOfflineReply) -> Void) -> Any? {
  switch settle(body) { case .success(let value): return value; case .failure(let failure): fatalError("Unexpected rejection: \(failure.code)") }
}
func rejection(_ body: (SlaxOfflineReply) -> Void) -> String {
  switch settle(body) { case .success: fatalError("Expected rejection"); case .failure(let failure): return failure.code }
}
func until(_ label: String, seconds: Double = 20, _ condition: () -> Bool) {
  let end = Date().addingTimeInterval(seconds)
  while !condition() { precondition(Date() < end, "Timed out waiting for " + label); Thread.sleep(forTimeInterval: 0.05) }
}

@main struct Host {
  static func main() throws {
    let origin = CommandLine.arguments[1], imageOrigin = CommandLine.arguments[2]
    let root = URL(fileURLWithPath: CommandLine.arguments[3]).standardizedFileURL.resolvingSymlinksInPath()
    let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[4]))) as! [String: Any]
    for item in fixture["cases"] as! [[String: Any]] {
      let actual = SlaxOfflineHtml.imageUrls(item["html"] as! String), expected = item["images"] as! [String]
      precondition(actual == expected, "HTML extraction mismatch in '\(item["name"]!)': \(actual) != \(expected)")
    }
    let files = FileManager.default
    func counts() -> [String: Int] { (try? JSONSerialization.jsonObject(with: Data(contentsOf: URL(string: origin + "/counts")!))) as? [String: Int] ?? [:] }
    func write(_ relative: String, _ text: String) throws {
      let file = root.appendingPathComponent(relative)
      try files.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true); try Data(text.utf8).write(to: file)
    }
    func exists(_ relative: String) -> Bool { files.fileExists(atPath: root.appendingPathComponent(relative).path) }
    func manifest(_ key: String) -> [String: Any]? {
      (try? Data(contentsOf: root.appendingPathComponent("bookmark/\(key)/offline.json"))).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }
    let legacyHtml = "<p>legacy</p><img src=\"slaxstatic://\(imageOrigin.dropFirst(7))/img/a.png\">"
    try write("bookmark/legacy/content.html", legacyHtml)
    try files.createDirectory(at: root.appendingPathComponent("bookmark/emptydir/images"), withIntermediateDirectories: true)
    try write("bookmark/avatar-x/manifest.json", "{}")
    try write("pdf/v1/" + String(repeating: "b", count: 64) + "/doc/manifest.json.entries/0000000000000001-x.data", "{}")
    try write("bookmark/.slax-evict-gen-abcd/intent", "slax-cache-eviction-v1\nbookmark/evicted\n")

    let recorder = Recorder()
    var registry: SlaxImageRegistry?
    let registryLock = NSLock()
    let environment = SlaxOfflineEnvironment(root: { URL(fileURLWithPath: $0).standardizedFileURL.resolvingSymlinksInPath() }, registry: {
      registryLock.lock(); defer { registryLock.unlock() }
      if registry == nil { registry = SlaxImageRegistry(directory: root.deletingLastPathComponent().appendingPathComponent("transfers")) }
      return registry!
    }, allowHTTP: true, random: { 1 })
    let engine = SlaxOfflineEngine(environment: environment)
    _ = engine.attach { name, body in recorder.add(name, body) }
    try SlaxStorageOwner.activate("acct")
    let scope: [String: Any] = ["owner": "acct", "scope": "[\"\(origin)\",\"user-1\"]", "origin": origin, "directory": root.path, "userAgent": "SlaxReader/ios test",
      "clientType": "ios", "clientVersion": "1.0.0", "protectedHosts": ["localhost"], "imageProxyOrigins": [origin]]
    let migration = value { engine.open(scope, reply: $0) } as! [String: Any]
    precondition(migration["migrationPending"] as? Bool == true && migration["adopted"] as? [String] == ["legacy"], "Unexpected adoption \(migration)")
    precondition(Set(migration["dropped"] as! [String]) == ["emptydir", "evicted"], "Unexpected dropped \(migration)")
    precondition(!exists("pdf/v1") && exists("bookmark/avatar-x/manifest.json") && !exists("bookmark/.slax-evict-gen-abcd"))
    let adopted = manifest("legacy")!
    precondition(adopted["version"] is NSNull && (adopted["images"] as! [[String: Any]]).map { $0["u"] as! String } == [imageOrigin + "/img/a.png"])
    _ = value { engine.commitMigration("acct", reply: $0) }
    _ = value { engine.close("acct", reply: $0) }
    precondition((value { engine.open(scope, reply: $0) } as! [String: Any])["migrationPending"] as? Bool == false)
    let sessionStart = Date()

    engine.setCredential("acct", ["generation": 1, "token": "t1"])
    engine.setConditions("acct", ["online": true, "downloadImages": true])
    func task(_ key: String, _ version: String = "v1", kind: String = "article", manual: Bool = false) -> [String: Any] { ["key": key, "id": key, "kind": kind, "manual": manual, "version": version] }
    engine.applyPlan("acct", ["revision": 1, "remove": [String](), "upsert": [task("article-a"), task("legacy"), task("pdf-a", kind: "pdf"), task("denied", manual: true), task("auth"), task("flaky")]])
    until("credential rejection") { recorder.snapshot().contains { $0.1 == "onCredentialRejected" && $0.2["generation"] as? Int == 1 } }
    engine.setCredential("acct", ["generation": 2, "token": "t2"])
    for key in ["article-a", "legacy", "auth", "flaky", "pdf-a"] { until(key + " complete", seconds: 30) { recorder.state(key)?["state"] as? String == "complete" } }
    until("denied") { recorder.state("denied")?["state"] as? String == "denied" }
    precondition(recorder.state("denied")?["code"] as? String == "http_forbidden" && recorder.state("denied")?["manual"] as? Bool == true)
    let served = counts()
    precondition(served["content:legacy"] == nil && served["content:flaky"] == 2 && served["content:denied"] == 1, "Unexpected requests \(served)")
    precondition(recorder.states("article-a").first == "downloading" || recorder.states("article-a") == ["complete"])

    let articleHtml = try String(contentsOf: root.appendingPathComponent("bookmark/article-a/content.html"), encoding: .utf8)
    precondition(articleHtml.contains("ünïcode") && manifest("article-a")?["version"] as? String == "v1" && manifest("legacy")?["version"] as? String == "v1")
    let imageUrl = imageOrigin + "/img/a.png"
    let md5 = Insecure.MD5.hash(data: Data(imageUrl.utf8)).map { String(format: "%02x", $0) }.joined()
    let imagePath = "bookmark/article-a/images/\(md5).png"
    precondition(SlaxImageResources.paths(root: root, key: "article-a", original: URL(string: imageUrl)!).first?.path == root.appendingPathComponent(imagePath).path)
    until("article images") {
      let images = (manifest("article-a")?["images"] as? [[String: Any]]) ?? []
      return images.count == 2 && images[0]["s"] as? String == "ready" && images[1]["s"] as? String == "denied"
    }
    let imageBytes = try Data(contentsOf: root.appendingPathComponent(imagePath)); precondition(imageBytes == Data([137, 80, 78, 71, 1, 2, 3]))
    until("legacy image") { exists("bookmark/legacy/images/\(md5).png") }

    precondition(value { engine.readArticle("acct", "article-a", reply: $0) } as? String == articleHtml)
    precondition(value { engine.readArticle("acct", "missing", reply: $0) } == nil)
    let before = counts()["content:article-a"]
    precondition(value { engine.fetchArticle("acct", ["key": "article-a", "id": "article-a", "requestId": "r1", "force": false], reply: $0) } as? String == articleHtml)
    precondition(counts()["content:article-a"] == before)
    precondition((value { engine.fetchArticle("acct", ["key": "article-a", "id": "article-a", "requestId": "r2", "force": true], reply: $0) } as? String)?.contains("ünïcode") == true)
    precondition(counts()["content:article-a"] == before! + 1)
    precondition(rejection { engine.fetchArticle("acct", ["key": "bad", "id": "other", "requestId": "r3"], reply: $0) } == "invalid_request")

    // Committed-copy reads bypass a busy control queue and a saturated IO pool.
    let controlHeld = DispatchSemaphore(value: 0), ioHeld = DispatchSemaphore(value: 0)
    engine.control.async { _ = controlHeld.wait(timeout: .now() + 10) }
    for _ in 0..<8 { engine.io.addOperation { _ = ioHeld.wait(timeout: .now() + 10) } }
    let busyStart = Date()
    precondition(value { engine.readArticle("acct", "article-a", reply: $0) } as? String == articleHtml)
    precondition(value { engine.fetchArticle("acct", ["key": "article-a", "id": "article-a", "requestId": "r-busy", "force": false], reply: $0) } as? String == articleHtml)
    precondition(Date().timeIntervalSince(busyStart) < 2, "A foreground read waited behind background work")
    controlHeld.signal(); for _ in 0..<8 { ioHeld.signal() }
    engine.io.waitUntilAllOperationsAreFinished()

    let pdfSize = 2 * 1024 * 1024 + 512 * 1024 + 7
    let status = value { engine.pdfStatus("acct", "pdf-a", reply: $0) } as! [String: Any]
    precondition(status["complete"] as? Bool == true && status["downloadedBytes"] as? Int64 == Int64(pdfSize), "PDF status \(status)")
    let documentId = String(repeating: "a", count: 64)
    let document = try Data(contentsOf: root.appendingPathComponent("pdf/v2/" + Data(("[\"\(origin)\",\"user-1\"]").utf8).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") + "/pdf-a/document.pdf"))
    precondition(document.count == pdfSize && document.enumerated().allSatisfy { Int($0.element) == $0.offset % 251 })
    let local = value { engine.readPdfRange("acct", ["key": "pdf-a", "id": "pdf-a", "documentId": documentId, "size": pdfSize, "begin": 1000, "end": 5000, "requestId": "p1"], reply: $0) } as! Data
    precondition(local == document.subdata(in: 1000..<5000))
    let cached = value { engine.pdfMetadata("acct", ["key": "pdf-a", "id": "pdf-a", "requestId": "p2", "allowNetwork": false], reply: $0) } as! [String: Any]
    precondition(cached["document_id"] as? String == documentId && cached["url"] as? String == "/v1/bookmark/pdf?bookmark_uid=pdf-a")
    let pdfRequests = counts()["pdf:pdf-a"]
    precondition(pdfRequests == 3, "Expected three resumable windows, got \(String(describing: pdfRequests))")
    let full = value { engine.readPdfRange("acct", ["key": "pdf-full", "id": "pdf-full", "documentId": documentId, "size": pdfSize, "begin": 70_000, "end": 70_100, "requestId": "p3"], reply: $0) } as! Data
    precondition(full == document.subdata(in: 70_000..<70_100))
    let remote = value { engine.pdfMetadata("acct", ["key": "pdf-full", "id": "pdf-full", "requestId": "p4", "allowNetwork": true], reply: $0) } as! [String: Any]
    precondition(remote["size"] as? Int64 == Int64(pdfSize))
    precondition(rejection { engine.pdfMetadata("acct", ["key": "pdf-gone", "id": "pdf-gone", "requestId": "p5"], reply: $0) } == "http_not_found")

    let usage = value { engine.usage("acct", ["article-a", "pdf-a"], reply: $0) } as! [String: Any]
    precondition((usage["article"] as! Int64) > Int64(pdfSize + articleHtml.utf8.count) && usage["images"] as? Int64 == 7, "Usage \(usage)")

    let token = engine.protect("acct", "article-a")
    engine.applyPlan("acct", ["revision": 2, "remove": ["article-a"], "upsert": [Any]()])
    precondition((value { engine.evict("acct", ["article-a"], reply: $0) } as! [String]).isEmpty)
    engine.release("acct", token)
    precondition(value { engine.evict("acct", ["article-a"], reply: $0) } as? [String] == ["article-a"] && !exists("bookmark/article-a"))
    until("evicted event") { recorder.state("article-a")?["state"] as? String == "evicted" }
    engine.applyPlan("acct", ["revision": 1, "remove": ["legacy"], "upsert": [Any]()])
    engine.applyPlan("acct", ["revision": 3, "remove": [String](), "upsert": [task("legacy", "v2")]])
    until("legacy re-acquired") { counts()["content:legacy"] == 1 && manifest("legacy")?["version"] as? String == "v2" }
    until("legacy v2 complete") { recorder.state("legacy")?["state"] as? String == "complete" }
    until("legacy images") { (manifest("legacy")?["images"] as? [[String: Any]])?.first?["s"] as? String == "ready" }
    precondition((value { engine.clear("acct", ["legacy"], ["images"], reply: $0) } as! [String]).isEmpty && !exists("bookmark/legacy/images") && exists("bookmark/legacy/content.html"))
    engine.applyPlan("acct", ["revision": 4, "remove": ["legacy"], "upsert": [Any]()])
    precondition(value { engine.clear("acct", ["legacy"], ["article"], reply: $0) } as? [String] == ["legacy"] && !exists("bookmark/legacy/content.html"))

    // A manually retained article with an unbound committed body: the manual task binds it and only fills its images.
    precondition((value { engine.fetchArticle("acct", ["key": "manual-a", "id": "manual-a", "requestId": "r4", "force": false], reply: $0) } as? String)?.contains("ünïcode") == true)
    until("manual body committed") { manifest("manual-a") != nil }
    precondition(manifest("manual-a")?["version"] is NSNull && ((manifest("manual-a")?["images"] as? [[String: Any]]) ?? []).allSatisfy { $0["s"] as? String == "pending" })
    engine.applyPlan("acct", ["revision": 5, "remove": [String](), "upsert": [task("manual-a", "v3", manual: true)]])
    until("manual images") {
      let images = (manifest("manual-a")?["images"] as? [[String: Any]]) ?? []
      return images.count == 2 && images[0]["s"] as? String == "ready" && images[1]["s"] as? String == "denied"
    }
    until("manual complete") { recorder.state("manual-a")?["state"] as? String == "complete" }
    precondition(recorder.state("manual-a")?["manual"] as? Bool == true && !recorder.states("manual-a").contains("downloading"), "Manual states \(recorder.states("manual-a"))")
    precondition(counts()["content:manual-a"] == 1 && manifest("manual-a")?["version"] as? String == "v3" && exists("bookmark/manual-a/images/\(md5).png"), "Manual task refetched its body")

    let statusTimes = recorder.snapshot().filter { $0.1 == "onStatus" && $0.0 >= sessionStart }.map(\.0)
    for (left, right) in zip(statusTimes, statusTimes.dropFirst()) { precondition(right.timeIntervalSince(left) >= 0.24, "onStatus emitted faster than 250ms") }

    engine.applyPlan("acct", ["revision": 6, "remove": [String](), "upsert": [task("slow")]])
    until("slow request") { counts()["content:slow"] == 1 }
    try SlaxStorageOwner.activate("other")
    until("revoked session") { if case .failure(let failure) = settle({ engine.readArticle("acct", "flaky", reply: $0) }) { return failure.code == "session_changed" }; return false }
    _ = try? Data(contentsOf: URL(string: origin + "/release?key=slow")!)
    Thread.sleep(forTimeInterval: 0.5)
    precondition(!exists("bookmark/slow"), "Revoked acquisition wrote after owner change")
    print("Swift offline engine passed")
    exit(0)
  }
}
