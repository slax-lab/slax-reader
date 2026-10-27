package com.slax.reader.platform

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Runs blocking IO on Dispatchers.IO; coroutine cancellation interrupts the thread and invokes [cancel] to close sockets. */
internal suspend fun <T> slaxBlocking(cancel: () -> Unit = {}, work: () -> T): T = coroutineScope {
  val finished = AtomicBoolean(false)
  val watcher = launch(start = CoroutineStart.UNDISPATCHED) { try {awaitCancellation()} finally {if (!finished.get()) cancel()} }
  try {runInterruptible(Dispatchers.IO) { work() }} finally {finished.set(true); watcher.cancel()}
}

internal class SlaxOfflineResponse(val status: Int, val headers: Map<String, String>, val body: ByteArray)

/** Cookie-less transport for article bodies and PDF metadata on the shared OkHttp client; redirects are surfaced, not followed. */
internal object SlaxOfflineHttp {
  private val json = "application/json".toMediaType()
  fun content(scope: SlaxOfflineScope, id: String, token: String): Request = Request.Builder().url("${scope.origin}/v1/bookmark/content")
    .post(SlaxOfflineJson.encode(mapOf("bookmark_uid" to id)).toByteArray(Charsets.UTF_8).toRequestBody(json))
    .header("Content-Type", "application/json").header("Accept", "*/*").header("User-Agent", scope.userAgent).header("Authorization", "Bearer $token").build()
  fun metadata(scope: SlaxOfflineScope, id: String, token: String): Request = Request.Builder().url("${scope.origin}/v1/bookmark/metadata?bookmark_uid=$id").get()
    .header("Accept", "application/json").header("Authorization", "Bearer $token").header("X-CLIENT-TYPE", scope.clientType).header("X-CLIENT-VERSION", scope.clientVersion).build()

  /** One exchange: non-2xx responses return their status and headers without a body; 2xx bodies are bounded by [limit]. */
  suspend fun send(request: Request, limit: Int, oversized: SlaxOfflineError, timeoutMs: Long, work: SlaxOfflineWork): SlaxOfflineResponse {
    work.check()
    val client = SlaxPdfTransfers.client.newBuilder().callTimeout(maxOf(1000L, timeoutMs), TimeUnit.MILLISECONDS).connectTimeout(30, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    val call = client.newCall(request)
    val hook = work.attach { call.cancel() }
    try {
      return slaxBlocking({ call.cancel() }) {
        call.execute().use { response ->
          val headers = linkedMapOf<String, String>()
          for (name in listOf("Content-Type", "Content-Length", "Retry-After")) response.header(name)?.takeIf { it.length <= 8192 }?.let { headers[name] = it }
          if (response.code !in 200..299) return@use SlaxOfflineResponse(response.code, headers, ByteArray(0))
          val body = response.body ?: return@use SlaxOfflineResponse(response.code, headers, ByteArray(0))
          if (body.contentLength() > limit) throw oversized
          val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(64 * 1024)
          body.byteStream().use { input ->
            while (true) {
              val count = input.read(buffer); if (count < 0) break
              if (output.size() + count > limit) throw oversized
              output.write(buffer, 0, count)
            }
          }
          SlaxOfflineResponse(response.code, headers, output.toByteArray())
        }
      }
    } catch (error: CancellationException) {throw error} catch (error: SlaxOfflineError) {throw error} catch (error: Exception) {
      if (work.isCancelled) throw SlaxOfflineError.cancelled
      throw if (error is InterruptedIOException && !call.isCanceled()) SlaxOfflineError.timeout else SlaxOfflineError.network
    } finally {work.detach(hook)}
  }
}
