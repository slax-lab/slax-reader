package com.slax.reader.extension

import java.io.Closeable
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.Collections
import java.util.concurrent.CancellationException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

private const val URL = "https://fixture.example/private/article?secret=hidden#fragment"
private const val TOKEN = "synthetic-private-token-1234"
private const val TITLE = "private-document-title"
private const val VERSION = "1.0.0 (1)"

private data class Incoming(val path: String, val headers: Map<String, String>, val body: JSONObject)

private class HttpFixture(private val handler: (Incoming, Socket, HttpFixture) -> Unit) : Closeable {
  private val server = ServerSocket(0)
  private val sockets = Collections.synchronizedList(mutableListOf<Socket>())
  val requests = Collections.synchronizedList(mutableListOf<Incoming>())
  val createReceived = CountDownLatch(1)
  val receiptReceived = CountDownLatch(1)
  private val stopped = CountDownLatch(1)
  val base = "http://127.0.0.1:${server.localPort}/beta/"
  init {
    Thread {
      while (!server.isClosed) {
        val socket = try {server.accept()} catch (_: IOException) {break}
        sockets.add(socket)
        Thread {
          try {
            socket.use {
              val input = it.getInputStream().bufferedReader()
              val path = input.readLine().split(" ")[1]
              val headers = mutableMapOf<String, String>()
              while (true) {
                val line = input.readLine() ?: break
                if (line.isEmpty()) break
                val parts = line.split(':', limit = 2)
                headers[parts[0].lowercase()] = parts[1].trim()
              }
              val body = CharArray(headers["content-length"]!!.toInt())
              var offset = 0
              while (offset < body.size) {
                val read = input.read(body, offset, body.size - offset)
                check(read > 0)
                offset += read
              }
              val request = Incoming(path, headers, JSONObject(String(body)))
              requests.add(request)
              if (path == "/v1/bookmark/add_url") createReceived.countDown() else receiptReceived.countDown()
              handler(request, it, this)
            }
          } catch (_: IOException) {}
        }.apply {isDaemon = true; start()}
      }
    }.apply {isDaemon = true; start()}
  }
  fun stall() {stopped.await()}
  override fun close() {
    stopped.countDown()
    server.close()
    synchronized(sockets) {sockets.forEach {runCatching {it.close()}}}
  }
  fun verifyCounts(create: Int, receipt: Int) {
    check(requests.count {it.path == "/v1/bookmark/add_url"} == create) {requests.toString()}
    check(requests.count {it.path == "/v1/bookmark/exists"} == receipt) {requests.toString()}
    check(requests.size == create + receipt)
    for (request in requests) {
      check(request.headers["authorization"] == "Bearer $TOKEN")
      check(request.headers["user-agent"] == "SlaxReader/Android $VERSION")
      check(request.headers["content-type"] == "application/json")
      check(request.body.getString("target_url") == URL)
      if (request.path.endsWith("exists")) check(request.body.length() == 1)
      else check(request.body.getString("target_title") == TITLE)
    }
  }
}

private fun Socket.respond(status: Int, body: String = "", length: Int = body.toByteArray().size, extra: String = "") {
  getOutputStream().apply {
    write(("HTTP/1.1 $status Fixture\r\nContent-Length: $length\r\nContent-Type: application/json\r\nCF-Ray: fixture-ray\r\nConnection: close\r\n$extra\r\n" + body).toByteArray())
    flush()
  }
}

private class Evidence {
  val timings = ShareNetworkTimings()
  val record = ShareDiagnosticRecord("fixture", "Android fixture").apply {
    moveTo("request")
    token = ShareDiagnosticRecord.token(TOKEN)
    input = ShareDiagnosticRecord.input("android.intent.action.SEND", "text/plain", URL, TITLE, null)
    input.put("url", ShareDiagnosticRecord.url(URL))
  }
  val failures = mutableListOf<Exception>()
  var finishes = 0
  val transport = ShareSaveTransport(ShareNetworkListener(timings),
    onResponse = {code, body, ray -> record.moveTo("response"); record.http = ShareDiagnosticRecord.http(code, body, ray)},
    onFailure = {failures.add(it); record.error = JSONObject().put("class", it.javaClass.simpleName)},
    onCreateFinished = {finishes++; record.finishRequest()},
  )
  fun save(server: HttpFixture): ShareSaveTransport.Result = transport.save(server.base, TOKEN, VERSION, URL, TITLE)
  fun terminal(result: ShareSaveTransport.Result): JSONObject {
    record.reason = result.reason
    if (result.message == "ok") record.moveTo("done")
    val end = record.end(if (result.message == "ok") "success" else "failed", if (result.message == "ok") "Success!" else result.message, timings.snapshot())
    val line = String(ShareDiagnosticRecord.line(end)!!)
    for (secret in listOf(URL, TOKEN, TITLE, "secret=hidden", "private-response-body")) check(!line.contains(secret))
    return end
  }
}

