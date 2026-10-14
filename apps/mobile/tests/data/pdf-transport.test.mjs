import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadComponent} from '../reader/parity-host.mjs';
import {createMobileApi, ApiError} from '../../src/data/api.ts';
import {DataTransportError, getDataErrorDiagnostic, isNetworkTransportError, PDF_REQUEST_TIMEOUT_MS} from '../../src/data/transport-errors.ts';
import {BackgroundArticleCache} from '../../src/data/background-cache.ts';
import {PdfBlockCache} from '../../src/data/pdf-cache.ts';
import {SessionChangedError} from '../../src/domain/session.ts';

const {FetchError} = await loadComponent('../../node_modules/expo/src/winter/fetch/FetchErrors.ts', {});
const bytes = new Uint8Array([1, 2, 3]);
const descriptor = {document_id: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, url: '/v1/bookmark/pdf?bookmark_uid=doc', filename: 'doc.pdf', source: 'upload', text_status: 'ready'};
const session = {token: 'synthetic', userId: 'account', refreshedAt: 0};
const sessions = {getSession: async () => session, clearIfMatches: async () => false};
const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};};
const api = (fetch, options = {}) => createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, sleep: async () => {}, fetch, ...options});
const metadataResponse = () => Response.json({code: 200, data: {pdf: descriptor}});
const rangeResponse = () => new Response(bytes, {status: 206, headers: {'Content-Type': 'application/pdf', 'Content-Range': 'bytes 0-2/3', 'Content-Length': '3'}});
const invoke = (client, kind, signal) => kind === 'metadata' ? client.getPdfMetadata('doc', signal) : client.getPdfRange('doc', descriptor.document_id, 0, 3, signal, 3);

async function cachedWorker(client) {
  const files = new Map();
  const storage = {async read(path) {return files.get(path) ?? null;}, async writeAtomic(path, value) {files.set(path, value);}, async remove(path) {files.delete(path);}, async list(prefix) {return [...files.keys()].filter(path => path.startsWith(prefix));}};
  const cache = new PdfBlockCache(storage, 'scope', () => {});
  await cache.setMetadata('doc', descriptor); await cache.writeBlock('doc', descriptor, 0, bytes);
  const database = {async getOptional() {return null;}, async execute() {}, async writeTransaction(work) {return work(database);}};
  const worker = new BackgroundArticleCache({database, preferences: {}, cache: {}, assertActive() {}, content: async () => '', image: async () => bytes,
    pdf: {cache, metadata: (id, signal) => client.getPdfMetadata(id, signal), range: (id, hash, begin, end, signal, size) => client.getPdfRange(id, hash, begin, end, signal, size)}});
  return {worker, cache, files};
}

test('the installed unnamed Expo FetchError is normalized and allows valid cached PDF reads', async () => {
  const error = new FetchError('private URL omitted'); assert.equal(error.name, 'Error'); assert.equal(error instanceof TypeError, false);
  let calls = 0; const waits = [];
  const client = api(async () => {calls++; throw error;}, {sleep: async ms => {waits.push(ms);}});
  const f = await cachedWorker(client);
  assert.deepEqual(await f.worker.getPdfMetadata('doc'), descriptor);
  assert.deepEqual(await f.worker.readPdfRange('doc', descriptor, 0, 3), bytes);
  assert.equal(calls, 3); assert.deepEqual(waits, [1000, 2000]);
  await f.worker.stop();
});

