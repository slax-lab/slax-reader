package com.slax.reader.platform

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import org.json.JSONObject

internal object SlaxImageResources {
  private var registry: SlaxImageRegistry? = null
  @Synchronized fun registry(context: Context): SlaxImageRegistry {
    registry?.let {return it}
    val root = File(context.cacheDir, "slax-image-transfers")
    check(root.canonicalFile == root.absoluteFile && !Files.isSymbolicLink(root.toPath())) {"Unsafe image staging root"}
    Files.createDirectories(root.toPath())
    fun erase(file: File) {
      if (!Files.isSymbolicLink(file.toPath()) && file.isDirectory) for (child in file.listFiles() ?: error("Image staging cleanup failed")) erase(child)
      Files.deleteIfExists(file.toPath())
    }
    for (child in root.listFiles() ?: error("Image staging unavailable")) {
      if (Regex("^process-[a-f0-9-]+$").matches(child.name) && !Files.isSymbolicLink(child.toPath())) erase(child)
    }
    return SlaxImageRegistry(File(root, "process-${UUID.randomUUID()}")).also {registry = it}
  }
  fun root(context: Context, directory: String): Pair<File, Boolean> {
    val uri = java.net.URI(if (directory.startsWith("file:")) directory else File(directory).toURI().toString())
    require(uri.scheme == "file" && uri.authority.isNullOrEmpty() && uri.query == null && uri.fragment == null) {"Invalid image directory"}
    val root = File(uri).absoluteFile
    require(root.canonicalFile == root && !Files.isSymbolicLink(root.toPath())) {"Unsafe image directory"}
    val fixture = context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0 &&
      root.path.startsWith(File(context.cacheDir, "slax-ui-fixtures").canonicalPath + File.separator) && runCatching {
        val marker = JSONObject(File(root, "slax-fixture.json").readText())
        marker.optBoolean("controlledFixture") && marker.optInt("fixtureVersion") == 1
      }.getOrDefault(false)
    require(root == context.dataDir.canonicalFile || fixture) {"Image directory is not admitted"}
    return root to fixture
  }
  fun paths(root: File, key: String, original: String): List<File> {
    val hash = MessageDigest.getInstance("MD5").digest(original.toByteArray(Charsets.UTF_8)).joinToString("") {"%02x".format(it.toInt() and 255)}
    val legacy = original.substringAfterLast('.', "").substringBefore('?').substringBefore('&').take(10).lowercase().ifEmpty {"jpg"}
    val safe = legacy.takeIf { !it.contains("..") && it.none {ch -> ch == '/' || ch == '\\' || ch.code < 32 || ch.code == 127} } ?: "jpg"
    val current = SlaxCachePaths.file(root, key, "$hash.$safe") ?: return emptyList()
    return (listOf(current) + listOfNotNull(if (legacy != safe) SlaxCachePaths.file(root, key, "$hash.$legacy") else null)).distinct()
  }
}

internal class SlaxImageOperation(val owner: String) {
  val lease = SlaxStorageOwner.capture(owner)
  private var consumer: SlaxImageRegistry.Consumer? = null
  private var claimed = false
  @Synchronized fun claim(): Boolean {if (claimed || runCatching {lease.check()}.isFailure) return false; claimed = true; return true}
  @Synchronized fun attach(value: SlaxImageRegistry.Consumer) {try {lease.check(); consumer = value} catch (error: Exception) {value.close(); throw error}}
  @Synchronized fun cancel() {lease.cancel(); consumer?.close(); consumer = null}
}

class SlaxImageModule : Module() {
  companion object {
    private val operations = ConcurrentHashMap<String, SlaxImageOperation>()
    private val workers = ThreadPoolExecutor(3, 3, 30, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(128)) {work -> Thread(work, "SlaxImageCache").apply {isDaemon = true}}
    fun revokeAll() {operations.values.toList().forEach {it.cancel()}; operations.clear()}
  }
  override fun definition() = ModuleDefinition {
    Name("SlaxImageCache")
    Function("begin") {owner: String ->
      check(operations.size < 128) {"Image queue is busy"}
      val id = UUID.randomUUID().toString(); operations[id] = SlaxImageOperation(owner); id
    }
    Function("end") {owner: String, id: String ->
      val operation = operations[id]
      if (operation?.owner == owner && operations.remove(id, operation)) operation.cancel()
    }
    AsyncFunction("resolve") {owner: String, id: String, options: Map<String, Any?>, promise: Promise ->
      val operation = operations[id]?.takeIf {it.owner == owner}
      val context = appContext.reactContext
      if (operation == null || context == null || !operation.claim()) {promise.resolve(mapOf("error" to "cancelled")); return@AsyncFunction}
      val work = Runnable {
        try {
          operation.lease.check()
          val key = options["key"] as? String ?: error("Invalid image key")
          val directory = options["directory"] as? String ?: error("Invalid image directory")
          val url = options["url"] as? String ?: error("Invalid image URL")
          val hosts = (options["hosts"] as? List<*>)?.map {it as String} ?: error("Missing image policy")
          val proxies = (options["proxies"] as? List<*>)?.map {it as String} ?: error("Missing image policy")
          val policy = SlaxReaderSecurity(hosts, proxies)
          val original = policy.imageOriginal(url) ?: throw SlaxImageFailure(terminal = true)
          val (root, fixture) = SlaxImageResources.root(context, directory)
          val paths = SlaxImageResources.paths(root, key, original)
          require(paths.isNotEmpty()) {"Invalid image path"}
          val cached = paths.firstOrNull {it.isFile && it.length() in 1..SlaxImageRegistry.MAX_BYTES}
          if (cached != null) {
            operation.lease.check(); promise.resolve(mapOf("uri" to cached.toURI().toString(), "size" to cached.length().toDouble())); return@Runnable
          }
          if (options["allowNetwork"] != true || fixture) {operation.lease.check(); promise.resolve(null); return@Runnable}
          val consumer = SlaxImageResources.registry(context).acquire(owner, original, policy, strict = options["strict"] != false)
          operation.attach(consumer)
          val resource = consumer.await(); operation.lease.check()
          val relative = paths.first().relativeTo(root).invariantSeparatorsPath
          val uri = consumer.persist(root, relative) {operation.lease.check()}
          operation.lease.check(); promise.resolve(mapOf("uri" to uri, "size" to resource.size.toDouble(), "mime" to resource.mime))
        } catch (error: Exception) {
          val active = runCatching {operation.lease.check()}.isSuccess
          val failure = error as? SlaxImageFailure
          promise.resolve(mapOf("error" to if (active) "unavailable" else "cancelled", "status" to (failure?.status ?: 0), "retryAfter" to failure?.retryAfter, "terminal" to (failure?.terminal ?: false)))
        } finally {operation.cancel(); operations.remove(id, operation)}
      }
      try {workers.execute(work)} catch (_: java.util.concurrent.RejectedExecutionException) {operation.cancel(); operations.remove(id, operation); promise.resolve(mapOf("error" to "busy"))}
    }
  }
}
