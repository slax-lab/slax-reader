package com.slax.reader.extension

import java.io.IOException
import java.net.URL
import java.util.concurrent.CancellationException
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.EventListener
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okio.BufferedSink
import org.json.JSONObject

internal class ShareSaveTransport(
  private val listener: EventListener = EventListener.NONE,
  private val onResponse: (Int, String?, String?) -> Unit = {_, _, _ ->},
  private val onFailure: (Exception) -> Unit = {},
  private val onCreateFinished: () -> Unit = {},
) {
  data class Result(val message: String, val reason: String)
  private val mutex = Any()
  private var cancelled = false
  private var connection: Call? = null

  fun cancel() {
    synchronized(mutex) {cancelled = true; connection?.cancel()}
  }

  private fun ensureActive() {
    synchronized(mutex) {if (cancelled) throw CancellationException("Share dismissed")}
  }

  fun save(base: String, token: String, version: String, url: String, title: String?): Result {
    ensureActive()
    val client = OkHttpClient.Builder()
      .callTimeout(5, TimeUnit.SECONDS).connectTimeout(5, TimeUnit.SECONDS)
      .readTimeout(5, TimeUnit.SECONDS).writeTimeout(5, TimeUnit.SECONDS)
      .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(true)
      .protocols(listOf(Protocol.HTTP_1_1)).eventListener(listener).build()
    val body = JSONObject().put("target_url", url).apply {if (title != null) put("target_title", title)}
    try {
      try {
        return try {
          execute(client, request(base, "/v1/bookmark/add_url", token, version, body)) {response ->
            val code = response.code
            val cfRay = response.header("CF-Ray")
            onResponse(code, null, cfRay)
            val message = when (code) {
              200, 204 -> "ok"
              401 -> "Auth expired, please reopen the app to login again."
              400 -> {
                val errorBody = try {response.body?.string()} catch (error: IOException) {
                  ensureActive(); onFailure(error); null
                }
                if (errorBody != null) onResponse(code, errorBody, cfRay)
                errorBody?.let {runCatching {JSONObject(it).optString("message")}.getOrNull()}
                  ?.takeIf {it.isNotBlank()} ?: FAILURE_MESSAGE
              }
              else -> FAILURE_MESSAGE
            }
            Result(message, when (code) {
              200, 204 -> "success"
              401 -> "http_401"
              400 -> "http_400"
              429 -> "http_429"
              in 500..599 -> "http_5xx"
              else -> "http_other"
            })
          }
        } finally {onCreateFinished()}
      } catch (error: IOException) {
        ensureActive()
        if (!error.isShareTimeout()) throw error
        onFailure(error)
      }
      ensureActive()
      val receiptClient = client.newBuilder().callTimeout(3, TimeUnit.SECONDS)
        .connectTimeout(3, TimeUnit.SECONDS).readTimeout(3, TimeUnit.SECONDS).writeTimeout(3, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false).eventListener(EventListener.NONE).build()
      val saved = try {
        execute(receiptClient, request(base, "/v1/bookmark/save_receipt", token, version, JSONObject().put("target_url", url))) {it.code == 204}
      } catch (_: IOException) {ensureActive(); false}
      ensureActive()
      return if (saved) Result("ok", "success") else Result(TIMEOUT_MESSAGE, "network_timeout")
    } finally {client.connectionPool.evictAll()}
  }

  private fun request(base: String, path: String, token: String, version: String, body: JSONObject): Request {
    val bytes = body.toString().toByteArray(Charsets.UTF_8)
    val payload = object : RequestBody() {
      override fun contentType() = "application/json".toMediaType()
      override fun contentLength() = bytes.size.toLong()
      override fun isOneShot() = true
      override fun writeTo(sink: BufferedSink) {sink.write(bytes)}
    }
    return Request.Builder().url(URL(URL(base), path))
      .header("Content-Type", "application/json").header("Authorization", "Bearer $token")
      .header("User-Agent", "SlaxReader/Android $version").post(payload).build()
  }

  private fun <T> execute(client: OkHttpClient, request: Request, receive: (Response) -> T): T {
    val call = client.newCall(request)
    synchronized(mutex) {
      if (cancelled) {call.cancel(); throw CancellationException("Share dismissed")}
      connection = call
    }
    var response: Response? = null
    try {
      ensureActive()
      response = call.execute()
      ensureActive()
      val result = receive(response)
      ensureActive()
      return result
    } catch (error: IOException) {ensureActive(); throw error}
    finally {
      call.cancel()
      runCatching {response?.close()}
      synchronized(mutex) {if (connection === call) connection = null}
    }
  }

  companion object {
    const val TIMEOUT_MESSAGE = "Request timed out, please try again."
    const val FAILURE_MESSAGE = "Collection failed, please try again."
  }
}
