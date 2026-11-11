package com.slax.reader.legacy

import java.io.File
import java.nio.file.Files
import java.nio.file.LinkOption

internal class LegacyReset(private val root: File, private val files: File, private val databaseDirectory: File) {
  private val marker = File(files, ".slax-legacy-reset")
  private val legacy = File(root, "databases/powersync.db")
  private val suffixes = listOf("", "-wal", "-shm", "-journal")

  private fun exists(file: File) = Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS)

  private fun remove(file: File) {
    if (!exists(file)) return
    check(file.canonicalFile == file.absoluteFile) { "Cannot reset redirected application storage" }
    if (file.isDirectory) {
      val children = file.listFiles() ?: error("Cannot read application cache directory")
      children.forEach { remove(it) }
    }
    check(file.delete()) { "Cannot remove legacy application storage" }
  }

  private fun validate(file: File) {
    check(file.canonicalFile == file.absoluteFile && !Files.isSymbolicLink(file.toPath())) { "Cannot reset redirected application storage" }
    if (file.isDirectory) {
      val children = file.listFiles() ?: error("Cannot read application cache directory")
      children.forEach { validate(it) }
    }
  }

  fun prepare(): Boolean {
    val legacyFiles = suffixes.map { File(legacy.path + it) }
    if (!exists(marker) && legacyFiles.none { exists(it) }) return false
    val targets = legacyFiles + listOf(File(root, "bookmark"), File(files, "pdf"), databaseDirectory)
    (listOf(marker, File(files, "user.preferences_pb")) + targets).forEach { validate(it) }
    if (!exists(marker)) check(marker.createNewFile()) { "Cannot begin legacy storage reset" }
    targets.forEach { remove(it) }
    return true
  }

  fun finish() {
    if (!exists(marker)) return
    remove(File(files, "user.preferences_pb"))
    remove(marker)
  }
}
