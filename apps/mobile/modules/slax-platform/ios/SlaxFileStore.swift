import Foundation
import Darwin
import CryptoKit

enum SlaxStorageOwner {
  private static let lock = NSLock()
  private static var owner: String?
  private static var epoch: UInt64 = 0
  static func activate(_ value: String?) throws {
    lock.lock(); defer { lock.unlock() }
    guard value == nil || value!.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { throw SlaxFileStoreError.invalid }
    epoch &+= 1; owner = value
  }
  static func capture(_ value: String?) throws -> SlaxStorageLease {
    lock.lock(); defer { lock.unlock() }
    guard owner == value else { throw SlaxFileStoreError.revoked }
    return SlaxStorageLease(owner: value, epoch: epoch)
  }
  static func current<T>(_ value: String?, epoch revision: UInt64, _ work: () throws -> T) throws -> T {
    lock.lock(); defer { lock.unlock() }
    guard owner == value, epoch == revision else { throw SlaxFileStoreError.revoked }
    return try work()
  }
}

final class SlaxStorageLease {
  let owner: String?
  let epoch: UInt64
  private let lock = NSLock()
  private var cancelled = false
  init(owner: String?, epoch: UInt64) { self.owner = owner; self.epoch = epoch }
  func cancel() { lock.lock(); cancelled = true; lock.unlock() }
  func check() throws { try commit {} }
  func commit<T>(_ work: () throws -> T) throws -> T {
    lock.lock(); defer { lock.unlock() }
    guard !cancelled else { throw SlaxFileStoreError.revoked }
    return try SlaxStorageOwner.current(owner, epoch: epoch, work)
  }
}

enum SlaxFileStoreError: Error { case invalid, revoked, unsafe, oversized, io }

final class SlaxFileStore {
  static let blockLimit = 1024 * 1024
  static let articleLimit = 20 * 1024 * 1024
  private static let io = NSRecursiveLock()
  private let root: URL
  private let pdfRoot: URL
  private let lease: SlaxStorageLease
  private let files = FileManager.default

  init(root: URL, pdfRoot: URL, lease: SlaxStorageLease) { self.root = root; self.pdfRoot = pdfRoot; self.lease = lease }

