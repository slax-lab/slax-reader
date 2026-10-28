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
  val observed = mutableListOf<String?>()
  val unobserve = SlaxStorageOwner.observe { observed.add(it) }
  SlaxStorageOwner.activate("account-a")
  check(observed == listOf("account-a") && SlaxStorageOwner.active() == "account-a")
  val store = SlaxFileStore(root, pdfRoot, SlaxStorageOwner.capture("account-a"))
  val html = "bookmark/doc/content.html"
  store.write(html, "old article".toByteArray())
  rejects {store.write(html, "replacement".toByteArray()) {error("Interrupted")}}
  check(store.read(html, 1024)!!.toString(Charsets.UTF_8) == "old article")
  check(File(root, "bookmark/doc").listFiles()!!.map { it.name } == listOf("content.html"))
  rejects {store.read(html, 1)}
  rejects {store.write(html, ByteArray(SlaxFileStore.ARTICLE_LIMIT + 1))}
  check(store.size(html) == 11L && store.measure("bookmark/doc") == 11L)
  check(store.readRange(html, 4, 7)!!.toString(Charsets.UTF_8) == "article" && store.readRange(html, 8, 7) == null)

  val part = "pdf/v2/scope/doc/document.pdf.part"
  store.append(part, 0, byteArrayOf(1, 2, 3))
  store.append(part, 2, byteArrayOf(9, 8))
  check(store.read(part, 1024)!!.contentEquals(byteArrayOf(1, 2, 9, 8)) && File(pdfRoot, part).exists())
  rejects {store.append(part, 10, byteArrayOf(1))}
  store.move(part, "pdf/v2/scope/doc/document.pdf")
  check(store.size(part) == null && store.size("pdf/v2/scope/doc/document.pdf") == 4L)
  check(store.list("pdf/v2/scope") == listOf("pdf/v2/scope/doc/document.pdf") && store.children("pdf/v2/scope/doc") == listOf("document.pdf"))
  store.write(SlaxFileStore.MARKER, "{\"layout\":2}".toByteArray())
  check(File(root, SlaxFileStore.MARKER).readText() == "{\"layout\":2}")
  for (bad in listOf("../private", "pdf/../private", "pdf//x", "/pdf/x", "bookmark/../x", "bookmark/key/../../x", "pdf/%2f/x", "bookmark/key\\bad/x", "offline-engine.json/x", "other.json")) rejects {store.read(bad, 1024)}

  File(root, "bookmark/.slax-delete-old").mkdirs(); File(root, "bookmark/.slax-evict-x-1/payload").mkdirs()
  check(store.purge("bookmark") { it.startsWith(".slax-") } == 2 && !File(root, "bookmark/.slax-delete-old").exists() && store.read(html, 1024) != null)

  val outside = File(root, "outside").apply {mkdirs()}
  File(outside, "keep").writeText("safe")
  Files.createSymbolicLink(File(root, "bookmark/linked").toPath(), outside.toPath())
  rejects {store.read("bookmark/linked/keep", 1024)}
  rejects {store.remove("bookmark/linked")}
  check(!store.children("bookmark").contains("linked"))
  check(File(outside, "keep").readText() == "safe")
  Files.delete(File(root, "bookmark/linked").toPath())

  val parent = SlaxStorageOwner.capture("account-a"); val child = parent.child()
  val childStore = SlaxFileStore(root, pdfRoot, child)
  child.cancel(); rejects {childStore.write(html, byteArrayOf(1))}; parent.check()
  val second = parent.child(); parent.cancel(); rejects {second.check()}
  check(store.read(html, 1024)!!.toString(Charsets.UTF_8) == "old article")

  val entered = CountDownLatch(1); val release = CountDownLatch(1); var failed = false
  val writer = thread {
    failed = runCatching {store.write(html, ByteArray(200_000) { 7 }) {entered.countDown(); check(release.await(5, TimeUnit.SECONDS))}}.isFailure
  }
  check(entered.await(5, TimeUnit.SECONDS)); SlaxStorageOwner.activate(null); SlaxStorageOwner.activate("account-b"); release.countDown(); writer.join(5000)
  check(!writer.isAlive && failed && observed == listOf("account-a", null, "account-b"))
  unobserve(); SlaxStorageOwner.activate("account-b"); check(observed.size == 3)
  rejects {store.read(html, 1024)}
  rejects {SlaxStorageOwner.capture(null)}
  val next = SlaxFileStore(root, pdfRoot, SlaxStorageOwner.capture("account-b"))
  check(next.read(html, 1024)!!.toString(Charsets.UTF_8) == "old article")
  next.write(html, "new account".toByteArray())
  check(next.read(html, 1024)!!.toString(Charsets.UTF_8) == "new account")
  check(next.remove("pdf/v2/scope") && !next.remove("pdf/v2/scope") && next.measure("pdf") == 0L)
  check(next.remove("bookmark/doc") && next.measure("bookmark/doc") == 0L)
  check(File(outside, "keep").readText() == "safe")

  val module = SlaxStorageModule(); module.appContext.reactContext = android.content.Context(root)
  val definition = module.definition(); val functions = definition.functions
  val imagePath = "bookmark/doc/images/image.jpg"
  val imageLease = SlaxStorageOwner.capture("account-b")
  val cancellable = SlaxFileStore(root, pdfRoot, imageLease)
  next.write(imagePath, byteArrayOf(1))
  rejects {cancellable.write(imagePath, byteArrayOf(2)) {imageLease.cancel()}}
  check(next.read(imagePath, 1024)!!.contentEquals(byteArrayOf(1)))
  fun invoke(name: String, vararg arguments: Any?): expo.modules.kotlin.Promise {
    val promise = expo.modules.kotlin.Promise(); functions[name]!!(arrayOf(*arguments, promise)); promise.await(); return promise
  }
  val avatar = "bookmark/avatar-x/manifest.json"
  val written = invoke("writeBytes", root.path, "account-b", avatar, byteArrayOf(9, 8))
  check(written.error == null && written.thread == "SlaxStorage" && written.value is String)
  val loaded = invoke("readBytes", root.path, "account-b", avatar)
  check(loaded.error == null && (loaded.value as ByteArray).contentEquals(byteArrayOf(9, 8)))
  check(invoke("size", root.path, "account-b", avatar).value == 2.0)
  check(invoke("list", root.path, "account-b", "bookmark/avatar-x").value == listOf(avatar))
  check(invoke("measure", root.path, "account-b", "bookmark/avatar-x").value == 2.0)
  check(invoke("writeText", root.path, "account-b", html, "native queued").error == null)
  check(invoke("readText", root.path, "account-b", html).value == "native queued")
  check(invoke("readBytes", outside.path, "account-b", avatar).error != null)
  check(invoke("readBytes", root.path, "account-b", "pdf/../foreign").error != null)
  rejects {invoke("readBytes", root.path, "old-owner", avatar)}
  check(invoke("remove", root.path, "account-b", avatar).error == null && next.size(avatar) == null)
  val operation = definition.synchronous["beginWrite"]!!(arrayOf("account-b")) as String
  check(invoke("writeImage", root.path, "account-b", operation, imagePath, byteArrayOf(3, 4)).error == null)
  definition.synchronous["endWrite"]!!(arrayOf("account-b", operation))
  rejects {invoke("writeImage", root.path, "account-b", operation, imagePath, byteArrayOf(5))}
  check(next.read(imagePath, 1024)!!.contentEquals(byteArrayOf(3, 4)))
  check(functions.keys == setOf("readBytes", "readText", "writeBytes", "writeImage", "writeText", "size", "list", "measure", "remove"))
  println("Kotlin native file storage passed")
}
