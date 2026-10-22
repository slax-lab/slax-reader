import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {loadComponent} from '../reader/parity-host.mjs';
import {RuntimeActivity} from '../../src/data/runtime-activity.ts';
import {AccountDatabaseLease, AccountInactiveError} from '../../src/data/account-lease.ts';
import {PreferenceStore, PREFERENCE_KEYS} from '../../src/data/preferences.ts';
import {SessionController} from '../../src/domain/session.ts';
import {CredentialReadiness, ReauthenticationRequiredError, CredentialsUnavailableError} from '../../src/domain/credential-readiness.ts';
import {createMobileApi} from '../../src/data/api.ts';
import {createSyncConnector} from '../../src/data/connector.ts';
import {clearAccountData} from '../../src/data/account-cleanup.ts';
import {MemoryPreferences, testJwt} from './helpers.ts';
import {openVerifiedDatabase} from '../../src/data/adoption.ts';
import {UpgradeVerificationRequired} from '../../src/data/upgrade.ts';
import {PdfBlockCache} from '../../src/data/pdf-cache.ts';

const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};};
async function until(check) {for (let i = 0; i < 100; i++) {if (check()) return; await setImmediate();} assert(check());}
async function fixture(refresh, storage = new MemoryPreferences({auth_token: 'old-token', user_id: 'account', last_refresh_time: String(Math.floor(Date.now() / 1000) - 172800), powersync_token: testJwt('account', 2, 1), powersync_refresh_time: 1000, powersync_connect_url: 'https://sync.example', powersync_api_origin: 'https://api.example', powersync_user_id: 'account'}), databaseGate = Promise.resolve()) {
  const events = [], sent = []; let pending = 3, owners = 0, clears = 0, activationFailure, migrationFailure, cleanupFailure;
  class Database {
    async init() {events.push('init'); await databaseGate;} async close() {events.push('close');}
    async connect(connector) {events.push('connect'); await connector.fetchCredentials();}
    async disconnect() {events.push('disconnect');}
    async disconnectAndClear() {if (cleanupFailure) throw cleanupFailure; clears++; pending = 0;}
    async execute() {pending++;} async writeTransaction(work) {return work(this);}
  }
  class Cache {constructor(directory) {this.dataDirectory = directory;} setAccessBarrier(barrier) {this.barrier = barrier;} setAvatarCache(avatars) {this.avatars = avatars;} clearArticles() {events.push('clear-files');}}
  class Worker {
    constructor(options) {this.options = options; this.request = new AbortController();}
    async setOnline() {}
    start() {this.pending = this.options.content('cached-bookmark', undefined, this.request.signal).catch(() => undefined);}
    async pause() {this.cancel(); await this.pending;} resume() {} cancel() {this.request.abort();}
    async stop() {this.cancel(); await this.pending;} beginForeground() {return () => {};}
  }
  class PdfStorage {clear() {} clearScope() {}}
  const bridge = {beginDataOwnership: async () => ({scanComplete: true, databaseCandidates: [], legacyDataDirectory: '/synthetic', newDatabaseDirectory: '/synthetic/new'}), endDataOwnership: async () => {}, newIdentifier: () => `owner-${++owners}`, md5String: value => value};
  const fetch = async (url, request) => {
    const path = new URL(url).pathname, bearer = new Headers(request.headers).get('Authorization'); sent.push({path, bearer});
    if (path === '/v1/user/refresh') {events.push('refresh'); return refresh(request);}
    if (path === '/v1/sync/token') {events.push('sync-credentials'); return Response.json({code: 200, data: {endpoint: 'https://sync.example', token: testJwt('account', Math.floor(Date.now() / 1000) + 86400, Math.floor(Date.now() / 1000))}});}
    return Response.json({code: 200, data: {ok: true}});
  };
  const {createMobileDataRuntime} = await loadComponent('../../src/data/runtime.ts', {
    'expo/fetch': {fetch}, '../domain/session.ts': {SessionController}, '../domain/credential-readiness.ts': {CredentialReadiness, ReauthenticationRequiredError, CredentialsUnavailableError}, './api.ts': {createMobileApi},
    './pdf-cache.ts': {PdfBlockCache}, './pdf-file-storage.ts': {PdfFileStorage: PdfStorage}, './cache.ts': {ArticleFileCache: Cache}, './account-cleanup.ts': {clearAccountData},
    './account-lease.ts': {AccountDatabaseLease, AccountInactiveError}, './background-cache.ts': {BackgroundArticleCache: Worker}, './runtime-activity.ts': {RuntimeActivity},
    './native-network.ts': {nativeNetwork: {read: async () => ({}), subscribe: () => () => {}}},
    './native-pdf-transfer.ts': {createNativePdfFetch: () => assert.fail('Explicit injected transport must remain authoritative')},
    '../native/reader-image': {loadReaderImage: async () => assert.fail('No image request expected in credential fixture')},
    './image-fetch.ts': {fetchCacheImage: async () => {}}, '../native/platform': {activateReaderResources: async () => {events.push('activate'); if (activationFailure) throw activationFailure;}, revokeReaderResources: async () => {events.push('revoke');}},
    './connector.ts': {createSyncConnector}, './adoption.ts': {openVerifiedDatabase}, './adoption-profile.ts': {deriveReviewedAdoptionEvidence: () => undefined},
    './legacy-preferences.ts': {migrateLegacyPreferences: async () => {if (migrationFailure) throw migrationFailure;}}, './native-storage.ts': {loadLegacyBridge: () => bridge, nativePreferenceStorage: () => storage},
    './preferences.ts': {PreferenceStore, PREFERENCE_KEYS}, './repositories.ts': {MobileRepositories: class {constructor(lease) {this.lease = lease;}}},
    './schema.ts': {createMobileSchema: async () => ({}), SYNC_PARAMETERS: {}}, './upgrade.ts': {UpgradeVerificationRequired}, '@powersync/react-native': {PowerSyncDatabase: Database},
  }, {Error});
  const runtime = createMobileDataRuntime({baseUrl: 'https://api.example', platform: 'ios', version: 'test', fetch});
  return {runtime, sent, events, storage, setActivationFailure: error => {activationFailure = error;}, setMigrationFailure: error => {migrationFailure = error;}, setCleanupFailure: error => {cleanupFailure = error;}, get pending() {return pending;}, get clears() {return clears;}};
}

