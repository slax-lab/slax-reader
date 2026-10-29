import Foundation

func expect(_ value: @autoclosure () throws -> Bool) rethrows { let result = try value(); precondition(result) }

func rejects(_ work: () throws -> Void) {
  var failed = false
  do { try work() } catch { failed = true }
  precondition(failed, "Expected rejected storage operation")
}

@main struct Host {
  static func main() throws {
    let root = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL.resolvingSymlinksInPath()
    let files = FileManager.default
    try files.createDirectory(at: root, withIntermediateDirectories: true)
    let observed = NSLock(); var notifications: [String?] = []
    let observer = SlaxStorageOwner.observe { owner in observed.lock(); notifications.append(owner); observed.unlock() }
    try SlaxStorageOwner.activate("account-a")
    let store = SlaxFileStore(root: root, pdfRoot: root, lease: try SlaxStorageOwner.capture("account-a"))
    let html = "bookmark/doc/content.html"
    _ = try store.write(html, bytes: Data("old article".utf8))
    rejects { _ = try store.write(html, bytes: Data("replacement".utf8)) { throw SlaxFileStoreError.io } }
    try expect(try store.read(html, limit: 1024) == Data("old article".utf8))
    try expect(try store.size(html) == 11)
    try expect(try store.list("bookmark/doc") == [html])
    try expect(try store.measure("bookmark/doc") == 11)
    try expect(try store.readRange(html, offset: 4, length: 7) == Data("article".utf8))
    try expect(try store.readRange(html, offset: 8, length: 7) == nil)
    rejects { _ = try store.read(html, limit: 1) }
    rejects { _ = try store.write(html, bytes: Data(repeating: 1, count: SlaxFileStore.articleLimit + 1)) }
    for bad in ["../private", "pdf/../private", "pdf//x", "/pdf/x", "bookmark/../x", "bookmark/key/../../x", "pdf/%2f/x", "bookmark/key\\bad/x", "offline-engine.json"] { rejects { _ = try store.read(bad, limit: 1024) } }
    let outside = root.appendingPathComponent("outside")
    try files.createDirectory(at: outside, withIntermediateDirectories: true)
    try Data("safe".utf8).write(to: outside.appendingPathComponent("keep"))
    let linked = root.appendingPathComponent("bookmark/linked")
    try files.createSymbolicLink(at: linked, withDestinationURL: outside)
    rejects { _ = try store.read("bookmark/linked/keep", limit: 1024) }
    rejects { try store.remove("bookmark/linked") }
    try expect(try store.directories("bookmark") == ["doc"])
    try files.removeItem(at: linked)

    let part = "pdf/v2/scope/doc/document.pdf.part"
    try store.append(part, at: 0, bytes: Data([1, 2, 3]))
    try store.append(part, at: 2, bytes: Data([9, 8]))
    try expect(try store.read(part, limit: 1024) == Data([1, 2, 9, 8]))
    try store.move(part, to: "pdf/v2/scope/doc/document.pdf")
    try expect(try store.size(part) == nil && store.size("pdf/v2/scope/doc/document.pdf") == 4)
    let stream = try store.stream("pdf/v2/scope/doc/full.pdf")
    try stream.write(Data([4, 5])); try stream.write(Data([6]))
    try expect(try store.size("pdf/v2/scope/doc/full.pdf") == nil)
    _ = try stream.commit(); try expect(try store.read("pdf/v2/scope/doc/full.pdf", limit: 1024) == Data([4, 5, 6]))
    let aborted = try store.stream("pdf/v2/scope/doc/aborted.pdf"); try aborted.write(Data([1])); aborted.abort()
    try expect(try store.list("pdf/v2/scope/doc").sorted() == ["pdf/v2/scope/doc/document.pdf", "pdf/v2/scope/doc/full.pdf"])

    try expect(try store.readMarker() == nil)
    try store.writeMarker(Data("{\"layout\":2}".utf8))
    try expect(try store.readMarker() == Data("{\"layout\":2}".utf8))
    let receipt = root.appendingPathComponent("bookmark/.slax-evict-gen-abc")
    try files.createDirectory(at: receipt.appendingPathComponent("payload"), withIntermediateDirectories: true)
    try Data("slax-cache-eviction-v1\nbookmark/evicted-key\n".utf8).write(to: receipt.appendingPathComponent("intent"))
    try files.createDirectory(at: root.appendingPathComponent("bookmark/.slax-delete-old"), withIntermediateDirectories: true)
    try expect(try store.purgeStaging("bookmark") == ["evicted-key"])
    try expect(try files.contentsOfDirectory(atPath: root.appendingPathComponent("bookmark").path).sorted() == ["doc"])

    let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0), finished = DispatchSemaphore(value: 0)
    let lock = NSLock(); var failed = false
    DispatchQueue.global().async {
      do {
        _ = try store.write(html, bytes: Data(repeating: 7, count: 200_000)) {
          entered.signal(); precondition(release.wait(timeout: .now() + 5) == .success)
        }
      } catch { lock.lock(); failed = true; lock.unlock() }
      finished.signal()
    }
    precondition(entered.wait(timeout: .now() + 5) == .success)
    try SlaxStorageOwner.activate(nil); try SlaxStorageOwner.activate("account-b"); release.signal()
    precondition(finished.wait(timeout: .now() + 5) == .success); lock.lock(); precondition(failed); lock.unlock()
    rejects { _ = try store.read(html, limit: 1024) }
    rejects { try store.append(part, at: 0, bytes: Data([1])) }
    rejects { _ = try SlaxStorageOwner.capture(nil) }
    observed.lock(); precondition(notifications == ["account-a", nil, "account-b"]); observed.unlock()
    SlaxStorageOwner.unobserve(observer)
    let next = SlaxFileStore(root: root, pdfRoot: root, lease: try SlaxStorageOwner.capture("account-b"))
    try expect(try next.read(html, limit: 1024) == Data("old article".utf8))
    _ = try next.write(html, bytes: Data("new account".utf8))
    try expect(try next.read(html, limit: 1024) == Data("new account".utf8))
    try expect(try next.remove("bookmark/doc")); try expect(try next.measure("bookmark/doc") == 0); try expect(try !next.remove("bookmark/doc"))
    try expect(try Data(contentsOf: outside.appendingPathComponent("keep")) == Data("safe".utf8))
    let imagePath = "bookmark/doc/images/image.jpg", imageLease = try SlaxStorageOwner.capture("account-b")
    let cancellable = SlaxFileStore(root: root, pdfRoot: root, lease: imageLease)
    _ = try next.write(imagePath, bytes: Data([1]))
    rejects { _ = try cancellable.write(imagePath, bytes: Data([2])) { imageLease.cancel() } }
    try expect(try next.read(imagePath, limit: 1024) == Data([1]))
    let child = next.lease.child(); child.cancel()
    rejects { _ = try SlaxFileStore(root: root, pdfRoot: root, lease: child).write(imagePath, bytes: Data([3])) }
    try expect(try next.read(imagePath, limit: 1024) == Data([1]))
    let parentLease = try SlaxStorageOwner.capture("account-b"), childLease = parentLease.child(), grandchildLease = childLease.child()
    try childLease.check(); parentLease.cancel()
    rejects { try childLease.check() }; rejects { try grandchildLease.check() }
    rejects { _ = try SlaxFileStore(root: root, pdfRoot: root, lease: childLease).write(imagePath, bytes: Data([4])) }
    try expect(try next.read(imagePath, limit: 1024) == Data([1]))
    print("Swift native file storage passed")
  }
}
