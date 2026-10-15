import CryptoKit
import Darwin
import ExpoModulesCore
import Foundation

public final class SlaxLegacyModule: Module {
  private let owner = StorageOwner()
  private var ownsData = false
  private let transition = StorageTransition()
  private var databaseCandidates = Set<String>()
  private static let preferencesMutex = NSLock()
  private static let ownerMutex = NSLock()
  private func sharedDirectory() throws -> URL {
    guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.slax.reader") else {
      throw NSError(domain: "SlaxLegacy", code: 1, userInfo: [NSLocalizedDescriptionKey: "Shared application container is unavailable"])
    }
    return url
  }
  private func withPreferencesLock<T>(_ operation: (URL, StorageActivity) throws -> T) throws -> T {
    let activity = try StorageActivity(name: "Slax shared preferences")
    defer { activity.finish() }
    Self.preferencesMutex.lock(); defer { Self.preferencesMutex.unlock() }
    try activity.check()
    let root = try sharedDirectory()
    let descriptor = open(root.appendingPathComponent(".slax-preferences.lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
    defer { flock(descriptor, LOCK_UN); close(descriptor) }
    let deadline = ProcessInfo.processInfo.systemUptime + 0.25
    while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
      guard errno == EWOULDBLOCK, ProcessInfo.processInfo.systemUptime < deadline else { throw CocoaError(.fileLocking) }
      try activity.check()
      Thread.sleep(forTimeInterval: 0.005)
    }
    try activity.check()
    return try operation(root, activity)
  }
  private func readSnapshot(_ root: URL) throws -> [String: Any] {
    let file = root.appendingPathComponent("slax.preferences.v1.json")
    if !FileManager.default.fileExists(atPath: file.path) { return ["revision": 0, "values": [String: Any]()] }
    guard let snapshot = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any], snapshot["revision"] is NSNumber, snapshot["values"] is [String: Any] else { throw CocoaError(.fileReadCorruptFile) }
    return snapshot
  }
  private func releaseOwner() {
    Self.ownerMutex.lock(); defer { Self.ownerMutex.unlock() }
    owner.release(); ownsData = false
    databaseCandidates = []
  }
  public func definition() -> ModuleDefinition {
    Name("SlaxLegacy")
    Function("newIdentifier") { UUID().uuidString.lowercased() }
    Function("md5String") { (value: String) in Insecure.MD5.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }
    AsyncFunction("readPreferences") { () -> [String: Any] in try self.withPreferencesLock { root, _ in try self.readSnapshot(root) } }
    AsyncFunction("compareAndSwapPreferences") { (revision: Int, values: [String: Any]) -> Bool in
      try self.withPreferencesLock { root, activity in
        let current = try self.readSnapshot(root)
        guard (current["revision"] as? NSNumber)?.intValue == revision else { return false }
        let next: [String: Any] = ["revision": revision + 1, "values": values]
        let data = try JSONSerialization.data(withJSONObject: next, options: [.sortedKeys])
        try activity.check()
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
      guard Bundle.main.bundleIdentifier == "app.slax.reader" else { throw CocoaError(.fileReadNoPermission) }
      let shared = try self.sharedDirectory()
      try self.owner.acquire()
      Self.ownerMutex.lock(); self.ownsData = true; Self.ownerMutex.unlock()
      do {
        let manager = FileManager.default
        let support = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).resolvingSymlinksInPath()
        let newDirectory = support.appendingPathComponent("slax-react-native", isDirectory: true)
        let library = try manager.url(for: .libraryDirectory, in: .userDomainMask, appropriateFor: nil, create: false).resolvingSymlinksInPath()
        let documents = try manager.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: false).resolvingSymlinksInPath()
        let values = try self.withPreferencesLock { root, _ in try self.readSnapshot(root)["values"] as? [String: Any] ?? [:] }
        let cancellation = DatabaseInspectionCancellation()
        let activity = try StorageActivity(name: "Slax database inventory", cancel: { cancellation.cancelAndDrain() })
        defer { activity.finish() }
        let initialized = try initializedDatabaseCandidate(values: values, support: support, shared: shared, bundleIdentifier: "app.slax.reader")
        let accepted = initialized == nil ? acceptedDatabaseCandidate(values: values, support: support, shared: shared, bundleIdentifier: "app.slax.reader", cancellation: cancellation) : nil
        try activity.check()
        var candidates: [String] = initialized.map { $0.mode == "adopted" ? [$0.path] : [] } ?? accepted.map { [$0] } ?? []
        var scanError: Error?
        for root in initialized == nil && accepted == nil ? [library, documents, shared.resolvingSymlinksInPath()] : [] {
          guard let enumerator = manager.enumerator(at: root, includingPropertiesForKeys: [.isSymbolicLinkKey, .isDirectoryKey], options: [], errorHandler: { _, error in scanError = error; return false }) else { throw CocoaError(.fileReadUnknown) }
          for case let file as URL in enumerator {
            try activity.check()
            let values = try file.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
            if values.isSymbolicLink == true || file.standardizedFileURL == newDirectory.standardizedFileURL { enumerator.skipDescendants(); continue }
            if values.isDirectory != true && file.lastPathComponent == "powersync.db" { candidates.append(file.resolvingSymlinksInPath().path) }
          }
          if let error = scanError { throw error }
        }
        try manager.createDirectory(at: newDirectory, withIntermediateDirectories: true)
        let allowed = Array(Set(candidates + [newDirectory.appendingPathComponent("powersync.db").path]))
        Self.ownerMutex.lock(); self.databaseCandidates = Set(allowed); Self.ownerMutex.unlock()
        var inventory: [String: Any] = ["scanComplete": true, "databaseCandidates": Array(Set(candidates)).sorted(), "legacyDataDirectory": support.path, "newDatabaseDirectory": newDirectory.path,
                "databaseIdentities": legacyDatabaseIdentities(allowed, support: support, shared: shared, bundleIdentifier: "app.slax.reader")]
        if let initialized { inventory["initializedDatabase"] = ["path": initialized.path, "mode": initialized.mode] }
        return inventory
      } catch { self.releaseOwner(); throw error }
    }
    AsyncFunction("endDataOwnership") { self.releaseOwner() }
    AsyncFunction("inspectLegacyDatabase") { (path: String) -> [String: Any] in
      let cancellation = DatabaseInspectionCancellation()
      let activity = try StorageActivity(name: "Slax database verification", cancel: { cancellation.cancelAndDrain() })
      defer { activity.finish() }
      Self.ownerMutex.lock(); defer { Self.ownerMutex.unlock() }
      guard self.ownsData, self.databaseCandidates.contains(path), path.hasPrefix(URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().path + "/"), URL(fileURLWithPath: path).resolvingSymlinksInPath().path == path else { throw CocoaError(.fileLocking) }
      try activity.check()
      return try inspectPowerSyncDatabase(path, cancellation: cancellation)
    }
    AsyncFunction("inspectAcceptedDatabase") { (path: String) -> [String: Any] in
      let cancellation = DatabaseInspectionCancellation()
      let activity = try StorageActivity(name: "Slax database schema", cancel: { cancellation.cancelAndDrain() })
      defer { activity.finish() }
      Self.ownerMutex.lock(); defer { Self.ownerMutex.unlock() }
      guard self.ownsData, self.databaseCandidates.contains(path), path.hasPrefix(URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().path + "/"), URL(fileURLWithPath: path).resolvingSymlinksInPath().path == path else { throw CocoaError(.fileLocking) }
      try activity.check()
      return try inspectAcceptedPowerSyncDatabase(path, cancellation: cancellation)
    }
    Function("beginStorageTransition") { try self.transition.begin() }
    Function("checkStorageTransition") { (token: Int) in try self.transition.check(token) }
    AsyncFunction("endStorageTransition") { (token: Int) in self.transition.finish(token) }.runOnQueue(.main)
    OnCreate { self.transition.observe() }
    OnDestroy { self.transition.stopObserving(); self.releaseOwner() }
  }
}
