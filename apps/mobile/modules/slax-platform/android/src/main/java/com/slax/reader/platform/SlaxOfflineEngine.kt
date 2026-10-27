package com.slax.reader.platform

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Settles one JavaScript promise at most once, from any thread. */
internal class SlaxOfflineReply(private val resolver: (Any?) -> Unit, private val rejecter: (String, String) -> Unit) {
  private val settled = AtomicBoolean(false)
  fun resolve(value: Any?) {if (settled.compareAndSet(false, true)) resolver(value)}
  fun fail(error: SlaxOfflineError) {if (settled.compareAndSet(false, true)) rejecter(error.code, error.message)}
}
/** A reply-owning lane job that is cancelled (shutdown, revocation), even before it starts, still rejects its promise. */
internal fun Job.settles(reply: SlaxOfflineReply): Job = apply { invokeOnCompletion { if (it is CancellationException) reply.fail(SlaxOfflineError.cancelled) } }
/** Rejects the reply for a cancelled lane body, then rethrows so structured cancellation continues. */
internal inline fun <T> SlaxOfflineReply.cancellable(block: () -> T): T =
  try {block()} catch (error: CancellationException) {fail(SlaxOfflineError.cancelled); throw error}

internal class SlaxOfflineEnvironment(
  val root: (String) -> Pair<File, File>,
  val registry: () -> SlaxImageRegistry,
  val allowHttp: Boolean,
  val random: () -> Double = { Math.random() },
  val coalesceMs: Long = 250,
  val credentialWaitMs: Long = 20_000,
)

/**
 * Native offline acquisition. All session state is confined to the single `SlaxOfflineEngine` control thread; network and
 * file work run on Dispatchers.IO and HTML extraction on Dispatchers.Default.
 */
internal class SlaxOfflineEngine(val environment: SlaxOfflineEnvironment) {
  private val executor = Executors.newSingleThreadExecutor { Thread(it, "SlaxOfflineEngine").apply { isDaemon = true } }
  val control = executor.asCoroutineDispatcher()
  val scope = CoroutineScope(SupervisorJob() + control)
  /** Committed-copy reads for an open Reader; never shared with the control thread or background IO work. */
  val foreground = Executors.newFixedThreadPool(2) { Thread(it, "SlaxOfflineEngine.foreground").apply { isDaemon = true } }
  private val sessions = HashMap<String, SlaxOfflineSession>()
  private val readable = ConcurrentHashMap<String, SlaxOfflineSession>()
  private val emitLock = Any()
  private var emitter: Pair<Any, (String, Map<String, Any?>) -> Unit>? = null
  private val unobserve = SlaxStorageOwner.observe { scope.launch { revalidate() } }

  fun attach(send: (String, Map<String, Any?>) -> Unit): Any = synchronized(emitLock) { Any().also { emitter = it to send } }
  fun detach(token: Any) {
    val current = synchronized(emitLock) { (emitter?.first === token).also { if (it) emitter = null } }
    if (current) scope.launch { sessions.values.toList().forEach { it.shutdown(SlaxOfflineError.cancelled) }; sessions.clear() }
  }
  fun emit(name: String, body: Map<String, Any?>) {synchronized(emitLock) { emitter?.second }?.invoke(name, body)}
  private fun revalidate() {
    for ((owner, session) in sessions.entries.toList()) if (runCatching { session.lease.check() }.isFailure) {session.shutdown(SlaxOfflineError.revoked); sessions.remove(owner)}
  }
  private fun on(owner: String, reply: SlaxOfflineReply? = null, work: (SlaxOfflineSession) -> Unit) {
    scope.launch {
      val session = sessions[owner]?.takeIf { !it.closed } ?: return@launch reply?.fail(SlaxOfflineError.revoked) ?: Unit
      work(session)
    }
  }

  /** A started session serves committed-copy reads without passing through the control thread; its lease still gates every read. */
  fun publishReadable(session: SlaxOfflineSession) {readable[session.scope.owner] = session}
  fun unpublishReadable(session: SlaxOfflineSession) {readable.remove(session.scope.owner, session)}

  fun open(raw: Map<*, *>, reply: SlaxOfflineReply) {
    scope.launch {
      val parsed = try {SlaxOfflineScope.parse(raw, environment.root, environment.allowHttp)} catch (error: Exception) {reply.fail(SlaxOfflineError.from(error)); return@launch}
      sessions.remove(parsed.owner)?.shutdown(SlaxOfflineError.cancelled)
      val lease = try {SlaxStorageOwner.capture(parsed.owner)} catch (_: Exception) {reply.fail(SlaxOfflineError.revoked); return@launch}
      val session = SlaxOfflineSession(parsed, lease, this@SlaxOfflineEngine)
      sessions[parsed.owner] = session
      session.start(reply)
    }
  }
  fun commitMigration(owner: String, reply: SlaxOfflineReply) = on(owner, reply) { it.commitMigration(reply) }
  fun suspend(owner: String, reply: SlaxOfflineReply) {
    scope.launch { sessions[owner]?.takeIf { !it.closed }?.suspend(reply) ?: reply.resolve(null) }
  }
  fun resume(owner: String) = on(owner) { it.resume() }
  fun close(owner: String, reply: SlaxOfflineReply) {
    scope.launch {
      val session = sessions.remove(owner) ?: return@launch reply.resolve(null)
      session.shutdown(SlaxOfflineError.cancelled); session.drained { reply.resolve(null) }
    }
  }
  fun setCredential(owner: String, raw: Map<*, *>?) = on(owner) { it.setCredential(raw) }
  fun setConditions(owner: String, raw: Map<*, *>) = on(owner) { it.setConditions(raw) }
  fun applyPlan(owner: String, raw: Map<*, *>) = on(owner) { it.apply(raw) }
  fun evict(owner: String, keys: List<String>, reply: SlaxOfflineReply) = on(owner, reply) { it.evict(keys, reply) }
  fun protect(owner: String, key: String): String {
    val token = UUID.randomUUID().toString()
    on(owner) { it.protect(key, token) }
    return token
  }
  fun release(owner: String, token: String) = on(owner) { it.release(token) }
  fun readArticle(owner: String, key: String, reply: SlaxOfflineReply) {
    readable[owner]?.let { return it.readArticle(key, reply) }
    on(owner, reply) { it.readArticle(key, reply) }
  }
  fun fetchArticle(owner: String, raw: Map<*, *>, reply: SlaxOfflineReply) {
    readable[owner]?.let { return it.fetchArticle(raw, reply) }
    on(owner, reply) { it.fetchArticle(raw, reply) }
  }
  fun pdfMetadata(owner: String, raw: Map<*, *>, reply: SlaxOfflineReply) = on(owner, reply) { it.pdfMetadata(raw, reply) }
  fun readPdfRange(owner: String, raw: Map<*, *>, reply: SlaxOfflineReply) = on(owner, reply) { it.readPdfRange(raw, reply) }
  fun pdfStatus(owner: String, key: String, reply: SlaxOfflineReply) = on(owner, reply) { it.pdfStatus(key, reply) }
  fun cancel(owner: String, requestId: String) = on(owner) { it.cancelRequest(requestId, SlaxOfflineError.cancelled) }
  fun usage(owner: String, keys: List<String>, reply: SlaxOfflineReply) = on(owner, reply) { it.usage(keys, reply) }
  fun clear(owner: String, keys: List<String>, categories: List<String>, reply: SlaxOfflineReply) = on(owner, reply) { it.clear(keys, categories, reply) }
}
