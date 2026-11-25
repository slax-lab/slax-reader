import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {LogLevels} from '@powersync/common';
import * as frontendErrorLog from '@commons/frontend-utils/errorLog';
import {loadComponent} from '../reader/parity-host.mjs';
import {RuntimeActivity} from '../../src/data/runtime-activity.ts';
import {AccountDatabaseLease, AccountInactiveError} from '../../src/data/account-lease.ts';
import {PreferenceStore, PREFERENCE_KEYS} from '../../src/data/preferences.ts';
import {SessionController} from '../../src/domain/session.ts';
import {CredentialReadiness, ReauthenticationRequiredError, CredentialsUnavailableError} from '../../src/domain/credential-readiness.ts';
import {createMobileApi} from '../../src/data/api.ts';
import {createSyncConnector} from '../../src/data/connector.ts';
import {clearAccountData} from '../../src/data/account-cleanup.ts';
import {migrateLegacyPreferences} from '../../src/data/legacy-preferences.ts';
import {MemoryPreferences, testJwt} from './helpers.ts';

async function until(check) {for (let i = 0; i < 200; i++) {if (check()) return; await setImmediate();} assert(check());}
const sdkError = Object.assign(new Error('HTTP Bad Gateway: upstream'), {status: 502});

async function fixture({status = 500} = {}) {
  const events = [], captured = [], sent = [], databases = [], flushed = [];
  let networkListener = () => {}, onSessionChange;
  class Database {
    constructor(options) {this.logger = options.logger; this.listeners = []; databases.push(this);}
    async init() {} async close() {}
    async connect(connector) {events.push('connect'); await connector.fetchCredentials();}
    async disconnect() {events.push('disconnect');}
    async disconnectAndClear() {} async execute() {} async writeTransaction(work) {return work(this);}
    registerListener(listener) {this.listeners.push(listener); return () => {};}
    status(value) {this.listeners.forEach(listener => listener.statusChanged?.(value));}
    streamFailure() {
      this.logger.log({level: LogLevels.error, message: 'Could not POST streaming to /sync/stream - 502 - Bad Gateway: upstream', error: sdkError});
      this.logger.log({level: LogLevels.error, message: 'Sync error', error: sdkError});
    }
  }
  class Cache {constructor(directory) {this.dataDirectory = directory;} setAvatarCache() {} clearArticles() {}}
  class Worker {constructor(options) {this.options = options;} async open() {} setOnline() {} start() {} async suspend() {} resume() {} setInteractionBusy() {} cancel() {} async close() {} beginForeground() {return () => {};}}
  const bridge = {beginDataOwnership: async () => ({legacyReset: false, legacyDataDirectory: '/synthetic', newDatabaseDirectory: '/synthetic/new'}), finishLegacyReset: async () => {}, readLegacyPreferences: async () => null, endDataOwnership: async () => {}, newIdentifier: () => 'device-1', md5String: value => value};
  const storage = new MemoryPreferences({auth_token: 'token', user_id: '42', last_refresh_time: String(Math.floor(Date.now() / 1000)), analytics_device_id: 'device-1'});
  const fetch = async (url, request) => {
    const path = new URL(url).pathname;
    if (path === '/v1/sync/token') return Response.json({code: 200, data: {endpoint: 'https://sync.example', token: testJwt('42', Math.floor(Date.now() / 1000) + 86400, Math.floor(Date.now() / 1000))}});
    if (path === '/events') {sent.push(JSON.parse(request.body).events); return new Response(null, {status: 204});}
    if (path === '/v1/broken') return new Response('bad gateway', {status, headers: {'cf-ray': 'ray-1-SIN'}});
    if (path === '/v1/offline') throw Object.assign(new Error('The Internet connection appears to be offline.'), {name: 'FetchError'});
    if (path === '/v1/session-changed') {onSessionChange?.(); return Response.json({code: 200, data: {}});}
    return Response.json({code: 200, data: {ok: true}});
  };
  const {createMobileDataRuntime} = await loadComponent('../../src/data/runtime.ts', {
    'expo/fetch': {fetch}, '../domain/session.ts': {SessionController}, '../domain/credential-readiness.ts': {CredentialReadiness, ReauthenticationRequiredError, CredentialsUnavailableError}, './api.ts': {createMobileApi},
    './cache.ts': {ArticleFileCache: Cache}, './account-cleanup.ts': {clearAccountData},
    './account-lease.ts': {AccountDatabaseLease, AccountInactiveError}, './offline-coordinator.ts': {OfflineCoordinator: Worker}, './native-offline-engine.ts': {loadOfflineEngine: () => ({})}, './runtime-activity.ts': {RuntimeActivity},
    './native-network.ts': {nativeNetwork: {read: async () => ({isConnected: true}), subscribe: listener => {networkListener = listener; return () => {};}}},
    '../native/reader-image': {loadReaderImage: async () => assert.fail('No image request expected')},
    '../native/platform': {activateReaderResources: async () => {}, revokeReaderResources: async () => {}},
    './connector.ts': {createSyncConnector},
    './legacy-preferences.ts': {migrateLegacyPreferences}, './native-storage.ts': {loadLegacyBridge: () => bridge, nativePreferenceStorage: () => storage},
    './preferences.ts': {PreferenceStore, PREFERENCE_KEYS}, './repositories.ts': {MobileRepositories: class {constructor(lease) {this.lease = lease;}}},
    './schema.ts': {createMobileSchema: async () => ({}), SYNC_PARAMETERS: {}}, '@powersync/react-native': {PowerSyncDatabase: Database},
    '@commons/frontend-utils/errorLog': frontendErrorLog,
  }, {Error});
  const runtime = createMobileDataRuntime({baseUrl: 'https://api.example', platform: 'ios', version: 'test', fetch, sleep: async () => {},
    errorLog: () => ({capture: (kind, error, properties) => {captured.push({kind, message: error?.message, properties}); return `fp-${captured.length}`;}, flush: async hiding => {flushed.push(hiding);}})});
  const phases = () => sent.flat().filter(event => event.event_name === 'powersync_phase').map(event => event.properties);
  return {runtime, events, captured, sent, phases, flushed: () => flushed, changeSessionOnNextRequest: change => {onSessionChange = () => {onSessionChange = undefined; change();};}, database: () => databases.at(-1), network: value => networkListener(value)};
}

