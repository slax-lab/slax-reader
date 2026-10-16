import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionController, SessionChangedError} from '../../src/domain/session.ts';
import {CredentialReadiness} from '../../src/domain/credential-readiness.ts';
import {mainRefreshAt, syncTokenExpiresAt} from '../../src/domain/token-policy.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {createSyncConnector} from '../../src/data/connector.ts';
import type {SlaxApi} from '../../src/data/api.ts';
import {MemoryPreferences, testJwt} from './helpers.ts';

const deferred = () => {let resolve!: () => void; const promise = new Promise<void>(yes => {resolve = yes;}); return {promise, resolve};};
function clock(initial: number) {
  let now = initial, id = 0;
  const timers = new Map<number, {at: number; run: () => void}>();
  return {now: () => now, timers, advance(ms: number) {now += ms; for (const [key, timer] of timers) if (timer.at <= now) {timers.delete(key); timer.run();}},
    setTimer(run: () => void, delay: number) {timers.set(++id, {at: now + delay, run}); return id as unknown as ReturnType<typeof setTimeout>;},
    clearTimer(key: ReturnType<typeof setTimeout>) {timers.delete(key as unknown as number);}};
}
async function fixture(refreshedAt = 1000) {
  const time = clock(1000000), storage = new MemoryPreferences({auth_token: 'main', user_id: 'user', last_refresh_time: String(refreshedAt)}), preferences = new PreferenceStore(storage);
  let entered = 0, left = 0;
  const sessions = new SessionController(preferences, {enter: async () => {entered++;}, leave: async () => {left++;}}, () => time.now() / 1000);
  await sessions.restore();
  return {time, storage, preferences, sessions, get entered() {return entered;}, get left() {return left;}};
}

test('main refresh is single-flight at exactly 24 hours and advances only successful refreshes', async () => {
  const f = await fixture(), gate = deferred(); let calls = 0;
  f.time.advance(86400000 - 1); await f.sessions.refreshIfNeeded(async () => {calls++; return 'too-early';}); assert.equal(calls, 0);
  f.time.advance(1);
  const refresh = async () => {calls++; await gate.promise; return 'fresh';};
  const work = f.sessions.refreshIfNeeded(refresh), other = f.sessions.refreshIfNeeded(refresh); assert.equal(work, other);
  gate.resolve(); await work;
  assert.equal(calls, 1); assert.equal(f.storage.values.last_refresh_time, '87400'); assert.equal(f.entered, 1); assert.equal(f.left, 0);
  f.time.advance(86400000); await assert.rejects(f.sessions.refreshIfNeeded(async () => {throw new Error('offline');}));
  assert.equal(f.storage.values.last_refresh_time, '87400'); assert.equal(f.storage.values.auth_token, 'fresh');
});

test('same-JWT refresh still fences stale 401 responses without replacing the account owner', async () => {
  const f = await fixture(); const scope = f.sessions.captureRequestScope(); f.time.advance(86400000);
  await f.sessions.refreshIfNeeded(async () => 'main');
  assert.equal(await f.sessions.clearIfMatches('main', scope), false); assert.equal(f.sessions.getSnapshot().status, 'authenticated'); assert.equal(f.entered, 1);
});

test('daily policy handles missing/future timestamps and actual main JWT expiry without calendar midnight', () => {
  assert.equal(mainRefreshAt({token: 'legacy', refreshedAt: NaN}, 1000), 1000);
  assert.equal(mainRefreshAt({token: 'legacy', refreshedAt: 1001}, 1000), 1000);
  assert.equal(mainRefreshAt({token: 'legacy', refreshedAt: 86399}, 86400), 172799);
  assert.equal(mainRefreshAt({token: testJwt('user', 2000, 1000), refreshedAt: 1000}, 1000), 1940);
});

test('foreground deadline refreshes once, pauses timers, rechecks long suspension and backs off offline failures', async () => {
  const f = await fixture(); let calls = 0, offline = false, changed = 0;
  const readiness = new CredentialReadiness({read: () => f.sessions.getSession(), refresh: signal => f.sessions.refreshIfNeeded(async () => {calls++; if (offline) throw new Error('offline'); return `token-${calls}`;}, signal), changed() {changed++;}, ...f.time});
  await readiness.ensure(); assert.equal(f.time.timers.size, 1);
  f.time.advance(86400000); await readiness.ensure(); assert.equal(calls, 1); assert.equal(changed, 1);
  readiness.pause(); assert.equal(f.time.timers.size, 0); f.time.advance(172800000); assert.equal(calls, 1);
  offline = true; await assert.rejects(readiness.resume()); assert.equal(readiness.getSnapshot().status, 'retry');
  await assert.rejects(readiness.ensure()); assert.equal(calls, 2);
  offline = false; f.time.advance(5000); await readiness.ensure(); assert.equal(calls, 3); assert.equal(changed, 2); readiness.pause();
});

