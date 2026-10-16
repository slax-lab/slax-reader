import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, readdirSync} from 'node:fs';
import {resolve, delimiter} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
function run(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 120000});
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`); return result.stdout;
}
function jar(group, name, version) {
  const base = resolve(homedir(), '.gradle/caches/modules-2/files-2.1', group, name, version);
  let matches = [];
  try {matches = readdirSync(base).flatMap(hash => readdirSync(resolve(base, hash)).filter(file => file.endsWith('.jar') && !file.includes('sources')).map(file => resolve(base, hash, file)));} catch {return null;}
  return matches.length === 1 ? matches[0] : null;
}
const kotlinNetwork = process.env.SLAX_OKHTTP_CLASSPATH ?? (() => {const okhttp = jar('com.squareup.okhttp3', 'okhttp', '4.9.2'), okio = jar('com.squareup.okio', 'okio', '2.8.0'); return okhttp && okio ? [okhttp, okio].join(delimiter) : null;})();
const kotlinNetworkMissing = {skip: !kotlinNetwork && 'OkHttp/Okio jars are unavailable in the local Gradle cache; supply SLAX_OKHTTP_CLASSPATH or run the native build first'};

test('actual Kotlin shared image registry deduplicates policy-scoped HTTP, cancellation and streaming atomic retention', kotlinNetworkMissing, () => {
  const base = resolve(root, '.local/native-image-registry'); mkdirSync(base, {recursive: true});
  const output = mkdtempSync(resolve(base, 'host-')), source = resolve(root, 'modules/slax-platform/android/src/main/java/com/slax/reader/platform');
  try {
    const network = kotlinNetwork;
    const compiled = resolve(output, 'host.jar');
    run(process.env.SLAX_KOTLINC ?? 'kotlinc', ['-classpath', network, '-include-runtime', '-d', compiled,
      ...['SlaxFileStore.kt', 'SlaxReaderSecurity.kt', 'SlaxImageRegistry.kt', 'SlaxCachePaths.kt', 'SlaxImageModule.kt'].map(file => resolve(source, file)),
      ...['ExpoModule.kt', 'Promise.kt'].map(file => resolve(root, 'tests/data/file-store-host', file)),
      ...['Context.kt', 'ApplicationInfo.kt', 'JSONObject.kt'].map(file => resolve(root, 'tests/reader/native-resources-host', file)), resolve(root, 'tests/data/image-registry-host/Host.kt')]);
    assert.match(run(process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin/java') : 'java', ['-cp', [compiled, network].join(delimiter), 'com.slax.reader.platform.HostKt', resolve(output, 'data')]), /Kotlin shared image registry passed/);
  } finally {rmSync(output, {recursive: true, force: true});}
});

test('actual Swift shared image registry deduplicates policy-scoped HTTP, cancellation and streaming atomic retention', {skip: process.platform !== 'darwin'}, () => {
  const base = resolve(root, '.local/native-image-registry'); mkdirSync(base, {recursive: true});
  const output = mkdtempSync(resolve(base, 'host-')), source = resolve(root, 'modules/slax-platform/ios');
  try {
    const executable = resolve(output, 'host');
    run('xcrun', ['swiftc', '-swift-version', '5', '-emit-module', '-emit-library', '-module-name', 'ExpoModulesCore', resolve(root, 'tests/data/file-store-host/ExpoModulesCore.swift'), '-o', resolve(output, 'libExpoModulesCore.dylib')]);
    run('xcrun', ['swiftc', '-swift-version', '5', '-typecheck', '-I', output, ...['SlaxFileStore.swift', 'SlaxReaderSecurity.swift', 'SlaxImageRegistry.swift', 'SlaxCachePaths.swift', 'SlaxImageModule.swift'].map(file => resolve(source, file))]);
    run('xcrun', ['swiftc', '-swift-version', '5', ...['SlaxFileStore.swift', 'SlaxReaderSecurity.swift', 'SlaxImageRegistry.swift'].map(file => resolve(source, file)), resolve(root, 'tests/data/image-registry-host/Host.swift'), '-o', executable]);
    assert.match(run('python3', [resolve(root, 'tests/data/image-registry-host/image-server.py'), executable, resolve(output, 'data')]), /Swift shared image registry passed/);
  } finally {rmSync(output, {recursive: true, force: true});}
});
