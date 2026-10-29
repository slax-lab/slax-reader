import Foundation

struct SlaxOfflineError: Error {
  let code: String
  var status = 0
  var retryAfter: Int64 = 0
  var retryable = false
  var integrity = false
  var message: String { status > 0 ? "\(code) (\(status))" : code }
  /// Mirrors `offlineFailure`: client errors except 408/429, protocol and integrity failures are not retried.
  var denied: Bool { integrity || (400..<500).contains(status) && ![408, 429].contains(status) }
  static let cancelled = SlaxOfflineError(code: "operation_cancelled")
  static let revoked = SlaxOfflineError(code: "session_changed")
  static let network = SlaxOfflineError(code: "network_unavailable", retryable: true)
  static let timeout = SlaxOfflineError(code: "request_timeout")
  static let credential = SlaxOfflineError(code: "credential_unavailable")
  static let invalid = SlaxOfflineError(code: "invalid_request")
  static let unavailable = SlaxOfflineError(code: "resource_unavailable")
  static let busy = SlaxOfflineError(code: "resource_busy", retryable: true)
  static let oversized = SlaxOfflineError(code: "offline_integrity_invalid", integrity: true)
  static func pdf(_ code: String, status: Int = 502) -> SlaxOfflineError { SlaxOfflineError(code: code, status: status, integrity: true) }
  static func http(_ status: Int, retryAfter: Int64 = 0) -> SlaxOfflineError {
    let code: String
    switch status {
    case 401: code = "http_unauthorized"
    case 403: code = "http_forbidden"
    case 404: code = "http_not_found"
    case 412: code = "http_precondition_failed"
    case 416: code = "http_range_not_satisfiable"
    case 429: code = "http_rate_limited"
    default: code = (500...599).contains(status) ? "http_server_error" : "http_error"
    }
    return SlaxOfflineError(code: code, status: status, retryAfter: retryAfter, retryable: (500...599).contains(status) && retryAfter == 0)
  }
  static func from(_ error: Error) -> SlaxOfflineError {
    if let error = error as? SlaxOfflineError { return error }
    if let error = error as? SlaxFileStoreError { return error == .revoked ? .revoked : error == .oversized ? .oversized : SlaxOfflineError(code: "storage_failed") }
    return SlaxOfflineError(code: "storage_failed")
  }
}

enum SlaxOfflineClock {
  static func now() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded(.down)) }
  /// `retryAfterMs`: delta seconds or an HTTP date, capped at seven days.
  static func retryAfter(_ value: String?, now: Int64 = now()) -> Int64 {
    guard let value, !value.isEmpty else { return 0 }
    var delay: Double
    if value.range(of: "^[0-9]+$", options: .regularExpression) != nil { delay = (Double(value) ?? 0) * 1000 }
    else {
      let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: "GMT")
      formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
      guard let date = formatter.date(from: value) else { return 0 }
      delay = date.timeIntervalSince1970 * 1000 - Double(now)
    }
    guard delay.isFinite, delay > 0 else { return 0 }
    return Int64(min(delay, 7 * 24 * 60 * 60 * 1000))
  }
}

struct SlaxOfflineRetry: Equatable {
  var attempts: Int
  var retryAt: Int64
  var denied: Bool
  var code: String?
  var version: String?
  /// Port of `offlineFailure` in `offline-retry.ts`.
  static func failure(previous: Int, error: SlaxOfflineError, now: Int64, random: Double) -> SlaxOfflineRetry {
    let attempts = min(previous + 1, 30)
    let delay = min(300_000.0, 5000.0 * pow(2.0, Double(min(attempts - 1, 6))))
    let jitter = random.isFinite ? max(0, min(1, random)) : 1
    let retryAt = min(Double(9_007_199_254_740_991), (Double(now) + max(delay * (0.8 + jitter * 0.2), Double(max(0, error.retryAfter)))).rounded(.up))
    return SlaxOfflineRetry(attempts: attempts, retryAt: error.denied ? 0 : Int64(retryAt), denied: error.denied, code: error.code)
  }
  var json: [String: Any] {
    var value: [String: Any] = ["a": attempts, "t": retryAt, "denied": denied]
    if let code { value["code"] = code }
    if let version { value["version"] = version }
    return value
  }
  init(attempts: Int, retryAt: Int64, denied: Bool, code: String? = nil, version: String? = nil) {
    self.attempts = attempts; self.retryAt = retryAt; self.denied = denied; self.code = code; self.version = version
  }
  init?(json: Any?) {
    guard let value = json as? [String: Any], let attempts = SlaxOfflineJson.int(value["a"]), let retryAt = SlaxOfflineJson.int(value["t"]), let denied = value["denied"] as? Bool,
      (0...30).contains(attempts), retryAt >= 0 else { return nil }
    self.init(attempts: Int(attempts), retryAt: retryAt, denied: denied, code: SlaxOfflineJson.text(value["code"], limit: 64), version: SlaxOfflineJson.text(value["version"], limit: 256))
  }
}

