package com.slax.reader.platform

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

internal const val PDF_WINDOW = 1024 * 1024L

/** `GET /v1/bookmark/metadata` with `SlaxApi.pdfRequest` attempts inside one 120 s budget. */
internal suspend fun downloadDescriptor(scope: SlaxOfflineScope, id: String, token: String, work: SlaxOfflineWork): SlaxPdfDescriptor {
  val started = System.currentTimeMillis()
  for (attempt in 0 until 3) {
    val remaining = 120_000 - (System.currentTimeMillis() - started)
    if (remaining <= 0) throw SlaxOfflineError.timeout
    val failure = try {
      val response = SlaxOfflineHttp.send(SlaxOfflineHttp.metadata(scope, id, token), 1024 * 1024, SlaxOfflineError.pdf("pdf_body_invalid"), remaining, work)
      if (response.status == 200) {
        val envelope = SlaxOfflineValues.json(response.body) as? Map<*, *>
        val code = SlaxOfflineValues.int(envelope?.get("code")) ?: throw SlaxOfflineError.pdf("pdf_body_invalid")
        if (code != 200L) throw SlaxOfflineError("pdf_metadata_failed", code.toInt())
        return SlaxPdfDescriptor.parse((envelope!!["data"] as? Map<*, *>)?.get("pdf")) ?: throw SlaxOfflineError.pdf("pdf_metadata_invalid")
      }
      SlaxOfflineError.http(response.status, SlaxOfflineClock.retryAfter(response.headers["Retry-After"]))
    } catch (error: SlaxOfflineError) {error}
    if (!failure.retryable || attempt >= 2) throw failure
    delay(1000L * (attempt + 1)); work.check()
  }
  throw SlaxOfflineError.network
}

internal sealed class SlaxPdfBody {class Range(val bytes: ByteArray) : SlaxPdfBody(); object Full : SlaxPdfBody()}

