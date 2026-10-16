import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('native Share refuses a persisted sign-out before looking up an endpoint or sending credentials', {skip: process.platform !== 'darwin'}, () => {
  const output = mkdtempSync(path.join(tmpdir(), 'slax-share-sign-out-'));
  try {
    const source = fileURLToPath(new URL('../../native/share/ios/ShareCollector.swift', import.meta.url));
    const main = path.join(output, 'Host.swift');
    writeFileSync(main, `import Foundation
enum SharedPreferences {
  nonisolated(unsafe) static var values: [String: Any] = [:]
  static func read() throws -> [String: Any] { values }
}
@main struct Host {
  static func main() async throws {
    for pending in [true, false] {
      SharedPreferences.values = ["auth_token": "synthetic-only", "_slax_sign_out_pending_v1": pending]
      do { try await ShareCollector.collect(content: "https://fixture.test/article", title: nil); preconditionFailure("No configured endpoint") }
      catch ShareFailure.message(let message) {
        precondition(message == (pending ? "Not have auth info, please login first." : "Collection failed, please try again."))
      }
    }
    print("Share sign-out guard passed")
  }
}
`);
    const binary = path.join(output, 'host');
    execFileSync('xcrun', ['swiftc', source, main, '-o', binary], {encoding: 'utf8', timeout: 60000});
    assert.match(execFileSync(binary, {encoding: 'utf8', timeout: 5000}), /guard passed/);
  } finally {rmSync(output, {recursive: true, force: true});}
});
