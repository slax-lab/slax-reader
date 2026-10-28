package com.slax.reader.platform

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicReference

/** `POST /v1/bookmark/content`, retried like `SlaxApi.response` (network errors and 5xx without Retry-After). */
internal suspend fun SlaxOfflineSession.requestContent(id: String, token: String, work: SlaxOfflineWork): ByteArray {
  var attempt = 0
  while (true) {
    val failure = try {
      val response = SlaxOfflineHttp.send(SlaxOfflineHttp.content(scope, id, token), SlaxFileStore.ARTICLE_LIMIT, SlaxOfflineError.oversized, 30_000, work)
      if (response.status == 200 || response.status == 204) return response.body
      SlaxOfflineError.http(response.status, SlaxOfflineClock.retryAfter(response.headers["Retry-After"]))
    } catch (error: SlaxOfflineError) {error}
    if (!failure.retryable || attempt >= 2 || work.isCancelled) throw failure
    delay(1000L shl attempt); attempt++
    if (work.isCancelled || closed) throw SlaxOfflineError.cancelled
  }
}

internal fun SlaxOfflineSession.startArticle(task: SlaxOfflineTask) {
  val credential = credential.value ?: return
  val job = SlaxOfflineSession.Job(task, work())
  jobs[task.key] = job; explicit.remove(task.key)
  imageJobs.remove(task.key)?.cancel()
  report(task, "downloading")
  job.work.job = lane.launch {
    val body = try {requestContent(task.id, credential.token, job.work)} catch (error: CancellationException) {throw error} catch (error: SlaxOfflineError) {
      if (jobs[task.key] !== job || job.work.isCancelled) return@launch
      if (error.status == 401) {jobs.remove(task.key); job.work.cancel(); rejectCredential(credential.generation); schedulePump()} else fail(job, error)
      return@launch
    }
    if (jobs[task.key] !== job || job.work.isCancelled) return@launch
    if (body.isEmpty()) {fail(job, SlaxOfflineError("offline_integrity_invalid", integrity = true)); return@launch}
    val manifest = try {commitContent(body, task.key, task.id, task.collectionOwner, task.version, job.work)} catch (error: CancellationException) {throw error} catch (error: SlaxOfflineError) {
      if (jobs[task.key] === job) fail(job, error)
      return@launch
    }
    if (jobs[task.key] !== job) return@launch
    jobs.remove(task.key)
    entries[task.key] = SlaxOfflineSession.Entry(manifest, manifest.size)
    report(task, "complete"); schedulePump()
  }
}

/** Writes the raw body and its manifest; images already recorded for the same URLs keep their state. */
internal suspend fun SlaxOfflineSession.commitContent(body: ByteArray, key: String, id: String, owner: String?, version: String?, work: SlaxOfflineWork): SlaxOfflineManifest {
  val urls = withContext(Dispatchers.Default) { SlaxOfflineHtml.imageUrls(SlaxOfflineLayout.decode(body)) }
  var committed: SlaxOfflineManifest? = null
  commit(key, work) { store ->
    val previous = runCatching { SlaxOfflineLayout.readManifest(store, key) }.getOrNull()
    val known = (previous?.images ?: emptyList()).reversed().associateBy { it.url }
    val manifest = SlaxOfflineManifest(id, owner, "article", version, body.size.toLong(), urls.map { known[it] ?: SlaxOfflineImage(it, "pending", 0, 0) }, null)
    store.write(SlaxOfflineLayout.content(key), body)
    SlaxOfflineLayout.writeManifest(store, key, manifest)
    committed = manifest
  }
  return committed ?: throw SlaxOfflineError.unavailable
}

/** Records an automatic failure with the ported backoff; cancellation and revocation leave no record. */
internal fun SlaxOfflineSession.fail(job: SlaxOfflineSession.Job, error: SlaxOfflineError) {
  val key = job.task.key
  if (jobs[key] !== job) return
  jobs.remove(key); explicit.remove(key)
  if (error.code == SlaxOfflineError.cancelled.code || error.code == SlaxOfflineError.revoked.code || job.work.isCancelled) {schedulePump(); return}
  val entry = entries[key] ?: SlaxOfflineSession.Entry(null, null)
  val previous = entry.manifest?.retry?.takeIf { it.version == job.task.version }?.attempts ?: 0
  val retry = SlaxOfflineRetry.failure(previous, error, SlaxOfflineClock.now(), engine.environment.random()).copy(version = job.task.version)
  val manifest = (entry.manifest ?: SlaxOfflineManifest.placeholder(job.task)).copy(retry = retry)
  entries[key] = entry.copy(manifest = manifest)
  report(job.task, if (retry.denied) "denied" else "failed", retry.code, if (retry.denied) null else retry.retryAt)
  commitLater(key) { SlaxOfflineLayout.writeManifest(it, key, manifest) }
  schedulePump()
}