async function connected(context, options) {
  if (!context.mockTimersEnabled) {context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: Date.now()}); context.mockTimersEnabled = true;}
  const f = await fixture(options); context.after(() => f.runtime.stop());
  await f.runtime.start(); f.network({isConnected: true}); f.runtime.markLibraryPresented();
  await until(() => f.events.includes('connect'));
  return f;
}
const connects = f => f.events.filter(event => event === 'connect').length;

test('one SDK stream failure is captured once, disconnects the SDK retry and backs off from 5 s to 120 s', async context => {
  const f = await connected(context);
  const delays = [5000, 10000, 20000, 40000, 80000, 120000, 120000];
  for (const [index, delay] of delays.entries()) {
    const before = connects(f);
    f.database().streamFailure();
    assert.equal(f.captured.filter(record => record.properties.source === 'sdk.logger').length, index + 1);
    assert.equal(f.events.at(-1), 'disconnect');
    context.mock.timers.tick(delay - 1); await setImmediate();
    assert.equal(connects(f), before, `no reconnect before ${delay} ms`);
    context.mock.timers.tick(1); await until(() => connects(f) === before + 1);
    context.mock.timers.tick(1000);
  }
  const record = f.captured.find(item => item.properties.source === 'sdk.logger');
  assert.equal(record.kind, 'powersync');
  // No connected status arrived in this test, so the failures are connection failures.
  assert.equal(record.properties.phase, 'connect');
  assert.equal(record.properties.online, true);
  assert.equal(record.properties.foreground, true);
  assert.equal(typeof record.properties.consecutive_failures, 'number');
});

