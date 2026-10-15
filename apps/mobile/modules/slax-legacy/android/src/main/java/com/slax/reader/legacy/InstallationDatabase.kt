package com.slax.reader.legacy

import java.io.File
import org.json.JSONObject

internal data class KnownInstallationDatabase(val path: String, val mode: String, val initialized: Boolean)

internal fun installationDatabase(values: JSONObject, root: File, newDirectory: File, packageName: String, filesDirectory: File): KnownInstallationDatabase? {
  val key = "_slax_database_installation_v1"
  val initialized = values.has(key)
  val raw = if (initialized) values.getString(key) else values.optString("_slax_database_adoption_v1").takeIf { it.isNotEmpty() } ?: return null
  val record = try { JSONObject(raw) } catch (error: Exception) {
    if (initialized) throw IllegalStateException("Database initialization record requires recovery", error)
    return null
  }
  if (!initialized && (record.optString("phase") != "accepted" || record.optString("profile") != "slax-powersync-format14-schema2-v1" || record.optString("targetSdk") != "powersync-react-native-2.3.1" || record.optString("schemaVersion") != "2")) return null
  val mode = if (initialized) record.optString("mode") else "adopted"
  val identity = record.optJSONObject(if (initialized) "identity" else "logicalIdentity")
  val expected = if (mode == "native") File(newDirectory, "powersync.db") else File(root, "databases/powersync.db")
  val expectedOwner = "android:$packageName:${filesDirectory.canonicalPath}"
  val relative = expected.relativeTo(root).path
  val profile = if (mode == "native") "slax-native-format14-schema2-v1" else "slax-powersync-format14-schema2-v1"
  val valid = mode in listOf("native", "adopted") && record.optString("path") == expected.absolutePath && expected.canonicalFile == expected.absoluteFile && expected.isFile &&
    identity != null && identity.optString("owner") == expectedOwner && identity.optString("relativePath") == relative && !identity.has("relocationPrefix") &&
    (!initialized || record.optInt("version") == 1 && record.optString("state") == "ready" && record.optString("targetSdk") == "powersync-react-native-2.3.1" && record.optString("schemaVersion") == "2" && record.optString("profile") == profile)
  if (!valid) {
    if (initialized) error("The established database identity requires recovery")
    return null
  }
  return KnownInstallationDatabase(expected.path, mode, initialized)
}
