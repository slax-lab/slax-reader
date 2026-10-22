package com.slax.reader.legacy

import android.database.sqlite.SQLiteDatabase
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
  private var databaseCandidates = emptySet<String>()
  private val context get() = appContext.reactContext ?: error("Application context unavailable")
  private val storageDirectory get() = context.filesDir
  private val preferenceFile get() = File(storageDirectory, "slax.preferences.v1.json")
  private val databaseDirectory get() = File(storageDirectory, "slax-react-native")

  private fun <T> withPreferenceLock(action: () -> T): T = synchronized(File(storageDirectory, ".slax-preferences.lock").canonicalPath.intern()) {
    RandomAccessFile(File(storageDirectory, ".slax-preferences.lock"), "rw").use { file ->
      file.channel.lock().use { action() }
    }
  }
  private fun readSnapshot(): JSONObject {
    if (!preferenceFile.exists()) return JSONObject().put("revision", 0).put("values", JSONObject())
    val snapshot = JSONObject(preferenceFile.readText())
    check(snapshot.has("revision") && snapshot.optJSONObject("values") != null) { "Invalid preference storage; original file retained" }
    return snapshot
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
    ownerLock?.release(); ownerFile?.close(); ownerLock = null; ownerFile = null; databaseCandidates = emptySet()
  }
  private class SnapshotDigest {
    private val digest = MessageDigest.getInstance("SHA-256")
    fun add(value: String?) {
      if (value == null) { digest.update("-:".toByteArray(Charsets.UTF_8)); return }
      val bytes = value.toByteArray(Charsets.UTF_8)
      digest.update("${bytes.size}:".toByteArray(Charsets.UTF_8)); digest.update(bytes)
    }
    fun finish() = digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
  }
  private fun inspectDatabase(path: String, schemaOnly: Boolean = false): Map<String, Any?> = synchronized(ownerMutex) {
    check(ownerLock?.isValid == true && path in databaseCandidates && File(path).canonicalPath == path) { "Database inspection requires the exclusive inventoried owner" }
    SQLiteDatabase.openDatabase(path, null, SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS).use { db ->
      val formatVersion = db.rawQuery("SELECT ifnull(max(id),0) FROM ps_migration", null).use { cursor -> check(cursor.moveToFirst()); cursor.getInt(0) }
      val userVersion = db.rawQuery("PRAGMA user_version", null).use { cursor -> check(cursor.moveToFirst()); cursor.getInt(0) }
      val tables = db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND (name GLOB 'ps_data__*' OR name GLOB 'ps_data_local__*') ORDER BY name", null).use { cursor -> buildList { while(cursor.moveToNext()) add(cursor.getString(0)) } }
      if (schemaOnly) return@use mapOf("databasePath" to path, "formatVersion" to formatVersion, "userVersion" to userVersion, "storageTables" to tables)
      val integrityValid = db.rawQuery("PRAGMA quick_check", null).use { cursor -> cursor.moveToFirst() && cursor.getString(0) == "ok" && !cursor.moveToNext() }
      val queue = SnapshotDigest()
      var operationCount = 0; var transactionCount = 0; var previousTransaction: String? = null
      db.rawQuery("SELECT id,tx_id,data FROM ps_crud ORDER BY id", null).use { cursor ->
        while (cursor.moveToNext()) {
          val transaction = if(cursor.isNull(1)) null else cursor.getString(1)
          if (operationCount == 0 || transaction != previousTransaction) transactionCount++
          previousTransaction = transaction; operationCount++
          queue.add(cursor.getString(0)); queue.add(transaction); queue.add(cursor.getString(2))
          val data = JSONObject(cursor.getString(2))
          check(data.optString("id").isNotEmpty() && data.optString("type").isNotEmpty() && data.optString("op") in listOf("PUT", "PATCH", "DELETE")) { "Invalid pending operation" }
        }
      }
      val data = SnapshotDigest(); val local = SnapshotDigest()
      for (table in tables) {
        data.add(table); if(table.startsWith("ps_data_local__")) local.add(table)
        val quoted = table.replace("\"", "\"\"")
        db.rawQuery("SELECT id,data FROM \"$quoted\" ORDER BY id COLLATE BINARY", null).use { cursor ->
          while(cursor.moveToNext()) {
            val id = cursor.getString(0); val json = cursor.getString(1)
            JSONObject(json) // Validate the complete underlying row while retaining every unknown JSON field.
            data.add(id); data.add(json)
            if(table.startsWith("ps_data_local__")) {local.add(id); local.add(json)}
          }
        }
      }
      mapOf("databasePath" to path, "integrityValid" to integrityValid, "formatVersion" to formatVersion, "userVersion" to userVersion, "storageTables" to tables, "pendingOperations" to operationCount, "pendingTransactions" to transactionCount, "queueDigest" to queue.finish(), "dataDigest" to data.finish(), "localDigest" to local.finish())
    }
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
      if (!source.exists()) null
      else {
        val bytes = source.readBytes()
        mapOf("bytes" to bytes.map { it.toInt() and 255 }, "fingerprint" to MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) })
      }
    }
    AsyncFunction("beginDataOwnership") {
      synchronized(ownerMutex) {
        check(ownerLock == null) { "Database ownership already held" }
        val file = RandomAccessFile(File(storageDirectory, ".slax-data-owner.lock"), "rw")
        val lock = try { file.channel.tryLock() } catch (error: Throwable) { file.close(); throw error }
        if (lock == null) { file.close(); error("Another process owns application data") }
        ownerFile = file; ownerLock = lock
      }
      try {
        val root = context.dataDir.canonicalFile
        val newDirectory = databaseDirectory.absoluteFile
        check(newDirectory.canonicalFile == newDirectory && newDirectory.path.startsWith(root.path + File.separator)) { "Database directory requires recovery" }
        val values = withPreferenceLock { readSnapshot().getJSONObject("values") }
        val known = installationDatabase(values, root, newDirectory, context.packageName, storageDirectory)
        val candidates = mutableListOf<String>()
        fun scan(directory: File, depth: Int) {
          check(depth <= 32) { "Database inventory is incomplete" }
          val children = directory.listFiles() ?: error("Cannot inspect existing data directory")
          for (child in children) {
            if (child.canonicalFile != child.absoluteFile || child.canonicalFile == newDirectory) continue
            if (child.isDirectory) scan(child, depth + 1)
            else if (child.name == "powersync.db") candidates.add(child.canonicalPath)
          }
        }
        if (known == null) scan(root, 0) else if (known.mode == "adopted") candidates.add(known.path)
        check(newDirectory.exists() || newDirectory.mkdirs()) { "Cannot create database directory" }
        val allowed = (candidates + File(newDirectory, "powersync.db").path).distinct()
        synchronized(ownerMutex) { databaseCandidates = allowed.toSet() }
        val identities = allowed.associateWith { path ->
          mapOf("owner" to "android:${context.packageName}:${storageDirectory.canonicalPath}", "relativePath" to File(path).relativeTo(root).path)
        }
        val inventory = mutableMapOf<String, Any>("scanComplete" to true, "databaseCandidates" to candidates.distinct(), "legacyDataDirectory" to root.path, "newDatabaseDirectory" to newDirectory.path, "databaseIdentities" to identities)
        if (known?.initialized == true) inventory["initializedDatabase"] = mapOf("path" to known.path, "mode" to known.mode)
        inventory
      } catch (error: Throwable) { releaseOwner(); throw error }
    }
    AsyncFunction("endDataOwnership") { releaseOwner() }
    AsyncFunction("beginFreshDataOwnership") {
      // Development storage intentionally skips the exclusive ownership lease so a JS reload can reopen it.
      try {
        val root = context.dataDir.canonicalFile
        val newDirectory = databaseDirectory.absoluteFile
        check(newDirectory.canonicalFile == newDirectory && newDirectory.path.startsWith(root.path + File.separator)) { "Database directory requires recovery" }
        check(newDirectory.exists() || newDirectory.mkdirs()) { "Cannot create database directory" }
        val path = File(newDirectory, "powersync.db").path
        synchronized(ownerMutex) { databaseCandidates = setOf(path) }
        mapOf("scanComplete" to true, "databaseCandidates" to emptyList<String>(), "legacyDataDirectory" to root.path, "newDatabaseDirectory" to newDirectory.path)
      } catch (error: Throwable) { throw error }
    }
    AsyncFunction("inspectLegacyDatabase") { path: String -> inspectDatabase(path) }
    AsyncFunction("inspectAcceptedDatabase") { path: String -> inspectDatabase(path, true) }
    OnDestroy { releaseOwner() }
  }
  companion object {
    private val ownerMutex = Any()
  }
}
