package com.slax.reader.extension

import android.app.Activity
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import java.io.File
import java.io.RandomAccessFile
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import okhttp3.EventListener
import org.json.JSONObject

/** Standalone inbound share UI; never boots React Native or a second PowerSync owner. */
class ShareActivity : Activity() {
  private val executor = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private val requestMutex = Any()
  @Volatile private var active = true
  private var connection: ShareSaveTransport? = null
  private var diagnostics: ShareDiagnostics? = null
  private lateinit var card: LinearLayout
  private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    diagnostics = ShareDiagnostics.create(this)
    window.statusBarColor = Color.TRANSPARENT; window.navigationBarColor = Color.TRANSPARENT
    val frame = FrameLayout(this).apply { setBackgroundColor(Color.TRANSPARENT); setOnClickListener { dismiss() } }
    card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(24), dp(32), dp(24), dp(48)); isClickable = true
      // The source uses default light MaterialTheme even in system dark mode.
      // Pinned Material3 1.4 filled Card uses SurfaceContainerHighest (Neutral90).
      background = GradientDrawable().apply {setColor(Color.rgb(230, 224, 233)); cornerRadii = floatArrayOf(dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), 0f, 0f, 0f, 0f)}
    }
    frame.addView(card, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
    card.addView(ProgressBar(this).apply {indeterminateTintList = ColorStateList.valueOf(Color.rgb(103, 80, 164))}, LinearLayout.LayoutParams(dp(56), dp(56)))
    card.addView(label("Collecting", Color.rgb(29, 27, 32)), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {topMargin = dp(24)})
    setContentView(frame)
    card.post {card.translationY = card.height.toFloat(); card.animate().translationY(0f).setDuration(300).start()}
    executor.execute {
      val result = try {processShare()} catch (error: SocketTimeoutException) {diagnostics?.failure(error); "Request timed out, please try again."} catch (error: UnknownHostException) {diagnostics?.failure(error); "Network unavailable, please check your connection."} catch (error: Exception) {diagnostics?.failure(error); "Collection failed, please try again."}
      main.post {if (active && !isFinishing && !isDestroyed) {diagnostics?.finish(result); showResult(result)}}
    }
  }
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    cancelRequest()
    main.removeCallbacksAndMessages(null)
    finish()
    startActivity(Intent(intent).setClass(this, ShareActivity::class.java))
  }
  private fun label(value: String, color: Int) = TextView(this).apply {
    text = value; textSize = 16f; setTextColor(color); gravity = Gravity.CENTER; includeFontPadding = false
    letterSpacing = 0.5f / 16f
    setLineSpacing(resources.displayMetrics.scaledDensity * 24f - paint.fontSpacing, 1f)
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
  }
  private fun showResult(result: String) {
    card.removeAllViews()
    val success = result == "ok"
    val color = if (success) Color.rgb(22, 185, 152) else Color.rgb(244, 67, 54)
    val icon = label(if (success) "✓" else "X", Color.WHITE).apply {
      textSize = 32f; letterSpacing = 0f; setLineSpacing(resources.displayMetrics.scaledDensity * 40f - paint.fontSpacing, 1f)
      background = GradientDrawable().apply {shape = GradientDrawable.OVAL; setColor(color)}
      contentDescription = if (success) "Success" else "Failed"
    }
    card.addView(icon, LinearLayout.LayoutParams(dp(72), dp(72)))
    card.addView(label(if (success) "Success!" else result, color), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {topMargin = dp(20)})
    icon.scaleX = 0.1f; icon.scaleY = 0.1f; icon.animate().scaleX(1f).scaleY(1f).setDuration(400).start()
    card.performHapticFeedback(if (android.os.Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.LONG_PRESS)
    if (success) main.postDelayed({dismiss()}, 2000)
  }
  private fun readPreferences(): JSONObject = synchronized(File(filesDir, ".slax-preferences.lock").canonicalPath.intern()) {
    RandomAccessFile(File(filesDir, ".slax-preferences.lock"), "rw").use { lockFile ->
      lockFile.channel.lock().use {
        val current = File(filesDir, "slax.preferences.v1.json")
        if (File(filesDir, ".slax-legacy-reset").exists()) JSONObject()
        else if (current.exists()) {diagnostics?.store("v1"); JSONObject(current.readText()).getJSONObject("values")}
        else {
          val legacy = File(filesDir, "user.preferences_pb")
          if (legacy.exists()) {diagnostics?.store("legacy"); JSONObject(LegacyStringPreferences.decode(legacy.readBytes()))} else JSONObject()
        }
      }
    }
  }
  private fun result(reason: String, message: String): String {diagnostics?.reason(reason); return message}
  private fun processShare(): String {
    if (intent.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) return result("unsupported_intent", "Not support content")
    diagnostics?.stage("extract")
    val content = intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf {it.isNotEmpty()} ?: return result("empty_text", "Not have share content")
    val url = Regex("^((https|http)?://)[^\\s]+").find(content)?.value ?: return result("no_url_found", "Not have URL content to collect.")
    diagnostics?.url(url); diagnostics?.stage("prefs")
    val values = readPreferences()
    diagnostics?.preferences(values); diagnostics?.stage("auth")
    if (values.optBoolean("_slax_sign_out_pending_v1", false)) return result("signed_out", "Not have auth info, please login first.")
    val token = values.optString("auth_token").takeIf {it.isNotEmpty()} ?: return result("no_token", "Not have auth info, please login first.")
    val metadata = packageManager.getApplicationInfo(packageName, android.content.pm.PackageManager.GET_META_DATA).metaData
    val base = metadata.getString(if (values.optString("selected_env") == "BETA") "SlaxApiBetaURL" else "SlaxApiBaseURL") ?: return result("endpoint_missing", "Collection failed, please try again.")
    val version = "${metadata.get("SlaxVersionName")} (${metadata.get("SlaxVersionCode")})"
    diagnostics?.stage("request"); diagnostics?.captureNetwork()
    val start = System.nanoTime()
    val request = ShareSaveTransport(
      listener = diagnostics?.let {ShareNetworkListener(it.timings)} ?: EventListener.NONE,
      onResponse = {code, body, cfRay -> diagnostics?.stage("response"); diagnostics?.http(code, body, cfRay)},
      onFailure = {diagnostics?.failure(it)},
      onCreateFinished = {diagnostics?.requestFinished()},
    )
    synchronized(requestMutex) {
      if (!active) {request.cancel(); throw CancellationException("Share dismissed")}
      connection = request
    }
    try {
      val result = request.save(base, token, version, url, intent.getStringExtra(Intent.EXTRA_SUBJECT))
      diagnostics?.reason(result.reason)
      report(result.message == "ok", version, (System.nanoTime() - start) / 1_000_000.0)
      return result.message
    } catch (error: Exception) {report(false, version, null); throw error}
    finally {request.cancel(); synchronized(requestMutex) {if (connection === request) connection = null}}
  }
  private fun report(success: Boolean, version: String, duration: Double?) {
    if (!active) return
    // Firebase is supplied by the explicitly approved application integration, not a new library dependency.
    runCatching {
      val type = Class.forName("com.google.firebase.analytics.FirebaseAnalytics")
      val analytics = type.getMethod("getInstance", android.content.Context::class.java).invoke(null, this)
      val properties = Bundle().apply {putString("status", if (success) "success" else "failed"); putString("method", "share_extension"); putString("channel", "app"); putString("platform", "app"); putString("platform_type", "android"); putString("version", version); if (duration != null) putString("duration", "${duration}ms")}
      type.getMethod("logEvent", String::class.java, Bundle::class.java).invoke(analytics, "bookmark_add_start", properties)
    }
  }
  private fun cancelRequest() {
    synchronized(requestMutex) {active = false; connection?.cancel(); diagnostics?.finish(); connection = null}
  }
  private fun dismiss() {if (!active || isFinishing) return; cancelRequest(); card.animate().translationY(card.height.toFloat()).setDuration(250).withEndAction {finish()}.start()}
  override fun onDestroy() {cancelRequest(); main.removeCallbacksAndMessages(null); executor.shutdownNow(); diagnostics?.shutdown(); super.onDestroy()}
}

