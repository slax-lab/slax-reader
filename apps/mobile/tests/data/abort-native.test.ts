import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath, URL} from 'node:url';
import {throwIfAborted, linkedAbortTimeout} from '../../src/utils/abort.ts';
import {createMobileApi} from '../../src/data/api.ts';
import {deleteCurrentAccount} from '../../src/domain/delete-account.ts';
import {SessionController} from '../../src/domain/session.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {MemoryPreferences} from './helpers.ts';

const rnRequire = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/react-native/package.json', import.meta.url))));
const native = rnRequire('abort-controller/dist/abort-controller');
const sessions = {getSession: async () => null, clearIfMatches: async () => false};
async function withNativeAbort(work: () => Promise<void>) {
  const original = globalThis.AbortController;
  globalThis.AbortController = native.AbortController;
  try {await work();} finally {globalThis.AbortController = original;}
}
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

test('the actual installed RN AbortSignal needs the own guard and preserves supported reasons', () => {
  assert.equal(rnRequire('abort-controller/package.json').version, '3.0.0');
  const controller = new native.AbortController();
  assert.equal(controller.signal.throwIfAborted, undefined);
  assert.equal(native.AbortSignal.any, undefined); assert.equal(native.AbortSignal.timeout, undefined);
  throwIfAborted(controller.signal); controller.abort();
  assert.throws(() => throwIfAborted(controller.signal), isAbort);
  const reason = new Error('Synthetic custom cancellation');
  assert.throws(() => throwIfAborted({aborted: true, reason}), error => error === reason);
  assert.throws(() => throwIfAborted({aborted: true, reason: null}), error => error === null);
});

test('native API retry reaches success without newer AbortSignal methods', async () => withNativeAbort(async () => {
  const controller = new native.AbortController(), waits: number[] = []; let calls = 0;
  const api = createMobileApi({baseUrl: 'https://fixture.invalid', platform: 'android', version: 'test', sessions,
    sleep: async ms => {waits.push(ms);}, fetch: async () => ++calls === 1 ? Response.json({}, {status: 503}) : Response.json({code: 200, data: {features: [{key: 'rss', enabled: true}]}}),
  });
  assert.deepEqual(await api.rssLabs(controller.signal), {features: [{key: 'rss', enabled: true}]});
  assert.equal(calls, 2); assert.deepEqual(waits, [1000]);
}));

test('native cancellation during retry or before request never sends another request', async () => withNativeAbort(async () => {
  const controller = new native.AbortController(); let calls = 0;
  const api = createMobileApi({baseUrl: 'https://fixture.invalid', platform: 'android', version: 'test', sessions,
    sleep: async () => {controller.abort();}, fetch: async () => {calls++; return Response.json({}, {status: 503});},
  });
  await assert.rejects(api.rssLabs(controller.signal), isAbort); assert.equal(calls, 1);
  await assert.rejects(api.rssLabs(controller.signal), isAbort); assert.equal(calls, 1);
  const inFlight = new native.AbortController();
  const duringFetch = createMobileApi({baseUrl: 'https://fixture.invalid', platform: 'android', version: 'test', sessions,
    fetch: async () => {inFlight.abort(); throw new Error('Synthetic transport abort without a modern reason');},
  });
  await assert.rejects(duringFetch.rssLabs(inFlight.signal), isAbort);
}));

test('native AI streaming yields complete events and cancels the actual reader', async () => withNativeAbort(async () => {
  const controller = new native.AbortController(); let cancelled = false;
  const api = createMobileApi({baseUrl: 'https://fixture.invalid', platform: 'ios', version: 'test', sessions, fetch: async () => new Response(new ReadableStream({
    start(stream) {stream.enqueue(new TextEncoder().encode('{"type":"overview","data":{"overview":"Native fixture"}}\n'));},
    cancel() {cancelled = true;},
  }))});
  const stream = api.streamAi('overview', 'fixture-bookmark', controller.signal);
  assert.deepEqual((await stream.next()).value, {type: 'overview', data: {overview: 'Native fixture'}});
  controller.abort(); await assert.rejects(stream.next(), isAbort); assert.equal(cancelled, true);
}));

test('owned native timeout links cancellation and disposes its timer without static signal helpers', async () => withNativeAbort(async () => {
  const parent = new native.AbortController(), linked = linkedAbortTimeout(1000, parent.signal);
  parent.abort(); assert.throws(() => throwIfAborted(linked.signal), isAbort); linked.cleanup();
  const timed = linkedAbortTimeout(5); await new Promise(resolve => setTimeout(resolve, 10));
  assert.throws(() => throwIfAborted(timed.signal), isAbort); timed.cleanup();
  const disposed = linkedAbortTimeout(5); disposed.cleanup(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(disposed.signal.aborted, false);
}));

test('native account deletion stops before backend and leaves authentication intact after cancellation', async () => withNativeAbort(async () => {
  const preferences = new PreferenceStore(new MemoryPreferences({auth_token: 'synthetic-native-token', user_id: 'synthetic-user'}));
  const authority = new SessionController(preferences, {leave: async () => {}, enter: async () => {}}); await authority.restore();
  const controller = new native.AbortController(); controller.abort(); let requests = 0;
  await assert.rejects(deleteCurrentAccount({sessions: authority, signal: controller.signal, isActive: () => true, api: {deleteAccount: async () => {requests++; return {canDelete: true};}}}), isAbort);
  assert.equal(requests, 0); assert.equal((await authority.getSession())?.token, 'synthetic-native-token');
}));
