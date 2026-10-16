import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('production Swift ownership, bounded activities and accepted schema execute with synthetic UIKit boundary', {skip: process.platform !== 'darwin'}, () => {
  const base = resolve(root, '../../.local/mobile-performance-20261011');
  mkdirSync(base, {recursive: true});
  const output = mkdtempSync(resolve(base, 'storage-host-'));
  const source = resolve(root, 'modules/slax-legacy/ios');
  const host = resolve(root, 'tests/data/storage-lifecycle-host');
  const run = (command, args) => {
    const result = spawnSync(command, args, {encoding: 'utf8', timeout: 60000});
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  try {
    for (const name of ['UIKit', 'ExpoModulesCore']) run('xcrun', ['swiftc', '-emit-library', '-emit-module', '-module-name', name, resolve(host, `${name}.swift`), '-emit-module-path', resolve(output, `${name}.swiftmodule`), '-o', resolve(output, `lib${name}.dylib`)]);
    run('xcrun', ['swiftc', '-typecheck', '-I', output, ...['StorageLifecycle.swift', 'DatabaseInspectionCancellation.swift', 'AcceptedDatabase.swift', 'DatabaseIdentity.swift', 'DatabaseInspection.swift', 'SlaxLegacyModule.swift'].map(name => resolve(source, name))]);
    run('xcrun', ['swiftc', '-I', output, '-L', output, '-lUIKit', '-Xlinker', '-rpath', '-Xlinker', output, ...['StorageLifecycle.swift', 'DatabaseInspectionCancellation.swift', 'AcceptedDatabase.swift', 'DatabaseIdentity.swift', 'DatabaseInspection.swift'].map(name => resolve(source, name)), resolve(host, 'Host.swift'), '-o', resolve(output, 'host')]);
    assert.match(run(resolve(output, 'host'), [output]), /helpers passed/);
    const module = readFileSync(resolve(source, 'SlaxLegacyModule.swift'), 'utf8');
    assert.doesNotMatch(module, /slax-data-owner\.lock|ownerDescriptor/);
    assert.match(module, /LOCK_EX \| LOCK_NB/);
  } finally {rmSync(output, {recursive: true, force: true});}
});
