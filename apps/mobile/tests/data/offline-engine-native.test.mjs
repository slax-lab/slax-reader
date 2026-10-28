import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function run(command, args, timeout = 180000) {
  const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']}), output = [];
  child.stdout.on('data', bytes => output.push(bytes)); child.stderr.on('data', bytes => output.push(bytes));
  const timer = setTimeout(() => child.kill(), timeout);
  try {const [code] = await once(child, 'close'); const text = Buffer.concat(output).toString(); assert.equal(code, 0, text); return text;}
  finally {clearTimeout(timer);}
}
const PDF_SIZE = 2 * 1024 * 1024 + 512 * 1024 + 7, DOCUMENT = 'a'.repeat(64);
const pdfBytes = (begin, end) => Buffer.from(Array.from({length: end - begin}, (_, index) => (begin + index) % 251));
const article = image => `<!doctype html><html><head><title>t</title></head><body><p>ünïcode</p><img src="${image}/img/a.png"><img src="${image}/img/a.png"><script>'<img src="${image}/img/hidden.png">'</script><img src="${image}/img/missing.png"></body></html>`;

function server() {
  const counts = {}, held = new Map(), problems = [];
  const count = name => {counts[name] = (counts[name] ?? 0) + 1; return counts[name];};
  const http = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost'), image = `http://127.0.0.1:${http.address().port}`;
    const auth = request.headers.authorization;
    if (url.pathname === '/counts') {response.end(JSON.stringify(counts)); return;}
    if (url.pathname === '/release') {held.get(url.searchParams.get('key'))?.(); response.end(); return;}
    if (url.pathname.startsWith('/img/')) {
      if (request.headers.authorization || request.headers.cookie) problems.push('image request carried credentials');
      if (url.pathname === '/img/a.png') {response.writeHead(200, {'Content-Type': 'image/png'}); response.end(Buffer.of(137, 80, 78, 71, 1, 2, 3)); return;}
      response.writeHead(404); response.end(); return;
    }
    if (request.headers.cookie) problems.push('API request carried cookies');
    if (url.pathname === '/v1/bookmark/content') {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        const uid = JSON.parse(Buffer.concat(chunks).toString()).bookmark_uid, attempt = count(`content:${uid}`);
        if (request.method !== 'POST' || request.headers.accept !== '*/*' || request.headers['user-agent'] !== 'SlaxReader/ios test' || request.headers['content-type'] !== 'application/json') problems.push('content headers');
        if (!['Bearer t1', 'Bearer t2'].includes(auth)) {response.writeHead(401); response.end(); return;}
        if (uid === 'auth' && auth === 'Bearer t1') {response.writeHead(401); response.end(); return;}
        if (uid === 'denied') {response.writeHead(403, {'Content-Type': 'application/json'}); response.end('{"code":403}'); return;}
        if (uid === 'flaky' && attempt === 1) {response.writeHead(500); response.end(); return;}
        if (uid === 'slow') {response.writeHead(200, {'Content-Type': 'text/html'}); response.write('<p>'); held.set('slow', () => response.end('slow</p>')); return;}
        response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}); response.end(article(image));
      });
      return;
    }
    if (request.headers['x-client-type'] !== 'ios' || request.headers['x-client-version'] !== '1.0.0' || !auth?.startsWith('Bearer ')) problems.push(`pdf headers ${url.pathname}`);
    const uid = url.searchParams.get('bookmark_uid');
    if (url.pathname === '/v1/bookmark/metadata') {
      count(`metadata:${uid}`);
      if (uid === 'pdf-gone') {response.writeHead(404); response.end(); return;}
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end(JSON.stringify({code: 200, data: {pdf: {url: 'ignored', filename: 'doc.pdf', size: PDF_SIZE, document_id: DOCUMENT, source: 'upload', text_status: 'ready'}}}));
      return;
    }
    if (url.pathname === '/v1/bookmark/pdf') {
      count(`pdf:${uid}`);
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
      if (request.headers.accept !== 'application/pdf' || request.headers['accept-encoding'] !== 'identity' || !match) problems.push('pdf range request');
      if (uid === 'pdf-full') {response.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Length': PDF_SIZE}); response.end(pdfBytes(0, PDF_SIZE)); return;}
      const begin = Number(match[1]), end = Number(match[2]) + 1;
      const send = () => {
        response.writeHead(206, {'Content-Type': 'application/pdf', 'Content-Length': end - begin, 'Content-Range': `bytes ${begin}-${end - 1}/${PDF_SIZE}`, ETag: `"${uid === 'pdf-etag' ? 'b'.repeat(64) : DOCUMENT}"`});
        response.end(pdfBytes(begin, end));
      };
      if (uid === 'pdf-slow') {held.set('pdf-slow', send); response.on('close', () => {if (!response.writableEnded) count('pdf-slow:aborted');}); return;}
      send();
      return;
    }
    response.writeHead(404); response.end();
  });
  return {http, problems, release: () => held.forEach(release => release())};
}

test('actual Swift offline engine matches HTML extraction fixtures and acquires, revokes and evicts native caches', {skip: process.platform !== 'darwin'}, async () => {
  const base = resolve(root, '.local/native-offline-engine'); mkdirSync(base, {recursive: true});
  const output = mkdtempSync(resolve(base, 'host-')), source = resolve(root, 'modules/slax-platform/ios'), executable = resolve(output, 'host');
  const fake = server();
  fake.http.listen(0); await once(fake.http, 'listening');
  try {
    await run('xcrun', ['swiftc', '-swift-version', '5', '-emit-module', '-emit-library', '-module-name', 'ExpoModulesCore', resolve(root, 'tests/data/file-store-host/ExpoModulesCore.swift'), '-o', resolve(output, 'libExpoModulesCore.dylib')]);
    const sources = ['SlaxFileStore.swift', 'SlaxReaderSecurity.swift', 'SlaxImageRegistry.swift', 'SlaxCachePaths.swift', 'SlaxImageModule.swift', 'SlaxPdfTransfer.swift',
      'SlaxOfflineEngine.swift', 'SlaxOfflineEngineStore.swift', 'SlaxOfflineEngineHttp.swift', 'SlaxOfflineEngineHtml.swift', 'SlaxOfflineEngineSession.swift', 'SlaxOfflineEnginePlan.swift', 'SlaxOfflineEngineArticles.swift', 'SlaxOfflineEnginePdf.swift', 'SlaxPdfSchemeHandler.swift'];
    await run('xcrun', ['swiftc', '-swift-version', '5', '-I', output, '-L', output, '-lExpoModulesCore', '-Xlinker', '-rpath', '-Xlinker', output,
      ...sources.map(file => resolve(source, file)), resolve(root, 'tests/data/offline-engine-host/Host.swift'), '-o', executable]);
    const port = fake.http.address().port;
    assert.match(await run(executable, [`http://localhost:${port}`, `http://127.0.0.1:${port}`, resolve(output, 'data'), resolve(root, 'tests/fixtures/offline-html-extraction.json')], 90000), /Swift offline engine passed/);
    assert.deepEqual(fake.problems, []);
  } finally {fake.release(); fake.http.close(); rmSync(output, {recursive: true, force: true});}
});
