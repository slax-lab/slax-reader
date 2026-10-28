package com.slax.reader.platform

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.ConcurrentHashMap

/** One open account scope. Every mutable property is confined to the engine's control thread. */
internal class SlaxOfflineSession(val scope: SlaxOfflineScope, val lease: SlaxStorageLease, val engine: SlaxOfflineEngine) {
  data class Entry(val manifest: SlaxOfflineManifest?, val contentSize: Long?)
  class Job(val task: SlaxOfflineTask, val work: SlaxOfflineWork) {var reported = false}
  class Request(val id: String, val key: String, val work: SlaxOfflineWork, val reply: SlaxOfflineReply)
  data class Credential(val generation: Long, val token: String) {override fun toString() = "Credential($generation)"}

  val layout = SlaxOfflineLayout(scope.scopeId)
  private val supervisor = SupervisorJob(engine.scope.coroutineContext[kotlinx.coroutines.Job])
  val lane = CoroutineScope(engine.control + supervisor)
  var opened = false
  var suspended = false
  @Volatile var closed = false
  var online = true
  var downloadImages = true
  val credential = MutableStateFlow<Credential?>(null)
  var revision = Double.NEGATIVE_INFINITY
  val tasks = HashMap<String, SlaxOfflineTask>()
  val order = ArrayList<String>()
  val entries = HashMap<String, Entry>()
  val loading = HashSet<String>()
  val jobs = HashMap<String, Job>()
  val imageJobs = HashMap<String, SlaxOfflineWork>()
  val writers = HashMap<String, MutableMap<Any, SlaxOfflineWork>>()
  val requests = HashMap<String, Request>()
  val protections = HashMap<String, String>()
  val explicit = HashSet<String>()
  val reported = HashMap<String, String>()
  val pending = LinkedHashMap<String, Map<String, Any?>>()
  var flushScheduled = false
  var lastEmit: Long? = null
  var wake: kotlinx.coroutines.Job? = null
  var wakeAt = Long.MAX_VALUE
  var pumpScheduled = false
  private val inflight = HashSet<CompletableDeferred<Unit>>()
  private val keyLocks = ConcurrentHashMap<String, Mutex>()

  fun store(lease: SlaxStorageLease = this.lease) = SlaxFileStore(scope.root, scope.pdfRoot, lease)
  fun protected(key: String) = protections.values.contains(key)
  fun keyLock(key: String): Mutex = keyLocks.computeIfAbsent(key) { Mutex() }
  fun work() = SlaxOfflineWork(lease.child())

  /** File work on Dispatchers.IO under the session lease; failures map to engine errors. */
  suspend fun <T> io(work: (SlaxFileStore) -> T): T = try {
    withContext(Dispatchers.IO) { work(store()) }
  } catch (error: CancellationException) {throw error} catch (error: Exception) {throw SlaxOfflineError.from(error, lease)}

  /** Serialized commit for [key]; eviction and clearing cancel the work before deleting files. */
  suspend fun commit(key: String, work: SlaxOfflineWork = work(), body: (SlaxFileStore) -> Unit) {
    val token = Any()
    writers.getOrPut(key) { HashMap() }[token] = work
    val done = CompletableDeferred<Unit>().also { inflight.add(it) }
    try {
      keyLock(key).withLock {
        withContext(Dispatchers.IO) {
          try {work.check(); body(store(work.lease))}
          catch (error: SlaxOfflineError) {throw error}
          catch (error: Exception) {throw if (work.isCancelled) SlaxOfflineError.cancelled else SlaxOfflineError.from(error, work.lease)}
        }
      }
    } finally {
      writers[key]?.let { it.remove(token); if (it.isEmpty()) writers.remove(key) }
      done.complete(Unit); inflight.remove(done)
    }
  }
  /** Fire-and-forget commit whose failure is ignored, as an optional bookkeeping write. */
  fun commitLater(key: String, body: (SlaxFileStore) -> Unit) {lane.launch { quietly { commit(key, body = body) } }}
  suspend fun quietly(block: suspend () -> Unit) {try {block()} catch (error: CancellationException) {throw error} catch (_: Exception) {}}
  /** Runs [done] after every commit that started before this call has finished. */
  fun drained(done: () -> Unit) {
    val active = inflight.toList()
    engine.scope.launch { active.forEach { it.await() }; done() }
  }

