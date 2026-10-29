package com.slax.reader.extension

import java.net.URI
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import org.json.JSONObject

internal fun JSONObject.field(name: String, value: Any?): JSONObject = put(name, value ?: JSONObject.NULL)

internal class ShareDiagnosticRecord(private val app: String, private val os: String, startedAt: Long? = null, private val wallTime: Long = System.currentTimeMillis(), private val clock: () -> Long = System::nanoTime) {
  val share = UUID.randomUUID().toString().replace("-", "").take(8)
  private val started = startedAt ?: clock()
  private var stageStarted = started
  private var requestStarted: Long? = null
  var stage = "context"; private set
  var reason = "network_other"
  var input = input(null, null, null, null, null)
  var prefs = JSONObject().put("store", "none").field("error", null).put("signOutPending", false)
  var token = token(null)
  var env = "default"
  var host: String? = null
    set(value) {field = host(value)}
  var http: JSONObject? = null
  var error: JSONObject? = null
  private var extractMs: Long? = null
  private var prefsMs: Long? = null
  private fun elapsed(start: Long, end: Long) = ((end - start) / 1_000_000).coerceAtLeast(0)
  fun moveTo(next: String, now: Long = clock()) {
    if (stage == "extract") extractMs = elapsed(stageStarted, now)
    if (stage == "prefs") prefsMs = elapsed(stageStarted, now)
    if (next == "request" && requestStarted == null) requestStarted = now
    stage = next; stageStarted = now
  }
  fun common(event: String, ts: String = timestamp()): JSONObject = JSONObject().put("v", 1).put("ts", ts).put("src", "share-android").put("launch", share).put("app", app).put("os", os).put("event", event)
  fun start(): JSONObject = common("share.start", timestamp(wallTime)).put("share", share)
  fun end(outcome: String, shown: String, net: JSONObject, now: Long = clock(), wallTime: Long = System.currentTimeMillis()): JSONObject {
    return common("share.end", timestamp(wallTime)).put("share", share).put("outcome", outcome).put("stage", stage).put("reason", reason)
      .put("input", input).put("prefs", prefs).put("token", token).put("env", env).field("host", host).field("http", http).field("error", error).put("net", net)
      .put("ms", JSONObject().field("extract", if (stage == "extract") elapsed(stageStarted, now) else extractMs).field("prefs", if (stage == "prefs") elapsed(stageStarted, now) else prefsMs).field("request", requestStarted?.let {elapsed(it, now)}).put("total", elapsed(started, now)))
      .put("shown", shownMessage(shown))
  }
  companion object {
    const val LINE_LIMIT = 4096
    const val DAILY_ALLOWANCE = 524288L
    private val timeFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSxxx", Locale.US)
    fun timestamp(wallTime: Long = System.currentTimeMillis()): String = OffsetDateTime.ofInstant(java.time.Instant.ofEpochMilli(wallTime), java.time.ZoneId.systemDefault()).format(timeFormat)
    private val fixedMessages = setOf("Collecting", "Success!", "Not support content", "Not have share content", "Not have URL content to collect.", "Not have auth info, please login first.", "Collection failed, please try again.", "Auth expired, please reopen the app to login again.", "Request timed out, please try again.", "Network unavailable, please check your connection.")
    fun shownMessage(message: String): String = if (message in fixedMessages) message else "[redacted]"
    fun line(record: JSONObject): ByteArray? {
      encode(record)?.let {return it}
      if (record.optString("event") != "share.end") return null
      val compact = JSONObject()
      for (key in listOf("v", "ts", "src", "launch", "event", "share", "outcome", "stage", "reason", "env", "ms", "shown")) compact.field(key, record.opt(key))
      for (key in listOf("app", "os")) compact.field(key, (record.opt(key) as? String)?.take(64))
      for (key in listOf("input", "prefs", "token", "host", "http", "error", "net")) compact.field(key, null)
      return encode(compact)
    }
    private fun encode(record: JSONObject): ByteArray? = (record.toString() + "\n").toByteArray(Charsets.UTF_8).takeIf {it.size <= LINE_LIMIT}
    fun host(value: String?): String? = value?.takeIf {
      it.length in 1..255 && (it.matches(Regex("[A-Za-z0-9_.-]+")) ||
        (it.contains(':') && it.matches(Regex("[0-9A-Fa-f:.\\[\\]]+")) && runCatching {URI("http://${if (it.startsWith("[")) it else "[$it]"}").host != null}.getOrDefault(false)))
    }
    fun urlIndex(text: String?): Int = listOf(text?.indexOf("http://") ?: -1, text?.indexOf("https://") ?: -1).filter {it >= 0}.minOrNull() ?: -1
    fun input(action: String?, mime: String?, text: String?, subject: String?, referrer: String?): JSONObject = JSONObject().field("action", action?.take(80)).field("mime", mime?.take(80)).put("textLength", text?.length ?: 0).put("urlIndex", urlIndex(text)).put("subject", subject != null).field("referrer", host(referrer)).field("url", null).put("title", subject != null)
    fun url(value: String): JSONObject {
      val uri = runCatching {URI(value)}.getOrNull()
      return JSONObject().field("scheme", uri?.scheme?.takeIf {it.length <= 16}).field("host", host(uri?.host)).put("length", value.length)
    }
    fun token(value: String?): JSONObject = JSONObject().put("present", !value.isNullOrEmpty()).put("len", value?.length ?: 0).apply {if (value != null && value.length > 4) put("tail4", value.takeLast(4))}
    fun http(status: Int, body: String?, cfRay: String?): JSONObject {
      val parsed = body?.takeIf {it.toByteArray(Charsets.UTF_8).size <= 16384}?.let {runCatching {JSONObject(it)}.getOrNull()}
      val name = (parsed?.opt("data") as? String)?.takeIf {it.matches(Regex("[A-Za-z_][A-Za-z0-9_.-]{0,127}"))}
      val code = parsed?.opt("code").let {if (it is Number) it else (it as? String)?.takeIf {value -> value.matches(Regex("[A-Za-z0-9_.-]{1,64}"))}}
      return JSONObject().put("status", status).field("errorName", name).field("code", code).field("cfRay", cfRay?.takeIf {it.matches(Regex("[A-Za-z0-9-]{1,128}"))})
    }
  }
}
