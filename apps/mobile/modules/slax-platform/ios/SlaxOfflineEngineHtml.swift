import Foundation

/// Image URL extraction with the Reader transport tokenizer rules (`src/reader/image-transports.ts`).
enum SlaxOfflineHtml {
  private static let tags = try! NSRegularExpression(pattern: "<!--[\\s\\S]*?(?:-->|\\z)|<![^>]*>|<(/?)([a-zA-Z][a-zA-Z0-9:-]*)(?=[\\t\\n\\f\\r />])(?:\"[^\"]*\"|'[^']*'|[^'\">])*>")
  private static let entities = try! NSRegularExpression(pattern: "&(?:[aA][mM][pP]|[qQ][uU][oO][tT]|[aA][pP][oO][sS]|[lL][tT]|[gG][tT]|#[0-9]+|#[xX][0-9a-fA-F]+);")
  private static let rawElements: Set<String> = ["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext"]

  /// Ordered, deduplicated absolute http(s) image URLs, as the automatic cache records them.
  static func imageUrls(_ html: String) -> [String] {
    var result: [String] = [], seen = Set<[UInt16]>()
    let source = html as NSString
    var rawText: String?
    tags.enumerateMatches(in: html, range: NSRange(location: 0, length: source.length)) { match, _, _ in
      guard let match else { return }
      let nameRange = match.range(at: 2)
      guard nameRange.location != NSNotFound else { return }
      let element = lowerAscii(source.substring(with: nameRange)), closing = match.range(at: 1).length > 0
      if let raw = rawText {
        if closing && element == raw && raw != "plaintext" { rawText = nil }
        return
      }
      if !closing && rawElements.contains(element) { rawText = element; return }
      guard !closing, element == "img" else { return }
      for value in sources(Array(source.substring(with: match.range).utf16)) {
        let rewritten = rewrite(value)
        guard !rewritten.isEmpty, !hasPrefix(rewritten, "data:") else { continue }
        let url = normalize(decode(rewritten))
        if hasPrefix(url, "http://") || hasPrefix(url, "https://"), seen.insert(Array(url.utf16)).inserted { result.append(url) }
      }
    }
    return result
  }

  private static func lowerAscii(_ value: String) -> String {
    String(String.UnicodeScalarView(value.unicodeScalars.map { (65...90).contains($0.value) ? Unicode.Scalar($0.value + 32)! : $0 }))
  }
  private static func hasPrefix(_ value: String, _ prefix: String) -> Bool {
    let head = value.utf16.prefix(prefix.utf16.count)
    return head.count == prefix.utf16.count && lowerAscii(String(decoding: head, as: UTF16.self)) == prefix
  }
  private static func rewrite(_ value: String) -> String {
    if hasPrefix(value, "https://") { return "slaxstatics://" + String(decoding: value.utf16.dropFirst(8), as: UTF16.self) }
    if hasPrefix(value, "http://") { return "slaxstatic://" + String(decoding: value.utf16.dropFirst(7), as: UTF16.self) }
    return value
  }
  private static func startsExactly(_ value: String, _ prefix: String) -> Bool { value.utf16.starts(with: prefix.utf16) }
  private static func normalize(_ url: String) -> String {
    if startsExactly(url, "slaxstatics://") { return "https://" + String(decoding: url.utf16.dropFirst(14), as: UTF16.self) }
    if startsExactly(url, "slaxstatic://") { return "http://" + String(decoding: url.utf16.dropFirst(13), as: UTF16.self) }
    return url
  }
  private static func whitespace(_ unit: UInt16) -> Bool { unit == 9 || unit == 10 || unit == 12 || unit == 13 || unit == 32 }

  /// `src` attribute values of one tag, using the tokenizer in `rewriteImageTag`.
  private static func sources(_ tag: [UInt16]) -> [String] {
    var values: [String] = []
    var index = 1
    if index < tag.count, (65...90).contains(tag[index]) || (97...122).contains(tag[index]) || (48...57).contains(tag[index]) || tag[index] == 58 || tag[index] == 45 {
      while index < tag.count, (65...90).contains(tag[index]) || (97...122).contains(tag[index]) || (48...57).contains(tag[index]) || tag[index] == 58 || tag[index] == 45 { index += 1 }
    } else { index = 4 }
    let quoteDouble: UInt16 = 34, quoteSingle: UInt16 = 39, equals: UInt16 = 61, greater: UInt16 = 62, slash: UInt16 = 47
    while index < tag.count {
      while index < tag.count, whitespace(tag[index]) { index += 1 }
      if index >= tag.count || tag[index] == greater || tag[index] == slash { break }
      let nameStart = index
      while index < tag.count, !whitespace(tag[index]), tag[index] != equals, tag[index] != greater, tag[index] != slash { index += 1 }
      let name = lowerAscii(String(decoding: tag[nameStart..<index], as: UTF16.self))
      while index < tag.count, whitespace(tag[index]) { index += 1 }
      if index >= tag.count || tag[index] != equals { continue }
      index += 1
      while index < tag.count, whitespace(tag[index]) { index += 1 }
      var quote: UInt16?
      if index < tag.count, tag[index] == quoteDouble || tag[index] == quoteSingle { quote = tag[index]; index += 1 }
      let start = index
      if let quote { while index < tag.count, tag[index] != quote { index += 1 } }
      else { while index < tag.count, !whitespace(tag[index]), tag[index] != greater { index += 1 } }
      if name == "src" { values.append(String(decoding: tag[start..<index], as: UTF16.self)) }
      if let quote, index < tag.count, tag[index] == quote { index += 1 }
    }
    return values
  }

  /// `decodeImageAttribute`: the five named entities plus numeric references.
  static func decode(_ value: String) -> String {
    let source = value as NSString
    var result = "", cursor = 0
    for match in entities.matches(in: value, range: NSRange(location: 0, length: source.length)) {
      result += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
      let entity = lowerAscii(source.substring(with: match.range))
      switch entity {
      case "&amp;": result += "&"
      case "&quot;": result += "\""
      case "&apos;": result += "'"
      case "&lt;": result += "<"
      case "&gt;": result += ">"
      default:
        let hex = entity.hasPrefix("&#x"), digits = entity.dropFirst(hex ? 3 : 2).dropLast()
        var code: UInt64 = 0, overflow = false
        for character in digits {
          guard let digit = character.hexDigitValue, hex || digit < 10 else { overflow = true; break }
          code = code * (hex ? 16 : 10) + UInt64(digit)
          if code > 0x10FFFF { overflow = true; break }
        }
        if !overflow, code > 0, !(0xD800...0xDFFF).contains(code), let scalar = Unicode.Scalar(UInt32(code)) { result.unicodeScalars.append(scalar) }
        else { result += "\u{FFFD}" }
      }
      cursor = match.range.location + match.range.length
    }
    return result + source.substring(from: cursor)
  }
}
