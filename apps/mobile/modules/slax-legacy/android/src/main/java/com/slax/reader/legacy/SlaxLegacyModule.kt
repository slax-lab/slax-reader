package com.slax.reader.legacy

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.FileLock
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import org.json.JSONObject

class SlaxLegacyModule : Module() {
  private var ownerFile: RandomAccessFile? = null
  private var ownerLock: FileLock? = null
  private var reset: LegacyReset? = null
  private val context get() = appContext.reactContext ?: error("Application context unavailable")
  private val storageDirectory get() = context.filesDir
  private val preferenceFile get() = File(storageDirectory, "slax.preferences.v1.json")

  private fun <T> withPreferenceLock(action: () -> T): T = synchronized(File(storageDirectory, ".slax-preferences.lock").canonicalPath.intern()) {
    RandomAccessFile(File(storageDirectory, ".slax-preferences.lock"), "rw").use { file ->
      file.channel.lock().use { action() }
    }
  }
  private fun readSnapshot(): JSONObject {
    if (!preferenceFile.exists()) return JSONObject().put("revision", 0).put("values", JSONObject())
    val text = preferenceFile.readText()
    val snapshot = try { JSONObject(text) } catch (_: org.json.JSONException) { null }
    if (snapshot != null && snapshot.opt("revision") is Number && snapshot.optJSONObject("values") != null) return snapshot
    check(File(storageDirectory, ".slax-legacy-reset").exists()) { "Invalid preference storage" }
    return JSONObject().put("revision", 0).put("values", JSONObject().put("_slax_sign_out_pending_v1", true))
  }
  private fun jsonMap(json: JSONObject): Map<String, Any?> = json.keys().asSequence().associateWith { key ->
    when (val value = json.get(key)) {
      JSONObject.NULL -> null
      is JSONObject -> jsonMap(value)
      is org.json.JSONArray -> (0 until value.length()).map { value.get(it) }
      else -> value
    }
  }
  private fun releaseOwner() = synchronized(ownerMutex) {
    ownerLock?.release(); ownerFile?.close(); ownerLock = null; ownerFile = null; reset = null
  }
  private fun acquireOwner() = synchronized(ownerMutex) {
    check(ownerLock == null) { "Database ownership already held" }
    val file = RandomAccessFile(File(storageDirectory, ".slax-data-owner.lock"), "rw")
    val lock = try { file.channel.tryLock() } catch (error: Throwable) { file.close(); throw error }
    if (lock == null) { file.close(); error("Another process owns application data") }
    ownerFile = file; ownerLock = lock
  }
  override fun definition() = ModuleDefinition {
    Name("SlaxLegacy")
    Function("newIdentifier") { java.util.UUID.randomUUID().toString() }
    Function("md5String") { value: String -> MessageDigest.getInstance("MD5").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) } }
    AsyncFunction("readPreferences") { withPreferenceLock { jsonMap(readSnapshot()) } }
    AsyncFunction("compareAndSwapPreferences") { revision: Long, values: Map<String, Any?> ->
      withPreferenceLock {
        val current = readSnapshot()
        if (current.getLong("revision") != revision) false
        else {
          val next = JSONObject().put("revision", revision + 1).put("values", JSONObject(values))
          val temporary = File.createTempFile("slax-preferences-", ".tmp", storageDirectory)
          try {
            RandomAccessFile(temporary, "rw").use { file -> file.write(next.toString().toByteArray(Charsets.UTF_8)); file.fd.sync() }
            Files.move(temporary.toPath(), preferenceFile.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
          } finally { temporary.delete() }
          true
        }
      }
    }
    AsyncFunction("readLegacyPreferences") {
      val source = File(storageDirectory, "user.preferences_pb")
      if (!source.exists()) null else mapOf("bytes" to source.readBytes().map { it.toInt() and 255 })
    }
    AsyncFunction("beginDataOwnership") {
      acquireOwner()
      try {
        val root = context.dataDir.canonicalFile
        val directory = resolveDatabaseDirectory(root, storageDirectory)
        val cleanup = LegacyReset(root, storageDirectory.canonicalFile, directory)
        val cleared = withPreferenceLock { cleanup.prepare() }
        reset = cleanup
        check(directory.exists() || directory.mkdirs()) { "Cannot create database directory" }
        mapOf("legacyDataDirectory" to root.path, "newDatabaseDirectory" to directory.path, "legacyReset" to cleared)
      } catch (error: Throwable) { releaseOwner(); throw error }
    }
    AsyncFunction("finishLegacyReset") {
      synchronized(ownerMutex) {
        check(ownerLock?.isValid == true) { "Storage reset requires database ownership" }
        withPreferenceLock { reset?.finish() }
      }
    }
    AsyncFunction("endDataOwnership") { releaseOwner() }
    AsyncFunction("beginFreshDataOwnership") {
      val root = context.dataDir.canonicalFile
      val directory = resolveDatabaseDirectory(root, storageDirectory)
      check(directory.exists() || directory.mkdirs()) { "Cannot create database directory" }
      mapOf("legacyDataDirectory" to root.path, "newDatabaseDirectory" to directory.path, "legacyReset" to false)
    }
    OnDestroy { releaseOwner() }
  }
  companion object {
    private val ownerMutex = Any()
  }
}
