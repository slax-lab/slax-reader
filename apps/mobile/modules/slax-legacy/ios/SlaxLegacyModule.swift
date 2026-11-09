import CryptoKit
import Darwin
import ExpoModulesCore
import Foundation

public final class SlaxLegacyModule: Module {
  private let owner = StorageOwner()
  private var ownsData = false
  private let transition = StorageTransition()
  private var reset: LegacyReset?
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
    let bytes = try Data(contentsOf: file)
    if let snapshot = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any], snapshot["revision"] is NSNumber, snapshot["values"] is [String: Any] { return snapshot }
    guard FileManager.default.fileExists(atPath: root.appendingPathComponent(".slax-legacy-reset").path) else { throw CocoaError(.fileReadCorruptFile) }
    return ["revision": 0, "values": ["_slax_sign_out_pending_v1": true]]
  }
  private func releaseOwner() {
    Self.ownerMutex.lock(); defer { Self.ownerMutex.unlock() }
    owner.release(); ownsData = false; reset = nil
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
      return ["bytes": Array(try Data(contentsOf: source))]
    }
    AsyncFunction("beginDataOwnership") { () -> [String: Any] in
      guard Bundle.main.bundleIdentifier == "app.slax.reader" else { throw CocoaError(.fileReadNoPermission) }
      try self.owner.acquire()
      Self.ownerMutex.lock(); self.ownsData = true; Self.ownerMutex.unlock()
      do {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).resolvingSymlinksInPath()
        let directory = support.appendingPathComponent("slax-react-native")
        let cleared = try self.withPreferencesLock { shared, activity in
          let cleanup = LegacyReset(support: support, shared: shared)
          self.reset = cleanup
          try activity.check()
          return try cleanup.prepare()
        }
        guard directory.resolvingSymlinksInPath().path == directory.path else { throw CocoaError(.fileReadNoPermission) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return ["legacyDataDirectory": support.path, "newDatabaseDirectory": directory.path, "legacyReset": cleared]
      } catch { self.releaseOwner(); throw error }
    }
    AsyncFunction("finishLegacyReset") {
      Self.ownerMutex.lock(); defer { Self.ownerMutex.unlock() }
      guard self.ownsData else { throw CocoaError(.fileLocking) }
      try self.withPreferencesLock { _, activity in
        try activity.check()
        try self.reset?.finish()
      }
    }
    AsyncFunction("endDataOwnership") { self.releaseOwner() }
    AsyncFunction("beginFreshDataOwnership") { () -> [String: Any] in
      guard Bundle.main.bundleIdentifier == "app.slax.reader" else { throw CocoaError(.fileReadNoPermission) }
      let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).resolvingSymlinksInPath()
      let directory = support.appendingPathComponent("slax-react-native")
      guard directory.resolvingSymlinksInPath().path == directory.path else { throw CocoaError(.fileReadNoPermission) }
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      return ["legacyDataDirectory": support.path, "newDatabaseDirectory": directory.path, "legacyReset": false]
    }
    Function("beginStorageTransition") { try self.transition.begin() }
    Function("checkStorageTransition") { (token: Int) in try self.transition.check(token) }
    AsyncFunction("endStorageTransition") { (token: Int) in self.transition.finish(token) }.runOnQueue(.main)
    OnCreate { self.transition.observe() }
    OnDestroy { self.transition.stopObserving(); self.releaseOwner() }
  }
}