struct SlaxOfflineImage: Equatable {
  var url: String
  var state: String
  var attempts: Int
  var retryAt: Int64
  func eligible(_ now: Int64) -> Bool { state == "pending" || state == "failed" && retryAt <= now }
}

/// `bookmark/<key>/offline.json`. `version == nil` marks content adopted without a known bookmark version.
struct SlaxOfflineManifest: Equatable {
  var id: String
  var owner: String?
  var kind: String
  var version: String?
  var size: Int64
  var images: [SlaxOfflineImage]
  var retry: SlaxOfflineRetry?
  static func placeholder(_ task: SlaxOfflineTask) -> SlaxOfflineManifest {
    SlaxOfflineManifest(id: task.id, owner: task.collectionOwner, kind: task.kind, version: nil, size: 0, images: [], retry: nil)
  }
  func encoded() throws -> Data {
    let value: [String: Any] = ["v": 2, "id": id, "owner": owner ?? NSNull(), "kind": kind, "version": version ?? NSNull(), "size": size,
      "images": images.map { ["u": $0.url, "s": $0.state, "a": $0.attempts, "t": $0.retryAt] as [String: Any] }, "retry": retry?.json ?? NSNull()]
    return try JSONSerialization.data(withJSONObject: value)
  }
  init(id: String, owner: String?, kind: String, version: String?, size: Int64, images: [SlaxOfflineImage], retry: SlaxOfflineRetry?) {
    self.id = id; self.owner = owner; self.kind = kind; self.version = version; self.size = size; self.images = images; self.retry = retry
  }
  init?(data: Data) {
    guard let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], SlaxOfflineJson.int(value["v"]) == 2,
      let id = value["id"] as? String, id.isEmpty || SlaxOfflineTask.validId(id), let kind = value["kind"] as? String, ["article", "pdf"].contains(kind),
      let size = SlaxOfflineJson.int(value["size"]), size >= 0, let rawImages = value["images"] as? [Any] else { return nil }
    let owner = value["owner"] as? String, version = value["version"] as? String
    guard owner == nil || SlaxOfflineTask.validId(owner!), version == nil || SlaxOfflineTask.validVersion(version!) else { return nil }
    var images: [SlaxOfflineImage] = []
    for raw in rawImages {
      guard let image = raw as? [String: Any], let url = image["u"] as? String, url.utf8.count <= 8192, let state = image["s"] as? String,
        ["pending", "ready", "failed", "denied"].contains(state), let attempts = SlaxOfflineJson.int(image["a"]), let retryAt = SlaxOfflineJson.int(image["t"]) else { return nil }
      images.append(SlaxOfflineImage(url: url, state: state, attempts: Int(max(0, min(30, attempts))), retryAt: max(0, retryAt)))
    }
    self.init(id: id, owner: owner, kind: kind, version: version, size: size, images: images, retry: value["retry"] is NSNull ? nil : SlaxOfflineRetry(json: value["retry"]))
  }
}

enum SlaxOfflineJson {
  static func int(_ value: Any?) -> Int64? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let double = number.doubleValue
    guard double.isFinite, double.rounded() == double, abs(double) <= 9_007_199_254_740_991 else { return nil }
    return Int64(double)
  }
  static func text(_ value: Any?, limit: Int) -> String? {
    guard let value = value as? String, !value.isEmpty, value.utf8.count <= limit, !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else { return nil }
    return value
  }
}

