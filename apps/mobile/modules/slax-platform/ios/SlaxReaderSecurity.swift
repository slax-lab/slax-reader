import Foundation

struct SlaxReaderSecurity: Equatable {
  static let origin = URL(string: "https://reader.slax.invalid/")!
  static let csp = "default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; style-src 'unsafe-inline' https:; font-src https: data:; img-src https: data: blob: slaxstatic: slaxstatics:; media-src https: data: blob: slaxmedia: slaxmedias:; frame-src https:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; worker-src 'none'"
  /// PDF pages live on the scheme their byte ranges are served from, so those fetches are same-origin (WebKit blocks
  /// https → custom-scheme fetches as mixed content). Main-frame loads of this origin never reach the scheme handler.
  static let pdfOrigin = URL(string: "slaxpdf://pdf/")!
  let protectedHosts: [String]
  let imageProxyOrigins: [String]
  let pdfMode: Bool
  var documentOrigin: URL { pdfMode ? Self.pdfOrigin : Self.origin }
  init(_ hosts: [String], imageProxyOrigins: [String] = [], pdfMode: Bool = false) throws {
    self.pdfMode = pdfMode
    self.imageProxyOrigins = try imageProxyOrigins.map { raw in
      guard let url = URL(string: raw), let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), ["http", "https"].contains(parts.scheme ?? ""), parts.host != nil, parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil, parts.path.isEmpty else { throw URLError(.badURL) }
      return raw
    }
    guard !hosts.isEmpty, hosts.count <= 32 else { throw URLError(.badURL) }
    let normalized = try hosts.map { raw -> String in
      let host = raw.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
      guard host.range(of: "^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$", options: .regularExpression) != nil,
        !host.components(separatedBy: ".").contains(where: { $0.isEmpty || $0.hasPrefix("-") || $0.hasSuffix("-") }) else { throw URLError(.badURL) }
      return host
    }
    protectedHosts = Array(Set(normalized + ["slax.com"])).sorted()
  }
  func original(_ url: URL) -> URL? {
    guard !pdfMode, !url.absoluteString.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 127 || $0.value == 92 }),
      var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    if components.scheme?.lowercased() == "slaxstatics" { components.scheme = "https" }
    if components.scheme?.lowercased() == "slaxstatic" { components.scheme = "http" }
    guard ["http", "https"].contains(components.scheme?.lowercased() ?? ""), components.user == nil, components.password == nil,
      let rawHost = components.host, !rawHost.isEmpty else { return nil }
    let host = rawHost.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
    guard !protectedHosts.contains(where: { host == $0 || host.hasSuffix(".\($0)") }) else { return nil }
    return components.url
  }
  func allows(_ url: URL) -> Bool { original(url) != nil }
  func imageOriginal(_ url: URL) -> URL? {
    if let original = original(url) { return original }
    guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    if parts.scheme == "slaxstatics" { parts.scheme = "https" }
    if parts.scheme == "slaxstatic" { parts.scheme = "http" }
    guard let original = parts.url, signedImageProxy(original) else { return nil }
    return original
  }
  func mediaOriginal(_ url: URL) -> URL? {
    guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false), ["slaxmedia", "slaxmedias"].contains(parts.scheme ?? "") else { return nil }
    parts.scheme = parts.scheme == "slaxmedias" ? "https" : "http"
    guard let original = parts.url, signedImageProxy(original), parts.queryItems?.contains(where: { $0.name == "m" }) == false else { return nil }
    return original
  }
  func allowsMediaHop(_ url: URL) -> Bool {
    if allows(url) { return true }
    return signedImageProxy(url) && URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "m" }) == false
  }
  static func validRange(_ range: String) -> Bool {
    guard range.range(of: "^bytes=([0-9]*)-([0-9]*)$", options: .regularExpression) != nil else { return false }
    let parts = range.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
    let start = Int64(parts[0]), end = Int64(parts[1])
    if parts[0].isEmpty { return end != nil && end! > 0 }
    guard let start else { return false }
    return parts[1].isEmpty || end != nil && end! >= start
  }
  func signedImageProxy(_ url: URL) -> Bool {
    guard !pdfMode, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), parts.path == "/static/image", parts.user == nil, parts.password == nil, parts.fragment == nil,
      let items = parts.queryItems else { return false }
    var origin = parts; origin.path = ""; origin.query = nil
    guard imageProxyOrigins.contains(origin.string ?? ""), Set(items.map(\.name)).count == items.count,
      items.allSatisfy({ ["u", "r", "d", "m"].contains($0.name) }) else { return false }
    let values = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
    guard values["d"]?.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil, values["m"] == nil || values["m"] == "rss",
      let source = values["u"]?.removingPercentEncoding.flatMap(URL.init(string:)), let referer = values["r"].flatMap(URL.init(string:)) else { return false }
    return [source, referer].allSatisfy { ["http", "https"].contains($0.scheme ?? "") && $0.host != nil && $0.user == nil && $0.password == nil }
  }
  static func pdfCsp(_ pageId: String) throws -> String {
    guard pageId.range(of: "^[A-Za-z0-9-]+$", options: .regularExpression) != nil else { throw URLError(.badURL) }
    return "default-src 'none'; script-src 'nonce-slax-pdf-\(pageId)' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src blob: slaxpdf://pdf; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'"
  }
  static func pdfDocument(_ html: String, pageId: String) throws -> String {
    let csp = try pdfCsp(pageId)
    let policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"\(csp)\">"
    guard let head = html.range(of: "<head>"), html.contains(policy) else { throw URLError(.badURL) }
    var document = html
    document.insert(contentsOf: policy, at: head.upperBound)
    return document
  }
  func contentRules() throws -> String {
    if pdfMode { return "[{\"trigger\":{\"url-filter\":\"^https?://\",\"url-filter-is-case-sensitive\":false},\"action\":{\"type\":\"block\"}}]" }
    let rules = protectedHosts.flatMap { host in
      ["[/?#]", "$"].map { end in
        ["trigger": ["url-filter": "^https?://([^/]*@)?([^/:]*\\.)?" + NSRegularExpression.escapedPattern(for: host) + "\\.?(:[0-9]+)?" + end, "url-filter-is-case-sensitive": false], "action": ["type": "block"]] as [String: Any]
      }
    }
    return String(data: try JSONSerialization.data(withJSONObject: rules), encoding: .utf8)!
  }
  static func document(_ html: String) -> String {
    let policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"\(csp)\"><meta name=\"referrer\" content=\"strict-origin-when-cross-origin\">"
    guard let head = html.range(of: "<head>"), html[..<head.lowerBound].range(of: "^\\s*(?:<!DOCTYPE html>\\s*)?<html(?:\\s[^>]*)?>\\s*$", options: [.regularExpression, .caseInsensitive]) != nil else { return "<!doctype html><html><head>\(policy)</head><body>\(html)</body></html>" }
    var document = html
    document.insert(contentsOf: policy, at: head.upperBound)
    return document
  }
}
