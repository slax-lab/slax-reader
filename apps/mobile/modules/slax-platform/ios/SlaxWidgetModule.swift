import ExpoModulesCore
import Foundation
import WidgetKit

private enum SlaxWidgetSnapshotStore {
  static let group = "group.app.slax.reader"
  static let file = "slax-widget-snapshot-v1.json"
  static let versionKey = "slax-widget-snapshot-version-v1"
  static let committedVersionKey = "slax-widget-committed-version-v1"
  static let lock = NSLock()

  static func nextVersion() throws -> Int {
    lock.lock(); defer { lock.unlock() }
    guard let defaults = UserDefaults(suiteName: group) else {
      throw NSError(domain: "SlaxWidget", code: 1, userInfo: [NSLocalizedDescriptionKey: "Widget group unavailable"])
    }
    let current = max(
      defaults.integer(forKey: versionKey),
      max(defaults.integer(forKey: committedVersionKey), readSnapshotVersion() ?? 0)
    )
    let next = current + 1
    defaults.set(next, forKey: versionKey)
    return next
  }

  static func publish(_ snapshot: [String: Any]) throws -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard let version = snapshot["version"] as? Int,
      let schema = snapshot["schemaVersion"] as? Int, schema == 1,
      let defaults = UserDefaults(suiteName: group),
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
      throw NSError(domain: "SlaxWidget", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid widget snapshot or group unavailable"])
    }
    let reserved = defaults.integer(forKey: versionKey)
    let committed = max(defaults.integer(forKey: committedVersionKey), readSnapshotVersion() ?? 0)
    guard version > committed, version <= reserved else { return false }
    // Persist the committed high-watermark separately from the snapshot file before replacing it.
    // If that file is later removed or corrupted, an older reserved version still cannot revive.
    defaults.set(version, forKey: committedVersionKey)
    guard defaults.synchronize(), defaults.integer(forKey: committedVersionKey) >= version else { return false }
    let data = try JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys])
    try data.write(to: container.appendingPathComponent(file), options: [.atomic, .completeFileProtectionUnlessOpen])
    return true
  }

  private static func readSnapshotVersion() -> Int? {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
      let data = try? Data(contentsOf: container.appendingPathComponent(file)),
      let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    return value["version"] as? Int
  }
}

public final class SlaxWidgetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SlaxWidgetBridge")
    AsyncFunction("nextVersion") { try SlaxWidgetSnapshotStore.nextVersion() }
    AsyncFunction("publishSnapshot") { (snapshot: [String: Any]) in
      try SlaxWidgetSnapshotStore.publish(snapshot)
    }
    AsyncFunction("reloadWidgets") {
      if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
    }
  }
}
