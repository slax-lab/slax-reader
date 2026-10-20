package com.slax.reader.platform

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import java.text.DateFormat
import java.util.Date

class SlaxReadingWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    val raw = context.getSharedPreferences("slax_widget_snapshot_v1", Context.MODE_PRIVATE).getString("snapshot", null)
    val snapshot = try { org.json.JSONObject(raw ?: "{}") } catch (_: Exception) { org.json.JSONObject() }
    val suggestions = snapshot.optJSONArray("suggestions") ?: org.json.JSONArray()
    appWidgetIds.forEach { id ->
      val minHeight = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
      val visibleRows = if (minHeight >= 160) 3 else 1
      val views = RemoteViews(context.packageName, R.layout.slax_reading_widget)
      val state = snapshot.optString("state", "signedOut")
      val count = snapshot.optInt("unreadCount", -1)
      val updatedAt = snapshot.optLong("updatedAt", 0L)
      views.setTextViewText(R.id.slax_widget_count, if (count >= 0) "$count unread" else "Your reading list")
      views.setViewVisibility(R.id.slax_widget_count, if (count >= 0) android.view.View.VISIBLE else android.view.View.GONE)
      val message = when (state) {
        "signedOut" -> "Sign in to see your reading list"
        "neutral" -> "Enable widget details in Slax Reader"
        "empty" -> "Nothing unread right now"
        else -> if (suggestions.length() == 0) "Your reading list is ready" else "Recently saved"
      }
      views.setTextViewText(R.id.slax_widget_message, message)
      views.setTextViewText(R.id.slax_widget_updated, if (updatedAt > 0) "Updated ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(updatedAt))}" else "Open Slax Reader")
      for (index in 0 until 3) {
        val row = listOf(R.id.slax_widget_row_1, R.id.slax_widget_row_2, R.id.slax_widget_row_3)[index]
        if (index < visibleRows && index < suggestions.length()) {
          val suggestion = suggestions.optJSONObject(index)
          val bookmarkId = suggestion?.optString("id").orEmpty()
          val title = suggestion?.optString("title").orEmpty()
          if (bookmarkId.isNotBlank() && title.isNotBlank()) {
            views.setViewVisibility(row, android.view.View.VISIBLE)
            views.setTextViewText(row, title)
            views.setOnClickPendingIntent(row, openBookmark(context, id, index, bookmarkId))
            continue
          }
        }
        views.setViewVisibility(row, android.view.View.GONE)
      }
      manager.updateAppWidget(id, views)
    }
  }

  private fun openBookmark(context: Context, widgetId: Int, index: Int, bookmarkId: String): PendingIntent {
    val activity = Intent().setClassName(context, "${context.packageName}.MainActivity")
      .setData(Uri.parse("slaxreader://widget?bookmarkId=${Uri.encode(bookmarkId)}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context, widgetId * 10 + index, activity,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }
}
