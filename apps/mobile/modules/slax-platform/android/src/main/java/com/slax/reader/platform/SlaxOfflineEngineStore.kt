package com.slax.reader.platform

import kotlinx.coroutines.Job
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/** Engine failure codes; they match the iOS engine and `DataErrorCode` and never contain credentials or content. */
internal class SlaxOfflineError(val code: String, val status: Int = 0, val retryAfter: Long = 0, val retryable: Boolean = false, val integrity: Boolean = false) : Exception(code) {
  override val message: String get() = if (status > 0) "$code ($status)" else code
  /** Mirrors `offlineFailure`: client errors except 408/429, protocol and integrity failures are not retried. */
  val denied get() = integrity || status in 400..499 && status != 408 && status != 429
  companion object {
    val cancelled get() = SlaxOfflineError("operation_cancelled")
    val revoked get() = SlaxOfflineError("session_changed")
    val network get() = SlaxOfflineError("network_unavailable", retryable = true)
    val timeout get() = SlaxOfflineError("request_timeout")
    val credential get() = SlaxOfflineError("credential_unavailable")
    val invalid get() = SlaxOfflineError("invalid_request")
    val unavailable get() = SlaxOfflineError("resource_unavailable")
    val busy get() = SlaxOfflineError("resource_busy", retryable = true)
    val oversized get() = SlaxOfflineError("offline_integrity_invalid", integrity = true)
    fun pdf(code: String, status: Int = 502) = SlaxOfflineError(code, status, integrity = true)
    fun http(status: Int, retryAfter: Long = 0): SlaxOfflineError {
      val code = when (status) {
        401 -> "http_unauthorized"; 403 -> "http_forbidden"; 404 -> "http_not_found"; 412 -> "http_precondition_failed"
        416 -> "http_range_not_satisfiable"; 429 -> "http_rate_limited"
        else -> if (status in 500..599) "http_server_error" else "http_error"
      }
      return SlaxOfflineError(code, status, retryAfter, retryable = status in 500..599 && retryAfter == 0L)
    }
    /** Storage failures become `session_changed` once the lease is revoked. */
    fun from(error: Throwable, lease: SlaxStorageLease? = null): SlaxOfflineError = when {
      error is SlaxOfflineError -> error
      lease != null && runCatching { lease.check() }.isFailure -> revoked
      error is IllegalArgumentException -> invalid
      else -> SlaxOfflineError("storage_failed")
    }
  }
}

