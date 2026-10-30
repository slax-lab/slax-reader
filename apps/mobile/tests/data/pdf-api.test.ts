import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError, createMobileApi} from '../../src/data/api.ts';
import type {SessionAuthority} from '../../src/domain/session.ts';

const bytes = Uint8Array.from({length: 12}, (_, index) => index + 1);
const fixedSession = {token: 'a-token', userId: 'a', refreshedAt: 0};
function apiWith(fetch: typeof globalThis.fetch, sessions: SessionAuthority = {getSession: async () => fixedSession, clearIfMatches: async () => false}) {
  return createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch});
}
const isApiError = (status: number, message?: string) => (error: unknown) => error instanceof ApiError && error.status === status && (message === undefined || error.message === message);
const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';
test('PDF requests require authentication before uploading', async () => {
  let calls = 0;
  const api = apiWith(async () => {calls++; return Response.json({code: 200});}, {getSession: async () => null, clearIfMatches: async () => false});
  await assert.rejects(api.uploadPdf(new Blob([bytes]), 'paper.pdf'), isApiError(401, 'Authentication required')); assert.equal(calls, 0);
});
test('pre-aborted PDF requests do not send uploads', async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  const api = apiWith(async () => {calls++; return Response.json({code: 200});});
  await assert.rejects(api.uploadPdf(new Blob([bytes]), 'paper.pdf', controller.signal), isAbortError); assert.equal(calls, 0);
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
