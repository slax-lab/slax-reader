import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
function run(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 120000});
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function temporary() {
  const base = resolve(root, '.local/native-file-store'); mkdirSync(base, {recursive: true});
  return mkdtempSync(resolve(base, 'host-'));
}

test('actual Kotlin file storage enforces atomic writes, bounded reads, paths and account replacement', () => {
  const output = temporary(), source = resolve(root, 'modules/slax-platform/android/src/main/java/com/slax/reader/platform');
  try {
    run(process.env.SLAX_KOTLINC ?? 'kotlinc', ['-include-runtime', '-d', resolve(output, 'host.jar'), resolve(source, 'SlaxFileStore.kt'), resolve(source, 'SlaxStorageModule.kt'), resolve(root, 'tests/data/file-store-host/ExpoModule.kt'), resolve(root, 'tests/data/file-store-host/Host.kt'), resolve(root, 'tests/data/file-store-host/Promise.kt'), ...['Context.kt', 'ApplicationInfo.kt', 'JSONObject.kt'].map(name => resolve(root, 'tests/reader/native-resources-host', name))]);
    assert.match(run(process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin/java') : 'java', ['-jar', resolve(output, 'host.jar'), resolve(output, 'data')]), /Kotlin native file storage passed/);
  } finally {rmSync(output, {recursive: true, force: true});}
});

test('actual Swift file storage enforces atomic writes, bounded reads, paths and account replacement', {skip: process.platform !== 'darwin'}, () => {
  const output = temporary();
  try {
    run('xcrun', ['swiftc', '-swift-version', '5', '-emit-module', '-emit-library', '-module-name', 'ExpoModulesCore', resolve(root, 'tests/data/file-store-host/ExpoModulesCore.swift'), '-o', resolve(output, 'libExpoModulesCore.dylib')]);
    run('xcrun', ['swiftc', '-swift-version', '5', '-typecheck', '-I', output, resolve(root, 'modules/slax-platform/ios/SlaxFileStore.swift'), resolve(root, 'modules/slax-platform/ios/SlaxStorageModule.swift')]);
    run('xcrun', ['swiftc', '-swift-version', '5', resolve(root, 'modules/slax-platform/ios/SlaxFileStore.swift'), resolve(root, 'tests/data/file-store-host/Host.swift'), '-o', resolve(output, 'host')]);
    assert.match(run(resolve(output, 'host'), [resolve(output, 'data')]), /Swift native file storage passed/);
  } finally {rmSync(output, {recursive: true, force: true});}
});
