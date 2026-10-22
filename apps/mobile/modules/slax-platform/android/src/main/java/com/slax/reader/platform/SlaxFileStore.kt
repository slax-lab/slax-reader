package com.slax.reader.platform

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

internal object SlaxStorageOwner {
  private val lock = ReentrantLock()
  private var owner: String? = null
  private var epoch = 0L
  fun activate(value: String?) = lock.withLock {
    require(value == null || Regex("^[A-Za-z0-9_-]+$").matches(value)) { "Invalid storage owner" }
    epoch++; owner = value
  }
  fun capture(value: String?): SlaxStorageLease = lock.withLock {
    check(owner == value) { "Storage owner is inactive" }
    SlaxStorageLease(value, epoch)
  }
  fun <T> current(value: String?, revision: Long, work: () -> T): T = lock.withLock {
    check(owner == value && epoch == revision) { "Storage owner is inactive" }
    work()
  }
}

internal class SlaxStorageLease(private val owner: String?, private val epoch: Long) {
  private val lock = ReentrantLock()
  private var cancelled = false
  fun cancel() = lock.withLock {cancelled = true}
  fun check() = commit {}
  fun <T> commit(work: () -> T): T = lock.withLock {
    check(!cancelled) { "Storage operation cancelled" }
    SlaxStorageOwner.current(owner, epoch, work)
  }
}

internal class SlaxFileStore(private val root: File, private val pdfRoot: File, private val lease: SlaxStorageLease) {
  companion object {
    private val io = ReentrantLock()
    const val BLOCK_LIMIT = 1024 * 1024
    const val ARTICLE_LIMIT = 20 * 1024 * 1024
    private val versionName = Regex("^[0-9]{16}-[A-Za-z0-9_-]+\\.data$")
  }
  private fun path(relative: String): File {
    lease.check()
    val parts = relative.split('/')
    require(parts.size <= 64 && relative.length <= 4096 && parts.firstOrNull() in listOf("bookmark", "pdf") && parts.all { it.isNotEmpty() && it != "." && it != ".." && it.none { ch -> ch <= '\u001f' || ch == '\u007f' || ch == '\\' } }) { "Invalid cache path" }
    require(parts.first() != "pdf" || parts.all { Regex("^[A-Za-z0-9_.-]+$").matches(it) }) { "Invalid PDF path" }
    require(parts.first() != "bookmark" || parts.size == 1 || Regex("^[A-Za-z0-9_-]+$").matches(parts[1])) { "Invalid bookmark key" }
    val base = if (parts.first() == "pdf") pdfRoot else root
    check(base.canonicalFile == base.absoluteFile && !Files.isSymbolicLink(base.toPath())) { "Unsafe cache root" }
    var current = base
    for (part in parts) {
      current = File(current, part)
      check(current.canonicalFile == current.absoluteFile && !Files.isSymbolicLink(current.toPath())) { "Unsafe cache path" }
    }
    return current
  }
  private fun versions(relative: String): List<File> {
    val directory = path("$relative.entries")
    if (!directory.exists()) return emptyList()
    check(directory.isDirectory) { "Invalid PDF entries" }
    return directory.listFiles()?.filter { versionName.matches(it.name) && it.isFile && !Files.isSymbolicLink(it.toPath()) }?.sortedByDescending { it.name } ?: error("Cannot list PDF entries")
  }
  private fun selected(relative: String, versioned: Boolean): File? = if (versioned) versions(relative).firstOrNull() else path(relative).takeIf { it.exists() }

