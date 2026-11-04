package com.slax.reader.legacy

import java.io.File
import java.nio.file.Files
import org.json.JSONObject

private fun verifyInstallation(root: File, alias: File) {
  val files = File(root, "files").apply { mkdirs() }
  val directory = File(files, "slax-react-native")
  val spellings = listOf(root to files, alias to File(alias, "files"), root to File(alias, "files"), alias to files)
  for (exists in listOf(false, true)) {
    if (exists) check(directory.mkdirs())
    val oldDirectory = File(alias, "files/slax-react-native").absoluteFile
    check(runCatching {
      check(oldDirectory.canonicalFile == oldDirectory && oldDirectory.path.startsWith(alias.canonicalPath + File.separator)) { "Database directory requires recovery" }
    }.isFailure) { "Old guard did not reject the ancestor alias" }
    for ((suppliedRoot, suppliedFiles) in spellings) {
      check(resolveDatabaseDirectory(suppliedRoot, suppliedFiles) == directory)
      check(directory.exists() == exists) { "Resolver created the database directory" }
    }
  }
  val adopted = File(root, "databases/powersync.db").apply { parentFile.mkdirs(); writeText("synthetic adopted pending operations") }
  val native = File(directory, "powersync.db").apply { writeText("synthetic native pending operations") }
  val contents = listOf(adopted, native).associateWith { it.readText() }
  fun record(file: File, mode: String): JSONObject = JSONObject()
    .put("version", 1).put("state", "ready").put("mode", mode).put("path", file.path)
    .put("targetSdk", "powersync-react-native-2.3.1").put("schemaVersion", "2")
    .put("profile", if (mode == "native") "slax-native-format14-schema2-v1" else "slax-powersync-format14-schema2-v1")
    .put("identity", JSONObject().put("owner", "android:com.slax.reader:${files.path}").put("relativePath", file.relativeTo(root).path))
  for ((suppliedRoot, suppliedFiles) in spellings) {
    fun resolveValues(values: JSONObject): KnownInstallationDatabase? = installationDatabase(values, suppliedRoot.canonicalFile, resolveDatabaseDirectory(suppliedRoot, suppliedFiles), "com.slax.reader", suppliedFiles)
    fun resolve(value: JSONObject): KnownInstallationDatabase? = resolveValues(JSONObject().put("_slax_database_installation_v1", value.toString()))
    for ((file, mode) in listOf(adopted to "adopted", native to "native")) {
      val binding = record(file, mode)
      val originalBinding = binding.toString()
      check(resolve(binding) == KnownInstallationDatabase(file.path, mode, true))
      check(binding.toString() == originalBinding)
      for (field in listOf("version", "state", "mode", "path", "targetSdk", "schemaVersion", "profile")) {
        val invalid = JSONObject(binding.toString()).put(field, "invalid")
        check(runCatching { resolve(invalid) }.isFailure) { "Accepted invalid $field" }
      }
      for ((field, value) in listOf("owner" to "other", "relativePath" to "../powersync.db", "relocationPrefix" to "/foreign/")) {
        val invalid = JSONObject(binding.toString())
        invalid.getJSONObject("identity").put(field, value)
        check(runCatching { resolve(invalid) }.isFailure)
      }
      for ((existing, content) in contents) check(existing.readText() == content)
      check(file.delete())
      check(runCatching { resolve(binding) }.isFailure) { "Accepted missing database" }
      check(!file.exists()) { "Created replacement established database" }
      val target = if (file == native) adopted else native
      check(target.readText() == contents.getValue(target))
      Files.createSymbolicLink(file.toPath(), target.toPath())
      check(runCatching { resolve(binding) }.isFailure) { "Accepted linked database file" }
      check(Files.isSymbolicLink(file.toPath()))
      check(target.readText() == contents.getValue(target))
      Files.delete(file.toPath())
      file.writeText(contents.getValue(file))
    }
    check(runCatching { resolveValues(JSONObject().put("_slax_database_installation_v1", "invalid")) }.isFailure)
    val journal = record(adopted, "adopted").put("phase", "accepted")
    journal.put("logicalIdentity", journal.getJSONObject("identity"))
    check(resolveValues(JSONObject().put("_slax_database_adoption_v1", journal.toString())) == KnownInstallationDatabase(adopted.path, "adopted", false))
    journal.put("phase", "opening")
    check(resolveValues(JSONObject().put("_slax_database_adoption_v1", journal.toString())) == null)
    check(resolveValues(JSONObject()) == null)
    for ((file, content) in contents) check(file.readText() == content)
  }
}

private fun verifyRedirects(base: File) {
  for (slot in listOf("files", "files/slax-react-native")) {
    for (external in listOf(false, true)) {
      val fixture = File(base, "${slot.replace('/', '-')}-${if (external) "external" else "internal"}")
      val root = File(fixture, "app").apply { mkdirs() }
      val target = File(if (external) fixture else root, "redirected").apply { mkdirs() }
      val database = File(target, if (slot == "files") "slax-react-native/powersync.db" else "powersync.db").apply { parentFile.mkdirs(); writeText("synthetic redirected pending operations") }
      val contents = database.readText()
      val link = File(root, slot).apply { parentFile.mkdirs() }
      Files.createSymbolicLink(link.toPath(), target.toPath())
      val failure = runCatching { resolveDatabaseDirectory(root, File(root, "files")) }.exceptionOrNull()
      check(failure is IllegalStateException && failure.message == "Database directory requires recovery") { "Accepted redirected $slot" }
      check(Files.isSymbolicLink(link.toPath()))
      check(database.readText() == contents)
      check(target.walkTopDown().filter { it.isFile }.toList() == listOf(database))
    }
  }
  val root = File(base, "mismatched/app").apply { mkdirs() }
  val files = File(root, "files").apply { mkdirs() }
  for (target in listOf(File(root, "other-files"), File(root.parentFile, "other-app/files"))) {
    val database = File(target, "slax-react-native/powersync.db").apply { parentFile.mkdirs(); writeText("synthetic mismatched pending operations") }
    val contents = database.readText()
    val failure = runCatching { resolveDatabaseDirectory(root, target) }.exceptionOrNull()
    check(failure is IllegalStateException && failure.message == "Database directory requires recovery") { "Accepted mismatched files directory" }
    check(database.readText() == contents)
    check(target.walkTopDown().filter { it.isFile }.toList() == listOf(database))
    check(!File(files, "slax-react-native").exists())
  }
}

fun main(args: Array<String>) {
  val base = File(args.single()).canonicalFile
  for (user in listOf("0", "10")) {
    val userRoot = File(base, "data/user/$user").apply { mkdirs() }
    val alias = File(base, "user-$user-alias")
    Files.createSymbolicLink(alias.toPath(), userRoot.toPath())
    verifyInstallation(File(userRoot, "com.slax.reader"), File(alias, "com.slax.reader"))
  }
  verifyRedirects(File(base, "redirects"))
  println("production Android database directory and installation binding helpers passed")
}