/** `GET /v1/bookmark/pdf` through `SlaxPdfTransfer`, validated like `SlaxApi.transferPdf`. Full 200 bodies are streamed to [sink] on an IO thread. */
internal suspend fun transferPdf(scope: SlaxOfflineScope, token: String, id: String, documentId: String, size: Long, begin: Long, end: Long, work: SlaxOfflineWork,
  foreground: kotlinx.coroutines.CoroutineDispatcher? = null, sink: (ByteArray, Long) -> Unit): SlaxPdfBody {
  if (!Regex("^[A-Za-z0-9_-]+$").matches(id)) throw SlaxOfflineError.invalid
  val url = "${scope.origin}/v1/bookmark/pdf?bookmark_uid=$id"
  val headers = mapOf("Authorization" to "Bearer $token", "Accept" to "application/pdf", "Range" to "bytes=$begin-${end - 1}", "X-CLIENT-TYPE" to scope.clientType, "X-CLIENT-VERSION" to scope.clientVersion)
  for (attempt in 0 until 3) {
    work.check()
    val handle = AtomicReference<String?>()
    val outcome = try {
      Result.success(slaxBlocking({ handle.get()?.let { SlaxPdfTransfers.end(scope.owner, it) } }, foreground ?: kotlinx.coroutines.Dispatchers.IO) {
        val transferId = SlaxPdfTransfers.begin(scope.owner, scope.origin, scope.allowHttp, foreground != null); handle.set(transferId)
        val hook = work.attach { SlaxPdfTransfers.end(scope.owner, transferId) }
        try {
          val transfer = SlaxPdfTransfers.get(scope.owner, transferId)
          val head = transfer.open(url, headers)
          val status = head["status"] as? Int ?: throw SlaxOfflineError.pdf("pdf_body_invalid")
          @Suppress("UNCHECKED_CAST") val fields = head["headers"] as? Map<String, String> ?: throw SlaxOfflineError.pdf("pdf_body_invalid")
          if (status != 200 && status != 206) throw SlaxOfflineError.http(status, SlaxOfflineClock.retryAfter(fields["Retry-After"]))
          if (fields["Content-Type"]?.split(";")?.first()?.trim()?.lowercase() != "application/pdf") throw SlaxOfflineError.pdf("pdf_body_invalid")
          val etag = fields["ETag"]
          if (etag != null && Regex("^\"[a-f0-9]{64}\"$").matches(etag) && etag != "\"$documentId\"") throw SlaxOfflineError.pdf("pdf_identity_mismatch", 412)
          val full = status == 200
          val expected = if (full) {
            if (fields["Content-Range"] != null) throw SlaxOfflineError.pdf("pdf_range_invalid")
            fields["Content-Length"]?.toLongOrNull()?.takeIf { it == size } ?: throw SlaxOfflineError.pdf("pdf_length_invalid")
          } else {
            val parts = fields["Content-Range"]?.takeIf { Regex("^bytes [0-9]+-[0-9]+/[0-9]+$").matches(it) }?.drop(6)?.split('-', '/')?.mapNotNull { it.toLongOrNull() }
            if (parts == null || parts.size != 3 || parts[0] != begin || parts[1] != end - 1 || parts[2] != size || parts[2] > SlaxPdfDescriptor.MAX_BYTES) throw SlaxOfflineError.pdf("pdf_range_invalid")
            fields["Content-Length"]?.let { if (it.toLongOrNull() != end - begin) throw SlaxOfflineError.pdf("pdf_length_invalid") }
            end - begin
          }
          var received = 0L
          val body = java.io.ByteArrayOutputStream()
          while (true) {
            val chunk = transfer.read() ?: break
            work.check()
            if (received + chunk.size > expected) throw SlaxOfflineError.pdf("pdf_length_invalid")
            if (full) sink(chunk, received) else body.write(chunk)
            received += chunk.size
          }
          if (received != expected) throw SlaxOfflineError.pdf("pdf_length_invalid")
          if (full) SlaxPdfBody.Full else SlaxPdfBody.Range(body.toByteArray())
        } finally {work.detach(hook); SlaxPdfTransfers.end(scope.owner, transferId)}
      })
    } catch (error: CancellationException) {throw error} catch (error: Exception) {
      handle.get()?.let { SlaxPdfTransfers.end(scope.owner, it) }
      Result.failure<SlaxPdfBody>(when (error) {
        is SlaxOfflineError -> error
        is SlaxPdfTransferError -> when (error.code) {
          "cancelled" -> if (work.isCancelled) SlaxOfflineError.cancelled else SlaxOfflineError.network
          "busy" -> SlaxOfflineError.busy
          "network" -> SlaxOfflineError.network
          else -> SlaxOfflineError.pdf(if (error.code == "limit") "pdf_length_invalid" else "pdf_body_invalid")
        }
        else -> SlaxOfflineError.from(error, work.lease)
      })
    }
    outcome.getOrNull()?.let { return it }
    val failure = outcome.exceptionOrNull() as SlaxOfflineError
    if (!failure.retryable || attempt >= 2) throw failure
    delay(1000L * (attempt + 1)); work.check()
  }
  throw SlaxOfflineError.network
}

