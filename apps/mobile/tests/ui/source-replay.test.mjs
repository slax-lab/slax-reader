import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const evidence = path.join(repo, 'docs/mobile/evidence');
const archived = path.join(evidence, '2026-10-10-source-android/source-driver-e');
const resourceArchive = path.join(evidence, '2026-10-11-source-rss-artwork-preparation/source-inputs-r2');
const validate = snapshot => spawnSync('python3', ['-c', `
import importlib.util, json, sys
from hashlib import sha256
from pathlib import Path
module_path=Path(sys.argv[1])/'apps/mobile/fixtures/prepare-source.py'
spec=importlib.util.spec_from_file_location('source_preparer', module_path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
manifest_path=Path(sys.argv[1])/'docs/mobile/source-manifest.json'
manifest=json.loads(manifest_path.read_text())
marker, records=module.snapshot_inputs(Path(sys.argv[2]), manifest, sha256(manifest_path.read_bytes()).hexdigest())
print(json.dumps({'files':len(records),'fixture':marker['fixtureInputSha256']}))
`, repo, snapshot], {encoding: 'utf8'});
function altered(run, source = archived) {
  const directory = mkdtempSync(path.join(evidence, 'source-replay-test-'));
  try {cpSync(source, directory, {recursive: true}); return run(directory);}
  finally {rmSync(directory, {recursive: true, force: true});}
}

test('archived source replay keeps the historical fixture independently of current generated inputs', () => {
  const result = validate(archived); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {files: 28, fixture: '4a22bf5f87b21a1c84ae84b951ce482c5e04aeef6e7f60df8a9b063feb91e3fd'});
});
test('archived source replay rejects a changed driver before accepting the snapshot', () => altered(directory => {
  writeFileSync(path.join(directory, 'SOURCE-HARNESS.md'), 'tampered driver documentation');
  const result = validate(directory); assert.notEqual(result.status, 0); assert.match(result.stderr, /checksum mismatch/);
}));
test('archived source replay rejects an added traversal path in the closed manifest', () => altered(directory => {
  const filename = path.join(directory, 'input-manifest.json'), marker = JSON.parse(readFileSync(filename));
  marker.overlayDigests[0].path = '../outside'; writeFileSync(filename, JSON.stringify(marker));
  const result = validate(directory); assert.notEqual(result.status, 0); assert.match(result.stderr, /exact closed capture input set/);
}));
test('archived source replay refuses source symlinks before opening their contents', () => altered(directory => {
  const filename = path.join(directory, 'SOURCE-HARNESS.md'); rmSync(filename); symlinkSync('/nonexistent-must-not-open', filename);
  const result = validate(directory); assert.notEqual(result.status, 0); assert.match(result.stderr, /cannot follow symlinks/);
}));
test('new resource replay accepts its exact closed inputs without invalidating historical replay', () => {
  const result = validate(resourceArchive); assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout); assert.equal(value.files, 30);
  assert.equal(value.fixture, 'aaf4fdd7fd8b205ed6f2e297686f20bb3f523b680d35fc62effcdc8a2a4afe2f');
});
test('a rehashed resource derivative cannot silently change the original reader implementation', () => altered(directory => {
  const filename = path.join(directory, 'input-manifest.json'), marker = JSON.parse(readFileSync(filename));
  const relative = marker.androidReaderResourceInterception.controlledHelperPath;
  const controlled = path.join(directory, relative), original = readFileSync(controlled, 'utf8');
  const changed = original.replace('connection.connectTimeout = 15_000', 'connection.connectTimeout = 1');
  assert.notEqual(changed, original); writeFileSync(controlled, changed);
  const digest = createHash('sha256').update(changed).digest('hex');
  marker.overlayDigests.find(entry => entry.path === relative).sha256 = digest;
  marker.androidReaderResourceInterception.controlledHelperSha256 = digest;
  writeFileSync(filename, JSON.stringify(marker));
  const result = validate(directory); assert.notEqual(result.status, 0);
  assert.match(result.stderr, /resource derivative differs from the pinned original/);
}, resourceArchive));
