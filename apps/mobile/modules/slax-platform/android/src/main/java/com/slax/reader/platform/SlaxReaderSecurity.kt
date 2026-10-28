package com.slax.reader.platform

import java.net.URI
import java.util.Locale

internal class SlaxReaderSecurity(hosts: List<String>, val imageProxyOrigins: List<String> = emptyList(), val pdfMode: Boolean = false) {
  val documentOrigin get() = if (pdfMode) PDF_ORIGIN else ORIGIN
  companion object {
    const val ORIGIN = "https://reader.slax.invalid/"
    const val PDF_ORIGIN = "https://pdf.reader.slax.invalid/"
    const val CSP = "default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; style-src 'unsafe-inline' https:; font-src https: data:; img-src https: data: blob: slaxstatic: slaxstatics:; media-src https: data: blob: slaxmedia: slaxmedias:; frame-src https:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; worker-src 'none'"
    fun validRange(value: String): Boolean {
      val match = Regex("^bytes=([0-9]*)-([0-9]*)$").matchEntire(value) ?: return false
      val start = match.groupValues[1].toLongOrNull(); val end = match.groupValues[2].toLongOrNull()
      if (match.groupValues[1].isEmpty()) return end != null && end > 0
      return start != null && (match.groupValues[2].isEmpty() || end != null && end >= start)
    }
    fun pdfCsp(pageId: String): String {
      require(Regex("^[A-Za-z0-9-]+$").matches(pageId)) { "Invalid PDF page identity" }
      return "default-src 'none'; script-src 'nonce-slax-pdf-$pageId' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src blob: https://pdf.reader.slax.invalid; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'"
    }
    fun pdfDocument(html: String, pageId: String): String {
      val policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"${pdfCsp(pageId)}\">"
      require(html.contains("<head>") && html.contains(policy)) { "Invalid PDF document policy" }
      return html.replaceFirst("<head>", "<head>$policy")
    }
    fun document(html: String): String {
      val policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"$CSP\"><meta name=\"referrer\" content=\"strict-origin-when-cross-origin\">"
      return if (Regex("(?is)^\\s*(?:<!DOCTYPE html>\\s*)?<html(?:\\s[^>]*)?>\\s*<head>").containsMatchIn(html)) html.replaceFirst("<head>", "<head>$policy") else "<!doctype html><html><head>$policy</head><body>$html</body></html>"
    }
  }
  val protectedHosts: List<String>
  init {
    require(hosts.isNotEmpty() && hosts.size <= 32) { "Invalid Reader protected hosts" }
    imageProxyOrigins.forEach { raw -> val uri = URI(raw); require(uri.scheme in listOf("http", "https") && uri.host != null && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.rawPath.isNullOrEmpty()) { "Invalid image proxy origin" } }
    protectedHosts = (hosts.map { raw ->
      val host = raw.lowercase(Locale.ROOT).trim('.')
      require(Regex("^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$").matches(host) && host.split('.').none { it.isEmpty() || it.startsWith('-') || it.endsWith('-') }) { "Invalid Reader protected host" }
      host
    } + "slax.com").distinct().sorted()
  }
  fun original(raw: String): String? = runCatching {
    require(!pdfMode)
    require(raw.none { it <= ' ' || it.code == 127 || it == '\\' })
    val source = URI(raw)
    val scheme = when (source.scheme?.lowercase(Locale.ROOT)) { "slaxstatics" -> "https"; "slaxstatic" -> "http"; else -> source.scheme?.lowercase(Locale.ROOT) }
    require(scheme in listOf("https", "http") && source.rawUserInfo == null)
    val host = requireNotNull(source.host).lowercase(Locale.ROOT).trimEnd('.')
    require(host.isNotEmpty() && protectedHosts.none { host == it || host.endsWith(".$it") })
    scheme + raw.substring(raw.indexOf(':'))
  }.getOrNull()
  fun allows(raw: String) = original(raw) != null
  fun imageOriginal(raw: String): String? = original(raw) ?: runCatching {
    val normalized = raw.replaceFirst(Regex("(?i)^slaxstatics:"), "https:").replaceFirst(Regex("(?i)^slaxstatic:"), "http:")
    normalized.takeIf { signedImageProxy(it) }
  }.getOrNull()
  fun mediaOriginal(raw: String): String? = runCatching {
    require(URI(raw).scheme in listOf("slaxmedia", "slaxmedias"))
    val normalized = raw.replaceFirst("slaxmedias:", "https:").replaceFirst("slaxmedia:", "http:")
    normalized.takeIf { signedImageProxy(it) && !URI(it).query.split('&').any { part -> part.substringBefore('=') == "m" } }
  }.getOrNull()
  fun allowsMediaHop(raw: String): Boolean = allows(raw) || runCatching { signedImageProxy(raw) && !URI(raw).query.split('&').any { it.substringBefore('=') == "m" } }.getOrDefault(false)
  fun signedImageProxy(raw: String): Boolean = runCatching {
    require(!pdfMode)
    val url = URI(raw)
    require(url.rawPath == "/static/image" && url.rawUserInfo == null && url.rawFragment == null)
    require(imageProxyOrigins.contains("${url.scheme}://${url.rawAuthority}"))
    val pairs = requireNotNull(url.rawQuery).split('&').map { part ->
      val key = java.net.URLDecoder.decode(part.substringBefore('='), "UTF-8")
      key to java.net.URLDecoder.decode(part.substringAfter('=', ""), "UTF-8")
    }
    require(pairs.map { it.first }.distinct().size == pairs.size && pairs.all { it.first in listOf("u", "r", "d", "m") })
    val values = pairs.toMap()
    require(Regex("^[a-f0-9]{32}$").matches(values["d"].orEmpty()) && (values["m"] == null || values["m"] == "rss"))
    val source = URI(java.net.URLDecoder.decode(requireNotNull(values["u"]), "UTF-8"))
    val referer = URI(requireNotNull(values["r"]))
    listOf(source, referer).all { it.scheme in listOf("http", "https") && it.host != null && it.rawUserInfo == null }
  }.getOrDefault(false)
}
