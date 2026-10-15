import ExpoModulesCore
import Foundation
import CryptoKit

final class SlaxImageResources {
  private static let lock = NSLock()
  private static var shared: SlaxImageRegistry?
  static func registry() throws -> SlaxImageRegistry {
    lock.lock(); defer { lock.unlock() }
    if let shared { return shared }
    guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { throw SlaxFileStoreError.invalid }
    let root = caches.appendingPathComponent("slax-image-transfers")
    guard root.path == root.resolvingSymlinksInPath().path else { throw SlaxFileStoreError.unsafe }
    let files = FileManager.default
    try files.createDirectory(at: root, withIntermediateDirectories: true)
    for child in try files.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) where child.lastPathComponent.range(of: "^process-[A-Fa-f0-9-]+$", options: .regularExpression) != nil {
      if (try? files.attributesOfItem(atPath: child.path)[.type] as? FileAttributeType) != .typeSymbolicLink { try files.removeItem(at: child) }
    }
    let registry = SlaxImageRegistry(directory: root.appendingPathComponent("process-\(UUID().uuidString)")); shared = registry; return registry
  }
  static func root(_ directory: String) throws -> (URL, Bool) {
    guard let supplied = directory.hasPrefix("file:") ? URL(string: directory) : URL(fileURLWithPath: directory), supplied.isFileURL,
      supplied.host == nil || supplied.host == "", supplied.query == nil, supplied.fragment == nil,
      let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { throw SlaxFileStoreError.invalid }
    let root = supplied.standardizedFileURL
    guard root.path == root.resolvingSymlinksInPath().path else { throw SlaxFileStoreError.unsafe }
    var fixture = false
    #if DEBUG
    if let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
      root.path.hasPrefix(caches.appendingPathComponent("slax-ui-fixtures").resolvingSymlinksInPath().path + "/"),
      let data = try? Data(contentsOf: root.appendingPathComponent("slax-fixture.json")), let marker = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      fixture = marker["controlledFixture"] as? Bool == true && marker["fixtureVersion"] as? Int == 1
    }
    #endif
    guard root.path == support.resolvingSymlinksInPath().path || fixture else { throw SlaxFileStoreError.unsafe }
    return (root, fixture)
  }
  static func paths(root: URL, key: String, original: URL) -> [URL] {
    let value = original.absoluteString
    let hash = Insecure.MD5.hash(data: Data(value.utf8)).map {String(format: "%02x", $0)}.joined()
    let tail = value.contains(".") ? String(value.split(separator: ".", omittingEmptySubsequences: false).last ?? "") : ""
    let candidate = String(decoding: tail.components(separatedBy: "?")[0].components(separatedBy: "&")[0].utf16.prefix(10), as: UTF16.self).lowercased()
    let legacy = candidate.isEmpty ? "jpg" : candidate
    let safe = !legacy.contains("..") && !legacy.unicodeScalars.contains { $0.value < 32 || $0.value == 127 || $0.value == 47 || $0.value == 92 } ? legacy : "jpg"
    guard let current = SlaxCachePaths.file(root: root, key: key, name: hash + "." + safe) else { return [] }
    return [current] + (safe == legacy ? [] : [SlaxCachePaths.file(root: root, key: key, name: hash + "." + legacy)].compactMap { $0 })
  }
}

private final class SlaxImageOperation {
  let owner: String
  let lease: SlaxStorageLease
  private let lock = NSLock()
  private var consumer: SlaxImageRegistry.Consumer?
  private var claimed = false
  func claim() -> Bool { lock.lock(); defer { lock.unlock() }; guard !claimed, (try? lease.check()) != nil else { return false }; claimed = true; return true }
  init(owner: String) throws { self.owner = owner; lease = try SlaxStorageOwner.capture(owner) }
  func attach(_ value: SlaxImageRegistry.Consumer) throws {
    lock.lock(); defer { lock.unlock() }
    do { try lease.check(); consumer = value } catch { value.close(); throw error }
  }
  func cancel() { lock.lock(); lease.cancel(); consumer?.close(); consumer = nil; lock.unlock() }
}