private object LegacyStringPreferences {
  private class Reader(val bytes: ByteArray) {
    var offset = 0
    val done get() = offset == bytes.size
    fun integer(): Long {
      var result = 0L
      for (shift in 0..63 step 7) {check(offset < bytes.size); val byte = bytes[offset++].toInt() and 255; result = result or ((byte and 127).toLong() shl shift); if (byte and 128 == 0) return result}
      error("Corrupt legacy preferences")
    }
    fun data(): ByteArray {val count = integer(); check(count >= 0 && count <= bytes.size - offset); val end = offset + count.toInt(); val result = bytes.copyOfRange(offset, end); offset = end; return result}
    fun skip(wire: Int) {when (wire) {0 -> integer(); 2 -> data(); 1, 5 -> {offset += if (wire == 1) 8 else 4; check(offset <= bytes.size)}; else -> error("Corrupt legacy preferences")}}
  }
  fun decode(bytes: ByteArray): Map<String, String> {
    val root = Reader(bytes)
    val result = mutableMapOf<String, String>()
    while (!root.done) {
      val tag = root.integer().toInt()
      if (tag != 10) {root.skip(tag and 7); continue}
      val entry = Reader(root.data()); var key: String? = null; var value: String? = null
      while (!entry.done) {val field = entry.integer().toInt(); when (field) {10 -> key = entry.data().toString(Charsets.UTF_8); 18 -> {val nested = Reader(entry.data()); while (!nested.done) {val next = nested.integer().toInt(); if (next == 42) value = nested.data().toString(Charsets.UTF_8) else nested.skip(next and 7)}}; else -> entry.skip(field and 7)}}
      if (key != null && value != null) result[key] = value
    }
    return result
  }
}