test('a connected status resets the backoff and reports one connect success with a duration', async context => {
  const f = await connected(context);
  f.database().streamFailure(); context.mock.timers.tick(5000); await until(() => connects(f) === 2);
  context.mock.timers.tick(1000); f.database().streamFailure(); context.mock.timers.tick(10000); await until(() => connects(f) === 3);
  f.database().status({connected: true, connecting: false}); f.database().status({connected: true, connecting: false});
  await until(() => f.phases().some(item => item.phase === 'connect' && item.outcome === 'success'));
  const successes = f.phases().filter(item => item.phase === 'connect' && item.outcome === 'success');
  assert.equal(successes.length, 1); assert.equal(typeof successes[0].duration_ms, 'number');
  context.mock.timers.tick(1000); f.database().streamFailure(); context.mock.timers.tick(4999); await setImmediate();
  assert.equal(connects(f), 3); context.mock.timers.tick(1); await until(() => connects(f) === 4);
  const failure = f.phases().find(item => item.phase === 'stream' && item.outcome === 'failure');
  assert.match(failure.fingerprint, /^fp-/);
});

test('an SDK HTTP failure is recorded with its status but without the response body', async context => {
  const f = await connected(context);
  const body = 'upstream page for 203.0.113.7';
  f.database().logger.log({level: LogLevels.error, message: `Could not POST streaming to /sync/stream - 502 - Bad Gateway: ${body}`, error: Object.assign(new Error(`HTTP Bad Gateway: ${body}`), {status: 502})});
  const record = f.captured.find(item => item.properties.source === 'sdk.logger');
  assert.equal(record.message, 'Could not POST streaming to /sync/stream - 502 - Bad Gateway');
  assert.equal(JSON.stringify(f.captured).includes('203.0.113.7'), false);
});

test('a credential failure the SDK logs as a sync error is recorded as a token failure and still backs off', async context => {
  const f = await connected(context);
  f.database().logger.log({level: LogLevels.error, message: 'Sync error', error: Object.assign(new Error('HTTP Service Unavailable: token backend down'), {status: 503, phase: 'token', ray: 'tok-1-SIN'})});
  const record = f.captured.find(item => item.properties.source === 'sdk.logger');
  assert.equal(record.properties.phase, 'token'); assert.equal(record.properties.ray, 'tok-1-SIN');
  await until(() => f.phases().some(item => item.phase === 'token' && item.outcome === 'failure'));
  context.mock.timers.tick(5000); await until(() => connects(f) === 2);
});

test('a download that ends without advancing the sync time is not a stream success', async context => {
  const f = await connected(context);
  const at = Date.now();
  f.database().status({connected: true, connecting: false, downloading: false, lastSyncedAt: new Date(at)});
  f.database().status({connected: true, connecting: false, downloading: true, lastSyncedAt: new Date(at)});
  f.database().status({connected: true, connecting: false, downloading: false, lastSyncedAt: new Date(at)});
  await setImmediate(); await setImmediate();
  assert.equal(f.phases().some(item => item.phase === 'stream' && item.outcome === 'success'), false);
});

test('a stream failure before the first connection is a connect failure, and later ones are stream failures', async context => {
  const f = await connected(context);
  f.database().streamFailure();
  context.mock.timers.tick(5000); await until(() => connects(f) === 2);
  f.database().status({connected: true, connecting: false});
  context.mock.timers.tick(1000); f.database().streamFailure();
  assert.deepEqual(f.captured.filter(item => item.properties.source === 'sdk.logger').map(item => item.properties.phase), ['connect', 'stream']);
});

test('other SDK error logs are recorded without a phase and do not disconnect or back off', async context => {
  const f = await connected(context);
  const before = connects(f), disconnects = f.events.filter(event => event === 'disconnect').length;
  f.database().logger.log({level: LogLevels.error, message: 'Error in watch', error: new Error('query failed')});
  const record = f.captured.at(-1);
  assert.equal(record.properties.source, 'sdk.logger'); assert.equal(record.properties.phase, undefined);
  assert.equal(f.events.filter(event => event === 'disconnect').length, disconnects);
  context.mock.timers.tick(130000); await setImmediate();
  assert.equal(connects(f), before);
});

