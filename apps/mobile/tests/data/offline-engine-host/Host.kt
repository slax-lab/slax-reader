package com.slax.reader.platform

import java.io.File
import kotlinx.coroutines.launch
import java.net.URL
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

private class Failure(val code: String) : Exception(code)
private class Recorder {
  val events = mutableListOf<Triple<Long, String, Map<String, Any?>>>()
  @Synchronized fun add(name: String, body: Map<String, Any?>) {events.add(Triple(System.nanoTime(), name, body))}
  @Synchronized fun snapshot() = events.toList()
  fun items(key: String) = snapshot().filter { it.second == "onStatus" }.flatMap { (it.third["items"] as List<*>).map { item -> item as Map<*, *> } }.filter { it["key"] == key }
  fun state(key: String) = items(key).lastOrNull()
  fun states(key: String) = items(key).map { it["state"] as String }
}
private fun settle(body: (SlaxOfflineReply) -> Unit): Result<Any?> {
  val future = CompletableFuture<Result<Any?>>()
  body(SlaxOfflineReply({ future.complete(Result.success(it)) }, { code, _ -> future.complete(Result.failure(Failure(code))) }))
  return future.get(30, TimeUnit.SECONDS)
}
private fun value(body: (SlaxOfflineReply) -> Unit): Any? = settle(body).getOrElse { error("Unexpected rejection: ${(it as Failure).code}") }
private fun rejection(body: (SlaxOfflineReply) -> Unit): String = (settle(body).exceptionOrNull() as? Failure ?: error("Expected rejection")).code
private fun until(label: String, seconds: Double = 20.0, condition: () -> Boolean) {
  val end = System.nanoTime() + (seconds * 1e9).toLong()
  while (!condition()) {check(System.nanoTime() < end) { "Timed out waiting for $label" }; Thread.sleep(50)}
}
private fun precondition(value: Boolean, message: () -> String = { "Precondition failed" }) = check(value, message)