  // Lifecycle

  fun start(reply: SlaxOfflineReply) {
    lane.launch {
      val value = try {io { migrate(it) }} catch (error: CancellationException) {reply.fail(SlaxOfflineError.revoked); throw error} catch (error: SlaxOfflineError) {reply.fail(error); return@launch}
      opened = true; engine.publishReadable(this@SlaxOfflineSession); reply.resolve(value); loadEntries(tasks.keys.toList()); schedulePump()
    }.settles(reply)
  }
  /** One-time transition to the engine layout; idempotent until JavaScript commits the marker. */
  private fun migrate(store: SlaxFileStore): Map<String, Any?> {
    val marker = SlaxOfflineValues.json(store.read(SlaxFileStore.MARKER, 64 * 1024)) as? Map<*, *>
    if (SlaxOfflineValues.int(marker?.get("layout")) == 2L) return mapOf("adopted" to emptyList<String>(), "dropped" to emptyList<String>(), "migrationPending" to false)
    val dropped = sortedSetOf<String>()
    store.remove("pdf/v1")
    runCatching { store.purge("pdf") { it.startsWith(".slax-") } }
    for (name in store.children("bookmark")) if (name.startsWith(".slax-evict-")) receiptKey(store, name)?.let { dropped.add(it) }
    store.purge("bookmark") { it.startsWith(".slax-") }
    val adopted = mutableListOf<String>()
    for (key in store.children("bookmark")) {
      if (!SlaxOfflineTask.validKey(key) || key.startsWith("avatar-") || !store.file(SlaxOfflineLayout.bookmark(key)).isDirectory) continue
      try {
        val manifest = SlaxOfflineLayout.readManifest(store, key)
        if (manifest != null) {
          val size = layout.contentSize(store, key, manifest.kind)
          if (manifest.size > 0 && size == manifest.size) adopted.add(key) else dropped.add(key)
          continue
        }
        val size = store.size(SlaxOfflineLayout.content(key))
        val bytes = if (size != null && size in 1..SlaxFileStore.ARTICLE_LIMIT.toLong()) store.read(SlaxOfflineLayout.content(key), SlaxFileStore.ARTICLE_LIMIT) else null
        if (bytes == null) {dropped.add(key); continue}
        val images = SlaxOfflineHtml.imageUrls(SlaxOfflineLayout.decode(bytes)).map { SlaxOfflineImage(it, "pending", 0, 0) }
        SlaxOfflineLayout.writeManifest(store, key, SlaxOfflineManifest("", null, "article", null, bytes.size.toLong(), images, null))
        adopted.add(key); dropped.remove(key)
      } catch (error: Exception) {
        lease.check()
        dropped.add(key)
      }
    }
    return linkedMapOf("adopted" to adopted, "dropped" to (dropped - adopted.toSet()).toList(), "migrationPending" to true)
  }
  /** Key named by a legacy staged-eviction receipt (`slax-cache-eviction-v1\n<path>\n`). */
  private fun receiptKey(store: SlaxFileStore, name: String): String? = runCatching {
    val receipt = java.io.File(store.file("bookmark"), name)
    val intent = java.io.File(receipt, "intent")
    check(receipt.canonicalFile == receipt.absoluteFile && intent.canonicalFile == intent.absoluteFile && intent.isFile && intent.length() <= 4096)
    val lines = intent.readText().split('\n')
    lines.takeIf { it.firstOrNull() == "slax-cache-eviction-v1" }?.getOrNull(1)?.removePrefix("bookmark/")?.takeIf { SlaxOfflineTask.validKey(it) }
  }.getOrNull()
  fun commitMigration(reply: SlaxOfflineReply) {
    lane.launch {
      reply.cancellable {
        try {commit("") { it.write(SlaxFileStore.MARKER, SlaxOfflineJson.encode(mapOf("layout" to 2)).toByteArray(Charsets.UTF_8)) }; reply.resolve(null)}
        catch (error: SlaxOfflineError) {reply.fail(error)}
      }
    }.settles(reply)
  }
  private fun cancelActive(error: SlaxOfflineError, includeWriters: Boolean) {
    jobs.values.forEach { it.work.cancel() }; jobs.clear()
    imageJobs.values.forEach { it.cancel() }; imageJobs.clear()
    if (includeWriters) writers.values.forEach { it.values.forEach { work -> work.cancel() } }
    val active = requests.values.toList(); requests.clear()
    active.forEach { it.work.cancel(); it.reply.fail(error) }
    wake?.cancel(); wake = null; wakeAt = Long.MAX_VALUE
  }
  fun suspend(reply: SlaxOfflineReply) {suspended = true; cancelActive(SlaxOfflineError.cancelled, false); drained { reply.resolve(null) }}
  fun resume() {if (!suspended) return; suspended = false; schedulePump()}
  fun shutdown(error: SlaxOfflineError) {
    if (closed) return
    closed = true; suspended = true; lease.cancel(); engine.unpublishReadable(this); cancelActive(error, true)
    pending.clear(); credential.value = null
    supervisor.children.forEach { it.cancel() }
  }