/** Fetches and stores the descriptor; a changed identity removes the old document first. */
private suspend fun SlaxOfflineSession.fetchDescriptor(access: SlaxOfflineTask.Access, token: String, work: SlaxOfflineWork): Pair<SlaxPdfDescriptor, Boolean> {
  val descriptor = downloadDescriptor(scope, access.id, token, work)
  var changed = false
  commit(access.key, work) { store ->
    val previous = layout.readDescriptor(store, access.key)
    changed = previous != null && !descriptor.same(previous)
    if (changed) {
      store.remove(layout.document(access.key)); store.remove(layout.partial(access.key)); store.remove(layout.part(access.key))
      if (SlaxOfflineLayout.readManifest(store, access.key)?.kind == "pdf") store.remove(SlaxOfflineLayout.manifest(access.key))
    }
    layout.writeDescriptor(store, access.key, descriptor)
  }
  return descriptor to changed
}
private fun SlaxOfflineSession.pdfIdentityChanged(key: String, foreground: Boolean) {
  if (foreground) cancelJobs(key)
  entries.remove(key)
  val task = tasks[key]
  if (task != null) {report(task, "invalidated"); loadEntries(listOf(key))}
  else {reported.remove(key); enqueue(linkedMapOf("key" to key, "state" to "invalidated", "manual" to false))}
}
/** 403/404/412 and identity conflicts: drop the cached PDF so it can no longer be read offline. */
private fun SlaxOfflineSession.pdfDenied(key: String, error: SlaxOfflineError, foreground: Boolean) {
  if (foreground) cancelJobs(key)
  val task = tasks[key]
  var manifest: SlaxOfflineManifest? = null
  if (task != null) {
    manifest = SlaxOfflineManifest.placeholder(task).copy(retry = SlaxOfflineRetry(1, 0, true, error.code, task.version))
    entries[key] = SlaxOfflineSession.Entry(manifest, null)
    report(task, "denied", error.code)
  } else {reported.remove(key); enqueue(linkedMapOf("key" to key, "state" to "invalidated", "manual" to false, "code" to error.code))}
  commitLater(key) { store ->
    store.remove(layout.pdf(key)); store.remove(SlaxOfflineLayout.manifest(key))
    manifest?.let { SlaxOfflineLayout.writeManifest(store, key, it) }
  }
}
private suspend fun SlaxOfflineSession.cachedDescriptor(key: String, request: SlaxOfflineSession.Request, id: String) {
  val descriptor = try {io { layout.readDescriptor(it, key) }} catch (_: SlaxOfflineError) {null}
  if (!current(request)) return
  if (descriptor != null) finish(request, descriptor.result(id)) else finish(request, SlaxOfflineError.network)
}
/** The stored descriptor and whether `document.pdf` is the complete copy of exactly that identity. */
internal fun SlaxOfflineSession.localDescriptor(store: SlaxFileStore, key: String): Pair<SlaxPdfDescriptor, Boolean>? {
  val descriptor = layout.readDescriptor(store, key) ?: return null
  val complete = layout.readPart(store, key)?.matches(descriptor) == true && layout.completeDocument(store, key) != null
  return descriptor to complete
}
/** A complete local copy answers from its stored descriptor without any network request; otherwise the current behavior applies. */
internal fun SlaxOfflineSession.pdfMetadata(raw: Map<*, *>, reply: SlaxOfflineReply) {
  val access = try {SlaxOfflineTask.access(raw)} catch (error: SlaxOfflineError) {reply.fail(error); return}
  val request = register(raw["requestId"], access.key, reply) ?: return
  launch(request) {
    if (raw["allowNetwork"] == false) return@launch cachedDescriptor(access.key, request, access.id)
    val local = try {io { localDescriptor(it, access.key) }} catch (error: SlaxOfflineError) {if (error.code == SlaxOfflineError.revoked.code) throw error; null}
    if (!current(request)) return@launch
    if (local?.second == true) finish(request, local.first.result(access.id)) else remoteMetadata(access, request, null)
  }
}
private suspend fun SlaxOfflineSession.remoteMetadata(access: SlaxOfflineTask.Access, request: SlaxOfflineSession.Request, rejected: Long?) {
  val credential = awaitCredential { rejected == null || it.generation != rejected }
  if (!current(request)) return
  if (credential == null) {cachedDescriptor(access.key, request, access.id); return}
  val (descriptor, changed) = try {fetchDescriptor(access, credential.token, request.work)} catch (error: SlaxOfflineError) {
    if (!current(request)) return
    when {
      error.status == 401 && rejected == null -> {rejectCredential(credential.generation); remoteMetadata(access, request, credential.generation)}
      error.denied && error.status in listOf(403, 404, 412) -> {pdfDenied(access.key, error, true); finish(request, error)}
      error.code == SlaxOfflineError.network.code || error.code == SlaxOfflineError.credential.code -> cachedDescriptor(access.key, request, access.id)
      else -> finish(request, error)
    }
    return
  }
  if (!current(request)) return
  if (changed) pdfIdentityChanged(access.key, true)
  finish(request, descriptor.result(access.id))
}

