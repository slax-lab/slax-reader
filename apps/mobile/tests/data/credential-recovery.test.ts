import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionController, SessionAccountMismatchError, SessionChangedError} from '../../src/domain/session.ts';
import {CredentialReadiness, CredentialsUnavailableError, OfflineCredentialError, ReauthenticationRequiredError, isOfflineCredentialError} from '../../src/domain/credential-readiness.ts';
import {DataTransportError, createMobileApi} from '../../src/data/api.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {createSyncConnector} from '../../src/data/connector.ts';
import {MemoryPreferences, testJwt} from './helpers.ts';
import type {SlaxApi} from '../../src/data/api.ts';

const sessionValues = () => ({auth_token: 'main', user_id: '123456', last_refresh_time: '1000'});

test('same-account reauthentication preserves its admitted owner and offline preferences', async () => {
  const storage = new MemoryPreferences({...sessionValues(), continue_reading_bookmark: 'offline-position', pending_fixture: 'unsent'});
  let entered = 0, cleared = 0, accepted = 0;
  const sessions = new SessionController(new PreferenceStore(storage), {enter: async () => {entered++;}, leave: async () => {cleared++;}, accepted: () => {accepted++;}}, () => 1000);
  await sessions.restore();
  await sessions.rejectIfMatches('main');
  const obsolete = sessions.captureIdentity();
  await sessions.reauthenticate('renewed', '123456');
  assert.equal(entered, 1); assert.equal(cleared, 0); assert.equal(accepted, 1);
  assert.equal(storage.values.pending_fixture, 'unsent'); assert.equal(storage.values.continue_reading_bookmark, 'offline-position');
  assert.equal((await sessions.getSession())?.token, 'renewed');
  assert.equal(storage.values._slax_reauthentication_required_v1, undefined);
  assert.throws(obsolete, SessionChangedError);
});

test('a different provider account cannot replace rejected credentials or offline state', async () => {
  const storage = new MemoryPreferences(sessionValues());
  const sessions = new SessionController(new PreferenceStore(storage), {enter: async () => {}, leave: async () => assert.fail('Reauthentication must not clear data')});
  await sessions.restore(); await sessions.rejectIfMatches('main');
  const revision = storage.revision, snapshot = sessions.getSnapshot();
  await assert.rejects(sessions.reauthenticate('other-token', 'other'), SessionAccountMismatchError);
  assert.equal(storage.revision, revision); assert.equal(sessions.getSnapshot(), snapshot);
  assert.equal(storage.values.auth_token, 'main');
  await assert.rejects(sessions.getSession(), ReauthenticationRequiredError);
});

test('reauthentication rechecks stored account on every preference CAS retry', async () => {
  const storage = new MemoryPreferences(sessionValues());
  const sessions = new SessionController(new PreferenceStore(storage), {enter: async () => {}, leave: async () => {}});
  await sessions.restore(); await sessions.rejectIfMatches('main');
  storage.beforeSwap = () => {storage.beforeSwap = undefined; storage.values = {auth_token: 'replacement', user_id: 'other'}; storage.revision++;};
  await assert.rejects(sessions.reauthenticate('renewed', '123456'), SessionAccountMismatchError);
  assert.equal(storage.values.auth_token, 'replacement'); assert.equal(storage.values.user_id, 'other');
});

test('failed sign-out exposes recovery and restart completes its journal before another login', async () => {
  const storage = new MemoryPreferences(sessionValues()), preferences = new PreferenceStore(storage);
  let fail = true, clears = 0, recoveries = 0;
  const lifecycle = {enter: async () => {}, leave: async () => {clears++; if (fail) throw new Error('Synthetic cleanup failure');}, failed() {recoveries++;}};
  const sessions = new SessionController(preferences, lifecycle);
  await sessions.restore();
  await assert.rejects(sessions.signOut(), /cleanup failure/);
  assert.equal(recoveries, 1); assert.equal(sessions.getSnapshot().status, 'loading');
  assert.equal(storage.values._slax_sign_out_pending_v1, true);
  await assert.rejects(sessions.getSession(), SessionChangedError);
  const restarted = new SessionController(preferences, lifecycle);
  assert.equal(await restarted.restoreLocal(), null);
  await assert.rejects(restarted.getSession(), SessionChangedError);
  await assert.rejects(restarted.accept('premature', 'next'), SessionChangedError);
  fail = false;
  await restarted.restore();
  assert.equal(clears, 2); assert.equal(storage.values.auth_token, undefined); assert.equal(storage.values._slax_sign_out_pending_v1, undefined);
  assert.equal(restarted.getSnapshot().status, 'unauthenticated');
  await restarted.accept('next-token', 'next');
  assert.equal((await restarted.getSession())?.userId, 'next');
});

