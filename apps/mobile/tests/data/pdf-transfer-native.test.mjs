import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, readdirSync} from 'node:fs';
import {resolve, delimiter} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function run(command, args) {
  const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']}), output = [];
  child.stdout.on('data', bytes => output.push(bytes)); child.stderr.on('data', bytes => output.push(bytes));
  const timeout = setTimeout(() => child.kill(), command.endsWith('/host') ? 15000 : 120000);
  try {const [code] = await once(child, 'close'); const text = Buffer.concat(output).toString(); assert.equal(code, 0, text); return text;}
  finally {clearTimeout(timeout);}
}
function jar(group, name, version) {
  const base = resolve(homedir(), '.gradle/caches/modules-2/files-2.1', group, name, version);
  let matches = [];
  try {matches = readdirSync(base).flatMap(hash => readdirSync(resolve(base, hash)).filter(file => file.endsWith('.jar') && !file.includes('sources')).map(file => resolve(base, hash, file)));} catch {return null;}
  return matches.length === 1 ? matches[0] : null;
}
const kotlinNetwork = process.env.SLAX_OKHTTP_CLASSPATH ?? (() => {const okhttp = jar('com.squareup.okhttp3', 'okhttp', '4.9.2'), okio = jar('com.squareup.okio', 'okio', '2.8.0'); return okhttp && okio ? [okhttp, okio].join(delimiter) : null;})();
async function fixture(t) {
  const base = resolve(root, '.local/native-pdf-transfer'); mkdirSync(base, {recursive: true});
  const output = mkdtempSync(resolve(base, 'host-')); let redirects = 0;
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/redirect-target') {redirects++; response.end(); return;}
      assert.equal(url.pathname, '/v1/bookmark/pdf'); assert.equal(request.headers.authorization, 'Bearer synthetic'); assert.equal(request.headers.cookie, undefined);
      assert.equal(request.headers['accept-encoding'], 'identity');
      const mode = url.searchParams.get('bookmark_uid');
      if (mode === 'redirect') {response.writeHead(302, {Location: '/redirect-target', 'Content-Length': 0}); response.end(); return;}
      if (mode === 'denied') {response.writeHead(403, {'Content-Type': 'text/plain', 'Content-Length': 6}); response.end('denied'); return;}
      if (mode === 'oversize') {response.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Length': 50 * 1024 * 1024 + 1}); response.write(Buffer.of(1)); return;}
      if (mode === 'compressed') {response.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Length': 1, 'Content-Encoding': 'gzip'}); response.end(Buffer.of(1)); return;}
      if (mode === 'truncated') {response.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Length': 100}); response.flushHeaders(); response.write(Buffer.of(1)); setTimeout(() => response.destroy(), 20); return;}
      if (mode === 'slow') {response.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Length': 10}); response.write(Buffer.of(1)); return;}
      const size = mode === 'partial' ? 8 : 2 * 1024 * 1024 + 17;
      response.writeHead(mode === 'partial' ? 206 : 200, {'Content-Type': 'application/pdf', 'Content-Length': size, ...(mode === 'partial' ? {'Content-Range': `bytes 0-7/${size}`} : {})});
      for (let offset = 0; offset < size && !response.destroyed; offset += 8192) {
        const chunk = Buffer.from(Uint8Array.from({length: Math.min(8192, size - offset)}, (_, index) => (offset + index) % 251));
        if (!response.write(chunk)) await new Promise(resolve => {
          const done = () => {response.off('drain', done); response.off('close', done); resolve();};
          response.once('drain', done); response.once('close', done);
        });
      }
      response.end();
    })().catch(() => response.destroy());
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(output, {recursive: true, force: true}); assert.equal(redirects, 0);});
  return {output, origin: `http://127.0.0.1:${server.address().port}`};
}

test('actual Kotlin pull transport bounds chunks, rejects redirects and drains cancellation under real HTTP', {skip: !kotlinNetwork && 'OkHttp/Okio jars are unavailable in the local Gradle cache; supply SLAX_OKHTTP_CLASSPATH or run the native build first'}, async t => {
  const f = await fixture(t), source = resolve(root, 'modules/slax-platform/android/src/main/java/com/slax/reader/platform');
  const network = kotlinNetwork;
  const output = resolve(f.output, 'host.jar');
  await run(process.env.SLAX_KOTLINC ?? 'kotlinc', ['-classpath', network, '-include-runtime', '-d', output,
    ...['SlaxFileStore.kt', 'SlaxPdfTransfer.kt', 'SlaxPdfTransferModule.kt'].map(file => resolve(source, file)),
    ...['ExpoModule.kt', 'Promise.kt'].map(file => resolve(root, 'tests/data/file-store-host', file)),
    ...['Context.kt', 'ApplicationInfo.kt'].map(file => resolve(root, 'tests/reader/native-resources-host', file)), resolve(root, 'tests/data/pdf-transfer-host/Host.kt')]);
  assert.match(await run(process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME, 'bin/java') : 'java', ['-cp', [output, network].join(delimiter), 'com.slax.reader.platform.HostKt', f.origin, f.output]), /Kotlin bounded PDF transport passed/);
});

test('actual Swift pull transport bounds chunks, rejects redirects and drains cancellation under real HTTP', {skip: process.platform !== 'darwin'}, async t => {
  const f = await fixture(t), source = resolve(root, 'modules/slax-platform/ios'), output = resolve(f.output, 'host');
  await run('xcrun', ['swiftc', '-swift-version', '5', '-emit-module', '-emit-library', '-module-name', 'ExpoModulesCore', resolve(root, 'tests/data/file-store-host/ExpoModulesCore.swift'), '-o', resolve(f.output, 'libExpoModulesCore.dylib')]);
  await run('xcrun', ['swiftc', '-swift-version', '5', '-typecheck', '-I', f.output, ...['SlaxFileStore.swift', 'SlaxPdfTransfer.swift', 'SlaxPdfTransferModule.swift'].map(file => resolve(source, file))]);
  await run('xcrun', ['swiftc', '-swift-version', '5', resolve(source, 'SlaxFileStore.swift'), resolve(source, 'SlaxPdfTransfer.swift'), resolve(root, 'tests/data/pdf-transfer-host/Host.swift'), '-o', output]);
  assert.match(await run(output, [f.origin]), /Swift bounded PDF transport passed/);
});
