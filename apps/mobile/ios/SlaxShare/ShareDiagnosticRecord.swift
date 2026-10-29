import Foundation

struct ShareNetworkPhases {
  var dnsStart: Date?, dnsEnd: Date?, connectStart: Date?, connectEnd: Date?, tlsStart: Date?, tlsEnd: Date?
  var requestStart: Date?, requestEnd: Date?, responseStart: Date?, responseEnd: Date?
  var total: TimeInterval?
  var reused: Bool?, proxy: Bool?, cellular: Bool?, expensive: Bool?, constrained: Bool?
  var networkProtocol: String?, tlsVersion: String?, remotePort: Int?
}

enum ShareDiagnosticRecord {
  static func value<T>(_ value: T?) -> Any { value.map { $0 as Any } ?? NSNull() }
  static func milliseconds(_ start: Date?, _ end: Date?) -> Int? {
    guard let start, let end else { return nil }
    return max(0, Int((end.timeIntervalSince(start) * 1000).rounded()))
  }
  static func reduce(_ phase: ShareNetworkPhases) -> [String: Any] {
    let tls = milliseconds(phase.tlsStart, phase.tlsEnd)
    let connection = milliseconds(phase.connectStart, phase.connectEnd)
    let connect = phase.tlsStart != nil && tls == nil ? milliseconds(phase.connectStart, phase.tlsStart) : connection.map { max(0, $0 - (tls ?? 0)) }
    let phases: [(String, Date?, Date?)] = [
      ("dns", phase.dnsStart, phase.dnsEnd), ("connect", phase.connectStart, phase.tlsStart ?? phase.connectEnd),
      ("tls", phase.tlsStart, phase.tlsEnd), ("send", phase.requestStart, phase.requestEnd),
      ("wait", phase.requestEnd, phase.responseStart), ("receive", phase.responseStart, phase.responseEnd),
    ]
    return [
      "dns": value(milliseconds(phase.dnsStart, phase.dnsEnd)), "connect": value(connect), "tls": value(tls),
      "send": value(milliseconds(phase.requestStart, phase.requestEnd)), "wait": value(milliseconds(phase.requestEnd, phase.responseStart)),
      "receive": value(milliseconds(phase.responseStart, phase.responseEnd)), "total": value(phase.total.map { max(0, Int(($0 * 1000).rounded())) }),
      "reused": value(phase.reused), "proxy": value(phase.proxy), "protocol": value(phase.networkProtocol.map { String($0.prefix(80)) }),
      "tlsVersion": value(phase.tlsVersion), "failedIn": value(phases.first { $0.1 != nil && $0.2 == nil }?.0),
      "cellular": value(phase.cellular), "expensive": value(phase.expensive), "constrained": value(phase.constrained), "remotePort": value(phase.remotePort),
    ]
  }
  static func identifier(_ text: String?, limit: Int = 80) -> String? {
    guard let text, !text.isEmpty, text.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-")).contains($0) }) else { return nil }
    return String(text.prefix(limit))
  }
  static func url(_ text: String?) -> Any {
    guard let text else { return NSNull() }
    let url = URL(string: text)
    return ["scheme": value(url?.scheme), "host": value(url?.host), "length": text.count] as [String: Any]
  }
  static func token(_ token: String?) -> [String: Any] {
    let token = token ?? ""
    var result: [String: Any] = ["present": !token.isEmpty, "len": token.count]
    if token.count > 4 { result["tail4"] = String(token.suffix(4)) }
    return result
  }
  static func error(_ error: NSError) -> [String: Any] {
    let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError
    var result: [String: Any] = [
      "domain": value(identifier(error.domain)), "code": error.code,
      "underlyingDomain": value(identifier(underlying?.domain)), "underlyingCode": value(underlying?.code),
    ]
    if let domain = (underlying?.userInfo["_kCFStreamErrorDomainKey"] ?? error.userInfo["_kCFStreamErrorDomainKey"]) as? NSNumber { result["streamDomain"] = domain }
    if let code = (underlying?.userInfo["_kCFStreamErrorCodeKey"] ?? error.userInfo["_kCFStreamErrorCodeKey"]) as? NSNumber { result["streamCode"] = code }
    return result
  }
  static func shown(_ message: String) -> String {
    let fixed = ["Collecting", "Success!", "Failed!", "No content to share", "Not have URL content to collect.", "Not have auth info, please login first.", "Collection failed, please try again.", "Auth expired, please reopen the app to login again.", "Request timed out, please try again.", "Network unavailable, please check your connection."]
    return fixed.contains(message) ? message : "[redacted]"
  }
  static func timestamp(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = .current
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"
    return formatter.string(from: date)
  }
  static func day(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = .current; formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }
  static func line(_ fields: [String: Any]) -> Data? {
    if let data = encode(fields) { return data }
    guard fields["event"] as? String == "share.end" else { return nil }
    var record = fields
    var input = record["input"] as? [String: Any] ?? [:]
    input["types"] = [String](); input["loadErrors"] = [[String: Any]]()
    record["input"] = input
    if let data = encode(record) { return data }
    input["url"] = NSNull(); record["input"] = input
    for key in ["host", "http", "error", "net"] { record[key] = NSNull() }
    var prefs = record["prefs"] as? [String: Any] ?? [:]
    prefs["error"] = NSNull(); record["prefs"] = prefs
    var token = record["token"] as? [String: Any] ?? [:]
    token.removeValue(forKey: "tail4"); record["token"] = token
    return encode(record)
  }
  private static func encode(_ fields: [String: Any]) -> Data? {
    guard JSONSerialization.isValidJSONObject(fields), var data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys, .withoutEscapingSlashes]), data.count < 4096 else { return nil }
    data.append(10)
    return data
  }
}

struct ShareResult {
  var stage = "extract"
  var reason = "no_url_found"
  var http: [String: Any]?
  var error: [String: Any]?
  var ms: [String: Int] = [:]
}
