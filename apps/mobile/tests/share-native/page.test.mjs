import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('native Safari preprocessing retains the exact web URL/title and rejects non-web payloads', {skip: process.platform !== 'darwin'}, () => {
  const output = mkdtempSync(path.join(tmpdir(), 'slax-share-page-test-'));
  try {
    const source = fileURLToPath(new URL('../../native/share/ios/SharePage.swift', import.meta.url));
    const main = path.join(output, 'main.swift');
    writeFileSync(main, `import Foundation
precondition(SharePage.propertyListIdentifier == "com.apple.property-list")
let exact = "https://example.test/path?value=1#anchor"
let page = SharePage(results: ["title": "A webpage title", "url": exact, "content": ""])
precondition(page.url == exact && page.title == "A webpage title")
precondition(SharePage(results: ["url": "http://localhost:61504/fixture/page"]).url != nil)
precondition(SharePage(results: ["url": "HTTPS://example.test/"]).url != nil)
for value: Any in ["javascript:alert(1)", "file:///tmp/page", "data:text/html,hello", "/relative", "https:///", "", 12] {
  precondition(SharePage(results: ["url": value]).url == nil)
}
precondition(SharePage(results: ["title": "Title without URL"]).title == "Title without URL")
precondition(SharePage(results: ["title": 42, "url": exact]).title == nil)
print("Native Safari preprocessing assertions passed")
`);
    const binary = path.join(output, 'page-test');
    execFileSync('xcrun', ['swiftc', source, main, '-o', binary], {timeout: 60000});
    assert.match(execFileSync(binary, {encoding: 'utf8', timeout: 5000}), /assertions passed/);
  } finally {rmSync(output, {recursive: true, force: true});}
});
