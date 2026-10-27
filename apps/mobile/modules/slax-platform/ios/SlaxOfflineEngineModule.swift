import ExpoModulesCore
import Foundation

/// JavaScript binding of `SlaxOfflineEngine`; every function only hands its arguments to the engine's control queue.
public final class SlaxOfflineEngineModule: Module {
  private var token: UUID?
  private func reply(_ promise: Promise) -> SlaxOfflineReply {
    SlaxOfflineReply(resolve: { promise.resolve($0) }, reject: { promise.reject($0, $1) })
  }
  private func emitter() -> (String, [String: Any]) -> Void { { [weak self] name, body in self?.sendEvent(name, body) } }
  public func definition() -> ModuleDefinition {
    Name("SlaxOfflineEngine")
    Events("onStatus", "onCredentialRejected")
    OnCreate {
      self.token = SlaxOfflineEngine.shared.attach(self.emitter())
    }
    OnDestroy {
      if let token = self.token { SlaxOfflineEngine.shared.detach(token) }
    }
    let engine = SlaxOfflineEngine.shared
    AsyncFunction("open") { (scope: [String: Any], promise: Promise) in engine.open(scope, reply: self.reply(promise)) }
    AsyncFunction("commitMigration") { (owner: String, promise: Promise) in engine.commitMigration(owner, reply: self.reply(promise)) }
    AsyncFunction("suspend") { (owner: String, promise: Promise) in engine.suspend(owner, reply: self.reply(promise)) }
    Function("resume") { (owner: String) in engine.resume(owner) }
    AsyncFunction("close") { (owner: String, promise: Promise) in engine.close(owner, reply: self.reply(promise)) }
    Function("setCredential") { (owner: String, credential: [String: Any]?) in engine.setCredential(owner, credential) }
    Function("setConditions") { (owner: String, conditions: [String: Any]) in engine.setConditions(owner, conditions) }
    Function("applyPlan") { (owner: String, plan: [String: Any]) in engine.applyPlan(owner, plan) }
    AsyncFunction("evict") { (owner: String, keys: [String], promise: Promise) in engine.evict(owner, keys, reply: self.reply(promise)) }
    Function("protect") { (owner: String, key: String) -> String in engine.protect(owner, key) }
    Function("release") { (owner: String, token: String) in engine.release(owner, token) }
    AsyncFunction("readArticle") { (owner: String, key: String, promise: Promise) in engine.readArticle(owner, key, reply: self.reply(promise)) }
    AsyncFunction("fetchArticle") { (owner: String, request: [String: Any], promise: Promise) in engine.fetchArticle(owner, request, reply: self.reply(promise)) }
    AsyncFunction("pdfMetadata") { (owner: String, request: [String: Any], promise: Promise) in engine.pdfMetadata(owner, request, reply: self.reply(promise)) }
    AsyncFunction("readPdfRange") { (owner: String, request: [String: Any], promise: Promise) in engine.readPdfRange(owner, request, reply: self.reply(promise)) }
    AsyncFunction("pdfStatus") { (owner: String, key: String, promise: Promise) in engine.pdfStatus(owner, key, reply: self.reply(promise)) }
    Function("cancel") { (owner: String, requestId: String) in engine.cancel(owner, requestId) }
    AsyncFunction("usage") { (owner: String, keys: [String], promise: Promise) in engine.usage(owner, keys, reply: self.reply(promise)) }
    AsyncFunction("clear") { (owner: String, keys: [String], categories: [String], promise: Promise) in engine.clear(owner, keys, categories, reply: self.reply(promise)) }
  }
}
