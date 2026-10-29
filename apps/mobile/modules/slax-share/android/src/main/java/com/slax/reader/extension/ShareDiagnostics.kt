package com.slax.reader.extension

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.UnknownHostException
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import javax.net.ssl.SSLException
import org.json.JSONObject

internal class ShareDiagnostics private constructor(private val activity: Activity, started: Long, wallTime: Long) {
  private val executor = Executors.newSingleThreadExecutor()
  private val mutex = Any()
  private var terminal = false
  private var metadata: Bundle? = null
  private var record: ShareDiagnosticRecord? = null
  private var directory: File? = null
  private var network: JSONObject? = null
  val timings by lazy {ShareNetworkTimings()}
  init {
    execute {
      metadata = activity.packageManager.getApplicationInfo(activity.packageName, PackageManager.GET_META_DATA).metaData
      directory = File(activity.filesDir, "diagnostics")
      record = ShareDiagnosticRecord("${metadata?.getString("SlaxVersionName")} (${metadata?.getInt("SlaxVersionCode")})", "Android ${Build.VERSION.RELEASE}", started, wallTime)
      record?.let {write(it.start()); captureInput(it)}
      captureNetworkNow()
    }
  }
  private fun execute(block: () -> Unit) {try {executor.execute {try {block()} catch (_: Throwable) {}}} catch (_: Throwable) {}}
  private fun update(block: (ShareDiagnosticRecord) -> Unit) {try {synchronized(mutex) {if (!terminal) execute {record?.let(block)}}} catch (_: Throwable) {}}
  fun stage(value: String) {val now = System.nanoTime(); update {it.moveTo(value, now)}}
  private fun captureInput(record: ShareDiagnosticRecord) {
    try {
      val intent = activity.intent
      val referrer = runCatching {activity.referrer?.host}.getOrNull() ?: runCatching {intent.getStringExtra(Intent.EXTRA_REFERRER)}.getOrNull()
      record.input = ShareDiagnosticRecord.input(intent.action, intent.type, intent.getStringExtra(Intent.EXTRA_TEXT), intent.getStringExtra(Intent.EXTRA_SUBJECT), referrer)
    } catch (_: Throwable) {}
  }
  fun url(value: String) = update {it.input.put("url", ShareDiagnosticRecord.url(value))}
  fun store(value: String) = update {it.prefs.put("store", value)}
  fun preferences(values: JSONObject) = update {
    it.prefs.put("signOutPending", values.optBoolean("_slax_sign_out_pending_v1", false))
    it.token = ShareDiagnosticRecord.token(values.optString("auth_token"))
    it.env = values.optString("selected_env").takeIf {value -> value == "BETA" || value == "PRODUCTION"} ?: "default"
    val base = metadata?.getString(if (it.env == "BETA") "SlaxApiBetaURL" else "SlaxApiBaseURL")
    it.host = base?.let {value -> runCatching {URI(value).host}.getOrNull()}
  }
  fun reason(value: String) = update {it.reason = value}
  fun http(status: Int, body: String?, cfRay: String?) = update {it.http = ShareDiagnosticRecord.http(status, body, cfRay)}
  fun failure(error: Exception) = update {
    it.error = JSONObject().put("class", error.javaClass.simpleName)
    it.reason = when {
      it.stage == "prefs" -> {it.prefs.put("error", error.javaClass.simpleName); if (error is IOException) "prefs_unavailable" else "prefs_corrupt"}
      error is CancellationException -> "cancelled"
      error is SocketTimeoutException -> "network_timeout"
      error is UnknownHostException -> "network_dns"
      error is SSLException -> "network_tls"
      error is IOException && network?.isNull("transport") == true && network?.isNull("validated") == false -> "network_offline"
      else -> "network_other"
    }
  }
  fun captureNetwork() = update {captureNetworkNow()}
  private fun captureNetworkNow() {
    try {
      val manager = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
      val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
      val snapshot = JSONObject().field("transport", capabilities?.let {when {it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"; it.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"; else -> "other"}})
        .put("validated", capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ?: false).field("metered", capabilities?.let {!it.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)})
      synchronized(mutex) {network = snapshot}
    } catch (_: SecurityException) {} catch (_: Throwable) {}
  }
  fun finish(result: String? = null) {
    val now = System.nanoTime(); val wallTime = System.currentTimeMillis()
    try {
      synchronized(mutex) {
        if (terminal) return
        terminal = true
        execute {
          val record = record ?: return@execute
          val outcome = if (result == null) "dismissed" else if (result == "ok") "success" else "failed"
          if (result == null) record.reason = "cancelled"
          if (result == "ok") {record.reason = "success"; record.moveTo("done", now)}
          val net = timings.snapshot(result == null, now)
          for (key in listOf("transport", "validated", "metered")) net.field(key, network?.opt(key))
          if (record.error == null) record.error = timings.error()
          write(record.end(outcome, if (result == "ok") "Success!" else result ?: "Collecting", net, now, wallTime))
        }
      }
    } catch (_: Throwable) {}
  }
  private fun write(value: JSONObject) {
    try {
      val bytes = ShareDiagnosticRecord.line(value) ?: return
      val date = value.getString("ts").take(10)
      synchronized(writeMutex) {
        if (writeFailures >= 3) return
        val directory = directory ?: return
        directory.mkdirs()
        val file = File(directory, "$date.share-android.ndjson")
        if (file.length() >= ShareDiagnosticRecord.DAILY_ALLOWANCE) return
        FileOutputStream(file, true).use {it.write(bytes)}
        if (file.length() >= ShareDiagnosticRecord.DAILY_ALLOWANCE) {
          val marker = JSONObject().put("v", 1).put("ts", ShareDiagnosticRecord.timestamp()).put("src", "share-android").put("launch", value.getString("launch")).put("event", "log.truncated")
          ShareDiagnosticRecord.line(marker)?.let {line -> FileOutputStream(file, true).use {it.write(line)}}
        }
        writeFailures = 0
      }
    } catch (_: Throwable) {synchronized(writeMutex) {writeFailures++}}
  }
  fun shutdown() {try {synchronized(mutex) {executor.shutdown()}} catch (_: Throwable) {}}
  companion object {
    private val writeMutex = Any()
    private var writeFailures = 0
    fun create(activity: Activity): ShareDiagnostics? {
      val started = System.nanoTime(); val wallTime = System.currentTimeMillis()
      return try {ShareDiagnostics(activity, started, wallTime)} catch (_: Throwable) {null}
    }
  }
}
