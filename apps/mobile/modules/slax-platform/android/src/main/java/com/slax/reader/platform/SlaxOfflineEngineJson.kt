package com.slax.reader.platform

/** Minimal JSON codec for engine records; independent of Android so the engine runs in JVM hosts. */
internal object SlaxOfflineJson {
  fun encode(value: Any?): String = StringBuilder().also { write(it, value) }.toString()
  private fun write(out: StringBuilder, value: Any?) {
    when (value) {
      null -> out.append("null")
      is Boolean -> out.append(value)
      is Int, is Long -> out.append(value.toString())
      is Number -> {
        val number = value.toDouble()
        require(number.isFinite()) { "Invalid JSON number" }
        if (number == Math.rint(number) && Math.abs(number) < 9.007199254740992E15) out.append(number.toLong()) else out.append(number.toString())
      }
      is String -> {
        out.append('"')
        for (ch in value) when {
          ch == '"' -> out.append("\\\""); ch == '\\' -> out.append("\\\\")
          ch == '\n' -> out.append("\\n"); ch == '\r' -> out.append("\\r"); ch == '\t' -> out.append("\\t")
          ch < ' ' || ch == '\u2028' || ch == '\u2029' -> out.append("\\u").append(String.format("%04x", ch.code))
          else -> out.append(ch)
        }
        out.append('"')
      }
      is Map<*, *> -> {
        out.append('{'); var first = true
        for ((key, item) in value) {if (!first) out.append(','); first = false; write(out, key as String); out.append(':'); write(out, item)}
        out.append('}')
      }
      is Iterable<*> -> {out.append('['); var first = true; for (item in value) {if (!first) out.append(','); first = false; write(out, item)}; out.append(']')}
      else -> error("Unsupported JSON value")
    }
  }

  fun decode(text: String): Any? {
    val parser = Parser(text); val value = parser.value(0); parser.space()
    require(parser.index == text.length) { "Trailing JSON content" }
    return value
  }
  private class Parser(val text: String) {
    var index = 0
    fun space() {while (index < text.length && text[index] in " \t\r\n") index++}
    fun value(depth: Int): Any? {
      require(depth < 64) { "JSON nesting exceeds limit" }
      space(); require(index < text.length) { "Unexpected JSON end" }
      return when (text[index]) {
        '{' -> objectValue(depth)
        '[' -> arrayValue(depth)
        '"' -> string()
        't' -> literal("true", true)
        'f' -> literal("false", false)
        'n' -> literal("null", null)
        else -> number()
      }
    }
    fun objectValue(depth: Int): Map<String, Any?> {
      index++; val result = LinkedHashMap<String, Any?>(); space()
      if (text.getOrNull(index) == '}') {index++; return result}
      while (true) {space(); val key = string(); space(); expect(':'); result[key] = value(depth + 1); space(); if (text.getOrNull(index) != ',') break; index++}
      expect('}'); return result
    }
    fun arrayValue(depth: Int): List<Any?> {
      index++; val result = ArrayList<Any?>(); space()
      if (text.getOrNull(index) == ']') {index++; return result}
      while (true) {result.add(value(depth + 1)); space(); if (text.getOrNull(index) != ',') break; index++}
      expect(']'); return result
    }
    fun expect(ch: Char) {require(text.getOrNull(index) == ch) { "Invalid JSON" }; index++}
    fun literal(word: String, value: Any?): Any? {require(text.startsWith(word, index)) { "Invalid JSON literal" }; index += word.length; return value}
    fun number(): Double {
      val match = Regex("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?").matchAt(text, index) ?: error("Invalid JSON number")
      index += match.value.length; return match.value.toDouble()
    }
    fun string(): String {
      expect('"'); val out = StringBuilder()
      while (true) {
        require(index < text.length) { "Unterminated JSON string" }
        val ch = text[index++]
        when {
          ch == '"' -> return out.toString()
          ch == '\\' -> {
            require(index < text.length) { "Invalid JSON escape" }
            when (val escape = text[index++]) {
              '"' -> out.append('"'); '\\' -> out.append('\\'); '/' -> out.append('/')
              'b' -> out.append('\b'); 'f' -> out.append('\u000c'); 'n' -> out.append('\n'); 'r' -> out.append('\r'); 't' -> out.append('\t')
              'u' -> {require(index + 4 <= text.length) { "Invalid JSON escape" }; out.append(text.substring(index, index + 4).toInt(16).toChar()); index += 4}
              else -> error("Invalid JSON escape $escape")
            }
          }
          ch < ' ' -> error("Invalid JSON control character")
          else -> out.append(ch)
        }
      }
    }
  }
}
