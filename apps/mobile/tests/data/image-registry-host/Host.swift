import Foundation

func expect(_ value: @autoclosure () throws -> Bool) rethrows { let result = try value(); precondition(result) }
func rejects(_ work: () throws -> Void) { var failed = false; do { try work() } catch { failed = true }; precondition(failed, "Expected image rejection") }
@main struct Host {
  static func main() throws {
    let origin = CommandLine.arguments[1], root = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let policy = try SlaxReaderSecurity(["localhost", "api.test"]), expected = Data((0..<(256 * 1024 + 7)).map { UInt8($0 % 251) })
    try SlaxStorageOwner.activate("account-a")
    func request(_ path: String) throws -> Data { try Data(contentsOf: URL(string: origin + "/" + path)!) }
    func counts() throws -> [String: Int] { try JSONSerialization.jsonObject(with: request("counts")) as! [String: Int] }
    func until(_ key: String, _ value: Int = 1) throws {
      for _ in 0..<100 { if try counts()[key, default: 0] >= value { return }; Thread.sleep(forTimeInterval: 0.02) }
      fatalError("Image checkpoint timed out: " + key)
    }
    func release(_ key: String) throws { _ = try request("release?key=" + key) }
    func registry(_ key: String) -> SlaxImageRegistry { SlaxImageRegistry(directory: root.appendingPathComponent(key)) }
    func acquire(_ registry: SlaxImageRegistry, _ path: String, strict: Bool = true, policy override: SlaxReaderSecurity? = nil) throws -> SlaxImageRegistry.Consumer {
      try registry.acquire(owner: "account-a", url: URL(string: origin + "/" + path)!, policy: override ?? policy, strict: strict)
    }
    func close(_ registry: SlaxImageRegistry) { precondition(registry.close().wait(timeout: .now() + 5) == .success, "Image cleanup did not drain") }
    func empty(_ key: String) throws -> Bool { let directory = root.appendingPathComponent(key); if !FileManager.default.fileExists(atPath: directory.path) { return true }; return try FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty }
    let shared = registry("shared"), first = try acquire(shared, "held-shared"), second = try acquire(shared, "held-shared")
    try until("held-shared"); first.close(); rejects { _ = try first.wait() }; try release("held-shared")
    let resource = try second.wait(); try expect(try Data(contentsOf: resource.file) == expected); try expect(try counts()["held-shared"] == 1)
    let third = try acquire(shared, "held-shared", policy: SlaxReaderSecurity(["api.test", "localhost"]))
    try expect(try third.wait().file == resource.file)
    let relative = "bookmark/article/images/" + String(repeating: "a", count: 32) + ".png"
    let uri = try second.persist(root: root, relative: relative)
    try expect(try Data(contentsOf: URL(string: uri)!) == expected)
    let other = try third.persist(root: root, relative: "bookmark/collection-owner-article/images/" + String(repeating: "a", count: 32) + ".png")
    precondition(other != uri); try expect(try Data(contentsOf: URL(string: other)!) == expected)
    second.close(); precondition(FileManager.default.fileExists(atPath: resource.file.path)); third.close(); close(shared)
    precondition(!FileManager.default.fileExists(atPath: resource.file.path)); try expect(try Data(contentsOf: URL(string: uri)!) == expected)

    let policies = registry("policies"), permitted = try acquire(policies, "policy")
    let separated = try acquire(policies, "policy", policy: SlaxReaderSecurity(["localhost", "api.test", "other.test"]))
    try expect(try permitted.wait().file != separated.wait().file); try expect(try counts()["policy"] == 2)
    rejects { _ = try policies.acquire(owner: "account-a", url: URL(string: "http://localhost:" + String(URL(string: origin)!.port!) + "/protected")!, policy: policy) }
    permitted.close(); separated.close(); close(policies)

    let missing = registry("missing"), compatible = try acquire(missing, "mime", strict: false), strict = try acquire(missing, "mime")
    try expect(try Data(contentsOf: compatible.wait().file) == expected); rejects { _ = try strict.wait() }; try expect(try counts()["mime"] == 1)
    compatible.close(); strict.close(); close(missing)
    let compressed = registry("compressed"), compressedImage = try acquire(compressed, "gzip")
    try expect(try Data(contentsOf: compressedImage.wait().file) == expected); compressedImage.close(); close(compressed)
    let invalid = registry("invalid")
    for path in ["html", "large", "truncated", "redirect", "rate"] {
      let consumer = try acquire(invalid, path)
      do { _ = try consumer.wait(); fatalError("Invalid image accepted") }
      catch { if path == "rate" { let failure = error as! SlaxImageFailure; precondition(failure.status == 429 && failure.retryAfter == "17" && !failure.terminal) } }
      consumer.close()
    }
    close(invalid); try expect(try empty("invalid"))

    let cancelled = registry("cancelled"), last = try acquire(cancelled, "held-last")
    try until("held-last"); last.close(); rejects { _ = try last.wait() }; try release("held-last"); close(cancelled); try expect(try empty("cancelled"))
    let limits = registry("limits"), limited = try (0..<3).map { try acquire(limits, "limit-\($0)") }
    for _ in 0..<100 { if try (0..<3).reduce(0, { $0 + (try counts()["limit-\($1)", default: 0]) }) >= 2 { break }; Thread.sleep(forTimeInterval: 0.02) }
    let snapshot = try counts(); precondition((0..<3).reduce(0, { $0 + snapshot["limit-\($1)", default: 0] }) == 2)
    for index in 0..<3 { try release("limit-\(index)") }
    for consumer in limited { try expect(try consumer.wait().size == expected.count); consumer.close() }; close(limits)

    let stale = registry("stale"), old = try acquire(stale, "held-stale"); try until("held-stale")
    try SlaxStorageOwner.activate("account-b"); try release("held-stale"); rejects { _ = try old.wait() }; old.close(); close(stale); try expect(try empty("stale"))
    try SlaxStorageOwner.activate("account-a")
    let interrupted = registry("interrupted"), writing = try acquire(interrupted, "interrupted"); _ = try writing.wait()
    let destination = "bookmark/article/images/" + String(repeating: "b", count: 32) + ".png", original = root.appendingPathComponent(destination)
    try Data("prior".utf8).write(to: original)
    rejects { _ = try writing.persist(root: root, relative: destination) { writing.close() } }
    try expect(try Data(contentsOf: original) == Data("prior".utf8)); close(interrupted)
    let store = SlaxFileStore(root: root, pdfRoot: root, lease: try SlaxStorageOwner.capture("account-a"))
    for bytes in [Data([1]), Data(repeating: 1, count: 10)] {
      let inputURL = root.appendingPathComponent("stream-input"); try bytes.write(to: inputURL)
      let input = try FileHandle(forReadingFrom: inputURL); defer { try? input.close() }
      rejects { _ = try store.writeStream(destination, input: input, expectedBytes: 5) }
      try expect(try Data(contentsOf: original) == Data("prior".utf8))
    }
    let outside = root.appendingPathComponent("outside"); try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
    let alias = root.appendingPathComponent("bookmark/alias"); try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: outside)
    let testInput = try FileHandle(forReadingFrom: original); defer { try? testInput.close() }
    rejects { _ = try store.writeStream("bookmark/alias/foreign", input: testInput, expectedBytes: 5) }
    precondition(!FileManager.default.fileExists(atPath: outside.appendingPathComponent("foreign").path))
    let pipe = Pipe(), done = DispatchSemaphore(value: 0), resultLock = NSLock(); var failure: Error?
    DispatchQueue.global().async {
      do { _ = try store.writeStream("bookmark/article/images/" + String(repeating: "c", count: 32) + ".png", input: pipe.fileHandleForReading, expectedBytes: 1) }
      catch { resultLock.lock(); failure = error; resultLock.unlock() }
      done.signal()
    }
    for _ in 0..<100 {
      if try FileManager.default.contentsOfDirectory(atPath: original.deletingLastPathComponent().path).contains(where: { $0.hasPrefix(".slax-") }) { break }
      Thread.sleep(forTimeInterval: 0.01)
    }
    try expect(try store.read(destination, versioned: false, limit: 10) == Data("prior".utf8))
    try pipe.fileHandleForWriting.write(contentsOf: Data([7])); try pipe.fileHandleForWriting.close()
    precondition(done.wait(timeout: .now() + 5) == .success); resultLock.lock(); precondition(failure == nil); resultLock.unlock(); try pipe.fileHandleForReading.close()

    let capacity = registry("capacity"), many = try (0..<256).map { _ in try acquire(capacity, "held-capacity") }
    rejects { _ = try acquire(capacity, "held-capacity") }; many.forEach { $0.close() }; try release("held-capacity"); close(capacity)
    let budget = registry("budget")
    let retained = try (0..<3).map { index -> SlaxImageRegistry.Consumer in let consumer = try acquire(budget, "budget-\(index)"); try expect(try consumer.wait().size == SlaxImageRegistry.maxBytes); return consumer }
    let queued = try acquire(budget, "budget-3"); Thread.sleep(forTimeInterval: 0.1); try expect(try counts()["budget-3", default: 0] == 0)
    retained[0].close(); try expect(try queued.wait().size == SlaxImageRegistry.maxBytes)
    retained.dropFirst().forEach { $0.close() }; queued.close(); close(budget); try expect(try empty("budget"))
    print("Swift shared image registry passed")
  }
}