test('a failed sign-out journal write leaves the existing local session usable', async () => {
  const storage = new MemoryPreferences(sessionValues());
  let cleared = false;
  const sessions = new SessionController(new PreferenceStore(storage), {enter: async () => {}, leave: async () => {cleared = true;}});
  await sessions.restore(); const snapshot = sessions.getSnapshot();
  storage.compareAndSwap = async () => {throw new Error('Synthetic storage failure');};
  await assert.rejects(sessions.signOut(), /storage failure/);
  assert.equal(sessions.getSnapshot(), snapshot); assert.equal(cleared, false);
  assert.equal((await sessions.getSession())?.userId, '123456');
});

test('a current API 401 preserves local identity and data; rejection survives restart and permits public reauthentication', async () => {
  const storage = new MemoryPreferences(sessionValues()), preferences = new PreferenceStore(storage);
  let clears = 0, rejected = 0;
  const sessions = new SessionController(preferences, {enter: async () => {}, leave: async () => {clears++;}, rejected: () => {rejected++;}}, () => 1000);
  await sessions.restore(); const local = sessions.getSnapshot();
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async (url, request) => {
    if (String(url).endsWith('/login')) {assert.equal(new Headers(request?.headers).get('Authorization'), null); return Response.json({code: 200, data: {token: 'new-main', user_id: '123456'}});}
    return new Response(null, {status: 401});
  }});
  await assert.rejects(api.request('/v1/user/me'), /401/);
  assert.equal(sessions.getSnapshot(), local); assert.equal(clears, 0); assert.equal(rejected, 1);
  await assert.rejects(sessions.getSession(), ReauthenticationRequiredError);
  const restored = new SessionController(preferences, {enter: async () => {}, leave: async () => {clears++;}});
  await restored.restoreLocal(); assert.equal(restored.getSnapshot().status, 'authenticated');
  await assert.rejects(restored.getSession(), ReauthenticationRequiredError);
  const result = await api.login({code: 'synthetic', type: 'apple', platform: 'ios', redirect_uri: 'app://login'});
  await sessions.accept(result.token, result.user_id); assert.equal(clears, 0);
  assert.equal((await sessions.getSession())?.token, 'new-main');
  await sessions.signOut(); assert.equal(clears, 1);
});

test('stale rejection cannot mark a newer same-token session as denied', async () => {
  const sessions = new SessionController(new PreferenceStore(new MemoryPreferences(sessionValues())), {enter: async () => {}, leave: async () => {}}, () => 1000);
  await sessions.restore(); const old = sessions.captureRequestScope();
  await sessions.accept('main', '123456');
  assert.equal(await sessions.rejectIfMatches('main', old), false);
  assert.equal((await sessions.getSession())?.token, 'main');
});

test('offline and timeout refresh failures retain typed fallback during backoff; denied and paused states never do', async () => {
  for (const kind of ['network', 'timeout'] as const) {
    let refreshes = 0;
    const readiness = new CredentialReadiness({read: async () => ({token: 'old', userId: 'user', refreshedAt: 1}), refresh: async () => {refreshes++; throw new DataTransportError(kind, 'api');}, changed() {}, now: () => 200000000});
    await assert.rejects(readiness.ensure(), OfflineCredentialError);
    await assert.rejects(readiness.ensure(), isOfflineCredentialError); assert.equal(refreshes, 1);
    readiness.reject(); await assert.rejects(readiness.ensure(), error => error instanceof ReauthenticationRequiredError && !isOfflineCredentialError(error));
    readiness.reset(); readiness.pause(); await assert.rejects(readiness.ensure(), error => error instanceof CredentialsUnavailableError && !isOfflineCredentialError(error));
  }
});