  fun read(relative: String, versioned: Boolean, limit: Int): ByteArray? = io.withLock {
    require(limit in 1..ARTICLE_LIMIT) { "Invalid cache read limit" }
    val file = selected(relative, versioned) ?: return null
    check(file.isFile && file.length() <= limit) { "Cache file exceeds limit" }
    val output = ByteArrayOutputStream(minOf(file.length().toInt(), 64 * 1024))
    FileInputStream(file).use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        lease.check(); val count = input.read(buffer); if (count == -1) break
        check(output.size().toLong() + count <= limit) { "Cache file exceeds limit" }
        output.write(buffer, 0, count)
      }
    }
    path(relative); lease.check(); output.toByteArray()
  }

  fun fingerprint(relative: String): Map<String, Any>? = io.withLock {
    val file = selected(relative, false) ?: return null
    check(file.isFile && file.length() <= ARTICLE_LIMIT) { "Cache file exceeds limit" }
    val hash = java.security.MessageDigest.getInstance("SHA-256"); var size = 0L
    FileInputStream(file).use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        lease.check(); val count = input.read(buffer); if (count < 0) break
        size += count; check(size <= ARTICLE_LIMIT) { "Cache file exceeds limit" }; hash.update(buffer, 0, count)
      }
    }
    path(relative); lease.check()
    mapOf("size" to size.toDouble(), "sha256" to hash.digest().joinToString("") {"%02x".format(it.toInt() and 255)})
  }
  fun textFingerprint(text: String): Map<String, Any> {
    lease.check(); require(text.length <= ARTICLE_LIMIT) { "Article exceeds cache limit" }
    val bytes = text.toByteArray(Charsets.UTF_8); require(bytes.size <= ARTICLE_LIMIT) { "Article exceeds cache limit" }
    val hash = java.security.MessageDigest.getInstance("SHA-256")
    var offset = 0
    while (offset < bytes.size) {lease.check(); val count = minOf(64 * 1024, bytes.size - offset); hash.update(bytes, offset, count); offset += count}
    lease.check(); return mapOf("size" to bytes.size.toDouble(), "sha256" to hash.digest().joinToString("") {"%02x".format(it.toInt() and 255)})
  }

  fun size(relative: String, versioned: Boolean): Long? = io.withLock {
    val file = selected(relative, versioned) ?: return null
    check(file.isFile) { "Cache entry is not a file" }; lease.check(); file.length()
  }

  fun write(relative: String, bytes: ByteArray, versioned: Boolean, beforeCommit: () -> Unit = {}): String = io.withLock {
    require(bytes.size <= if (versioned) BLOCK_LIMIT else ARTICLE_LIMIT) { "Cache write exceeds limit" }
    val previous = if (versioned) versions(relative) else emptyList()
    val final = if (versioned) {
      val sequence = previous.firstOrNull()?.name?.take(16)?.toLong()?.plus(1) ?: 1L
      check(sequence in 1..9_007_199_254_740_991L) { "Cache generation exhausted" }
      path("$relative.entries/${sequence.toString().padStart(16, '0')}-${UUID.randomUUID()}.data")
    } else path(relative)
    lease.check(); check(final.parentFile!!.isDirectory || final.parentFile!!.mkdirs()) { "Cannot create cache directory" }
    path(relative)
    val temporary = File(final.parentFile, ".slax-${UUID.randomUUID()}.tmp")
    var committed = false
    try {
      check(temporary.createNewFile()) { "Cache staging collision" }
      FileOutputStream(temporary).use { output ->
        var offset = 0
        while (offset < bytes.size) {lease.check(); val count = minOf(64 * 1024, bytes.size - offset); output.write(bytes, offset, count); offset += count}
        output.fd.sync()
      }
      beforeCommit(); path(relative)
      lease.commit {
        Files.move(temporary.toPath(), final.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        committed = true
      }
      for (old in previous) {path(relative); lease.commit {Files.deleteIfExists(old.toPath())}}
      lease.check(); final.toURI().toString()
    } finally {if (!committed) Files.deleteIfExists(temporary.toPath())}
  }

  fun writeStream(relative: String, input: java.io.InputStream, expectedBytes: Long, beforeCommit: () -> Unit = {}): String {
    require(expectedBytes in 1..ARTICLE_LIMIT.toLong()) { "Cache stream exceeds limit" }
    val (final, temporary) = io.withLock {
      val final = path(relative)
      check(final.parentFile!!.isDirectory || final.parentFile!!.mkdirs()) { "Cannot create cache directory" }
      path(relative)
      val temporary = File(final.parentFile, ".slax-${UUID.randomUUID()}.tmp")
      check(temporary.createNewFile()) { "Cache staging collision" }
      final to temporary
    }
    var committed = false
    try {
      FileOutputStream(temporary).use { output ->
        val buffer = ByteArray(64 * 1024); var received = 0L
        while (true) {
          lease.check(); val count = input.read(buffer); lease.check(); if (count < 0) break
          received += count; check(received <= expectedBytes) { "Cache stream exceeds length" }
          output.write(buffer, 0, count)
        }
        check(received == expectedBytes) { "Incomplete cache stream" }; output.fd.sync()
      }
      beforeCommit()
      io.withLock {
        check(path(relative) == final) { "Cache destination changed" }
        lease.commit {Files.move(temporary.toPath(), final.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); committed = true}
      }
      lease.check(); return final.toURI().toString()
    } finally {if (!committed) Files.deleteIfExists(temporary.toPath())}
  }

  fun list(relative: String, versioned: Boolean): List<String> = io.withLock {
    val result = mutableListOf<String>()
    fun visit(value: String) {
      val file = path(value); if (!file.exists()) return
      check(file.isDirectory) { "Cache inventory requires a directory" }
      for (child in file.listFiles() ?: error("Cannot list cache")) {
        if (child.name.startsWith(".slax-")) continue
        lease.check(); val next = "$value/${child.name}"; path(next)
        if (child.isDirectory) {
          if (versioned && child.name.endsWith(".entries")) {if (versions(next.removeSuffix(".entries")).isNotEmpty()) result.add(next.removeSuffix(".entries"))}
          else visit(next)
        } else if (!versioned && child.isFile && !child.name.startsWith(".slax-")) result.add(next)
        check(result.size <= 100_000) { "Cache inventory exceeds limit" }
      }
    }
    visit(relative.trimEnd('/')); lease.check(); result
  }

  fun measure(relative: String): Long = io.withLock {
    var total = 0L
    fun visit(value: String) {
      val file = path(value); if (!file.exists()) return
      if (file.isDirectory) for (child in file.listFiles() ?: error("Cannot measure cache")) {if (!child.name.startsWith(".slax-")) visit("$value/${child.name}")}
      else {check(file.isFile) { "Unsafe cache entry" }; total = Math.addExact(total, file.length())}
    }
    visit(relative); lease.check(); total
  }

  private fun removalPaths(relative: String, generation: String): Pair<File, File> {
    require(Regex("^[A-Za-z0-9_-]{1,100}$").matches(generation)) { "Invalid cache removal generation" }
    require(Regex("^bookmark/[A-Za-z0-9_-]+$").matches(relative) || Regex("^pdf/v1/[a-f0-9]{64}/[A-Za-z0-9_-]+$").matches(relative)) { "Invalid cache removal scope" }
    val source = path(relative)
    val suffix = java.security.MessageDigest.getInstance("SHA-256").digest(relative.toByteArray(Charsets.UTF_8)).take(8).joinToString("") {"%02x".format(it.toInt() and 255)}
    val receipt = File(source.parentFile, ".slax-evict-$generation-$suffix")
    check(receipt.canonicalFile == receipt.absoluteFile && !Files.isSymbolicLink(receipt.toPath())) { "Unsafe cache removal receipt" }
    return source to receipt
  }
  private fun removalMarker(relative: String) = "slax-cache-eviction-v1\n$relative\n".toByteArray(Charsets.UTF_8)
  private fun verifyRemoval(relative: String, receipt: File) {
    lease.check()
    check(receipt.isDirectory && !Files.isSymbolicLink(receipt.toPath())) { "Invalid cache removal receipt" }
    val children = receipt.listFiles() ?: error("Cannot inspect cache removal")
    check(children.all {it.name in listOf("intent", "payload")}) { "Invalid cache removal entries" }
    val marker = File(receipt, "intent")
    check(!Files.isSymbolicLink(marker.toPath()) && (!marker.exists() || marker.isFile && marker.length() <= 4096)) { "Invalid cache removal intent" }
    if (children.any {it.name == "payload"}) check(marker.isFile && marker.readBytes().contentEquals(removalMarker(relative))) { "Invalid cache removal intent" }
  }
  fun stageRemoval(relative: String, generation: String, beforeMove: () -> Unit = {}) = io.withLock {
    val (source, receipt) = removalPaths(relative, generation)
    if (receipt.exists()) {verifyRemoval(relative, receipt); return@withLock}
    lease.check(); Files.createDirectories(source.parentFile!!.toPath()); path(relative)
    check(receipt.mkdir()) { "Cannot create cache removal receipt" }
    val marker = File(receipt, "intent")
    FileOutputStream(marker).use {it.write(removalMarker(relative)); it.fd.sync()}
    beforeMove(); path(relative); verifyRemoval(relative, receipt)
    if (source.exists()) lease.commit {Files.move(source.toPath(), File(receipt, "payload").toPath(), StandardCopyOption.ATOMIC_MOVE)}
  }
  fun restoreRemoval(relative: String, generation: String) {
    val receipt = io.withLock {
      val (_, receipt) = removalPaths(relative, generation)
      if (!receipt.exists()) return
      verifyRemoval(relative, receipt); receipt
    }
    fun restore(from: File, to: File, depth: Int) {
      io.withLock {
        lease.check(); path(relative)
        check(depth <= 64 && from.canonicalFile == from.absoluteFile && to.canonicalFile == to.absoluteFile && !Files.isSymbolicLink(from.toPath()) && !Files.isSymbolicLink(to.toPath())) { "Unsafe cache restore path" }
        if (!from.exists()) return
        if (!to.exists()) {lease.commit {Files.move(from.toPath(), to.toPath(), StandardCopyOption.ATOMIC_MOVE)}; return}
        if (!from.isDirectory || !to.isDirectory || to.name.endsWith(".entries")) return
      }
      for (child in from.listFiles() ?: error("Cannot restore cache directory")) {
        if (child.name.startsWith(".slax-")) continue
        restore(child, File(to, child.name), depth + 1)
      }
    }
    restore(File(receipt, "payload"), path(relative), 0)
    purgeRemoval(relative, generation)
  }
  fun purgeRemoval(relative: String, generation: String) {
    val receipt = io.withLock {
      val (_, receipt) = removalPaths(relative, generation)
      if (!receipt.exists()) return
      verifyRemoval(relative, receipt); receipt
    }
    fun erase(value: File) {
      lease.check()
      if (!Files.isSymbolicLink(value.toPath()) && value.isDirectory) for (child in value.listFiles() ?: error("Cannot purge cache removal")) erase(child)
      lease.commit {Files.deleteIfExists(value.toPath())}
    }
    File(receipt, "payload").takeIf {it.exists() || Files.isSymbolicLink(it.toPath())}?.let(::erase)
    io.withLock {verifyRemoval(relative, receipt); lease.commit {Files.deleteIfExists(File(receipt, "intent").toPath()); Files.deleteIfExists(receipt.toPath())}}
  }

  fun remove(relative: String, versioned: Boolean) {
    val trash = io.withLock {
      val file = path(if (versioned) "$relative.entries" else relative)
      if (!file.exists()) return
      val target = File(file.parentFile, ".slax-delete-${UUID.randomUUID()}")
      lease.commit {Files.move(file.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE)}
      target
    }
    fun erase(value: File) {
      if (!Files.isSymbolicLink(value.toPath()) && value.isDirectory) for (child in value.listFiles() ?: error("Cannot remove cache")) erase(child)
      Files.deleteIfExists(value.toPath())
    }
    erase(trash)
  }
}
