import test from 'node:test';
import assert from 'node:assert/strict';
import {PDF_MAX_BYTES} from '@slax-reader/contracts/pdf';
import {ApiError, createMobileApi} from '../../src/data/api.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {SessionChangedError, SessionController, type SessionAuthority} from '../../src/domain/session.ts';
import {MemoryPreferences} from './helpers.ts';

const documentId = 'a'.repeat(64), etag = `"${documentId}"`;
const bytes = Uint8Array.from({length: 12}, (_, index) => index + 1);
const descriptor = {url: 'https://untrusted.example/private.pdf', filename: 'paper.pdf', size: bytes.length, document_id: documentId, source: 'url', text_status: 'ready', pages: 2};
const fixedSession = {token: 'a-token', userId: 'a', refreshedAt: 0};
function apiWith(fetch: typeof globalThis.fetch, sessions: SessionAuthority = {getSession: async () => fixedSession, clearIfMatches: async () => false}) {
  return createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch});
}
function pdfResponse({status = 206, headers: overrides = {}, chunks = [bytes.subarray(3, 7)]}: {status?: number; headers?: Record<string, string | null>; chunks?: Uint8Array[]} = {}) {
  const headers = new Headers({'Content-Type': 'application/pdf', ETag: etag, 'Content-Range': `bytes 3-6/${bytes.length}`, 'Content-Length': '4'});
  for (const [key, value] of Object.entries(overrides)) {if (value === null) headers.delete(key); else headers.set(key, value);}
  const state = {pulls: 0, cancelled: false};
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {const chunk = chunks[state.pulls++]; if (chunk) controller.enqueue(chunk); else controller.close();},
    cancel() {state.cancelled = true;},
  }, {highWaterMark: 0}), {status, headers});
  return {response, state};
}
const isApiError = (status: number, message?: string) => (error: unknown) => error instanceof ApiError && error.status === status && (message === undefined || error.message === message);
const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';
async function accountSessions(storage = new MemoryPreferences({auth_token: 'a-token', user_id: 'a'})) {
  const sessions = new SessionController(new PreferenceStore(storage), {leave: async () => {}, enter: async () => {}});
  await sessions.restore(); return sessions;
}

for (const textStatus of ['pending', 'ready', 'empty', 'failed']) {
  test(`PDF metadata accepts ${textStatus} and replaces an untrusted URL with the native API endpoint`, async () => {
    const bookmarkId = 'bookmark /?&=#', data = {...descriptor, text_status: textStatus, source: textStatus === 'ready' ? 'url' : 'upload'};
    const api = apiWith(async (url, request) => {
      assert.equal(String(url), `https://api.example/v1/bookmark/metadata?${new URLSearchParams({bookmark_uid: bookmarkId})}`);
      assert.equal(request?.method, 'GET'); assert.equal(request?.body, undefined);
      assert.equal(new Headers(request?.headers).get('Authorization'), 'Bearer a-token');
      assert.equal(request?.redirect, 'error');
      return Response.json({code: 200, data: {pdf: data}});
    });
    assert.deepEqual(await api.getPdfMetadata(bookmarkId), {...data, url: `/v1/bookmark/pdf?bookmark_uid=${encodeURIComponent(bookmarkId)}`});
  });
}
for (const [name, data] of [
  ['absent descriptor', undefined], ['null descriptor', null],
  ['missing digest', {...descriptor, document_id: undefined}], ['short digest', {...descriptor, document_id: 'a'.repeat(63)}],
  ['long digest', {...descriptor, document_id: 'a'.repeat(65)}], ['uppercase digest', {...descriptor, document_id: 'A'.repeat(64)}],
  ['non-hex digest', {...descriptor, document_id: 'g'.repeat(64)}],
  ['empty file', {...descriptor, size: 0}], ['negative size', {...descriptor, size: -1}], ['fractional size', {...descriptor, size: 1.5}],
  ['string size', {...descriptor, size: '12'}], ['oversized file', {...descriptor, size: PDF_MAX_BYTES + 1}],
  ['unsafe size', {...descriptor, size: Number.MAX_SAFE_INTEGER + 1}], ['invalid filename', {...descriptor, filename: null}],
  ['unknown source', {...descriptor, source: 'external'}], ['unknown text status', {...descriptor, text_status: 'unknown'}],
] as const) {
  test(`PDF metadata rejects ${name}`, async () => {
    await assert.rejects(apiWith(async () => Response.json({code: 200, data: {pdf: data}})).getPdfMetadata('bookmark'), isApiError(502, 'Invalid PDF metadata'));
  });
}
for (const data of [undefined, null, {}, {title: 'An article without PDF'}, descriptor]) test(`PDF metadata rejects a missing nested pdf field: ${JSON.stringify(data)}`, async () => {
  await assert.rejects(apiWith(async () => Response.json({code: 200, data})).getPdfMetadata('bookmark'), error => error instanceof ApiError && error.code === 'pdf_metadata_invalid');
});
test('PDF metadata accepts the maximum supported file size', async () => {
  const api = apiWith(async () => Response.json({code: 200, data: {pdf: {...descriptor, size: PDF_MAX_BYTES}}}));
  assert.equal((await api.getPdfMetadata('bookmark')).size, PDF_MAX_BYTES);
});