test('pause aborts an in-flight refresh and late responses cannot persist', async () => {
  const f = await fixture(); f.time.advance(86400000); const gate = deferred(), started = deferred();
  const readiness = new CredentialReadiness({read: () => f.sessions.getSession(), refresh: signal => f.sessions.refreshIfNeeded(async () => {started.resolve(); await gate.promise; return 'late';}, signal), changed() {}, ...f.time});
  const work = readiness.ensure(), rejected = assert.rejects(work); await started.promise; readiness.pause(); gate.resolve(); await rejected;
  assert.equal(f.storage.values.auth_token, 'main'); assert.equal(f.storage.values.last_refresh_time, '1000'); assert.equal(f.time.timers.size, 0);
});

test('actual signed sync expiry and one-minute safety window bound the 24-hour cache', () => {
  const now = 1000000;
  assert.equal(syncTokenExpiresAt(testJwt('user', 87400, 1000), 'user', now, now)?.getTime(), 87400000);
  assert.equal(syncTokenExpiresAt(testJwt('user', 1300, 1000), 'user', now, now)?.getTime(), 1300000);
  assert.equal(syncTokenExpiresAt(testJwt('user', 1300, 1000), 'user', now, 1240000), null);
  assert.equal(syncTokenExpiresAt(testJwt('account-uuid', 1300, 1000), '123456', now, now)?.getTime(), 1300000);
  for (const token of ['legacy', 'a.e30.b', testJwt('user', 900, 800), testJwt('user', 999999, 2000)]) assert.equal(syncTokenExpiresAt(token, 'user', now, now), null);
  assert.equal(syncTokenExpiresAt(testJwt('user', 87400, 1000), 'user', now + 1, now), null);
});

async function syncFixture() {
  const f = await fixture(); let calls = 0, wait: Promise<void> | undefined;
  const api = {options: {baseUrl: 'https://api.example'}, getSyncToken: async () => {calls++; await wait; return {endpoint: 'https://sync.example', token: testJwt('user', Math.floor(f.time.now() / 1000) + 86400, Math.floor(f.time.now() / 1000))};}, uploadChanges: async () => ({status: true})} as unknown as SlaxApi;
  const connector = createSyncConnector(api, f.preferences, f.sessions, undefined, f.time.now);
  return {...f, api, connector, get calls() {return calls;}, hold(value: Promise<void>) {wait = value;}};
}

test('PowerSync reuses scoped valid credentials on reconnect but SDK renewal always obtains a fresh lease', async () => {
  const f = await syncFixture(), gate = deferred(); f.hold(gate.promise);
  const first = f.connector.fetchCredentials(), joined = f.connector.fetchCredentials(); assert.equal(first, joined); gate.resolve();
  const credentials = await first; assert(credentials?.expiresAt instanceof Date); assert.equal(credentials.expiresAt.getTime(), 87400000); assert.equal(f.calls, 1);
  f.time.advance(7200000); f.connector.resume(); assert.deepEqual(await f.connector.fetchCredentials(), credentials); assert.equal(f.calls, 1);
  await f.connector.fetchCredentials(); assert.equal(f.calls, 2, 'SDK renewal callback must not return the just-rejected cached lease');
  f.connector.pause(); f.time.advance(86400000); f.connector.resume(); await f.connector.fetchCredentials(); assert.equal(f.calls, 3);
});

test('PowerSync refuses legacy/malformed and wrong-origin cached credentials and handles account replacement', async () => {
  const f = await syncFixture();
  await f.preferences.update(values => {values.powersync_token = 'legacy'; values.powersync_connect_url = 'https://sync.example'; values.powersync_refresh_time = f.time.now(); values.powersync_api_origin = 'https://api.example'; values.powersync_user_id = 'user';});
  await f.connector.fetchCredentials(); assert.equal(f.calls, 1);
  f.connector.resume(); f.api.options.baseUrl = 'https://beta.example'; await f.connector.fetchCredentials(); assert.equal(f.calls, 2);
  const gate = deferred(); f.hold(gate.promise); const old = f.connector.fetchCredentials();
  await new Promise(resolve => setTimeout(resolve, 0)); await f.sessions.accept('other-main', 'other'); gate.resolve();
  assert.equal(await old, null); assert.equal(f.storage.values.powersync_token, undefined);
});

test('due main refresh precedes sync credential acquisition and coalesces concurrent callers', async () => {
  const f = await syncFixture(); f.time.advance(86400000); const gate = deferred(); let refreshes = 0;
  const readiness = new CredentialReadiness({read: () => f.sessions.getSession(), refresh: signal => f.sessions.refreshIfNeeded(async () => {refreshes++; await gate.promise; return 'refreshed';}, signal), changed() {}, ...f.time});
  f.sessions.setRequestPreparation(readiness.ensure);
  const first = f.connector.fetchCredentials(), second = f.connector.fetchCredentials();
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(f.calls, 0); assert.equal(refreshes, 1);
  gate.resolve(); await Promise.all([first, second]); assert.equal(f.calls, 1); readiness.pause();
});
