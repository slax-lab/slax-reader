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
    try files.createSymbolicLink(at: old, withDestinationURL: outside)
    do { _ = try reset.prepare(); fatalError("Redirected old database must not be deleted") } catch {}
    let retained = try String(contentsOf: outside, encoding: .utf8); precondition(retained == "unrelated")
    print("iOS fixed-path reset passed: corrupt old file, WAL/cache cleanup, interruption, fresh/native preservation, path containment")
  }
}