struct SlaxOfflineTask: Equatable {
  let key: String
  let id: String
  let collectionOwner: String?
  let kind: String
  let manual: Bool
  let version: String
  var domain: String { collectionOwner == nil ? "personal" : "collection" }
  static func validId(_ value: String) -> Bool { value.utf8.count <= 200 && value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil }
  static func validKey(_ value: String) -> Bool { value.utf8.count <= 240 && value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil }
  static func validVersion(_ value: String) -> Bool { SlaxOfflineJson.text(value, limit: 256) != nil }
  static func key(id: String, owner: String?) -> String { owner.map { "collection-\($0)-\(id)" } ?? id }
  /// Validates `{key, id, collectionOwner?}` and returns the owner context.
  static func access(_ value: [String: Any]) throws -> (key: String, id: String, owner: String?) {
    guard let key = value["key"] as? String, let id = value["id"] as? String, validId(id) else { throw SlaxOfflineError.invalid }
    let owner = value["collectionOwner"] as? String
    guard owner == nil || validId(owner!), Self.key(id: id, owner: owner) == key, validKey(key) else { throw SlaxOfflineError.invalid }
    return (key, id, owner)
  }
  init(key: String, id: String, collectionOwner: String?, kind: String, manual: Bool, version: String) {
    self.key = key; self.id = id; self.collectionOwner = collectionOwner; self.kind = kind; self.manual = manual; self.version = version
  }
  init(_ value: [String: Any]) throws {
    let access = try Self.access(value)
    guard let kind = value["kind"] as? String, ["article", "pdf"].contains(kind), let version = value["version"] as? String, Self.validVersion(version) else { throw SlaxOfflineError.invalid }
    self.init(key: access.key, id: access.id, collectionOwner: access.owner, kind: kind, manual: value["manual"] as? Bool ?? false, version: version)
  }
}

struct SlaxOfflineScope {
  let owner: String
  let scope: String
  let scopeId: String
  let origin: String
  let root: URL
  let userAgent: String
  let clientType: String
  let clientVersion: String
  let policy: SlaxReaderSecurity
  let allowHTTP: Bool
  init(_ value: [String: Any], root resolve: (String) throws -> URL, allowHTTP: Bool) throws {
    guard let owner = value["owner"] as? String, owner.utf8.count <= 128, owner.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
      let scope = SlaxOfflineJson.text(value["scope"], limit: 160), let raw = value["origin"] as? String, let parts = URLComponents(string: raw),
      let scheme = parts.scheme?.lowercased(), let host = parts.host?.lowercased(), !host.isEmpty, parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil, ["", "/"].contains(parts.path),
      scheme == "https" || allowHTTP && scheme == "http" && ["127.0.0.1", "localhost"].contains(host),
      let directory = value["directory"] as? String, let userAgent = SlaxOfflineJson.text(value["userAgent"], limit: 256),
      let clientType = value["clientType"] as? String, clientType == "ios" || clientType == "android", let clientVersion = SlaxOfflineJson.text(value["clientVersion"], limit: 64) else { throw SlaxOfflineError.invalid }
    let origin = "\(scheme)://\(host)" + (parts.port.map { ":\($0)" } ?? "")
    let hosts = (value["protectedHosts"] as? [String]) ?? [host], proxies = (value["imageProxyOrigins"] as? [String]) ?? [origin]
    do { policy = try SlaxReaderSecurity(hosts, imageProxyOrigins: proxies) } catch { throw SlaxOfflineError.invalid }
    self.owner = owner; self.scope = scope; self.origin = origin; self.userAgent = userAgent; self.clientType = clientType; self.clientVersion = clientVersion; self.allowHTTP = allowHTTP
    scopeId = Data(scope.utf8).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    do { root = try resolve(directory) } catch { throw SlaxOfflineError.invalid }
  }
}

