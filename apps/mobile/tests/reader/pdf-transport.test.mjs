import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

// The in-page transport fetches byte ranges from its own origin; PDF.js itself is replaced by a recording stub.
async function loadTransport() {
  const output = await build({entryPoints: [new URL('../../../../packages/reader-embed/src/pdf/runtime/transport.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'neutral',
    plugins: [{name: 'pdfjs-stub', setup(build) {
      build.onResolve({filter: /^pdfjs-dist\//}, () => ({path: 'pdfjs', namespace: 'stub'}));
      build.onLoad({filter: /.*/, namespace: 'stub'}, () => ({loader: 'js', contents: `
        export class PDFDataRangeTransport {constructor(length) {this.length = length; this.ranges = []; globalThis.__range = this;} onDataRange(begin, bytes) {this.ranges.push([begin, bytes]);}}
        export class PDFWorker {} export function getDocument() {return {promise: Promise.resolve(null), destroy: async () => {}};}`}));
    }}]});
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}
const {createPdfTransport} = await loadTransport();
const SIZE = 2.5 * 1024 * 1024, bytes = Uint8Array.from({length: SIZE}, (_, index) => index % 251);
const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
function harness(platform, respond) {
  const requests = [], errors = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({url, init});
    if (url.startsWith('/pdf-cancel/')) return new Response(null, {status: 204});
    init.signal?.throwIfAborted();
    const header = Object.entries(init.headers ?? {})[0], [, begin, last] = /^bytes=(\d+)-(\d+)$/.exec(header[1]).map(Number);
    return respond({url, header: header[0], begin, end: last + 1, init, attempt: requests.filter(request => request.url === url).length});
  };
  const lifecycle = {disposed: false, failed: false, active: true, generation: 0};
  const transport = createPdfTransport({pageId: 'pdf-1', platform, source: '/pdf/doc/abc/' + SIZE, descriptor: {size: SIZE, document_id: 'abc', filename: 'f.pdf'}, labels: {}}, {worker: '', resources: {}},
    {lifecycle, post() {}, emit() {}, error: (reason, stage) => {errors.push({reason, stage}); lifecycle.failed = true;}});
  return {transport, requests, errors, range: globalThis.__range, lifecycle};
}
const partial = ({begin, end}) => new Response(bytes.slice(begin, end), {status: 206, headers: {'Content-Range': `bytes ${begin}-${end - 1}/${SIZE}`, 'Content-Type': 'application/pdf'}});
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('wide PDF.js ranges are split into bounded same-origin windows and delivered once', async () => {
  const {range, requests, errors} = harness('ios', partial);
  range.requestDataRange(0, SIZE); await settle();
  assert.deepEqual(errors, []);
  assert.deepEqual(requests.map(request => [request.url, request.init.headers.Range]), [
    [`/pdf/doc/abc/${SIZE}?request=pdf-1-1-0`, 'bytes=0-1048575'], [`/pdf/doc/abc/${SIZE}?request=pdf-1-1-1`, 'bytes=1048576-2097151'], [`/pdf/doc/abc/${SIZE}?request=pdf-1-1-2`, `bytes=2097152-${SIZE - 1}`]]);
  assert.equal(range.ranges.length, 1); assert.equal(range.ranges[0][0], 0); assert.deepEqual(range.ranges[0][1], bytes);
  assert.ok(requests.every(request => request.init.cache === 'no-store' && !('credentials' in request.init)));
});

test('Android pages send the range in a header WebView does not apply to intercepted streams', async () => {
  const {range, requests} = harness('android', partial);
  range.requestDataRange(10, 20); await settle();
  assert.deepEqual(requests[0].init.headers, {'X-Slax-Range': 'bytes=10-19'}); assert.deepEqual(range.ranges[0][1], bytes.slice(10, 20));
});

test('a native engine pause is retried; other failures report the engine code and status at the range stage', async () => {
  const paused = harness('ios', request => request.attempt < 3 ? json(503, {code: 'operation_cancelled'}) : partial(request));
  paused.range.requestDataRange(0, 100); await new Promise(resolve => setTimeout(resolve, 900));
  assert.deepEqual(paused.errors, []); assert.equal(paused.requests.length, 3); assert.deepEqual(paused.range.ranges[0][1], bytes.slice(0, 100));
  const denied = harness('ios', () => json(403, {code: 'http_forbidden', status: 403}));
  denied.range.requestDataRange(0, 100); await settle();
  assert.deepEqual(denied.errors.map(({reason, stage}) => [reason.code, reason.status, reason.stage, stage]), [['http_forbidden', 403, 'pdf-range', 'range']]);
  assert.equal(denied.range.ranges.length, 0);
  const wrong = harness('ios', ({begin, end}) => new Response(bytes.slice(begin, end), {status: 206, headers: {'Content-Range': `bytes 0-1/${SIZE}`}}));
  wrong.range.requestDataRange(0, 100); await settle();
  assert.equal(wrong.errors[0].reason.code, 'pdf_range_invalid');
  const short = harness('ios', ({begin, end}) => new Response(bytes.slice(begin, end - 1), {status: 206, headers: {'Content-Range': `bytes ${begin}-${end - 1}/${SIZE}`}}));
  short.range.requestDataRange(0, 100); await settle();
  assert.equal(short.errors[0].reason.code, 'pdf_length_invalid');
});

test('aborting pending ranges cancels the page fetch and pings the native server; resuming requests them again', async () => {
  const held = [];
  const {range, transport, requests, errors, lifecycle} = harness('ios', request => new Promise((resolve, reject) => {held.push(resolve); request.init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {once: true});}));
  range.requestDataRange(0, 100); await settle();
  lifecycle.active = false; transport.restartRanges(); await settle();
  assert.deepEqual(requests.filter(request => request.url.startsWith('/pdf-cancel/')).map(request => [request.url, request.init.method]), [['/pdf-cancel/pdf-1-1-0', 'POST']]);
  assert.equal(requests.filter(request => request.url.startsWith('/pdf/')).length, 1, 'An inactive page does not fetch');
  lifecycle.active = true; transport.restartRanges(); await settle();
  assert.equal(requests.filter(request => request.url.startsWith('/pdf/')).length, 2);
  transport.abort(); await settle();
  assert.deepEqual(errors, [], 'Aborted ranges are not document failures'); assert.equal(range.ranges.length, 0);
});
