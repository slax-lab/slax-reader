import Darwin
import Foundation

final class ShareDiagnostics: @unchecked Sendable {
  private let lock = NSLock()
  private let share = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(8)).lowercased()
  private let started = Date()
  private let app: String
  private let os: String
  private var terminal = false
  private var stageStarted = Date()
  private var result = ShareResult(stage: "context", reason: "no_extension_context")
  private var input: [String: Any] = ["items": 0, "attachments": 0, "types": [], "urlFrom": NSNull(), "loadErrors": [], "loadErrorCount": 0, "url": NSNull(), "title": false]
  private var prefs: [String: Any] = ["store": "none", "error": NSNull(), "signOutPending": false]
  private var token = ShareDiagnosticRecord.token(nil)
  private var environment = "default"
  private var host: String?
  private var metrics: ShareNetworkMetrics?
  private let write: ([String: Any], Date, ShareNetworkMetrics?) -> Void
  init(os: String, write: (([String: Any], Date, ShareNetworkMetrics?) -> Void)? = nil) {
    let info = Bundle.main.infoDictionary ?? [:]
    app = "\(info["CFBundleShortVersionString"] as? String ?? "") (\(info["CFBundleVersion"] as? String ?? ""))"
    self.os = os
    self.write = write ?? { ShareDiagnosticWriter.enqueue($0, at: $1, metrics: $2) }
  }
  private func common(_ event: String, at date: Date) -> [String: Any] {
    ["v": 1, "ts": ShareDiagnosticRecord.timestamp(date), "src": "share-ios", "launch": share, "share": share, "event": event]
  }
  func start() {
    var fields = common("share.start", at: started)
    fields["app"] = app; fields["os"] = os
    write(fields, started, nil)
  }
  func advance(_ stage: String, reason: String) {
    lock.lock(); defer { lock.unlock() }
    guard !terminal else { return }
    result.stage = stage; result.reason = reason; stageStarted = Date()
  }
  func extraction(items: Int, attachments: Int, types: [String]) {
    lock.lock(); defer { lock.unlock() }
    guard !terminal else { return }
    input["items"] = items; input["attachments"] = attachments; input["types"] = Array(types.prefix(10)).map { String($0.prefix(80)) }
  }
  func content(_ content: String?, title: String?, from: String?) {
    lock.lock(); defer { lock.unlock() }
    guard !terminal else { return }
    input["url"] = ShareDiagnosticRecord.url(content); input["title"] = title != nil; input["urlFrom"] = ShareDiagnosticRecord.value(from)
  }
  func loadError(type: String, error: Error) {
    lock.lock(); defer { lock.unlock() }
    guard !terminal else { return }
    input["loadErrorCount"] = (input["loadErrorCount"] as? Int ?? 0) + 1
    result.reason = "attachment_load_failed"
    var errors = input["loadErrors"] as? [[String: Any]] ?? []
    guard errors.count < 10 else { return }
    let error = error as NSError
    errors.append(["type": String(type.prefix(80)), "domain": ShareDiagnosticRecord.value(ShareDiagnosticRecord.identifier(error.domain)), "code": error.code])
    input["loadErrors"] = errors
  }
  func duration(_ stage: String, since date: Date) {
    lock.lock(); defer { lock.unlock() }
    guard !terminal else { return }
    result.ms[stage] = ShareDiagnosticRecord.milliseconds(date, Date())
  }
  func preferences(store: String, error: String?, values: [String: Any]?) {
    lock.lock(); defer { lock.unlock() }
    guard !terminal else { return }
    prefs = ["store": store, "error": ShareDiagnosticRecord.value(ShareDiagnosticRecord.identifier(error)), "signOutPending": values?["_slax_sign_out_pending_v1"] as? Bool == true]
    token = ShareDiagnosticRecord.token(values?["auth_token"] as? String)
    let selected = values?["selected_env"] as? String
    environment = ["PRODUCTION", "BETA"].contains(selected) ? selected! : "default"
  }
  func request(host: String?, metrics: ShareNetworkMetrics) {
    lock.lock(); defer { lock.unlock() }
    guard !terminal else { return }
    self.host = host; self.metrics = metrics
  }
  func update(_ value: ShareResult) {
    lock.lock(); defer { lock.unlock() }
    guard !terminal else { return }
    let durations = result.ms.merging(value.ms) { _, new in new }
    result = value; result.ms = durations
  }
  func end(outcome: String, shown: String, reason: String? = nil) {
    lock.lock()
    guard !terminal else { lock.unlock(); return }
    terminal = true
    let now = Date()
    var fields = common("share.end", at: now)
    var durations: [String: Any] = ["extract": NSNull(), "prefs": NSNull(), "request": NSNull(), "total": ShareDiagnosticRecord.value(ShareDiagnosticRecord.milliseconds(started, now))]
    for (stage, duration) in result.ms { durations[stage] = duration }
    if ["extract", "prefs", "request"].contains(result.stage), result.ms[result.stage] == nil { durations[result.stage] = ShareDiagnosticRecord.value(ShareDiagnosticRecord.milliseconds(stageStarted, now)) }
    fields.merge([
      "outcome": outcome, "stage": result.stage, "reason": reason ?? result.reason, "input": input, "prefs": prefs, "token": token,
      "env": environment, "host": ShareDiagnosticRecord.value(host), "http": ShareDiagnosticRecord.value(result.http), "error": ShareDiagnosticRecord.value(result.error),
      "net": NSNull(), "ms": durations, "shown": ShareDiagnosticRecord.shown(shown),
    ]) { _, new in new }
    let metrics = outcome == "dismissed" ? nil : self.metrics
    lock.unlock()
    write(fields, now, metrics)
  }
}

