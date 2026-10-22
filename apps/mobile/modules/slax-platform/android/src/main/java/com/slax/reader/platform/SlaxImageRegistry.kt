package com.slax.reader.platform

import okhttp3.Authenticator
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal data class SlaxImageResource(val file: File, val mime: String?, val size: Long)
internal class SlaxImageFailure(val status: Int = 0, val retryAfter: String? = null, val terminal: Boolean = false) : Exception("Image resource unavailable")

internal class SlaxImageRegistry(private val directory: File) {
  companion object {const val MAX_BYTES = 20L * 1024 * 1024; const val TOTAL_BYTES = 60L * 1024 * 1024; const val CHUNK_BYTES = 64 * 1024}
  private val lock = Any()
  private val jobs = mutableMapOf<List<String>, Job>()
  private val retained = mutableSetOf<Job>()
  private val running = mutableSetOf<Job>()
  private val destinations = mutableMapOf<String, Int>()
  private var reserved = 0L
  private var closed = false
  private val workers = ThreadPoolExecutor(3, 3, 30, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(128)) { work -> Thread(work, "SlaxImageResource").apply {isDaemon = true} }.apply {allowCoreThreadTimeOut(true)}
  private val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES).authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
    .followRedirects(false).followSslRedirects(false).cache(null).retryOnConnectionFailure(false)
    .connectTimeout(30, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).callTimeout(30, TimeUnit.SECONDS).build()
  private class Job(val key: List<String>, val owner: String, val original: String, val policy: SlaxReaderSecurity, val lease: SlaxStorageLease) {
    val host = java.net.URI(original).rawAuthority
    val consumers = mutableSetOf<Consumer>()
    val drained = CompletableFuture<Void>()
    var state = "queued"
    var reserved = 0L
    var cancelled = false
    var call: Call? = null
    var result: SlaxImageResource? = null
    var error: Throwable? = null
  }
  internal class Consumer(private val registry: SlaxImageRegistry, private val token: Any, private val lease: SlaxStorageLease, private val strict: Boolean) : AutoCloseable {
    private val future = CompletableFuture<SlaxImageResource>()
    internal fun ready(resource: SlaxImageResource?, error: Throwable?) {
      if (error != null) future.completeExceptionally(error)
      else if (resource != null) future.complete(resource)
    }
    fun await(): SlaxImageResource {
      val resource = try {future.get()} catch (error: java.util.concurrent.ExecutionException) {throw error.cause ?: error}
      lease.check()
      if (strict && resource.mime?.startsWith("image/") != true) throw SlaxImageFailure(terminal = true)
      return resource
    }
    fun persist(root: File, relative: String, beforeCommit: () -> Unit = {}): String {
      require(relative.startsWith("bookmark/") && relative.split('/').getOrNull(2) == "images") {"Invalid image destination"}
      val resource = await()
      return resource.file.inputStream().use {SlaxFileStore(root, root, lease).writeStream(relative, it, resource.size, beforeCommit)}
    }
    fun stream(): java.io.InputStream {
      val input = await().file.inputStream()
      return object : java.io.FilterInputStream(input) {
        override fun read(): Int {lease.check(); val value = super.read(); lease.check(); return value}
        override fun read(bytes: ByteArray, offset: Int, length: Int): Int {lease.check(); val count = `in`.read(bytes, offset, minOf(length, CHUNK_BYTES)); lease.check(); return count}
        override fun close() {try {super.close()} finally {this@Consumer.close()}}
      }
    }
    fun check() = lease.check()
    override fun close() {lease.cancel(); future.completeExceptionally(SlaxImageFailure()); registry.detach(token as Job, this)}
  }
  fun acquire(owner: String, raw: String, policy: SlaxReaderSecurity, strict: Boolean = true): Consumer {
    val lease = SlaxStorageOwner.capture(owner)
    val original = policy.imageOriginal(raw) ?: throw SlaxImageFailure(terminal = true)
    val key = listOf(owner, policy.protectedHosts.joinToString("\u0000"), policy.imageProxyOrigins.sorted().joinToString("\u0000"), original)
    synchronized(lock) {
      check(!closed) {"Image registry closed"}
      if (retained.sumOf {it.consumers.size} >= 256) throw SlaxImageFailure()
      var job = jobs[key]
      if (job != null && runCatching {job.lease.check()}.isFailure) {job.consumers.toList().forEach {it.close()}; job = null}
      if (job == null) {
        if (retained.size >= 128) throw SlaxImageFailure()
        job = Job(key, owner, original, policy, SlaxStorageOwner.capture(owner)); jobs[key] = job; retained.add(job)
      }
      val consumer = Consumer(this, job, lease, strict); job.consumers.add(consumer)
      if (job.state == "complete") consumer.ready(job.result, job.error)
      pump()
      return consumer
    }
  }
  private fun active(job: Job) {
    job.lease.check()
    synchronized(lock) {if (closed || job.cancelled || job.consumers.isEmpty()) throw SlaxImageFailure()}
  }
  private fun pump() {
    if (closed) return
    while (running.size < 3 && reserved + MAX_BYTES <= TOTAL_BYTES) {
      val job = jobs.values.firstOrNull {it.state == "queued" && !it.cancelled && it.consumers.isNotEmpty() && running.count {running -> running.host == it.host} < 2} ?: return
      job.state = "running"; running.add(job); job.reserved = MAX_BYTES; reserved += MAX_BYTES
      workers.execute {run(job)}
    }
  }
  private fun detach(job: Job, consumer: Consumer) {
    synchronized(lock) {
      if (!job.consumers.remove(consumer) || job.consumers.isNotEmpty()) return
      job.cancelled = true; job.lease.cancel(); job.call?.cancel()
      if (jobs[job.key] === job) jobs.remove(job.key)
      if (job.state == "queued") {job.state = "retired"; retained.remove(job); job.drained.complete(null)}
      else if (job.state == "complete") cleanup(job)
      pump()
    }
  }
  private fun cleanup(job: Job) {
    job.state = "retired"
    workers.execute {
      var error: Exception? = null
      try {job.result?.file?.let {Files.deleteIfExists(it.toPath())}} catch (failure: Exception) {error = failure}
      finally {synchronized(lock) {
        retained.remove(job)
        if (error == null) {reserved -= job.reserved; job.reserved = 0; job.drained.complete(null)}
        else {job.drained.completeExceptionally(error); close()}
        pump()
      }}
    }
  }
  private fun run(job: Job) {
    var output: SlaxImageResource? = null
    try {
      output = download(job); active(job)
      synchronized(lock) {job.result = output; reserved -= job.reserved - output.size; job.reserved = output.size}
    } catch (error: Exception) {
      output?.file?.let {runCatching {Files.deleteIfExists(it.toPath())}}
      synchronized(lock) {job.error = error; if (jobs[job.key] === job) jobs.remove(job.key)}
    } finally {
      synchronized(lock) {
        running.remove(job); job.state = "complete"
        job.consumers.toList().forEach {it.ready(job.result, job.error)}
        if (job.consumers.isEmpty()) cleanup(job)
        pump()
      }
    }
  }
  private fun download(job: Job): SlaxImageResource {
    active(job)
    check(directory.canonicalFile == directory.absoluteFile && !Files.isSymbolicLink(directory.toPath())) {"Unsafe image staging root"}
    Files.createDirectories(directory.toPath())
    check(directory.canonicalFile == directory.absoluteFile && !Files.isSymbolicLink(directory.toPath())) {"Unsafe image staging root"}
    var response: Response? = null
    var temporary: File? = null
    var complete = false
    var destination: String? = null
    fun releaseDestination() = synchronized(lock) {
      destination?.let {host -> val count = (destinations[host] ?: 1) - 1; if (count == 0) destinations.remove(host) else destinations[host] = count}
      destination = null
    }
    try {
      var url = job.original
      for (redirects in 0..10) {
        active(job)
        if (job.policy.imageOriginal(url) == null) throw SlaxImageFailure(terminal = true)
        val request = Request.Builder().url(url).get().build()
        val host = "${request.url.scheme}://${request.url.host}:${request.url.port}"
        synchronized(lock) {
          if ((destinations[host] ?: 0) >= 2) throw SlaxImageFailure()
          destinations[host] = (destinations[host] ?: 0) + 1; destination = host
        }
        val call = client.newCall(request)
        synchronized(lock) {active(job); job.call = call}
        val received = call.execute(); response = received; active(job)
        if (received.code !in listOf(301, 302, 303, 307, 308)) break
        val target = received.header("Location")?.let {received.request.url.resolve(it)?.toString()}
        received.close(); response = null; releaseDestination()
        if (redirects == 10 || target == null || job.policy.imageOriginal(target) == null) throw SlaxImageFailure(terminal = true)
        url = target
      }
      val received = response ?: throw SlaxImageFailure()
      if (received.code != 200) throw SlaxImageFailure(received.code, received.header("Retry-After"), received.code in 400..499 && received.code !in listOf(408, 429))
      val body = received.body ?: throw SlaxImageFailure(terminal = true)
      val mime = body.contentType()?.let {"${it.type}/${it.subtype}"}
      val strict = job.policy.signedImageProxy(job.original) || job.policy.signedImageProxy(received.request.url.toString())
      if (mime != null && !mime.startsWith("image/") || strict && mime == null || body.contentLength() > MAX_BYTES) throw SlaxImageFailure(terminal = true)
      val file = File(directory, "slax-image-${UUID.randomUUID()}.tmp"); temporary = file
      check(file.createNewFile()) {"Image staging collision"}
      var size = 0L
      body.byteStream().use {input -> FileOutputStream(file).use {output ->
        val buffer = ByteArray(CHUNK_BYTES)
        while (true) {
          active(job); val count = input.read(buffer); active(job); if (count < 0) break
          size += count; if (size > MAX_BYTES) throw SlaxImageFailure(terminal = true)
          output.write(buffer, 0, count)
        }
        if (size <= 0 || body.contentLength() >= 0 && size != body.contentLength()) throw SlaxImageFailure(terminal = true)
        output.fd.sync()
      }}
      active(job); complete = true
      return SlaxImageResource(file, mime, size)
    } finally {
      response?.close(); releaseDestination(); synchronized(lock) {job.call = null}
      if (!complete) temporary?.let {Files.deleteIfExists(it.toPath())}
    }
  }
  fun close(): CompletableFuture<Void> {
    synchronized(lock) {
      closed = true
      val previous = retained.toList()
      previous.flatMap {it.consumers.toList()}.forEach {it.close()}
      return CompletableFuture.allOf(*previous.map {it.drained}.toTypedArray())
    }
  }
}