test('PDF ranges use exclusive end offsets, bearer identity and exact 206 streaming bytes', async () => {
  const {response, state} = pdfResponse({chunks: [bytes.subarray(3, 5), bytes.subarray(5, 7)], headers: {'Content-Type': 'APPLICATION/PDF; charset=binary'}});
  const bookmarkId = 'bookmark /?&=#';
  const api = apiWith(async (url, request) => {
    assert.equal(String(url), `https://api.example/v1/bookmark/pdf?${new URLSearchParams({bookmark_uid: bookmarkId})}`);
    assert.equal(request?.method, 'GET'); assert.equal(request?.body, undefined); assert.equal(request?.redirect, 'error');
    const headers = new Headers(request?.headers);
    assert.equal(headers.get('Range'), 'bytes=3-6'); assert.equal(headers.get('If-Match'), null);
    assert.equal(headers.get('Accept'), 'application/pdf'); assert.equal(headers.get('Authorization'), 'Bearer a-token');
    assert.equal(headers.get('X-CLIENT-TYPE'), 'ios'); assert.equal(headers.get('X-CLIENT-VERSION'), 'test');
    return response;
  });
  assert.deepEqual(await api.getPdfRange(bookmarkId, documentId, 3, 7), bytes.subarray(3, 7));
  assert.equal(state.pulls, 3); assert.equal(response.body?.locked, false);
});
test('PDF ranges accept an exact 206 stream without Content-Length', async () => {
  const {response} = pdfResponse({headers: {'Content-Length': null}});
  assert.deepEqual(await apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7), bytes.subarray(3, 7));
});
for (const [name, digest, begin, end] of [
  ['malformed identity', 'bad', 3, 7], ['negative start', documentId, -1, 7], ['fractional start', documentId, 0.5, 7],
  ['fractional end', documentId, 0, 7.5], ['empty range', documentId, 3, 3], ['reversed range', documentId, 7, 3],
  ['unsafe end', documentId, 0, Number.MAX_SAFE_INTEGER + 1], ['file size limit', documentId, PDF_MAX_BYTES - 1, PDF_MAX_BYTES + 1],
  ['chunk size limit', documentId, 0, 1024 * 1024 + 1],
] as const) {
  test(`PDF ranges reject ${name} without a network request`, async () => {
    let calls = 0;
    const api = apiWith(async () => {calls++; return pdfResponse().response;});
    await assert.rejects(api.getPdfRange('bookmark', digest, begin, end), /Invalid PDF byte range/); assert.equal(calls, 0);
  });
}
for (const value of [null, '"opaque-storage-version"', '"e4d909c290d0fb1ca068ffaddf22cbd0"', `W/"${'b'.repeat(64)}"`, documentId, etag]) {
  test(`PDF ranges accept optional or opaque ETag ${value}`, async () => {
    const {response} = pdfResponse({headers: {ETag: value}});
    assert.deepEqual(await apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7, undefined, bytes.length), bytes.subarray(3, 7));
  });
}
test('PDF ranges reject a mismatched strong SHA-256 ETag and cancel the unread body', async () => {
  const {response, state} = pdfResponse({headers: {ETag: `"${'b'.repeat(64)}"`}});
  await assert.rejects(apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7), error => error instanceof ApiError && error.status === 412 && error.code === 'pdf_identity_mismatch');
  assert.equal(state.cancelled, true); assert.equal(state.pulls, 0);
});
for (const [name, headers] of [
  ['missing MIME type', {'Content-Type': null}], ['HTML MIME type', {'Content-Type': 'text/html'}],
  ['misleading MIME type', {'Content-Type': 'application/pdfx'}],
] as const) {
  test(`PDF ranges reject ${name} and cancel the unread body`, async () => {
    const {response, state} = pdfResponse({headers});
    await assert.rejects(apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7), isApiError(502, 'Invalid PDF response content type'));
    assert.equal(state.cancelled, true); assert.equal(state.pulls, 0);
  });
}
for (const contentRange of [null, 'bytes 2-6/12', 'bytes 3-7/12', 'bytes 3-6/6', `bytes 3-6/${PDF_MAX_BYTES + 1}`, 'bytes 3-6/*', 'bytes */12', '3-6/12']) {
  test(`PDF ranges reject invalid Content-Range ${contentRange}`, async () => {
    const {response, state} = pdfResponse({headers: {'Content-Range': contentRange}});
    await assert.rejects(apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7), isApiError(502, 'Invalid PDF range response'));
    assert.equal(state.cancelled, true); assert.equal(state.pulls, 0);
  });
}
for (const length of ['0', '3', '5', '-1', 'invalid']) {
  test(`PDF ranges reject mismatched Content-Length ${length}`, async () => {
    const {response, state} = pdfResponse({headers: {'Content-Length': length}});
    await assert.rejects(apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7), isApiError(502, 'Invalid PDF response length'));
    assert.equal(state.cancelled, true); assert.equal(state.pulls, 0);
  });
}
for (const status of [200, 206]) {
  test(`PDF ${status} rejects truncated bytes even when the advertised length is valid`, async () => {
    const {response} = status === 206 ? pdfResponse({chunks: [bytes.subarray(3, 6)]}) : pdfResponse({status, headers: {'Content-Length': '12', 'Content-Range': null}, chunks: [bytes.subarray(0, 11)]});
    await assert.rejects(apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7), isApiError(502, 'Incomplete PDF response'));
    assert.equal(response.body?.locked, false);
  });
  test(`PDF ${status} cancels streams that exceed the advertised length`, async () => {
    const {response, state} = status === 206 ? pdfResponse({chunks: [bytes.subarray(3, 8)]}) : pdfResponse({status, headers: {'Content-Length': '12', 'Content-Range': null}, chunks: [bytes, new Uint8Array([99])]});
    await assert.rejects(apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7), isApiError(502, 'PDF response exceeds its length'));
    assert.equal(state.cancelled, true); assert.equal(response.body?.locked, false);
  });
}
for (const contentRange of ['bytes 3-6/12', 'bytes 0-11/12', 'invalid']) {
  test(`PDF 200 rejects Content-Range ${contentRange} before reading a misleading full response`, async () => {
    const {response, state} = pdfResponse({status: 200, headers: {'Content-Length': String(bytes.length), 'Content-Range': contentRange}, chunks: [bytes]});
    await assert.rejects(apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7), isApiError(502, 'Partial PDF body returned as a full response'));
    assert.equal(state.cancelled, true); assert.equal(state.pulls, 0);
  });
}
for (const status of [200, 206]) {
  test(`PDF ${status} accepts an exact expected document size after the optional signal`, async () => {
    const {response} = status === 206 ? pdfResponse() : pdfResponse({status, headers: {'Content-Length': String(bytes.length), 'Content-Range': null}, chunks: [bytes]});
    const controller = new AbortController();
    assert.deepEqual(await apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7, controller.signal, bytes.length), bytes.subarray(3, 7));
  });
  for (const total of [bytes.length - 1, bytes.length + 1]) {
    test(`PDF ${status} rejects total size ${total} that differs from metadata before reading`, async () => {
      const {response, state} = status === 206 ? pdfResponse({headers: {'Content-Range': `bytes 3-6/${total}`}}) : pdfResponse({status, headers: {'Content-Length': String(total), 'Content-Range': null}, chunks: [new Uint8Array(total)]});
      await assert.rejects(apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7, undefined, bytes.length), isApiError(502, status === 206 ? 'Invalid PDF range response' : 'Invalid PDF response length'));
      assert.equal(state.cancelled, true); assert.equal(state.pulls, 0);
    });
  }
}
for (const expectedSize of [0, -1, 6, 12.5, Number.NaN, Number.POSITIVE_INFINITY, PDF_MAX_BYTES + 1]) {
  test(`PDF ranges reject invalid expected size ${expectedSize} before fetching`, async () => {
    let calls = 0;
    const api = apiWith(async () => {calls++; return pdfResponse().response;});
    await assert.rejects(api.getPdfRange('bookmark', documentId, 3, 7, undefined, expectedSize), /Invalid PDF byte range/); assert.equal(calls, 0);
  });
}
test('PDF ranges validate expected total size even without Content-Length', async () => {
  const {response} = pdfResponse({headers: {'Content-Length': null}});
  assert.deepEqual(await apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7, undefined, bytes.length), bytes.subarray(3, 7));
});
test('PDF 200 fallback consumes the full stream and returns only the requested cross-chunk slice', async () => {
  const {response, state} = pdfResponse({status: 200, headers: {'Content-Length': String(bytes.length), 'Content-Range': null}, chunks: [bytes.subarray(0, 2), bytes.subarray(2, 5), bytes.subarray(5, 8), bytes.subarray(8)]});
  Object.assign(response, {arrayBuffer: () => assert.fail('PDF fallback must stream, not buffer the full response'), blob: () => assert.fail('PDF fallback must stream, not materialize a Blob')});
  assert.deepEqual(await apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7), bytes.subarray(3, 7));
  assert.equal(state.pulls, 5); assert.equal(response.body?.locked, false);
});
for (const length of [null, '0', '6', '12.5', String(PDF_MAX_BYTES + 1)]) {
  test(`PDF full responses reject invalid Content-Length ${length} before reading`, async () => {
    const {response, state} = pdfResponse({status: 200, headers: {'Content-Length': length, 'Content-Range': null}, chunks: [bytes]});
    await assert.rejects(apiWith(async () => response).getPdfRange('bookmark', documentId, 3, 7), isApiError(502, 'Invalid PDF response length'));
    assert.equal(state.cancelled, true); assert.equal(state.pulls, 0);
  });
}
for (const status of [401, 403, 404, 412, 416]) {
  test(`PDF HTTP ${status} is surfaced once and cancels the response body`, async () => {
    let calls = 0; const rejected: string[] = [];
    const {response, state} = pdfResponse({status});
    const api = apiWith(async () => {calls++; return response;}, {getSession: async () => fixedSession, clearIfMatches: async () => assert.fail('HTTP rejection must not clear local data'), rejectIfMatches: async token => {rejected.push(token); return true;}});
    await assert.rejects(api.getPdfRange('bookmark', documentId, 3, 7), isApiError(status, `PDF request failed (${status})`));
    assert.equal(calls, 1); assert.equal(state.cancelled, true); assert.equal(state.pulls, 0);
    assert.deepEqual(rejected, status === 401 ? ['a-token'] : []);
  });
}
test('PDF requests require authentication before fetching bytes or uploading', async () => {
  let calls = 0;
  const api = apiWith(async () => {calls++; return pdfResponse().response;}, {getSession: async () => null, clearIfMatches: async () => false});
  await assert.rejects(api.getPdfRange('bookmark', documentId, 3, 7), isApiError(401, 'Authentication required'));
  await assert.rejects(api.uploadPdf(new Blob([bytes]), 'paper.pdf'), isApiError(401, 'Authentication required')); assert.equal(calls, 0);
});
test('pre-aborted PDF requests do not send bytes or uploads', async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  const api = apiWith(async () => {calls++; return pdfResponse().response;});
  await assert.rejects(api.getPdfRange('bookmark', documentId, 3, 7, controller.signal), isAbortError);
  await assert.rejects(api.uploadPdf(new Blob([bytes]), 'paper.pdf', controller.signal), isAbortError); assert.equal(calls, 0);
});
test('aborting an in-flight PDF fetch propagates to its transport without retries', async () => {
  let started!: () => void, calls = 0;
  const waiting = new Promise<void>(resolve => {started = resolve;}), controller = new AbortController();
  const api = apiWith(async (_url, request) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      request?.signal?.addEventListener('abort', () => reject(request.signal?.reason), {once: true}); started();
    });
  });
  const pending = assert.rejects(api.getPdfRange('bookmark', documentId, 3, 7, controller.signal), isAbortError);
  await waiting; controller.abort(); await pending; assert.equal(calls, 1);
});
test('aborting a pending PDF body read cancels it and releases the stream lock', async () => {
  let started!: () => void, streamController!: ReadableStreamDefaultController<Uint8Array>, cancelled = false, transportSignal: AbortSignal | null | undefined;
  const waiting = new Promise<void>(resolve => {started = resolve;}), controller = new AbortController();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) {streamController = value;}, pull() {started();}, cancel() {cancelled = true;},
  }, {highWaterMark: 0}), {status: 206, headers: {'Content-Type': 'application/pdf', ETag: etag, 'Content-Range': 'bytes 3-6/12', 'Content-Length': '4'}});
  const api = apiWith(async (_url, request) => {transportSignal = request?.signal; return response;});
  const pending = api.getPdfRange('bookmark', documentId, 3, 7, controller.signal);
  const settled = pending.then(() => null, error => error);
  await waiting; controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([settled, new Promise<Error>(resolve => {timer = setTimeout(() => resolve(new Error('PDF body read did not settle after abort')), 250);})]);
    assert.equal(transportSignal?.aborted, true);
    assert.ok(isAbortError(outcome), `Expected AbortError, received ${String(outcome)}`);
    assert.equal(cancelled, true); assert.equal(response.body?.locked, false);
  } finally {
    clearTimeout(timer); if (!cancelled) streamController.close(); await settled;
  }
});
test('the internal PDF timeout cancels a stalled body read without a caller signal', async context => {
  const realSetTimeout = setTimeout, realClearTimeout = clearTimeout;
  context.mock.timers.enable({apis: ['setTimeout']});
  let started!: () => void, streamController!: ReadableStreamDefaultController<Uint8Array>, cancelled = false, transportSignal: AbortSignal | null | undefined, calls = 0;
  const waiting = new Promise<void>(resolve => {started = resolve;});
  const response = new Response(new ReadableStream<Uint8Array>({
    start(value) {streamController = value;}, pull() {started();}, cancel() {cancelled = true;},
  }, {highWaterMark: 0}), {status: 206, headers: {'Content-Type': 'application/pdf', ETag: etag, 'Content-Range': 'bytes 3-6/12', 'Content-Length': '4'}});
  const api = apiWith(async (_url, request) => {calls++; transportSignal = request?.signal; return response;});
  const pending = api.getPdfRange('bookmark', documentId, 3, 7);
  const settled = pending.then(() => null, error => error);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await waiting; context.mock.timers.tick(119999);
    assert.equal(transportSignal?.aborted, false); assert.equal(cancelled, false);
    context.mock.timers.tick(1);
    const outcome = await Promise.race([settled, new Promise<Error>(resolve => {timer = realSetTimeout(() => resolve(new Error('PDF body read did not settle after its timeout')), 250);})]);
    assert.ok(outcome instanceof Error); assert.equal(outcome.message, 'PDF request timed out');
    assert.equal(transportSignal?.aborted, true); assert.equal(transportSignal?.reason, outcome);
    assert.equal(cancelled, true); assert.equal(response.body?.locked, false); assert.equal(calls, 1);
  } finally {
    realClearTimeout(timer); if (!cancelled) streamController.close(); await settled; context.mock.timers.reset();
  }
});
test('a held PDF request cannot acquire the next account bearer', async () => {
  let held: {started: () => void; gate: Promise<void>} | undefined;
  class HeldReadPreferences extends MemoryPreferences {
    override async read() {const value = held; held = undefined; if (value) {value.started(); await value.gate;} return super.read();}
  }
  const sessions = await accountSessions(new HeldReadPreferences({auth_token: 'a-token', user_id: 'a'}));
  let started!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => {started = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const bearers: (string | null)[] = [];
  const api = apiWith(async (_url, request) => {bearers.push(new Headers(request?.headers).get('Authorization')); return pdfResponse().response;}, sessions);
  held = {started, gate};
  const pending = assert.rejects(api.getPdfRange('a-bookmark', documentId, 3, 7), SessionChangedError);
  await waiting; await sessions.accept('b-token', 'b'); release(); await pending;
  assert.deepEqual(bearers, []);
  await api.getPdfRange('b-bookmark', documentId, 3, 7); assert.deepEqual(bearers, ['Bearer b-token']);
});
for (const status of [206, 401]) {
  test(`a late PDF ${status} cannot return bytes or clear a replacement account`, async () => {
    const sessions = await accountSessions(), {response, state} = pdfResponse({status});
    const api = apiWith(async (_url, request) => {
      assert.equal(new Headers(request?.headers).get('Authorization'), 'Bearer a-token');
      await sessions.accept('b-token', 'b'); return response;
    }, sessions);
    try {
      await assert.rejects(api.getPdfRange('a-bookmark', documentId, 3, 7), SessionChangedError);
      await sessions.clearIfMatches('unrelated-token');
      assert.equal((await sessions.getSession())?.token, 'b-token'); assert.equal(state.pulls, 0);
    } finally {await response.body?.cancel();}
  });
}
test('account changes during PDF streaming prevent old bytes from being returned', async () => {
  const sessions = await accountSessions(); let sent = false;
  const response = new Response(new ReadableStream<Uint8Array>({async pull(controller) {
    if (sent) {controller.close(); return;}
    sent = true; await sessions.accept('b-token', 'b'); controller.enqueue(bytes.subarray(3, 7));
  }}, {highWaterMark: 0}), {status: 206, headers: {'Content-Type': 'application/pdf', ETag: etag, 'Content-Range': 'bytes 3-6/12', 'Content-Length': '4'}});
  await assert.rejects(apiWith(async () => response, sessions).getPdfRange('a-bookmark', documentId, 3, 7), SessionChangedError);
  assert.equal(response.body?.locked, false); assert.equal((await sessions.getSession())?.userId, 'b');
});
test('PDF upload sends the original Blob rather than JSON and preserves the filename query', async () => {
  const body = new Blob([bytes], {type: 'application/pdf'}), filename = '论文 & #1.pdf', result = {bookmark_uid: 'uploaded', bookmark_id: 42};
  const api = apiWith(async (url, request) => {
    assert.equal(String(url), `https://api.example/v1/bookmark/upload_pdf?${new URLSearchParams({filename})}`);
    assert.equal(request?.method, 'POST'); assert.equal(request?.body, body); assert.equal(request?.redirect, 'error');
    const headers = new Headers(request?.headers);
    assert.equal(headers.get('Content-Type'), 'application/pdf'); assert.equal(headers.get('Accept'), 'application/json');
    assert.equal(headers.get('Authorization'), 'Bearer a-token'); assert.equal(headers.get('X-CLIENT-TYPE'), 'ios'); assert.equal(headers.get('X-CLIENT-VERSION'), 'test');
    assert.deepEqual(new Uint8Array(await (request?.body as Blob).arrayBuffer()), bytes);
    return Response.json({code: 200, data: result});
  });
  assert.deepEqual(await api.uploadPdf(body, filename), result);
});
test('PDF upload rejects an empty file before fetching', async () => {
  let calls = 0;
  const api = apiWith(async () => {calls++; return Response.json({code: 200});});
  await assert.rejects(api.uploadPdf(new Blob(), 'empty.pdf'), /Invalid PDF upload size/); assert.equal(calls, 0);
});
test('PDF upload surfaces API envelope failures', async () => {
  const api = apiWith(async () => Response.json({code: 400, message: 'PDF Labs is disabled'}));
  await assert.rejects(api.uploadPdf(new Blob([bytes]), 'paper.pdf'), isApiError(400, 'PDF Labs is disabled'));
});
for (const enabled of [true, false]) {
  test(`setLab ${enabled ? 'enables' : 'disables'} PDF using the existing user-setting endpoint`, async () => {
    const api = apiWith(async (url, request) => {
      assert.equal(String(url), `https://api.example/v1/user/setting/${enabled ? 'enable' : 'disable'}`);
      assert.equal(request?.method, 'POST'); assert.deepEqual(JSON.parse(String(request?.body)), {key: 'lab:pdf'});
      assert.equal(new Headers(request?.headers).get('Authorization'), 'Bearer a-token');
      return Response.json({code: 200, data: {enabled}});
    });
    assert.deepEqual(await api.setLab('pdf', enabled), {enabled});
  });
}
