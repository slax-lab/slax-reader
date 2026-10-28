import test from 'node:test';
import assert from 'node:assert/strict';
import {startPdfHttpFixture} from '../../tooling/pdf-http-fixture.mjs';
import {createPdfHttpFetch, PDF_HTTP_ORIGIN, PDF_HTTP_TOKEN, PDF_HTTP_BOOKMARK} from '../../fixtures/pdf-http.ts';
import {createFixtureOfflineEngine} from '../../fixtures/offline-engine.ts';

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
  const envelope = await (await fetch(server.origin+metadata, {headers})).json();
  assert.equal(envelope.data.pdf.document_id, server.document.descriptor.document_id);
  const binary = `${server.origin}/v1/bookmark/pdf?bookmark_uid=${PDF_HTTP_BOOKMARK}`;
  const range = await fetch(binary, {headers: {...headers, Range: 'bytes=0-10'}});
  assert.equal(range.status, 206); assert.equal(range.headers.get('ETag'), null);
  assert.equal((await range.arrayBuffer()).byteLength, 11);
  assert.equal((await fetch(binary, {headers: {...headers, Range: `bytes=${server.document.bytes.length}-`}})).status, 416);
  const engine = createFixtureOfflineEngine({fetch}), owner = 'loopback-owner', key = PDF_HTTP_BOOKMARK, statuses = [];
  engine.addListener('onStatus', event => statuses.push(...event.items.map(item => item.state)));
  await engine.open({owner, scope: '["loopback","synthetic-user"]', origin: server.origin, directory: '/fixture', userAgent: 'fixture', clientType: 'ios', clientVersion: 'fixture'});
  engine.setCredential(owner, {generation: 1, token: PDF_HTTP_TOKEN}); engine.setConditions(owner, {online: true, downloadImages: true});
  const descriptor = await engine.pdfMetadata(owner, {key, id: PDF_HTTP_BOOKMARK, requestId: 'm1', allowNetwork: true});
  assert.equal(descriptor.size, server.document.bytes.length); assert.equal(descriptor.document_id, server.document.descriptor.document_id);
  assert.deepEqual(await engine.readPdfRange(owner, {key, id: PDF_HTTP_BOOKMARK, documentId: descriptor.document_id, size: descriptor.size, begin: 5, end: 100, requestId: 'r1'}), server.document.bytes.slice(5, 100));
  engine.applyPlan(owner, {revision: 1, upsert: [{key, id: PDF_HTTP_BOOKMARK, kind: 'pdf', manual: true, version: 'v1'}], remove: []}); await engine.settled();
  assert.equal((await engine.pdfStatus(owner, key)).complete, true); assert.deepEqual(statuses, ['downloading', 'complete']);
  assert.equal((await fetch(server.origin+'/__fixture/control?mode=metadata-404', {method: 'POST', headers})).status, 200);
  await assert.rejects(engine.pdfMetadata(owner, {key, id: PDF_HTTP_BOOKMARK, requestId: 'm2', allowNetwork: true}), error => error.code === 'HTTP_404');
  assert.equal((await engine.pdfStatus(owner, key)).totalBytes, 0, 'HTTP 404 never reuses cached authorization/metadata'); assert.equal(statuses.at(-1), 'invalidated');
  await fetch(server.origin+'/__fixture/control?mode=normal', {method: 'POST', headers});
  engine.applyPlan(owner, {revision: 2, upsert: [{key, id: PDF_HTTP_BOOKMARK, kind: 'pdf', manual: true, version: 'v2'}], remove: []}); await engine.settled();
  await server.close(); closed = true;
  const offlineDescriptor = await engine.pdfMetadata(owner, {key, id: PDF_HTTP_BOOKMARK, requestId: 'm3', allowNetwork: true});
  assert.equal(offlineDescriptor.document_id, descriptor.document_id);
  assert.deepEqual(await engine.readPdfRange(owner, {key, id: PDF_HTTP_BOOKMARK, documentId: descriptor.document_id, size: descriptor.size, begin: 5, end: 100, requestId: 'r2'}), server.document.bytes.slice(5, 100));
  await engine.close(owner);
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
