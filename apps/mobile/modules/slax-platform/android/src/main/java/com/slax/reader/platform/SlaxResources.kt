package com.slax.reader.platform

import android.content.Context
import android.webkit.WebResourceResponse
import java.io.File
import java.io.InputStream
import java.io.FilterInputStream
import java.io.FileOutputStream
import okhttp3.OkHttpClient
import okhttp3.CookieJar
import okhttp3.Authenticator
import okhttp3.Call
import okhttp3.Request
import okhttp3.Response
import java.util.concurrent.TimeUnit
import java.security.MessageDigest
import org.json.JSONObject

internal object SlaxCachePaths {
  fun file(root: File, key: String, name: String): File? = runCatching {
    if (!Regex("^[A-Za-z0-9_-]+$").matches(key) || !Regex("^[a-f0-9]{32}\\..+$").matches(name) || name.length > 64 || name.any { it == '\\' || it.code < 32 || it.code == 127 }) return null
    val parts = name.split('/')
    if (parts.any { it.isEmpty() || it == "." || it == ".." }) return null
    var current = root.canonicalFile
    for (part in listOf("bookmark", key, "images") + parts) {
      current = File(current, part)
      if (current.canonicalFile != current.absoluteFile || java.nio.file.Files.isSymbolicLink(current.toPath())) return null
    }
    current
  }.getOrNull()
}

class SlaxResources(private val context: Context, private val hasResourceOwnership: () -> Boolean = { true }) {
  @Volatile var cacheKey = ""
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
  private val ownership = Any()
  private var generation = 0L
  private var closed = false
  fun cancelAll() = cancel(false)
  fun close() = cancel(true)
  private fun cancel(permanent: Boolean) {
    val (previousStreams, previousConnections) = synchronized(ownership) {
      if (permanent) closed = true
      generation++
      val previousStreams = synchronized(streams) { streams.toList().also { streams.clear() } }
      val previousConnections = synchronized(connections) { connections.toList().also { connections.clear() } }
      previousStreams to previousConnections
    }
    previousConnections.forEach { it.cancel() }; previousStreams.forEach { runCatching { it.close() } }
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
    var opened: Call? = null
    var response: Response? = null
    var failedOutput: FileOutputStream? = null
    var failedTemporary: File? = null
    return try {
      var url = original
      var redirects = 0
      fun permits(target: String) = if (media) policy.allowsMediaHop(target) else policy.imageOriginal(target) != null
      while (true) {
        check(permits(url)) { "Reader destination denied" }
        val request = Request.Builder().url(url)
        if (media) { request.header("Accept-Encoding", "identity"); if (range != null) request.header("Range", range) }
        val call = (if (media) client.newBuilder().readTimeout(120, TimeUnit.SECONDS).build() else client).newCall(request.build()); opened = call
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
      if (media && received.code == 416) {
        val contentRange = received.header("Content-Range")
        check(contentRange != null && Regex("^bytes \\*/[0-9]+$").matches(contentRange))
        received.close(); connections.remove(connection); opened = null; response = null
        return WebResourceResponse("text/plain", "UTF-8", 416, "Range Not Satisfiable", mapOf("Content-Range" to contentRange), java.io.ByteArrayInputStream(ByteArray(0)))
      }
      check(received.code in 200..299)
      val body = requireNotNull(received.body)
      val strictImage = privateImage || policy.signedImageProxy(original) || policy.signedImageProxy(received.request.url.toString())
      val byteLimit = if (media) 128L * 1024 * 1024 else if (strictImage) 20L * 1024 * 1024 else Long.MAX_VALUE
      val mime = body.contentType()?.let { "${it.type}/${it.subtype}" }
      check((if (media) mime in listOf("video/mp4", "video/webm", "video/ogg") else body.contentType()?.type == "image" || !strictImage && mime == null) && body.contentLength() <= byteLimit) { "Reader resource rejected" }
      if (media && received.code == 206) check(received.header("Content-Range")?.matches(Regex("^bytes [0-9]+-[0-9]+/[0-9]+$")) == true)
      var output: FileOutputStream? = null
      var temporary: File? = null
      if (cache != null && received.code == 200 && downloadImagesEnabled()) {
        synchronized(ownership) {
          check(!closed && hasResourceOwnership() && generation == expectedGeneration) { "Reader page detached" }
          runCatching { check(cacheFile(original) == cache); cache.parentFile?.mkdirs(); check(cacheFile(original) == cache); temporary = File.createTempFile("slax-", ".download", cache.parentFile); failedTemporary = temporary; output = FileOutputStream(temporary); failedOutput = output }
        }
      }
      val stream = object : FilterInputStream(body.byteStream()) {
        private var complete = false; private var closed = false; private var cacheValid = output != null
        private var receivedBytes = 0L
        private fun active() = synchronized(ownership) { check(!closed && !this@SlaxResources.closed && hasResourceOwnership() && generation == expectedGeneration) { "Reader page detached" } }
        private fun count(size: Int) {
          receivedBytes += size
          if (receivedBytes > byteLimit) { cacheValid = false; throw java.io.IOException("Reader image too large") }
        }
        private fun writeCache(work: () -> Unit) = synchronized(ownership) {
          if (this@SlaxResources.closed || !hasResourceOwnership() || generation != expectedGeneration) { cacheValid = false; return@synchronized }
          try { work() } catch (_: Exception) { cacheValid = false; runCatching { output?.close() }; output = null; temporary?.delete() }
        }
        override fun read(): Int { active(); val value = `in`.read(); active(); if (value < 0) complete = true else { count(1); writeCache { output?.write(value) } }; return value }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int { active(); val size = `in`.read(buffer, offset, length); active(); if (size < 0) complete = true else if (size > 0) { count(size); writeCache { output?.write(buffer, offset, size) } }; return size }
        @Synchronized override fun close() {
          if (closed) return; closed = true
          try { super.close(); output?.flush(); output?.fd?.sync(); output?.close(); if (complete && cacheValid && temporary != null && cache != null) { synchronized(ownership) { if (!this@SlaxResources.closed && hasResourceOwnership() && generation == expectedGeneration && cacheFile(original) == cache) java.nio.file.Files.move(temporary!!.toPath(), cache.toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING) } } }
          finally { runCatching { output?.close() }; temporary?.delete(); streams.remove(this); connections.remove(connection); received.close(); connection.cancel() }
        }
      }
      val attached = synchronized(ownership) { if (closed || !hasResourceOwnership() || generation != expectedGeneration) false else { streams.add(stream); true } }
      if (!attached) { stream.close(); error("Reader page detached") }
      failedOutput = null; failedTemporary = null; opened = null; response = null
      val headers = received.headers.toMultimap().filterKeys { !it.equals("Set-Cookie", true) && !it.equals("Set-Cookie2", true) }.mapValues { it.value.joinToString(", ") } + mapOf("X-Content-Type-Options" to "nosniff", "Content-Security-Policy" to "sandbox; default-src 'none'")
      WebResourceResponse(body.contentType()?.let { "${it.type}/${it.subtype}" } ?: "application/octet-stream", body.contentType()?.charset()?.name(), received.code, received.message.ifBlank { "OK" }, headers, stream)
    } catch (_: Exception) { runCatching { failedOutput?.close() }; failedTemporary?.delete(); response?.close(); opened?.let { connections.remove(it); it.cancel() }; denied() }
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
