import Foundation

/** The App Group lock identity stays stable when an app update relocates its data container. */
func legacyDatabaseIdentities(_ candidates: [String], support: URL, shared: URL, bundleIdentifier: String) -> [String: [String: String]] {
  let canonicalSupport = support.resolvingSymlinksInPath().path
  let uuid = "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"
  let pattern = "^((?:.*/CoreSimulator/Devices/\(uuid)/data/Containers/Data/Application/|/private/var/mobile/Containers/Data/Application/|/var/mobile/Containers/Data/Application/))\(uuid)/Library/Application Support$"
  guard let expression = try? NSRegularExpression(pattern: pattern),
        let match = expression.firstMatch(in: canonicalSupport, range: NSRange(canonicalSupport.startIndex..., in: canonicalSupport)),
        let prefixRange = Range(match.range(at: 1), in: canonicalSupport) else { return [:] }
  let prefix = String(canonicalSupport[prefixRange])
  let containerRoot = support.deletingLastPathComponent().deletingLastPathComponent().resolvingSymlinksInPath().path + "/"
  let owner = "ios:\(bundleIdentifier):\(shared.resolvingSymlinksInPath().path)"
  return Dictionary(uniqueKeysWithValues: candidates.compactMap { path in
    guard path.hasPrefix(containerRoot), URL(fileURLWithPath: path).resolvingSymlinksInPath().path == path else { return nil }
    let relative = String(path.dropFirst(containerRoot.count))
    guard !relative.isEmpty, !relative.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) else { return nil }
    return (path, ["owner": owner, "relativePath": relative, "relocationPrefix": prefix])
  })
}
