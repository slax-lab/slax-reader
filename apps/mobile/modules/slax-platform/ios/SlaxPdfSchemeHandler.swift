import Foundation
import WebKit

/// The one document a PDF Reader page may read: `slaxpdf://pdf/pdf/<key>/<documentId>/<size>` on the page's own origin.
struct SlaxPdfSource: Equatable {
  let key: String
  let id: String
  let owner: String?
  let documentId: String
  let size: Int64
  init?(_ raw: [String: Any]?) {
    guard let raw, let id = raw["id"] as? String, SlaxOfflineTask.validId(id), let documentId = raw["documentId"] as? String,
      documentId.range(of: "^[A-Za-z0-9_-]{1,256}$", options: .regularExpression) != nil,
      let size = SlaxOfflineJson.int(raw["size"]), (1...SlaxPdfDescriptor.maxBytes).contains(size) else { return nil }
    let owner = raw["collectionOwner"] as? String
    guard owner == nil || SlaxOfflineTask.validId(owner!) else { return nil }
    let key = SlaxOfflineTask.key(id: id, owner: owner)
    guard SlaxOfflineTask.validKey(key) else { return nil }
    self.key = key; self.id = id; self.owner = owner; self.documentId = documentId; self.size = size
  }
  var path: String { "/pdf/\(key)/\(documentId)/\(size)" }
}

