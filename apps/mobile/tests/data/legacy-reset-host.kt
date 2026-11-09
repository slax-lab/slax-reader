package com.slax.reader.legacy

import java.io.File
import java.nio.file.Files

fun main(args: Array<String>) {
  val root = File(args[0], "android").apply { mkdirs() }.canonicalFile
  val files = File(root, "files").apply { mkdirs() }
  val native = File(files, "slax-react-native").apply { mkdirs() }
  val current = File(native, "powersync.db").apply { writeText("new offline changes") }
  val reset = LegacyReset(root, files, native)
  check(!reset.prepare() && current.readText() == "new offline changes")
  File(files, "user.preferences_pb").writeText("old preferences alone do not reset")
  check(!reset.prepare() && current.exists())
  val old = File(root, "databases/powersync.db").apply { parentFile.mkdirs(); writeText("not even sqlite") }
  File(old.path + "-wal").writeText("old wal")
  File(root, "bookmark/article/content.html").apply { parentFile.mkdirs(); writeText("old cache") }
  check(reset.prepare())
  check(!old.exists() && !File(old.path + "-wal").exists() && !current.exists() && !File(root, "bookmark").exists())
  check(File(files, ".slax-legacy-reset").exists())
  check(LegacyReset(root, files, native).prepare())
  reset.finish()
  check(!File(files, ".slax-legacy-reset").exists() && !File(files, "user.preferences_pb").exists())
  current.parentFile.mkdirs(); current.writeText("post-reset writes")
  check(!reset.prepare() && current.readText() == "post-reset writes")
  val outside = File(args[0], "outside").apply { mkdirs() }.canonicalFile
  val sentinel = File(outside, "powersync.db").apply { writeText("unrelated") }
  val cache = File(root, "bookmark/article/content.html").apply { parentFile.mkdirs(); writeText("retained cache") }
  val preferences = File(files, "user.preferences_pb").apply { writeText("retained preferences") }
  val currentPreferences = File(files, "slax.preferences.v1.json").apply { writeText("retained current preferences") }
  val wal = File(old.path + "-wal").apply { writeText("retained old wal") }
  val targets = listOf(old, wal, File(root, "bookmark"), File(files, "pdf"), native, preferences)
  for (target in targets) {
    old.writeText("retained old database")
    val saved = File(target.parentFile, target.name + ".test-saved")
    val hadOriginal = target.exists()
    if (hadOriginal) check(target.renameTo(saved))
    Files.createSymbolicLink(target.toPath(), sentinel.toPath())
    repeat(2) {
      check(runCatching { reset.prepare() }.isFailure)
      check(!File(files, ".slax-legacy-reset").exists()) { "Rejected reset left a marker" }
      check((if (target == native) File(saved, "powersync.db") else current).readText() == "post-reset writes") { "Rejected reset deleted new writes" }
      check((if (target == File(root, "bookmark")) File(saved, "article/content.html") else cache).readText() == "retained cache")
      check((if (target == preferences) saved else preferences).readText() == "retained preferences")
      check(currentPreferences.readText() == "retained current preferences")
      check((if (target == old) saved else old).readText() == "retained old database")
      check((if (target == wal) saved else wal).readText() == "retained old wal")
      check(sentinel.readText() == "unrelated")
    }
    Files.delete(target.toPath())
    if (hadOriginal) check(saved.renameTo(target))
  }
  val nested = File(cache.parentFile, "redirected")
  Files.createSymbolicLink(nested.toPath(), sentinel.toPath())
  check(runCatching { reset.prepare() }.isFailure)
  check(current.readText() == "post-reset writes" && cache.readText() == "retained cache" && !File(files, ".slax-legacy-reset").exists())
  Files.delete(nested.toPath())
  check(reset.prepare())
  reset.finish()
  check(!old.exists() && !current.exists() && !cache.exists())
  println("Android fixed-path reset passed: preflight rejects every redirected target without mutation, retry recovers, normal reset remains idempotent")
}
