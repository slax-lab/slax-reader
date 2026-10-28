package com.slax.reader.platform

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Plan diffs, scheduling, coalesced status, eviction and usage. */
internal fun SlaxOfflineSession.apply(raw: Map<*, *>) {
  val next = (raw["revision"] as? Number)?.toDouble()
  if (next == null || !next.isFinite() || next <= revision) return
  revision = next
  for (key in (raw["remove"] as? List<*>).orEmpty().filterIsInstance<String>()) {
    val task = tasks.remove(key) ?: continue
    val wasRunning = jobs.containsKey(key)
    cancelJobs(key); entries.remove(key); explicit.remove(key)
    if (wasRunning || reported[key]?.startsWith("downloading:") == true) report(task, "invalidated")
    reported.remove(key)
  }
  val load = mutableListOf<String>()
  for (value in (raw["upsert"] as? List<*>).orEmpty()) {
    val task = (value as? Map<*, *>)?.let { runCatching { SlaxOfflineTask.parse(it) }.getOrNull() } ?: continue
    val previous = tasks[task.key]
    if (previous != null) {
      tasks[task.key] = task
      if (previous.version != task.version || previous.kind != task.kind) {cancelJobs(task.key); entries.remove(task.key); load.add(task.key)}
      else if (entries.containsKey(task.key)) reconcile(task.key)
    } else {
      tasks[task.key] = task; order.add(task.key)
      if (entries.containsKey(task.key)) reconcile(task.key) else load.add(task.key)
    }
  }
  if (order.size > tasks.size * 2 + 64) order.retainAll { tasks.containsKey(it) }
  if (opened) loadEntries(load)
  schedulePump()
}

internal fun SlaxOfflineSession.cancelJobs(key: String) {
  jobs.remove(key)?.work?.cancel()
  imageJobs.remove(key)?.cancel()
}

internal fun SlaxOfflineSession.loadEntries(keys: List<String>) {
  val wanted = keys.filter { tasks.containsKey(it) && it !in loading }.distinct()
  if (wanted.isEmpty() || !opened || closed) return
  loading.addAll(wanted)
  val kinds = wanted.map { it to tasks.getValue(it).kind }
  lane.launch {
    val values = try {io { store ->
      kinds.map { (key, kind) ->
        val manifest = runCatching { SlaxOfflineLayout.readManifest(store, key) }.getOrNull()
        val size = runCatching { layout.contentSize(store, key, manifest?.kind ?: kind) }.getOrNull()
        lease.check()
        Triple(key, kind, SlaxOfflineSession.Entry(manifest, size))
      }
    }} catch (error: CancellationException) {throw error} catch (_: Exception) {null}
    loading.removeAll(wanted.toSet())
    if (values == null) return@launch
    val retry = mutableListOf<String>()
    for ((key, kind, entry) in values) {
      val task = tasks[key] ?: continue
      if (task.kind != kind) {retry.add(key); continue}
      entries[key] = entry; reconcile(key)
    }
    loadEntries(retry); schedulePump()
  }
}

internal fun SlaxOfflineSession.complete(entry: SlaxOfflineSession.Entry, task: SlaxOfflineTask): Boolean {
  val manifest = entry.manifest ?: return false
  return manifest.kind == task.kind && manifest.version == task.version && manifest.size > 0 && entry.contentSize == manifest.size && (manifest.id.isEmpty() || manifest.id == task.id)
}

/** Binds adopted content to its plan version and reports terminal states known from disk. */
internal fun SlaxOfflineSession.reconcile(key: String) {
  val task = tasks[key] ?: return
  var entry = entries[key] ?: return
  val adopted = entry.manifest
  if (adopted != null && adopted.version == null && adopted.kind == task.kind && adopted.size > 0 && entry.contentSize == adopted.size && !jobs.containsKey(key)) {
    val manifest = adopted.copy(version = task.version, id = task.id, owner = task.collectionOwner)
    entry = entry.copy(manifest = manifest); entries[key] = entry
    commitLater(key) { SlaxOfflineLayout.writeManifest(it, key, manifest) }
  }
  if (complete(entry, task)) {report(task, "complete"); return}
  val retry = entry.manifest?.retry
  if (retry != null && retry.version == task.version && !jobs.containsKey(key))
    report(task, if (retry.denied) "denied" else "failed", retry.code, if (retry.denied) null else retry.retryAt)
}

internal fun SlaxOfflineSession.schedulePump() {
  if (pumpScheduled) return
  pumpScheduled = true
  lane.launch { pumpScheduled = false; pump() }
}

internal fun SlaxOfflineSession.pump() {
  if (!opened || suspended || closed) return
  val now = SlaxOfflineClock.now()
  var deadline = Long.MAX_VALUE
  if (online && credential.value != null) {
    val running = HashMap<String, Int>()
    for (job in jobs.values) running[job.task.domain] = (running[job.task.domain] ?: 0) + 1
    for (key in order) {
      val task = tasks[key] ?: continue
      if (jobs.containsKey(key) || (running[task.domain] ?: 0) >= 3) continue
      val entry = entries[key] ?: continue
      if (complete(entry, task)) continue
      val retry = entry.manifest?.retry
      if (retry != null && retry.version == task.version) {
        if (retry.denied) continue
        if (retry.retryAt > now && key !in explicit) {deadline = minOf(deadline, retry.retryAt); continue}
      }
      running[task.domain] = (running[task.domain] ?: 0) + 1
      if (task.kind == "pdf") startPdf(task) else startArticle(task)
    }
  }
  if (online && downloadImages) {
    val active = imageJobs.keys.mapNotNull { tasks[it]?.domain }.toMutableSet()
    for (key in order) {
      val task = tasks[key] ?: continue
      if (task.kind != "article" || task.domain in active || imageJobs.containsKey(key) || jobs.containsKey(key)) continue
      val entry = entries[key] ?: continue
      if (!complete(entry, task)) continue
      val images = entry.manifest?.images ?: continue
      if (images.any { it.eligible(now) }) {active.add(task.domain); startImages(task); continue}
      for (image in images) if (image.state == "failed") deadline = minOf(deadline, image.retryAt)
    }
  }
  if (deadline != wakeAt) {
    wake?.cancel(); wake = null; wakeAt = deadline
    if (deadline < Long.MAX_VALUE) wake = lane.launch {
      delay(maxOf(1, minOf(2_000_000_000L, deadline - now)))
      wakeAt = Long.MAX_VALUE; wake = null; pump()
    }
  }
}