test('cold startup publishes local account and verified data without awaiting protected network readiness', async context => {
  const gate = deferred(); const f = await fixture(async () => {await gate.promise; return Response.json({code: 200, data: {token: 'new-token'}});});
  context.after(() => f.runtime.stop());
  const starting = f.runtime.start(); await until(() => f.events.includes('refresh'));
  const ordinary = f.runtime.api.request('/v1/user/me').catch(error => error);
  await starting; assert.equal(f.runtime.sessions.getSnapshot().status, 'authenticated'); assert.equal(f.runtime.getUpgradeSnapshot().status, 'ready'); assert(f.runtime.getRepositories());
  assert.deepEqual(f.sent.map(item => item.path), ['/v1/user/refresh']); assert.equal(f.events.includes('connect'), false);
  gate.resolve(); await starting; f.runtime.markLibraryPresented(); await ordinary; await until(() => f.events.includes('connect'));
  assert(f.events.indexOf('sync-credentials') < f.events.indexOf('connect'));
  assert.equal(f.runtime.sessions.getSnapshot().status, 'authenticated');
  assert(f.events.indexOf('refresh') < f.events.indexOf('sync-credentials'));
  assert(f.sent.filter(item => item.path !== '/v1/user/refresh').every(item => item.bearer === 'Bearer new-token'));
  assert.equal(f.pending, 3); assert.equal(f.clears, 0);
  const owner = f.runtime.getNativeResourceOwner(), repositories = f.runtime.getRepositories();
  await f.runtime.preferences.update(values => {values.last_refresh_time = String(Math.floor(Date.now() / 1000) - 172800);});
  await f.runtime.credentials.retry(); await setImmediate();
  assert.equal(f.runtime.getNativeResourceOwner(), owner); assert.equal(f.runtime.getRepositories(), repositories); assert.equal(f.clears, 0);
  await f.runtime.stop();
  const next = await fixture(async () => assert.fail('Fresh cold restart must reuse successful main refresh'), f.storage);
  context.after(() => next.runtime.stop()); await next.runtime.start(); await setImmediate();
  assert.equal(next.events.includes('refresh'), false); assert.equal(next.runtime.sessions.getSnapshot().status, 'authenticated');
});

