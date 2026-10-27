package com.slax.reader.platform

import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.net.URI
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

internal class SlaxPdfTransferError(val code: String) : Exception("PDF transfer $code")

internal object SlaxPdfTransfers {
  const val CHUNK_BYTES = 64 * 1024
  const val MAX_BYTES = 50L * 1024 * 1024
  private const val MAX_TRANSFERS = 12
  private val lock = Any()
  private val active = ConcurrentHashMap<String, SlaxPdfTransfer>()
  private val workers = ThreadPoolExecutor(6, 6, 30, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(48)) { work -> Thread(work, "SlaxPdfTransfer").apply { isDaemon = true } }
  private val expiry = ScheduledThreadPoolExecutor(1) { work -> Thread(work, "SlaxPdfExpiry").apply { isDaemon = true } }.apply { removeOnCancelPolicy = true }
  internal val client: OkHttpClient = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).cookieJar(CookieJar.NO_COOKIES)
    .retryOnConnectionFailure(false).callTimeout(120, TimeUnit.SECONDS).connectTimeout(30, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build()

  fun begin(owner: String, origin: String, allowHttp: Boolean): String = synchronized(lock) {
    if (active.size >= MAX_TRANSFERS) throw SlaxPdfTransferError("busy")
    val lease = SlaxStorageOwner.capture(owner)
    val id = java.util.UUID.randomUUID().toString()
    val transfer = SlaxPdfTransfer(owner, origin, allowHttp, lease, client) { active.remove(id) }
    active[id] = transfer
    val timer = expiry.schedule({ end(owner, id) }, 120, TimeUnit.SECONDS)
    transfer.finished = { timer.cancel(false) }
    id
  }
  fun get(owner: String, id: String): SlaxPdfTransfer {
    val transfer = active[id]
    if (transfer == null || transfer.owner != owner) throw SlaxPdfTransferError("cancelled")
    return transfer
  }
  fun end(owner: String, id: String) {
    val transfer = active[id]?.takeIf { it.owner == owner } ?: return
    if (transfer.beginClose()) execute({ transfer.close() }, {})
  }
  fun revokeAll() {active.entries.toList().forEach { (id, transfer) -> end(transfer.owner, id) }}
  fun execute(work: () -> Unit, rejected: () -> Unit) {
    try {workers.execute(work)} catch (_: java.util.concurrent.RejectedExecutionException) {rejected()}
  }
  fun count() = active.size
  /** Accepts an HTTPS API origin, or a loopback HTTP origin in development builds. */
  fun origin(raw: String, allowHttp: Boolean): URI {
    val uri = runCatching { URI(raw) }.getOrElse { throw SlaxPdfTransferError("protocol") }
    val loopback = uri.host in listOf("127.0.0.1", "localhost", "[::1]", "::1", "10.0.2.2")
    if (uri.host.isNullOrEmpty() || uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null || uri.rawPath !in listOf("", "/") ||
      uri.scheme != "https" && !(allowHttp && uri.scheme == "http" && loopback)) throw SlaxPdfTransferError("protocol")
    return uri
  }
}