fun main(args: Array<String>) {
  val origin = args[0]; val imageOrigin = args[1]
  val root = File(args[2]).apply { mkdirs() }.canonicalFile
  val fixture = SlaxOfflineJson.decode(File(args[3]).readText()) as Map<*, *>
  for (item in fixture["cases"] as List<*>) {
    val case = item as Map<*, *>
    val actual = SlaxOfflineHtml.imageUrls(case["html"] as String); val expected = case["images"] as List<*>
    precondition(actual == expected) { "HTML extraction mismatch in '${case["name"]}': $actual != $expected" }
  }
  check(SlaxOfflineJson.decode(SlaxOfflineJson.encode(mapOf("a" to listOf(1, 2.5, "x\n\"\u0001", null, true), "b" to mapOf<String, Any?>()))) == mapOf("a" to listOf(1.0, 2.5, "x\n\"\u0001", null, true), "b" to mapOf<String, Any?>()))
  fun counts(): Map<String, Int> = (SlaxOfflineJson.decode(URL("$origin/counts").readText()) as Map<*, *>).entries.associate { it.key as String to (it.value as Double).toInt() }
  fun write(relative: String, text: String) {File(root, relative).apply { parentFile.mkdirs() }.writeText(text)}
  fun exists(relative: String) = File(root, relative).exists()
  fun manifest(key: String): Map<*, *>? = File(root, "bookmark/$key/offline.json").takeIf { it.exists() }?.let { SlaxOfflineJson.decode(it.readText()) as Map<*, *> }
  write("bookmark/legacy/content.html", "<p>legacy</p><img src=\"slaxstatic://${imageOrigin.drop(7)}/img/a.png\">")
  File(root, "bookmark/emptydir/images").mkdirs()
  write("bookmark/avatar-x/manifest.json", "{}")
  write("pdf/v1/${"b".repeat(64)}/doc/manifest.json.entries/0000000000000001-x.data", "{}")
  write("bookmark/.slax-evict-gen-abcd/intent", "slax-cache-eviction-v1\nbookmark/evicted\n")

  val recorder = Recorder()
  val registry by lazy { SlaxImageRegistry(File(root.parentFile, "transfers")) }
  val engine = SlaxOfflineEngine(SlaxOfflineEnvironment(root = { File(it).canonicalFile.let { file -> file to file } }, registry = { registry }, allowHttp = true, random = { 1.0 }))
  engine.attach { name, body -> recorder.add(name, body) }
  SlaxStorageOwner.activate("acct")
  val scopeText = "[\"$origin\",\"user-1\"]"
  val scope = mapOf("owner" to "acct", "scope" to scopeText, "origin" to origin, "directory" to root.path, "userAgent" to "SlaxReader/ios test",
    "clientType" to "ios", "clientVersion" to "1.0.0", "protectedHosts" to listOf("localhost"), "imageProxyOrigins" to listOf(origin))
  val migration = value { engine.open(scope, it) } as Map<*, *>
  precondition(migration["migrationPending"] == true && migration["adopted"] == listOf("legacy")) { "Unexpected adoption $migration" }
  precondition((migration["dropped"] as List<*>).toSet() == setOf("emptydir", "evicted")) { "Unexpected dropped $migration" }
  precondition(!exists("pdf/v1") && exists("bookmark/avatar-x/manifest.json") && !exists("bookmark/.slax-evict-gen-abcd"))
  val adopted = manifest("legacy")!!
  precondition(adopted["version"] == null && adopted["id"] == "" && (adopted["images"] as List<*>).map { (it as Map<*, *>)["u"] } == listOf("$imageOrigin/img/a.png")) { "Adopted $adopted" }
  value { engine.commitMigration("acct", it) }
  precondition(SlaxOfflineJson.decode(File(root, "offline-engine.json").readText()) == mapOf("layout" to 2.0))
  value { engine.close("acct", it) }
  precondition((value { engine.open(scope, it) } as Map<*, *>)["migrationPending"] == false)
  val sessionStart = System.nanoTime()

  engine.setCredential("acct", mapOf("generation" to 1.0, "token" to "t1"))
  engine.setConditions("acct", mapOf("online" to true, "downloadImages" to true))
  fun task(key: String, version: String = "v1", kind: String = "article", manual: Boolean = false) = mapOf("key" to key, "id" to key, "kind" to kind, "manual" to manual, "version" to version)
  engine.applyPlan("acct", mapOf("revision" to 1.0, "remove" to emptyList<String>(), "upsert" to listOf(task("article-a"), task("legacy"), task("pdf-a", kind = "pdf"), task("denied", manual = true), task("auth"), task("flaky"))))
  until("credential rejection") { recorder.snapshot().any { it.second == "onCredentialRejected" && it.third["generation"] == 1.0 && it.third["owner"] == "acct" } }
  engine.setCredential("acct", mapOf("generation" to 2.0, "token" to "t2"))
  for (key in listOf("article-a", "legacy", "auth", "flaky", "pdf-a")) until("$key complete", 30.0) { recorder.state(key)?.get("state") == "complete" }
  until("denied") { recorder.state("denied")?.get("state") == "denied" }
  precondition(recorder.state("denied")?.get("code") == "http_forbidden" && recorder.state("denied")?.get("manual") == true) { "Denied ${recorder.state("denied")}" }
  val served = counts()
  precondition(served["content:legacy"] == null && served["content:flaky"] == 2 && served["content:denied"] == 1) { "Unexpected requests $served" }
  precondition(recorder.states("article-a").first() == "downloading" || recorder.states("article-a") == listOf("complete"))

  val articleHtml = File(root, "bookmark/article-a/content.html").readText()
  precondition(articleHtml.contains("ünïcode") && manifest("article-a")?.get("version") == "v1" && manifest("legacy")?.get("version") == "v1" && manifest("legacy")?.get("id") == "legacy")
  val imageUrl = "$imageOrigin/img/a.png"
  val md5 = java.security.MessageDigest.getInstance("MD5").digest(imageUrl.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
  val imagePath = "bookmark/article-a/images/$md5.png"
  precondition(SlaxImageResources.paths(root, "article-a", imageUrl).first() == File(root, imagePath))
  until("article images") {
    val images = (manifest("article-a")?.get("images") as? List<*>).orEmpty().map { it as Map<*, *> }
    images.size == 2 && images[0]["s"] == "ready" && images[1]["s"] == "denied"
  }
  precondition(File(root, imagePath).readBytes().contentEquals(byteArrayOf(137.toByte(), 80, 78, 71, 1, 2, 3)))
  until("legacy image") { exists("bookmark/legacy/images/$md5.png") }

  precondition(value { engine.readArticle("acct", "article-a", it) } == articleHtml)
  precondition(value { engine.readArticle("acct", "missing", it) } == null)
  val before = counts()["content:article-a"]!!
  precondition(value { engine.fetchArticle("acct", mapOf("key" to "article-a", "id" to "article-a", "requestId" to "r1", "force" to false), it) } == articleHtml)
  precondition(counts()["content:article-a"] == before)
  precondition((value { engine.fetchArticle("acct", mapOf("key" to "article-a", "id" to "article-a", "requestId" to "r2", "force" to true), it) } as String).contains("ünïcode"))
  precondition(counts()["content:article-a"] == before + 1)
  precondition(rejection { engine.fetchArticle("acct", mapOf("key" to "bad", "id" to "other", "requestId" to "r3"), it) } == "invalid_request")

  // Committed-copy reads bypass a busy control thread and saturated IO workers.
  val controlHeld = java.util.concurrent.CountDownLatch(1)
  engine.scope.launch { controlHeld.await(10, TimeUnit.SECONDS) }
  val ioHeld = java.util.concurrent.CountDownLatch(1)
  repeat(96) { kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch { ioHeld.await(10, TimeUnit.SECONDS) } }
  val busyStart = System.nanoTime()
  precondition(value { engine.readArticle("acct", "article-a", it) } == articleHtml)
  precondition(value { engine.fetchArticle("acct", mapOf("key" to "article-a", "id" to "article-a", "requestId" to "r-busy", "force" to false), it) } == articleHtml)
  precondition(System.nanoTime() - busyStart < 2_000_000_000L) { "A foreground read waited behind background work" }
  controlHeld.countDown(); ioHeld.countDown()

  val pdfSize = 2 * 1024 * 1024 + 512 * 1024 + 7
  val status = value { engine.pdfStatus("acct", "pdf-a", it) } as Map<*, *>
  precondition(status["complete"] == true && status["downloadedBytes"] == pdfSize.toDouble()) { "PDF status $status" }
  val documentId = "a".repeat(64)
  val scopeId = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(scopeText.toByteArray())
  val document = File(root, "pdf/v2/$scopeId/pdf-a/document.pdf").readBytes()
  precondition(document.size == pdfSize && document.withIndex().all { (it.value.toInt() and 255) == it.index % 251 })
  precondition(SlaxOfflineJson.decode(File(root, "pdf/v2/$scopeId/pdf-a/part.json").readText()) == mapOf("document_id" to documentId, "size" to pdfSize.toDouble(), "committed" to pdfSize.toDouble()))
  precondition(!exists("pdf/v2/$scopeId/pdf-a/document.pdf.part") && manifest("pdf-a")?.get("kind") == "pdf" && manifest("pdf-a")?.get("size") == pdfSize.toDouble())
  precondition(counts()["pdf:pdf-a"] == 3) { "Expected three resumable windows, got ${counts()["pdf:pdf-a"]}" }

  // A complete PDF answers its descriptor locally without any network request; an incomplete one still fetches it.
  val metadataBefore = counts()["metadata:pdf-a"] ?: 0
  val complete = value { engine.pdfMetadata("acct", mapOf("key" to "pdf-a", "id" to "pdf-a", "requestId" to "p2", "allowNetwork" to true), it) } as Map<*, *>
  precondition(complete["document_id"] == documentId && complete["url"] == "/v1/bookmark/pdf?bookmark_uid=pdf-a") { "Complete $complete" }
  val cached = value { engine.pdfMetadata("acct", mapOf("key" to "pdf-a", "id" to "pdf-a", "requestId" to "p2b", "allowNetwork" to false), it) } as Map<*, *>
  precondition(cached["document_id"] == documentId) { "Cached $cached" }
  precondition((counts()["metadata:pdf-a"] ?: 0) == metadataBefore) { "A complete PDF requested metadata" }

  // Byte ranges reach the page only through the PDF host's interceptor, scoped to its bound document and owner.
  fun source(key: String) = SlaxPdfSource.parse(mapOf("id" to key, "documentId" to documentId, "size" to pdfSize.toDouble()))!!
  var bound: Pair<SlaxPdfSource, String>? = source("pdf-a") to "acct"
  val page = SlaxReaderSecurity.PDF_ORIGIN.removeSuffix("/")
  val ranges = SlaxPdfRanges({ engine }, SlaxReaderSecurity.PDF_ORIGIN) { bound }
  class Served(val response: SlaxPdfResponse) {
    val body = response.body.readBytes()
    val status get() = response.status
    fun header(name: String) = response.headers[name]
    val code get() = runCatching { (SlaxOfflineJson.decode(String(body)) as Map<*, *>)["code"] }.getOrNull()
  }
  fun fetch(path: String, range: String? = null, method: String = "GET", header: String = "X-Slax-Range") =
    Served(ranges.handle(page + path, method, range?.let { mapOf(header to it) }.orEmpty()) ?: error("Not a PDF request: $path"))
  fun path(key: String) = "/pdf/$key/$documentId/$pdfSize"
  precondition(ranges.handle("$page/elsewhere", "GET", emptyMap()) == null && ranges.handle("https://other.invalid${path("pdf-a")}", "GET", emptyMap()) == null)
  val local = fetch(path("pdf-a") + "?request=r1", "bytes=1000-4999")
  precondition(local.status == 206 && local.body.contentEquals(document.copyOfRange(1000, 5000))) { "Local range ${local.status}" }
  precondition(local.header("Content-Range") == "bytes 1000-4999/$pdfSize" && local.header("Content-Length") == "4000" && local.header("Accept-Ranges") == "bytes" && local.response.mimeType == "application/pdf" && local.response.reason == "Partial Content")
  // A standard `Range` header is applied by WebView itself (available() then skip(begin)); the stream yields the slice after that skip.
  val standard = ranges.handle(page + path("pdf-a") + "?request=r1b", "GET", mapOf("Range" to "bytes=1000-4999"))!!
  precondition(standard.status == 206 && standard.body.available() == 5000 && standard.body.skip(1000) == 1000L && standard.body.readBytes().contentEquals(document.copyOfRange(1000, 5000)))
  val tail = fetch(path("pdf-a") + "?request=r2", "bytes=${pdfSize - 10}-")
  precondition(tail.status == 206 && tail.body.contentEquals(document.copyOfRange(pdfSize - 10, pdfSize)) && tail.header("Content-Range") == "bytes ${pdfSize - 10}-${pdfSize - 1}/$pdfSize")
  precondition(fetch(path("pdf-a") + "?request=r3", "bytes=${pdfSize - 4}-${pdfSize + 100}").body.size == 4)
  for (range in listOf(null, "bytes=$pdfSize-${pdfSize + 5}", "bytes=0-${2 * 1024 * 1024}", "bytes=0-1,4-5", "bytes=-10", "bytes=9-3")) {
    val rejected = fetch(path("pdf-a") + "?request=r4", range)
    precondition(rejected.status == 416 && rejected.code == "http_range_not_satisfiable") { "Range $range gave ${rejected.status}" }
    if (range == null || range.startsWith("bytes=$pdfSize")) precondition(rejected.header("Content-Range") == "bytes */$pdfSize")
  }
  val head = fetch(path("pdf-a"), method = "HEAD")
  precondition(head.status == 200 && head.header("Content-Length") == pdfSize.toString() && head.body.isEmpty())
  for (other in listOf("/pdf/pdf-a/${"c".repeat(64)}/$pdfSize?request=r5", "/pdf/pdf-a/$documentId/${pdfSize + 1}?request=r5", path("pdf-full") + "?request=r5")) {
    val rejected = fetch(other, "bytes=0-9")
    precondition(rejected.status == 404 && rejected.code == "invalid_request") { "Unbound path $other gave ${rejected.status}" }
  }
  precondition(fetch(path("pdf-a"), "bytes=0-9").status == 400)
  precondition(fetch(path("pdf-a") + "?request=r6", "bytes=0-9", "POST").status == 404)
  bound = null
  val unowned = fetch(path("pdf-a") + "?request=r7", "bytes=0-9")
  precondition(unowned.status == 403 && unowned.code == "session_changed") { "Unscoped host was served" }
  bound = source("pdf-a") to "other"
  val foreign = fetch(path("pdf-a") + "?request=r8", "bytes=0-9")
  precondition(foreign.status == 403 && foreign.code == "session_changed") { "Another owner was served" }
  precondition(counts()["pdf:pdf-a"] == 3) { "Local ranges used the network" }

  // Missing ranges are fetched remotely at foreground priority, even with background acquisition saturated.
  val ioSaturated = java.util.concurrent.CountDownLatch(1)
  repeat(96) { kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch { ioSaturated.await(10, TimeUnit.SECONDS) } }
  val background = (0 until 8).map { SlaxPdfTransfers.begin("acct", origin, true) }
  precondition(runCatching { SlaxPdfTransfers.begin("acct", origin, true) }.isFailure) { "Background transfers are not bounded" }
  bound = source("pdf-full") to "acct"
  val remoteStart = System.nanoTime()
  val remote = fetch(path("pdf-full") + "?request=r9", "bytes=70000-70099")
  precondition(remote.status == 206 && remote.body.contentEquals(document.copyOfRange(70_000, 70_100))) { "Remote range ${remote.status} ${remote.code}" }
  precondition(System.nanoTime() - remoteStart < 3_000_000_000L) { "A foreground range waited behind background PDF work" }
  background.forEach { SlaxPdfTransfers.end("acct", it) }; ioSaturated.countDown()
  precondition(counts()["pdf:pdf-full"] == 1)
  val fetched = value { engine.pdfMetadata("acct", mapOf("key" to "pdf-full", "id" to "pdf-full", "requestId" to "p4", "allowNetwork" to true), it) } as Map<*, *>
  precondition(fetched["size"] == pdfSize.toLong() && counts()["metadata:pdf-full"] == 1) { "Fetched $fetched ${counts()}" }
  value { engine.pdfMetadata("acct", mapOf("key" to "pdf-full", "id" to "pdf-full", "requestId" to "p4b", "allowNetwork" to true), it) }
  precondition(counts()["metadata:pdf-full"] == 2) { "An incomplete PDF must refresh its descriptor" }
  precondition(rejection { engine.pdfMetadata("acct", mapOf("key" to "pdf-gone", "id" to "pdf-gone", "requestId" to "p5"), it) } == "http_not_found")
  bound = source("pdf-etag") to "acct"
  val mismatch = fetch(path("pdf-etag") + "?request=r10", "bytes=0-99")
  precondition(mismatch.status == 502 && mismatch.code == "pdf_identity_mismatch") { "Identity mismatch gave ${mismatch.status} ${mismatch.code}" }

  // An aborted page request (cancel ping or host release) cancels its native network work.
  bound = source("pdf-slow") to "acct"
  val slow = CompletableFuture.supplyAsync { fetch(path("pdf-slow") + "?request=slow-1", "bytes=0-99") }
  until("slow range request") { counts()["pdf:pdf-slow"] == 1 }
  precondition(fetch("/pdf-cancel/slow-1", method = "POST").status == 204)
  val cancelled = slow.get(10, TimeUnit.SECONDS)
  precondition(cancelled.status == 503 && cancelled.code == "operation_cancelled") { "Cancelled range gave ${cancelled.status} ${cancelled.code}" }
  until("slow range aborted") { counts()["pdf-slow:aborted"] == 1 }
  val released = CompletableFuture.supplyAsync { fetch(path("pdf-slow") + "?request=slow-2", "bytes=0-99") }
  until("second slow range request") { counts()["pdf:pdf-slow"] == 2 }
  ranges.close()
  precondition(released.get(10, TimeUnit.SECONDS).code == "operation_cancelled")
  until("released slow range aborted") { counts()["pdf-slow:aborted"] == 2 }
  precondition(fetch(path("pdf-slow") + "?request=slow-3", "bytes=0-99").status == 403)

  val usage = value { engine.usage("acct", listOf("article-a", "pdf-a"), it) } as Map<*, *>
  precondition((usage["article"] as Double) > pdfSize + articleHtml.toByteArray().size && usage["images"] == 7.0) { "Usage $usage" }

  val token = engine.protect("acct", "article-a")
  engine.applyPlan("acct", mapOf("revision" to 2.0, "remove" to listOf("article-a"), "upsert" to emptyList<Any>()))
  precondition((value { engine.evict("acct", listOf("article-a"), it) } as List<*>).isEmpty())
  engine.release("acct", token)
  precondition(value { engine.evict("acct", listOf("article-a"), it) } == listOf("article-a") && !exists("bookmark/article-a"))
  until("evicted event") { recorder.state("article-a")?.get("state") == "evicted" }
  engine.applyPlan("acct", mapOf("revision" to 1.0, "remove" to listOf("legacy"), "upsert" to emptyList<Any>()))
  engine.applyPlan("acct", mapOf("revision" to 3.0, "remove" to emptyList<String>(), "upsert" to listOf(task("legacy", "v2"))))
  until("legacy re-acquired") { counts()["content:legacy"] == 1 && manifest("legacy")?.get("version") == "v2" }
  until("legacy v2 complete") { recorder.state("legacy")?.get("state") == "complete" }
  until("legacy images") { ((manifest("legacy")?.get("images") as? List<*>)?.firstOrNull() as? Map<*, *>)?.get("s") == "ready" }
  precondition((value { engine.clear("acct", listOf("legacy"), listOf("images"), it) } as List<*>).isEmpty() && !exists("bookmark/legacy/images") && exists("bookmark/legacy/content.html"))
  engine.applyPlan("acct", mapOf("revision" to 4.0, "remove" to listOf("legacy"), "upsert" to emptyList<Any>()))
  precondition(value { engine.clear("acct", listOf("legacy"), listOf("article"), it) } == listOf("legacy") && !exists("bookmark/legacy/content.html"))

  // A manually retained article with an unbound committed body: the manual task binds it and only fills its images.
  precondition((value { engine.fetchArticle("acct", mapOf("key" to "manual-a", "id" to "manual-a", "requestId" to "r4", "force" to false), it) } as String).contains("ünïcode"))
  until("manual body committed") { manifest("manual-a") != null }
  precondition(manifest("manual-a")!!["version"] == null && (manifest("manual-a")!!["images"] as List<*>).all { (it as Map<*, *>)["s"] == "pending" }) { "Manual ${manifest("manual-a")}" }
  engine.applyPlan("acct", mapOf("revision" to 5.0, "remove" to emptyList<String>(), "upsert" to listOf(task("manual-a", "v3", manual = true))))
  until("manual images") {
    val images = (manifest("manual-a")?.get("images") as? List<*>).orEmpty().map { it as Map<*, *> }
    images.size == 2 && images[0]["s"] == "ready" && images[1]["s"] == "denied"
  }
  until("manual complete") { recorder.state("manual-a")?.get("state") == "complete" }
  precondition(recorder.state("manual-a")?.get("manual") == true && "downloading" !in recorder.states("manual-a")) { "Manual states ${recorder.states("manual-a")}" }
  precondition(counts()["content:manual-a"] == 1 && manifest("manual-a")?.get("version") == "v3" && exists("bookmark/manual-a/images/$md5.png")) { "Manual task refetched its body" }

  val statusTimes = recorder.snapshot().filter { it.second == "onStatus" && it.first >= sessionStart }.map { it.first }
  for ((left, right) in statusTimes.zipWithNext()) precondition(right - left >= 240_000_000L) { "onStatus emitted faster than 250ms" }
  precondition(recorder.snapshot().none { it.toString().contains("t1") || it.toString().contains("t2") }) { "Credential leaked into an event" }

  engine.applyPlan("acct", mapOf("revision" to 6.0, "remove" to emptyList<String>(), "upsert" to listOf(task("slow"))))
  until("slow request") { counts()["content:slow"] == 1 }
  SlaxStorageOwner.activate("other")
  until("revoked session") { settle { engine.readArticle("acct", "flaky", it) }.exceptionOrNull()?.let { (it as Failure).code == "session_changed" } == true }
  runCatching { URL("$origin/release?key=slow").readText() }
  Thread.sleep(500)
  precondition(!exists("bookmark/slow")) { "Revoked acquisition wrote after owner change" }
  // A cancelled reply-owning lane job (shutdown or revocation) rejects its promise, whether or not its body had started.
  val lane = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Default)
  fun outcome(start: (SlaxOfflineReply) -> kotlinx.coroutines.Job): String {
    val future = CompletableFuture<String>()
    start(SlaxOfflineReply({ future.complete("resolved") }, { code, _ -> future.complete(code) })).cancel()
    return future.get(5, TimeUnit.SECONDS)
  }
  precondition(outcome { reply -> lane.launch(start = kotlinx.coroutines.CoroutineStart.LAZY) { reply.resolve(null) }.settles(reply) } == "operation_cancelled")
  val started = java.util.concurrent.CountDownLatch(1)
  precondition(outcome { reply -> lane.launch { reply.cancellable { started.countDown(); kotlinx.coroutines.awaitCancellation() } }.also { started.await() } } == "operation_cancelled")
  // A remote PDF range still queued behind the control thread is rejected as soon as its session shuts down, never left unanswered.
  SlaxStorageOwner.activate("acct")
  value { engine.open(scope, it) }
  val gate = java.util.concurrent.CountDownLatch(1)
  engine.scope.launch { gate.await(10, TimeUnit.SECONDS) }
  val closing = CompletableFuture<Any?>()
  engine.close("acct", SlaxOfflineReply({ closing.complete(it) }, { code, _ -> closing.complete(code) }))
  val queued = CompletableFuture<String>()
  engine.servePdfRange("acct", SlaxPdfRange("pdf-queued", "pdf-queued", null, documentId, pdfSize.toLong(), 0, 100), "queued-1",
    SlaxOfflineReply({ queued.complete("resolved") }, { code, _ -> queued.complete(code) }))
  gate.countDown()
  precondition(queued.get(5, TimeUnit.SECONDS) == "operation_cancelled") { "A queued range was not rejected on shutdown" }
  closing.get(5, TimeUnit.SECONDS)
  println("Kotlin offline engine passed")
  kotlin.system.exitProcess(0)
}
