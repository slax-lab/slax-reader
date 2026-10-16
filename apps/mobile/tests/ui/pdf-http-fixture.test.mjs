import test from 'node:test';
import assert from 'node:assert/strict';
import {startPdfHttpFixture} from '../../tooling/pdf-http-fixture.mjs';
import {createPdfHttpFetch, PDF_HTTP_ORIGIN, PDF_HTTP_TOKEN, PDF_HTTP_BOOKMARK} from '../../fixtures/pdf-http.ts';
import {createMobileApi} from '../../src/data/api.ts';
import {BackgroundArticleCache} from '../../src/data/background-cache.ts';
import {PdfBlockCache} from '../../src/data/pdf-cache.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {FixtureMemoryPreferences} from '../../fixtures/isolation.ts';

const headers = {Authorization: `Bearer ${PDF_HTTP_TOKEN}`};
const metadata = `/v1/bookmark/metadata?bookmark_uid=${PDF_HTTP_BOOKMARK}`;

test('Expo HTTP wrapper rejects foreign origins, real credentials and unprepared requests before transport', async () => {
  const calls = [], transport = createPdfHttpFetch(async (...args) => {calls.push(args); return new Response('{}');});
  for (const [url, init] of [
    ['https://api-reader.slax.com'+metadata, {headers}],
    ['http://localhost:8093'+metadata, {headers}],
    [PDF_HTTP_ORIGIN+metadata, {headers: {Authorization: 'Bearer actual-user-token'}}],
    [PDF_HTTP_ORIGIN+'/v1/bookmark/upload_pdf', {method: 'POST', headers}],
    [PDF_HTTP_ORIGIN+metadata+'&other=secret', {headers}],
    [PDF_HTTP_ORIGIN+'/__fixture/control?mode=normal', {method: 'POST', headers, body: 'unapproved'}],
  ]) await assert.rejects(transport(url, init));
  assert.equal(calls.length, 0);
  await transport(PDF_HTTP_ORIGIN+metadata, {headers}); assert.equal(calls[0][1].redirect, 'error');
  const failure = Object.assign(new Error('native connection failure'), {name: 'FetchError'}), observations = [];
  await assert.rejects(createPdfHttpFetch(async () => {throw failure;}, value => observations.push(value))(PDF_HTTP_ORIGIN+metadata, {headers}), error => error === failure);
  assert.deepEqual(observations, [{path: '/v1/bookmark/metadata', outcome: 'network-error'}]);
});

test('actual loopback HTTP enforces authorization, ranges and metadata 404 versus offline cache fallback', {timeout: 15000}, async t => {
  const server = await startPdfHttpFixture({port: 0}); let closed = false;
  t.after(async () => {if (!closed) await server.close();});
  assert.equal(server.server.address().address, '127.0.0.1');
  const denied = await fetch(server.origin+metadata); assert.equal(denied.status, 403);
  assert.equal((await fetch(server.origin+'/proxy?url=https://example.com', {headers})).status, 404);
  const api = createMobileApi({baseUrl: server.origin, platform: 'ios', version: 'fixture', sessions: {getSession: async () => ({token: PDF_HTTP_TOKEN, userId: 'synthetic-user'})}, fetch, sleep: async () => {}});
  const envelope = await (await fetch(server.origin+metadata, {headers})).json();
  assert.equal(envelope.data.pdf.document_id, server.document.descriptor.document_id);
  const descriptor = await api.getPdfMetadata(PDF_HTTP_BOOKMARK);
  assert.equal(descriptor.size, server.document.bytes.length); assert.equal(descriptor.document_id, server.document.descriptor.document_id);
  assert.deepEqual(await api.getPdfRange(PDF_HTTP_BOOKMARK, descriptor.document_id, 5, 100, undefined, descriptor.size), server.document.bytes.slice(5, 100));
  const binary = `${server.origin}/v1/bookmark/pdf?bookmark_uid=${PDF_HTTP_BOOKMARK}`;
  const range = await fetch(binary, {headers: {...headers, Range: 'bytes=0-10'}});
  assert.equal(range.status, 206); assert.equal(range.headers.get('ETag'), null);
  assert.equal((await range.arrayBuffer()).byteLength, 11);
  assert.equal((await fetch(binary, {headers: {...headers, Range: `bytes=${descriptor.size}-`}})).status, 416);
  const files = new Map(), locals = new Map();
  const storage = {async read(path) {return files.get(path)?.slice() ?? null;}, async writeAtomic(path, bytes) {files.set(path, bytes.slice());}, async remove(path) {files.delete(path);}, async list(prefix) {return [...files.keys()].filter(path => path.startsWith(prefix));}};
  const cache = new PdfBlockCache(storage, 'synthetic-http-account', () => {});
  const database = {async getOptional(_query, args) {const data = locals.get(args[0]); return data ? {data} : null;}, async execute(_query, args) {locals.set(args[0], args[1]);}, async writeTransaction(work) {return work(database);}, watch() {}};
  const worker = new BackgroundArticleCache({database, cache: {}, preferences: new PreferenceStore(new FixtureMemoryPreferences({cache_count: 0})), assertActive() {}, content: async () => {throw Error('No HTML');}, image: async () => {throw Error('No image');}, pdf: {cache, metadata: (id, signal) => api.getPdfMetadata(id, signal), range: (...args) => api.getPdfRange(...args)}});
  t.after(() => worker.stop());
  await worker.cachePdf(PDF_HTTP_BOOKMARK); assert.equal((await worker.pdfCacheStatus(PDF_HTTP_BOOKMARK)).complete, true);
  assert.equal((await fetch(server.origin+'/__fixture/control?mode=metadata-404', {method: 'POST', headers})).status, 200);
  await assert.rejects(worker.getPdfMetadata(PDF_HTTP_BOOKMARK), error => error.status === 404 && error.stage === 'pdf-metadata');
  assert.equal(await cache.metadata(PDF_HTTP_BOOKMARK), null, 'HTTP 404 never reuses cached authorization/metadata');
  await fetch(server.origin+'/__fixture/control?mode=normal', {method: 'POST', headers});
  await worker.cachePdf(PDF_HTTP_BOOKMARK); await server.close(); closed = true;
  const offlineDescriptor = await worker.getPdfMetadata(PDF_HTTP_BOOKMARK);
  assert.equal(offlineDescriptor.document_id, descriptor.document_id);
  assert.deepEqual(await worker.readPdfRange(PDF_HTTP_BOOKMARK, offlineDescriptor, 5, 100), server.document.bytes.slice(5, 100));
  await worker.stop();
});

test('slow HTTP range is truly pending and aborts without claiming completion', async t => {
  const server = await startPdfHttpFixture({port: 0, mode: 'slow'}); t.after(() => server.close());
  const controller = new AbortController();
  const request = fetch(`${server.origin}/v1/bookmark/pdf?bookmark_uid=${PDF_HTTP_BOOKMARK}`, {headers: {...headers, Range: 'bytes=262144-262199'}, signal: controller.signal});
  await new Promise(resolve => setTimeout(resolve, 100)); controller.abort(); await assert.rejects(request, error => error.name === 'AbortError');
  await new Promise(resolve => setTimeout(resolve, 20));
  const status = await (await fetch(server.origin+'/__fixture/status', {headers})).json();
  assert.ok(status.events.some(event => event.state === 'aborted')); assert.equal(status.events.some(event => event.state === 'completed'), false);
});
