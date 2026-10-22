package com.slax.reader.platform

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

private fun rejects(work: () -> Unit) {check(runCatching(work).isFailure) { "Expected rejected storage operation" }}
fun main(args: Array<String>) {
  val root = File(args[0]).canonicalFile.apply { mkdirs() }
  val pdfRoot = File(root, "files").apply { mkdirs() }
  SlaxStorageOwner.activate("account-a")
  val store = SlaxFileStore(root, pdfRoot, SlaxStorageOwner.capture("account-a"))
  val pdf = "pdf/v1/account/doc/manifest.json"
  store.write(pdf, byteArrayOf(1), true)
  store.write(pdf, byteArrayOf(2, 3), true)
  check(store.read(pdf, true, 1024)!!.contentEquals(byteArrayOf(2, 3)))
  check(store.size(pdf, true) == 2L)
  check(store.list("pdf/v1/account", true) == listOf(pdf))
  rejects {store.write(pdf, byteArrayOf(4), true) {error("Interrupted before rename")}}
  check(store.read(pdf, true, 1024)!!.contentEquals(byteArrayOf(2, 3)))
  check(File(pdfRoot, "$pdf.entries").listFiles()!!.size == 1)
  rejects {store.write(pdf, ByteArray(SlaxFileStore.BLOCK_LIMIT + 1), true)}
  rejects {store.read(pdf, true, 1)}
  val html = "bookmark/doc/content.html"
  store.write(html, "old article".toByteArray(), false)
  rejects {store.write(html, "replacement".toByteArray(), false) {error("Interrupted")}}
  check(store.read(html, false, 1024)!!.toString(Charsets.UTF_8) == "old article")
  check(store.measure("bookmark/doc") == 11L)
  for (bad in listOf("../private", "pdf/../private", "pdf//x", "/pdf/x", "bookmark/../x", "bookmark/key/../../x", "pdf/%2f/x", "bookmark/key\\bad/x")) rejects {store.read(bad, false, 1024)}
  val outside = File(root, "outside").apply {mkdirs()}
  File(outside, "keep").writeText("safe")
  Files.createSymbolicLink(File(root, "bookmark/linked").toPath(), outside.toPath())
  rejects {store.read("bookmark/linked/keep", false, 1024)}
  rejects {store.remove("bookmark/linked", false)}
  check(File(outside, "keep").readText() == "safe")
  Files.delete(File(root, "bookmark/linked").toPath())

  val entered = CountDownLatch(1); val release = CountDownLatch(1); var failed = false
  val writer = thread {
    failed = runCatching {store.write(html, ByteArray(200_000) { 7 }, false) {entered.countDown(); check(release.await(5, TimeUnit.SECONDS))}}.isFailure
  }
  check(entered.await(5, TimeUnit.SECONDS)); SlaxStorageOwner.activate(null); SlaxStorageOwner.activate("account-b"); release.countDown(); writer.join(5000)
  check(!writer.isAlive && failed)
  rejects {store.read(html, false, 1024)}
  rejects {SlaxStorageOwner.capture(null)}
  val next = SlaxFileStore(root, pdfRoot, SlaxStorageOwner.capture("account-b"))
  check(next.read(html, false, 1024)!!.toString(Charsets.UTF_8) == "old article")
  next.write(html, "new account".toByteArray(), false)
  check(next.read(html, false, 1024)!!.toString(Charsets.UTF_8) == "new account")
  next.remove(pdf, true); check(next.read(pdf, true, 1024) == null)
  next.remove("bookmark/doc", false); check(next.measure("bookmark/doc") == 0L)
  check(File(outside, "keep").readText() == "safe")
  val module = SlaxStorageModule(); module.appContext.reactContext = android.content.Context(root)
  val definition = module.definition(); val functions = definition.functions
  val imagePath = "bookmark/doc/images/image.jpg"
  val imageLease = SlaxStorageOwner.capture("account-b")
  val cancellable = SlaxFileStore(root, pdfRoot, imageLease)
  next.write(imagePath, byteArrayOf(1), false)
  rejects {cancellable.write(imagePath, byteArrayOf(2), false) {imageLease.cancel()}}
  check(next.read(imagePath, false, 1024)!!.contentEquals(byteArrayOf(1)))
  fun invoke(name: String, vararg arguments: Any?): expo.modules.kotlin.Promise {
    val promise = expo.modules.kotlin.Promise(); functions[name]!!(arrayOf(*arguments, promise)); promise.await(); return promise
  }
  val written = invoke("writeBytes", root.path, "account-b", pdf, byteArrayOf(9, 8), true)
  check(written.error == null && written.thread == "SlaxStorage" && written.value is String)
  val loaded = invoke("readBytes", root.path, "account-b", pdf, true)
  check(loaded.error == null && (loaded.value as ByteArray).contentEquals(byteArrayOf(9, 8)))
  check(invoke("size", root.path, "account-b", pdf, true).value == 2.0)
  check(invoke("writeText", root.path, "account-b", html, "native queued").error == null)
  check(invoke("readText", root.path, "account-b", html).value == "native queued")
  check(invoke("readBytes", outside.path, "account-b", pdf, true).error != null)
  check(invoke("readBytes", root.path, "account-b", "pdf/../foreign", true).error != null)
  rejects {invoke("readBytes", root.path, "old-owner", pdf, true)}
  invoke("remove", root.path, "account-b", pdf, true)
  val operation = definition.synchronous["beginWrite"]!!(arrayOf("account-b")) as String
  check(invoke("writeImage", root.path, "account-b", operation, imagePath, byteArrayOf(3, 4)).error == null)
  definition.synchronous["endWrite"]!!(arrayOf("account-b", operation))
  rejects {invoke("writeImage", root.path, "account-b", operation, imagePath, byteArrayOf(5))}
  check(next.read(imagePath, false, 1024)!!.contentEquals(byteArrayOf(3, 4)))
  val blockOperation = definition.synchronous["beginWrite"]!!(arrayOf("account-b")) as String
  check(invoke("writeBlock", root.path, "account-b", blockOperation, pdf, byteArrayOf(6, 7)).error == null)
  definition.synchronous["endWrite"]!!(arrayOf("account-b", blockOperation))
  rejects {invoke("writeBlock", root.path, "account-b", blockOperation, pdf, byteArrayOf(8))}
  check(next.read(pdf, true, 1024)!!.contentEquals(byteArrayOf(6, 7)))
  val blockLease = SlaxStorageOwner.capture("account-b")
  val blockStore = SlaxFileStore(root, pdfRoot, blockLease)
  rejects {blockStore.write(pdf, byteArrayOf(9), true) {blockLease.cancel()}}
  check(next.read(pdf, true, 1024)!!.contentEquals(byteArrayOf(6, 7)))
  val text = "article 正文 📖"; val textBytes = text.toByteArray(Charsets.UTF_8)
  val expectedHash = java.security.MessageDigest.getInstance("SHA-256").digest(textBytes).joinToString("") {"%02x".format(it.toInt() and 255)}
  check(next.textFingerprint(text) == mapOf("size" to textBytes.size.toDouble(), "sha256" to expectedHash))
  next.write(html, textBytes, false); check(next.fingerprint(html) == next.textFingerprint(text))
  check(next.fingerprint("bookmark/absent/content.html") == null)
  check(invoke("textFingerprint", root.path, "account-b", text).value == next.textFingerprint(text))
  check(invoke("fingerprint", root.path, "account-b", html).value == next.textFingerprint(text))
  val articleOperation = definition.synchronous["beginWrite"]!!(arrayOf("account-b")) as String
  check(invoke("writeArticle", root.path, "account-b", articleOperation, html, text).error == null)
  definition.synchronous["endWrite"]!!(arrayOf("account-b", articleOperation))
  rejects {invoke("writeArticle", root.path, "account-b", articleOperation, html, "late")}
  check(next.fingerprint(html) == next.textFingerprint(text))
  val entry = "bookmark/doc"
  next.stageRemoval(entry, "evict-one"); check(next.read(html, false, 1024) == null)
  val restarted = SlaxFileStore(root, pdfRoot, SlaxStorageOwner.capture("account-b"))
  restarted.restoreRemoval(entry, "evict-one"); check(restarted.read(html, false, 1024)!!.contentEquals(textBytes))
  restarted.stageRemoval(entry, "evict-two")
  restarted.write(html, "new generation".toByteArray(), false)
  restarted.stageRemoval(entry, "evict-two")
  restarted.restoreRemoval(entry, "evict-two")
  check(restarted.read(html, false, 1024)!!.toString(Charsets.UTF_8) == "new generation")
  check(restarted.read(imagePath, false, 1024)!!.contentEquals(byteArrayOf(3, 4)))
  restarted.stageRemoval(entry, "evict-three"); restarted.write(html, "after detach".toByteArray(), false)
  restarted.purgeRemoval(entry, "evict-three"); check(restarted.read(html, false, 1024)!!.toString(Charsets.UTF_8) == "after detach")
  restarted.purgeRemoval(entry, "evict-three"); restarted.restoreRemoval(entry, "evict-three")
  val detachLease = SlaxStorageOwner.capture("account-b"); val detach = SlaxFileStore(root, pdfRoot, detachLease)
  rejects {detach.stageRemoval(entry, "evict-cancel") {detachLease.cancel()}}
  check(restarted.read(html, false, 1024)!!.toString(Charsets.UTF_8) == "after detach")
  restarted.restoreRemoval(entry, "evict-cancel")
  val scoped = "pdf/v1/${"a".repeat(64)}/doc"; val manifest = "$scoped/manifest.json"
  restarted.write(manifest, byteArrayOf(1), true); restarted.write("$scoped/0.block", byteArrayOf(2), true)
  restarted.stageRemoval(scoped, "pdf-stage"); restarted.write(manifest, byteArrayOf(3), true); restarted.restoreRemoval(scoped, "pdf-stage")
  check(restarted.read(manifest, true, 1024)!!.contentEquals(byteArrayOf(3)))
  check(restarted.read("$scoped/0.block", true, 1024)!!.contentEquals(byteArrayOf(2)))
  for (bad in listOf("bookmark", "bookmark/doc/images", "pdf/v1/foreign/doc", "bookmark/../outside")) rejects {restarted.stageRemoval(bad, "invalid")}
  for (bad in listOf("", "../bad", "x".repeat(101))) rejects {restarted.stageRemoval(entry, bad)}
  restarted.stageRemoval(entry, "corrupt-marker")
  val receipt = File(root, "bookmark").listFiles()!!.single {it.name.startsWith(".slax-evict-corrupt-marker-")}
  File(receipt, "intent").writeText("wrong")
  rejects {restarted.restoreRemoval(entry, "corrupt-marker")}; rejects {restarted.purgeRemoval(entry, "corrupt-marker")}
  check(File(receipt, "payload/content.html").readText() == "after detach")
  File(receipt, "intent").writeText("slax-cache-eviction-v1\n$entry\n"); restarted.restoreRemoval(entry, "corrupt-marker")
  check(File(outside, "keep").readText() == "safe")
  val stagingId = definition.synchronous["beginWrite"]!!(arrayOf("account-b")) as String
  check(invoke("stageRemoval", root.path, "account-b", stagingId, entry, "bridge-stage").error == null)
  definition.synchronous["endWrite"]!!(arrayOf("account-b", stagingId))
  check(next.read(html, false, 1024) == null)
  check(invoke("restoreRemoval", root.path, "account-b", entry, "bridge-stage").error == null)
  check(next.read(html, false, 1024)!!.toString(Charsets.UTF_8) == "after detach")
  val purgeId = definition.synchronous["beginWrite"]!!(arrayOf("account-b")) as String
  check(invoke("stageRemoval", root.path, "account-b", purgeId, entry, "bridge-purge").error == null)
  definition.synchronous["endWrite"]!!(arrayOf("account-b", purgeId))
  check(invoke("purgeRemoval", root.path, "account-b", entry, "bridge-purge").error == null)
  check(next.read(html, false, 1024) == null)
  restarted.stageRemoval(entry, "empty-receipt")
  val emptyReceipt = File(root, "bookmark").listFiles()!!.single {it.name.startsWith(".slax-evict-empty-receipt-")}
  File(emptyReceipt, "intent").delete(); restarted.restoreRemoval(entry, "empty-receipt"); check(!emptyReceipt.exists())
  restarted.write(html, "interrupted intent".toByteArray(), false)
  val markerLease = SlaxStorageOwner.capture("account-b")
  rejects {SlaxFileStore(root, pdfRoot, markerLease).stageRemoval(entry, "partial-marker") {markerLease.cancel()}}
  val partialReceipt = File(root, "bookmark").listFiles()!!.single {it.name.startsWith(".slax-evict-partial-marker-")}
  File(partialReceipt, "intent").writeText("partial")
  restarted.restoreRemoval(entry, "partial-marker"); check(restarted.read(html, false, 1024)!!.toString(Charsets.UTF_8) == "interrupted intent")
  restarted.stageRemoval(entry, "revoked-purge"); SlaxStorageOwner.activate("account-c")
  rejects {restarted.purgeRemoval(entry, "revoked-purge")}
  val recoveredOwner = SlaxFileStore(root, pdfRoot, SlaxStorageOwner.capture("account-c"))
  recoveredOwner.restoreRemoval(entry, "revoked-purge"); check(recoveredOwner.read(html, false, 1024)!!.toString(Charsets.UTF_8) == "interrupted intent")
  println("Kotlin native file storage passed")
}