for (const kind of ['metadata', 'range']) {
  test(`${kind} retries native fetch rejection and raw HTTP 5xx under one bounded owner`, async () => {
    let calls = 0; const waits = [];
    const client = api(async () => {
      calls++; if (calls === 1) throw new FetchError('offline');
      if (calls === 2) return new Response(null, {status: 503});
      return kind === 'metadata' ? metadataResponse() : rangeResponse();
    }, {sleep: async ms => {waits.push(ms);}});
    assert.deepEqual(await invoke(client, kind), kind === 'metadata' ? descriptor : bytes);
    assert.equal(calls, 3); assert.deepEqual(waits, [1000, 2000]);
  });
  for (const failure of ['network', 'server']) test(`${kind} stops after three ${failure} attempts and emits safe diagnostics`, async () => {
    let calls = 0;
    const client = api(async () => {calls++; if (failure === 'network') throw new FetchError('https://private.example/?token=secret'); return new Response('private server body', {status: 503});});
    await assert.rejects(invoke(client, kind), error => {
      assert.deepEqual(getDataErrorDiagnostic(error), failure === 'network'
        ? {stage: `pdf-${kind}`, kind: 'network', code: 'network_unavailable'}
        : {stage: `pdf-${kind}`, kind: 'http', code: 'http_server_error', status: 503});
      assert.equal(JSON.stringify(getDataErrorDiagnostic(error)).includes('private'), false);
      return failure === 'network' ? isNetworkTransportError(error) : error instanceof ApiError;
    });
    assert.equal(calls, 3);
  });
  test(`${kind} abort during retry backoff prevents further sends`, async () => {
    const waiting = deferred(), held = deferred(), controller = new AbortController(); let calls = 0;
    const client = api(async () => {calls++; throw new FetchError('offline');}, {sleep: async () => {waiting.resolve(); await held.promise;}});
    const request = invoke(client, kind, controller.signal), rejected = assert.rejects(request, {name: 'AbortError'});
    await waiting.promise; controller.abort(); await rejected; held.resolve(); assert.equal(calls, 1);
  });
  test(`${kind} cannot retry old credentials after a session replacement`, async () => {
    let changed = false, calls = 0;
    const authority = {...sessions, captureRequestScope: () => ({getSession: async () => session, assertCurrent() {if (changed) throw new SessionChangedError();}})};
    const client = api(async () => {calls++; throw new FetchError('offline');}, {sessions: authority, sleep: async () => {changed = true;}});
    await assert.rejects(invoke(client, kind), SessionChangedError); assert.equal(calls, 1);
  });
  test(`${kind} retries a native streaming failure but never commits its partial bytes`, async () => {
    let calls = 0;
    const client = api(async () => {
      if (++calls > 1) return kind === 'metadata' ? metadataResponse() : rangeResponse();
      const good = kind === 'metadata' ? metadataResponse() : rangeResponse();
      return new Response(new ReadableStream({pull(controller) {controller.error(new FetchError('connection lost'));}}), {status: good.status, headers: good.headers});
    });
    assert.deepEqual(await invoke(client, kind), kind === 'metadata' ? descriptor : bytes); assert.equal(calls, 2);
  });
}

test('HTTP, protocol and parser failures never fall back to cached metadata', async () => {
  for (const response of [() => new Response('denied', {status: 403}), () => new Response('not found', {status: 404}), () => Response.json({code: 200, data: {}}), () => new Response('{bad json')]) {
    let calls = 0; const f = await cachedWorker(api(async () => {calls++; return response();}));
    await assert.rejects(f.worker.getPdfMetadata('doc'), error => error instanceof ApiError && !isNetworkTransportError(error));
    assert.equal(calls, 1); await f.worker.stop();
  }
});

test('arbitrary TypeError from protocol access or cache persistence cannot become offline success', async () => {
  const protocol = new TypeError('broken response implementation');
  const f = await cachedWorker(api(async () => Object.defineProperty(metadataResponse(), 'status', {get() {throw protocol;}})));
  await assert.rejects(f.worker.getPdfMetadata('doc'), error => error === protocol); await f.worker.stop();
  const g = await cachedWorker(api(async () => metadataResponse()));
  const storageError = new TypeError('storage bug'); g.cache.setMetadata = async () => {throw storageError;};
  await assert.rejects(g.worker.getPdfMetadata('doc'), error => error === storageError); await g.worker.stop();
});

