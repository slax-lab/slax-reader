package com.slax.reader.platform

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SlaxPdfTransferModule : Module() {
  private fun submit(owner: String, id: String, promise: Promise, work: (SlaxPdfTransfer) -> Any?) {
    val transfer = try {SlaxPdfTransfers.get(owner, id)} catch (_: Exception) {promise.resolve(mapOf("error" to "cancelled")); return}
    if (!transfer.reserve()) {promise.resolve(mapOf("error" to "busy")); return}
    SlaxPdfTransfers.execute({
      try {val value = work(transfer); transfer.completeOperation(); promise.resolve(value)}
      catch (error: Exception) {
        transfer.completeOperation(); SlaxPdfTransfers.end(owner, id)
        promise.resolve(mapOf("error" to ((error as? SlaxPdfTransferError)?.code ?: "network")))
      }
    }, {transfer.completeOperation(); promise.resolve(mapOf("error" to "busy"))})
  }
  override fun definition() = ModuleDefinition {
    Name("SlaxPdfTransfer")
    Function("begin") { owner: String, origin: String ->
      val context = appContext.reactContext ?: error("PDF context unavailable")
      SlaxPdfTransfers.begin(owner, origin, context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0)
    }
    Function("end") { owner: String, id: String -> SlaxPdfTransfers.end(owner, id) }
    AsyncFunction("open") { owner: String, id: String, url: String, headers: Map<String, String>, promise: Promise ->
      submit(owner, id, promise) { it.open(url, headers) }
    }
    AsyncFunction("read") { owner: String, id: String, promise: Promise -> submit(owner, id, promise) { it.read() } }
  }
}
