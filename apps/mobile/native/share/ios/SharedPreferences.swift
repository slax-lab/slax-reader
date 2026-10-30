import Darwin
import Foundation

/// Shared read contract with SlaxLegacy. A new signed-out store never falls back to stale legacy authentication.
enum SharedPreferences {
  static func read() throws -> [String: Any] { try read(report: { _, _ in }) }
  static func read(report: (String, String?) -> Void) throws -> [String: Any] {
    var store = "none"
    do {
      guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.slax.reader") else { throw CocoaError(.fileReadNoPermission) }
      let descriptor = open(root.appendingPathComponent(".slax-preferences.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
      guard descriptor >= 0 else { throw CocoaError(.fileReadUnknown) }
      defer { flock(descriptor, LOCK_UN); close(descriptor) }
      guard flock(descriptor, LOCK_SH) == 0 else { throw CocoaError(.fileReadUnknown) }
      let current = root.appendingPathComponent("slax.preferences.v1.json")
      if FileManager.default.fileExists(atPath: current.path) {
        store = "v1"
        guard let json = try JSONSerialization.jsonObject(with: Data(contentsOf: current)) as? [String: Any], let values = json["values"] as? [String: Any] else { throw CocoaError(.fileReadCorruptFile) }
        report(store, nil); return values
      }
      let original = root.appendingPathComponent("user.preferences_pb")
      if !FileManager.default.fileExists(atPath: original.path) { report(store, nil); return [:] }
      store = "legacy"
      let values = try LegacyStringPreferences.decode(Data(contentsOf: original))
      report(store, nil); return values
    } catch { report(store, String(describing: type(of: error))); throw error }
  }
}

/// Only reads string entries needed by the standalone extension; it never rewrites protobuf bytes.
enum LegacyStringPreferences {
  private struct Reader {
    let bytes: [UInt8]
    var offset = 0
    var done: Bool { offset == bytes.count }
    mutating func integer() throws -> UInt64 {
      var result: UInt64 = 0
      for shift in stride(from: 0, through: 63, by: 7) {
        guard offset < bytes.count else { throw CocoaError(.fileReadCorruptFile) }
        let byte = bytes[offset]; offset += 1
        result |= UInt64(byte & 127) << shift
        if byte & 128 == 0 { return result }
      }
      throw CocoaError(.fileReadCorruptFile)
    }
    mutating func data() throws -> [UInt8] {
      let count = try integer()
      guard count <= UInt64(bytes.count - offset) else { throw CocoaError(.fileReadCorruptFile) }
      let end = offset + Int(count), value = Array(bytes[offset..<end]); offset = end; return value
    }
    mutating func skip(_ wire: UInt64) throws {
      switch wire {
      case 0: _ = try integer()
      case 2: _ = try data()
      case 1, 5: offset += wire == 1 ? 8 : 4; if offset > bytes.count { throw CocoaError(.fileReadCorruptFile) }
      default: throw CocoaError(.fileReadCorruptFile)
      }
    }
  }
  static func decode(_ data: Data) throws -> [String: String] {
    var root = Reader(bytes: Array(data)), result: [String: String] = [:]
    while !root.done {
      let tag = try root.integer()
      guard tag == 10 else { try root.skip(tag & 7); continue }
      var entry = Reader(bytes: try root.data())
      var key: String?, value: String?
      while !entry.done {
        let field = try entry.integer()
        if field == 10 { key = String(bytes: try entry.data(), encoding: .utf8) }
        else if field == 18 {
          var nested = Reader(bytes: try entry.data())
          while !nested.done {
            let nestedTag = try nested.integer()
            if nestedTag == 42 { value = String(bytes: try nested.data(), encoding: .utf8) }
            else { try nested.skip(nestedTag & 7) }
          }
        } else { try entry.skip(field & 7) }
      }
      if let key, let value { result[key] = value }
    }
    return result
  }
}