  // Inputs

  fun setCredential(raw: Map<*, *>?) {
    if (raw == null) {credential.value = null; return}
    val generation = SlaxOfflineValues.int(raw["generation"]); val token = raw["token"] as? String
    if (generation == null || token == null || token.isEmpty() || token.length > 16384 || token.any { it.code < 33 || it.code == 127 }) {credential.value = null; return}
    credential.value = Credential(generation, token)
    schedulePump()
  }
  fun setConditions(raw: Map<*, *>) {
    val nextOnline = raw["online"] as? Boolean ?: online; val nextImages = raw["downloadImages"] as? Boolean ?: downloadImages
    if (!nextOnline && online) {jobs.values.forEach { it.work.cancel() }; jobs.clear()}
    if (!nextOnline || !nextImages) {imageJobs.values.forEach { it.cancel() }; imageJobs.clear()}
    online = nextOnline; downloadImages = nextImages
    schedulePump()
  }
  /** Waits for a credential accepted by [accept]; null after [timeoutMs] or when the session closes. */
  suspend fun awaitCredential(timeoutMs: Long = engine.environment.credentialWaitMs, accept: (Credential) -> Boolean): Credential? =
    withTimeoutOrNull(timeoutMs) { credential.filterNotNull().first { accept(it) } }
  /** 401 for [generation]: forget the token and ask JavaScript once for a newer generation. */
  fun rejectCredential(generation: Long) {
    if (credential.value?.generation != generation) return
    credential.value = null
    engine.emit("onCredentialRejected", mapOf("owner" to scope.owner, "generation" to generation.toDouble()))
  }
  fun protect(key: String, token: String) {
    if (!SlaxOfflineTask.validKey(key) || protections.size >= 1024) return
    protections[token] = key
    val task = tasks[key] ?: return
    val retry = entries[key]?.manifest?.retry ?: return
    if (retry.version == task.version && !retry.denied) {explicit.add(key); schedulePump()}
  }
  fun release(token: String) {protections.remove(token)}

  // Foreground requests

  fun register(id: Any?, key: String, reply: SlaxOfflineReply): Request? {
    val value = id as? String
    if (value == null || value.isEmpty() || value.length > 128 || value.any { it.code < 33 || it.code == 127 }) {reply.fail(SlaxOfflineError.invalid); return null}
    if (suspended) {reply.fail(SlaxOfflineError.cancelled); return null}
    cancelRequest(value, SlaxOfflineError.cancelled)
    return Request(value, key, work(), reply).also { requests[value] = it }
  }
  fun current(request: Request) = requests[request.id] === request
  fun finish(request: Request, value: Any?) {if (current(request)) requests.remove(request.id); request.reply.resolve(value)}
  fun finish(request: Request, error: SlaxOfflineError) {if (current(request)) requests.remove(request.id); request.reply.fail(error)}
  fun cancelRequest(id: String, error: SlaxOfflineError) {
    val request = requests.remove(id) ?: return
    request.work.cancel(); request.reply.fail(error)
  }
  /** Runs [body] for [request] on the control thread; its coroutine is cancelled with the request. */
  fun launch(request: Request, body: suspend () -> Unit) {
    val job = lane.launch {
      try {body()} catch (error: CancellationException) {throw error}
      catch (error: SlaxOfflineError) {if (current(request)) finish(request, error)}
      catch (error: Exception) {if (current(request)) finish(request, SlaxOfflineError.from(error, request.work.lease))}
    }
    request.work.job = job
    if (request.work.isCancelled) job.cancel()
  }
}
