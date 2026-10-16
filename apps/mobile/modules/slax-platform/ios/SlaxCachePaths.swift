import Foundation

enum SlaxCachePaths {
  static func file(root: URL, key: String, name: String) -> URL? {
    guard !key.isEmpty, key.unicodeScalars.allSatisfy({ CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-").contains($0) }),
          name.range(of: "^[a-f0-9]{32}\\..+$", options: .regularExpression) != nil,
          name.utf16.count <= 64, !name.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 || $0.value == 92 }) else { return nil }
    let parts = name.components(separatedBy: "/")
    guard parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return nil }
    var current = root.standardizedFileURL.resolvingSymlinksInPath()
    for part in ["bookmark", key, "images"] + parts {
      current.appendPathComponent(part)
      guard current.resolvingSymlinksInPath().path == current.path,
            (try? FileManager.default.attributesOfItem(atPath: current.path)[.type] as? FileAttributeType) != .typeSymbolicLink else { return nil }
    }
    return current
  }
}