test('the first failure of a session reports one consecutive failure and waits 5 s', async context => {
  const f = await connected(context);
  f.database().streamFailure();
  const records = f.captured.filter(item => item.properties.source === 'sdk.logger');
  assert.equal(records.length, 1); assert.equal(records[0].properties.consecutive_failures, 1);
  context.mock.timers.tick(4999); await setImmediate(); assert.equal(connects(f), 1);
  context.mock.timers.tick(1); await until(() => connects(f) === 2);
  await assert.rejects(f.runtime.api.request('/v1/broken'));
  const api = f.captured.find(item => item.properties.source === 'api');
  assert.equal(api.properties.consecutive_failures, 1); assert.equal(api.properties.connection_ms, undefined);
});

test('offline schedules no reconnect and online reconnects immediately', async context => {
  const f = await connected(context);
  f.network({isConnected: false});
  f.database().streamFailure(); context.mock.timers.tick(200000); await setImmediate();
  assert.equal(connects(f), 1);
  assert.equal(f.captured.at(-1).properties.online, false);
  f.network({isConnected: true}); await until(() => connects(f) === 2);
});

test('sync observations stop once the account signs out', async context => {
  const f = await connected(context);
  f.database().status({connected: true, connecting: false}); await until(() => f.phases().some(item => item.phase === 'connect'));
  await setImmediate(); const before = f.phases().length;
  await f.runtime.sessions.signOut();
  f.database().streamFailure(); await setImmediate(); await setImmediate();
  assert.equal(f.phases().length, before);
});

test('failed API requests record 5xx and network failures with ray but not 4xx or sync requests', async context => {
  const f = await connected(context);
  await assert.rejects(f.runtime.api.request('/v1/broken?secret=1'));
  await assert.rejects(f.runtime.api.request('/v1/offline'));
  const api = f.captured.filter(record => record.properties.source === 'api');
  assert.deepEqual(api.map(record => [record.kind, record.properties.path, record.properties.status, record.properties.ray]), [['network', '/v1/broken', 500, 'ray-1-SIN'], ['network', '/v1/offline', undefined, undefined]]);
  assert.equal(api.every(record => !JSON.stringify(record).includes('secret')), true);
  f.changeSessionOnNextRequest(() => f.runtime.api.setBaseUrl('https://other.example'));
  await assert.rejects(f.runtime.api.request('/v1/session-changed', 'GET', undefined, undefined, undefined, {abortable: true, retryable: false}), /environment changed/);
  assert.equal(f.captured.filter(record => record.properties.source === 'api').length, 2);
  const g = await connected(context, {status: 404});
  await assert.rejects(g.runtime.api.request('/v1/broken'));
  assert.equal(g.captured.filter(record => record.properties.source === 'api').length, 0);
});

test('queued error records are flushed when the app moves to the background', async context => {
  context.mock.timers.enable({apis: ['setTimeout', 'Date'], now: Date.now()});
  const f = await fixture(); context.after(() => f.runtime.stop());
  await f.runtime.start();
  await f.runtime.setForeground(false);
  await f.runtime.setForeground(true);
  assert.deepEqual(f.flushed(), [true]);
});

test('token, connect and stream successes carry their source, kind and duration', async context => {
  const f = await connected(context);
  await until(() => f.phases().some(item => item.phase === 'token'));
  const token = f.phases().find(item => item.phase === 'token');
  assert.equal(token.outcome, 'success'); assert.equal(token.credential_source, 'api'); assert.equal(typeof token.duration_ms, 'number');
  f.database().status({connected: true, connecting: false, downloading: true});
  context.mock.timers.tick(250);
  f.database().status({connected: true, connecting: false, downloading: false, lastSyncedAt: new Date()});
  f.database().streamFailure(); context.mock.timers.tick(5000); await until(() => connects(f) === 2);
  f.database().status({connected: true, connecting: false, downloading: false});
  await until(() => f.phases().filter(item => item.phase === 'connect' && item.outcome === 'success').length === 2);
  assert.deepEqual(f.phases().filter(item => item.phase === 'connect' && item.outcome === 'success').map(item => item.connection_kind), ['initial', 'reconnect']);
  const stream = f.phases().find(item => item.phase === 'stream' && item.outcome === 'success');
  assert.equal(stream.duration_ms, 250);
});
