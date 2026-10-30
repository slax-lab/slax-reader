package com.slax.reader.extension

import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import okhttp3.Call
import okhttp3.Connection
import okhttp3.EventListener
import okhttp3.Handshake
import okhttp3.Protocol
import okhttp3.Request
import org.json.JSONObject

internal class ShareNetworkTimings(private val clock: () -> Long = System::nanoTime) {
  private val starts = mutableMapOf<String, Long>()
  private val durations = mutableMapOf<String, Long>()
  private var started: Long? = null
  private var ended: Long? = null
  private var phase: String? = null
  private var failedIn: String? = null
  private var connected = false
  private var reused: Boolean? = null
  private var proxy: Boolean? = null
  private var protocol: String? = null
  private var tlsVersion: String? = null
  private fun begin(name: String, now: Long) {starts[name] = now; phase = name}
  private fun end(name: String, now: Long) {starts.remove(name)?.let {durations[name] = (durations[name] ?: 0L) + ((now - it) / 1_000_000).coerceAtLeast(0)}; if (phase == name) phase = null}
  @Synchronized fun event(name: String) {
    val now = clock()
    when (name) {
      "callStart" -> started = now
      "dnsStart" -> begin("dns", now)
      "dnsEnd" -> end("dns", now)
      "connectStart" -> {connected = true; starts.clear(); failedIn = null; errorClass = null; begin("connect", now)}
      "secureConnectStart" -> {end("connect", now); begin("tls", now)}
      "secureConnectEnd" -> end("tls", now)
      "connectEnd" -> end("connect", now)
      "requestHeadersStart" -> begin("send", now)
      "requestEnd" -> {end("send", now); begin("wait", now)}
      "responseHeadersStart" -> {end("wait", now); begin("receive", now)}
      "responseBodyEnd" -> end("receive", now)
      "callEnd" -> {end("receive", now); ended = now}
      "connectFailed", "requestFailed", "responseFailed", "callFailed" -> {if (failedIn == null) failedIn = phase; if (name == "callFailed") ended = now}
    }
  }
  @Synchronized fun connection(isProxy: Boolean, negotiatedProtocol: String? = null, tls: String? = null, acquired: Boolean = false) {
    proxy = isProxy
    if (negotiatedProtocol != null) protocol = negotiatedProtocol
    if (tls != null) tlsVersion = tls
    if (acquired) reused = !connected
  }
  @Synchronized fun handshake(version: String?) {tlsVersion = version}
  private var errorClass: String? = null
  @Synchronized fun failure(name: String, error: IOException) {errorClass = error.javaClass.simpleName; event(name)}
  @Synchronized fun error(): JSONObject? = errorClass?.let {JSONObject().put("class", it)}
  @Synchronized fun snapshot(dismissed: Boolean = false, now: Long = clock()): JSONObject {
    val result = JSONObject()
    for (name in listOf("dns", "connect", "tls", "send", "wait", "receive")) result.field(name, durations[name])
    return result.field("total", started?.let {((minOf(ended ?: now, now) - it) / 1_000_000).coerceAtLeast(0)}).field("reused", reused).field("proxy", proxy).field("protocol", protocol).field("tlsVersion", tlsVersion).field("failedIn", failedIn ?: phase.takeIf {dismissed})
  }
}

internal class ShareNetworkListener(private val timings: ShareNetworkTimings) : EventListener() {
  private fun record(block: () -> Unit) {try {block()} catch (_: Throwable) {}}
  override fun callStart(call: Call) = record {timings.event("callStart")}
  override fun dnsStart(call: Call, domainName: String) = record {timings.event("dnsStart")}
  override fun dnsEnd(call: Call, domainName: String, inetAddressList: List<InetAddress>) = record {timings.event("dnsEnd")}
  override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) = record {timings.connection(proxy.type() != Proxy.Type.DIRECT); timings.event("connectStart")}
  override fun secureConnectStart(call: Call) = record {timings.event("secureConnectStart")}
  override fun secureConnectEnd(call: Call, handshake: Handshake?) = record {timings.handshake(handshake?.tlsVersion?.javaName); timings.event("secureConnectEnd")}
  override fun connectEnd(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy, protocol: Protocol?) = record {timings.connection(proxy.type() != Proxy.Type.DIRECT, protocol?.toString()); timings.event("connectEnd")}
  override fun connectFailed(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy, protocol: Protocol?, ioe: IOException) = record {timings.connection(proxy.type() != Proxy.Type.DIRECT, protocol?.toString()); timings.event("connectFailed")}
  override fun connectionAcquired(call: Call, connection: Connection) = record {timings.connection(connection.route().proxy.type() != Proxy.Type.DIRECT, connection.protocol().toString(), connection.handshake()?.tlsVersion?.javaName, true)}
  override fun requestHeadersStart(call: Call) = record {timings.event("requestHeadersStart")}
  override fun requestHeadersEnd(call: Call, request: Request) = record {if (request.body == null) timings.event("requestEnd")}
  override fun requestBodyEnd(call: Call, byteCount: Long) = record {timings.event("requestEnd")}
  override fun requestFailed(call: Call, ioe: IOException) = record {timings.event("requestFailed")}
  override fun responseHeadersStart(call: Call) = record {timings.event("responseHeadersStart")}
  override fun responseBodyEnd(call: Call, byteCount: Long) = record {timings.event("responseBodyEnd")}
  override fun responseFailed(call: Call, ioe: IOException) = record {timings.event("responseFailed")}
  override fun callEnd(call: Call) = record {timings.event("callEnd")}
  override fun callFailed(call: Call, ioe: IOException) = record {timings.failure("callFailed", ioe)}
}