struct SlaxPdfDescriptor: Equatable {
  let filename: String
  let size: Int64
  let documentId: String
  let source: String
  let textStatus: String
  let pages: Int64?
  static let maxBytes: Int64 = 50 * 1024 * 1024
  init?(_ value: Any?) {
    guard let pdf = value as? [String: Any], let documentId = SlaxOfflineJson.text(pdf["document_id"], limit: 256), let size = SlaxOfflineJson.int(pdf["size"]), (1...Self.maxBytes).contains(size),
      let filename = pdf["filename"] as? String, filename.utf8.count <= 4096, let source = pdf["source"] as? String, ["url", "upload"].contains(source),
      let textStatus = pdf["text_status"] as? String, ["pending", "ready", "empty", "failed"].contains(textStatus) else { return nil }
    let pages = pdf["pages"].flatMap { $0 is NSNull ? nil : $0 }
    if let pages { guard let count = SlaxOfflineJson.int(pages), count >= 1 else { return nil }; self.pages = count } else { self.pages = nil }
    self.filename = filename; self.size = size; self.documentId = documentId; self.source = source; self.textStatus = textStatus
  }
  var json: [String: Any] {
    var value: [String: Any] = ["filename": filename, "size": size, "document_id": documentId, "source": source, "text_status": textStatus]
    if let pages { value["pages"] = pages }
    return value
  }
  func result(id: String) -> [String: Any] {
    var value = json; value["url"] = "/v1/bookmark/pdf?bookmark_uid=" + (id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_.!~*'()"))) ?? id); return value
  }
  func same(_ other: SlaxPdfDescriptor?) -> Bool { other?.documentId == documentId && other?.size == size }
}

/// `pdf/v2/<scopeId>/<key>/part.json`; kept after completion as the identity record of `document.pdf`.
struct SlaxPdfPart: Equatable {
  let documentId: String
  let size: Int64
  var committed: Int64
  var json: [String: Any] { ["document_id": documentId, "size": size, "committed": committed] }
  init(documentId: String, size: Int64, committed: Int64) { self.documentId = documentId; self.size = size; self.committed = committed }
  init?(_ data: Data?) {
    guard let data, let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let documentId = SlaxOfflineJson.text(value["document_id"], limit: 256),
      let size = SlaxOfflineJson.int(value["size"]), let committed = SlaxOfflineJson.int(value["committed"]), (1...SlaxPdfDescriptor.maxBytes).contains(size), (0...size).contains(committed) else { return nil }
    self.init(documentId: documentId, size: size, committed: committed)
  }
  func matches(_ descriptor: SlaxPdfDescriptor) -> Bool { documentId == descriptor.documentId && size == descriptor.size }
}

/// Paths of the engine layout and the small JSON records stored in it.
struct SlaxOfflineLayout {
  let scopeId: String
  static func bookmark(_ key: String) -> String { "bookmark/\(key)" }
  static func content(_ key: String) -> String { "bookmark/\(key)/content.html" }
  static func manifest(_ key: String) -> String { "bookmark/\(key)/offline.json" }
  static func images(_ key: String) -> String { "bookmark/\(key)/images" }
  func pdf(_ key: String) -> String { "pdf/v2/\(scopeId)/\(key)" }
  func descriptor(_ key: String) -> String { pdf(key) + "/descriptor.json" }
  func document(_ key: String) -> String { pdf(key) + "/document.pdf" }
  func partial(_ key: String) -> String { pdf(key) + "/document.pdf.part" }
  func part(_ key: String) -> String { pdf(key) + "/part.json" }

  static func readManifest(_ store: SlaxFileStore, _ key: String) throws -> SlaxOfflineManifest? {
    guard let data = try store.read(manifest(key), limit: 4 * 1024 * 1024) else { return nil }
    return SlaxOfflineManifest(data: data)
  }
  static func writeManifest(_ store: SlaxFileStore, _ key: String, _ value: SlaxOfflineManifest) throws {
    let data = try value.encoded()
    guard data.count <= 4 * 1024 * 1024 else { throw SlaxFileStoreError.oversized }
    _ = try store.write(manifest(key), bytes: data)
  }
  func readDescriptor(_ store: SlaxFileStore, _ key: String) throws -> SlaxPdfDescriptor? {
    guard let data = try store.read(descriptor(key), limit: 64 * 1024), let value = try? JSONSerialization.jsonObject(with: data) else { return nil }
    return SlaxPdfDescriptor(value)
  }
  func readPart(_ store: SlaxFileStore, _ key: String) throws -> SlaxPdfPart? { SlaxPdfPart(try store.read(part(key), limit: 4096)) }
  func writePart(_ store: SlaxFileStore, _ key: String, _ value: SlaxPdfPart) throws {
    _ = try store.write(part(key), bytes: try JSONSerialization.data(withJSONObject: value.json))
  }
  /// Size of the committed document for a complete PDF identity, otherwise nil.
  func completeDocument(_ store: SlaxFileStore, _ key: String) throws -> (SlaxPdfPart, Int64)? {
    guard let part = try readPart(store, key), part.committed == part.size, let size = try store.size(document(key)), size == part.size else { return nil }
    return (part, size)
  }
  /// The size that completes a manifest of this kind: `content.html` or the complete `document.pdf`.
  func contentSize(_ store: SlaxFileStore, _ key: String, kind: String) throws -> Int64? {
    kind == "pdf" ? try completeDocument(store, key)?.1 : try store.size(Self.content(key))
  }
}
