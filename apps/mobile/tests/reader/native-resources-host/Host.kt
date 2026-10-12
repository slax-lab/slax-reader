package com.slax.reader.platform

import android.content.Context
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

private class Request(val payload: String, val blockHeaders: Boolean = false) {
  val opened = CountDownLatch(1)
  val headers = CountDownLatch(if (blockHeaders) 1 else 0)
  var disconnected = false
}
private val requests = mutableMapOf<String, Request>()
private fun await(latch: CountDownLatch) { check(latch.await(5, TimeUnit.SECONDS)) { "Fixture concurrency checkpoint timed out" } }
private fun prepare(root: File, path: String, request: Request): SlaxResources {
  requests[path] = request
  return SlaxResources(Context(root)).apply { cacheKey = "account-article"; security = SlaxReaderSecurity(listOf("auth.example", "localhost")) }
}
private fun cacheFiles(root: File) = File(root, "bookmark").walkTopDown().filter { it.isFile }.toList()

fun main() {
  val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
  server.executor = java.util.concurrent.Executors.newCachedThreadPool { work -> Thread(work).apply { isDaemon = true } }
  server.createContext("/") { exchange ->
    val request = requests[exchange.requestURI.path]
    if (request == null) { exchange.sendResponseHeaders(404, -1); exchange.close() }
    else {
      request.opened.countDown(); await(request.headers)
      check(exchange.requestHeaders.getFirst("Cookie") == null && exchange.requestHeaders.getFirst("Authorization") == null)
      exchange.responseHeaders.add("Content-Type", "image/jpeg")
      exchange.responseHeaders.add("Set-Cookie", "untrusted=synthetic; Path=/")
      try {
        exchange.sendResponseHeaders(200, request.payload.toByteArray().size.toLong())
        exchange.responseBody.use { it.write(request.payload.toByteArray()) }
      } catch (_: Exception) { request.disconnected = true }
      finally { exchange.close() }
    }
  }
  var protectedRequests = 0
  server.createContext("/protected") { exchange -> protectedRequests++; exchange.sendResponseHeaders(200, -1); exchange.close() }
  server.createContext("/redirect-denied") { exchange -> exchange.responseHeaders.add("Location", "http://localhost:${server.address.port}/protected"); exchange.sendResponseHeaders(302, -1); exchange.close() }
  server.createContext("/redirect-safe") { exchange -> exchange.responseHeaders.add("Location", "/normal.jpg"); exchange.sendResponseHeaders(302, -1); exchange.close() }
  server.createContext("/missing-mime") { exchange -> exchange.sendResponseHeaders(200, 3); exchange.responseBody.use { it.write(byteArrayOf(1, 2, 3)) }; exchange.close() }
  server.createContext("/not-image") { exchange -> exchange.responseHeaders.add("Content-Type", "text/html"); exchange.sendResponseHeaders(200, 1); exchange.responseBody.use { it.write(1) }; exchange.close() }
  server.createContext("/too-large") { exchange -> exchange.responseHeaders.add("Content-Type", "image/png"); exchange.sendResponseHeaders(200, 21 * 1024 * 1024); exchange.close() }
  server.createContext("/static/image") { exchange ->
    check(exchange.requestHeaders.getFirst("Cookie") == null && exchange.requestHeaders.getFirst("Authorization") == null && exchange.requestHeaders.getFirst("Referer") == null)
    val video = !exchange.requestURI.rawQuery.contains("m=rss")
    if (video && exchange.requestURI.rawQuery.endsWith("redirect")) {
      exchange.responseHeaders.add("Location", "http://localhost:${server.address.port}/protected"); exchange.sendResponseHeaders(302, -1); exchange.close()
    } else if (video && exchange.requestURI.rawQuery.endsWith("unsatisfied")) {
      exchange.responseHeaders.add("Content-Range", "bytes */10"); exchange.sendResponseHeaders(416, -1); exchange.close()
    } else if (video) {
      check(exchange.requestHeaders.getFirst("Range") == "bytes=2-5")
      exchange.responseHeaders.add("Content-Type", if (exchange.requestURI.rawQuery.endsWith("html")) "text/html" else "video/mp4")
      exchange.responseHeaders.add("Content-Range", "bytes 2-5/10"); exchange.responseHeaders.add("Accept-Ranges", "bytes")
      exchange.sendResponseHeaders(206, 4)
      runCatching { exchange.responseBody.use { it.write("23".toByteArray()); it.flush(); if (exchange.requestURI.rawQuery.endsWith("slow")) Thread.sleep(500); it.write("45".toByteArray()) } }; exchange.close()
    } else {
      exchange.responseHeaders.add("Content-Type", "image/png"); exchange.sendResponseHeaders(200, 3); exchange.responseBody.use { it.write(byteArrayOf(1, 2, 3)) }; exchange.close()
    }
  }
  server.start()
  val host = "127.0.0.1:${server.address.port}"
  var globalCookieReads = 0
  val previousCookies = java.net.CookieHandler.getDefault()
  java.net.CookieHandler.setDefault(object : java.net.CookieHandler() {
    override fun get(uri: java.net.URI, headers: Map<String, List<String>>): Map<String, List<String>> { globalCookieReads++; return mapOf("Cookie" to listOf("token=synthetic")) }
    override fun put(uri: java.net.URI, headers: Map<String, List<String>>) { error("Private Reader network wrote global cookies") }
  })
  val root = Files.createTempDirectory("slax-native-resources-host-").toFile()
  try {
    val normalRoot = File(root, "normal").apply { mkdirs() }
    val signedPolicy = SlaxReaderSecurity(listOf("localhost"), listOf("http://localhost:${server.address.port}"))
    val signed = "http://localhost:${server.address.port}/static/image?m=rss&d=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&u=https%253A%252F%252Fpublic.test%252Fa.png&r=https%3A%2F%2Ffeed.test%2Fa"
    check(signedPolicy.imageOriginal(signed) != null && !signedPolicy.allows(signed))
    check(signedPolicy.imageOriginal(signed + "&d=bad") == null)
    val proxy = SlaxResources(Context(normalRoot)).apply { security = signedPolicy }
    check(proxy.intercept(signed)!!.data.readBytes().isEmpty())
    proxy.intercept(signed, privateImage = true)!!.data.use { check(it.readBytes().contentEquals(byteArrayOf(1, 2, 3))) }
    val mediaUrl = signed.replace("http:", "slaxmedia:").replace("m=rss&", "")
    val media = proxy.intercept(mediaUrl, mapOf("Range" to "bytes=2-5"))!!
    check(media.status == 206 && media.headers.entries.any { it.key.equals("Content-Range", true) && it.value == "bytes 2-5/10" })
    check(media.headers.entries.any { it.key.equals("Content-Length", true) && it.value == "4" })
    media.data.use { check(String(it.readBytes()) == "2345") }
    check(cacheFiles(normalRoot).isEmpty()) { "Video must not populate image cache" }
    for (mode in listOf("redirect", "html")) proxy.intercept(mediaUrl + mode, mapOf("Range" to "bytes=2-5"))!!.data.use { check(it.readBytes().isEmpty()) }
    proxy.intercept(mediaUrl, mapOf("Range" to "bytes=1-2,4-5"))!!.data.use { check(it.readBytes().isEmpty()) }
    val unsatisfied = proxy.intercept(mediaUrl + "unsatisfied", mapOf("Range" to "bytes=2-5"))!!
    check(unsatisfied.status == 416 && unsatisfied.headers["Content-Range"] == "bytes */10")
    unsatisfied.data.close()
    val slowMedia = proxy.intercept(mediaUrl + "slow", mapOf("Range" to "bytes=2-5"))!!.data
    check(slowMedia.read() >= 0); proxy.close(); check(runCatching { slowMedia.readBytes() }.isFailure)
    val promise = expo.modules.kotlin.Promise()
    SlaxReaderImages.load(Context(normalRoot), "signed-image", signed, "synthetic-owner", listOf("localhost"), listOf("http://localhost:${server.address.port}"), promise)
    val deadline = System.currentTimeMillis() + 5000
    while (promise.value == null && promise.error == null && System.currentTimeMillis() < deadline) Thread.sleep(5)
    check(promise.value == "AQID" && promise.error == null)
    val normal = prepare(normalRoot, "/normal.jpg", Request("complete-image"))
    normal.intercept("slaxstatic://$host/normal.jpg")!!.data.use { check(String(it.readBytes()) == "complete-image") }
    check(cacheFiles(normalRoot).single().readText() == "complete-image")
    normal.cancelAll()
    requests["/second.jpg"] = Request("second-image")
    normal.intercept("slaxstatic://$host/second.jpg")!!.data.use { check(String(it.readBytes()) == "second-image") }
    check(cacheFiles(normalRoot).size == 2) { "Reload cancellation permanently closed the handler" }
    requests["/cover.png-v2"] = Request("source-image")
    normal.intercept("slaxstatic://$host/cover.png-v2")!!.data.use { it.readBytes() }
    check(cacheFiles(normalRoot).any { it.name.endsWith(".png-v2") }) { "Source-safe image extensions were changed" }
    val safeRedirect = normal.intercept("http://$host/redirect-safe", mapOf("Cookie" to "injected=synthetic", "Authorization" to "Bearer synthetic"), privateImage = true)!!
    safeRedirect.data.use { check(String(it.readBytes()) == "complete-image") }
    check(safeRedirect.headers.keys.none { it.equals("Set-Cookie", true) })
    normal.intercept("http://$host/redirect-denied", privateImage = true)!!.data.use { check(it.readBytes().isEmpty()) }
    check(normal.intercept("https://public.example/provider") == null) { "Public provider requests must retain native method/body handling" }
    normal.intercept("slaxstatic://$host/redirect-denied")!!.data.use { check(it.readBytes().isEmpty()) }
    for (denied in listOf("http://localhost:${server.address.port}/protected", "slaxstatics://AUTH.EXAMPLE/a", "https://api.slax.com/a", "https://slax.com./a", "https://user@auth.example/a")) normal.intercept(denied)!!.data.use { check(it.readBytes().isEmpty()) }
    normal.intercept("slaxstatic://$host/missing-mime")!!.data.use { check(it.readBytes().contentEquals(byteArrayOf(1, 2, 3))) }
    for (path in listOf("/not-image", "/too-large", "/missing-mime")) normal.intercept("http://$host$path", privateImage = true)!!.data.use { check(it.readBytes().isEmpty()) }
    check(protectedRequests == 0 && globalCookieReads == 0)
    SlaxResources(Context(normalRoot)).intercept("http://$host/normal.jpg")!!.data.use { check(it.readBytes().isEmpty()) }
    normal.close()

    val streamRoot = File(root, "stream").apply { mkdirs() }
    val streaming = prepare(streamRoot, "/stream.jpg", Request("unfinished-image"))
    val stream = streaming.intercept("slaxstatic://$host/stream.jpg")!!.data
    check(stream.read() >= 0)
    streaming.close()
    check(cacheFiles(streamRoot).isEmpty()) { "A revoked partial download survived" }
    File(streamRoot, "bookmark").deleteRecursively()
    runCatching { stream.readBytes(); stream.close() }
    check(!File(streamRoot, "bookmark").exists()) { "A revoked stream recreated the cache" }

    val delayedRoot = File(root, "delayed").apply { mkdirs() }
    val request = Request("late-old-account-image", blockHeaders = true)
    val delayed = prepare(delayedRoot, "/delayed.jpg", request)
    var completed = false
    val worker = thread {
      delayed.intercept("slaxstatic://$host/delayed.jpg")!!.data.use { it.readBytes() }
      completed = true
    }
    await(request.opened)
    delayed.close()
    File(delayedRoot, "bookmark").deleteRecursively()
    request.headers.countDown()
    worker.join(5000)
    check(!worker.isAlive && completed)
    check(!File(delayedRoot, "bookmark").exists()) { "Late headers recreated a revoked account directory" }
    val afterClose = delayed.intercept("slaxstatic://$host/unexpected.jpg")!!.data.use { it.readBytes() }
    check(afterClose.isEmpty()) { "A permanently closed handler accepted another request" }
    var activeOwner = "b"
    val lateViewRoot = File(root, "late-view").apply { mkdirs() }
    val lateView = SlaxResources(Context(lateViewRoot)) { activeOwner == "a" }.apply { cacheKey = "account-article"; security = SlaxReaderSecurity(listOf("auth.example", "localhost")) }
    lateView.intercept("slaxstatic://$host/unexpected.jpg")!!.data.use { check(it.readBytes().isEmpty()) }
    check(!File(lateViewRoot, "bookmark").exists()) { "A late old-account view accepted the new owner" }
    activeOwner = "a"
    requests["/owner.jpg"] = Request("owned-image")
    lateView.intercept("slaxstatic://$host/owner.jpg")!!.data.use { check(String(it.readBytes()) == "owned-image") }
    activeOwner = "b"
    lateView.intercept("slaxstatic://$host/unexpected.jpg")!!.data.use { check(it.readBytes().isEmpty()) }
    lateView.close()
    val legacyRoot = File(root, "legacy").apply { mkdirs() }
    var legacyOwner = true
    val legacy = SlaxResources(Context(legacyRoot)) { legacyOwner }.apply { cacheKey = "collection-owner-article"; security = SlaxReaderSecurity(listOf("auth.example", "localhost")) }
    fun legacyFile(url: String): File {
      val hash = java.security.MessageDigest.getInstance("MD5").digest(url.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
      val ext = url.substringAfterLast('.', "").substringBefore('?').substringBefore('&').take(10).lowercase().ifEmpty { "jpg" }
      return File(legacyRoot, "bookmark/${legacy.cacheKey}/images/$hash.$ext")
    }
    for (url in listOf("http://example.com/image", "http://example.com/a.b/image?size=1", "http://example.com/image?size=1#x", "http://example.com/image#x", "http://example.com/a.png?x=.com/image")) {
      val file = legacyFile(url).apply { parentFile.mkdirs(); writeText("old-cache") }
      val custom = url.replace("http://", "slaxstatic://")
      legacy.intercept(custom)!!.data.use { check(String(it.readBytes()) == "old-cache") }
      check(file.readText() == "old-cache")
      val stream = legacy.intercept(custom)!!.data
      legacy.cancelAll(); check(runCatching { stream.read() }.isFailure) { "Canceled cached stream still readable" }
      legacyOwner = false
      legacy.intercept(custom)!!.data.use { check(it.readBytes().isEmpty()) }
      legacyOwner = true
    }
    val safe = legacyFile("http://example.com/image").parentFile.resolveSibling(legacyFile("http://example.com/image").parentFile.name.substringBefore('.') + ".jpg").apply { writeText("safe-first") }
    legacy.intercept("slaxstatic://example.com/image")!!.data.use { check(String(it.readBytes()) == "safe-first") }
    check(safe.readText() == "safe-first")
    requests["/missing"] = Request("safe-download")
    legacy.intercept("slaxstatic://$host/missing")!!.data.use { check(String(it.readBytes()) == "safe-download") }
    check(cacheFiles(legacyRoot).any { it.name.endsWith(".jpg") && it.readText() == "safe-download" })
    val outside = File(root, "outside").apply { mkdirs() }
    val foreign = File(outside, "image").apply { writeText("foreign") }
    val target = legacyFile("http://$host/foreign")
    target.parentFile.mkdirs(); Files.createSymbolicLink(target.toPath(), foreign.toPath())
    legacy.intercept("slaxstatic://$host/foreign")!!.data.use { check(it.readBytes().isEmpty()) }
    check(foreign.readText() == "foreign")
    val hash = "a".repeat(32)
    check(SlaxCachePaths.file(legacyRoot, "../other", "$hash.jpg") == null)
    for (name in listOf("$hash.com/../outside", "$hash.com//image", "$hash.com/./image", "$hash.com/\\image")) check(SlaxCachePaths.file(legacyRoot, legacy.cacheKey, name) == null)
    val alias = File(legacyRoot, "bookmark/alias")
    Files.createSymbolicLink(alias.toPath(), File(legacyRoot, "bookmark/${legacy.cacheKey}").toPath())
    check(SlaxCachePaths.file(legacyRoot, "alias", "$hash.jpg") == null) { "Foreign bookmark alias accepted" }
    val images = File(legacyRoot, "bookmark/external").apply { mkdirs() }
    Files.createSymbolicLink(File(images, "images").toPath(), outside.toPath())
    check(SlaxCachePaths.file(legacyRoot, "external", "$hash.jpg") == null) { "Outside images directory accepted" }
    val bridge = SlaxCachePathsModule().apply { appContext.reactContext = Context(legacyRoot) }.definition().imageCacheFileUri
    val relative = "bookmark/${legacy.cacheKey}/images/$hash.com/image"
    check(bridge(legacyRoot.path, legacy.cacheKey, relative) != null)
    check(bridge(outside.path, legacy.cacheKey, relative) == null)
    check(bridge(legacyRoot.path, "foreign", relative) == null)
    check(bridge(legacyRoot.path, "alias", "bookmark/alias/images/$hash.jpg") == null)
    check(bridge(legacyRoot.path, "external", "bookmark/external/images/$hash.jpg") == null)
    legacy.close()
    println("Production Kotlin resources: legacy nested reads, symlink/traversal isolation, cache writes, revocation, and permanent close passed (host JVM only).")
  } finally { java.net.CookieHandler.setDefault(previousCookies); server.stop(0); root.deleteRecursively() }
}
