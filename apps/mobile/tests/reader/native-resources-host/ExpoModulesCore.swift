import Foundation
public final class Promise {
  public var value: Any?
  public var error: Error?
  public init() {}
  public func resolve(_ value: Any?) { self.value = value }
  public func reject(_ error: Error) { self.error = error }
}
public protocol Definition {}
public struct ModuleDefinition { public let imageCacheFileUri: (String, String, String) -> String? }
public struct Name: Definition { public init(_ name: String) { precondition(name == "SlaxCachePaths") } }
public struct Function: Definition {
  let body: (String, String, String) -> String?
  public init(_ name: String, _ body: @escaping (String, String, String) -> String?) { precondition(name == "imageCacheFileUri"); self.body = body }
}
@resultBuilder public enum ModuleDefinitionBuilder {
  public static func buildBlock(_ definitions: Definition...) -> ModuleDefinition {
    ModuleDefinition(imageCacheFileUri: (definitions.compactMap { $0 as? Function }.first!).body)
  }
}
public protocol Module { @ModuleDefinitionBuilder func definition() -> ModuleDefinition }
