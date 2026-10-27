package com.slax.reader.platform

import java.io.InputStream
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** The one document a PDF Reader page may read: `/pdf/<key>/<documentId>/<size>` on the page's own origin. */
internal class SlaxPdfSource private constructor(val key: String, val id: String, val owner: String?, val documentId: String, val size: Long) {
  val path get() = "/pdf/$key/$documentId/$size"
  override fun equals(other: Any?) = other is SlaxPdfSource && other.key == key && other.id == id && other.owner == owner && other.documentId == documentId && other.size == size
  override fun hashCode() = path.hashCode()
  companion object {
    fun parse(raw: Map<*, *>?): SlaxPdfSource? {
      if (raw == null) return null
      val id = (raw["id"] as? String)?.takeIf { SlaxOfflineTask.validId(it) } ?: return null
      val owner = raw["collectionOwner"] as? String
      if (owner != null && !SlaxOfflineTask.validId(owner)) return null
      val documentId = (raw["documentId"] as? String)?.takeIf { Regex("^[A-Za-z0-9_-]{1,256}$").matches(it) } ?: return null
      val size = SlaxOfflineValues.int(raw["size"])?.takeIf { it in 1..SlaxPdfDescriptor.MAX_BYTES } ?: return null
      val key = SlaxOfflineTask.key(id, owner).takeIf { SlaxOfflineTask.validKey(it) } ?: return null
      return SlaxPdfSource(key, id, owner, documentId, size)
    }
  }
}

/** A response for an intercepted PDF request, converted to `WebResourceResponse` by the view. */
internal class SlaxPdfResponse(val status: Int, val headers: Map<String, String>, val body: InputStream) {
  val reason get() = when (status) {200 -> "OK"; 204 -> "No Content"; 206 -> "Partial Content"; 400 -> "Bad Request"; 403 -> "Forbidden"; 404 -> "Not Found"
    412 -> "Precondition Failed"; 416 -> "Range Not Satisfiable"; 503 -> "Service Unavailable"; 504 -> "Gateway Timeout"; else -> if (status >= 500) "Bad Gateway" else "Error"}
  val mimeType get() = headers["Content-Type"] ?: "application/pdf"
}

/**
 * Serves PDF byte ranges to the page of one PDF Reader host from the offline engine session of its resource owner. URLs carry only
 * opaque identifiers; the bound source and owner decide what may be read. Called on WebView request threads, which may block.
 */
internal class SlaxPdfRanges(private val engine: () -> SlaxOfflineEngine, private val origin: String, private val scope: () -> Pair<SlaxPdfSource, String>?) {
  private class Pending(val owner: String, val requestId: String, val reply: SlaxOfflineReply)
  private val pending = ConcurrentHashMap<String, Pending>()
  @Volatile private var closed = false

