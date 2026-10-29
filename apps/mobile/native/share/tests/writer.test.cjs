const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, readFileSync, writeFileSync, rmSync} = require('node:fs');
const {execFileSync, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {tmpdir} = require('node:os');
const path = require('node:path');
const execute = promisify(execFile);

test('real share writer enforces daily allowance, single concurrent marker, permissions, and disabled failures', {skip: process.platform !== 'darwin'}, async () => {
  const output = mkdtempSync(path.join(tmpdir(), 'slax-share-writer-'));
  try {
    const source = path.resolve(__dirname, '../ios');
    const main = path.join(output, 'Host.swift');
    writeFileSync(main, readFileSync(path.join(source, 'ShareDiagnostics.swift'), 'utf8') + `

private enum FileManager { static let \`default\` = FixtureFileManager() }
private final class FixtureFileManager {
  var root = URL(fileURLWithPath: CommandLine.arguments[2])
  func containerURL(forSecurityApplicationGroupIdentifier group: String) -> URL? {
    precondition(group == "group.app.slax.reader"); return root
  }
  func createDirectory(at url: URL, withIntermediateDirectories: Bool) throws {
    try Foundation.FileManager.default.createDirectory(at: url, withIntermediateDirectories: withIntermediateDirectories)
  }
}
extension ShareDiagnosticWriter {
  static func check() throws {
    let manager = Foundation.FileManager.default
    let root = FileManager.default.root
    let date = Date(timeIntervalSince1970: 1800000000)
    let file = root.appendingPathComponent("diagnostics/" + ShareDiagnosticRecord.day(date) + ".share-ios.ndjson")
    let mode = CommandLine.arguments[1]
    let line = ShareDiagnosticRecord.line(["event": "share.start"])!
    if mode == "append" { precondition(append(line, at: date)); return }
    if mode == "verifyConcurrent" {
      let data = try Data(contentsOf: file)
      let suffix = String(data: data.dropFirst(524280), encoding: .utf8)!
      precondition(suffix.components(separatedBy: "log.truncated").count == 2)
      precondition(suffix.components(separatedBy: "share.start").count == 2)
      print("PASS concurrent"); return
    }
    try manager.createDirectory(at: root, withIntermediateDirectories: true)
    precondition(append(line, at: date))
    let attributes = try manager.attributesOfItem(atPath: file.path)
    precondition((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    try Data(repeating: 120, count: 524280).write(to: file)
    if mode == "seed" { return }
    precondition(append(line, at: date))
    let data = try Data(contentsOf: file)
    let suffix = String(data: data.dropFirst(524280), encoding: .utf8)!
    precondition(suffix.components(separatedBy: "log.truncated").count == 2)
    precondition(append(line, at: date))
    let unchanged = try Data(contentsOf: file)
    precondition(unchanged == data)
    let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: date)!
    precondition(append(line, at: tomorrow))
    let next = root.appendingPathComponent("diagnostics/" + ShareDiagnosticRecord.day(tomorrow) + ".share-ios.ndjson")
    let nextData = try Data(contentsOf: next)
    precondition(nextData == line)
    for completed in [false, true] {
      let terminalRoot = root.appendingPathComponent(completed ? "completed-dismissal" : "pending-dismissal")
      FileManager.default.root = terminalRoot
      let metrics = ShareNetworkMetrics()
      if completed { metrics.complete() }
      let recorder = ShareDiagnostics(os: "iOS 26.1")
      recorder.start(); recorder.advance("request", reason: "network_other")
      recorder.request(host: "fixture.test", metrics: metrics)
      recorder.extraction(items: 1, attachments: 1000, types: Array(repeating: String(repeating: "漢", count: 80), count: 10))
      for _ in 0..<1000 { recorder.loadError(type: String(repeating: "漢", count: 80), error: NSError(domain: String(repeating: "界", count: 80), code: 1)) }
      recorder.end(outcome: "dismissed", shown: "Collecting", reason: "cancelled")
      recorder.end(outcome: "failed", shown: "Failed!")
      queue.sync { precondition(pending == 0) }
      let files = try manager.contentsOfDirectory(at: terminalRoot.appendingPathComponent("diagnostics"), includingPropertiesForKeys: nil)
      precondition(files.count == 1)
      let lines = try Data(contentsOf: files[0]).split(separator: 10)
      precondition(lines.count == 2 && lines.allSatisfy { $0.count + 1 <= 4096 })
      let terminal = try JSONSerialization.jsonObject(with: Data(lines[1])) as! [String: Any]
      precondition(terminal["event"] as? String == "share.end" && terminal["outcome"] as? String == "dismissed" && terminal["net"] is NSNull)
      let input = terminal["input"] as! [String: Any]
      precondition(input["loadErrorCount"] as? Int == 1000 && (input["loadErrors"] as! [[String: Any]]).isEmpty && (input["types"] as! [String]).isEmpty)
    }
    let blocked = root.appendingPathComponent("blocked")
    try Data([1]).write(to: blocked); FileManager.default.root = blocked
    for _ in 0..<4 { enqueue(["event": "share.start"], at: date) }
    queue.sync {}
    precondition(failures == 3 && pending == 0)
    FileManager.default.root = root.appendingPathComponent("disabled")
    enqueue(["event": "share.start"], at: date); queue.sync {}
    precondition(!manager.fileExists(atPath: FileManager.default.root.path))
    print("PASS quota permissions rollover failures")
  }
}
@main struct Host { static func main() throws { try ShareDiagnosticWriter.check() } }
`);
    const binary = path.join(output, 'host');
    execFileSync('xcrun', ['swiftc', path.join(source, 'ShareDiagnosticRecord.swift'), path.join(source, 'ShareNetworkMetrics.swift'), main, '-o', binary], {encoding: 'utf8', timeout: 60000});
    assert.match(execFileSync(binary, ['check', path.join(output, 'single')], {encoding: 'utf8', timeout: 10000}), /PASS quota/);
    const shared = path.join(output, 'concurrent');
    execFileSync(binary, ['seed', shared], {encoding: 'utf8', timeout: 10000});
    await Promise.all(Array.from({length: 8}, () => execute(binary, ['append', shared], {encoding: 'utf8', timeout: 10000})));
    assert.match(execFileSync(binary, ['verifyConcurrent', shared], {encoding: 'utf8', timeout: 10000}), /PASS concurrent/);
  } finally {rmSync(output, {recursive: true, force: true});}
});