private fun elapsed(start: Long) = (System.nanoTime() - start) / 1_000_000
private fun within(actual: Long, low: Long, high: Long) {check(actual in low..high) {"Elapsed $actual ms outside $low..$high"}}
private fun CountDownLatch.awaitReady() {check(await(8, TimeUnit.SECONDS)) {"Fixture phase did not start"}}

fun main() {
  check(SocketTimeoutException().isShareTimeout())
  check(InterruptedIOException("timeout").isShareTimeout())
  check(!InterruptedIOException("interrupted").isShareTimeout())
  check(!IOException("timeout").isShareTimeout())
  check(!CancellationException("timeout").isShareTimeout())
  val cases = mutableListOf<Pair<String, () -> Unit>>()
  fun scenario(name: String, run: () -> Unit) {cases.add(name to run)}

  for (status in listOf(200, 204)) scenario("success $status ignores stalled body") {
    HttpFixture {_, socket, server -> socket.respond(status, length = if (status == 204) 0 else 4096); server.stall()}.use {server ->
      val evidence = Evidence(); val start = System.nanoTime()
      val result = evidence.save(server)
      within(elapsed(start), 0, 2000)
      check(result == ShareSaveTransport.Result("ok", "success"))
      check(evidence.finishes == 1 && evidence.failures.isEmpty())
      check(evidence.terminal(result).getJSONObject("http").getInt("status") == status)
      server.verifyCounts(1, 0)
    }
  }

  for (status in listOf(401, 408, 429, 500, 503, 302)) scenario("definitive $status never recovers or retries") {
    HttpFixture {_, socket, server ->
      socket.respond(status, length = 4096, extra = "Retry-After: 0\r\nLocation: ${server.base}followup\r\n"); server.stall()
    }.use {server ->
      val evidence = Evidence(); val start = System.nanoTime()
      val result = evidence.save(server)
      within(elapsed(start), 0, 2000)
      check(result.message == if (status == 401) "Auth expired, please reopen the app to login again." else ShareSaveTransport.FAILURE_MESSAGE)
      check(evidence.terminal(result).getJSONObject("http").getInt("status") == status)
      server.verifyCounts(1, 0)
    }
  }

  scenario("400 keeps existing parsed message") {
    HttpFixture {_, socket, _ -> socket.respond(400, "{\"message\":\"private-response-body\"}")}.use {server ->
      val evidence = Evidence(); val result = evidence.save(server)
      check(result == ShareSaveTransport.Result("private-response-body", "http_400"))
      check(evidence.terminal(result).getString("shown") == "[redacted]")
      server.verifyCounts(1, 0)
    }
  }

  scenario("late rejection body shares remaining total budget") {
    HttpFixture {_, socket, server -> Thread.sleep(3800); socket.respond(400, length = 4096); server.stall()}.use {server ->
      val evidence = Evidence(); val start = System.nanoTime(); val result = evidence.save(server)
      within(elapsed(start), 4700, 6300)
      check(result == ShareSaveTransport.Result(ShareSaveTransport.FAILURE_MESSAGE, "http_400"))
      check(evidence.failures.single().isShareTimeout())
      check(evidence.terminal(result).getJSONObject("http").getInt("status") == 400)
      server.verifyCounts(1, 0)
    }
  }

  for (lookup in listOf("true", "false", "malformed", "missing", "string", "number", "204", "404", "401", "503", "302", "disconnect", "stall", "bodyStall", "delayedBody", "partialBody")) scenario("create deadline exists $lookup") {
    val bounded = lookup in listOf("stall", "bodyStall", "delayedBody", "partialBody")
    HttpFixture {request, socket, server ->
      if (request.path.endsWith("add_url")) server.stall()
      else when (lookup) {
        "stall" -> server.stall()
        "disconnect" -> Unit
        "true" -> {Thread.sleep(450); socket.respond(200, "{\"data\":{\"exists\":true}}")}
        "false" -> socket.respond(200, "{\"data\":{\"exists\":false}}")
        "malformed" -> socket.respond(200, "{")
        "missing" -> socket.respond(200, "{\"data\":{}}")
        "string" -> socket.respond(200, "{\"data\":{\"exists\":\"true\"}}")
        "number" -> socket.respond(200, "{\"data\":{\"exists\":1}}")
        "204" -> socket.respond(204)
        "bodyStall", "delayedBody", "partialBody" -> {
          if (lookup == "delayedBody") Thread.sleep(2200)
          socket.respond(200, "{\"data\":{\"exists\":true}}", length = 4096)
          if (lookup == "partialBody") {
            val out = socket.getOutputStream()
            repeat(10) {Thread.sleep(600); out.write(' '.code); out.flush()}
          } else server.stall()
        }
        else -> {socket.respond(lookup.toInt(), length = 4096, extra = "Retry-After: 0\r\nLocation: ${server.base}followup\r\n"); server.stall()}
      }
    }.use {server ->
      val evidence = Evidence(); val start = System.nanoTime(); val result = evidence.save(server)
      within(elapsed(start), if (bounded) 7700 else 4700, if (bounded) 9300 else 6600)
      check(result == if (lookup == "true") ShareSaveTransport.Result("ok", "success") else ShareSaveTransport.Result(ShareSaveTransport.TIMEOUT_MESSAGE, "network_timeout"))
      check(evidence.finishes == 1)
      val failure = evidence.failures.single()
      check(failure is InterruptedIOException && failure.isShareTimeout()) {failure.toString()}
      val terminal = evidence.terminal(result)
      check(terminal.getJSONObject("error").getString("class") == failure.javaClass.simpleName)
      check(terminal.isNull("http"))
      within(terminal.getJSONObject("net").getLong("total"), 4700, 6300)
      within(terminal.getJSONObject("ms").getLong("request"), 4700, 6300)
      if (lookup == "true" || bounded) check(terminal.getJSONObject("ms").getLong("total") - terminal.getJSONObject("ms").getLong("request") >= if (bounded) 2700 else 400)
      server.verifyCounts(1, 1)
    }
  }

  scenario("partial header traffic cannot extend create deadline") {
    HttpFixture {request, socket, _ ->
      if (request.path.endsWith("exists")) socket.respond(200, "{\"data\":{\"exists\":true}}")
      else {
        val out = socket.getOutputStream()
        out.write("HTTP/1.1 200 Fixture\r\nX-Slow: ".toByteArray()); out.flush()
        repeat(15) {Thread.sleep(600); out.write('a'.code); out.flush()}
      }
    }.use {server ->
      val evidence = Evidence(); val start = System.nanoTime(); val result = evidence.save(server)
      within(elapsed(start), 4700, 6300)
      check(result.message == "ok" && evidence.failures.single().isShareTimeout())
      server.verifyCounts(1, 1)
    }
  }

  scenario("non timeout disconnect never recovers") {
    HttpFixture {_, _, _ ->}.use {server ->
      val evidence = Evidence()
      val error = runCatching {evidence.save(server)}.exceptionOrNull()
      check(error is IOException && !error.isShareTimeout())
      check(evidence.failures.isEmpty() && evidence.finishes == 1)
      server.verifyCounts(1, 0)
    }
  }

  scenario("partial exists headers cannot extend its deadline") {
    HttpFixture {request, socket, server ->
      if (request.path.endsWith("add_url")) server.stall()
      else {
        val out = socket.getOutputStream()
        out.write("HTTP/1.1 200 Fixture\r\nX-Slow: ".toByteArray()); out.flush()
        repeat(10) {Thread.sleep(600); out.write('a'.code); out.flush()}
      }
    }.use {server ->
      val evidence = Evidence(); val start = System.nanoTime(); val result = evidence.save(server)
      within(elapsed(start), 7700, 9300)
      check(result == ShareSaveTransport.Result(ShareSaveTransport.TIMEOUT_MESSAGE, "network_timeout"))
      check(evidence.failures.single().isShareTimeout())
      server.verifyCounts(1, 1)
    }
  }

  for (phase in listOf("before", "create", "exists", "existsBody", "transition", "headers", "errorBody")) scenario("cancellation at $phase owns outcome") {
    val transition = CountDownLatch(1); val resume = CountDownLatch(1); val headers = CountDownLatch(1)
    HttpFixture {request, socket, server ->
      if (phase == "headers" || phase == "errorBody") socket.respond(if (phase == "headers") 200 else 400, length = 4096)
      if (phase == "existsBody" && request.path.endsWith("exists")) {
        socket.respond(200, "{\"data\":{\"exists\":", length = 4096)
        headers.countDown()
      }
      server.stall()
    }.use {server ->
      lateinit var transport: ShareSaveTransport
      transport = ShareSaveTransport(
        onResponse = {_, _, _ -> headers.countDown(); if (phase == "headers") transport.cancel()},
        onCreateFinished = {if (phase == "transition") {transition.countDown(); resume.await()}},
      )
      if (phase == "before") transport.cancel()
      val worker = Executors.newSingleThreadExecutor()
      try {
        val result = worker.submit<Throwable?> {runCatching {transport.save(server.base, TOKEN, VERSION, URL, TITLE)}.exceptionOrNull()}
        when (phase) {
          "create" -> server.createReceived.awaitReady()
          "exists" -> server.receiptReceived.awaitReady()
          "transition" -> transition.awaitReady()
          "errorBody", "existsBody" -> headers.awaitReady()
        }
        val start = System.nanoTime()
        if (phase != "headers") transport.cancel()
        resume.countDown()
        check(result.get(2, TimeUnit.SECONDS) is CancellationException)
        within(elapsed(start), 0, 1500)
        server.verifyCounts(if (phase == "before") 0 else 1, if (phase == "exists" || phase == "existsBody") 1 else 0)
      } finally {resume.countDown(); worker.shutdownNow()}
    }
  }

  val workers = Executors.newFixedThreadPool(4)
  try {
    val futures = cases.map {(name, run) -> workers.submit {try {run(); println("PASS: $name")} catch (error: Throwable) {throw AssertionError(name, error)}}}
    futures.forEach {it.get(120, TimeUnit.SECONDS)}
  } finally {workers.shutdownNow()}
  println("Kotlin HTTP transport checks passed: ${cases.size} scenarios")
}
