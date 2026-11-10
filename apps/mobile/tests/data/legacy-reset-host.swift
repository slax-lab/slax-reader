import Foundation

@main struct ResetHost {
  static func main() throws {
    let files = FileManager.default
    let root = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("ios").resolvingSymlinksInPath()
    let support = root.appendingPathComponent("support"), shared = root.appendingPathComponent("shared")
    try files.createDirectory(at: shared, withIntermediateDirectories: true)
    func write(_ file: URL, _ text: String) throws {
      try files.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try Data(text.utf8).write(to: file)
    }
    let native = support.appendingPathComponent("slax-react-native/powersync.db")
    try write(native, "new offline changes")
    let reset = LegacyReset(support: support, shared: shared)
    let fresh = try reset.prepare(); precondition(!fresh && files.fileExists(atPath: native.path))
    try write(shared.appendingPathComponent("user.preferences_pb"), "old prefs alone")
    let preferencesOnly = try reset.prepare(); precondition(!preferencesOnly)
    let old = support.appendingPathComponent("databases/powersync.db")
    try write(old, "not sqlite")
    try write(URL(fileURLWithPath: old.path + "-wal"), "old wal")
    try write(support.appendingPathComponent("bookmark/article/content.html"), "old cache")
    let cleared = try reset.prepare(); precondition(cleared)
    precondition(!files.fileExists(atPath: old.path) && !files.fileExists(atPath: native.path))
    precondition(!files.fileExists(atPath: old.path + "-wal") && !files.fileExists(atPath: support.appendingPathComponent("bookmark").path))
    let resumed = try LegacyReset(support: support, shared: shared).prepare(); precondition(resumed)
    try reset.finish()
    precondition(!files.fileExists(atPath: shared.appendingPathComponent("user.preferences_pb").path))
    try write(native, "post-reset writes")
    let repeated = try reset.prepare(); precondition(!repeated)
    let outside = root.appendingPathComponent("outside.db")
    try write(outside, "unrelated")
    let cache = support.appendingPathComponent("bookmark/article/content.html")
    let preferences = shared.appendingPathComponent("user.preferences_pb")
    let currentPreferences = shared.appendingPathComponent("slax.preferences.v1.json")
    let wal = URL(fileURLWithPath: old.path + "-wal")
    try write(cache, "retained cache")
    try write(preferences, "retained preferences")
    try write(currentPreferences, "retained current preferences")
    try write(wal, "retained old wal")
    func expect(_ file: URL, _ value: String) throws {
      let actual = try String(contentsOf: file, encoding: .utf8)
      precondition(actual == value, "Rejected reset modified stored data")
    }
    let nativeDirectory = native.deletingLastPathComponent()
    let bookmarkDirectory = support.appendingPathComponent("bookmark")
    for target in [old, wal, bookmarkDirectory, support.appendingPathComponent("pdf"), nativeDirectory, preferences] {
      try write(old, "retained old database")
      let saved = URL(fileURLWithPath: target.path + ".test-saved")
      let hadOriginal = files.fileExists(atPath: target.path)
      if hadOriginal { try files.moveItem(at: target, to: saved) }
      try files.createSymbolicLink(at: target, withDestinationURL: outside)
      for _ in 0..<2 {
        do { _ = try reset.prepare(); fatalError("Redirected target accepted") } catch {}
        precondition(!files.fileExists(atPath: shared.appendingPathComponent(".slax-legacy-reset").path), "Rejected reset left a marker")
        try expect(target == nativeDirectory ? saved.appendingPathComponent("powersync.db") : native, "post-reset writes")
        try expect(target == bookmarkDirectory ? saved.appendingPathComponent("article/content.html") : cache, "retained cache")
        try expect(target == preferences ? saved : preferences, "retained preferences")
        try expect(currentPreferences, "retained current preferences")
        try expect(target == old ? saved : old, "retained old database")
        try expect(target == wal ? saved : wal, "retained old wal")
        try expect(outside, "unrelated")
      }
      try files.removeItem(at: target)
      if hadOriginal { try files.moveItem(at: saved, to: target) }
    }
    let nested = cache.deletingLastPathComponent().appendingPathComponent("redirected")
    try files.createSymbolicLink(at: nested, withDestinationURL: outside)
    do { _ = try reset.prepare(); fatalError("Nested redirected target accepted") } catch {}
    try expect(native, "post-reset writes")
    try expect(cache, "retained cache")
    precondition(!files.fileExists(atPath: shared.appendingPathComponent(".slax-legacy-reset").path))
    try files.removeItem(at: nested)
    let recovered = try reset.prepare(); precondition(recovered)
    try reset.finish()
    precondition(!files.fileExists(atPath: old.path) && !files.fileExists(atPath: native.path) && !files.fileExists(atPath: cache.path))
    print("iOS fixed-path reset passed: preflight rejects every redirected target without mutation, retry recovers, normal reset remains idempotent")
  }
}