for (const lifetime of [86399, 86400, 300]) {
test(`scoped PowerSync preserves ownership and diagnoses the ${lifetime}-second signed lifetime`, async context => {
  const storage = new MemoryPreferences(sessionValues()), preferences = new PreferenceStore(storage);
  const sessions = new SessionController(preferences, {enter: async () => {}, leave: async () => {}}, () => 1000);
  await sessions.restore(); let calls = 0;
  const warning = context.mock.method(console, 'warn', () => {});
  const token = testJwt('00000000-0000-4000-8000-000000000001', 1000 + lifetime, 1000);
  const api = {options: {baseUrl: 'https://api.example'}, getSyncToken: async () => {calls++; return {endpoint: 'https://sync.example', token};}} as unknown as SlaxApi;
  const connector = createSyncConnector(api, preferences, sessions, undefined, () => 1000000);
  assert.equal((await connector.fetchCredentials())?.expiresAt?.getTime(), (1000 + lifetime) * 1000);
  assert.deepEqual(warning.mock.calls.map(call => call.arguments), lifetime === 86399 ? [] : [['sync_credential_lifetime_contract_mismatch', {issuedLifetimeSeconds: lifetime}]]);
  connector.resume(); assert.equal((await connector.fetchCredentials())?.token, token); assert.equal(calls, 1);
  await preferences.update(values => {values.powersync_user_id = 'other';});
  connector.resume(); await connector.fetchCredentials(); assert.equal(calls, 2);
  api.options.baseUrl = 'https://other.example'; connector.resume(); await connector.fetchCredentials(); assert.equal(calls, 3);
});
}

test('restore after local unauthenticated publication preserves snapshot and identity guards', async () => {
  const sessions = new SessionController(new PreferenceStore(new MemoryPreferences()), {enter: async () => {}, leave: async () => {}});
  await sessions.restoreLocal(); const snapshot = sessions.getSnapshot(), assertIdentity = sessions.captureIdentity();
  await sessions.restore(); assert.equal(sessions.getSnapshot(), snapshot); assert.doesNotThrow(assertIdentity);
});

test('interrupted account cleanup is retried before same-user reauthentication admits stored rows', async () => {
  const storage = new MemoryPreferences(sessionValues()), preferences = new PreferenceStore(storage);
  let fail = true, clears = 0, entered = 0;
  const sessions = new SessionController(preferences, {revoke() {}, enter: async () => {entered++;}, leave: async () => {clears++; if (fail) throw new Error('cleanup unavailable');}}, () => 1000);
  await sessions.restore();
  await assert.rejects(sessions.accept('new-account', 'next'), /cleanup unavailable/);
  assert.equal(storage.values._slax_account_cleanup_required_v1, true); assert.equal(entered, 1);
  fail = false; await sessions.accept('new-account', 'next');
  assert.equal(clears, 2); assert.equal(entered, 2); assert.equal(storage.values._slax_account_cleanup_required_v1, undefined);
});

test('late rejected readiness work cannot poison a replacement identity', async () => {
  let rejectOld!: (reason: Error) => void;
  const blocked = new Promise<void>((_resolve, reject) => {rejectOld = reject;});
  let current = {token: 'old', userId: 'old', refreshedAt: 1};
  const readiness = new CredentialReadiness({read: async () => current, refresh: () => blocked, changed() {}, now: () => 200000000});
  const old = readiness.ensure(), rejected = assert.rejects(old);
  await Promise.resolve(); await Promise.resolve();
  readiness.reset(); current = {token: 'new', userId: 'new', refreshedAt: 200000};
  await readiness.ensure(); rejectOld(new ReauthenticationRequiredError()); await rejected;
  assert.equal(readiness.getSnapshot().status, 'ready'); readiness.pause();
});

test('a held rejection CAS cannot poison identical-token reauthentication in the same second', async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), waiting = new Promise<void>(resolve => {started = resolve;});
  let hold = true;
  class HeldStorage extends MemoryPreferences {
    override async compareAndSwap(revision: number, values: Parameters<MemoryPreferences['compareAndSwap']>[1]) {
      if (hold && values._slax_reauthentication_required_v1 === true) {hold = false; started(); await gate;}
      return super.compareAndSwap(revision, values);
    }
  }
  const storage = new HeldStorage(sessionValues()), sessions = new SessionController(new PreferenceStore(storage), {enter: async () => {}, leave: async () => {}}, () => 1000);
  await sessions.restore(); const scope = sessions.captureRequestScope();
  const rejection = sessions.rejectIfMatches('main', scope); await waiting;
  await sessions.accept('main', '123456'); release();
  assert.equal(await rejection, false); assert.equal((await sessions.getSession())?.token, 'main');
  assert.equal(storage.values._slax_reauthentication_required_v1, undefined);
});
