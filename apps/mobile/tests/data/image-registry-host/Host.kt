package com.slax.reader.platform

import java.io.File
import java.nio.file.Files
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

private fun rejects(work: () -> Unit) {check(runCatching(work).isFailure) {"Expected image rejection"}}
private fun await(latch: CountDownLatch) {check(latch.await(5, TimeUnit.SECONDS)) {"Image checkpoint timed out"}}
private class Route(val bytes: ByteArray, val mime: String? = "image/png", val status: Int = 200, val length: Long = bytes.size.toLong(), val hold: CountDownLatch? = null) {
  val calls = AtomicInteger(); val entered = CountDownLatch(1)
}
fun main(args: Array<String>) {
  val root = File(args[0]).canonicalFile.apply {mkdirs()}
  val routes = ConcurrentHashMap<String, Route>()
  val server = com.sun.net.httpserver.HttpServer.create(java.net.InetSocketAddress("127.0.0.1", 0), 0)
  server.executor = java.util.concurrent.Executors.newCachedThreadPool {work -> Thread(work).apply {isDaemon = true}}
  val leaked = AtomicInteger(); val protected = AtomicInteger()
  server.createContext("/") {exchange ->
    try {
      if (listOf("Cookie", "Authorization", "Referer").any {exchange.requestHeaders.getFirst(it) != null}) leaked.incrementAndGet()
      val route = routes[exchange.requestURI.path] ?: run {exchange.sendResponseHeaders(404, -1); return@createContext}
      route.calls.incrementAndGet(); route.entered.countDown(); route.hold?.let(::await)
      route.mime?.let {exchange.responseHeaders.add("Content-Type", it)}
      if (route.status == 429) exchange.responseHeaders.add("Retry-After", "17")
      exchange.sendResponseHeaders(route.status, route.length)
      exchange.responseBody.write(route.bytes)
    } catch (_: Exception) {} finally {exchange.close()}
  }
  server.createContext("/redirect") {exchange -> exchange.responseHeaders.add("Location", "http://localhost:${server.address.port}/protected"); exchange.sendResponseHeaders(302, -1); exchange.close()}
  server.createContext("/protected") {exchange -> protected.incrementAndGet(); exchange.sendResponseHeaders(200, -1); exchange.close()}
  server.start()
  val origin = "http://127.0.0.1:${server.address.port}"; val policy = SlaxReaderSecurity(listOf("localhost", "api.test"))
  val bytes = ByteArray(256 * 1024 + 7) {(it % 251).toByte()}
  SlaxStorageOwner.activate("account-a")
  fun registry(name: String) = SlaxImageRegistry(File(root, name))
  try {
    val shared = registry("shared"); val gate = CountDownLatch(1); val route = Route(bytes, hold = gate); routes["/shared"] = route
    val one = shared.acquire("account-a", "$origin/shared", policy); val two = shared.acquire("account-a", "$origin/shared", policy)
    await(route.entered); one.close(); rejects {one.await()}; gate.countDown()
    val resource = two.await(); check(route.calls.get() == 1 && resource.size == bytes.size.toLong() && resource.file.readBytes().contentEquals(bytes))
    val third = shared.acquire("account-a", "$origin/shared", SlaxReaderSecurity(listOf("api.test", "localhost")))
    check(third.await().file == resource.file && route.calls.get() == 1)
    val uri = two.persist(root, "bookmark/article/images/${"a".repeat(32)}.png")
    check(File(java.net.URI(uri)).readBytes().contentEquals(bytes))
    val secondUri = third.persist(root, "bookmark/collection-owner-article/images/${"a".repeat(32)}.png")
    check(uri != secondUri && File(java.net.URI(secondUri)).readBytes().contentEquals(bytes))
    two.close(); check(resource.file.exists()); third.close(); shared.close().get(5, TimeUnit.SECONDS); check(!resource.file.exists())
    check(File(java.net.URI(uri)).readBytes().contentEquals(bytes))

    val policyRegistry = registry("policy"); routes["/policy"] = Route(bytes)
    val safe = policyRegistry.acquire("account-a", "$origin/policy", policy)
    val isolated = policyRegistry.acquire("account-a", "$origin/policy", SlaxReaderSecurity(listOf("localhost", "api.test", "other.test")))
    check(safe.await().file != isolated.await().file); check(routes["/policy"]!!.calls.get() == 2)
    rejects {policyRegistry.acquire("account-a", "http://localhost:${server.address.port}/protected", policy)}
    safe.close(); isolated.close(); policyRegistry.close().get(5, TimeUnit.SECONDS)

    val missing = registry("missing"); routes["/mime"] = Route(bytes, mime = null)
    val compatible = missing.acquire("account-a", "$origin/mime", policy, strict = false); val strict = missing.acquire("account-a", "$origin/mime", policy)
    check(compatible.await().file.readBytes().contentEquals(bytes)); rejects {strict.await()}; check(routes["/mime"]!!.calls.get() == 1)
    compatible.close(); strict.close(); missing.close().get(5, TimeUnit.SECONDS)

    val invalid = registry("invalid")
    routes["/html"] = Route(bytes, mime = "text/html")
    routes["/large"] = Route(byteArrayOf(1), length = SlaxImageRegistry.MAX_BYTES + 1)
    routes["/truncated"] = Route(byteArrayOf(1), length = 100)
    routes["/rate"] = Route(byteArrayOf(1), status = 429)
    for (path in listOf("html", "large", "truncated", "redirect", "rate")) {
      val consumer = invalid.acquire("account-a", "$origin/$path", policy)
      val error = runCatching {consumer.await()}.exceptionOrNull(); check(error != null)
      if (path == "rate") check(error is SlaxImageFailure && error.status == 429 && error.retryAfter == "17" && !error.terminal)
      consumer.close()
    }
    invalid.close().get(5, TimeUnit.SECONDS); check(File(root, "invalid").listFiles().orEmpty().isEmpty())

    val last = registry("last"); val lastGate = CountDownLatch(1); routes["/last"] = Route(bytes, hold = lastGate)
    val cancelled = last.acquire("account-a", "$origin/last", policy); await(routes["/last"]!!.entered); cancelled.close(); rejects {cancelled.await()}
    lastGate.countDown(); last.close().get(5, TimeUnit.SECONDS); check(File(root, "last").listFiles().orEmpty().isEmpty())

    val limits = registry("limits"); val limitsGate = CountDownLatch(1)
    for (index in 0..2) routes["/limit-$index"] = Route(bytes, hold = limitsGate)
    val consumers = (0..2).map {limits.acquire("account-a", "$origin/limit-$it", policy)}
    await(routes["/limit-0"]!!.entered); await(routes["/limit-1"]!!.entered)
    check(!routes["/limit-2"]!!.entered.await(100, TimeUnit.MILLISECONDS))
    limitsGate.countDown(); consumers.forEach {check(it.await().size == bytes.size.toLong()); it.close()}; limits.close().get(5, TimeUnit.SECONDS)

    val stale = registry("stale"); val staleGate = CountDownLatch(1); routes["/stale"] = Route(bytes, hold = staleGate)
    val old = stale.acquire("account-a", "$origin/stale", policy); await(routes["/stale"]!!.entered)
    SlaxStorageOwner.activate("account-b"); staleGate.countDown(); rejects {old.await()}; old.close(); stale.close().get(5, TimeUnit.SECONDS)
    check(File(root, "stale").listFiles().orEmpty().isEmpty())
    SlaxStorageOwner.activate("account-a")
    val interrupted = registry("interrupted"); routes["/interrupted"] = Route(bytes)
    val writing = interrupted.acquire("account-a", "$origin/interrupted", policy); writing.await()
    val destination = "bookmark/article/images/${"b".repeat(32)}.png"; val original = File(root, destination).apply {parentFile.mkdirs(); writeText("prior")}
    rejects {writing.persist(root, destination) {writing.close()}}
    check(original.readText() == "prior"); interrupted.close().get(5, TimeUnit.SECONDS)
    check(original.parentFile.listFiles()!!.none {it.name.startsWith(".slax-")})
    val store = SlaxFileStore(root, root, SlaxStorageOwner.capture("account-a"))
    for (value in listOf(byteArrayOf(1), ByteArray(10))) rejects {store.writeStream(destination, value.inputStream(), 5)}
    check(original.readText() == "prior")
    val heldInput = CountDownLatch(1); val finishInput = CountDownLatch(1); var streamFailure: Throwable? = null
    val streamWorker = thread {
      try {store.writeStream("bookmark/article/images/${"c".repeat(32)}.png", object : java.io.ByteArrayInputStream(byteArrayOf(7)) {
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {heldInput.countDown(); await(finishInput); return super.read(buffer, offset, length)}
      }, 1)} catch (error: Throwable) {streamFailure = error}
    }
    await(heldInput)
    check(store.read(destination, false, 20)!!.toString(Charsets.UTF_8) == "prior")
    finishInput.countDown(); streamWorker.join(5000); check(!streamWorker.isAlive && streamFailure == null)

    val capacity = registry("capacity"); val capacityGate = CountDownLatch(1); routes["/capacity"] = Route(bytes, hold = capacityGate)
    val many = (0..255).map {capacity.acquire("account-a", "$origin/capacity", policy)}
    rejects {capacity.acquire("account-a", "$origin/capacity", policy)}
    many.forEach {it.close()}; capacityGate.countDown(); capacity.close().get(5, TimeUnit.SECONDS)

    val budget = registry("budget"); val large = ByteArray(SlaxImageRegistry.MAX_BYTES.toInt()) {7}
    for (index in 0..3) routes["/budget-$index"] = Route(large)
    val retained = (0..2).map {val consumer = budget.acquire("account-a", "$origin/budget-$it", policy); check(consumer.await().size == SlaxImageRegistry.MAX_BYTES); consumer}
    val queued = budget.acquire("account-a", "$origin/budget-3", policy)
    check(!routes["/budget-3"]!!.entered.await(100, TimeUnit.MILLISECONDS))
    retained[0].close(); check(queued.await().size == SlaxImageRegistry.MAX_BYTES)
    retained.drop(1).forEach {it.close()}; queued.close(); budget.close().get(5, TimeUnit.SECONDS)
    check(File(root, "budget").listFiles().orEmpty().isEmpty())
    val module = SlaxImageModule(); module.appContext.reactContext = android.content.Context(root)
    val definition = module.definition()
    fun resolve(key: String, url: String, network: Boolean = true): Any? {
      val id = definition.synchronous["begin"]!!(arrayOf("account-a")) as String
      val promise = expo.modules.kotlin.Promise()
      definition.functions["resolve"]!!(arrayOf("account-a", id, mapOf("key" to key, "directory" to root.path, "url" to url, "hosts" to listOf("localhost", "api.test"), "proxies" to emptyList<String>(), "allowNetwork" to network, "strict" to true), promise))
      promise.await(); check(promise.error == null && promise.thread == "SlaxImageCache")
      definition.synchronous["end"]!!(arrayOf("account-a", id)); return promise.value
    }
    routes["/module.png"] = Route(bytes)
    val resolved = resolve("module", "$origin/module.png") as Map<*, *>
    val committed = File(java.net.URI(resolved["uri"] as String)); check(committed.readBytes().contentEquals(bytes))
    check(committed.path.contains("bookmark/module/images/")); check(resolved["size"] == bytes.size.toDouble())
    val offline = resolve("module", "$origin/module.png", false) as Map<*, *>
    check(offline["uri"] == resolved["uri"] && routes["/module.png"]!!.calls.get() == 1)
    check(resolve("missing-module", "$origin/module.png", false) == null)
    val legacyUrl = "https://example.com/image"
    val legacy = SlaxImageResources.paths(root, "legacy-module", legacyUrl).last().apply {parentFile.mkdirs(); writeBytes(bytes)}
    check((resolve("legacy-module", legacyUrl, false) as Map<*, *>)["uri"] == legacy.toURI().toString())
    check((resolve("../foreign", "$origin/module.png") as Map<*, *>)["error"] == "unavailable")
    check((resolve("module", "http://localhost:${server.address.port}/protected") as Map<*, *>)["terminal"] == true)
    val cancelledId = definition.synchronous["begin"]!!(arrayOf("account-a")) as String
    definition.synchronous["end"]!!(arrayOf("account-a", cancelledId))
    val cancelledPromise = expo.modules.kotlin.Promise(); definition.functions["resolve"]!!(arrayOf("account-a", cancelledId, emptyMap<String, Any?>(), cancelledPromise)); cancelledPromise.await()
    check((cancelledPromise.value as Map<*, *>)["error"] == "cancelled")
    SlaxImageResources.registry(module.appContext.reactContext!!).close().get(5, TimeUnit.SECONDS)
    check(leaked.get() == 0 && protected.get() == 0)
    println("Kotlin shared image registry passed")
  } finally {server.stop(0)}
}
