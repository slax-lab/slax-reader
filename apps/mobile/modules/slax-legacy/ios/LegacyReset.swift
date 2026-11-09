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

  func prepare() throws -> Bool {
    guard exists(marker) || suffixes.contains(where: { exists(URL(fileURLWithPath: legacy.path + $0)) }) else { return false }
    guard marker.resolvingSymlinksInPath().path == marker.standardizedFileURL.path else { throw CocoaError(.fileReadNoPermission) }
    if !exists(marker) { try Data().write(to: marker, options: .atomic) }
    for path in ["bookmark", "pdf", "slax-react-native"] { try remove(support.appendingPathComponent(path)) }
    for suffix in suffixes { try remove(URL(fileURLWithPath: legacy.path + suffix)) }
    return true
  }

  func finish() throws {
    guard exists(marker) else { return }
    try remove(shared.appendingPathComponent("user.preferences_pb"))
    try remove(marker)
  }
}
