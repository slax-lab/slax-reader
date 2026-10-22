package com.slax.reader.platform

import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

private fun rejects(work: () -> Unit) {check(runCatching(work).isFailure) {"Expected PDF rejection"}}
private fun drained() {repeat(100) {if (SlaxPdfTransfers.count() == 0) return; Thread.sleep(10)}; error("PDF handles did not drain")}
fun main(args: Array<String>) {
  val origin = args[0]
  SlaxStorageOwner.activate("account-a")
  val headers = mapOf("Authorization" to "Bearer synthetic", "Accept" to "application/pdf", "Range" to "bytes=0-7", "X-CLIENT-TYPE" to "android", "X-CLIENT-VERSION" to "test")
  fun begin() = SlaxPdfTransfers.begin("account-a", origin, true)
  fun transfer(id: String) = SlaxPdfTransfers.get("account-a", id)
  fun url(mode: String) = "$origin/v1/bookmark/pdf?bookmark_uid=$mode"
  val id = begin(); val first = transfer(id)
  check(first.open(url("full"), headers)["status"] == 200)
  Thread.sleep(30)
  var offset = 0
  while (true) {
    val chunk = first.read() ?: break
    check(chunk.size in 1..SlaxPdfTransfers.CHUNK_BYTES)
    for (index in chunk.indices) check(chunk[index].toInt() and 255 == (offset + index) % 251)
    offset += chunk.size
  }
  check(offset == 2 * 1024 * 1024 + 17); drained()
  val redirect = begin(); check(transfer(redirect).open(url("redirect"), headers)["status"] == 302); SlaxPdfTransfers.end("account-a", redirect); drained()
  val denied = begin(); check(transfer(denied).open(url("denied"), headers)["status"] == 403); SlaxPdfTransfers.end("account-a", denied); drained()
  for (mode in listOf("oversize", "compressed", "truncated")) {
    val bad = begin()
    rejects {val value = transfer(bad); value.open(url(mode), headers); while (value.read() != null) {}}
    SlaxPdfTransfers.end("account-a", bad); drained()
  }
  for (bad in listOf("$origin/other", "$origin/v1/bookmark/pdf?bookmark_uid=full&extra=1", "https://other.test/v1/bookmark/pdf?bookmark_uid=full")) {
    val rejected = begin(); rejects {transfer(rejected).open(bad, headers)}; SlaxPdfTransfers.end("account-a", rejected); drained()
  }
  val forbiddenHeader = begin(); rejects {transfer(forbiddenHeader).open(url("full"), headers + ("Cookie" to "forbidden"))}; SlaxPdfTransfers.end("account-a", forbiddenHeader); drained()
  rejects {SlaxPdfTransfers.begin("account-a", "http://remote.test", true)}
  rejects {SlaxPdfTransfers.begin("account-a", origin, false)}
  val capacity = (1..6).map {begin()}; rejects {begin()}; capacity.forEach {SlaxPdfTransfers.end("account-a", it)}; drained()
  val slow = begin(); val slowTransfer = transfer(slow); slowTransfer.open(url("slow"), headers)
  val entered = CountDownLatch(1); var cancelled = false
  val reading = thread {entered.countDown(); cancelled = runCatching {while (slowTransfer.read() != null) {}}.isFailure}
  check(entered.await(2, TimeUnit.SECONDS)); SlaxPdfTransfers.end("account-a", slow); reading.join(3000); check(!reading.isAlive && cancelled); drained()
  val stale = begin(); transfer(stale).open(url("full"), headers)
  SlaxStorageOwner.activate("account-b"); rejects {transfer(stale).read()}; SlaxPdfTransfers.revokeAll(); drained()
  SlaxStorageOwner.activate("account-a")
  val module = SlaxPdfTransferModule(); module.appContext.reactContext = android.content.Context(File(args[1]))
  val definition = module.definition()
  val nativeId = definition.synchronous["begin"]!!(arrayOf("account-a", origin)) as String
  fun invoke(name: String, vararg arguments: Any?): expo.modules.kotlin.Promise {
    val promise = expo.modules.kotlin.Promise(); definition.functions[name]!!(arrayOf(*arguments, promise)); promise.await(); check(promise.error == null); return promise
  }
  val opened = invoke("open", "account-a", nativeId, url("partial"), headers)
  check((opened.value as Map<*, *>)["status"] == 206 && opened.thread == "SlaxPdfTransfer")
  check((invoke("read", "account-a", nativeId).value as ByteArray).contentEquals(ByteArray(8) {it.toByte()}))
  check(invoke("read", "account-a", nativeId).value == null); drained()
  println("Kotlin bounded PDF transport passed")
}
