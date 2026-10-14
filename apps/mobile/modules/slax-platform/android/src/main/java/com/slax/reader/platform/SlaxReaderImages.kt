package com.slax.reader.platform

import android.content.Context
import expo.modules.kotlin.Promise
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

internal object SlaxReaderImages {
  private val requests = ConcurrentHashMap<String, SlaxResources>()
  private val executor = Executors.newFixedThreadPool(3) { work -> Thread(work, "SlaxReaderImage").apply { isDaemon = true } }
  fun cancel(id: String) { requests.remove(id)?.close() }
  fun cancelAll() { requests.keys.toList().forEach(::cancel) }
  fun load(context: Context, id: String, url: String, owner: String, hosts: List<String>, proxies: List<String>, promise: Promise) {
    require(SlaxReaderView.owns(owner)) { "Reader image released" }
    val policy = SlaxReaderSecurity(hosts, proxies)
    require(policy.imageOriginal(url) != null) { "Reader image destination denied" }
    val resources = SlaxResources(context) { SlaxReaderView.owns(owner) && requests.containsKey(id) }.apply { security = policy }
    require(requests.putIfAbsent(id, resources) == null) { "Duplicate Reader image request" }
    executor.execute {
      try {
        val response = resources.intercept(url, privateImage = true) ?: error("Reader image unavailable")
        val data = response.data.use { it.readBytes() }
        check(data.isNotEmpty() && SlaxReaderView.owns(owner) && requests[id] === resources) { "Reader image released" }
        promise.resolve(android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP))
      } catch (_: Exception) { promise.reject("E_READER_IMAGE", "Reader image unavailable", null) }
      finally { requests.remove(id, resources); resources.close() }
    }
  }
}
