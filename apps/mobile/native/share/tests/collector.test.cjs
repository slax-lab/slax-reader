const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = require('node:fs');
const {execFileSync, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {createServer} = require('node:http');
const {tmpdir} = require('node:os');
const path = require('node:path');
const execute = promisify(execFile);

test('real Swift collector preserves requests and messages while recording status, network errors, and cancellation', {skip: process.platform !== 'darwin', timeout: 90000}, async () => {
  const output = mkdtempSync(path.join(tmpdir(), 'slax-share-collector-'));
  let mode = 'success', received = 0, serverFailure;
  const server = createServer((request, response) => {
    let body = ''; request.on('data', value => { body += value; });
    request.on('end', () => {
      received++;
      try {
        assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/bookmark/add_url');
        assert.equal(request.headers.authorization, 'Bearer synthetic-private-token-1234');
        assert.equal(request.headers['content-type'], 'application/json'); assert.equal(request.headers['user-agent'], 'SlaxReader/iOS 1.2.3 (42)');
        assert.deepEqual(JSON.parse(body), {target_url: 'https://fixture.test/private?secret=123', target_title: 'Private fixture title'});
      } catch (error) { serverFailure = error; response.destroy(); return; }
      if (['timeout', 'cancel'].includes(mode)) return;
      if (mode === 'disconnect') { response.destroy(); return; }
      const status = {success: 200, empty: 204, unauthorized: 401, bad: 400, badEmpty: 400, limited: 429, service: 503, redirect: 302}[mode];
      response.writeHead(status, {'Content-Type': 'application/json', 'CF-Ray': 'fixture-ray-SJC', ...(mode === 'redirect' ? {Location: '/must-not-follow'} : {})});
      response.end(JSON.stringify({data: 'ERROR_PARAM', code: 40001, message: mode === 'badEmpty' ? '' : 'Original server message: https://private.test/token?secret=hidden'}));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const contents = path.join(output, 'Fixture.app/Contents');
    mkdirSync(path.join(contents, 'MacOS'), {recursive: true});
    writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>host</string><key>CFBundleIdentifier</key><string>app.slax.reader.fixture</string><key>CFBundleShortVersionString</key><string>1.2.3</string><key>CFBundleVersion</key><string>42</string><key>SlaxApiBaseURL</key><string>http://127.0.0.1:${server.address().port}</string></dict></plist>`);
    const main = path.join(output, 'Host.swift');
    writeFileSync(main, `import Foundation
enum SharedPreferences {
  static func read(report: (String, String?) -> Void) throws -> [String: Any] {
    let mode = CommandLine.arguments[1]
    if mode == "prefs" { report("legacy", "CocoaError"); throw CocoaError(.fileReadCorruptFile) }
    report("v1", nil)
    if mode == "noToken" { return [:] }
    return ["auth_token": "synthetic-private-token-1234", "_slax_sign_out_pending_v1": mode == "signedOut"]
  }
}
@main struct Host {
  static func main() async {
    let mode = CommandLine.arguments[1]
    var records: [[String: Any]] = [], terminalMetrics: ShareNetworkMetrics?
    let diagnostics = ShareDiagnostics(os: "iOS fixture", write: { fields, _, metrics in records.append(fields); if let metrics { terminalMetrics = metrics } })
    diagnostics.start(); diagnostics.advance("extract", reason: "no_url_found")
    diagnostics.content("https://fixture.test/private?secret=123", title: "Private fixture title", from: "url")
    let task = Task { try await ShareCollector.collect(content: mode == "invalid" ? "not a URL" : "https://fixture.test/private?secret=123", title: "Private fixture title", diagnostics: diagnostics) }
    if mode == "cancel" {
      try? await Task.sleep(nanoseconds: 200_000_000)
      diagnostics.end(outcome: "dismissed", shown: "Collecting", reason: "cancelled")
      task.cancel()
    }
    var message = "Success!"
    do { _ = try await task.value; diagnostics.end(outcome: "success", shown: message) }
    catch ShareFailure.message(let value) { message = value; diagnostics.end(outcome: "failed", shown: message) }
    catch { message = "Collection failed, please try again."; diagnostics.end(outcome: "failed", shown: message) }
    precondition(records.count == 2)
    var terminal = records[1]
    if let terminalMetrics {
      let net: [String: Any]? = await withCheckedContinuation { continuation in
        terminalMetrics.deliver(on: DispatchQueue(label: "fixture.metrics")) { continuation.resume(returning: $0) }
      }
      terminal["net"] = ShareDiagnosticRecord.value(net)
    }
    let expectations: [String: (String, String)] = [
      "success": ("success", "Success!"), "empty": ("success", "Success!"),
      "unauthorized": ("http_401", "Auth expired, please reopen the app to login again."),
      "bad": ("http_400", "Original server message: https://private.test/token?secret=hidden"),
      "badEmpty": ("http_400", "Collection failed, please try again."),
      "limited": ("http_429", "Collection failed, please try again."), "service": ("http_5xx", "Collection failed, please try again."),
      "redirect": ("http_other", "Collection failed, please try again."),
      "timeout": ("network_timeout", "Request timed out, please try again."),
      "disconnect": ("network_offline", "Collection failed, please try again."),
      "signedOut": ("signed_out", "Not have auth info, please login first."), "noToken": ("no_token", "Not have auth info, please login first."),
      "prefs": ("prefs_corrupt", "Collection failed, please try again."), "invalid": ("no_url_found", "Not have URL content to collect."),
      "cancel": ("cancelled", "Collection failed, please try again."),
    ]
    let expected = expectations[mode]!
    precondition(terminal["reason"] as? String == expected.0, mode + " reason")
    precondition(message == expected.1, mode + " message")
    if let http = terminal["http"] as? [String: Any] {
      precondition(http["cfRay"] as? String == "fixture-ray-SJC")
      if ["success", "empty"].contains(mode) { precondition(http["errorName"] is NSNull && http["code"] is NSNull) }
      else { precondition(http["errorName"] as? String == "ERROR_PARAM" && http["code"] as? Int == 40001) }
    }
    if mode == "cancel" { precondition(terminal["outcome"] as? String == "dismissed" && terminal["stage"] as? String == "request" && terminalMetrics == nil) }
    if ["signedOut", "noToken", "prefs", "invalid", "cancel"].contains(mode) { precondition(terminal["http"] is NSNull && terminal["net"] is NSNull) }
    else {
      precondition(terminal["net"] is [String: Any], mode + " task metrics")
      if ["timeout", "disconnect"].contains(mode) {
        precondition((terminal["error"] as? [String: Any])?["domain"] as? String == NSURLErrorDomain)
        precondition((terminal["net"] as? [String: Any])?["failedIn"] as? String == "wait")
      }
    }
    let text = String(data: ShareDiagnosticRecord.line(terminal)!, encoding: .utf8)!
    for secret in ["Private fixture title", "synthetic-private-token-1234", "/private?secret", "private.test", "secret=hidden"] { precondition(!text.contains(secret)) }
    print("PASS " + mode)
  }
}
`);
    const binary = path.join(contents, 'MacOS/host');
    const sources = ['ShareCollector.swift', 'ShareDiagnosticRecord.swift', 'ShareDiagnostics.swift', 'ShareNetworkMetrics.swift'].map(name => path.resolve(__dirname, '../ios', name));
    execFileSync('xcrun', ['swiftc', ...sources, main, '-o', binary], {encoding: 'utf8', timeout: 60000});
    for (mode of ['success', 'empty', 'unauthorized', 'bad', 'badEmpty', 'limited', 'service', 'redirect', 'disconnect', 'timeout', 'cancel', 'signedOut', 'noToken', 'prefs', 'invalid']) {
      const before = received;
      const {stdout} = await execute(binary, [mode], {encoding: 'utf8', timeout: 25000});
      if (serverFailure) throw serverFailure;
      assert.match(stdout, new RegExp(`PASS ${mode}`));
      assert.equal(received - before, ['signedOut', 'noToken', 'prefs', 'invalid'].includes(mode) ? 0 : 1, mode);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(output, {recursive: true, force: true}); }
});