// Images

internal fun SlaxOfflineSession.startImages(task: SlaxOfflineTask) {
  val manifest = entries[task.key]?.manifest ?: return
  val work = work(); val key = task.key
  imageJobs[key] = work
  work.job = lane.launch {
    val images = manifest.images.toMutableList()
    var changed = 0
    val now = SlaxOfflineClock.now()
    suspend fun merge(): SlaxOfflineManifest? {
      var merged: SlaxOfflineManifest? = null
      val snapshot = images.toList()
      try {commit(key, work) { store -> merged = mergeImages(store, key, snapshot) }} catch (error: CancellationException) {throw error} catch (_: Exception) {}
      return merged
    }
    for (index in images.indices) {
      if (!images[index].eligible(now)) continue
      if (work.isCancelled) break
      val next = acquireImage(images[index], key, work) ?: break
      images[index] = next; changed++
      if (changed % 8 == 0) merge()
    }
    val final = if (work.isCancelled) null else merge()
    if (imageJobs[key] !== work) return@launch
    imageJobs.remove(key)
    val entry = entries[key]; val current = entry?.manifest
    if (entry != null && current != null) {
      val next = if (final != null && final.version == current.version) final
        else images.associateBy { it.url }.let { states -> current.copy(images = current.images.map { states[it.url] ?: it }) }
      entries[key] = entry.copy(manifest = next)
    }
    schedulePump()
  }
}
private fun mergeImages(store: SlaxFileStore, key: String, images: List<SlaxOfflineImage>): SlaxOfflineManifest? {
  val current = SlaxOfflineLayout.readManifest(store, key) ?: return null
  val states = images.reversed().associateBy { it.url }
  return current.copy(images = current.images.map { states[it.url] ?: it }).also { SlaxOfflineLayout.writeManifest(store, key, it) }
}

/** One image through the shared registry into the Reader's `bookmark/<key>/images/<md5>.<ext>` path; null when cancelled. */
internal suspend fun SlaxOfflineSession.acquireImage(image: SlaxOfflineImage, key: String, work: SlaxOfflineWork): SlaxOfflineImage? {
  val original = runCatching { java.net.URI(image.url) }.getOrNull()?.takeIf { it.scheme?.lowercase() in listOf("http", "https") && it.rawUserInfo == null }?.let { scope.policy.imageOriginal(image.url) }
  val paths = original?.let { withContext(Dispatchers.IO) { SlaxImageResources.paths(scope.root, key, it) } } ?: emptyList()
  if (original == null || paths.isEmpty()) return image.copy(state = "denied", retryAt = 0)
  if (withContext(Dispatchers.IO) { paths.any { it.isFile && it.length() in 1..SlaxImageRegistry.MAX_BYTES } }) return image.copy(state = "ready", retryAt = 0)
  return try {
    work.check()
    val consumer = AtomicReference<SlaxImageRegistry.Consumer?>()
    val hook = work.attach { consumer.get()?.close() }
    try {
      slaxBlocking({ consumer.get()?.close() }) {
        val owned = engine.environment.registry().acquire(scope.owner, original, scope.policy, strict = false); consumer.set(owned)
        if (work.isCancelled) owned.close()
        owned.persist(scope.root, paths.first().relativeTo(scope.root).invariantSeparatorsPath) { work.check() }
      }
    } finally {work.detach(hook); consumer.get()?.close()}
    image.copy(state = "ready", retryAt = 0)
  } catch (error: CancellationException) {throw error} catch (error: Exception) {
    if (work.isCancelled || runCatching { work.lease.check() }.isFailure) return null
    val failure = error as? SlaxImageFailure
    val reason = if (failure?.terminal == true) SlaxOfflineError("image_invalid", integrity = true)
      else SlaxOfflineError("image_unavailable", failure?.status ?: 0, SlaxOfflineClock.retryAfter(failure?.retryAfter))
    val retry = SlaxOfflineRetry.failure(image.attempts, reason, SlaxOfflineClock.now(), engine.environment.random())
    image.copy(state = if (retry.denied) "denied" else "failed", attempts = retry.attempts, retryAt = retry.retryAt)
  }
}