test('cold startup network failure retains local account, pending writes and retry state without sending expired credentials', async context => {
  let offline = true;
  const f = await fixture(async () => {if (offline) throw new Error('fetch failed: offline'); return Response.json({code: 200, data: {token: 'recovered'}});});
  context.after(() => f.runtime.stop()); const before = f.storage.values.last_refresh_time;
  await f.runtime.start(); await setImmediate();
  assert.equal(f.runtime.sessions.getSnapshot().status, 'authenticated'); assert(f.runtime.getCache());
  assert.equal(f.runtime.credentials.getSnapshot().status, 'retry'); assert.equal(f.storage.values.last_refresh_time, before);
  assert.deepEqual(f.sent.map(item => item.path), ['/v1/user/refresh']); assert.equal(f.events.includes('connect'), false);
  await assert.rejects(f.runtime.api.request('/v1/user/me'), /awaiting refresh/); assert.equal(f.pending, 3); assert.equal(f.clears, 0);
  const owner = f.runtime.getNativeResourceOwner(); offline = false;
  f.runtime.markLibraryPresented(); await f.runtime.credentials.retry(); await until(() => f.events.includes('connect'));
  assert.equal(f.runtime.getNativeResourceOwner(), owner); assert.equal(f.pending, 3); assert.equal(f.clears, 0);
  assert(f.sent.filter(item => item.path !== '/v1/user/refresh').every(item => item.bearer === 'Bearer recovered'));
});

test('refresh 401 with a waiting cache worker requires reauthentication without clearing or deadlocking', {timeout: 5000}, async context => {
  const f = await fixture(async () => new Response(null, {status: 401})); context.after(() => f.runtime.stop());
  await f.runtime.start(); await until(() => f.runtime.credentials.getSnapshot().status === 'reauthentication-required');
  assert.equal(f.runtime.sessions.getSnapshot().status, 'authenticated');
  assert.equal(f.storage.values.auth_token, 'old-token'); assert.equal(f.events.includes('connect'), false);
  assert.equal(f.pending, 3); assert.equal(f.clears, 0); assert(f.runtime.getRepositories());
  await assert.rejects(f.runtime.api.request('/v1/user/me'), /Sign in again/);
  await f.runtime.stop(); await f.runtime.start();
  await until(() => f.runtime.credentials.getSnapshot().status === 'reauthentication-required');
  assert.equal(f.sent.filter(value => value.path === '/v1/user/refresh').length, 1);
  assert.equal(f.pending, 3); assert.equal(f.clears, 0);
  const owner = f.runtime.getNativeResourceOwner();
  f.runtime.markLibraryPresented(); await f.runtime.sessions.reauthenticate('reauthenticated', 'account'); await until(() => f.events.includes('connect'));
  assert.equal(f.runtime.getNativeResourceOwner(), owner); assert.equal(f.pending, 3); assert.equal(f.clears, 0);
  await f.runtime.sessions.signOut(); assert.equal(f.clears, 1);
});

test('cold startup refresh timeout is bounded and leaves a retryable local account rather than sending old credentials', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const f = await fixture(async () => new Promise(() => {})); context.after(() => f.runtime.stop());
  const starting = f.runtime.start(); await until(() => f.events.includes('refresh'));
  await starting;
  assert.equal(f.runtime.sessions.getSnapshot().status, 'authenticated');
  assert.equal(f.runtime.credentials.getSnapshot().status, 'checking');
  context.mock.timers.tick(15000);
  await until(() => f.runtime.credentials.getSnapshot().status === 'retry');
  assert.equal(f.runtime.sessions.getSnapshot().status, 'authenticated'); assert.equal(f.runtime.credentials.getSnapshot().status, 'retry');
  assert.deepEqual(f.sent.map(item => item.path), ['/v1/user/refresh']); assert.equal(f.pending, 3); assert.equal(f.clears, 0);
});

