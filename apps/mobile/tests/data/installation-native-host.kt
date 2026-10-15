package com.slax.reader.legacy

import java.io.File
import org.json.JSONObject

fun main(args: Array<String>) {
  val root = File(args.single()).canonicalFile
  val files = File(root, "files").apply { mkdirs() }
  val directory = File(files, "slax-react-native").apply { mkdirs() }
  val adopted = File(root, "databases/powersync.db").apply { parentFile.mkdirs(); writeText("synthetic") }
  val native = File(directory, "powersync.db").apply { writeText("synthetic") }
  fun record(file: File, mode: String): JSONObject = JSONObject()
    .put("version", 1).put("state", "ready").put("mode", mode).put("path", file.path)
    .put("targetSdk", "powersync-react-native-2.3.1").put("schemaVersion", "2")
    .put("profile", if (mode == "native") "slax-native-format14-schema2-v1" else "slax-powersync-format14-schema2-v1")
    .put("identity", JSONObject().put("owner", "android:com.slax.reader:${files.path}").put("relativePath", file.relativeTo(root).path))
  fun resolve(value: JSONObject): KnownInstallationDatabase? = installationDatabase(JSONObject().put("_slax_database_installation_v1", value.toString()), root, directory, "com.slax.reader", files)
  for ((file, mode) in listOf(adopted to "adopted", native to "native")) {
    val binding = record(file, mode)
    check(resolve(binding) == KnownInstallationDatabase(file.path, mode, true))
    for (field in listOf("state", "mode", "path", "targetSdk", "schemaVersion", "profile")) {
      val invalid = JSONObject(binding.toString()).put(field, "invalid")
      check(runCatching { resolve(invalid) }.isFailure) { "Accepted invalid $field" }
    }
    for ((field, value) in listOf("owner" to "other", "relativePath" to "../powersync.db", "relocationPrefix" to "/foreign/")) {
      val invalid = JSONObject(binding.toString())
      invalid.getJSONObject("identity").put(field, value)
      check(runCatching { resolve(invalid) }.isFailure)
    }
  }
  val binding = record(native, "native")
  native.delete()
  check(runCatching { resolve(binding) }.isFailure) { "Accepted missing database" }
  java.nio.file.Files.createSymbolicLink(native.toPath(), adopted.toPath())
  check(runCatching { resolve(binding) }.isFailure) { "Accepted symlink" }
  val journal = record(adopted, "adopted").put("phase", "accepted")
  journal.put("logicalIdentity", journal.getJSONObject("identity"))
  val previous = installationDatabase(JSONObject().put("_slax_database_adoption_v1", journal.toString()), root, directory, "com.slax.reader", files)
  check(previous == KnownInstallationDatabase(adopted.path, "adopted", false))
  journal.put("phase", "opening")
  check(installationDatabase(JSONObject().put("_slax_database_adoption_v1", journal.toString()), root, directory, "com.slax.reader", files) == null)
  check(installationDatabase(JSONObject(), root, directory, "com.slax.reader", files) == null)
  println("production Android installation binding helpers passed")
}