internal object SlaxOfflineClock {
  fun now() = System.currentTimeMillis()
  /** `retryAfterMs`: delta seconds or an HTTP date, capped at seven days. */
  fun retryAfter(value: String?, now: Long = now()): Long {
    if (value.isNullOrEmpty()) return 0
    val delay = if (Regex("^[0-9]+$").matches(value)) (value.toDoubleOrNull() ?: 0.0) * 1000
      else runCatching { java.time.ZonedDateTime.parse(value, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - now }.getOrNull()?.toDouble() ?: return 0
    if (!delay.isFinite() || delay <= 0) return 0
    return minOf(delay, 7.0 * 24 * 60 * 60 * 1000).toLong()
  }
}

internal object SlaxOfflineValues {
  fun int(value: Any?): Long? {
    val number = (value as? Number)?.toDouble() ?: return null
    return if (number.isFinite() && Math.rint(number) == number && Math.abs(number) <= 9_007_199_254_740_991.0) number.toLong() else null
  }
  fun text(value: Any?, limit: Int): String? {
    val text = value as? String ?: return null
    return text.takeIf { it.isNotEmpty() && it.toByteArray(Charsets.UTF_8).size <= limit && it.none { ch -> ch.code < 32 || ch.code == 127 } }
  }
  fun json(bytes: ByteArray?): Any? = bytes?.let { runCatching { SlaxOfflineJson.decode(String(it, Charsets.UTF_8)) }.getOrNull() }
}

internal data class SlaxOfflineRetry(val attempts: Int, val retryAt: Long, val denied: Boolean, val code: String? = null, val version: String? = null) {
  fun json(): Map<String, Any?> = linkedMapOf<String, Any?>("a" to attempts, "t" to retryAt, "denied" to denied).also { value ->
    code?.let { value["code"] = it }; version?.let { value["version"] = it }
  }
  companion object {
    /** Port of `offlineFailure` in `offline-retry.ts`. */
    fun failure(previous: Int, error: SlaxOfflineError, now: Long, random: Double): SlaxOfflineRetry {
      val attempts = minOf(previous + 1, 30)
      val delay = minOf(300_000.0, 5000.0 * Math.pow(2.0, minOf(attempts - 1, 6).toDouble()))
      val jitter = if (random.isFinite()) random.coerceIn(0.0, 1.0) else 1.0
      val retryAt = minOf(9_007_199_254_740_991.0, Math.ceil(now + maxOf(delay * (0.8 + jitter * 0.2), maxOf(0L, error.retryAfter).toDouble())))
      return SlaxOfflineRetry(attempts, if (error.denied) 0 else retryAt.toLong(), error.denied, error.code)
    }
    fun parse(value: Any?): SlaxOfflineRetry? {
      val map = value as? Map<*, *> ?: return null
      val attempts = SlaxOfflineValues.int(map["a"]) ?: return null; val retryAt = SlaxOfflineValues.int(map["t"]) ?: return null
      val denied = map["denied"] as? Boolean ?: return null
      if (attempts !in 0..30 || retryAt < 0) return null
      return SlaxOfflineRetry(attempts.toInt(), retryAt, denied, SlaxOfflineValues.text(map["code"], 64), SlaxOfflineValues.text(map["version"], 256))
    }
  }
}

internal data class SlaxOfflineImage(val url: String, val state: String, val attempts: Int, val retryAt: Long) {
  fun eligible(now: Long) = state == "pending" || state == "failed" && retryAt <= now
}

/** `bookmark/<key>/offline.json`: `{v:2,id,owner,kind,version,size,images:[{u,s,a,t}],retry:{a,t,denied,code?,version?}}`; `version == null` marks adopted content. */
internal data class SlaxOfflineManifest(val id: String, val owner: String?, val kind: String, val version: String?, val size: Long, val images: List<SlaxOfflineImage>, val retry: SlaxOfflineRetry?) {
  fun encode(): ByteArray = SlaxOfflineJson.encode(linkedMapOf("v" to 2, "id" to id, "owner" to owner, "kind" to kind, "version" to version, "size" to size,
    "images" to images.map { linkedMapOf("u" to it.url, "s" to it.state, "a" to it.attempts, "t" to it.retryAt) }, "retry" to retry?.json())).toByteArray(Charsets.UTF_8)
  companion object {
    fun placeholder(task: SlaxOfflineTask) = SlaxOfflineManifest(task.id, task.collectionOwner, task.kind, null, 0, emptyList(), null)
    fun decode(bytes: ByteArray): SlaxOfflineManifest? {
      val value = SlaxOfflineValues.json(bytes) as? Map<*, *> ?: return null
      if (SlaxOfflineValues.int(value["v"]) != 2L) return null
      val id = value["id"] as? String ?: return null
      val kind = value["kind"] as? String ?: return null
      val size = SlaxOfflineValues.int(value["size"]) ?: return null
      val raw = value["images"] as? List<*> ?: return null
      if (id.isNotEmpty() && !SlaxOfflineTask.validId(id) || kind !in listOf("article", "pdf") || size < 0) return null
      val owner = value["owner"] as? String; val version = value["version"] as? String
      if (owner != null && !SlaxOfflineTask.validId(owner) || version != null && !SlaxOfflineTask.validVersion(version)) return null
      val images = raw.map { item ->
        val image = item as? Map<*, *> ?: return null
        val url = (image["u"] as? String)?.takeIf { it.toByteArray(Charsets.UTF_8).size <= 8192 } ?: return null
        val state = (image["s"] as? String)?.takeIf { it in listOf("pending", "ready", "failed", "denied") } ?: return null
        val attempts = SlaxOfflineValues.int(image["a"]) ?: return null; val retryAt = SlaxOfflineValues.int(image["t"]) ?: return null
        SlaxOfflineImage(url, state, attempts.coerceIn(0, 30).toInt(), maxOf(0, retryAt))
      }
      return SlaxOfflineManifest(id, owner, kind, version, size, images, if (value["retry"] == null) null else SlaxOfflineRetry.parse(value["retry"]))
    }
  }
}

internal data class SlaxOfflineTask(val key: String, val id: String, val collectionOwner: String?, val kind: String, val manual: Boolean, val version: String) {
  val domain get() = if (collectionOwner == null) "personal" else "collection"
  data class Access(val key: String, val id: String, val owner: String?)
  companion object {
    private val pattern = Regex("^[A-Za-z0-9_-]+$")
    fun validId(value: String) = value.length <= 200 && pattern.matches(value)
    fun validKey(value: String) = value.length <= 240 && pattern.matches(value)
    fun validVersion(value: String) = SlaxOfflineValues.text(value, 256) != null
    fun key(id: String, owner: String?) = if (owner != null) "collection-$owner-$id" else id
    /** Validates `{key, id, collectionOwner?}` and returns the owner context. */
    fun access(value: Map<*, *>): Access {
      val key = value["key"] as? String; val id = value["id"] as? String
      if (key == null || id == null || !validId(id)) throw SlaxOfflineError.invalid
      val owner = value["collectionOwner"] as? String
      if (owner != null && !validId(owner) || key(id, owner) != key || !validKey(key)) throw SlaxOfflineError.invalid
      return Access(key, id, owner)
    }
    fun parse(value: Map<*, *>): SlaxOfflineTask {
      val access = access(value)
      val kind = value["kind"] as? String; val version = value["version"] as? String
      if (kind !in listOf("article", "pdf") || version == null || !validVersion(version)) throw SlaxOfflineError.invalid
      return SlaxOfflineTask(access.key, access.id, access.owner, kind!!, value["manual"] as? Boolean ?: false, version)
    }
  }
}
internal class SlaxOfflineScope(val owner: String, val scope: String, val scopeId: String, val origin: String, val root: File, val pdfRoot: File,
  val userAgent: String, val clientType: String, val clientVersion: String, val policy: SlaxReaderSecurity, val allowHttp: Boolean) {
  companion object {
    fun parse(value: Map<*, *>, resolve: (String) -> Pair<File, File>, allowHttp: Boolean): SlaxOfflineScope {
      val owner = (value["owner"] as? String)?.takeIf { it.length <= 128 && Regex("^[A-Za-z0-9_-]+$").matches(it) } ?: throw SlaxOfflineError.invalid
      val scope = SlaxOfflineValues.text(value["scope"], 160) ?: throw SlaxOfflineError.invalid
      val uri = try {SlaxPdfTransfers.origin(value["origin"] as? String ?: "", allowHttp)} catch (_: Exception) {throw SlaxOfflineError.invalid}
      val scheme = uri.scheme.lowercase(); val host = uri.host.lowercase()
      val origin = "$scheme://$host" + if (uri.port >= 0) ":${uri.port}" else ""
      val directory = value["directory"] as? String ?: throw SlaxOfflineError.invalid
      val userAgent = SlaxOfflineValues.text(value["userAgent"], 256) ?: throw SlaxOfflineError.invalid
      val clientType = (value["clientType"] as? String)?.takeIf { it == "ios" || it == "android" } ?: throw SlaxOfflineError.invalid
      val clientVersion = SlaxOfflineValues.text(value["clientVersion"], 64) ?: throw SlaxOfflineError.invalid
      fun strings(raw: Any?): List<String>? = (raw as? List<*>)?.map { it as? String ?: throw SlaxOfflineError.invalid }
      val policy = try {SlaxReaderSecurity(strings(value["protectedHosts"]) ?: listOf(host), strings(value["imageProxyOrigins"]) ?: listOf(origin))} catch (_: Exception) {throw SlaxOfflineError.invalid}
      val scopeId = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(scope.toByteArray(Charsets.UTF_8))
      val (root, pdfRoot) = try {resolve(directory)} catch (_: Exception) {throw SlaxOfflineError.invalid}
      return SlaxOfflineScope(owner, scope, scopeId, origin, root, pdfRoot, userAgent, clientType, clientVersion, policy, allowHttp)
    }
  }
}

internal data class SlaxPdfDescriptor(val filename: String, val size: Long, val documentId: String, val source: String, val textStatus: String, val pages: Long?) {
  fun json(): Map<String, Any?> = linkedMapOf<String, Any?>("filename" to filename, "size" to size, "document_id" to documentId, "source" to source, "text_status" to textStatus).also { if (pages != null) it["pages"] = pages }
  fun result(id: String): Map<String, Any?> = json() + ("url" to "/v1/bookmark/pdf?bookmark_uid=$id")
  fun same(other: SlaxPdfDescriptor?) = other != null && other.documentId == documentId && other.size == size
  companion object {
    const val MAX_BYTES = 50L * 1024 * 1024
    fun parse(value: Any?): SlaxPdfDescriptor? {
      val pdf = value as? Map<*, *> ?: return null
      val documentId = SlaxOfflineValues.text(pdf["document_id"], 256) ?: return null
      val size = SlaxOfflineValues.int(pdf["size"])?.takeIf { it in 1..MAX_BYTES } ?: return null
      val filename = (pdf["filename"] as? String)?.takeIf { it.toByteArray(Charsets.UTF_8).size <= 4096 } ?: return null
      val source = (pdf["source"] as? String)?.takeIf { it in listOf("url", "upload") } ?: return null
      val textStatus = (pdf["text_status"] as? String)?.takeIf { it in listOf("pending", "ready", "empty", "failed") } ?: return null
      val pages = pdf["pages"]?.let { raw -> SlaxOfflineValues.int(raw)?.takeIf { it >= 1 } ?: return null }
      return SlaxPdfDescriptor(filename, size, documentId, source, textStatus, pages)
    }
  }
}

/** `pdf/v2/<scopeId>/<key>/part.json`; kept after completion as the identity record of `document.pdf`. */
internal data class SlaxPdfPart(val documentId: String, val size: Long, val committed: Long) {
  fun json(): Map<String, Any?> = linkedMapOf("document_id" to documentId, "size" to size, "committed" to committed)
  fun matches(descriptor: SlaxPdfDescriptor) = documentId == descriptor.documentId && size == descriptor.size
  companion object {
    fun parse(bytes: ByteArray?): SlaxPdfPart? {
      val value = SlaxOfflineValues.json(bytes) as? Map<*, *> ?: return null
      val documentId = SlaxOfflineValues.text(value["document_id"], 256) ?: return null
      val size = SlaxOfflineValues.int(value["size"])?.takeIf { it in 1..SlaxPdfDescriptor.MAX_BYTES } ?: return null
      val committed = SlaxOfflineValues.int(value["committed"])?.takeIf { it in 0..size } ?: return null
      return SlaxPdfPart(documentId, size, committed)
    }
  }
}

/** Paths of the engine layout and the small JSON records stored in it. */
internal class SlaxOfflineLayout(private val scopeId: String) {
  companion object {
    const val MANIFEST_LIMIT = 4 * 1024 * 1024
    fun bookmark(key: String) = "bookmark/$key"
    fun content(key: String) = "bookmark/$key/content.html"
    fun manifest(key: String) = "bookmark/$key/offline.json"
    fun images(key: String) = "bookmark/$key/images"
    fun readManifest(store: SlaxFileStore, key: String) = store.read(manifest(key), MANIFEST_LIMIT)?.let { SlaxOfflineManifest.decode(it) }
    fun writeManifest(store: SlaxFileStore, key: String, value: SlaxOfflineManifest) {
      val bytes = value.encode(); if (bytes.size > MANIFEST_LIMIT) throw SlaxOfflineError.oversized
      store.write(manifest(key), bytes)
    }
    fun decode(bytes: ByteArray): String = String(bytes, Charsets.UTF_8).removePrefix("\uFEFF")
  }
  fun pdf(key: String) = "pdf/v2/$scopeId/$key"
  fun descriptor(key: String) = pdf(key) + "/descriptor.json"
  fun document(key: String) = pdf(key) + "/document.pdf"
  fun partial(key: String) = pdf(key) + "/document.pdf.part"
  fun part(key: String) = pdf(key) + "/part.json"
  fun readDescriptor(store: SlaxFileStore, key: String) = SlaxPdfDescriptor.parse(SlaxOfflineValues.json(store.read(descriptor(key), 64 * 1024)))
  fun writeDescriptor(store: SlaxFileStore, key: String, value: SlaxPdfDescriptor) {store.write(descriptor(key), SlaxOfflineJson.encode(value.json()).toByteArray(Charsets.UTF_8))}
  fun readPart(store: SlaxFileStore, key: String) = SlaxPdfPart.parse(store.read(part(key), 4096))
  fun writePart(store: SlaxFileStore, key: String, value: SlaxPdfPart) {store.write(part(key), SlaxOfflineJson.encode(value.json()).toByteArray(Charsets.UTF_8))}
  /** Size of the committed document for a complete PDF identity, otherwise null. */
  fun completeDocument(store: SlaxFileStore, key: String): Pair<SlaxPdfPart, Long>? {
    val part = readPart(store, key)?.takeIf { it.committed == it.size } ?: return null
    val size = store.size(document(key))?.takeIf { it == part.size } ?: return null
    return part to size
  }
  /** The size that completes a manifest of this kind: `content.html` or the complete `document.pdf`. */
  fun contentSize(store: SlaxFileStore, key: String, kind: String): Long? = if (kind == "pdf") completeDocument(store, key)?.second else store.size(content(key))
}

/** Cancellation scope of one engine operation; its child lease gates every file commit made for it. */
internal class SlaxOfflineWork(val lease: SlaxStorageLease) {
  private val cancelled = AtomicBoolean(false)
  @Volatile var job: Job? = null
  private val hooks = java.util.concurrent.ConcurrentHashMap<Any, () -> Unit>()
  val isCancelled get() = cancelled.get()
  fun cancel() {
    if (!cancelled.compareAndSet(false, true)) return
    lease.cancel(); hooks.values.toList().forEach { runCatching { it() } }; hooks.clear(); job?.cancel()
  }
  fun attach(hook: () -> Unit): Any {val token = Any(); hooks[token] = hook; if (cancelled.get()) {hooks.remove(token); hook()}; return token}
  fun detach(token: Any) {hooks.remove(token)}
  fun check() {
    if (cancelled.get()) throw SlaxOfflineError.cancelled
    try {lease.check()} catch (_: Exception) {throw SlaxOfflineError.revoked}
  }
}