test('an old environment refresh cannot replace persisted credentials', async context => {
  const gate = deferred(), f = await fixture(async () => {await gate.promise; return Response.json({code: 200, data: {token: 'wrong-origin'}});});
  context.after(() => f.runtime.stop());
  const starting = f.runtime.start(); await until(() => f.events.includes('refresh'));
  f.runtime.api.setBaseUrl('https://other.example'); gate.resolve(); await starting;
  assert.equal(f.storage.values.auth_token, 'old-token'); assert.equal(f.pending, 3); assert.equal(f.clears, 0); assert.equal(f.events.includes('connect'), false);
});

test('local login routing is published while database verification remains pending', async context => {
  for (const loggedIn of [false, true]) {
    const gate = deferred(), storage = new MemoryPreferences(loggedIn ? {auth_token: 'current', user_id: 'account', last_refresh_time: String(Date.now() / 1000)} : {});
    const f = await fixture(async () => assert.fail('No refresh required'), storage, gate.promise);
    context.after(() => f.runtime.stop());
    const starting = f.runtime.start(); await until(() => f.events.includes('init'));
    assert.equal(f.runtime.sessions.getSnapshot().status, loggedIn ? 'authenticated' : 'unauthenticated');
    assert.equal(f.runtime.getUpgradeSnapshot().status, 'checking'); assert.equal(f.runtime.getRepositories(), null); assert.equal(f.runtime.getCache(), null);
    assert.equal(f.events.includes('connect'), false);
    gate.resolve(); await starting;
    if (loggedIn) assert(f.runtime.getRepositories());
    await f.runtime.stop();
  }
});

test('same runtime stop and start reconnects with a fresh main token without foreground events', {timeout: 5000}, async context => {
  const storage = new MemoryPreferences({auth_token: 'current', user_id: 'account', last_refresh_time: String(Math.floor(Date.now() / 1000))});
  const f = await fixture(async () => assert.fail('Fresh token must not refresh'), storage);
  context.after(() => f.runtime.stop());
  await f.runtime.start(); f.runtime.markLibraryPresented(); await until(() => f.events.filter(value => value === 'connect').length === 1);
  await f.runtime.stop(); await f.runtime.start(); f.runtime.markLibraryPresented(); await until(() => f.events.filter(value => value === 'connect').length === 2);
  assert.equal(f.pending, 3); assert.equal(f.clears, 0);
});

test('login during deferred database admission publishes local account but exposes no unverified services', {timeout: 5000}, async context => {
  const gate = deferred(), f = await fixture(async () => assert.fail('Fresh login must not refresh'), new MemoryPreferences(), gate.promise);
  context.after(() => f.runtime.stop());
  const starting = f.runtime.start(); await until(() => f.events.includes('init'));
  const states = []; f.runtime.sessions.subscribe(state => states.push(state.status));
  const login = f.runtime.sessions.accept('fresh-login', 'account');
  await until(() => f.runtime.sessions.getSnapshot().status === 'authenticated');
  assert.deepEqual(states, ['authenticated']); assert.equal(f.runtime.getRepositories(), null); assert.equal(f.runtime.getNativeResourceOwner(), null);
  assert.equal(f.events.includes('connect'), false);
  gate.resolve(); await login; await starting; f.runtime.markLibraryPresented(); await until(() => f.events.includes('connect'));
  assert(f.runtime.getRepositories()); assert.equal(f.clears, 1);
});

test('refresh runs before deferred database admission and stop cancels both late publications', {timeout: 5000}, async context => {
  const database = deferred(), refresh = deferred();
  const f = await fixture(async () => {await refresh.promise; return Response.json({code: 200, data: {token: 'late'}});}, undefined, database.promise);
  context.after(() => f.runtime.stop());
  const starting = f.runtime.start(), rejected = assert.rejects(starting);
  await until(() => f.events.includes('refresh') && f.events.includes('init'));
  assert.equal(f.runtime.sessions.getSnapshot().status, 'authenticated'); assert.equal(f.runtime.getRepositories(), null);
  const stopping = f.runtime.stop(); database.resolve(); refresh.resolve(); await stopping; await rejected;
  assert.equal(f.storage.values.auth_token, 'old-token'); assert.equal(f.runtime.getUpgradeSnapshot().status, 'idle');
  assert.equal(f.runtime.getRepositories(), null); assert.equal(f.events.includes('activate'), false); assert.equal(f.events.includes('connect'), false);
});

