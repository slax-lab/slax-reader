const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, readFileSync, writeFileSync, rmSync} = require('node:fs');
const {execFileSync} = require('node:child_process');
const {tmpdir} = require('node:os');
const path = require('node:path');

test('real Swift preferences report v1 legacy none and corrupt reads without reviving stale auth', {skip: process.platform !== 'darwin'}, () => {
  const output = mkdtempSync(path.join(tmpdir(), 'slax-share-preferences-'));
  try {
    const main = path.join(output, 'Host.swift');
    writeFileSync(main, readFileSync(path.resolve(__dirname, '../ios/SharedPreferences.swift'), 'utf8') + `

private enum FileManager { static let \`default\` = FixtureFileManager() }
private final class FixtureFileManager {
  var root: URL? = URL(fileURLWithPath: CommandLine.arguments[1])
  func containerURL(forSecurityApplicationGroupIdentifier group: String) -> URL? {
    precondition(group == "group.app.slax.reader"); return root
  }
  func fileExists(atPath path: String) -> Bool { Foundation.FileManager.default.fileExists(atPath: path) }
}
@main struct Host {
  static func main() throws {
    let manager = Foundation.FileManager.default, root = FileManager.default.root!
    try manager.createDirectory(at: root, withIntermediateDirectories: true)
    var store = "", failure: String?
    func read() throws -> [String: Any] { try SharedPreferences.read { store = $0; failure = $1 } }
    let missing = try read()
    precondition(missing.isEmpty && store == "none" && failure == nil)
    func field(_ tag: UInt8, _ data: Data) -> Data { Data([tag, UInt8(data.count)]) + data }
    let entry = field(10, Data("auth_token".utf8)) + field(18, field(42, Data("synthetic-legacy".utf8)))
    let original = root.appendingPathComponent("user.preferences_pb"), current = root.appendingPathComponent("slax.preferences.v1.json")
    try field(10, entry).write(to: original)
    let legacy = try read()
    precondition(legacy["auth_token"] as? String == "synthetic-legacy" && store == "legacy" && failure == nil)
    let oldCaller = try SharedPreferences.read()
    precondition(oldCaller["auth_token"] as? String == "synthetic-legacy")
    try JSONSerialization.data(withJSONObject: ["values": [String: String]()]).write(to: current)
    let signedOut = try read()
    precondition(signedOut.isEmpty && store == "v1" && failure == nil)
    try JSONSerialization.data(withJSONObject: ["values": ["auth_token": "synthetic-current"]]).write(to: current)
    let signedIn = try read()
    precondition(signedIn["auth_token"] as? String == "synthetic-current" && store == "v1")
    for corrupt in [Data([123]), try JSONSerialization.data(withJSONObject: ["notValues": true])] {
      try corrupt.write(to: current)
      do { _ = try read(); preconditionFailure("Corrupt current store accepted") }
      catch { precondition(store == "v1" && failure != nil) }
    }
    try manager.removeItem(at: current); try Data([10, 255]).write(to: original)
    do { _ = try read(); preconditionFailure("Corrupt legacy store accepted") }
    catch { precondition(store == "legacy" && failure != nil) }
    FileManager.default.root = nil
    do { _ = try read(); preconditionFailure("Missing container accepted") }
    catch { precondition(store == "none" && failure != nil) }
    print("PASS preferences stores and compatible return contract")
  }
}
`);
    const binary = path.join(output, 'host');
    execFileSync('xcrun', ['swiftc', '-parse-as-library', main, '-o', binary], {encoding: 'utf8', timeout: 60000});
    assert.match(execFileSync(binary, [path.join(output, 'container')], {encoding: 'utf8', timeout: 10000}), /PASS preferences/);
  } finally {rmSync(output, {recursive: true, force: true});}
});