for (const kind of ['metadata', 'range']) test(`${kind} shares one 120-second budget across retries and cancels its pending stream`, async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  let calls = 0, cancelled = false; const bodyStarted = deferred();
  const client = api(async () => {
    if (++calls === 1) return new Response(null, {status: 503});
    const good = kind === 'metadata' ? metadataResponse() : rangeResponse();
    return new Response(new ReadableStream({pull() {bodyStarted.resolve();}, cancel() {cancelled = true;}}, {highWaterMark: 0}), {status: good.status, headers: good.headers});
  }, {sleep: async () => {context.mock.timers.tick(60000);}});
  const pending = invoke(client, kind), rejected = assert.rejects(pending, error => error instanceof DataTransportError && error.kind === 'timeout' && error.stage === `pdf-${kind}`);
  await bodyStarted.promise; context.mock.timers.tick(PDF_REQUEST_TIMEOUT_MS - 60001); assert.equal(cancelled, false);
  context.mock.timers.tick(1); await rejected; assert.equal(cancelled, true); assert.equal(calls, 2);
});

test('transport deadline aborts even a fetch implementation that ignores its signal', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const started = deferred(), late = deferred(); let cancelled = false, transportSignal;
  const client = api(async (_url, request) => {transportSignal = request.signal; started.resolve(); return late.promise;});
  const pending = client.getPdfMetadata('doc'), rejected = assert.rejects(pending, error => error instanceof DataTransportError && error.kind === 'timeout');
  await started.promise; context.mock.timers.tick(PDF_REQUEST_TIMEOUT_MS); await rejected; assert.equal(transportSignal.aborted, true);
  late.resolve(new Response(new ReadableStream({cancel() {cancelled = true;}}, {highWaterMark: 0})));
  await Promise.resolve(); await Promise.resolve(); assert.equal(cancelled, true);
});

for (const failure of ['network', 'server']) test(`PDF upload does not automatically retry ${failure} errors`, async () => {
  let calls = 0;
  const client = api(async () => {calls++; if (failure === 'network') throw new FetchError('offline'); return new Response(null, {status: 503});});
  await assert.rejects(client.uploadPdf(new Blob([bytes]), 'doc.pdf'));
  assert.equal(calls, 1);
});

test('404 diagnostics describe the status without claiming a missing deployment or leaking response details', async () => {
  await assert.rejects(api(async () => new Response('private route detail', {status: 404})).getPdfMetadata('doc'), error => {
    assert.deepEqual(getDataErrorDiagnostic(error), {stage: 'pdf-metadata', kind: 'http', code: 'http_not_found', status: 404}); return true;
  });
});

test('502 protocol validation failures are not retried like raw HTTP 5xx', async () => {
  for (const header of ['Content-Range', 'Content-Length']) {
    let calls = 0;
    const client = api(async () => {calls++; const response = rangeResponse(); response.headers.set(header, 'invalid'); return response;});
    await assert.rejects(client.getPdfRange('doc', descriptor.document_id, 0, 3, undefined, 3), error => {
      assert.equal(getDataErrorDiagnostic(error).kind, 'protocol'); assert.equal(error.stage, 'pdf-range'); return true;
    });
    assert.equal(calls, 1);
  }
});

test('cancellation and account replacement override a native network-shaped rejection', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(api(async () => {calls++; controller.abort(); throw new FetchError('cancelled');}).getPdfMetadata('doc', controller.signal), {name: 'AbortError'});
  assert.equal(calls, 1);
  let changed = false;
  const authority = {...sessions, captureRequestScope: () => ({getSession: async () => session, assertCurrent() {if (changed) throw new SessionChangedError();}})};
  await assert.rejects(api(async () => {changed = true; throw new FetchError('offline');}, {sessions: authority}).getPdfMetadata('doc'), SessionChangedError);
});

test('a stalled metadata request ends at the shared deadline without using an offline fallback', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const entered = deferred(); let calls = 0;
  const f = await cachedWorker(api(async () => {calls++; entered.resolve(); return new Promise(() => {});}));
  const pending = f.worker.getPdfMetadata('doc');
  const rejected = assert.rejects(pending, error => error instanceof DataTransportError && error.kind === 'timeout');
  await entered.promise; context.mock.timers.tick(PDF_REQUEST_TIMEOUT_MS); await rejected;
  assert.equal(calls, 1); assert.deepEqual(await f.cache.read('doc', descriptor, 0, 3), bytes);
  await f.worker.stop();
});
