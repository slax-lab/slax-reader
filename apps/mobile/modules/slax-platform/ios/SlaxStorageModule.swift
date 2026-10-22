import ExpoModulesCore
import Foundation

public final class SlaxStorageModule: Module {
  private static let budget = NSLock()
  private static var pendingBytes = 0
  private static var pendingCount = 0
  private static let workers: OperationQueue = {
    let queue = OperationQueue(); queue.name = "SlaxStorage"; queue.qualityOfService = .utility; queue.maxConcurrentOperationCount = 2; return queue
  }()

  private var writes: [String: (String?, SlaxStorageLease)] = [:]
  private let writeLock = NSLock()
  private func submit(_ directory: String, owner: String?, bytes: Int = 0, promise: Promise, captured: SlaxStorageLease? = nil, work: @escaping (SlaxFileStore) throws -> Any?) throws {
    let lease = try captured ?? SlaxStorageOwner.capture(owner)
    Self.budget.lock()
    guard bytes <= 32 * 1024 * 1024 - Self.pendingBytes, Self.pendingCount < 64 else {
      Self.budget.unlock(); throw SlaxFileStoreError.oversized
    }
    Self.pendingBytes += bytes; Self.pendingCount += 1; Self.budget.unlock()
    Self.workers.addOperation {
      defer { Self.budget.lock(); Self.pendingBytes -= bytes; Self.pendingCount -= 1; Self.budget.unlock() }
      do {
        try lease.check()
        guard let supplied = directory.hasPrefix("file:") ? URL(string: directory) : URL(fileURLWithPath: directory), supplied.isFileURL,
          supplied.host == nil || supplied.host == "", supplied.query == nil, supplied.fragment == nil,
          let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { throw SlaxFileStoreError.invalid }
        let root = supplied.standardizedFileURL
        guard root.path == root.resolvingSymlinksInPath().path else { throw SlaxFileStoreError.unsafe }
        var fixture = false
        #if DEBUG
        if let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
          root.path.hasPrefix(caches.appendingPathComponent("slax-ui-fixtures").resolvingSymlinksInPath().path + "/"),
          let data = try? Data(contentsOf: root.appendingPathComponent("slax-fixture.json")),
          let marker = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
          fixture = marker["controlledFixture"] as? Bool == true && marker["fixtureVersion"] as? Int == 1
        }
        #endif
        guard root.path == support.resolvingSymlinksInPath().path || fixture else { throw SlaxFileStoreError.unsafe }
        let result = try work(SlaxFileStore(root: root, pdfRoot: root, lease: lease)); try lease.check(); promise.resolve(result)
      } catch { promise.reject(NSError(domain: "SlaxStorage", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cache operation failed or owner was released"])) }
    }
  }

  public func definition() -> ModuleDefinition {
    Name("SlaxStorage")
    Function("beginWrite") { (owner: String?) throws -> String in
      self.writeLock.lock(); defer { self.writeLock.unlock() }
      guard self.writes.count < 64 else { throw SlaxFileStoreError.oversized }
      let id = UUID().uuidString; self.writes[id] = (owner, try SlaxStorageOwner.capture(owner)); return id
    }
    Function("endWrite") { (owner: String?, id: String) in
      self.writeLock.lock()
      let entry = self.writes[id]
      if entry?.0 == owner { self.writes.removeValue(forKey: id) }
      self.writeLock.unlock()
      if entry?.0 == owner { entry?.1.cancel() }
    }
    AsyncFunction("readBytes") { (directory: String, owner: String?, path: String, versioned: Bool, promise: Promise) in
      try self.submit(directory, owner: owner, promise: promise) { try $0.read(path, versioned: versioned, limit: SlaxFileStore.blockLimit) }
    }
    AsyncFunction("readText") { (directory: String, owner: String?, path: String, promise: Promise) in
      try self.submit(directory, owner: owner, promise: promise) { store in
        guard let bytes = try store.read(path, versioned: false, limit: SlaxFileStore.articleLimit) else { return nil }
        guard let text = String(data: bytes, encoding: .utf8) else { throw SlaxFileStoreError.invalid }; return text
      }
    }
    AsyncFunction("writeBytes") { (directory: String, owner: String?, path: String, bytes: Data, versioned: Bool, promise: Promise) in
      try self.submit(directory, owner: owner, bytes: bytes.count, promise: promise) { try $0.write(path, bytes: bytes, versioned: versioned) }
    }
    AsyncFunction("writeBlock") { (directory: String, owner: String?, id: String, path: String, bytes: Data, promise: Promise) in
      self.writeLock.lock(); let entry = self.writes[id]; self.writeLock.unlock()
      guard let entry, entry.0 == owner, path.hasPrefix("pdf/"), bytes.count <= SlaxFileStore.blockLimit else { throw SlaxFileStoreError.revoked }
      try self.submit(directory, owner: owner, bytes: bytes.count, promise: promise, captured: entry.1) { try $0.write(path, bytes: bytes, versioned: true) }
    }
    AsyncFunction("writeImage") { (directory: String, owner: String?, id: String, path: String, bytes: Data, promise: Promise) in
      self.writeLock.lock(); let entry = self.writes[id]; self.writeLock.unlock()
      guard let entry, entry.0 == owner, path.hasPrefix("bookmark/"), path.contains("/images/") else { throw SlaxFileStoreError.revoked }
      try self.submit(directory, owner: owner, bytes: bytes.count, promise: promise, captured: entry.1) { try $0.write(path, bytes: bytes, versioned: false) }
    }
    AsyncFunction("writeText") { (directory: String, owner: String?, path: String, text: String, promise: Promise) in
      guard text.utf8.count <= SlaxFileStore.articleLimit else { throw SlaxFileStoreError.oversized }
      try self.submit(directory, owner: owner, bytes: text.utf8.count, promise: promise) { try $0.write(path, bytes: Data(text.utf8), versioned: false) }
    }
    AsyncFunction("writeArticle") { (directory: String, owner: String?, id: String, path: String, text: String, promise: Promise) in
      self.writeLock.lock(); let entry = self.writes[id]; self.writeLock.unlock()
      guard let entry, entry.0 == owner, path.hasPrefix("bookmark/"), path.hasSuffix("/content.html"), text.utf8.count <= SlaxFileStore.articleLimit else { throw SlaxFileStoreError.invalid }
      try self.submit(directory, owner: owner, bytes: text.utf8.count, promise: promise, captured: entry.1) { try $0.write(path, bytes: Data(text.utf8), versioned: false) }
    }
    AsyncFunction("textFingerprint") { (directory: String, owner: String?, text: String, promise: Promise) in
      guard text.utf8.count <= SlaxFileStore.articleLimit else { throw SlaxFileStoreError.oversized }
      try self.submit(directory, owner: owner, bytes: text.utf8.count, promise: promise) { try $0.textFingerprint(text) }
    }
    AsyncFunction("fingerprint") { (directory: String, owner: String?, path: String, promise: Promise) in
      try self.submit(directory, owner: owner, promise: promise) { try $0.fingerprint(path) }
    }
    AsyncFunction("size") { (directory: String, owner: String?, path: String, versioned: Bool, promise: Promise) in
      try self.submit(directory, owner: owner, promise: promise) { try $0.size(path, versioned: versioned) }
    }
    AsyncFunction("list") { (directory: String, owner: String?, path: String, versioned: Bool, promise: Promise) in
      try self.submit(directory, owner: owner, promise: promise) { try $0.list(path, versioned: versioned) }
    }
    AsyncFunction("measure") { (directory: String, owner: String?, path: String, promise: Promise) in
      try self.submit(directory, owner: owner, promise: promise) { try $0.measure(path) }
    }
    AsyncFunction("stageRemoval") { (directory: String, owner: String?, id: String, path: String, generation: String, promise: Promise) in
      self.writeLock.lock(); let entry = self.writes[id]; self.writeLock.unlock()
      guard let entry, entry.0 == owner else { throw SlaxFileStoreError.revoked }
      try self.submit(directory, owner: owner, promise: promise, captured: entry.1) { try $0.stageRemoval(path, generation: generation); return nil }
    }
    AsyncFunction("restoreRemoval") { (directory: String, owner: String?, path: String, generation: String, promise: Promise) in
      try self.submit(directory, owner: owner, promise: promise) { try $0.restoreRemoval(path, generation: generation); return nil }
    }
    AsyncFunction("purgeRemoval") { (directory: String, owner: String?, path: String, generation: String, promise: Promise) in
      try self.submit(directory, owner: owner, promise: promise) { try $0.purgeRemoval(path, generation: generation); return nil }
    }
    AsyncFunction("remove") { (directory: String, owner: String?, path: String, versioned: Bool, promise: Promise) in
      try self.submit(directory, owner: owner, promise: promise) { try $0.remove(path, versioned: versioned); return nil }
    }
  }
}
