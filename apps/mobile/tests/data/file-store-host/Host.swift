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
    try SlaxStorageOwner.activate("account-a")
    let store = SlaxFileStore(root: root, pdfRoot: root, lease: try SlaxStorageOwner.capture("account-a"))
    let pdf = "pdf/v1/account/doc/manifest.json"
    _ = try store.write(pdf, bytes: Data([1]), versioned: true)
    _ = try store.write(pdf, bytes: Data([2, 3]), versioned: true)
    try expect(try store.read(pdf, versioned: true, limit: 1024) == Data([2, 3]))
    try expect(try store.size(pdf, versioned: true) == 2)
    try expect(try store.list("pdf/v1/account", versioned: true) == [pdf])
    rejects { _ = try store.write(pdf, bytes: Data([4]), versioned: true) { throw SlaxFileStoreError.io } }
    try expect(try store.read(pdf, versioned: true, limit: 1024) == Data([2, 3]))
    try expect(try files.contentsOfDirectory(atPath: root.appendingPathComponent(pdf + ".entries").path).count == 1)
    rejects { _ = try store.write(pdf, bytes: Data(repeating: 1, count: SlaxFileStore.blockLimit + 1), versioned: true) }
    rejects { _ = try store.read(pdf, versioned: true, limit: 1) }
    let html = "bookmark/doc/content.html"
    _ = try store.write(html, bytes: Data("old article".utf8), versioned: false)
    rejects { _ = try store.write(html, bytes: Data("replacement".utf8), versioned: false) { throw SlaxFileStoreError.io } }
    try expect(try store.read(html, versioned: false, limit: 1024) == Data("old article".utf8))
    try expect(try store.measure("bookmark/doc") == 11)
    for bad in ["../private", "pdf/../private", "pdf//x", "/pdf/x", "bookmark/../x", "bookmark/key/../../x", "pdf/%2f/x", "bookmark/key\\bad/x"] { rejects { _ = try store.read(bad, versioned: false, limit: 1024) } }
    let outside = root.appendingPathComponent("outside")
    try files.createDirectory(at: outside, withIntermediateDirectories: true)
    try Data("safe".utf8).write(to: outside.appendingPathComponent("keep"))
    let linked = root.appendingPathComponent("bookmark/linked")
    try files.createSymbolicLink(at: linked, withDestinationURL: outside)
    rejects { _ = try store.read("bookmark/linked/keep", versioned: false, limit: 1024) }
    rejects { try store.remove("bookmark/linked", versioned: false) }
    try files.removeItem(at: linked)

    let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0), finished = DispatchSemaphore(value: 0)
    let lock = NSLock(); var failed = false
    DispatchQueue.global().async {
      do {
        _ = try store.write(html, bytes: Data(repeating: 7, count: 200_000), versioned: false) {
          entered.signal(); precondition(release.wait(timeout: .now() + 5) == .success)
        }
      } catch { lock.lock(); failed = true; lock.unlock() }
      finished.signal()
    }
    precondition(entered.wait(timeout: .now() + 5) == .success)
    try SlaxStorageOwner.activate(nil); try SlaxStorageOwner.activate("account-b"); release.signal()
    precondition(finished.wait(timeout: .now() + 5) == .success); lock.lock(); precondition(failed); lock.unlock()
    rejects { _ = try store.read(html, versioned: false, limit: 1024) }
    rejects { _ = try SlaxStorageOwner.capture(nil) }
    let next = SlaxFileStore(root: root, pdfRoot: root, lease: try SlaxStorageOwner.capture("account-b"))
    try expect(try next.read(html, versioned: false, limit: 1024) == Data("old article".utf8))
    _ = try next.write(html, bytes: Data("new account".utf8), versioned: false)
    try expect(try next.read(html, versioned: false, limit: 1024) == Data("new account".utf8))
    try next.remove(pdf, versioned: true); try expect(try next.read(pdf, versioned: true, limit: 1024) == nil)
    try next.remove("bookmark/doc", versioned: false); try expect(try next.measure("bookmark/doc") == 0)
    try expect(try Data(contentsOf: outside.appendingPathComponent("keep")) == Data("safe".utf8))
    let imagePath = "bookmark/doc/images/image.jpg", imageLease = try SlaxStorageOwner.capture("account-b")
    let cancellable = SlaxFileStore(root: root, pdfRoot: root, lease: imageLease)
    _ = try next.write(imagePath, bytes: Data([1]), versioned: false)
    rejects { _ = try cancellable.write(imagePath, bytes: Data([2]), versioned: false) { imageLease.cancel() } }
    try expect(try next.read(imagePath, versioned: false, limit: 1024) == Data([1]))
    let blockLease = try SlaxStorageOwner.capture("account-b")
    let blockStore = SlaxFileStore(root: root, pdfRoot: root, lease: blockLease)
    _ = try next.write(pdf, bytes: Data([6, 7]), versioned: true)
    rejects { _ = try blockStore.write(pdf, bytes: Data([9]), versioned: true) { blockLease.cancel() } }
    try expect(try next.read(pdf, versioned: true, limit: 1024) == Data([6, 7]))
    let text = "article 正文 📖", bytes = Data(text.utf8)
    let expected = try next.textFingerprint(text)
    precondition(expected["size"] as? Int == bytes.count)
    _ = try next.write(html, bytes: bytes, versioned: false)
    try expect(try next.fingerprint(html)?["sha256"] as? String == expected["sha256"] as? String)
    try expect(try next.fingerprint("bookmark/absent/content.html") == nil)
    _ = try next.write(html, bytes: Data("abc".utf8), versioned: false)
    try expect(try next.fingerprint(html)?["sha256"] as? String == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    let entry = "bookmark/doc"
    try next.stageRemoval(entry, generation: "evict-one"); try expect(try next.read(html, versioned: false, limit: 1024) == nil)
    let restarted = SlaxFileStore(root: root, pdfRoot: root, lease: try SlaxStorageOwner.capture("account-b"))
    try restarted.restoreRemoval(entry, generation: "evict-one"); try expect(try restarted.read(html, versioned: false, limit: 1024) == Data("abc".utf8))
    try restarted.stageRemoval(entry, generation: "evict-two")
    _ = try restarted.write(html, bytes: Data("new generation".utf8), versioned: false)
    try restarted.stageRemoval(entry, generation: "evict-two"); try restarted.restoreRemoval(entry, generation: "evict-two")
    try expect(try restarted.read(html, versioned: false, limit: 1024) == Data("new generation".utf8))
    try expect(try restarted.read(imagePath, versioned: false, limit: 1024) == Data([1]))
    try restarted.stageRemoval(entry, generation: "evict-three")
    _ = try restarted.write(html, bytes: Data("after detach".utf8), versioned: false)
    try restarted.purgeRemoval(entry, generation: "evict-three"); try expect(try restarted.read(html, versioned: false, limit: 1024) == Data("after detach".utf8))
    try restarted.purgeRemoval(entry, generation: "evict-three"); try restarted.restoreRemoval(entry, generation: "evict-three")
    let detachLease = try SlaxStorageOwner.capture("account-b"), detach = SlaxFileStore(root: root, pdfRoot: root, lease: try SlaxStorageOwner.capture("account-b"))
    let cancelledStore = SlaxFileStore(root: root, pdfRoot: root, lease: detachLease)
    rejects { try cancelledStore.stageRemoval(entry, generation: "evict-cancel") { detachLease.cancel() } }
    try detach.restoreRemoval(entry, generation: "evict-cancel")
    try expect(try restarted.read(html, versioned: false, limit: 1024) == Data("after detach".utf8))
    let scoped = "pdf/v1/" + String(repeating: "a", count: 64) + "/doc", manifest = scoped + "/manifest.json"
    _ = try restarted.write(manifest, bytes: Data([1]), versioned: true); _ = try restarted.write(scoped + "/0.block", bytes: Data([2]), versioned: true)
    try restarted.stageRemoval(scoped, generation: "pdf-stage"); _ = try restarted.write(manifest, bytes: Data([3]), versioned: true)
    try restarted.restoreRemoval(scoped, generation: "pdf-stage")
    try expect(try restarted.read(manifest, versioned: true, limit: 1024) == Data([3]))
    try expect(try restarted.read(scoped + "/0.block", versioned: true, limit: 1024) == Data([2]))
    for bad in ["bookmark", "bookmark/doc/images", "pdf/v1/foreign/doc", "bookmark/../outside"] { rejects { try restarted.stageRemoval(bad, generation: "invalid") } }
    for bad in ["", "../bad", String(repeating: "x", count: 101)] { rejects { try restarted.stageRemoval(entry, generation: bad) } }
    try restarted.stageRemoval(entry, generation: "corrupt-marker")
    let receipt = try files.contentsOfDirectory(at: root.appendingPathComponent("bookmark"), includingPropertiesForKeys: nil).first { $0.lastPathComponent.hasPrefix(".slax-evict-corrupt-marker-") }!
    try Data("wrong".utf8).write(to: receipt.appendingPathComponent("intent"))
    rejects { try restarted.restoreRemoval(entry, generation: "corrupt-marker") }; rejects { try restarted.purgeRemoval(entry, generation: "corrupt-marker") }
    try expect(try Data(contentsOf: receipt.appendingPathComponent("payload/content.html")) == Data("after detach".utf8))
    try Data("slax-cache-eviction-v1\n\(entry)\n".utf8).write(to: receipt.appendingPathComponent("intent")); try restarted.restoreRemoval(entry, generation: "corrupt-marker")
    try expect(try Data(contentsOf: outside.appendingPathComponent("keep")) == Data("safe".utf8))
    try restarted.stageRemoval("bookmark/absent", generation: "empty-receipt")
    let emptyReceipt = try files.contentsOfDirectory(at: root.appendingPathComponent("bookmark"), includingPropertiesForKeys: nil).first { $0.lastPathComponent.hasPrefix(".slax-evict-empty-receipt-") }!
    try files.removeItem(at: emptyReceipt.appendingPathComponent("intent")); try restarted.restoreRemoval("bookmark/absent", generation: "empty-receipt")
    precondition(!files.fileExists(atPath: emptyReceipt.path))
    let markerLease = try SlaxStorageOwner.capture("account-b"), markerStore = SlaxFileStore(root: root, pdfRoot: root, lease: try SlaxStorageOwner.capture("account-b"))
    let cancelledMarkerStore = SlaxFileStore(root: root, pdfRoot: root, lease: markerLease)
    rejects { try cancelledMarkerStore.stageRemoval(entry, generation: "partial-marker") { markerLease.cancel() } }
    let partialReceipt = try files.contentsOfDirectory(at: root.appendingPathComponent("bookmark"), includingPropertiesForKeys: nil).first { $0.lastPathComponent.hasPrefix(".slax-evict-partial-marker-") }!
    try Data("partial".utf8).write(to: partialReceipt.appendingPathComponent("intent")); try markerStore.restoreRemoval(entry, generation: "partial-marker")
    try expect(try restarted.read(html, versioned: false, limit: 1024) == Data("after detach".utf8))
    try restarted.stageRemoval(entry, generation: "revoked-purge"); try SlaxStorageOwner.activate("account-c")
    rejects { try restarted.purgeRemoval(entry, generation: "revoked-purge") }
    let recoveredOwner = SlaxFileStore(root: root, pdfRoot: root, lease: try SlaxStorageOwner.capture("account-c"))
    try recoveredOwner.restoreRemoval(entry, generation: "revoked-purge")
    try expect(try recoveredOwner.read(html, versioned: false, limit: 1024) == Data("after detach".utf8))
    print("Swift native file storage passed")
  }
}