public final class SlaxImageModule: Module {
  private static let lock = NSLock()
  private static var operations: [String: SlaxImageOperation] = [:]
  private static var pending = 0
  private static let workers: OperationQueue = {
    let queue = OperationQueue(); queue.name = "SlaxImageCache"; queue.qualityOfService = .utility; queue.maxConcurrentOperationCount = 3; return queue
  }()
  static func revokeAll() { lock.lock(); let previous = Array(operations.values); operations.removeAll(); lock.unlock(); previous.forEach { $0.cancel() } }
  private static func remove(_ id: String, operation: SlaxImageOperation) { lock.lock(); if operations[id] === operation { operations.removeValue(forKey: id) }; lock.unlock() }
  public func definition() -> ModuleDefinition {
    Name("SlaxImageCache")
    Function("begin") { (owner: String) throws -> String in
      Self.lock.lock(); defer { Self.lock.unlock() }
      guard Self.operations.count < 128 else { throw SlaxFileStoreError.oversized }
      let id = UUID().uuidString; Self.operations[id] = try SlaxImageOperation(owner: owner); return id
    }
    Function("end") { (owner: String, id: String) -> Void in
      Self.lock.lock(); let operation = Self.operations[id]
      if operation?.owner == owner { Self.operations.removeValue(forKey: id) }; Self.lock.unlock()
      if operation?.owner == owner { operation?.cancel() }
    }
    AsyncFunction("resolve") { (owner: String, id: String, options: [String: Any], promise: Promise) in
      Self.lock.lock(); let operation = Self.operations[id]; Self.lock.unlock()
      guard let operation, operation.owner == owner, operation.claim() else { promise.resolve(["error": "cancelled"]); return }
      Self.lock.lock()
      guard Self.pending < 128 else { Self.lock.unlock(); operation.cancel(); Self.remove(id, operation: operation); promise.resolve(["error": "busy"]); return }
      Self.pending += 1; Self.lock.unlock()
      Self.workers.addOperation {
        defer { operation.cancel(); Self.remove(id, operation: operation); Self.lock.lock(); Self.pending -= 1; Self.lock.unlock() }
        do {
          try operation.lease.check()
          guard let key = options["key"] as? String, let directory = options["directory"] as? String,
            let raw = options["url"] as? String, let url = URL(string: raw), let hosts = options["hosts"] as? [String], let proxies = options["proxies"] as? [String] else { throw SlaxFileStoreError.invalid }
          let policy = try SlaxReaderSecurity(hosts, imageProxyOrigins: proxies)
          guard let original = policy.imageOriginal(url) else { throw SlaxImageFailure(terminal: true) }
          let (root, fixture) = try SlaxImageResources.root(directory), paths = SlaxImageResources.paths(root: root, key: key, original: original)
          guard let target = paths.first else { throw SlaxFileStoreError.unsafe }
          for file in paths {
            if let attributes = try? FileManager.default.attributesOfItem(atPath: file.path), attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber, (1...SlaxImageRegistry.maxBytes).contains(size.int64Value) {
              try operation.lease.check(); promise.resolve(["uri": file.absoluteString, "size": size]); return
            }
          }
          guard options["allowNetwork"] as? Bool == true, !fixture else { try operation.lease.check(); promise.resolve(nil); return }
          let consumer = try SlaxImageResources.registry().acquire(owner: owner, url: original, policy: policy, strict: options["strict"] as? Bool != false)
          try operation.attach(consumer)
          let resource = try consumer.wait(); try operation.lease.check()
          let relative = String(target.path.dropFirst(root.path.count + 1))
          let uri = try consumer.persist(root: root, relative: relative) { try operation.lease.check() }
          try operation.lease.check()
          var result: [String: Any] = ["uri": uri, "size": resource.size]; if let mime = resource.mime { result["mime"] = mime }; promise.resolve(result)
        } catch {
          let active = (try? operation.lease.check()) != nil, failure = error as? SlaxImageFailure
          var result: [String: Any] = ["error": active ? "unavailable" : "cancelled", "status": failure?.status ?? 0, "terminal": failure?.terminal ?? false]
          if let retryAfter = failure?.retryAfter { result["retryAfter"] = retryAfter }; promise.resolve(result)
        }
      }
    }
  }
}
