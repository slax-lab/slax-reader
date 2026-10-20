package com.slax.reader.platform

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

internal object SlaxWidgetSnapshotStore {
  private const val PREFS = "slax_widget_snapshot_v1"
  private const val SNAPSHOT = "snapshot"
  private const val RESERVED_VERSION = "version"
  private const val COMMITTED_VERSION = "committed_version"

  @Synchronized fun nextVersion(context: android.content.Context): Int {
    val prefs = context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
    val next = maxOf(
      prefs.getLong(RESERVED_VERSION, 0L),
      prefs.getLong(COMMITTED_VERSION, 0L),
      readVersion(prefs.getString(SNAPSHOT, null))
    ) + 1L
    check(prefs.edit().putLong(RESERVED_VERSION, next).commit()) { "Unable to persist widget snapshot version" }
    return next.toInt()
  }

  @Synchronized fun publish(context: android.content.Context, snapshot: Map<String, Any?>): Boolean {
    val version = (snapshot["version"] as? Number)?.toLong() ?: error("Missing widget snapshot version")
    require((snapshot["schemaVersion"] as? Number)?.toInt() == 1) { "Unsupported widget snapshot schema" }
    val prefs = context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
    val committed = maxOf(prefs.getLong(COMMITTED_VERSION, 0L), readVersion(prefs.getString(SNAPSHOT, null)))
    if (version <= committed || version > prefs.getLong(RESERVED_VERSION, 0L)) return false
    val serialized = org.json.JSONObject(snapshot).toString()
    check(prefs.edit().putString(SNAPSHOT, serialized).putLong(COMMITTED_VERSION, version).commit()) {
      "Unable to persist widget snapshot"
    }
    return true
  }

  private fun readVersion(serialized: String?): Long = try { org.json.JSONObject(serialized ?: "{}").optLong("version", 0L) } catch (_: Exception) { 0L }
}

class SlaxWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SlaxWidgetBridge")
    AsyncFunction("nextVersion") {
      val context = appContext.reactContext ?: error("Widget context unavailable")
      SlaxWidgetSnapshotStore.nextVersion(context)
    }
    AsyncFunction("publishSnapshot") { snapshot: Map<String, Any?> ->
      val context = appContext.reactContext ?: error("Widget context unavailable")
      SlaxWidgetSnapshotStore.publish(context, snapshot)
    }
    AsyncFunction("reloadWidgets") {
      val context = appContext.reactContext ?: error("Widget context unavailable")
      val manager = AppWidgetManager.getInstance(context)
      val component = ComponentName(context, SlaxReadingWidgetProvider::class.java)
      val ids = manager.getAppWidgetIds(component)
      if (ids.isNotEmpty()) SlaxReadingWidgetProvider().onUpdate(context, manager, ids)
    }
  }
}
