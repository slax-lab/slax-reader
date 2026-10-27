package com.slax.reader.platform

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

internal object SlaxOfflineEngines {
  private var engine: SlaxOfflineEngine? = null
  @Synchronized fun engine(context: Context): SlaxOfflineEngine = engine ?: SlaxOfflineEngine(SlaxOfflineEnvironment(
    root = { directory -> SlaxStorageRoots.resolve(context, directory).let { it.root to it.pdfRoot } },
    registry = { SlaxImageResources.registry(context) },
    allowHttp = context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0,
  )).also { engine = it }
}

/** JavaScript binding of `SlaxOfflineEngine`; every function only hands its arguments to the engine's control thread. */
class SlaxOfflineEngineModule : Module() {
  private var token: Any? = null
  private fun engine() = SlaxOfflineEngines.engine(appContext.reactContext ?: error("Offline engine context unavailable"))
  private fun reply(promise: Promise) = SlaxOfflineReply({ promise.resolve(it) }, { code, message -> promise.reject(code, message, null) })

  override fun definition() = ModuleDefinition {
    Name("SlaxOfflineEngine")
    Events("onStatus", "onCredentialRejected")
    OnCreate { token = engine().attach { name, body -> sendEvent(name, body) } }
    OnDestroy { token?.let { engine().detach(it) }; token = null }
    AsyncFunction("open") { scope: Map<String, Any?>, promise: Promise -> engine().open(scope, reply(promise)) }
    AsyncFunction("commitMigration") { owner: String, promise: Promise -> engine().commitMigration(owner, reply(promise)) }
    AsyncFunction("suspend") { owner: String, promise: Promise -> engine().suspend(owner, reply(promise)) }
    Function("resume") { owner: String -> engine().resume(owner) }
    AsyncFunction("close") { owner: String, promise: Promise -> engine().close(owner, reply(promise)) }
    Function("setCredential") { owner: String, credential: Map<String, Any?>? -> engine().setCredential(owner, credential) }
    Function("setConditions") { owner: String, conditions: Map<String, Any?> -> engine().setConditions(owner, conditions) }
    Function("applyPlan") { owner: String, plan: Map<String, Any?> -> engine().applyPlan(owner, plan) }
    AsyncFunction("evict") { owner: String, keys: List<String>, promise: Promise -> engine().evict(owner, keys, reply(promise)) }
    Function("protect") { owner: String, key: String -> engine().protect(owner, key) }
    Function("release") { owner: String, token: String -> engine().release(owner, token) }
    AsyncFunction("readArticle") { owner: String, key: String, promise: Promise -> engine().readArticle(owner, key, reply(promise)) }
    AsyncFunction("fetchArticle") { owner: String, request: Map<String, Any?>, promise: Promise -> engine().fetchArticle(owner, request, reply(promise)) }
    AsyncFunction("pdfMetadata") { owner: String, request: Map<String, Any?>, promise: Promise -> engine().pdfMetadata(owner, request, reply(promise)) }
    AsyncFunction("pdfStatus") { owner: String, key: String, promise: Promise -> engine().pdfStatus(owner, key, reply(promise)) }
    Function("cancel") { owner: String, requestId: String -> engine().cancel(owner, requestId) }
    AsyncFunction("usage") { owner: String, keys: List<String>, promise: Promise -> engine().usage(owner, keys, reply(promise)) }
    AsyncFunction("clear") { owner: String, keys: List<String>, categories: List<String>, promise: Promise -> engine().clear(owner, keys, categories, reply(promise)) }
  }
}