  /** Null when [url] is not a PDF byte request of this page's origin. */
  fun handle(url: String, method: String, headers: Map<String, String>): SlaxPdfResponse? {
    val uri = runCatching { URI(url) }.getOrNull() ?: return null
    val base = URI(origin)
    if (uri.scheme != base.scheme || uri.rawAuthority != base.rawAuthority || uri.rawUserInfo != null || uri.rawFragment != null) return null
    val path = uri.rawPath ?: return null
    if (path.startsWith("/pdf-cancel/")) {
      val id = path.removePrefix("/pdf-cancel/")
      if (validRequest(id)) cancel(id)
      return respond(204, emptyMap(), null)
    }
    if (!path.startsWith("/pdf/")) return null
    if (closed) return failure(403, SlaxOfflineError.revoked.code)
    val (source, owner) = scope() ?: return failure(403, SlaxOfflineError.revoked.code)
    if (path != source.path || method !in listOf("GET", "HEAD")) return failure(404, SlaxOfflineError.invalid.code)
    if (method == "HEAD") return respond(200, mapOf("Content-Length" to source.size.toString(), "Accept-Ranges" to "bytes"), null)
    val page = (uri.rawQuery ?: "").split('&').firstOrNull { it.startsWith("request=") }?.removePrefix("request=") ?: ""
    if (!validRequest(page)) return failure(400, SlaxOfflineError.invalid.code)
    val named = headers.entries.firstOrNull { it.key.equals("X-Slax-Range", true) }?.value
    val standard = headers.entries.firstOrNull { it.key.equals("Range", true) }?.value
    val bounds = (named ?: standard)?.let { range(it, source.size) }
      ?: return respond(416, mapOf("Content-Range" to "bytes */${source.size}", "Content-Type" to "application/json"), "{\"code\":\"http_range_not_satisfiable\",\"status\":416}".toByteArray())
    if (bounds.second - bounds.first > PDF_WINDOW) return failure(416, "http_range_not_satisfiable")
    val range = SlaxPdfRange(source.key, source.id, source.owner, source.documentId, source.size, bounds.first, bounds.second)
    val latch = CountDownLatch(1)
    var value: Any? = null; var error: SlaxOfflineError? = null
    val reply = SlaxOfflineReply.native { result, failure -> value = result; error = failure; latch.countDown() }
    val requestId = "pdf-range-${sequence.incrementAndGet()}"
    pending[page] = Pending(owner, requestId, reply)
    try {
      try {engine().servePdfRange(owner, range, requestId, reply)} catch (_: Exception) {reply.fail(SlaxOfflineError.unavailable)}
      try {if (!latch.await(150, TimeUnit.SECONDS)) {cancel(page, SlaxOfflineError.timeout); latch.await(1, TimeUnit.SECONDS)}}
      catch (_: InterruptedException) {cancel(page); Thread.currentThread().interrupt()}
    } finally {pending.remove(page)}
    val bytes = value as? ByteArray
    val failed = error
    return when {
      bytes != null && bytes.size.toLong() == range.end - range.begin -> respond(206, mapOf("Content-Range" to "bytes ${range.begin}-${range.end - 1}/${range.size}", "Content-Length" to bytes.size.toString(), "Accept-Ranges" to "bytes"),
        null, if (named == null && standard != null) SkippedSlice(bytes, range.begin) else bytes.inputStream())
      failed != null -> failure(status(failed), failed.code, failed.status)
      else -> failure(502, if (bytes != null) "pdf_length_invalid" else SlaxOfflineError.cancelled.code)
    }
  }
  /** Releases every request of this host (document replaced or view detached); the engine stops its work. */
  fun cancelAll() {pending.keys.toList().forEach { cancel(it) }}
  fun close() {closed = true; cancelAll()}
  private fun cancel(page: String, reason: SlaxOfflineError = SlaxOfflineError.cancelled) {
    val entry = pending.remove(page) ?: return
    entry.reply.fail(reason)
    runCatching { engine().cancel(entry.owner, entry.requestId) }
  }
  private fun failure(status: Int, code: String, reported: Int = 0): SlaxPdfResponse =
    respond(status, mapOf("Content-Type" to "application/json"), SlaxOfflineJson.encode(if (reported > 0) mapOf("code" to code, "status" to reported) else mapOf("code" to code)).toByteArray())
  private fun respond(status: Int, headers: Map<String, String>, body: ByteArray?, stream: InputStream? = null): SlaxPdfResponse {
    val fields = linkedMapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff", "Content-Type" to "application/pdf")
    fields.putAll(headers)
    if (!fields.containsKey("Content-Length")) fields["Content-Length"] = (body?.size ?: 0).toString()
    return SlaxPdfResponse(status, fields, stream ?: (body ?: ByteArray(0)).inputStream())
  }

  /**
   * The slice of a standard `Range` request. WebView itself parses that header, sizes the body from `available()` and skips
   * `begin` bytes of the stream, so the stream presents the whole document while yielding only the slice after the skip.
   */
  internal class SkippedSlice(private val bytes: ByteArray, private val begin: Long) : InputStream() {
    private var position = 0L
    override fun available(): Int = (begin + bytes.size - position).coerceIn(0, Int.MAX_VALUE.toLong()).toInt()
    override fun skip(n: Long): Long {
      if (n <= 0 || position >= begin) return 0
      val skipped = minOf(n, begin - position); position += skipped; return skipped
    }
    override fun read(): Int {
      val index = position - begin
      if (index < 0 || index >= bytes.size) return -1
      position++; return bytes[index.toInt()].toInt() and 0xff
    }
    override fun read(target: ByteArray, offset: Int, length: Int): Int {
      val index = position - begin
      if (index < 0 || index >= bytes.size) return -1
      if (length == 0) return 0
      val count = minOf(length.toLong(), bytes.size - index).toInt()
      System.arraycopy(bytes, index.toInt(), target, offset, count); position += count; return count
    }
  }

  companion object {
    private val sequence = AtomicLong()
    fun validRequest(value: String) = Regex("^[A-Za-z0-9_-]{1,128}$").matches(value)
    /** `bytes=<begin>-<end>` or `bytes=<begin>-`, clamped to the document; null when unsatisfiable or not a single range. */
    fun range(header: String, size: Long): Pair<Long, Long>? {
      val match = Regex("^bytes=([0-9]{1,16})-([0-9]{0,16})$").matchEntire(header) ?: return null
      val begin = match.groupValues[1].toLong()
      if (begin >= size) return null
      val last = if (match.groupValues[2].isEmpty()) size - 1 else match.groupValues[2].toLong()
      if (last < begin) return null
      return begin to minOf(last, size - 1) + 1
    }
    fun status(error: SlaxOfflineError): Int {
      if (error.status in 400..599 && !error.integrity) return error.status
      return when (error.code) {
        SlaxOfflineError.revoked.code -> 403
        SlaxOfflineError.network.code, SlaxOfflineError.credential.code, SlaxOfflineError.busy.code, SlaxOfflineError.cancelled.code -> 503
        SlaxOfflineError.timeout.code -> 504
        SlaxOfflineError.invalid.code -> 400
        else -> 502
      }
    }
  }
}