// Range reads

/** One byte range `[begin, end)` of the document [documentId]/[size] of bookmark [key] ([id], collection [owner]). */
internal data class SlaxPdfRange(val key: String, val id: String, val owner: String?, val documentId: String, val size: Long, val begin: Long, val end: Long)

/** Bytes from the complete document or the committed prefix of the resumable part. */
private fun localRange(store: SlaxFileStore, layout: SlaxOfflineLayout, key: String, documentId: String, size: Long, begin: Long, end: Long): ByteArray? {
  val part = layout.readPart(store, key)?.takeIf { it.documentId == documentId && it.size == size && it.committed >= end } ?: return null
  val length = (end - begin).toInt()
  if (part.committed < part.size) {
    val bytes = store.readRange(layout.partial(key), begin, length)
    if (bytes != null) return bytes.takeIf { layout.readPart(store, key)?.let { it.documentId == documentId && it.size == size && it.committed >= end } == true }
  }
  if (store.size(layout.document(key)) != size) return null
  return store.readRange(layout.document(key), begin, length)
}
/**
 * Callable from any thread (the WebView request thread): committed bytes are read on the caller; only a miss registers on the
 * control thread and fetches the remote range (credential handling, identity and length validation) on `pdfForeground`.
 * A reply the caller already settled (an aborted page request) never starts network work.
 */
internal fun SlaxOfflineSession.servePdfRange(range: SlaxPdfRange, requestId: String, reply: SlaxOfflineReply) {
  if (range.size !in 1..SlaxPdfDescriptor.MAX_BYTES || range.begin < 0 || range.end <= range.begin || range.end > range.size || range.end - range.begin > PDF_WINDOW) {
    reply.fail(SlaxOfflineError.invalid); return
  }
  val local = try {localRange(store(), layout, range.key, range.documentId, range.size, range.begin, range.end)} catch (error: Exception) {
    val failure = SlaxOfflineError.from(error, lease)
    if (failure.code == SlaxOfflineError.revoked.code || failure.code == SlaxOfflineError.cancelled.code) return reply.fail(failure)
    null
  }
  if (local != null) return reply.resolve(local)
  lane.launch {
    if (closed) return@launch reply.fail(SlaxOfflineError.revoked)
    if (reply.isSettled) return@launch
    val request = register(requestId, range.key, reply) ?: return@launch
    launch(request) { remoteRange(SlaxOfflineTask.Access(range.key, range.id, range.owner), request, range.documentId, range.size, range.begin, range.end, null) }
  }.settles(reply)
}
private suspend fun SlaxOfflineSession.remoteRange(access: SlaxOfflineTask.Access, request: SlaxOfflineSession.Request, documentId: String, size: Long, begin: Long, end: Long, rejected: Long?) {
  val credential = awaitCredential { rejected == null || it.generation != rejected }
  if (!current(request)) return
  if (credential == null) {finish(request, SlaxOfflineError.credential); return}
  val slice = ByteArray((end - begin).toInt())
  val bytes = try {
    when (val body = transferPdf(scope, credential.token, access.id, documentId, size, begin, end, request.work, engine.pdfForeground) { chunk, offset ->
      val left = maxOf(begin, offset); val right = minOf(end, offset + chunk.size)
      if (right > left) System.arraycopy(chunk, (left - offset).toInt(), slice, (left - begin).toInt(), (right - left).toInt())
    }) {is SlaxPdfBody.Range -> body.bytes; SlaxPdfBody.Full -> slice}
  } catch (error: SlaxOfflineError) {
    if (!current(request)) return
    when {
      error.status == 401 && rejected == null -> {rejectCredential(credential.generation); remoteRange(access, request, documentId, size, begin, end, credential.generation)}
      error.status in listOf(403, 404, 412) -> {pdfDenied(access.key, error, true); finish(request, error)}
      else -> finish(request, error)
    }
    return
  }
  if (current(request)) finish(request, bytes)
}
internal fun SlaxOfflineSession.pdfStatus(key: String, reply: SlaxOfflineReply) {
  if (!SlaxOfflineTask.validKey(key)) {reply.fail(SlaxOfflineError.invalid); return}
  lane.launch {
    reply.cancellable { try {
      reply.resolve(io { store ->
        val descriptor = layout.readDescriptor(store, key) ?: return@io mapOf("downloadedBytes" to 0.0, "totalBytes" to 0.0, "complete" to false)
        val part = layout.readPart(store, key)?.takeIf { it.matches(descriptor) } ?: return@io mapOf("downloadedBytes" to 0.0, "totalBytes" to descriptor.size.toDouble(), "complete" to false)
        val complete = layout.completeDocument(store, key) != null
        mapOf("downloadedBytes" to (if (complete) descriptor.size else part.committed).toDouble(), "totalBytes" to descriptor.size.toDouble(), "complete" to complete)
      })
    } catch (error: SlaxOfflineError) {reply.fail(error)} }
  }.settles(reply)
}

