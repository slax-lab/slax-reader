import Foundation
public final class Promise {
  public var value: Any?
  public var error: Error?
  public init() {}
  public func resolve(_ value: Any?) { self.value = value }
  public func reject(_ error: Error) { self.error = error }
}
public protocol Definition {}
public struct ModuleDefinition {
  public let imageCacheFileUri: (String, String, String) -> String?
  public let pdfCacheFileUri: (String, String) -> String?
}
public struct Name: Definition { public init(_ name: String) { precondition(name == "SlaxCachePaths") } }
public struct Function: Definition {
  let image: ((String, String, String) -> String?)?
  let pdf: ((String, String) -> String?)?
  public init(_ name: String, _ body: @escaping (String, String, String) -> String?) { precondition(name == "imageCacheFileUri"); image = body; pdf = nil }
  public init(_ name: String, _ body: @escaping (String, String) -> String?) { precondition(name == "pdfCacheFileUri"); image = nil; pdf = body }
}
@resultBuilder public enum ModuleDefinitionBuilder {
  public static func buildBlock(_ definitions: Definition...) -> ModuleDefinition {
    let functions = definitions.compactMap { $0 as? Function }
    return ModuleDefinition(imageCacheFileUri: functions.compactMap { $0.image }.first!, pdfCacheFileUri: functions.compactMap { $0.pdf }.first!)
  }
}
public protocol Module { @ModuleDefinitionBuilder func definition() -> ModuleDefinition }
