const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, writeFileSync, rmSync, readdirSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {homedir, tmpdir} = require('node:os');
const path = require('node:path');

function cachedJson() {
  const base = path.join(homedir(), '.gradle/caches/modules-2/files-2.1/org.json/json/20180813');
  try {
    const jars = readdirSync(base).flatMap(hash => readdirSync(path.join(base, hash)).filter(file => file.endsWith('.jar') && !file.includes('sources')).map(file => path.join(base, hash, file)));
    return jars.length === 1 ? jars[0] : null;
  } catch {return null;}
}
const json = process.env.SLAX_JSON_CLASSPATH ?? cachedJson();

test('actual Kotlin diagnostic records and writer retain bounded private terminals with hostile sender metadata', {skip: !json && 'Supply SLAX_JSON_CLASSPATH or populate the public org.json Gradle cache'}, () => {
  const output = mkdtempSync(path.join(tmpdir(), 'slax-share-android-diagnostics-'));
  try {
    const fixtures = {
      'Context.kt': `package android.content
import java.io.File
open class Context(val filesDir: File) {
  fun getSystemService(name: String): Any? = null
  companion object {const val CONNECTIVITY_SERVICE = "connectivity"}
}
class Intent(val action: String? = "android.intent.action.SEND", val type: String? = "text/plain") {
  private val extras = mutableMapOf<String, String>()
  fun getStringExtra(key: String): String? = extras[key]
  fun putExtra(key: String, value: String): Intent = apply {extras[key] = value}
  companion object {const val EXTRA_REFERRER = "referrer"; const val EXTRA_TEXT = "text"; const val EXTRA_SUBJECT = "subject"}
}
`,
      'Activity.kt': `package android.app
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import java.io.File
class Activity(directory: File, val intent: Intent, val referrer: Uri?) : Context(directory) {
  val packageManager = PackageManager()
  val packageName = "com.slax.reader.fixture"
}
`,
      'PackageManager.kt': `package android.content.pm
import android.os.Bundle
class PackageManager {
  fun getApplicationInfo(name: String, flags: Int) = ApplicationInfo()
  companion object {const val GET_META_DATA = 128}
}
class ApplicationInfo {val metaData = Bundle()}
`,
      'Bundle.kt': `package android.os
class Bundle {
  fun getString(key: String): String? = when (key) {
    "SlaxVersionName" -> "1.0.0"
    "SlaxApiBaseURL", "SlaxApiBetaURL" -> "https://api.fixture.example"
    else -> null
  }
  fun getInt(key: String) = 1
}
object Build {object VERSION {const val RELEASE = "fixture"}}
`,
      'Network.kt': `package android.net
class Uri(val host: String?)
class ConnectivityManager {
  val activeNetwork: Any? = null
  fun getNetworkCapabilities(network: Any?): NetworkCapabilities? = null
}
class NetworkCapabilities {
  fun hasTransport(transport: Int) = false
  fun hasCapability(capability: Int) = false
  companion object {const val TRANSPORT_WIFI = 1; const val TRANSPORT_CELLULAR = 2; const val NET_CAPABILITY_VALIDATED = 3; const val NET_CAPABILITY_NOT_METERED = 4}
}
`,
      'ShareNetworkTimings.kt': `package com.slax.reader.extension
import org.json.JSONObject
class ShareNetworkTimings {
  fun snapshot(cancelled: Boolean, now: Long) = JSONObject().field("total", null)
  fun error(): JSONObject? = null
}
`,
      'Host.kt': String.raw`package com.slax.reader.extension
import android.app.Activity
import android.content.Intent
import android.net.Uri
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit
import org.json.JSONObject

fun main(args: Array<String>) {
  val privateUrl = "https://fixture.example/private/article?secret=hidden#private-fragment"
  val privateTitle = "private-document-title"
  val privateToken = "synthetic-private-token-1234"
  val privateBody = "synthetic-private-response-body"
  val hugeHost = "a".repeat(10000) + ".example"
  val hugeUrl = "https://$hugeHost/private/article?secret=hidden"
  val badReferrers = listOf("", hugeHost, privateUrl, "sender?token=hidden", "sender/path", "sender@private.example", "sender\nprivate", "漢".repeat(5000), "bad:host", "[not:ipv6]", "[::1]/private")
  val hosts = listOf("com.example.sender", "fixture.example", "127.0.0.1", "[2001:db8::1]", "2001:db8::1", "[::ffff:192.0.2.1]")
  for (host in hosts) {
    check(ShareDiagnosticRecord.host(host) == host)
    check(ShareDiagnosticRecord.input(null, null, null, null, host).getString("referrer") == host)
  }
  for (referrer in badReferrers) {
    check(ShareDiagnosticRecord.host(referrer) == null)
    check(ShareDiagnosticRecord.input(null, null, null, null, referrer).isNull("referrer"))
  }
  check(ShareDiagnosticRecord.host("a".repeat(255))?.length == 255)
  check(ShareDiagnosticRecord.host("a".repeat(256)) == null)
  for (host in listOf("fixture.example", "127.0.0.1", "[2001:db8::1]", "[::ffff:192.0.2.1]")) {
    val url = "https://$host/private/article?secret=hidden"
    val metadata = ShareDiagnosticRecord.url(url)
    check(metadata.getString("host") == host && metadata.getString("scheme") == "https")
    check(metadata.getInt("length") == url.length)
  }
  check(ShareDiagnosticRecord.url(hugeUrl).isNull("host"))
  check(ShareDiagnosticRecord.url(hugeUrl).getInt("length") == hugeUrl.length)
  check(ShareDiagnosticRecord.url("x".repeat(10000) + "://fixture.example/private").isNull("scheme"))
  val longPath = "https://fixture.example/" + "x".repeat(10000)
  check(ShareDiagnosticRecord.url(longPath).getString("host") == "fixture.example")

  val record = ShareDiagnosticRecord("1.0.0 (1)", "Android fixture", 0, 0) {0}
  record.host = privateUrl; check(record.host == null)
  record.host = hugeHost; check(record.host == null)
  record.host = "api.fixture.example"; check(record.host == "api.fixture.example")
  record.moveTo("extract", 1_000_000); record.moveTo("prefs", 11_000_000); record.moveTo("request", 21_000_000)
  record.reason = "network_timeout"
  record.input = ShareDiagnosticRecord.input("android.intent.action.SEND", "text/plain", privateUrl, privateTitle, hugeHost)
  record.input.put("url", ShareDiagnosticRecord.url(hugeUrl))
  record.token = ShareDiagnosticRecord.token(privateToken)
  record.http = ShareDiagnosticRecord.http(400, JSONObject().put("message", privateBody).toString(), null)
  val terminal = record.end("failed", "Request timed out, please try again.", JSONObject(), 51_000_000, 1000)
  val ordinary = ShareDiagnosticRecord.line(terminal)!!
  check(ordinary.size <= 4096 && ordinary.last() == 10.toByte())
  val normal = JSONObject(String(ordinary, Charsets.UTF_8))
  check(normal.getJSONObject("ms").getLong("extract") == 10L)
  check(normal.getJSONObject("ms").getLong("prefs") == 10L)
  check(normal.getJSONObject("ms").getLong("request") == 30L)
  check(normal.getJSONObject("ms").getLong("total") == 51L)
  check(normal.getJSONObject("input").isNull("referrer"))
  for (secret in listOf(privateUrl, hugeUrl, privateTitle, privateToken, privateBody, "/private/article", "secret=hidden")) check(!String(ordinary, Charsets.UTF_8).contains(secret))

  terminal.getJSONObject("input").put("referrer", privateUrl.repeat(1000))
  terminal.put("net", JSONObject().put("protocol", "漢".repeat(5000)))
  terminal.put("app", "界".repeat(5000)).put("os", "界".repeat(5000))
  check((terminal.toString() + "\n").toByteArray().size > 4096)
  val compactLine = ShareDiagnosticRecord.line(terminal)!!
  check(compactLine.size <= 4096 && compactLine.last() == 10.toByte())
  val compact = JSONObject(String(compactLine, Charsets.UTF_8))
  for (key in listOf("v", "ts", "src", "launch", "event", "share", "outcome", "stage", "reason", "env", "ms", "shown")) check(compact.get(key).toString() == terminal.get(key).toString())
  check(compact.getString("app").length == 64 && compact.getString("os").length == 64)
  for (key in listOf("input", "prefs", "token", "host", "http", "error", "net")) check(compact.isNull(key))
  check(terminal.getJSONObject("input").getString("referrer").length > 4096)
  for (secret in listOf(privateUrl, privateToken, privateBody, "/private/article", "secret=hidden")) check(!String(compactLine, Charsets.UTF_8).contains(secret))
  check(ShareDiagnosticRecord.line(JSONObject().put("x", "x".repeat(4087)))!!.size == 4096)
  check(ShareDiagnosticRecord.line(JSONObject().put("x", "x".repeat(4088))) == null)

  var runs = 0
  fun persisted(activityReferrer: String?, extraReferrer: String?, url: String, result: String?, oversized: Boolean = false): JSONObject {
    val directory = File(args[0], "case-" + runs++).apply {mkdirs()}
    val intent = Intent().putExtra(Intent.EXTRA_TEXT, privateUrl).putExtra(Intent.EXTRA_SUBJECT, privateTitle)
    if (extraReferrer != null) intent.putExtra(Intent.EXTRA_REFERRER, extraReferrer)
    val activity = Activity(directory, intent, activityReferrer?.let {Uri(it)})
    val diagnostics = ShareDiagnostics.create(activity)!!
    diagnostics.stage("extract"); diagnostics.url(url); diagnostics.stage("prefs")
    diagnostics.preferences(JSONObject().put("auth_token", privateToken))
    diagnostics.http(400, JSONObject().put("message", privateBody).toString(), null)
    diagnostics.stage("request"); diagnostics.reason("network_timeout")
    if (oversized) diagnostics.store("漢".repeat(5000))
    diagnostics.finish(result); diagnostics.finish("ok"); diagnostics.shutdown()
    val executorField = diagnostics.javaClass.getDeclaredField("executor").apply {isAccessible = true}
    check((executorField.get(diagnostics) as ExecutorService).awaitTermination(5, TimeUnit.SECONDS))
    val files = File(directory, "diagnostics").listFiles()!!
    check(files.size == 1)
    val contents = files.single().readText()
    check(contents.endsWith("\n"))
    val lines = contents.lineSequence().filter {it.isNotEmpty()}.toList()
    check(lines.size == 2)
    for (line in lines) check((line + "\n").toByteArray(Charsets.UTF_8).size <= 4096)
    val start = JSONObject(lines[0]); val end = JSONObject(lines[1])
    check(start.getString("event") == "share.start" && end.getString("event") == "share.end")
    check(start.getString("share") == end.getString("share") && end.getString("share") == end.getString("launch"))
    check(end.getString("src") == "share-android" && end.getInt("v") == 1)
    check(end.getString("outcome") == when (result) {null -> "dismissed"; "ok" -> "success"; else -> "failed"})
    check(end.getString("reason") == when (result) {null -> "cancelled"; "ok" -> "success"; else -> "network_timeout"})
    check(end.getString("stage") == if (result == "ok") "done" else "request")
    check(end.getString("shown") == when (result) {null -> "Collecting"; "ok" -> "Success!"; else -> result})
    for (key in listOf("extract", "prefs", "request", "total")) check(end.getJSONObject("ms").getLong(key) >= 0)
    for (secret in listOf(privateUrl, hugeUrl, privateTitle, privateToken, privateBody, "/private/article", "secret=hidden")) check(!contents.contains(secret))
    return end
  }
  for (referrer in badReferrers) {
    check(persisted(referrer, "fallback.example", hugeUrl, "Request timed out, please try again.").getJSONObject("input").isNull("referrer"))
    check(persisted(null, referrer, hugeUrl, "Request timed out, please try again.").getJSONObject("input").isNull("referrer"))
  }
  for (host in hosts) {
    check(persisted(host, null, privateUrl, "ok").getJSONObject("input").getString("referrer") == host)
    check(persisted(null, host, privateUrl, "ok").getJSONObject("input").getString("referrer") == host)
  }
  for (result in listOf(null, "ok", "Request timed out, please try again.")) {
    val end = persisted(hugeHost, null, hugeUrl, result, oversized = true)
    check(end.isNull("input"))
  }
  println("Kotlin diagnostic boundary and persisted terminal checks passed: $runs writer scenarios")
}
`,
    };
    for (const [name, contents] of Object.entries(fixtures)) writeFileSync(path.join(output, name), contents);
    const sources = ['ShareDiagnosticRecord.kt', 'ShareDiagnostics.kt'].map(name => path.resolve(__dirname, '../../../modules/slax-share/android/src/main/java/com/slax/reader/extension', name));
    const jar = path.join(output, 'host.jar');
    execFileSync(process.env.SLAX_KOTLINC ?? 'kotlinc', ['-classpath', json, '-include-runtime', '-d', jar, ...sources, ...Object.keys(fixtures).map(name => path.join(output, name))], {encoding: 'utf8', timeout: 120000});
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java';
    assert.match(execFileSync(java, ['-cp', [jar, json].join(path.delimiter), 'com.slax.reader.extension.HostKt', output], {encoding: 'utf8', timeout: 30000}), /Kotlin diagnostic boundary and persisted terminal checks passed: 37 writer scenarios/);
  } finally {rmSync(output, {recursive: true, force: true});}
});
