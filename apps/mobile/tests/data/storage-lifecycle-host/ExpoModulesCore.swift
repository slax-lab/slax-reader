import Foundation
public struct ModuleDefinition {}
public struct Definition {
  public func runOnQueue(_ queue: DispatchQueue) -> Definition { self }
}
@resultBuilder public enum ModuleDefinitionBuilder {
  public static func buildBlock(_ definitions: Definition...) -> ModuleDefinition { ModuleDefinition() }
}
public protocol Module {
  @ModuleDefinitionBuilder func definition() -> ModuleDefinition
}
public func Name(_ name: String) -> Definition { Definition() }
public func Function<T>(_ name: String, _ body: @escaping () throws -> T) -> Definition { Definition() }
public func Function<A, T>(_ name: String, _ body: @escaping (A) throws -> T) -> Definition { Definition() }
public func AsyncFunction<T>(_ name: String, _ body: @escaping () throws -> T) -> Definition { Definition() }
public func AsyncFunction<A, T>(_ name: String, _ body: @escaping (A) throws -> T) -> Definition { Definition() }
public func AsyncFunction<A, B, T>(_ name: String, _ body: @escaping (A, B) throws -> T) -> Definition { Definition() }
public func OnCreate(_ body: @escaping () -> Void) -> Definition { Definition() }
public func OnDestroy(_ body: @escaping () -> Void) -> Definition { Definition() }
