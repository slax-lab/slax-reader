import Foundation
import Darwin

enum SlaxStorageOwner {
  private static let lock = NSLock()
  private static var owner: String?
  private static var epoch: UInt64 = 0
  private static var observers: [UUID: (String?) -> Void] = [:]
  static func activate(_ value: String?) throws {
    lock.lock()
    guard value == nil || value!.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { lock.unlock(); throw SlaxFileStoreError.invalid }
    epoch &+= 1; owner = value
    let notify = Array(observers.values)
    lock.unlock()
    notify.forEach { $0(value) }
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
  static func observe(_ observer: @escaping (String?) -> Void) -> UUID {
    lock.lock(); defer { lock.unlock() }
    let id = UUID(); observers[id] = observer; return id
  }
  static func unobserve(_ id: UUID) { lock.lock(); observers.removeValue(forKey: id); lock.unlock() }
}

final class SlaxStorageLease {
  let owner: String?
  let epoch: UInt64
  private let parent: SlaxStorageLease?
  private let lock = NSLock()
  private var cancelled = false
  init(owner: String?, epoch: UInt64, parent: SlaxStorageLease? = nil) { self.owner = owner; self.epoch = epoch; self.parent = parent }
  /// A lease that can be cancelled independently and is also cancelled with this one.
  func child() -> SlaxStorageLease { SlaxStorageLease(owner: owner, epoch: epoch, parent: self) }
  func cancel() { lock.lock(); cancelled = true; lock.unlock() }
  func check() throws { try commit {} }
  func commit<T>(_ work: () throws -> T) throws -> T {
    lock.lock(); defer { lock.unlock() }
    guard !cancelled else { throw SlaxFileStoreError.revoked }
    try parent?.check()
    return try SlaxStorageOwner.current(owner, epoch: epoch, work)
  }
}

enum SlaxFileStoreError: Error { case invalid, revoked, unsafe, oversized, io }

final class SlaxFileStore {
  static let articleLimit = 20 * 1024 * 1024
  static let markerName = "offline-engine.json"
  private static let io = NSRecursiveLock()
  private let root: URL
  private let pdfRoot: URL
  let lease: SlaxStorageLease
  private let files = FileManager.default

  init(root: URL, pdfRoot: URL, lease: SlaxStorageLease) { self.root = root; self.pdfRoot = pdfRoot; self.lease = lease }

