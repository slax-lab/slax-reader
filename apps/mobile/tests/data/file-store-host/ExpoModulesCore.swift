import Foundation
public final class Promise {
  public init() {}
  public func resolve(_ value: Any?) {}
  public func reject(_ error: Error) {}
}
public protocol Definition {}
public struct ModuleDefinition {}
public struct Name: Definition {public init(_ name: String) {}}
public struct Function: Definition {
  public init<A, R>(_ name: String, _ work: @escaping (A) throws -> R) {}
  public init<A, B, R>(_ name: String, _ work: @escaping (A, B) throws -> R) {}
}
public struct AsyncFunction: Definition {
  public init<A, B, C>(_ name: String, _ work: @escaping (A, B, C) throws -> Void) {}
  public init<A, B, C, D>(_ name: String, _ work: @escaping (A, B, C, D) throws -> Void) {}
  public init<A, B, C, D, E>(_ name: String, _ work: @escaping (A, B, C, D, E) throws -> Void) {}
  public init<A, B, C, D, E, F>(_ name: String, _ work: @escaping (A, B, C, D, E, F) throws -> Void) {}
}
@resultBuilder public enum ModuleDefinitionBuilder {
  public static func buildBlock(_ definitions: Definition...) -> ModuleDefinition {ModuleDefinition()}
}
public protocol Module {@ModuleDefinitionBuilder func definition() -> ModuleDefinition}