test('failed native activation after fresh login exposes recovery and succeeds on restart', async context => {
  const f = await fixture(async () => assert.fail('Fresh login must not refresh'), new MemoryPreferences());
  context.after(() => f.runtime.stop());
  await f.runtime.start();
  f.setActivationFailure(new Error('Native activation unavailable'));
  await assert.rejects(f.runtime.sessions.accept('fresh-login', 'account'), /Native activation unavailable/);
  assert.equal(f.runtime.sessions.getSnapshot().status, 'authenticated');
  assert.equal(f.runtime.getUpgradeSnapshot().status, 'error');
  assert.match(f.runtime.getUpgradeSnapshot().error.message, /Native activation unavailable/);
  assert.equal(f.runtime.getRepositories(), null); assert.equal(f.runtime.getNativeResourceOwner(), null);
  f.setActivationFailure(undefined);
  await f.runtime.stop(); await f.runtime.start();
  assert.equal(f.runtime.getUpgradeSnapshot().status, 'ready'); assert(f.runtime.getRepositories());
  assert.equal(f.storage.values.auth_token, 'fresh-login');
});

test('preference migration failure retains startup recovery and retries without clearing account data', async context => {
  const f = await fixture(async () => assert.fail('Fresh session must not refresh'), new MemoryPreferences({auth_token: 'fresh', user_id: 'account', last_refresh_time: String(Math.floor(Date.now() / 1000))}));
  context.after(() => f.runtime.stop());
  f.setMigrationFailure(new Error('Synthetic preference migration failure'));
  await assert.rejects(f.runtime.start(), /migration failure/);
  assert.equal(f.runtime.sessions.getSnapshot().status, 'loading'); assert.equal(f.runtime.getUpgradeSnapshot().status, 'error');
  assert.equal(f.runtime.getRepositories(), null); assert.equal(f.pending, 3); assert.equal(f.clears, 0);
  f.setMigrationFailure(undefined);
  await f.runtime.stop(); await f.runtime.start();
  assert.equal(f.runtime.getUpgradeSnapshot().status, 'ready'); assert(f.runtime.getRepositories());
  assert.equal(f.storage.values.auth_token, 'fresh'); assert.equal(f.pending, 3); assert.equal(f.clears, 0);
});

test('failed sign-out cleanup publishes recovery and restart completes sign-out before exposing services', async context => {
  const f = await fixture(async () => assert.fail('Fresh session must not refresh'), new MemoryPreferences({auth_token: 'fresh', user_id: 'account', last_refresh_time: String(Math.floor(Date.now() / 1000))}));
  context.after(() => f.runtime.stop()); await f.runtime.start();
  f.setCleanupFailure(new Error('Synthetic database cleanup failure'));
  await assert.rejects(f.runtime.sessions.signOut(), /cleanup failure/);
  assert.equal(f.runtime.getUpgradeSnapshot().status, 'error'); assert.equal(f.runtime.getRepositories(), null);
  assert.equal(f.runtime.getNativeResourceOwner(), null); assert.equal(f.storage.values._slax_sign_out_pending_v1, true);
  assert.equal(f.pending, 3);
  f.setCleanupFailure(undefined); await f.runtime.stop(); await f.runtime.start();
  assert.equal(f.runtime.sessions.getSnapshot().status, 'unauthenticated'); assert.equal(f.runtime.getUpgradeSnapshot().status, 'ready');
  assert.equal(f.runtime.getRepositories(), null); assert.equal(f.storage.values.auth_token, undefined);
  assert.equal(f.storage.values._slax_sign_out_pending_v1, undefined); assert.equal(f.clears, 1);
});
