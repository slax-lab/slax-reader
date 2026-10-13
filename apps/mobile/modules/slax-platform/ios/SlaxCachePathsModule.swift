import ExpoModulesCore
import Foundation

public final class SlaxCachePathsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SlaxCachePaths")
    Function("pdfCacheFileUri") { (directory: String, relativePath: String) -> String? in
      guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
            let supplied = directory.hasPrefix("file://") ? URL(string: directory) : URL(fileURLWithPath: directory), supplied.isFileURL else { return nil }
      let root = supplied.standardizedFileURL.resolvingSymlinksInPath()
      guard root.path == support.resolvingSymlinksInPath().path else { return nil }
      let parts = relativePath.components(separatedBy: "/")
      guard parts.first == "pdf", parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && $0.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil }) else { return nil }
      var current = root
      for part in parts {
        current.appendPathComponent(part)
        guard current.resolvingSymlinksInPath().path == current.path,
              (try? FileManager.default.attributesOfItem(atPath: current.path)[.type] as? FileAttributeType) != .typeSymbolicLink else { return nil }
      }
      return current.absoluteString
    }
    Function("imageCacheFileUri") { (directory: String, key: String, relativePath: String) -> String? in
      let root = (directory.hasPrefix("file://") ? URL(string: directory) : URL(fileURLWithPath: directory))?.standardizedFileURL.resolvingSymlinksInPath()
      guard let root, root.isFileURL, let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
      var fixture = false
      #if DEBUG
      if let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
         root.path.hasPrefix(caches.appendingPathComponent("slax-ui-fixtures").resolvingSymlinksInPath().path + "/"),
         let data = try? Data(contentsOf: root.appendingPathComponent("slax-fixture.json")),
         let marker = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        fixture = marker["controlledFixture"] as? Bool == true && marker["fixtureVersion"] as? Int == 1
      }
      #endif
      let prefix = "bookmark/\(key)/images/"
      guard (root.path == support.resolvingSymlinksInPath().path || fixture), relativePath.hasPrefix(prefix) else { return nil }
      return SlaxCachePaths.file(root: root, key: key, name: String(relativePath.dropFirst(prefix.count)))?.absoluteString
    }
  }
}