// Status

internal fun SlaxOfflineSession.report(task: SlaxOfflineTask, state: String, code: String? = null, retryAt: Long? = null) {
  val signature = state + ":" + task.version + ":" + (retryAt ?: 0)
  if (state in listOf("downloading", "complete", "denied", "failed")) {
    if (reported[task.key] == signature) return
    reported[task.key] = signature
  } else reported.remove(task.key)
  val item = linkedMapOf<String, Any?>("key" to task.key, "state" to state, "manual" to task.manual)
  if (code != null) item["code"] = code
  if (retryAt != null && retryAt > 0) item["retryAt"] = retryAt.toDouble()
  enqueue(item)
}
internal fun SlaxOfflineSession.reportEvicted(key: String) {
  reported.remove(key)
  enqueue(linkedMapOf("key" to key, "state" to "evicted", "manual" to (tasks[key]?.manual ?: false)))
}
/** Coalesces status to at most one `onStatus` event per owner per window; a key keeps only its latest item. */
internal fun SlaxOfflineSession.enqueue(item: Map<String, Any?>) {
  val key = item["key"] as? String ?: return
  if (closed) return
  pending[key] = item
  if (flushScheduled) return
  flushScheduled = true
  val elapsed = lastEmit?.let { (System.nanoTime() - it) / 1_000_000 } ?: Long.MAX_VALUE
  lane.launch { delay(maxOf(0, engine.environment.coalesceMs - elapsed)); flushStatus() }
}
internal fun SlaxOfflineSession.flushStatus() {
  flushScheduled = false
  if (closed || pending.isEmpty()) return
  val items = pending.values.toList(); pending.clear(); lastEmit = System.nanoTime()
  engine.emit("onStatus", mapOf("owner" to scope.owner, "items" to items))
}

// Eviction, clearing, usage

private fun SlaxOfflineSession.detachKeys(keys: List<String>, skipProtected: Boolean): List<String> {
  val selected = mutableListOf<String>()
  for (key in keys) {
    if (!SlaxOfflineTask.validKey(key) || key in selected) continue
    if (skipProtected && protected(key)) continue
    cancelJobs(key)
    writers.remove(key)?.values?.forEach { it.cancel() }
    for (request in requests.values.toList()) if (request.key == key) cancelRequest(request.id, SlaxOfflineError.cancelled)
    entries.remove(key); explicit.remove(key)
    selected.add(key)
  }
  return selected
}
internal fun SlaxOfflineSession.evict(keys: List<String>, reply: SlaxOfflineReply) {
  val selected = detachKeys(keys, true)
  if (selected.isEmpty()) {reply.resolve(emptyList<String>()); return}
  lane.launch {
    reply.cancellable {
      try {
        for (key in selected) commit(key) { store -> store.remove(SlaxOfflineLayout.bookmark(key)); store.remove(layout.pdf(key)) }
        reply.resolve(selected); selected.forEach { reportEvicted(it) }
      } catch (error: SlaxOfflineError) {reply.fail(error)}
    }
    loadEntries(selected)
  }.settles(reply)
}
internal fun SlaxOfflineSession.clear(keys: List<String>, categories: List<String>, reply: SlaxOfflineReply) {
  val article = "article" in categories; val images = "images" in categories
  val selected = detachKeys(keys, false)
  if (selected.isEmpty() || !article && !images) {reply.resolve(emptyList<String>()); return}
  lane.launch {
    val removed = mutableListOf<String>()
    reply.cancellable {
      try {
        for (key in selected) commit(key) { store ->
          if (article) {
            val html = store.remove(SlaxOfflineLayout.content(key)); val pdf = store.remove(layout.pdf(key))
            store.remove(SlaxOfflineLayout.manifest(key))
            if (html || pdf) removed.add(key)
          }
          if (images) store.remove(SlaxOfflineLayout.images(key))
        }
        reply.resolve(removed); removed.forEach { reportEvicted(it) }
      } catch (error: SlaxOfflineError) {reply.fail(error)}
    }
    loadEntries(selected)
  }.settles(reply)
}
internal fun SlaxOfflineSession.usage(keys: List<String>, reply: SlaxOfflineReply) {
  val selected = keys.filter { SlaxOfflineTask.validKey(it) }.distinct()
  lane.launch {
    reply.cancellable { try {
      val value = io { store ->
        var article = 0L; var images = 0L
        for (key in selected) {
          article += (store.size(SlaxOfflineLayout.content(key)) ?: 0) + store.measure(layout.pdf(key))
          images += store.measure(SlaxOfflineLayout.images(key))
        }
        mapOf("article" to article.toDouble(), "images" to images.toDouble())
      }
      reply.resolve(value)
    } catch (error: SlaxOfflineError) {reply.fail(error)} }
  }.settles(reply)
}
