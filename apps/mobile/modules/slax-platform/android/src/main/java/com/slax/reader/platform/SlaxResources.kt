package com.slax.reader.platform

import android.content.Context
import android.webkit.WebResourceResponse
import java.io.File
import java.io.InputStream
import java.io.FilterInputStream
import okhttp3.OkHttpClient
import okhttp3.CookieJar
import okhttp3.Authenticator
import okhttp3.Call
import okhttp3.Request
import okhttp3.Response
import java.util.concurrent.TimeUnit
import java.security.MessageDigest
import org.json.JSONObject

class SlaxResources(private val context: Context, private val hasResourceOwnership: () -> Boolean = { true }) {
  @Volatile var cacheKey = ""
  @Volatile var resourceOwner: String? = null
  @Volatile private var fixtureDirectory: File? = null
  val isFixture: Boolean get() = fixtureDirectory != null
  fun setFixtureDirectory(directory: String?) {
    fixtureDirectory = null
    if (directory == null) return
    require(context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) { "Fixtures require a development build" }
    val uri = android.net.Uri.parse(directory)
    require(uri.scheme == "file") { "Fixture cache must be a file URI" }
    val resolved = File(requireNotNull(uri.path)).canonicalFile
    val allowed = File(context.cacheDir, "slax-ui-fixtures").canonicalFile.path + File.separator
    require(resolved.path.startsWith(allowed)) { "Fixture cache is outside the isolated scope" }
    val marker = JSONObject(File(resolved, "slax-fixture.json").readText())
    require(marker.optBoolean("controlledFixture") && marker.optInt("fixtureVersion") == 1) { "Unrecognized fixture marker" }
    fixtureDirectory = resolved
  }
  val displayDensity = context.resources.displayMetrics.density.toDouble()
  private val streams = java.util.Collections.synchronizedSet(mutableSetOf<InputStream>())
  @Volatile internal var security: SlaxReaderSecurity? = null
  private val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
    .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
    .followRedirects(false).followSslRedirects(false).cache(null)
    .connectTimeout(30, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
  private val connections = java.util.Collections.synchronizedSet(mutableSetOf<Call>())
  private val images = mutableSetOf<SlaxImageRegistry.Consumer>()
  private val ownership = Any()
  private var generation = 0L
  private var closed = false
  fun cancelAll() = cancel(false)
  fun close() = cancel(true)
  private fun cancel(permanent: Boolean) {
    val (previousStreams, previousConnections, previousImages) = synchronized(ownership) {
      if (permanent) closed = true
      generation++
      val previousStreams = synchronized(streams) { streams.toList().also { streams.clear() } }
      val previousConnections = synchronized(connections) { connections.toList().also { connections.clear() } }
      Triple(previousStreams, previousConnections, images.toList().also {images.clear()})
    }
    previousImages.forEach {it.close()}; previousConnections.forEach { it.cancel() }; previousStreams.forEach { runCatching { it.close() } }
  }
  private fun cacheFile(original: String, legacy: Boolean = false): File? {
    val hash = MessageDigest.getInstance("MD5").digest(original.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }
    val candidate = original.substringAfterLast('.', "").substringBefore('?').substringBefore('&').take(10).lowercase().ifEmpty { "jpg" }
    val extension = if (legacy) candidate else candidate.takeIf { !it.contains("..") && it.none { char -> char == '/' || char == '\\' || char.code < 32 || char.code == 127 } } ?: "jpg"
    return SlaxCachePaths.file(fixtureDirectory ?: context.dataDir, cacheKey, "$hash.$extension")
  }
  private fun denied() = WebResourceResponse("text/plain", "UTF-8", java.io.ByteArrayInputStream(ByteArray(0)))
  fun intercept(custom: String, requestHeaders: Map<String, String> = emptyMap(), privateImage: Boolean = false): WebResourceResponse? {
    val policy = security ?: return denied()
    val cachedTransport = custom.startsWith("slaxstatic:", true) || custom.startsWith("slaxstatics:", true)
    val media = !privateImage && (custom.startsWith("slaxmedia:") || custom.startsWith("slaxmedias:"))
    if (!cachedTransport && !privateImage && !media) return synchronized(ownership) { if (!closed && !isFixture && hasResourceOwnership() && policy.allows(custom)) null else denied() }
    val original = (if (media) policy.mediaOriginal(custom) else policy.imageOriginal(custom)) ?: return denied()
    val range = if (media) requestHeaders.entries.firstOrNull { it.key.equals("Range", true) }?.value else null
    if (range != null && !SlaxReaderSecurity.validRange(range)) return denied()
    val expectedGeneration = synchronized(ownership) { if (closed || !hasResourceOwnership()) return denied(); generation }
    val cache = if (cachedTransport) cacheFile(original) else null
    for (existing in if (cachedTransport) listOfNotNull(cache, cacheFile(original, legacy = true)).distinct() else emptyList()) {
      if (existing.isFile && existing.length() > 0) runCatching {
        val stream = tracked(existing.inputStream(), expectedGeneration)
        return WebResourceResponse(java.net.URLConnection.guessContentTypeFromName(existing.name) ?: "image/jpeg", null, stream)
      }
    }
    if (fixtureDirectory != null) return denied()
    if (!media) return image(original, policy, expectedGeneration, cache, privateImage)
    var opened: Call? = null
    var response: Response? = null
    return try {
      var url = original
      var redirects = 0
      fun permits(target: String) = policy.allowsMediaHop(target)
      while (true) {
        check(permits(url)) { "Reader destination denied" }
        val request = Request.Builder().url(url).header("Accept-Encoding", "identity")
        if (range != null) request.header("Range", range)
        val call = client.newBuilder().readTimeout(120, TimeUnit.SECONDS).build().newCall(request.build()); opened = call
        synchronized(ownership) { check(!closed && hasResourceOwnership() && generation == expectedGeneration); connections.add(call) }
        val received = call.execute(); response = received
        if (received.code !in listOf(301, 302, 303, 307, 308)) break
        val target = received.header("Location")?.let { received.request.url.resolve(it)?.toString() }
        received.close(); response = null; connections.remove(call); opened = null
        check(target != null && ++redirects <= 10 && permits(target)) { "Reader redirect denied" }
        url = target
      }
      val connection = requireNotNull(opened)
      val received = requireNotNull(response)
      check(permits(received.request.url.toString()))
      if (received.code == 416) {
        val contentRange = received.header("Content-Range")
        check(contentRange != null && Regex("^bytes \\*/[0-9]+$").matches(contentRange))
        received.close(); connections.remove(connection); opened = null; response = null
        return WebResourceResponse("text/plain", "UTF-8", 416, "Range Not Satisfiable", mapOf("Content-Range" to contentRange), java.io.ByteArrayInputStream(ByteArray(0)))
      }
      check(received.code in 200..299)
      val body = requireNotNull(received.body); val byteLimit = 128L * 1024 * 1024
      val mime = body.contentType()?.let { "${it.type}/${it.subtype}" }
      check(mime in listOf("video/mp4", "video/webm", "video/ogg") && body.contentLength() <= byteLimit) { "Reader resource rejected" }
      if (received.code == 206) check(received.header("Content-Range")?.matches(Regex("^bytes [0-9]+-[0-9]+/[0-9]+$")) == true)
      val stream = object : FilterInputStream(body.byteStream()) {
        private var closed = false
        private var receivedBytes = 0L
        private fun active() = synchronized(ownership) { check(!closed && !this@SlaxResources.closed && hasResourceOwnership() && generation == expectedGeneration) { "Reader page detached" } }
        private fun count(size: Int) {receivedBytes += size; if (receivedBytes > byteLimit) throw java.io.IOException("Reader media too large")}
        override fun read(): Int {active(); val value = `in`.read(); active(); if (value >= 0) count(1); return value}
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {active(); val size = `in`.read(buffer, offset, length); active(); if (size > 0) count(size); return size}
        @Synchronized override fun close() {
          if (closed) return; closed = true
          try {super.close()} finally {streams.remove(this); connections.remove(connection); received.close(); connection.cancel()}
        }
      }
      val attached = synchronized(ownership) { if (closed || !hasResourceOwnership() || generation != expectedGeneration) false else { streams.add(stream); true } }
      if (!attached) { stream.close(); error("Reader page detached") }
      opened = null; response = null
      val headers = received.headers.toMultimap().filterKeys { !it.equals("Set-Cookie", true) && !it.equals("Set-Cookie2", true) }.mapValues { it.value.joinToString(", ") } + mapOf("X-Content-Type-Options" to "nosniff", "Content-Security-Policy" to "sandbox; default-src 'none'")
      WebResourceResponse(mime ?: "application/octet-stream", body.contentType()?.charset()?.name(), received.code, received.message.ifBlank { "OK" }, headers, stream)
    } catch (_: Exception) {response?.close(); opened?.let { connections.remove(it); it.cancel() }; denied()}
  }
  private fun image(original: String, policy: SlaxReaderSecurity, expectedGeneration: Long, cache: File?, strict: Boolean): WebResourceResponse {
    val owner = resourceOwner ?: return denied()
    val key = cacheKey
    fun active() = synchronized(ownership) {
      check(!closed && hasResourceOwnership() && generation == expectedGeneration && key == cacheKey && resourceOwner == owner && security === policy) {"Reader page detached"}
    }
    var consumer: SlaxImageRegistry.Consumer? = null
    return try {
      active()
      val owned = SlaxImageResources.registry(context).acquire(owner, original, policy, strict); consumer = owned
      synchronized(ownership) {active(); images.add(owned)}
      val resource = owned.await(); active()
      if (cache != null && downloadImagesEnabled()) {
        try {owned.persist(context.dataDir, cache.relativeTo(context.dataDir).invariantSeparatorsPath) {active(); check(cacheFile(original) == cache)}}
        catch (_: Exception) {active(); owned.check()}
      }
      active()
      val input = owned.stream()
      val released = object : FilterInputStream(input) {
        override fun close() {try {super.close()} finally {synchronized(ownership) {images.remove(owned)}}}
      }
      val stream = tracked(released, expectedGeneration)
      WebResourceResponse(resource.mime ?: "image/jpeg", null, 200, "OK", mapOf("Content-Length" to resource.size.toString(), "X-Content-Type-Options" to "nosniff", "Content-Security-Policy" to "sandbox; default-src 'none'"), stream)
    } catch (_: Exception) {
      consumer?.close(); synchronized(ownership) {images.remove(consumer)}; denied()
    }
  }
  private fun tracked(input: InputStream, expectedGeneration: Long): InputStream {
    val stream = object : FilterInputStream(input) {
      private var ended = false
      private fun active() = synchronized(ownership) { check(!ended && !closed && hasResourceOwnership() && generation == expectedGeneration) { "Reader page detached" } }
      override fun read(): Int { active(); return `in`.read() }
      override fun read(buffer: ByteArray, offset: Int, length: Int): Int { active(); return `in`.read(buffer, offset, length) }
      override fun close() { ended = true; try { super.close() } finally { streams.remove(this) } }
    }
    val attached = synchronized(ownership) { if (closed || !hasResourceOwnership() || generation != expectedGeneration) false else { streams.add(stream); true } }
    if (!attached) { stream.close(); error("Reader page detached") }; return stream
  }
  private fun downloadImagesEnabled(): Boolean = runCatching {
    val preferences = File(context.filesDir, "slax.preferences.v1.json")
    !preferences.exists() || JSONObject(preferences.readText()).getJSONObject("values").optInt("download_images", 1) != 0
  }.getOrDefault(true)
}
