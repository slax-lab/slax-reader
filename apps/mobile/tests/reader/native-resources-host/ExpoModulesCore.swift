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
  public let begin: (String) throws -> String
  public let end: (String, String) -> Void
  public let resolve: (String, String, [String: Any], Promise) -> Void
}
public struct Name: Definition { public init(_ name: String) { precondition(["SlaxCachePaths", "SlaxImageCache"].contains(name)) } }
public struct Function: Definition {
  var image: ((String, String, String) -> String?)?
  var pdf: ((String, String) -> String?)?
  var begin: ((String) throws -> String)?
  var end: ((String, String) -> Void)?
  public init(_ name: String, _ body: @escaping (String, String, String) -> String?) { precondition(name == "imageCacheFileUri"); image = body }
  public init(_ name: String, _ body: @escaping (String, String) -> String?) { precondition(name == "pdfCacheFileUri"); pdf = body }
  public init(_ name: String, _ body: @escaping (String) throws -> String) { precondition(name == "begin"); begin = body }
  public init(_ name: String, _ body: @escaping (String, String) -> Void) { precondition(name == "end"); end = body }
}
public struct AsyncFunction: Definition {
  let resolve: (String, String, [String: Any], Promise) -> Void
  public init(_ name: String, _ body: @escaping (String, String, [String: Any], Promise) -> Void) { precondition(name == "resolve"); resolve = body }
}
@resultBuilder public enum ModuleDefinitionBuilder {
  public static func buildBlock(_ definitions: Definition...) -> ModuleDefinition {
    let functions = definitions.compactMap { $0 as? Function }
    return ModuleDefinition(imageCacheFileUri: functions.compactMap { $0.image }.first ?? {_, _, _ in nil}, pdfCacheFileUri: functions.compactMap { $0.pdf }.first ?? {_, _ in nil},
      begin: functions.compactMap { $0.begin }.first ?? {_ in fatalError()}, end: functions.compactMap { $0.end }.first ?? {_, _ in},
      resolve: definitions.compactMap { $0 as? AsyncFunction }.first?.resolve ?? {_, _, _, _ in})
  }
}
public protocol Module { @ModuleDefinitionBuilder func definition() -> ModuleDefinition }
