const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = require('node:fs');
const {execFileSync, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {createServer} = require('node:http');
const {tmpdir} = require('node:os');
const path = require('node:path');
const execute = promisify(execFile);

test('real Swift collector bounds acknowledgements and recovery while preserving diagnostics and cancellation', {skip: process.platform !== 'darwin', timeout: 180000}, async t => {
  const output = mkdtempSync(path.join(tmpdir(), 'slax-share-collector-'));
  const stalledLookups = ['lookupStall', 'lookupBodyStall', 'lookupPartialBody', 'lookupUnfinishedBody'];
  const recovery = ['recovered', 'absent', 'lookupMissing', 'lookupMalformed', 'lookupNumber', 'lookupString', 'lookup204', 'lookupUnauthorized', 'lookupUnavailable', 'lookupBadCode', 'lookupBadHTTP', 'lookupDisconnect', ...stalledLookups, 'partialHeaders', 'beta', 'cancelLookup'];
  const stalledErrors = ['unauthorizedStall', 'badStall', 'serviceTrickle'];
  let mode = 'success', serverFailure;
  const received = [];
  const respond = environment => (request, response) => {
    let body = ''; request.on('data', value => { body += value; });
    request.on('end', () => {
      const lookup = request.url === '/v1/bookmark/exists';
      const record = {environment, path: request.url, at: performance.now(), closedAt: null};
      received.push(record);
      response.on('close', () => { record.closedAt = performance.now(); });
      try {
        assert.equal(environment, mode === 'beta' ? 'beta' : 'production');
        assert.equal(request.method, 'POST');
        assert.equal(request.url, lookup ? '/v1/bookmark/exists' : '/v1/bookmark/add_url');
        assert.equal(request.headers.authorization, 'Bearer synthetic-private-token-1234');
        assert.equal(request.headers['content-type'], 'application/json'); assert.equal(request.headers['user-agent'], 'SlaxReader/iOS 1.2.3 (42)');
        assert.deepEqual(JSON.parse(body), {target_url: 'https://fixture.test/private?secret=123', ...(!lookup ? {target_title: 'Private fixture title'} : {})});
      } catch (error) { serverFailure = error; response.destroy(); return; }
      if (lookup) {
        if (mode === 'lookupStall') return;
        if (mode === 'lookupDisconnect') { response.destroy(); return; }
        if (mode === 'lookupBadHTTP') { response.socket.end('NOT HTTP\r\n\r\n'); return; }
        const status = {lookup204: 204, lookupUnauthorized: 401, lookupUnavailable: 503}[mode] ?? 200;
        response.writeHead(status, {'Content-Type': 'application/json', 'CF-Ray': 'lookup-must-not-replace-create'});
        response.flushHeaders();
        if (['lookupBodyStall', 'cancelLookup'].includes(mode)) return;
        if (mode === 'lookupPartialBody') { response.write('{"code":200,"data":{"exists":'); return; }
        const exists = {absent: false, lookupNumber: 1, lookupString: 'true'}[mode] ?? true;
        const payload = JSON.stringify({code: mode === 'lookupBadCode' ? 500 : 200, message: 'ok', data: mode === 'lookupMissing' ? {} : {exists}});
        if (mode === 'lookupUnfinishedBody') { response.write(payload); return; }
        response.end(mode === 'lookupMalformed' ? '{invalid' : payload);
        return;
      }
      if (mode === 'partialHeaders') {
        response.socket.write('HTTP/1.1 200 OK\r\nX-Partial: ');
        const timer = setInterval(() => response.socket?.write('x'), 100);
        response.on('close', () => clearInterval(timer));
        return;
      }
      if (recovery.includes(mode) || mode === 'cancel') return;
      if (mode === 'disconnect') { response.destroy(); return; }
      const status = {success: 200, empty: 204, successStall: 200, unauthorized: 401, unauthorizedStall: 401, bad: 400, badEmpty: 400, badStall: 400, limited: 429, service: 503, serviceTrickle: 503, redirect: 302}[mode];
      response.writeHead(status, {'Content-Type': 'application/json', 'CF-Ray': 'fixture-ray-SJC', ...(mode === 'redirect' ? {Location: '/must-not-follow'} : {})});
      if (mode === 'successStall' || stalledErrors.includes(mode)) {
        response.flushHeaders();
        if (mode === 'serviceTrickle') {
          const timer = setInterval(() => response.write(' '), 100);
          response.on('close', () => clearInterval(timer));
        }
        return;
      }
      response.end(JSON.stringify({data: 'ERROR_PARAM', code: 40001, message: mode === 'badEmpty' ? '' : 'Original server message: https://private.test/token?secret=hidden'}));
    });
  };
  const server = createServer(respond('production')), betaServer = createServer(respond('beta'));
  await Promise.all([server, betaServer].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
  try {
    const contents = path.join(output, 'Fixture.app/Contents');
    const executableDirectory = path.join(contents, 'MacOS');
    mkdirSync(executableDirectory, {recursive: true});
    writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>host</string><key>CFBundleIdentifier</key><string>app.slax.reader.fixture</string><key>CFBundleShortVersionString</key><string>1.2.3</string><key>CFBundleVersion</key><string>42</string><key>SlaxApiBaseURL</key><string>http://127.0.0.1:${server.address().port}</string><key>SlaxApiBetaURL</key><string>http://127.0.0.1:${betaServer.address().port}</string></dict></plist>`);
    const main = path.join(output, 'Host.swift');
    writeFileSync(main, `import Foundation
enum SharedPreferences {
  static func read(report: (String, String?) -> Void) throws -> [String: Any] {
    let mode = CommandLine.arguments[1]
    if mode == "prefs" { report("legacy", "CocoaError"); throw CocoaError(.fileReadCorruptFile) }
    report("v1", nil)
    if mode == "noToken" { return [:] }
    return ["auth_token": "synthetic-private-token-1234", "_slax_sign_out_pending_v1": mode == "signedOut", "selected_env": mode == "beta" ? "BETA" : "PRODUCTION"]
  }
}
@main struct Host {
  static func main() async {
    let mode = CommandLine.arguments[1]
    var records: [[String: Any]] = [], terminalMetrics: ShareNetworkMetrics?
    let diagnostics = ShareDiagnostics(os: "iOS fixture", write: { fields, _, metrics in records.append(fields); if let metrics { terminalMetrics = metrics } })
    diagnostics.start(); diagnostics.advance("extract", reason: "no_url_found")
    diagnostics.content("https://fixture.test/private?secret=123", title: "Private fixture title", from: "url")
    let started = DispatchTime.now()
    let task = Task { try await ShareCollector.collect(content: mode == "invalid" ? "not a URL" : "https://fixture.test/private?secret=123", title: "Private fixture title", diagnostics: diagnostics) }
    if mode == "cancel" || mode == "cancelLookup" {
      try? await Task.sleep(nanoseconds: mode == "cancel" ? 200_000_000 : 5_500_000_000)
      diagnostics.end(outcome: "dismissed", shown: "Collecting", reason: "cancelled")
      task.cancel()
    }
    var message = "Success!"
    do { _ = try await task.value; diagnostics.end(outcome: "success", shown: message) }
    catch ShareFailure.message(let value) { message = value; diagnostics.end(outcome: "failed", shown: message) }
    catch { message = "Collection failed, please try again."; diagnostics.end(outcome: "failed", shown: message) }
    let elapsedMs = Int((DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000)
    try? await Task.sleep(nanoseconds: 100_000_000)
    precondition(records.count == 2)
    var terminal = records[1]
    if let terminalMetrics {
      let net: [String: Any]? = await withCheckedContinuation { continuation in
        terminalMetrics.deliver(on: DispatchQueue(label: "fixture.metrics")) { continuation.resume(returning: $0) }
      }
      terminal["net"] = ShareDiagnosticRecord.value(net)
    }
    let text = String(data: ShareDiagnosticRecord.line(terminal)!, encoding: .utf8)!
    for secret in ["Private fixture title", "synthetic-private-token-1234", "/private?secret", "private.test", "secret=hidden"] { precondition(!text.contains(secret)) }
    let output = try! JSONSerialization.data(withJSONObject: ["message": message, "elapsedMs": elapsedMs, "terminal": terminal, "events": records.map { $0["event"]! }])
    print(String(data: output, encoding: .utf8)!)
  }
}
`);
    const binary = path.join(executableDirectory, 'host');
    const sources = ['ShareCollector.swift', 'ShareDiagnosticRecord.swift', 'ShareDiagnostics.swift', 'ShareNetworkMetrics.swift'].map(name => path.resolve(__dirname, '../ios', name));
    execFileSync('xcrun', ['swiftc', ...sources, main, '-o', binary], {encoding: 'utf8', timeout: 60000});
    const runHost = mode => execute(binary, [mode], {encoding: 'utf8', timeout: 12000});
    const generic = 'Collection failed, please try again.';
    const login = 'Not have auth info, please login first.';
    const expired = 'Auth expired, please reopen the app to login again.';
    const expectations = {
      success: ['success', 'Success!'], empty: ['success', 'Success!'], successStall: ['success', 'Success!'],
      unauthorized: ['http_401', expired], unauthorizedStall: ['http_401', expired],
      bad: ['http_400', 'Original server message: https://private.test/token?secret=hidden'],
      badEmpty: ['http_400', generic], badStall: ['http_400', generic],
      limited: ['http_429', generic], service: ['http_5xx', generic], serviceTrickle: ['http_5xx', generic],
      redirect: ['http_other', generic], disconnect: ['network_offline', generic],
      signedOut: ['signed_out', login], noToken: ['no_token', login], prefs: ['prefs_corrupt', generic], invalid: ['no_url_found', 'Not have URL content to collect.'],
      cancel: ['cancelled', generic], cancelLookup: ['cancelled', generic],
    };
    for (const value of recovery) {
      expectations[value] ??= ['recovered', 'beta', 'partialHeaders'].includes(value)
        ? ['success', 'Success!'] : ['network_timeout', 'Request timed out, please try again.'];
    }
    for (const current of Object.keys(expectations)) {
      await t.test(current, async () => {
        mode = current;
        const before = received.length, started = performance.now();
        const {stdout} = await runHost(mode);
        const elapsed = performance.now() - started;
        if (serverFailure) throw serverFailure;
        const {message, elapsedMs, terminal, events} = JSON.parse(stdout);
        assert.deepEqual(events, ['share.start', 'share.end']);
        assert.deepEqual([terminal.reason, message], expectations[mode]);
        const cancelled = ['cancel', 'cancelLookup'].includes(mode);
        const noRequest = ['signedOut', 'noToken', 'prefs', 'invalid'].includes(mode);
        assert.equal(terminal.outcome, cancelled ? 'dismissed' : message === 'Success!' ? 'success' : 'failed');
        const requests = received.slice(before);
        assert.deepEqual(requests.map(value => value.path), noRequest ? [] : recovery.includes(mode)
          ? ['/v1/bookmark/add_url', '/v1/bookmark/exists'] : ['/v1/bookmark/add_url']);
        if (terminal.http) {
          assert.equal(terminal.http.cfRay, 'fixture-ray-SJC');
          const noBody = ['success', 'empty', 'successStall', ...stalledErrors].includes(mode);
          assert.equal(terminal.http.errorName, noBody ? null : 'ERROR_PARAM');
          assert.equal(terminal.http.code, noBody ? null : 40001);
        }
        if (noRequest || cancelled) { assert.equal(terminal.http, null); assert.equal(terminal.net, null); }
        else { assert.equal(typeof terminal.net, 'object'); assert.notEqual(terminal.net, null); }
        if (cancelled) { assert.equal(terminal.stage, 'request'); assert.equal(terminal.shown, 'Collecting'); }
        if (recovery.includes(mode)) {
          assert.equal(terminal.http, null, 'lookup must not replace create HTTP evidence');
          assert.equal(terminal.error.domain, 'NSURLErrorDomain');
          assert.equal(terminal.error.code, -1001);
          assert.ok(terminal.ms.request >= 4500 && terminal.ms.request < 6250, JSON.stringify(terminal.ms));
          assert.ok(requests[1].at - requests[0].at >= 4500 && requests[1].at - requests[0].at < 6250);
          if (!cancelled) {
            if (mode !== 'partialHeaders') assert.equal(terminal.net.failedIn, 'wait');
            assert.ok(terminal.net.total >= 4500 && terminal.net.total < 6250, JSON.stringify(terminal.net));
          }
          assert.equal(terminal.env, mode === 'beta' ? 'BETA' : 'PRODUCTION');
        }
        if (mode === 'disconnect') { assert.equal(terminal.error.domain, 'NSURLErrorDomain'); assert.equal(terminal.net.failedIn, 'wait'); }
        if (stalledErrors.includes(mode)) {
          assert.ok(terminal.ms.request >= 4500 && terminal.ms.request < 6250);
          assert.equal(terminal.error.domain, 'NSURLErrorDomain');
          assert.equal(terminal.error.code, -1001, 'retain body timeout evidence without changing the HTTP outcome');
        }
        if (cancelled || recovery.includes(mode) || stalledErrors.includes(mode) || mode === 'successStall') {
          for (const request of requests) assert.notEqual(request.closedAt, null, 'the owned request must be stopped');
        }
        const max = stalledLookups.includes(mode) ? 9250 : recovery.includes(mode) || stalledErrors.includes(mode) ? 6500 : 2000;
        assert.ok(elapsedMs < max, `${mode} native elapsed ${elapsedMs}ms exceeded ${max}ms`);
        assert.ok(elapsed < max, `${mode} elapsed ${elapsed}ms exceeded ${max}ms`);
        if (stalledLookups.includes(mode)) {
          assert.ok(terminal.ms.total >= 7500 && terminal.ms.total < 9000);
          assert.ok(terminal.ms.total - terminal.ms.request >= 2500);
        }
        t.diagnostic(`${mode}: native ${elapsedMs}ms, command ${Math.round(elapsed)}ms, ${requests.length} requests`);
      });
    }
  } finally {
    await Promise.all([server, betaServer].map(server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }));
    rmSync(output, {recursive: true, force: true});
  }
});
