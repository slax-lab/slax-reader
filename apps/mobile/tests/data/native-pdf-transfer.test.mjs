import test from 'node:test';
import assert from 'node:assert/strict';
import {loadComponent} from '../reader/parity-host.mjs';
import {createMobileApi} from '../../src/data/api.ts';
import {DataTransportError, NativePdfTransportError} from '../../src/data/transport-errors.ts';
import {throwIfAborted} from '../../src/utils/abort.ts';

const gate = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const descriptor = {document_id: 'a'.repeat(64), size: 8, url: '/v1/bookmark/pdf?bookmark_uid=doc', filename: 'doc.pdf', source: 'upload', text_status: 'ready'};
async function fixture() {
  const state = {owner: 'owner-a', origin: 'https://api.test', head: {status: 200, headers: {'Content-Type': 'application/pdf', 'Content-Length': '8'}}, chunks: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6, 7, 8]), null], calls: [], active: new Set(), readGate: null, openGate: null};
  const native = {
    begin(owner, origin) {const id = String(state.calls.length); state.calls.push(['begin', owner, origin]); state.active.add(id); return id;},
    end(owner, id) {state.calls.push(['end', owner, id]); state.active.delete(id);},
    async open(owner, id, url, headers) {state.calls.push(['open', owner, id, url, headers]); await state.openGate; return state.head;},
    async read(owner, id) {state.calls.push(['read', owner, id]); await state.readGate; return state.chunks.shift() ?? null;},
  };
  const {createNativePdfFetch} = await loadComponent('../../src/data/native-pdf-transfer.ts', {
    'expo': {requireNativeModule: name => {assert.equal(name, 'SlaxPdfTransfer'); return native;}},
    './transport-errors.ts': {DataTransportError, NativePdfTransportError}, '../utils/abort.ts': {throwIfAborted},
  }, {URL, Headers, ReadableStream, Uint8Array, Error});
  const fetch = createNativePdfFetch(() => state.owner ? {owner: state.owner, origin: state.origin} : null);
  const request = {method: 'GET', redirect: 'error', headers: {Authorization: 'Bearer synthetic', Accept: 'application/pdf', Range: 'bytes=0-7'}};
  const api = createMobileApi({baseUrl: state.origin, platform: 'ios', version: 'test', sessions: {getSession: async () => ({token: 'synthetic', userId: 'a', refreshedAt: 0})},
    fetch: async () => assert.fail('PDF bytes must use the native transport'), pdfFetch: fetch, sleep: async () => {}});
  return {state, fetch, request, api};
}

test('native PDF fetch opens headers without prefetch and pulls only one bounded chunk per request', async () => {
  const f = await fixture(), response = await f.fetch(`${f.state.origin}/v1/bookmark/pdf?bookmark_uid=doc`, f.request);
  assert.equal(f.state.calls.filter(call => call[0] === 'read').length, 0);
  const reader = response.body.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1, 2, 3])); await Promise.resolve();
  assert.equal(f.state.calls.filter(call => call[0] === 'read').length, 1);
  assert.deepEqual((await reader.read()).value, new Uint8Array([4, 5, 6, 7, 8])); assert.equal((await reader.read()).done, true);
  assert.equal(f.state.active.size, 0); assert.equal(f.state.calls.filter(call => call[0] === 'end').length, 1);
});

test('production PDF API uses native bytes with existing bearer headers, complete validation and consumer backpressure', async () => {
  const f = await fixture(), held = gate(), entered = gate(), sizes = [];
  const pending = f.api.acquirePdf('doc', descriptor, 0, 7, async chunks => {
    for await (const chunk of chunks) {sizes.push(chunk.length); if (sizes.length === 1) {entered.resolve(); await held.promise;}}
  });
  try {
    await entered.promise; assert.equal(f.state.calls.filter(call => call[0] === 'read').length, 1);
    const headers = f.state.calls.find(call => call[0] === 'open')[4];
    assert.equal(headers.authorization, 'Bearer synthetic'); assert.equal(headers.range, 'bytes=0-6'); assert.equal(headers['x-client-type'], 'ios');
  } finally {held.resolve();}
  assert.equal((await pending).kind, 'complete'); assert.deepEqual(sizes, [3, 5]); assert.equal(f.state.active.size, 0);
});