internal class SlaxPdfTransfer(
  val owner: String,
  private val origin: String,
  private val allowHttp: Boolean,
  private val lease: SlaxStorageLease,
  private val client: OkHttpClient,
  private val released: () -> Unit,
) {
  private val io = Any()
  private val cancelled = AtomicBoolean()
  private val reading = AtomicBoolean()
  private val opened = AtomicBoolean()
  private val ended = AtomicBoolean()
  private val submitted = AtomicBoolean()
  private val closing = AtomicBoolean()
  fun beginClose(): Boolean {cancel(); return closing.compareAndSet(false, true)}
  fun reserve(): Boolean = submitted.compareAndSet(false, true)
  fun completeOperation() {submitted.set(false)}
  @Volatile private var call: Call? = null
  @Volatile private var response: Response? = null
  @Volatile var finished: () -> Unit = {}
  private var received = 0L
  private var advertised: Long? = null

  init { validateOrigin(origin) }
  private fun validateOrigin(raw: String): URI = SlaxPdfTransfers.origin(raw, allowHttp)
  private fun check() {
    if (cancelled.get()) throw SlaxPdfTransferError("cancelled")
    try {lease.check()} catch (_: Exception) {throw SlaxPdfTransferError("cancelled")}
  }
  private fun request(url: String, headers: Map<String, String>): Request {
    val target = runCatching {URI(url)}.getOrElse {throw SlaxPdfTransferError("protocol")}
    val base = validateOrigin(origin)
    if (target.scheme != base.scheme || target.host != base.host || target.port != base.port || target.rawUserInfo != null || target.rawFragment != null ||
      target.rawPath != "/v1/bookmark/pdf" || !Regex("^bookmark_uid=[A-Za-z0-9_%.-]+$").matches(target.rawQuery ?: "")) throw SlaxPdfTransferError("protocol")
    val allowed = setOf("authorization", "accept", "range", "x-client-type", "x-client-version")
    val normalized = headers.mapKeys { it.key.lowercase() }
    if (normalized.size != headers.size || normalized.keys.any {it !in allowed} || normalized.values.any {it.length > 16384 || it.any {ch -> ch < ' ' || ch == '\u007f'}} ||
      normalized["authorization"]?.startsWith("Bearer ") != true || normalized["authorization"]!!.length <= 7 || normalized["accept"] != "application/pdf" ||
      !Regex("^bytes=[0-9]+-[0-9]+$").matches(normalized["range"] ?: "")) throw SlaxPdfTransferError("protocol")
    val builder = Request.Builder().url(url).get().header("Accept-Encoding", "identity")
    normalized.forEach { (key, value) -> builder.header(key, value) }
    return builder.build()
  }
  fun open(url: String, headers: Map<String, String>): Map<String, Any> = synchronized(io) {
    check()
    if (!opened.compareAndSet(false, true)) throw SlaxPdfTransferError("protocol")
    try {
      val pending = client.newCall(request(url, headers)); call = pending; check()
      val result = pending.execute(); response = result; check()
      val selected = linkedMapOf<String, String>()
      for (name in listOf("Content-Type", "Content-Length", "Content-Range", "ETag", "Retry-After", "Content-Encoding")) result.header(name)?.let {
        if (it.length > 8192) throw SlaxPdfTransferError("protocol")
        selected[name] = it
      }
      if (result.code in listOf(200, 206)) {
        advertised = result.header("Content-Length")?.let {value -> value.toLongOrNull()?.takeIf {it in 1..SlaxPdfTransfers.MAX_BYTES} ?: throw SlaxPdfTransferError("limit")}
        if (result.header("Content-Encoding")?.let {it != "identity"} == true) throw SlaxPdfTransferError("protocol")
      }
      mapOf("status" to result.code, "headers" to selected)
    } catch (error: Exception) {
      cancel(); closeLocked()
      throw if (error is SlaxPdfTransferError) error else SlaxPdfTransferError("network")
    }
  }
  fun read(): ByteArray? {
    if (!reading.compareAndSet(false, true)) throw SlaxPdfTransferError("protocol")
    try {
      return synchronized(io) {
        check()
        val body = response?.body ?: throw SlaxPdfTransferError("protocol")
        val buffer = ByteArray(SlaxPdfTransfers.CHUNK_BYTES)
        try {
          val count = body.byteStream().read(buffer); check()
          if (count < 0) {
            if (advertised != null && received != advertised) throw SlaxPdfTransferError("protocol")
            closeLocked(); return@synchronized null
          }
          received += count
          if (received > SlaxPdfTransfers.MAX_BYTES || advertised?.let {received > it} == true) throw SlaxPdfTransferError("limit")
          buffer.copyOf(count)
        } catch (error: Exception) {
          cancel(); closeLocked()
          throw if (error is SlaxPdfTransferError) error else SlaxPdfTransferError("network")
        }
      }
    } finally {reading.set(false)}
  }
  fun cancel() {cancelled.set(true); lease.cancel(); call?.cancel()}
  fun close() = synchronized(io) {closeLocked()}
  private fun closeLocked() {
    response?.close(); response = null
    if (ended.compareAndSet(false, true)) {finished(); released()}
  }
}