  private func type(_ url: URL) -> FileAttributeType? { try? files.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType }
  func resolve(_ relative: String) throws -> URL {
    try lease.check()
    let parts = relative.components(separatedBy: "/")
    guard parts.count <= 64, relative.utf8.count <= 4096, let first = parts.first, ["bookmark", "pdf"].contains(first), parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.unicodeScalars.contains { $0.value <= 31 || $0.value == 127 || $0.value == 92 } }),
      first != "pdf" || parts.allSatisfy({ $0.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil }),
      first != "bookmark" || parts.count == 1 || parts[1].range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { throw SlaxFileStoreError.invalid }
    var current = first == "pdf" ? pdfRoot : root
    guard current.isFileURL, current.resolvingSymlinksInPath().path == current.path else { throw SlaxFileStoreError.unsafe }
    for part in parts {
      current.appendPathComponent(part)
      guard current.resolvingSymlinksInPath().path == current.path, type(current) != .typeSymbolicLink else { throw SlaxFileStoreError.unsafe }
    }
    return current
  }
  private func marker() throws -> URL {
    try lease.check()
    guard root.isFileURL, root.resolvingSymlinksInPath().path == root.path else { throw SlaxFileStoreError.unsafe }
    let file = root.appendingPathComponent(Self.markerName)
    guard file.resolvingSymlinksInPath().path == file.path, type(file) != .typeSymbolicLink else { throw SlaxFileStoreError.unsafe }
    return file
  }
  private func existing(_ relative: String) throws -> URL? {
    let file = try resolve(relative)
    return files.fileExists(atPath: file.path) ? file : nil
  }
  private func bounded(_ file: URL, limit: Int, recheck: () throws -> Void) throws -> Data {
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
    try recheck(); try lease.check(); return result
  }

  func read(_ relative: String, limit: Int) throws -> Data? {
    Self.io.lock(); defer { Self.io.unlock() }
    guard (1...Self.articleLimit).contains(limit) else { throw SlaxFileStoreError.invalid }
    guard let file = try existing(relative) else { return nil }
    return try bounded(file, limit: limit) { _ = try resolve(relative) }
  }
  func readMarker() throws -> Data? {
    Self.io.lock(); defer { Self.io.unlock() }
    let file = try marker()
    guard files.fileExists(atPath: file.path) else { return nil }
    return try bounded(file, limit: 4096) { _ = try marker() }
  }
  func readRange(_ relative: String, offset: Int64, length: Int) throws -> Data? {
    guard offset >= 0, (1...4 * 1024 * 1024).contains(length) else { throw SlaxFileStoreError.invalid }
    let file: URL = try {
      Self.io.lock(); defer { Self.io.unlock() }
      return try resolve(relative)
    }()
    guard type(file) == .typeRegular else { return nil }
    let input = try FileHandle(forReadingFrom: file); defer { try? input.close() }
    try input.seek(toOffset: UInt64(offset))
    let bytes = try input.read(upToCount: length) ?? Data()
    try lease.check()
    return bytes.count == length ? bytes : nil
  }

  func size(_ relative: String) throws -> Int64? {
    Self.io.lock(); defer { Self.io.unlock() }
    guard let file = try existing(relative) else { return nil }
    let attributes = try files.attributesOfItem(atPath: file.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular, let size = attributes[.size] as? NSNumber else { throw SlaxFileStoreError.unsafe }
    try lease.check(); return size.int64Value
  }

  private func commitTemporary(_ final: URL, revalidate: () throws -> URL, fill: (FileHandle) throws -> Void, beforeCommit: () throws -> Void) throws {
    try lease.check()
    try files.createDirectory(at: final.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard try revalidate() == final else { throw SlaxFileStoreError.unsafe }
    let temporary = final.deletingLastPathComponent().appendingPathComponent(".slax-\(UUID().uuidString).tmp")
    let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw SlaxFileStoreError.io }
    let output = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    var committed = false
    defer { try? output.close(); if !committed { try? files.removeItem(at: temporary) } }
    try fill(output)
    try output.synchronize(); try output.close()
    try beforeCommit()
    guard try revalidate() == final else { throw SlaxFileStoreError.unsafe }
    try lease.commit {
      guard rename(temporary.path, final.path) == 0 else { throw SlaxFileStoreError.io }
      committed = true
    }
  }
  private func filler(_ bytes: Data) -> (FileHandle) throws -> Void {
    { output in
      var offset = 0
      while offset < bytes.count {
        try self.lease.check(); let end = min(offset + 64 * 1024, bytes.count)
        try output.write(contentsOf: bytes[offset..<end]); offset = end
      }
    }
  }

  func write(_ relative: String, bytes: Data, beforeCommit: () throws -> Void = {}) throws -> String {
    Self.io.lock(); defer { Self.io.unlock() }
    guard bytes.count <= Self.articleLimit else { throw SlaxFileStoreError.oversized }
    let final = try resolve(relative)
    try commitTemporary(final, revalidate: { try resolve(relative) }, fill: filler(bytes), beforeCommit: beforeCommit)
    try lease.check(); return final.absoluteString
  }
  func writeMarker(_ bytes: Data) throws {
    Self.io.lock(); defer { Self.io.unlock() }
    guard bytes.count <= 4096 else { throw SlaxFileStoreError.oversized }
    try commitTemporary(try marker(), revalidate: { try marker() }, fill: filler(bytes), beforeCommit: {})
  }

  /// Opens a temporary sibling of `relative`; bytes become visible only when the stream commits under the lease.
  func stream(_ relative: String) throws -> SlaxFileStream {
    Self.io.lock(); defer { Self.io.unlock() }
    let final = try resolve(relative)
    try files.createDirectory(at: final.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard try resolve(relative) == final else { throw SlaxFileStoreError.unsafe }
    let temporary = final.deletingLastPathComponent().appendingPathComponent(".slax-\(UUID().uuidString).tmp")
    let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw SlaxFileStoreError.io }
    return SlaxFileStream(final: final, temporary: temporary, output: FileHandle(fileDescriptor: descriptor, closeOnDealloc: true), lease: lease) {
      Self.io.lock(); defer { Self.io.unlock() }
      return try self.resolve(relative)
    }
  }

  func writeStream(_ relative: String, input: FileHandle, expectedBytes: Int64, beforeCommit: () throws -> Void = {}) throws -> String {
    guard (1...Int64(Self.articleLimit)).contains(expectedBytes) else { throw SlaxFileStoreError.oversized }
    let output = try stream(relative)
    defer { output.abort() }
    while true {
      try lease.check()
      let bytes = try input.read(upToCount: 64 * 1024) ?? Data()
      try lease.check(); if bytes.isEmpty { break }
      guard output.written + Int64(bytes.count) <= expectedBytes else { throw SlaxFileStoreError.oversized }
      try output.write(bytes)
    }
    guard output.written == expectedBytes else { throw SlaxFileStoreError.invalid }
    try beforeCommit()
    return try output.commit()
  }

  /// Appends to a resumable file under the lease, truncating any uncommitted tail first.
  func append(_ relative: String, at offset: Int64, bytes: Data) throws {
    Self.io.lock(); defer { Self.io.unlock() }
    let file = try resolve(relative)
    try files.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard try resolve(relative) == file else { throw SlaxFileStoreError.unsafe }
    try lease.commit {
      let descriptor = open(file.path, O_WRONLY | O_CREAT | O_NOFOLLOW, S_IRUSR | S_IWUSR)
      guard descriptor >= 0 else { throw SlaxFileStoreError.io }
      let output = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true); defer { try? output.close() }
      try output.truncate(atOffset: UInt64(offset)); try output.seek(toOffset: UInt64(offset))
      try output.write(contentsOf: bytes); try output.synchronize()
    }
  }
  func move(_ from: String, to: String) throws {
    Self.io.lock(); defer { Self.io.unlock() }
    let source = try resolve(from), target = try resolve(to)
    try lease.commit { guard rename(source.path, target.path) == 0 else { throw SlaxFileStoreError.io } }
  }

  func list(_ relative: String) throws -> [String] {
    Self.io.lock(); defer { Self.io.unlock() }
    var result: [String] = []
    func visit(_ value: String) throws {
      let file = try resolve(value)
      guard files.fileExists(atPath: file.path) else { return }
      for child in try files.contentsOfDirectory(at: file, includingPropertiesForKeys: nil) {
        if child.lastPathComponent.hasPrefix(".slax-") { continue }
        let next = value + "/" + child.lastPathComponent; _ = try resolve(next)
        let kind = type(child)
        if kind == .typeDirectory { try visit(next) } else if kind == .typeRegular { result.append(next) }
        guard result.count <= 100_000 else { throw SlaxFileStoreError.oversized }
      }
    }
    try visit(relative.hasSuffix("/") ? String(relative.dropLast()) : relative)
    try lease.check(); return result
  }
  /// Immediate subdirectory names, skipping staging entries and names outside the path grammar.
  func directories(_ relative: String) throws -> [String] {
    Self.io.lock(); defer { Self.io.unlock() }
    let file = try resolve(relative)
    guard type(file) == .typeDirectory else { return [] }
    let names = try files.contentsOfDirectory(atPath: file.path).filter { !$0.hasPrefix(".slax-") }.sorted()
    guard names.count <= 100_000 else { throw SlaxFileStoreError.oversized }
    return names.filter { name in (try? resolve(relative + "/" + name)).map { type($0) == .typeDirectory } ?? false }
  }
  /// Deletes leftover staging entries (`.slax-*`) in one directory and returns the keys named by eviction receipts.
  func purgeStaging(_ relative: String) throws -> [String] {
    let directory: URL = try {
      Self.io.lock(); defer { Self.io.unlock() }
      return try resolve(relative)
    }()
    guard type(directory) == .typeDirectory else { return [] }
    var keys: [String] = []
    for name in try files.contentsOfDirectory(atPath: directory.path) where name.hasPrefix(".slax-") {
      try lease.check()
      let entry = directory.appendingPathComponent(name)
      if type(entry) == .typeSymbolicLink { try lease.commit { try files.removeItem(at: entry) }; continue }
      guard entry.resolvingSymlinksInPath().path == entry.path else { continue }
      if name.hasPrefix(".slax-evict-"), type(entry) == .typeDirectory {
        let intent = entry.appendingPathComponent("intent")
        if type(intent) == .typeRegular, (try? files.attributesOfItem(atPath: intent.path)[.size] as? NSNumber)?.intValue ?? Int.max <= 4096,
          let text = try? String(contentsOf: intent, encoding: .utf8) {
          let lines = text.components(separatedBy: "\n")
          if lines.count >= 2, lines[0] == "slax-cache-eviction-v1", let key = lines[1].components(separatedBy: "/").last,
            key.range(of: "^[A-Za-z0-9_-]{1,512}$", options: .regularExpression) != nil { keys.append(key) }
        }
      }
      if name.hasPrefix(".slax-delete-") { try lease.commit { try files.removeItem(at: entry) }; continue }
      let trash = directory.appendingPathComponent(".slax-delete-\(UUID().uuidString)")
      try lease.commit { guard rename(entry.path, trash.path) == 0 else { throw SlaxFileStoreError.io } }
      try files.removeItem(at: trash)
    }
    try lease.check(); return keys
  }

  func measure(_ relative: String) throws -> Int64 {
    Self.io.lock(); defer { Self.io.unlock() }
    var total: Int64 = 0
    func visit(_ value: String) throws {
      let file = try resolve(value)
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

  @discardableResult func remove(_ relative: String) throws -> Bool {
    let trash: URL? = try {
      Self.io.lock(); defer { Self.io.unlock() }
      let file = try resolve(relative)
      guard files.fileExists(atPath: file.path) else { return nil }
      let target = file.deletingLastPathComponent().appendingPathComponent(".slax-delete-\(UUID().uuidString)")
      try lease.commit { guard rename(file.path, target.path) == 0 else { throw SlaxFileStoreError.io } }
      return target
    }()
    if let trash { try files.removeItem(at: trash); return true }
    return false
  }
}

final class SlaxFileStream {
  private let final: URL
  private let temporary: URL
  private let output: FileHandle
  private let lease: SlaxStorageLease
  private let revalidate: () throws -> URL
  private var finished = false
  private(set) var written: Int64 = 0
  init(final: URL, temporary: URL, output: FileHandle, lease: SlaxStorageLease, revalidate: @escaping () throws -> URL) {
    self.final = final; self.temporary = temporary; self.output = output; self.lease = lease; self.revalidate = revalidate
  }
  func write(_ bytes: Data) throws {
    guard !finished else { throw SlaxFileStoreError.invalid }
    try lease.check(); try output.write(contentsOf: bytes); written += Int64(bytes.count)
  }
  func commit() throws -> String {
    guard !finished else { throw SlaxFileStoreError.invalid }
    try output.synchronize(); try output.close()
    guard try revalidate() == final else { throw SlaxFileStoreError.unsafe }
    try lease.commit {
      guard rename(temporary.path, final.path) == 0 else { throw SlaxFileStoreError.io }
      finished = true
    }
    try lease.check(); return final.absoluteString
  }
  func abort() {
    guard !finished else { return }
    finished = true; try? output.close(); try? FileManager.default.removeItem(at: temporary)
  }
}