for (const phase of ['open', 'read']) test(`cancelling native PDF ${phase} releases its handle and suppresses late results`, async () => {
  const f = await fixture(), held = gate(), controller = new AbortController();
  if (phase === 'open') f.state.openGate = held.promise; else f.state.readGate = held.promise;
  const operation = f.fetch(`${f.state.origin}/v1/bookmark/pdf?bookmark_uid=doc`, {...f.request, signal: controller.signal});
  const work = phase === 'open' ? operation : (await operation).body.getReader().read();
  const rejected = assert.rejects(work, {name: 'AbortError'});
  controller.abort(); held.resolve(); await rejected;
  assert.equal(f.state.active.size, 0); assert.equal(f.state.calls.filter(call => call[0] === 'end').length, 1);
});

for (const replacement of ['owner', 'origin']) test(`native PDF ${replacement} replacement fences bytes and closes the old handle`, async () => {
  const f = await fixture(), response = await f.fetch(`${f.state.origin}/v1/bookmark/pdf?bookmark_uid=doc`, f.request);
  const held = gate(); f.state.readGate = held.promise;
  const work = response.body.getReader().read(), rejected = assert.rejects(work, {name: 'AbortError'});
  await Promise.resolve(); f.state[replacement] = replacement === 'owner' ? 'owner-b' : 'https://beta.test'; held.resolve(); await rejected;
  assert.equal(f.state.active.size, 0);
});

for (const failure of ['protocol', 'limit', 'busy']) test(`native PDF ${failure} errors cannot become automatic network retries`, async () => {
  const f = await fixture(); f.state.head = {error: failure};
  await assert.rejects(f.api.acquirePdf('doc', descriptor, 0, 7, async () => assert.fail('invalid response consumer')), NativePdfTransportError);
  assert.equal(f.state.calls.filter(call => call[0] === 'open').length, 1); assert.equal(f.state.active.size, 0);
});

test('native network errors retain the existing bounded transport retry policy', async () => {
  const f = await fixture(); f.state.head = {error: 'network'};
  await assert.rejects(f.api.acquirePdf('doc', descriptor, 0, 7, async () => {}), DataTransportError);
  assert.equal(f.state.calls.filter(call => call[0] === 'open').length, 3); assert.equal(f.state.active.size, 0);
});

test('native oversized or rejected chunks are protocol failures, not retried connection failures', async () => {
  for (const chunk of [new Uint8Array(64 * 1024 + 1), {error: 'limit'}, {error: 'protocol'}]) {
    const f = await fixture(); f.state.chunks = [chunk];
    await assert.rejects(f.api.acquirePdf('doc', descriptor, 0, 7, async chunks => {for await (const _chunk of chunks) {}}), NativePdfTransportError);
    assert.equal(f.state.calls.filter(call => call[0] === 'open').length, 1); assert.equal(f.state.active.size, 0);
  }
});

test('native PDF endpoint and owner admission rejects arbitrary destinations before allocating handles', async () => {
  const f = await fixture();
  for (const [url, request] of [['https://other.test/v1/bookmark/pdf', f.request], ['https://api.test/v1/user/me', f.request],
    ['https://api.test/v1/bookmark/pdf', {...f.request, method: 'POST'}], ['https://api.test/v1/bookmark/pdf', {...f.request, redirect: 'follow'}]]) await assert.rejects(f.fetch(url, request), /Invalid native/);
  f.state.owner = null; await assert.rejects(f.fetch('https://api.test/v1/bookmark/pdf', f.request), {name: 'AbortError'});
  assert.equal(f.state.calls.length, 0);
});
