import CryptoKit
import Darwin
import ExpoModulesCore
import Foundation

public final class SlaxLegacyModule: Module {
  private var ownerDescriptor: Int32 = -1
  private var databaseCandidates = Set<String>()
  private static let preferencesMutex = NSLock()
  private static let ownerMutex = NSLock()
  private func sharedDirectory() throws -> URL {
    guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.slax.reader") else {
      throw NSError(domain: "SlaxLegacy", code: 1, userInfo: [NSLocalizedDescriptionKey: "Shared application container is unavailable"])
    }
    return url
  }
  private func withPreferencesLock<T>(_ operation: (URL) throws -> T) throws -> T {
    Self.preferencesMutex.lock(); defer { Self.preferencesMutex.unlock() }
    let root = try sharedDirectory()
    let descriptor = open(root.appendingPathComponent(".slax-preferences.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
    defer { flock(descriptor, LOCK_UN); close(descriptor) }
    guard flock(descriptor, LOCK_EX) == 0 else { throw CocoaError(.fileWriteUnknown) }
    return try operation(root)
  }
  private func readSnapshot(_ root: URL) throws -> [String: Any] {
    let file = root.appendingPathComponent("slax.preferences.v1.json")
    if !FileManager.default.fileExists(atPath: file.path) { return ["revision": 0, "values": [String: Any]()] }
    guard let snapshot = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any], snapshot["revision"] is NSNumber, snapshot["values"] is [String: Any] else { throw CocoaError(.fileReadCorruptFile) }
    return snapshot
  }
  private func releaseOwner() {
    Self.ownerMutex.lock(); defer { Self.ownerMutex.unlock() }
    if ownerDescriptor >= 0 { flock(ownerDescriptor, LOCK_UN); close(ownerDescriptor); ownerDescriptor = -1 }
    databaseCandidates = []
  }
  public func definition() -> ModuleDefinition {
    Name("SlaxLegacy")
    Function("newIdentifier") { UUID().uuidString.lowercased() }
    Function("md5String") { (value: String) in Insecure.MD5.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }
    AsyncFunction("readPreferences") { () -> [String: Any] in try self.withPreferencesLock { try self.readSnapshot($0) } }
    AsyncFunction("compareAndSwapPreferences") { (revision: Int, values: [String: Any]) -> Bool in
      try self.withPreferencesLock { root in
        let current = try self.readSnapshot(root)
        guard (current["revision"] as? NSNumber)?.intValue == revision else { return false }
        let next: [String: Any] = ["revision": revision + 1, "values": values]
        let data = try JSONSerialization.data(withJSONObject: next, options: [.sortedKeys])
        try data.write(to: root.appendingPathComponent("slax.preferences.v1.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return true
      }
    }
    AsyncFunction("readLegacyPreferences") { () -> [String: Any]? in
      let source = try self.sharedDirectory().appendingPathComponent("user.preferences_pb")
      if !FileManager.default.fileExists(atPath: source.path) { return nil }
      let data = try Data(contentsOf: source)
      return ["bytes": Array(data), "fingerprint": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()]
    }
    AsyncFunction("beginDataOwnership") { () -> [String: Any] in
      let shared = try self.sharedDirectory()
      Self.ownerMutex.lock()
      guard self.ownerDescriptor < 0 else { Self.ownerMutex.unlock(); throw CocoaError(.fileLocking) }
      let descriptor = open(shared.appendingPathComponent(".slax-data-owner.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
      guard descriptor >= 0, flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { if descriptor >= 0 { close(descriptor) }; Self.ownerMutex.unlock(); throw CocoaError(.fileLocking) }
      self.ownerDescriptor = descriptor
      Self.ownerMutex.unlock()
      do {
        let manager = FileManager.default
        let support = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).resolvingSymlinksInPath()
        let newDirectory = support.appendingPathComponent("slax-react-native", isDirectory: true)
        let library = try manager.url(for: .libraryDirectory, in: .userDomainMask, appropriateFor: nil, create: false).resolvingSymlinksInPath()
        let documents = try manager.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: false).resolvingSymlinksInPath()
        var candidates: [String] = []
        var scanError: Error?
        for root in [library, documents, shared.resolvingSymlinksInPath()] {
          guard let enumerator = manager.enumerator(at: root, includingPropertiesForKeys: [.isSymbolicLinkKey, .isDirectoryKey], options: [], errorHandler: { _, error in scanError = error; return false }) else { throw CocoaError(.fileReadUnknown) }
          for case let file as URL in enumerator {
            let values = try file.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
            if values.isSymbolicLink == true || file.standardizedFileURL == newDirectory.standardizedFileURL { enumerator.skipDescendants(); continue }
            if values.isDirectory != true && file.lastPathComponent == "powersync.db" { candidates.append(file.resolvingSymlinksInPath().path) }
          }
          if let error = scanError { throw error }
        }
        try manager.createDirectory(at: newDirectory, withIntermediateDirectories: true)
        Self.ownerMutex.lock(); self.databaseCandidates = Set(candidates); Self.ownerMutex.unlock()
        return ["scanComplete": true, "databaseCandidates": Array(Set(candidates)).sorted(), "legacyDataDirectory": support.path, "newDatabaseDirectory": newDirectory.path,
                "databaseIdentities": legacyDatabaseIdentities(Array(Set(candidates)), support: support, shared: shared, bundleIdentifier: Bundle.main.bundleIdentifier ?? "unknown")]
      } catch { self.releaseOwner(); throw error }
    }
    AsyncFunction("endDataOwnership") { self.releaseOwner() }
    AsyncFunction("inspectLegacyDatabase") { (path: String) -> [String: Any] in
      Self.ownerMutex.lock(); defer { Self.ownerMutex.unlock() }
      guard self.ownerDescriptor >= 0, self.databaseCandidates.contains(path), URL(fileURLWithPath: path).resolvingSymlinksInPath().path == path else { throw CocoaError(.fileLocking) }
      return try inspectPowerSyncDatabase(path)
    }
    OnDestroy { self.releaseOwner() }
  }
}