private enum ShareDiagnosticWriter {
  private static let queue = DispatchQueue(label: "app.slax.reader.share.diagnostics", qos: .utility)
  private static let lock = NSLock()
  private static var pending = 0
  private static var failures = 0
  static func enqueue(_ fields: [String: Any], at date: Date, metrics: ShareNetworkMetrics? = nil) {
    lock.lock()
    guard pending < 32 else { lock.unlock(); return }
    pending += 1; lock.unlock()
    queue.async {
      let finish: ([String: Any]?) -> Void = { net in
        defer { lock.lock(); pending -= 1; lock.unlock() }
        guard failures < 3 else { return }
        var record = fields
        if let net { record["net"] = net }
        guard let data = ShareDiagnosticRecord.line(record) else { return }
        if append(data, at: date, launch: fields["launch"] as? String ?? "") { failures = 0 } else { failures += 1 }
      }
      if let metrics { metrics.deliver(on: queue, finish) } else { finish(nil) }
    }
  }
  private static func append(_ data: Data, at date: Date, launch: String) -> Bool {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.slax.reader") else { return false }
    let directory = root.appendingPathComponent("diagnostics", isDirectory: true)
    do {
      #if os(iOS)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      #else
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      #endif
    } catch { return false }
    let path = directory.appendingPathComponent("\(ShareDiagnosticRecord.day(date)).share-ios.ndjson").path
    let descriptor = open(path, O_WRONLY | O_APPEND | O_CREAT, 0o600)
    guard descriptor >= 0 else { return false }
    defer { close(descriptor) }
    guard flock(descriptor, LOCK_EX) == 0 else { return false }
    defer { flock(descriptor, LOCK_UN) }
    var status = stat()
    guard stat(path, &status) == 0 else { return false }
    guard status.st_size < 524288 else { return true }
    let count = data.withUnsafeBytes { write(descriptor, $0.baseAddress, $0.count) }
    guard count == data.count else { return false }
    if status.st_size + Int64(count) >= 524288, let marker = ShareDiagnosticRecord.line(["v": 1, "ts": ShareDiagnosticRecord.timestamp(date), "src": "share-ios", "launch": launch, "event": "log.truncated"]) {
      return marker.withUnsafeBytes { write(descriptor, $0.baseAddress, $0.count) } == marker.count
    }
    return true
  }
}
