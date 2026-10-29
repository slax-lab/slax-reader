const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, writeFileSync, rmSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {tmpdir} = require('node:os');
const path = require('node:path');

test('Swift share records bound private data, guard terminal writes, and reduce incomplete network phases', {skip: process.platform !== 'darwin'}, () => {
  const output = mkdtempSync(path.join(tmpdir(), 'slax-share-diagnostics-'));
  try {
    const sources = ['ShareDiagnosticRecord.swift', 'ShareNetworkMetrics.swift', 'ShareDiagnostics.swift'].map(name => path.resolve(__dirname, '../ios', name));
    const main = path.join(output, 'Host.swift');
    writeFileSync(main, `import Foundation

@main struct Host {
  static func main() {
    let base = Date(timeIntervalSince1970: 1000)
    func date(_ ms: Double) -> Date { base.addingTimeInterval(ms / 1000) }
    var phase = ShareNetworkPhases()
    phase.dnsStart = date(0); phase.dnsEnd = date(10)
    phase.connectStart = date(10); phase.connectEnd = date(60); phase.tlsStart = date(30); phase.tlsEnd = date(60)
    phase.requestStart = date(60); phase.requestEnd = date(70); phase.responseStart = date(170); phase.responseEnd = date(200)
    phase.total = 0.2; phase.reused = false; phase.proxy = true; phase.networkProtocol = "http/1.1"; phase.tlsVersion = "1.3"
    phase.cellular = true; phase.expensive = true; phase.constrained = false; phase.remotePort = 443
    let net = ShareDiagnosticRecord.reduce(phase)
    for (key, expected) in ["dns": 10, "connect": 20, "tls": 30, "send": 10, "wait": 100, "receive": 30, "total": 200, "remotePort": 443] { precondition(net[key] as? Int == expected, key) }
    precondition(net["failedIn"] is NSNull && net["protocol"] as? String == "http/1.1")
    precondition(net["reused"] as? Bool == false && net["proxy"] as? Bool == true)
    precondition(net["cellular"] as? Bool == true && net["expensive"] as? Bool == true && net["constrained"] as? Bool == false)
    phase.responseEnd = nil
    precondition(ShareDiagnosticRecord.reduce(phase)["failedIn"] as? String == "receive")
    phase.responseStart = nil
    precondition(ShareDiagnosticRecord.reduce(phase)["failedIn"] as? String == "wait")
    phase.requestEnd = nil
    precondition(ShareDiagnosticRecord.reduce(phase)["failedIn"] as? String == "send")
    phase.requestStart = nil; phase.tlsEnd = nil; phase.connectEnd = nil
    let tlsFailure = ShareDiagnosticRecord.reduce(phase)
    precondition(tlsFailure["failedIn"] as? String == "tls" && tlsFailure["connect"] as? Int == 20 && tlsFailure["tls"] is NSNull)
    phase.tlsStart = nil
    precondition(ShareDiagnosticRecord.reduce(phase)["failedIn"] as? String == "connect")
    phase.connectStart = nil; phase.dnsEnd = nil
    precondition(ShareDiagnosticRecord.reduce(phase)["failedIn"] as? String == "dns")
    precondition(ShareDiagnosticRecord.reduce(ShareNetworkPhases())["total"] is NSNull)

    let secretURL = "https://fixture.example/private/article?secret=hidden"
    let secretTitle = "Private document title"
    let secretToken = "synthetic-private-token-1234"
    var records: [[String: Any]] = []
    let diagnostics = ShareDiagnostics(os: "iOS 26.1", write: { fields, _, _ in records.append(fields) })
    diagnostics.start(); diagnostics.advance("extract", reason: "no_url_found")
    diagnostics.extraction(items: 2, attachments: 3, types: Array(repeating: String(repeating: "x", count: 100), count: 12))
    diagnostics.content(secretURL, title: secretTitle, from: "js")
    diagnostics.preferences(store: "v1", error: nil, values: ["auth_token": secretToken, "selected_env": "BETA"])
    let native = NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut, userInfo: [NSLocalizedDescriptionKey: secretURL, NSUnderlyingErrorKey: NSError(domain: NSPOSIXErrorDomain, code: 60, userInfo: ["_kCFStreamErrorDomainKey": 1, "_kCFStreamErrorCodeKey": 60])])
    diagnostics.loadError(type: "public.url", error: native)
    diagnostics.duration("extract", since: Date())
    diagnostics.advance("request", reason: "network_timeout")
    diagnostics.update(ShareResult(stage: "request", reason: "network_timeout", error: ShareDiagnosticRecord.error(native)))
    diagnostics.end(outcome: "failed", shown: "Request timed out, please try again.")
    diagnostics.end(outcome: "dismissed", shown: "Collecting", reason: "cancelled")
    precondition(records.count == 2)
    precondition(records[0]["event"] as? String == "share.start" && records[1]["event"] as? String == "share.end")
    precondition(records[0]["app"] is String && records[0]["os"] as? String == "iOS 26.1")
    precondition(records[1]["app"] == nil && records[1]["os"] == nil && records[1]["sync"] == nil)
    precondition(records.filter { $0["app"] != nil || $0["os"] != nil }.count == 1)
    let session = records[0]["share"] as! String
    precondition(session.range(of: "^[0-9a-f]{8}$", options: .regularExpression) != nil && session == records[1]["share"] as? String)
    precondition(records[0]["launch"] as? String == session)
    let input = records[1]["input"] as! [String: Any]
    let types = input["types"] as! [String]
    precondition(types.count == 10 && types.allSatisfy { $0.count <= 80 })
    precondition(input["title"] as? Bool == true && input["urlFrom"] as? String == "js")
    precondition((input["url"] as! [String: Any])["host"] as? String == "fixture.example")
    let token = records[1]["token"] as! [String: Any]
    precondition(token["tail4"] as? String == "1234" && token["len"] as? Int == secretToken.count)
    let error = records[1]["error"] as! [String: Any]
    precondition(error["underlyingDomain"] as? String == NSPOSIXErrorDomain && error["underlyingCode"] as? Int == 60)
    precondition(error["streamDomain"] as? Int == 1 && error["streamCode"] as? Int == 60)
    let line = ShareDiagnosticRecord.line(records[1])!
    precondition(line.count <= 4096 && line.last == 10)
    let text = String(data: line, encoding: .utf8)!
    for secret in [secretURL, secretTitle, secretToken, "/private/article", "secret=hidden"] { precondition(!text.contains(secret)) }
    precondition(ShareDiagnosticRecord.shown(secretURL) == "[redacted]")
    for short: String? in [nil, "", "a", "abc", "abcd"] {
      let redacted = ShareDiagnosticRecord.token(short)
      precondition(!redacted.keys.contains("tail4") && redacted["len"] as? Int == (short ?? "").count)
      let serialized = String(data: ShareDiagnosticRecord.line(redacted)!, encoding: .utf8)!
      precondition(!serialized.contains("tail4"))
    }
    precondition(ShareDiagnosticRecord.token("abcde")["tail4"] as? String == "bcde")
    precondition(ShareDiagnosticRecord.line(["x": String(repeating: "x", count: 4087)])!.count == 4096)
    precondition(ShareDiagnosticRecord.line(["x": String(repeating: "x", count: 4088)]) == nil)
    precondition(ShareDiagnosticRecord.line(["x": Date()]) == nil)
    precondition(ShareDiagnosticRecord.timestamp(base).range(of: "[.][0-9]{3}[+-][0-9]{2}:[0-9]{2}$", options: .regularExpression) != nil)

    for stage in ["context", "extract", "prefs", "auth", "request", "response"] {
      var terminal: [String: Any] = [:]
      let recorder = ShareDiagnostics(os: "iOS 26.1", write: { terminal = $0; _ = $1; precondition($2 == nil) })
      let metrics = ShareNetworkMetrics(); metrics.complete()
      recorder.request(host: "fixture.example", metrics: metrics)
      recorder.advance(stage, reason: "network_other")
      recorder.end(outcome: "dismissed", shown: "Collecting", reason: "cancelled")
      recorder.update(ShareResult(stage: "done", reason: "success"))
      recorder.end(outcome: "success", shown: "Success!")
      precondition(terminal["outcome"] as? String == "dismissed" && terminal["stage"] as? String == stage)
    }
    for outcome in ["success", "failed"] {
      let metrics = ShareNetworkMetrics(); metrics.complete()
      var writes = 0
      let recorder = ShareDiagnostics(os: "iOS 26.1", write: { _, _, received in precondition(received === metrics); writes += 1 })
      recorder.request(host: "fixture.example", metrics: metrics)
      recorder.end(outcome: outcome, shown: "Success!")
      precondition(writes == 1)
    }
    for count in [0, 10, 12, 50, 129, 1000] {
      var terminals: [[String: Any]] = []
      let recorder = ShareDiagnostics(os: "iOS 26.1", write: { terminals.append($0); _ = $1; _ = $2 })
      recorder.advance("extract", reason: "no_url_found")
      recorder.extraction(items: 1, attachments: max(1, count), types: ["public.plain-text"])
      for _ in 0..<count { recorder.loadError(type: "public.url", error: NSError(domain: "Fixture", code: 1)) }
      recorder.end(outcome: "failed", shown: "No content to share")
      recorder.end(outcome: "dismissed", shown: "Collecting")
      precondition(terminals.count == 1)
      let terminal = terminals[0]
      precondition(terminal["reason"] as? String == (count == 0 ? "no_url_found" : "attachment_load_failed"))
      let input = terminal["input"] as! [String: Any]
      precondition((input["loadErrors"] as! [[String: Any]]).count == min(count, 10) && input["url"] is NSNull)
      precondition(input["loadErrorCount"] as? Int == count)
      precondition(input["types"] as? [String] == ["public.plain-text"] && input["title"] as? Bool == false)
      precondition(ShareDiagnosticRecord.line(terminal)!.count <= 4096)
    }
    var largeTerminal: [String: Any] = [:]
    let large = ShareDiagnostics(os: "iOS 26.1", write: { largeTerminal = $0; _ = $1; _ = $2 })
    large.advance("extract", reason: "no_url_found")
    large.extraction(items: 1, attachments: 1000, types: Array(repeating: String(repeating: "漢", count: 80), count: 10))
    for _ in 0..<1000 { large.loadError(type: String(repeating: "漢", count: 80), error: NSError(domain: String(repeating: "界", count: 80), code: 1)) }
    large.end(outcome: "failed", shown: "No content to share")
    precondition((try! JSONSerialization.data(withJSONObject: largeTerminal)).count > 4096)
    let compactLine = ShareDiagnosticRecord.line(largeTerminal)!
    precondition(compactLine.count <= 4096 && compactLine.last == 10)
    let compact = try! JSONSerialization.jsonObject(with: compactLine) as! [String: Any]
    let compactInput = compact["input"] as! [String: Any]
    precondition((compactInput["types"] as! [String]).isEmpty && (compactInput["loadErrors"] as! [[String: Any]]).isEmpty)
    precondition(compactInput["loadErrorCount"] as? Int == 1000 && compact["outcome"] as? String == "failed")
    precondition(compact["share"] as? String == largeTerminal["share"] as? String && compact["stage"] as? String == "extract")
    largeTerminal["host"] = String(repeating: "x", count: 10000)
    precondition(ShareDiagnosticRecord.line(largeTerminal)!.count <= 4096)
    for completed in [false, true] {
      let metrics = ShareNetworkMetrics(), done = DispatchSemaphore(value: 0)
      if completed { metrics.complete() }
      let start = Date()
      metrics.deliver(on: DispatchQueue(label: "fixture")) { value in precondition(value == nil); done.signal() }
      precondition(Date().timeIntervalSince(start) < 0.05)
      precondition(done.wait(timeout: .now() + 1) == .success)
      precondition(Date().timeIntervalSince(start) >= 0.25 && Date().timeIntervalSince(start) < 0.6)
    }
    print("Share diagnostic reducer, privacy, session guard, and bounded metrics checks passed")
  }
}
`);
    const binary = path.join(output, 'host');
    execFileSync('xcrun', ['swiftc', ...sources, main, '-o', binary], {encoding: 'utf8', timeout: 60000});
    assert.match(execFileSync(binary, {encoding: 'utf8', timeout: 10000}), /checks passed/);
  } finally {rmSync(output, {recursive: true, force: true});}
});
