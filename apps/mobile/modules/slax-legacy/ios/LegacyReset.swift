import Foundation

final class LegacyReset {
  private let support: URL
  private let shared: URL
  private let files = FileManager.default
  private var marker: URL { shared.appendingPathComponent(".slax-legacy-reset") }
  private var legacy: URL { support.appendingPathComponent("databases/powersync.db") }
  private let suffixes = ["", "-wal", "-shm", "-journal"]

  init(support: URL, shared: URL) {
    self.support = support.resolvingSymlinksInPath()
    self.shared = shared.resolvingSymlinksInPath()
  }

  private func exists(_ file: URL) -> Bool {
    files.fileExists(atPath: file.path) || (try? files.destinationOfSymbolicLink(atPath: file.path)) != nil
  }

  private func remove(_ file: URL) throws {
    guard exists(file) else { return }
    guard file.resolvingSymlinksInPath().path == file.standardizedFileURL.path else { throw CocoaError(.fileReadNoPermission) }
    try files.removeItem(at: file)
  }

  private func validate(_ file: URL) throws {
    guard file.resolvingSymlinksInPath().path == file.standardizedFileURL.path,
          (try? files.destinationOfSymbolicLink(atPath: file.path)) == nil else { throw CocoaError(.fileReadNoPermission) }
    guard exists(file) else { return }
    if try file.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true {
      for child in try files.contentsOfDirectory(at: file, includingPropertiesForKeys: [.isDirectoryKey]) { try validate(child) }
    }
  }

  func prepare() throws -> Bool {
    let legacyFiles = suffixes.map { URL(fileURLWithPath: legacy.path + $0) }
    guard exists(marker) || legacyFiles.contains(where: { exists($0) }) else { return false }
    let targets = legacyFiles + ["bookmark", "pdf", "slax-react-native"].map { support.appendingPathComponent($0) }
    for target in [marker, shared.appendingPathComponent("user.preferences_pb")] + targets { try validate(target) }
    if !exists(marker) { try Data().write(to: marker, options: .atomic) }
    for target in targets { try remove(target) }
    return true
  }

  func finish() throws {
    guard exists(marker) else { return }
    try remove(shared.appendingPathComponent("user.preferences_pb"))
    try remove(marker)
  }
}