/// Serves PDF byte ranges to the page of one PDF Reader host from the offline engine session of its resource owner.
/// URLs carry only opaque identifiers; the bound source and owner decide what may be read. Main-queue confined.
final class SlaxPdfSchemeHandler: NSObject, WKURLSchemeHandler {
  static let scheme = "slaxpdf"
  /// The bound document and its resource owner while this host may read it; nil once it is not a current PDF host of the active owner.
  var scope: () -> (source: SlaxPdfSource, owner: String)? = { nil }
  var engine: () -> SlaxOfflineEngine = { SlaxOfflineEngine.shared }
  private struct Pending { let task: WKURLSchemeTask; let pageRequest: String; let owner: String; let requestId: String; let reply: SlaxOfflineReply }
  private var pending: [ObjectIdentifier: Pending] = [:]
  private var closed = false
  private static var sequence = 0

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) { start(task) }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { stop(task) }

  func start(_ task: WKURLSchemeTask) {
    guard let url = task.request.url, url.scheme == Self.scheme, url.host == "pdf", url.user == nil, url.password == nil, url.fragment == nil else {
      task.didFailWithError(URLError(.badURL)); return
    }
    let method = task.request.httpMethod ?? "GET"
    if url.path.hasPrefix("/pdf-cancel/") {
      let id = String(url.path.dropFirst("/pdf-cancel/".count))
      if Self.validRequest(id), let entry = pending.first(where: { $0.value.pageRequest == id }) { cancel(entry.key) }
      respond(task, url, status: 204, headers: [:], body: nil); return
    }
    guard !closed, let scope = scope() else { failure(task, url, status: 403, code: SlaxOfflineError.revoked.code); return }
    let source = scope.source
    guard url.path == source.path, ["GET", "HEAD"].contains(method) else { failure(task, url, status: 404, code: SlaxOfflineError.invalid.code); return }
    if method == "HEAD" {
      respond(task, url, status: 200, headers: ["Content-Length": String(source.size), "Accept-Ranges": "bytes"], body: nil); return
    }
    let page = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "request" })?.value ?? ""
    guard Self.validRequest(page) else { failure(task, url, status: 400, code: SlaxOfflineError.invalid.code); return }
    guard let header = task.request.value(forHTTPHeaderField: "Range"), let bounds = Self.range(header, size: source.size) else {
      respond(task, url, status: 416, headers: ["Content-Range": "bytes */\(source.size)"], body: Data("{\"code\":\"http_range_not_satisfiable\",\"status\":416}".utf8)); return
    }
    guard bounds.end - bounds.begin <= SlaxOfflineSession.pdfWindow else { failure(task, url, status: 416, code: "http_range_not_satisfiable"); return }
    Self.sequence += 1
    let key = ObjectIdentifier(task as AnyObject), requestId = "pdf-scheme-\(Self.sequence)"
    let range = SlaxPdfRange(key: source.key, id: source.id, owner: source.owner, documentId: source.documentId, size: source.size, begin: bounds.begin, end: bounds.end)
    let reply = SlaxOfflineReply { [weak self] result in DispatchQueue.main.async { self?.complete(key, url, range, result) } }
    pending[key] = Pending(task: task, pageRequest: page, owner: scope.owner, requestId: requestId, reply: reply)
    engine().servePdfRange(scope.owner, range, requestId: requestId, reply: reply)
  }
  func stop(_ task: WKURLSchemeTask) { cancel(ObjectIdentifier(task as AnyObject), notify: false) }
  /// Releases every request of this host (document replaced, view detached or process gone); the engine stops its work.
  func cancelAll() { Array(pending.keys).forEach { cancel($0, notify: false) } }
  func close() { closed = true; cancelAll() }

  private func cancel(_ key: ObjectIdentifier, notify: Bool = true) {
    guard let entry = pending.removeValue(forKey: key) else { return }
    entry.reply.fail(.cancelled)
    engine().cancel(entry.owner, entry.requestId)
    if notify { entry.task.didFailWithError(URLError(.cancelled)) }
  }
  private func complete(_ key: ObjectIdentifier, _ url: URL, _ range: SlaxPdfRange, _ result: Result<Any?, SlaxOfflineError>) {
    guard let entry = pending.removeValue(forKey: key) else { return }
    switch result {
    case .success(let value as Data) where Int64(value.count) == range.end - range.begin:
      respond(entry.task, url, status: 206, headers: ["Content-Range": "bytes \(range.begin)-\(range.end - 1)/\(range.size)", "Content-Length": String(value.count), "Accept-Ranges": "bytes"], body: value)
    case .success: failure(entry.task, url, status: 502, code: "pdf_length_invalid")
    case .failure(let error): failure(entry.task, url, status: Self.status(error), code: error.code, reported: error.status)
    }
  }
  private func failure(_ task: WKURLSchemeTask, _ url: URL, status: Int, code: String, reported: Int = 0) {
    var body: [String: Any] = ["code": code]
    if reported > 0 { body["status"] = reported }
    respond(task, url, status: status, headers: ["Content-Type": "application/json"], body: try? JSONSerialization.data(withJSONObject: body))
  }
  private func respond(_ task: WKURLSchemeTask, _ url: URL, status: Int, headers: [String: String], body: Data?) {
    var fields = ["Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Type": "application/pdf"]
    headers.forEach { fields[$0.key] = $0.value }
    if fields["Content-Length"] == nil { fields["Content-Length"] = String(body?.count ?? 0) }
    guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields) else { task.didFailWithError(URLError(.badServerResponse)); return }
    task.didReceive(response)
    if let body, !body.isEmpty { task.didReceive(body) }
    task.didFinish()
  }

  static func validRequest(_ value: String) -> Bool { value.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil }
  /// `bytes=<begin>-<end>` or `bytes=<begin>-`, clamped to the document; nil when unsatisfiable or not a single range.
  static func range(_ header: String, size: Int64) -> (begin: Int64, end: Int64)? {
    guard header.range(of: "^bytes=[0-9]{1,16}-[0-9]{0,16}$", options: .regularExpression) != nil else { return nil }
    let parts = header.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
    guard let begin = Int64(parts[0]), begin < size else { return nil }
    let last = parts[1].isEmpty ? size - 1 : Int64(parts[1]) ?? -1
    guard last >= begin else { return nil }
    return (begin, min(last, size - 1) + 1)
  }
  static func status(_ error: SlaxOfflineError) -> Int {
    if (400...599).contains(error.status) && !error.integrity { return error.status }
    switch error.code {
    case SlaxOfflineError.revoked.code: return 403
    case SlaxOfflineError.network.code, SlaxOfflineError.credential.code, SlaxOfflineError.busy.code, SlaxOfflineError.cancelled.code: return 503
    case SlaxOfflineError.timeout.code: return 504
    case SlaxOfflineError.invalid.code: return 400
    default: return 502
    }
  }
}