// Background acquisition

internal fun SlaxOfflineSession.startPdf(task: SlaxOfflineTask) {
  val credential = credential.value ?: return
  val job = SlaxOfflineSession.Job(task, work())
  jobs[task.key] = job; explicit.remove(task.key)
  val access = SlaxOfflineTask.Access(task.key, task.id, task.collectionOwner)
  job.work.job = lane.launch {
    val (descriptor, changed) = try {fetchDescriptor(access, credential.token, job.work)} catch (error: CancellationException) {throw error} catch (error: SlaxOfflineError) {
      if (jobs[task.key] === job && !job.work.isCancelled) pdfFailed(job, error, credential.generation)
      return@launch
    }
    if (jobs[task.key] !== job || job.work.isCancelled) return@launch
    if (changed) pdfIdentityChanged(task.key, false)
    while (true) {
      if (jobs[task.key] !== job || job.work.isCancelled || suspended) return@launch
      val current = this@startPdf.credential.value ?: run {jobs.remove(task.key); job.work.cancel(); return@launch}
      val done = try {
        pdfStep(task, descriptor, current.token, job.work) { if (jobs[task.key] === job && !job.reported) {job.reported = true; report(task, "downloading")} }
      } catch (error: CancellationException) {throw error} catch (error: SlaxOfflineError) {
        if (jobs[task.key] === job && !job.work.isCancelled) pdfFailed(job, error, current.generation)
        return@launch
      }
      if (jobs[task.key] !== job || job.work.isCancelled) return@launch
      if (done) {pdfCompleted(job, descriptor); return@launch}
    }
  }
}
private fun SlaxOfflineSession.pdfFailed(job: SlaxOfflineSession.Job, error: SlaxOfflineError, generation: Long) {
  val key = job.task.key
  if (jobs[key] !== job) return
  when (error.status) {
    401 -> {jobs.remove(key); job.work.cancel(); rejectCredential(generation); schedulePump()}
    403, 404, 412 -> {jobs.remove(key); job.work.cancel(); pdfDenied(key, error, false); schedulePump()}
    else -> fail(job, error)
  }
}
/** Writes a full response into a staging file committed as `document.pdf`. */
private class SlaxPdfStream(private val store: SlaxFileStore, private val directory: String, private val target: String) {
  private val name = ".slax-${UUID.randomUUID()}.tmp"
  private val file: File = store.file("$directory/$name").also { check(it.parentFile!!.isDirectory || it.parentFile!!.mkdirs()) { "Cannot create PDF directory" } }.let { store.file("$directory/$name") }
  private var output: FileOutputStream? = FileOutputStream(file)
  var written = 0L; private set
  fun write(bytes: ByteArray, offset: Long) {
    if (offset == 0L && written > 0) {output!!.channel.truncate(0); written = 0}
    check(offset == written) { "Unordered PDF stream" }
    output!!.write(bytes); written += bytes.size
  }
  fun commit() {output!!.fd.sync(); output!!.close(); output = null; store.move("$directory/$name", target)}
  fun abort() {runCatching { output?.close() }; output = null; file.delete()}
}
/** One resumable window: append the next committed range, or commit a full response. Returns true when complete. */
private suspend fun SlaxOfflineSession.pdfStep(task: SlaxOfflineTask, descriptor: SlaxPdfDescriptor, token: String, work: SlaxOfflineWork, started: () -> Unit): Boolean {
  val key = task.key
  val store = store(work.lease)
  val snapshot = keyLock(key).withLock { io {
    work.check()
    val current = layout.readDescriptor(store, key)
    if (current == null || !descriptor.same(current)) throw SlaxOfflineError.cancelled
    val part = layout.readPart(store, key)?.takeIf { it.matches(descriptor) }
    if (part != null && part.committed == part.size) {finalize(store, key, part.size); return@io part}
    if (part != null && (store.size(layout.partial(key)) ?: 0) >= part.committed) return@io part
    store.remove(layout.document(key)); store.remove(layout.partial(key))
    SlaxPdfPart(descriptor.documentId, descriptor.size, 0).also { layout.writePart(store, key, it) }
  } }
  if (snapshot.committed == snapshot.size) return true
  started()
  val begin = snapshot.committed; val end = minOf(snapshot.size, begin + PDF_WINDOW)
  var stream: SlaxPdfStream? = null
  try {
    val body = transferPdf(scope, token, task.id, descriptor.documentId, descriptor.size, begin, end, work) { chunk, offset ->
      val output = stream ?: SlaxPdfStream(store, layout.pdf(key), layout.document(key)).also { stream = it }
      output.write(chunk, offset)
    }
    return keyLock(key).withLock { io {
      work.check()
      val part = layout.readPart(store, key)
      if (part != snapshot) throw SlaxOfflineError.cancelled
      when (body) {
        is SlaxPdfBody.Range -> {
          store.append(layout.partial(key), begin, body.bytes)
          val next = part.copy(committed = end)
          layout.writePart(store, key, next)
          if (next.committed == next.size) {finalize(store, key, next.size); true} else false
        }
        SlaxPdfBody.Full -> {
          val output = stream
          if (output == null || output.written != descriptor.size) throw SlaxOfflineError.pdf("pdf_length_invalid")
          store.remove(layout.partial(key))
          output.commit(); stream = null
          layout.writePart(store, key, part.copy(committed = part.size))
          true
        }
      }
    } }
  } finally {stream?.abort()}
}
private fun SlaxOfflineSession.finalize(store: SlaxFileStore, key: String, size: Long) {
  if (store.size(layout.document(key)) == size) return
  if (store.size(layout.partial(key)) != size) throw SlaxOfflineError.pdf("pdf_length_invalid")
  store.move(layout.partial(key), layout.document(key))
}
private suspend fun SlaxOfflineSession.pdfCompleted(job: SlaxOfflineSession.Job, descriptor: SlaxPdfDescriptor) {
  val task = job.task
  val manifest = SlaxOfflineManifest(task.id, task.collectionOwner, "pdf", task.version, descriptor.size, emptyList(), null)
  try {commit(task.key, job.work) { SlaxOfflineLayout.writeManifest(it, task.key, manifest) }} catch (error: CancellationException) {throw error} catch (error: SlaxOfflineError) {
    if (jobs[task.key] === job) fail(job, error)
    return
  }
  if (jobs[task.key] !== job) return
  jobs.remove(task.key)
  entries[task.key] = SlaxOfflineSession.Entry(manifest, descriptor.size)
  report(task, "complete"); schedulePump()
}