  private func path(_ relative: String) throws -> URL {
    try lease.check()
    let parts = relative.components(separatedBy: "/")
    guard parts.count <= 64, relative.utf8.count <= 4096, let first = parts.first, ["bookmark", "pdf"].contains(first), parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.unicodeScalars.contains { $0.value <= 31 || $0.value == 127 || $0.value == 92 } }),
      first != "pdf" || parts.allSatisfy({ $0.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil }),
      first != "bookmark" || parts.count == 1 || parts[1].range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { throw SlaxFileStoreError.invalid }
    var current = first == "pdf" ? pdfRoot : root
    guard current.isFileURL, current.resolvingSymlinksInPath().path == current.path else { throw SlaxFileStoreError.unsafe }
    for part in parts {
      current.appendPathComponent(part)
      guard current.resolvingSymlinksInPath().path == current.path,
        (try? files.attributesOfItem(atPath: current.path)[.type] as? FileAttributeType) != .typeSymbolicLink else { throw SlaxFileStoreError.unsafe }
    }
    return current
  }

  private func versions(_ relative: String) throws -> [URL] {
    let directory = try path(relative + ".entries")
    guard files.fileExists(atPath: directory.path) else { return [] }
    return try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).filter { url in
      guard url.lastPathComponent.range(of: "^[0-9]{16}-[A-Za-z0-9_-]+\\.data$", options: .regularExpression) != nil else { return false }
      return (try? files.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType) == .typeRegular
    }.sorted { $0.lastPathComponent > $1.lastPathComponent }
  }
  private func selected(_ relative: String, versioned: Bool) throws -> URL? {
    if versioned { return try versions(relative).first }
    let file = try path(relative)
    return files.fileExists(atPath: file.path) ? file : nil
  }

  func read(_ relative: String, versioned: Bool, limit: Int) throws -> Data? {
    Self.io.lock(); defer { Self.io.unlock() }
    guard (1...Self.articleLimit).contains(limit) else { throw SlaxFileStoreError.invalid }
    guard let file = try selected(relative, versioned: versioned) else { return nil }
    let attributes = try files.attributesOfItem(atPath: file.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular, (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= limit else { throw SlaxFileStoreError.oversized }
    let input = try FileHandle(forReadingFrom: file); defer { try? input.close() }
    var result = Data()
    while true {
      try lease.check()
      let chunk = try input.read(upToCount: 64 * 1024) ?? Data()
      if chunk.isEmpty { break }
      guard result.count + chunk.count <= limit else { throw SlaxFileStoreError.oversized }
      result.append(chunk)
    }
    _ = try path(relative); try lease.check(); return result
  }

  func fingerprint(_ relative: String) throws -> [String: Any]? {
    Self.io.lock(); defer { Self.io.unlock() }
    guard let file = try selected(relative, versioned: false) else { return nil }
    let attributes = try files.attributesOfItem(atPath: file.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular, (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= Self.articleLimit else { throw SlaxFileStoreError.oversized }
    let input = try FileHandle(forReadingFrom: file); defer { try? input.close() }
    var hash = SHA256(), size = 0
    while true {
      try lease.check(); let bytes = try input.read(upToCount: 64 * 1024) ?? Data(); if bytes.isEmpty { break }
      size += bytes.count; guard size <= Self.articleLimit else { throw SlaxFileStoreError.oversized }; hash.update(data: bytes)
    }
    _ = try path(relative); try lease.check()
    return ["size": size, "sha256": hash.finalize().map {String(format: "%02x", $0)}.joined()]
  }
  func textFingerprint(_ text: String) throws -> [String: Any] {
    try lease.check(); guard text.utf8.count <= Self.articleLimit else { throw SlaxFileStoreError.oversized }
    let bytes = Data(text.utf8); var hash = SHA256(), offset = 0
    while offset < bytes.count { try lease.check(); let end = min(offset + 64 * 1024, bytes.count); hash.update(data: bytes[offset..<end]); offset = end }
    try lease.check(); return ["size": bytes.count, "sha256": hash.finalize().map {String(format: "%02x", $0)}.joined()]
  }

  func size(_ relative: String, versioned: Bool) throws -> Int64? {
    Self.io.lock(); defer { Self.io.unlock() }
    guard let file = try selected(relative, versioned: versioned) else { return nil }
    let attributes = try files.attributesOfItem(atPath: file.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular, let size = attributes[.size] as? NSNumber else { throw SlaxFileStoreError.unsafe }
    try lease.check(); return size.int64Value
  }

  func write(_ relative: String, bytes: Data, versioned: Bool, beforeCommit: () throws -> Void = {}) throws -> String {
    Self.io.lock(); defer { Self.io.unlock() }
    guard bytes.count <= (versioned ? Self.blockLimit : Self.articleLimit) else { throw SlaxFileStoreError.oversized }
    let previous = versioned ? try versions(relative) : []
    let final: URL
    if versioned {
      let sequence = (previous.first.flatMap { Int64($0.lastPathComponent.prefix(16)) } ?? 0) + 1
      guard (1...9_007_199_254_740_991).contains(sequence) else { throw SlaxFileStoreError.invalid }
      final = try path(relative + ".entries/" + String(format: "%016lld", sequence) + "-" + UUID().uuidString + ".data")
    } else { final = try path(relative) }
    try files.createDirectory(at: final.deletingLastPathComponent(), withIntermediateDirectories: true)
    _ = try path(relative)
    let temporary = final.deletingLastPathComponent().appendingPathComponent(".slax-\(UUID().uuidString).tmp")
    let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw SlaxFileStoreError.io }
    let output = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    var committed = false
    defer { try? output.close(); if !committed { try? files.removeItem(at: temporary) } }
    var offset = 0
    while offset < bytes.count {
      try lease.check(); let end = min(offset + 64 * 1024, bytes.count)
      try output.write(contentsOf: bytes[offset..<end]); offset = end
    }
    try output.synchronize(); try output.close()
    try beforeCommit(); _ = try path(relative)
    try lease.commit {
      guard rename(temporary.path, final.path) == 0 else { throw SlaxFileStoreError.io }
      committed = true
    }
    for old in previous { _ = try path(relative); try lease.commit { try files.removeItem(at: old) } }
    try lease.check(); return final.absoluteString
  }

  func writeStream(_ relative: String, input: FileHandle, expectedBytes: Int64, beforeCommit: () throws -> Void = {}) throws -> String {
    guard (1...Int64(Self.articleLimit)).contains(expectedBytes) else { throw SlaxFileStoreError.oversized }
    let (final, temporary, output): (URL, URL, FileHandle) = try {
      Self.io.lock(); defer { Self.io.unlock() }
      let final = try path(relative)
      try files.createDirectory(at: final.deletingLastPathComponent(), withIntermediateDirectories: true)
      _ = try path(relative)
      let temporary = final.deletingLastPathComponent().appendingPathComponent(".slax-\(UUID().uuidString).tmp")
      let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
      guard descriptor >= 0 else { throw SlaxFileStoreError.io }
      return (final, temporary, FileHandle(fileDescriptor: descriptor, closeOnDealloc: true))
    }()
    var committed = false
    defer { try? output.close(); if !committed { try? files.removeItem(at: temporary) } }
    var received: Int64 = 0
    while true {
      try lease.check()
      let bytes = try input.read(upToCount: 64 * 1024) ?? Data()
      try lease.check(); if bytes.isEmpty { break }
      received += Int64(bytes.count)
      guard received <= expectedBytes else { throw SlaxFileStoreError.oversized }
      try output.write(contentsOf: bytes)
    }
    guard received == expectedBytes else { throw SlaxFileStoreError.invalid }
    try output.synchronize(); try output.close(); try beforeCommit()
    try {
      Self.io.lock(); defer { Self.io.unlock() }
      guard try path(relative) == final else { throw SlaxFileStoreError.unsafe }
      try lease.commit {
        guard rename(temporary.path, final.path) == 0 else { throw SlaxFileStoreError.io }
        committed = true
      }
    }()
    try lease.check(); return final.absoluteString
  }

  func list(_ relative: String, versioned: Bool) throws -> [String] {
    Self.io.lock(); defer { Self.io.unlock() }
    var result: [String] = []
    func visit(_ value: String) throws {
      let file = try path(value)
      guard files.fileExists(atPath: file.path) else { return }
      for child in try files.contentsOfDirectory(at: file, includingPropertiesForKeys: nil) {
        if child.lastPathComponent.hasPrefix(".slax-") { continue }
        let next = value + "/" + child.lastPathComponent; _ = try path(next)
        let type = try files.attributesOfItem(atPath: child.path)[.type] as? FileAttributeType
        if type == .typeDirectory {
          if versioned && child.lastPathComponent.hasSuffix(".entries") {
            let base = String(next.dropLast(8)); if try !versions(base).isEmpty { result.append(base) }
          } else { try visit(next) }
        } else if !versioned && type == .typeRegular { result.append(next) }
        guard result.count <= 100_000 else { throw SlaxFileStoreError.oversized }
      }
    }
    try visit(relative.hasSuffix("/") ? String(relative.dropLast()) : relative)
    try lease.check(); return result
  }

  func measure(_ relative: String) throws -> Int64 {
    Self.io.lock(); defer { Self.io.unlock() }
    var total: Int64 = 0
    func visit(_ value: String) throws {
      let file = try path(value)
      guard files.fileExists(atPath: file.path) else { return }
      let attributes = try files.attributesOfItem(atPath: file.path)
      if attributes[.type] as? FileAttributeType == .typeDirectory {
        for child in try files.contentsOfDirectory(at: file, includingPropertiesForKeys: nil) { if !child.lastPathComponent.hasPrefix(".slax-") { try visit(value + "/" + child.lastPathComponent) } }
      } else {
        guard attributes[.type] as? FileAttributeType == .typeRegular, let size = attributes[.size] as? NSNumber else { throw SlaxFileStoreError.unsafe }
        let sum = total.addingReportingOverflow(size.int64Value); guard !sum.overflow else { throw SlaxFileStoreError.oversized }; total = sum.partialValue
      }
    }
    try visit(relative); try lease.check(); return total
  }

  private func removalPaths(_ relative: String, generation: String) throws -> (URL, URL) {
    guard generation.range(of: "^[A-Za-z0-9_-]{1,100}$", options: .regularExpression) != nil,
      relative.range(of: "^bookmark/[A-Za-z0-9_-]+$", options: .regularExpression) != nil || relative.range(of: "^pdf/v1/[a-f0-9]{64}/[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { throw SlaxFileStoreError.invalid }
    let source = try path(relative), suffix = SHA256.hash(data: Data(relative.utf8)).prefix(8).map {String(format: "%02x", $0)}.joined()
    let receipt = source.deletingLastPathComponent().appendingPathComponent(".slax-evict-\(generation)-\(suffix)")
    guard receipt.path == receipt.resolvingSymlinksInPath().path, (try? files.attributesOfItem(atPath: receipt.path)[.type] as? FileAttributeType) != .typeSymbolicLink else { throw SlaxFileStoreError.unsafe }
    return (source, receipt)
  }
  private func removalMarker(_ relative: String) -> Data { Data("slax-cache-eviction-v1\n\(relative)\n".utf8) }
  private func verifyRemoval(_ relative: String, receipt: URL) throws {
    try lease.check()
    guard (try files.attributesOfItem(atPath: receipt.path)[.type] as? FileAttributeType) == .typeDirectory else { throw SlaxFileStoreError.unsafe }
    let children = try files.contentsOfDirectory(atPath: receipt.path)
    guard children.allSatisfy({ ["intent", "payload"].contains($0) }) else { throw SlaxFileStoreError.invalid }
    let marker = receipt.appendingPathComponent("intent")
    if children.contains("intent") {
      let attributes = try files.attributesOfItem(atPath: marker.path)
      guard attributes[.type] as? FileAttributeType == .typeRegular, (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= 4096 else { throw SlaxFileStoreError.unsafe }
    }
    if children.contains("payload") { guard try Data(contentsOf: marker) == removalMarker(relative) else { throw SlaxFileStoreError.invalid } }
  }
  func stageRemoval(_ relative: String, generation: String, beforeMove: () throws -> Void = {}) throws {
    Self.io.lock(); defer { Self.io.unlock() }
    let (source, receipt) = try removalPaths(relative, generation: generation)
    if files.fileExists(atPath: receipt.path) { try verifyRemoval(relative, receipt: receipt); return }
    try files.createDirectory(at: source.deletingLastPathComponent(), withIntermediateDirectories: true); _ = try path(relative)
    try files.createDirectory(at: receipt, withIntermediateDirectories: false)
    let marker = receipt.appendingPathComponent("intent")
    let descriptor = open(marker.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw SlaxFileStoreError.io }
    let output = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true); defer { try? output.close() }
    try output.write(contentsOf: removalMarker(relative)); try output.synchronize(); try output.close()
    try beforeMove(); _ = try path(relative); try verifyRemoval(relative, receipt: receipt)
    if files.fileExists(atPath: source.path) {
      try lease.commit { guard rename(source.path, receipt.appendingPathComponent("payload").path) == 0 else { throw SlaxFileStoreError.io } }
    }
  }
  func restoreRemoval(_ relative: String, generation: String) throws {
    let receipt: URL? = try {
      Self.io.lock(); defer { Self.io.unlock() }
      let (_, receipt) = try removalPaths(relative, generation: generation)
      guard files.fileExists(atPath: receipt.path) else { return nil }; try verifyRemoval(relative, receipt: receipt); return receipt
    }()
    guard let receipt else { return }
    func restore(_ from: URL, to: URL, depth: Int) throws {
      let descend: Bool = try {
        Self.io.lock(); defer { Self.io.unlock() }
        try lease.check(); _ = try path(relative)
        guard depth <= 64, from.path == from.resolvingSymlinksInPath().path, to.path == to.resolvingSymlinksInPath().path,
          (try? files.attributesOfItem(atPath: from.path)[.type] as? FileAttributeType) != .typeSymbolicLink,
          (try? files.attributesOfItem(atPath: to.path)[.type] as? FileAttributeType) != .typeSymbolicLink else { throw SlaxFileStoreError.unsafe }
        guard files.fileExists(atPath: from.path) else { return false }
        if !files.fileExists(atPath: to.path) {
          try lease.commit { guard rename(from.path, to.path) == 0 else { throw SlaxFileStoreError.io } }; return false
        }
        let fromType = try files.attributesOfItem(atPath: from.path)[.type] as? FileAttributeType
        let toType = try files.attributesOfItem(atPath: to.path)[.type] as? FileAttributeType
        return fromType == .typeDirectory && toType == .typeDirectory && !to.lastPathComponent.hasSuffix(".entries")
      }()
      if descend {
        for child in try files.contentsOfDirectory(at: from, includingPropertiesForKeys: nil) where !child.lastPathComponent.hasPrefix(".slax-") {
          try restore(child, to: to.appendingPathComponent(child.lastPathComponent), depth: depth + 1)
        }
      }
    }
    try restore(receipt.appendingPathComponent("payload"), to: path(relative), depth: 0)
    try purgeRemoval(relative, generation: generation)
  }
  func purgeRemoval(_ relative: String, generation: String) throws {
    let receipt: URL? = try {
      Self.io.lock(); defer { Self.io.unlock() }
      let (_, receipt) = try removalPaths(relative, generation: generation)
      guard files.fileExists(atPath: receipt.path) else { return nil }; try verifyRemoval(relative, receipt: receipt); return receipt
    }()
    guard let receipt else { return }
    func erase(_ file: URL) throws {
      try lease.check()
      let attributes = try files.attributesOfItem(atPath: file.path)
      if attributes[.type] as? FileAttributeType == .typeDirectory {
        for child in try files.contentsOfDirectory(at: file, includingPropertiesForKeys: nil) { try erase(child) }
      }
      try lease.commit { try files.removeItem(at: file) }
    }
    let payload = receipt.appendingPathComponent("payload")
    if (try? files.attributesOfItem(atPath: payload.path)) != nil { try erase(payload) }
    try {
      Self.io.lock(); defer { Self.io.unlock() }; try verifyRemoval(relative, receipt: receipt)
      try lease.commit {
        let marker = receipt.appendingPathComponent("intent"); if files.fileExists(atPath: marker.path) { try files.removeItem(at: marker) }
        try files.removeItem(at: receipt)
      }
    }()
  }

  func remove(_ relative: String, versioned: Bool) throws {
    let trash: URL? = try {
      Self.io.lock(); defer { Self.io.unlock() }
      let file = try path(versioned ? relative + ".entries" : relative)
      guard files.fileExists(atPath: file.path) else { return nil }
      let target = file.deletingLastPathComponent().appendingPathComponent(".slax-delete-\(UUID().uuidString)")
      try lease.commit { guard rename(file.path, target.path) == 0 else { throw SlaxFileStoreError.io } }
      return target
    }()
    if let trash { try files.removeItem(at: trash) }
  }
}
