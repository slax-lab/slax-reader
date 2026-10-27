package com.slax.reader.platform

/**
 * Collects offline image URLs with the tokenizer rules of `rewriteReaderImageTransports` and
 * `prepareAutomaticCacheContent` (src/reader/image-transports.ts, src/data/background-cache.ts).
 * The scanner mirrors the JS regular expression without backtracking so large attributes cannot exhaust the stack.
 */
internal object SlaxOfflineHtml {
  private val rawElements = setOf("script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext")
  private fun whitespace(ch: Char) = ch == '\t' || ch == '\n' || ch == '\u000c' || ch == '\r' || ch == ' '
  private fun asciiLetter(ch: Char) = ch in 'a'..'z' || ch in 'A'..'Z'
  private fun nameChar(ch: Char) = asciiLetter(ch) || ch in '0'..'9' || ch == ':' || ch == '-'

  fun imageUrls(html: String): List<String> {
    val urls = LinkedHashSet<String>()
    var rawText: String? = null
    var index = 0
    while (true) {
      val start = html.indexOf('<', index)
      if (start < 0) break
      val tag = match(html, start)
      if (tag == null) {index = start + 1; continue}
      index = tag.end
      val name = tag.name ?: continue
      val element = name.lowercase()
      val current = rawText
      if (current != null) {
        if (tag.closing && element == current && current != "plaintext") rawText = null
        continue
      }
      if (!tag.closing && element in rawElements) {rawText = element; continue}
      if (tag.closing || element != "img") continue
      for (value in sources(html.substring(start, tag.end))) {
        val url = normalize(decode(value))
        if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url)) urls.add(url)
      }
    }
    return urls.toList()
  }

  private class Tag(val end: Int, val name: String?, val closing: Boolean)
  private fun match(html: String, start: Int): Tag? {
    if (html.startsWith("<!--", start)) {
      val close = html.indexOf("-->", start + 4)
      return Tag(if (close < 0) html.length else close + 3, null, false)
    }
    if (html.startsWith("<!", start)) {
      val close = html.indexOf('>', start + 2)
      if (close >= 0) return Tag(close + 1, null, false)
    }
    var index = start + 1
    val closing = html.getOrNull(index) == '/'
    if (closing) index++
    if (index >= html.length || !asciiLetter(html[index])) return null
    val nameStart = index
    while (index < html.length && nameChar(html[index])) index++
    val next = html.getOrNull(index) ?: return null
    if (!whitespace(next) && next != '/' && next != '>') return null
    val name = html.substring(nameStart, index)
    while (index < html.length) {
      when (val ch = html[index]) {
        '>' -> return Tag(index + 1, name, closing)
        '"', '\'' -> {val close = html.indexOf(ch, index + 1); if (close < 0) return null; index = close + 1}
        else -> index++
      }
    }
    return null
  }

  /** Values of `src` attributes for an `<img>` start tag, as `rewriteImageTag` reports them to its image callback. */
  private fun sources(tag: String): List<String> {
    val result = mutableListOf<String>()
    var index = Regex("^<[a-z0-9:-]+", RegexOption.IGNORE_CASE).find(tag)?.value?.length ?: 4
    while (index < tag.length) {
      while (index < tag.length && whitespace(tag[index])) index++
      if (index >= tag.length || tag[index] == '>' || tag[index] == '/') break
      val nameStart = index
      while (index < tag.length && !whitespace(tag[index]) && tag[index] != '=' && tag[index] != '>' && tag[index] != '/') index++
      val name = tag.substring(nameStart, index).lowercase()
      while (index < tag.length && whitespace(tag[index])) index++
      if (tag.getOrNull(index) != '=') continue
      index++
      while (index < tag.length && whitespace(tag[index])) index++
      val quote = tag.getOrNull(index)?.takeIf { it == '"' || it == '\'' }
      if (quote != null) index++
      val valueStart = index
      if (quote != null) {while (index < tag.length && tag[index] != quote) index++}
      else {while (index < tag.length && !whitespace(tag[index]) && tag[index] != '>') index++}
      if (name == "src") {
        val value = tag.substring(valueStart, index)
        val rewritten = value.replaceFirst(Regex("^https://", RegexOption.IGNORE_CASE), "slaxstatics://").replaceFirst(Regex("^http://", RegexOption.IGNORE_CASE), "slaxstatic://")
        if (rewritten.isNotEmpty() && !Regex("^data:", RegexOption.IGNORE_CASE).containsMatchIn(rewritten)) result.add(rewritten)
      }
      if (quote != null && tag.getOrNull(index) == quote) index++
    }
    return result
  }

  fun normalize(url: String): String = when {
    url.startsWith("slaxstatics://") -> "https://" + url.removePrefix("slaxstatics://")
    url.startsWith("slaxstatic://") -> "http://" + url.removePrefix("slaxstatic://")
    else -> url
  }

  private val entity = Regex("&(?:amp|quot|apos|lt|gt|#[0-9]+|#x[0-9a-f]+);", RegexOption.IGNORE_CASE)
  private val named = mapOf("&amp;" to "&", "&quot;" to "\"", "&apos;" to "'", "&lt;" to "<", "&gt;" to ">")
  fun decode(value: String): String = entity.replace(value) { match ->
    val text = match.value
    named[text.lowercase()] ?: run {
      val hex = text.startsWith("&#x", true)
      val digits = text.substring(if (hex) 3 else 2, text.length - 1)
      val code = digits.toBigInteger(if (hex) 16 else 10)
      val point = code.toInt()
      if (code.signum() > 0 && code <= java.math.BigInteger.valueOf(0x10ffff) && !(point in 0xd800..0xdfff)) String(Character.toChars(point)) else "\uFFFD"
    }
  }
}
