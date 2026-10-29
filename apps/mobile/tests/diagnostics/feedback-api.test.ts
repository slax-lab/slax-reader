import test from 'node:test';
import assert from 'node:assert/strict';
import {SlaxApi, FEEDBACK_DIAGNOSTIC_MAX_BYTES, FEEDBACK_MULTIPART_OVERHEAD_BYTES} from '../../src/data/api.ts';
import type {FeedbackRequest, MobileApiOptions} from '../../src/data/api.ts';

const report: FeedbackRequest = {bookmark_uuid: 'bookmark', entry_point: 'reader', type: 'parse_error', content: 'First line\nSecond line', platform: 'app', environment: 'iOS 794', version: '1.0.25 (794)', allow_follow_up: false, target_url: 'https://example.org/article'};
const upload = () => ({file: new Blob([JSON.stringify({v: 1, ts: '2026-10-29T12:00:00Z', src: 'app', launch: 'abcd1234', event: 'auth.signout', cause: 'user'}) + '\n'], {type: 'application/x-ndjson'}), filename: 'slax-diagnostics-2026-10-29.ndjson'});
function fixture(fetch: NonNullable<MobileApiOptions['fetch']>, preparation: () => Promise<void> = async () => {}) {
  let epoch = 0, authenticated = true, rejected = 0;
  const capture = () => {const original = epoch; return () => {if (original !== epoch) throw new Error('account changed');};};
  const sessions = {captureIdentity: capture, prepareRequest: preparation, captureRequestScope() {const assertCurrent = capture(); return {assertCurrent, async getSession() {assertCurrent(); return authenticated ? {token: 'test-token', userId: 'test-user', refreshedAt: 0} : null;}};}, getSession: async () => null, clearIfMatches: async () => false, rejectIfMatches: async () => {rejected++; return true;}};
  return {api: new SlaxApi({baseUrl: 'https://api.example.org', platform: 'ios', version: '1.0.25', sessions, fetch, sleep: async () => {}}), change: () => {epoch++;}, signOut: () => {authenticated = false;}, rejections: () => rejected};
}
const success = () => new Response(JSON.stringify({code: 200, data: 'ok', message: ''}), {status: 200, headers: {'Content-Type': 'application/json'}});
test('unchecked sendFeedback retains JSON payload and existing call signature', async () => {
  const f = fixture(async (url, request) => {assert.equal(url, 'https://api.example.org/v1/user/report'); assert.equal(new Headers(request?.headers).get('Content-Type'), 'application/json'); assert.deepEqual(JSON.parse(request?.body as string), report); return success();});
  assert.equal(await f.api.sendFeedback(report), 'ok');
});
test('checked feedback serializes one report and one NDJSON File using authenticated transport', async () => {
  const file = upload(); const f = fixture(async (url, request) => {
    assert.equal(new Headers(request?.headers).has('Content-Type'), false); assert.equal(new Headers(request?.headers).get('Authorization'), 'Bearer test-token'); assert.equal(request?.redirect, 'error');
    const encoded = new Request(url, request), form = await encoded.formData() as unknown as {keys(): IterableIterator<string>; get(name: string): string | File | null};
    assert.deepEqual([...form.keys()], ['report', 'diagnostic_log']);
    assert.deepEqual(JSON.parse(form.get('report') as string), {...report, attach_diagnostic_log: true});
    const received = form.get('diagnostic_log') as File; assert.equal(received.name, file.filename); assert.equal(await received.text(), await file.file.text()); assert.equal(received.type, 'application/x-ndjson');
    return success();
  });
  assert.equal(await f.api.sendFeedback(report, undefined, file), 'ok');
});
test('attachment upload validates file and report bounds before network dispatch', async () => {
  let calls = 0; const f = fixture(async () => {calls++; return success();});
  await assert.rejects(f.api.sendFeedback(report, undefined, {...upload(), file: new Blob([new Uint8Array(FEEDBACK_DIAGNOSTIC_MAX_BYTES + 1)])}), /size/);
  await assert.rejects(f.api.sendFeedback(report, undefined, {...upload(), filename: '../../secret.ndjson'}), /filename/);
  await assert.rejects(f.api.sendFeedback({...report, content: 'x'.repeat(FEEDBACK_MULTIPART_OVERHEAD_BYTES)}, undefined, upload()), /framing/);
  assert.equal(calls, 0);
  await f.api.sendFeedback(report, undefined, {...upload(), file: new Blob([new Uint8Array(FEEDBACK_DIAGNOSTIC_MAX_BYTES)])}); assert.equal(calls, 1);
});
test('failed attachments are not replayed automatically or downgraded to JSON', async () => {
  for (const response of [() => new Response('{}', {status: 500}), () => {throw new TypeError('offline');}]) {
    let calls = 0; const f = fixture(async (_url, request) => {calls++; assert.ok(request?.body instanceof FormData); return response();});
    await assert.rejects(f.api.sendFeedback(report, undefined, upload())); assert.equal(calls, 1);
  }
});
test('credential readiness rejects account and origin changes before upload starts', async () => {
  for (const kind of ['account', 'origin']) {
    let release!: () => void, calls = 0; const gate = new Promise<void>(resolve => {release = resolve;});
    const f = fixture(async () => {calls++; return success();}, () => gate);
    const pending = f.api.sendFeedback(report, undefined, upload());
    if (kind === 'account') f.change(); else f.api.setBaseUrl('https://other.example.org'); release();
    await assert.rejects(pending, /changed/); assert.equal(calls, 0);
  }
});
test('in-flight account replacement and caller abort suppress late success', async () => {
  for (const kind of ['account', 'abort']) {
    let finish!: (response: Response) => void, started!: () => void;
    const entered = new Promise<void>(resolve => {started = resolve;}); let requestSignal: AbortSignal | null | undefined;
    const f = fixture(async (_url, request) => {requestSignal = request?.signal; started(); return new Promise(resolve => {finish = resolve;});});
    const controller = new AbortController(), pending = f.api.sendFeedback(report, controller.signal, upload()); await entered;
    if (kind === 'account') f.change(); else controller.abort(); finish(success());
    await assert.rejects(pending); if (kind === 'abort') assert.equal(requestSignal?.aborted, true);
  }
});
test('signed-out uploads never dispatch and 401 preserves existing session rejection', async () => {
  let calls = 0; const f = fixture(async () => {calls++; return new Response('{}', {status: 401});}); f.signOut();
  await assert.rejects(f.api.sendFeedback(report, undefined, upload()), /Authentication required/); assert.equal(calls, 0);
  const g = fixture(async () => new Response('{}', {status: 401})); await assert.rejects(g.api.sendFeedback(report, undefined, upload())); assert.equal(g.rejections(), 1);
});
test('multipart uses the existing 120-second upload timeout without replay; JSON keeps 30 seconds', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  for (const attached of [true, false]) {
    let started!: () => void, signal: AbortSignal | null | undefined, calls = 0;
    const entered = new Promise<void>(resolve => {started = resolve;});
    const f = fixture(async (_url, request) => {calls++; signal = request?.signal; started(); return new Promise<Response>(() => {});});
    const result = f.api.sendFeedback(report, undefined, attached ? upload() : undefined);
    const rejected = assert.rejects(result, /timed out/);
    await entered; context.mock.timers.tick(29999); assert.equal(signal?.aborted, false);
    context.mock.timers.tick(1); assert.equal(signal?.aborted, !attached);
    if (attached) {context.mock.timers.tick(89999); assert.equal(signal?.aborted, false); context.mock.timers.tick(1);}
    await rejected; assert.equal(signal?.aborted, true); assert.equal(calls, 1);
  }
});
