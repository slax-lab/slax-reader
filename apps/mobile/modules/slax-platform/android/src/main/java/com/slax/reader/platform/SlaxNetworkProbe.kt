package com.slax.reader.platform

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.Locale
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * One bounded snapshot of the path to a Slax-owned host: resolver answers as address counts, TCP connect timing per
 * address family and the active network's capabilities. No address is ever returned, only counts, durations and error classes.
 */
internal object SlaxNetworkProbe {
  private val workers = Executors.newCachedThreadPool { Thread(it, "SlaxNetworkProbe").apply { isDaemon = true } }
  private const val STEP_MS = 3000L

  fun allowed(host: String, suffixes: List<String>): Boolean {
    val normalized = host.lowercase(Locale.ROOT).trimEnd('.')
    if (!Regex("^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$").matches(normalized) || normalized.split('.').any { it.isEmpty() }) return false
    return suffixes.any { suffix -> val root = suffix.lowercase(Locale.ROOT).trimStart('.'); root.isNotEmpty() && (normalized == root || normalized.endsWith(".$root")) }
  }

  fun probe(context: Context, host: String): Map<String, Any?> {
    val result = linkedMapOf<String, Any?>()
    val system = timed { InetAddress.getAllByName(host).toList() }
    result["dns"] = linkedMapOf(
      "system" to dnsSummary(system),
      "public" to timed { SlaxDns.lookup(host, "1.1.1.1").split(", ").filter { it.isNotBlank() } }.let { answer ->
        linkedMapOf<String, Any?>("ms" to answer.ms).apply {
          val value = answer.value
          if (value == null) put("error", answer.error) else put("v4", value.size)
        }
      }
    )
    val addresses = system.value.orEmpty()
    result["tcp"] = linkedMapOf(
      "v4" to addresses.firstOrNull { it is Inet4Address }?.let { connect(it) },
      "v6" to addresses.firstOrNull { it is Inet6Address }?.let { connect(it) }
    ).filterValues { it != null }
    result["network"] = network(context)
    SlaxImageRegistry.lastFailure?.let { result["image_failure"] = it }
    return result
  }

  private class Timed<T>(val value: T?, val ms: Long, val error: String?)
  private fun <T> timed(work: () -> T): Timed<T> {
    val started = System.nanoTime()
    val future = workers.submit(Callable { work() })
    return try {
      Timed(future.get(STEP_MS + 2000, TimeUnit.MILLISECONDS), elapsed(started), null)
    } catch (error: java.util.concurrent.TimeoutException) {
      future.cancel(true); Timed(null, elapsed(started), "timeout")
    } catch (error: java.util.concurrent.ExecutionException) {
      Timed(null, elapsed(started), errorClass(error.cause ?: error))
    } catch (error: Exception) {
      Timed(null, elapsed(started), errorClass(error))
    }
  }
  private fun elapsed(started: Long) = (System.nanoTime() - started) / 1_000_000
  private fun errorClass(error: Throwable) = error.javaClass.simpleName.take(64).ifEmpty { "Error" }

  private fun dnsSummary(answer: Timed<List<InetAddress>>): Map<String, Any?> = linkedMapOf<String, Any?>("ms" to answer.ms).apply {
    val value = answer.value
    if (value == null) put("error", answer.error)
    else {put("v4", value.count { it is Inet4Address }); put("v6", value.count { it is Inet6Address })}
  }

  private fun connect(address: InetAddress): Map<String, Any?> {
    val started = System.nanoTime()
    return try {
      Socket().use { it.connect(InetSocketAddress(address, 443), STEP_MS.toInt()) }
      linkedMapOf("ok" to true, "ms" to elapsed(started))
    } catch (error: Exception) {
      linkedMapOf("ok" to false, "ms" to elapsed(started), "error" to if (error is java.net.SocketTimeoutException) "timeout" else errorClass(error))
    }
  }

  private fun network(context: Context): Map<String, Any?> = runCatching {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val active = manager.activeNetwork ?: return@runCatching linkedMapOf<String, Any?>("transport" to "none")
    val capabilities = manager.getNetworkCapabilities(active)
    val links = manager.getLinkProperties(active)
    val vpn = capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
    val transport = when {
      capabilities == null -> "other"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
      vpn -> "vpn"
      else -> "other"
    }
    linkedMapOf<String, Any?>(
      "transport" to transport,
      "vpn" to vpn,
      "metered" to manager.isActiveNetworkMetered,
      "validated" to (capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true),
      "private_dns" to when {
        links == null || android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.P -> null
        links.privateDnsServerName != null -> "strict"
        links.isPrivateDnsActive -> "opportunistic"
        else -> "off"
      },
      "ipv6_route" to (links?.routes?.any { it.isDefaultRoute && it.destination.address is Inet6Address } == true)
    ).filterValues { it != null }
  }.getOrElse { linkedMapOf("error" to errorClass(it)) }
}
