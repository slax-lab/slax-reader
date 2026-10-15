package com.slax.reader.platform

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

class SlaxStorageModule : Module() {
  companion object {
    private val pendingBytes = AtomicLong()
    private val executor = ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(64)) { work -> Thread(work, "SlaxStorage").apply { isDaemon = true } }
  }

  private val writes = java.util.concurrent.ConcurrentHashMap<String, Pair<String?, SlaxStorageLease>>()
  private fun submit(directory: String, owner: String?, bytes: Int, promise: Promise, captured: SlaxStorageLease? = null, work: (SlaxFileStore) -> Any?) {
    val context = appContext.reactContext ?: error("Storage context unavailable")
    val lease = captured ?: SlaxStorageOwner.capture(owner)
    if (pendingBytes.addAndGet(bytes.toLong()) > 32L * 1024 * 1024) {
      pendingBytes.addAndGet(-bytes.toLong()); promise.reject("E_CACHE_BUSY", "Cache write budget is busy", null); return
    }
    try {
      executor.execute {
        try {
          lease.check()
          val uri = java.net.URI(if (directory.startsWith("file:")) directory else File(directory).toURI().toString())
          require(uri.scheme == "file" && uri.authority.isNullOrEmpty() && uri.query == null && uri.fragment == null) { "Invalid storage directory" }
          val supplied = File(uri).absoluteFile
          val root = supplied.canonicalFile
          require(supplied == root) { "Unsafe storage directory" }
          val fixture = context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0 &&
            root.path.startsWith(File(context.cacheDir, "slax-ui-fixtures").canonicalPath + File.separator) && runCatching {
              val marker = JSONObject(File(root, "slax-fixture.json").readText())
              marker.optBoolean("controlledFixture") && marker.optInt("fixtureVersion") == 1
            }.getOrDefault(false)
          require(root == context.dataDir.canonicalFile || fixture) { "Storage directory is not admitted" }
          val pdfRoot = if (fixture) root else File(root, "files")
          require(fixture || context.filesDir.canonicalFile == pdfRoot && pdfRoot.canonicalFile == pdfRoot) { "Unsafe PDF storage directory" }
          val value = work(SlaxFileStore(root, pdfRoot, lease)); lease.check(); promise.resolve(value)
        } catch (_: Exception) {promise.reject("E_CACHE_STORAGE", "Cache operation failed or owner was released", null)}
        finally {pendingBytes.addAndGet(-bytes.toLong())}
      }
    } catch (_: java.util.concurrent.RejectedExecutionException) {
      pendingBytes.addAndGet(-bytes.toLong()); promise.reject("E_CACHE_BUSY", "Cache operation queue is busy", null)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("SlaxStorage")
    Function("beginWrite") { owner: String? ->
      check(writes.size < 64) { "Cache operation queue is busy" }
      val id = java.util.UUID.randomUUID().toString()
      writes[id] = Pair(owner, SlaxStorageOwner.capture(owner)); id
    }
    Function("endWrite") { owner: String?, id: String ->
      val entry = writes[id]
      if (entry != null && entry.first == owner && writes.remove(id, entry)) entry.second.cancel()
    }
    AsyncFunction("readBytes") { directory: String, owner: String?, path: String, versioned: Boolean, promise: Promise ->
      submit(directory, owner, 0, promise) { it.read(path, versioned, SlaxFileStore.BLOCK_LIMIT) }
    }
    AsyncFunction("readText") { directory: String, owner: String?, path: String, promise: Promise ->
      submit(directory, owner, 0, promise) { it.read(path, false, SlaxFileStore.ARTICLE_LIMIT)?.toString(Charsets.UTF_8) }
    }
    AsyncFunction("writeBytes") { directory: String, owner: String?, path: String, bytes: ByteArray, versioned: Boolean, promise: Promise ->
      submit(directory, owner, bytes.size, promise) { it.write(path, bytes, versioned) }
    }
    AsyncFunction("writeBlock") { directory: String, owner: String?, id: String, path: String, bytes: ByteArray, promise: Promise ->
      val entry = writes[id]
      check(entry != null && entry.first == owner) { "Block write was cancelled" }
      require(path.startsWith("pdf/") && bytes.size <= SlaxFileStore.BLOCK_LIMIT) { "Invalid PDF block" }
      submit(directory, owner, bytes.size, promise, entry.second) { it.write(path, bytes, true) }
    }
    AsyncFunction("writeImage") { directory: String, owner: String?, id: String, path: String, bytes: ByteArray, promise: Promise ->
      val entry = writes[id]
      check(entry != null && entry.first == owner) { "Image write was cancelled" }
      require(path.startsWith("bookmark/") && path.contains("/images/")) { "Invalid image path" }
      submit(directory, owner, bytes.size, promise, entry.second) { it.write(path, bytes, false) }
    }
    AsyncFunction("writeText") { directory: String, owner: String?, path: String, text: String, promise: Promise ->
      require(text.length <= SlaxFileStore.ARTICLE_LIMIT) { "Article exceeds cache limit" }
      submit(directory, owner, minOf(SlaxFileStore.ARTICLE_LIMIT, text.length * 3), promise) { it.write(path, text.toByteArray(Charsets.UTF_8), false) }
    }
    AsyncFunction("writeArticle") { directory: String, owner: String?, id: String, path: String, text: String, promise: Promise ->
      val entry = writes[id]
      check(entry != null && entry.first == owner) { "Article write was cancelled" }
      require(path.startsWith("bookmark/") && path.endsWith("/content.html") && text.length <= SlaxFileStore.ARTICLE_LIMIT) { "Invalid article write" }
      submit(directory, owner, minOf(SlaxFileStore.ARTICLE_LIMIT, text.length * 3), promise, entry.second) { it.write(path, text.toByteArray(Charsets.UTF_8), false) }
    }
    AsyncFunction("textFingerprint") { directory: String, owner: String?, text: String, promise: Promise ->
      require(text.length <= SlaxFileStore.ARTICLE_LIMIT) { "Article exceeds cache limit" }
      submit(directory, owner, minOf(SlaxFileStore.ARTICLE_LIMIT, text.length * 3), promise) { it.textFingerprint(text) }
    }
    AsyncFunction("fingerprint") { directory: String, owner: String?, path: String, promise: Promise ->
      submit(directory, owner, 0, promise) { it.fingerprint(path) }
    }
    AsyncFunction("size") { directory: String, owner: String?, path: String, versioned: Boolean, promise: Promise ->
      submit(directory, owner, 0, promise) { it.size(path, versioned)?.toDouble() }
    }
    AsyncFunction("list") { directory: String, owner: String?, path: String, versioned: Boolean, promise: Promise ->
      submit(directory, owner, 0, promise) { it.list(path, versioned) }
    }
    AsyncFunction("measure") { directory: String, owner: String?, path: String, promise: Promise ->
      submit(directory, owner, 0, promise) { it.measure(path).toDouble() }
    }
    AsyncFunction("stageRemoval") { directory: String, owner: String?, id: String, path: String, generation: String, promise: Promise ->
      val entry = writes[id]
      check(entry != null && entry.first == owner) { "Cache removal was cancelled" }
      submit(directory, owner, 0, promise, entry.second) { it.stageRemoval(path, generation); null }
    }
    AsyncFunction("restoreRemoval") { directory: String, owner: String?, path: String, generation: String, promise: Promise ->
      submit(directory, owner, 0, promise) { it.restoreRemoval(path, generation); null }
    }
    AsyncFunction("purgeRemoval") { directory: String, owner: String?, path: String, generation: String, promise: Promise ->
      submit(directory, owner, 0, promise) { it.purgeRemoval(path, generation); null }
    }
    AsyncFunction("remove") { directory: String, owner: String?, path: String, versioned: Boolean, promise: Promise ->
      submit(directory, owner, 0, promise) { it.remove(path, versioned); null }
    }
  }
}
