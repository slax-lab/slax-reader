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
  Files.createSymbolicLink(old.toPath(), sentinel.toPath())
  check(runCatching { reset.prepare() }.isFailure)
  check(sentinel.readText() == "unrelated")
  println("Android fixed-path reset passed: corrupt old file, WAL/cache cleanup, interruption, fresh/native preservation, path containment")
}