// Foreground reads

internal fun cachedArticle(store: SlaxFileStore, key: String): String? {
  val manifest = SlaxOfflineLayout.readManifest(store, key)?.takeIf { it.kind == "article" && it.size > 0 } ?: return null
  val bytes = store.read(SlaxOfflineLayout.content(key), SlaxFileStore.ARTICLE_LIMIT)?.takeIf { it.size.toLong() == manifest.size } ?: return null
  return SlaxOfflineLayout.decode(bytes)
}
/** Reads the committed copy on the foreground executor, from any thread; the session lease is checked by the store. */
private fun SlaxOfflineSession.foregroundRead(key: String, done: (Result<String?>) -> Unit) {
  val store = store()
  try {
    engine.foreground.execute {
      done(try {Result.success(cachedArticle(store, key))} catch (error: Exception) {Result.failure(SlaxOfflineError.from(error, lease))})
    }
  } catch (_: java.util.concurrent.RejectedExecutionException) {done(Result.failure(SlaxOfflineError.revoked))}
}
/** Callable from any thread: touches only immutable session state and replies from the foreground executor. */
internal fun SlaxOfflineSession.readArticle(key: String, reply: SlaxOfflineReply) {
  if (!SlaxOfflineTask.validKey(key)) {reply.fail(SlaxOfflineError.invalid); return}
  foregroundRead(key) { result -> result.fold({ reply.resolve(it) }, { reply.fail(it as SlaxOfflineError) }) }
}
/** Callable from any thread: a committed copy resolves from the foreground executor; only a miss or a forced refresh registers on the control thread. */
internal fun SlaxOfflineSession.fetchArticle(raw: Map<*, *>, reply: SlaxOfflineReply) {
  val access = try {SlaxOfflineTask.access(raw)} catch (error: SlaxOfflineError) {reply.fail(error); return}
  val remote = {
    engine.scope.launch {
      if (closed) {reply.fail(SlaxOfflineError.revoked); return@launch}
      val request = register(raw["requestId"], access.key, reply) ?: return@launch
      this@fetchArticle.launch(request) { fetchRemote(access, request, null) }
    }
    Unit
  }
  if (raw["force"] == true) {remote(); return}
  foregroundRead(access.key) { result ->
    val text = result.getOrNull()
    when {
      text != null -> reply.resolve(text)
      (result.exceptionOrNull() as? SlaxOfflineError)?.code == SlaxOfflineError.revoked.code -> reply.fail(SlaxOfflineError.revoked)
      else -> remote()
    }
  }
}
private suspend fun SlaxOfflineSession.fetchRemote(access: SlaxOfflineTask.Access, request: SlaxOfflineSession.Request, rejected: Long?) {
  val credential = awaitCredential { rejected == null || it.generation != rejected }
  if (!current(request)) return
  if (credential == null) {finish(request, SlaxOfflineError.credential); return}
  val body = try {requestContent(access.id, credential.token, request.work)} catch (error: SlaxOfflineError) {
    if (!current(request)) return
    if (error.status == 401 && rejected == null) {rejectCredential(credential.generation); fetchRemote(access, request, credential.generation)} else finish(request, error)
    return
  }
  if (!current(request)) return
  finish(request, withContext(Dispatchers.Default) { SlaxOfflineLayout.decode(body) })
  if (body.isNotEmpty()) commitForeground(body, access)
}
/** A foreground body supersedes automatic work for the key; without a plan version it is stored unbound. */
private fun SlaxOfflineSession.commitForeground(body: ByteArray, access: SlaxOfflineTask.Access) {
  val task = tasks[access.key]?.takeIf { it.kind == "article" && it.id == access.id }
  if (task != null) cancelJobs(access.key)
  lane.launch {
    val manifest = try {commitContent(body, access.key, access.id, access.owner, task?.version, work())} catch (error: CancellationException) {throw error} catch (_: Exception) {null}
    if (manifest == null || !tasks.containsKey(access.key)) {schedulePump(); return@launch}
    entries[access.key] = SlaxOfflineSession.Entry(manifest, manifest.size)
    reconcile(access.key); schedulePump()
  }
}
