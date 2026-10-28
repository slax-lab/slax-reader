package com.slax.reader.platform

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

internal object SlaxStorageOwner {
  private val lock = ReentrantLock()
  private var owner: String? = null
  private var epoch = 0L
  private val observers = CopyOnWriteArrayList<(String?) -> Unit>()
  fun activate(value: String?) {
    lock.withLock {
      require(value == null || Regex("^[A-Za-z0-9_-]+$").matches(value)) { "Invalid storage owner" }
      epoch++; owner = value
    }
    observers.forEach { runCatching { it(value) } }
  }
  fun observe(observer: (String?) -> Unit): () -> Unit {observers.add(observer); return {observers.remove(observer)}}
  fun active(): String? = lock.withLock { owner }
  fun capture(value: String?): SlaxStorageLease = lock.withLock {
    check(owner == value) { "Storage owner is inactive" }
    SlaxStorageLease(value, epoch)
  }
  fun <T> current(value: String?, revision: Long, work: () -> T): T = lock.withLock {
    check(owner == value && epoch == revision) { "Storage owner is inactive" }
    work()
  }
}

internal class SlaxStorageLease(private val owner: String?, private val epoch: Long, private val parent: SlaxStorageLease? = null) {
  private val lock = ReentrantLock()
  private var cancelled = false
  fun cancel() = lock.withLock {cancelled = true}
  /** A lease that can be cancelled independently and is also cancelled with this one. */
  fun child() = SlaxStorageLease(owner, epoch, this)
  fun check() = commit {}
  fun <T> commit(work: () -> T): T = lock.withLock {
    check(!cancelled) { "Storage operation cancelled" }
    parent?.check()
    SlaxStorageOwner.current(owner, epoch, work)
  }
}

internal class SlaxFileStore(private val root: File, private val pdfRoot: File, private val lease: SlaxStorageLease) {
  companion object {
    private val io = ReentrantLock()
    const val ARTICLE_LIMIT = 20 * 1024 * 1024
    const val MARKER = "offline-engine.json"
  }
  private fun path(relative: String): File {
    lease.check()
    val parts = relative.split('/')
    require(relative == MARKER || parts.size <= 64 && relative.length <= 4096 && parts.firstOrNull() in listOf("bookmark", "pdf") && parts.all { it.isNotEmpty() && it != "." && it != ".." && it.none { ch -> ch <= '\u001f' || ch == '\u007f' || ch == '\\' } }) { "Invalid cache path" }
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
  fun file(relative: String): File = io.withLock { path(relative) }

  fun read(relative: String, limit: Int): ByteArray? = io.withLock {
    require(limit in 1..ARTICLE_LIMIT) { "Invalid cache read limit" }
    val file = path(relative).takeIf { it.exists() } ?: return null
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

  fun readRange(relative: String, offset: Long, length: Int): ByteArray? = io.withLock {
    require(offset >= 0 && length in 1..ARTICLE_LIMIT) { "Invalid cache range" }
    val file = path(relative).takeIf { it.isFile } ?: return null
    if (file.length() < offset + length) return null
    val bytes = ByteArray(length)
    RandomAccessFile(file, "r").use { input ->
      input.seek(offset); var read = 0
      while (read < length) {lease.check(); val count = input.read(bytes, read, length - read); check(count > 0) { "Cache file truncated" }; read += count}
    }
    path(relative); lease.check(); bytes
  }

  fun size(relative: String): Long? = io.withLock {
    val file = path(relative).takeIf { it.exists() } ?: return null
    check(file.isFile) { "Cache entry is not a file" }; lease.check(); file.length()
  }

  fun write(relative: String, bytes: ByteArray, beforeCommit: () -> Unit = {}): String = io.withLock {
    require(bytes.size <= ARTICLE_LIMIT) { "Cache write exceeds limit" }
    val final = path(relative)
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

  /** Writes staging bytes at an offset; staged bytes are trusted only up to a separately committed progress record. */
  fun append(relative: String, offset: Long, bytes: ByteArray) = io.withLock {
    val file = path(relative)
    check(file.parentFile!!.isDirectory || file.parentFile!!.mkdirs()) { "Cannot create cache directory" }
    path(relative)
    RandomAccessFile(file, "rw").use { output ->
      lease.check(); check(output.length() >= offset) { "Staged cache file is shorter than its offset" }
      output.setLength(offset); output.seek(offset)
      var written = 0
      while (written < bytes.size) {lease.check(); val count = minOf(64 * 1024, bytes.size - written); output.write(bytes, written, count); written += count}
      output.fd.sync()
    }
    lease.check()
  }

  fun move(from: String, to: String) = io.withLock {
    val source = path(from); val target = path(to)
    check(source.isFile) { "Cache source is missing" }
    check(target.parentFile!!.isDirectory || target.parentFile!!.mkdirs()) { "Cannot create cache directory" }
    path(to)
    lease.commit {Files.move(source.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)}
  }

  fun list(relative: String): List<String> = io.withLock {
    val result = mutableListOf<String>()
    fun visit(value: String) {
      val file = path(value); if (!file.exists()) return
      check(file.isDirectory) { "Cache inventory requires a directory" }
      for (child in file.listFiles() ?: error("Cannot list cache")) {
        if (child.name.startsWith(".slax-")) continue
        lease.check(); val next = "$value/${child.name}"; path(next)
        if (child.isDirectory) visit(next) else if (child.isFile) result.add(next)
        check(result.size <= 100_000) { "Cache inventory exceeds limit" }
      }
    }
    visit(relative.trimEnd('/')); lease.check(); result
  }

  fun children(relative: String): List<String> = io.withLock {
    val file = path(relative)
    if (!file.exists()) return emptyList()
    check(file.isDirectory) { "Cache inventory requires a directory" }
    val names = (file.listFiles() ?: error("Cannot list cache")).filter { !Files.isSymbolicLink(it.toPath()) }.map { it.name }.sorted()
    lease.check(); names
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

  /** Returns whether an entry existed; the entry is detached atomically before it is erased. */
  fun remove(relative: String): Boolean {
    val trash = io.withLock {
      val file = path(relative)
      if (!file.exists()) return false
      val target = File(file.parentFile, ".slax-delete-${UUID.randomUUID()}")
      lease.commit {Files.move(file.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE)}
      target
    }
    erase(trash)
    return true
  }

  /** Removes interrupted staging, trash or legacy receipt entries named directly inside a cache directory. */
  fun purge(relative: String, matches: (String) -> Boolean): Int {
    val entries = io.withLock {
      val directory = path(relative)
      if (!directory.isDirectory) return 0
      (directory.listFiles() ?: error("Cannot list cache")).filter { matches(it.name) && !Files.isSymbolicLink(it.toPath()) }
    }
    for (entry in entries) {lease.check(); erase(entry)}
    return entries.size
  }

  private fun erase(value: File) {
    if (!Files.isSymbolicLink(value.toPath()) && value.isDirectory) for (child in value.listFiles() ?: error("Cannot remove cache")) erase(child)
    Files.deleteIfExists(value.toPath())
  }
}
