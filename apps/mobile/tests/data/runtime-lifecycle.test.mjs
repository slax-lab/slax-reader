import test from 'node:test';
import assert from 'node:assert/strict';
import {loadComponent} from '../reader/parity-host.mjs';
import {RuntimeActivity} from '../../src/data/runtime-activity.ts';
import {AccountDatabaseLease, AccountInactiveError} from '../../src/data/account-lease.ts';
import {PreferenceStore, PREFERENCE_KEYS} from '../../src/data/preferences.ts';
import {SessionController} from '../../src/domain/session.ts';
import {CredentialReadiness, ReauthenticationRequiredError, CredentialsUnavailableError} from '../../src/domain/credential-readiness.ts';
import {MemoryPreferences} from './helpers.ts';
import {openVerifiedDatabase} from '../../src/data/adoption.ts';
import {UpgradeVerificationRequired} from '../../src/data/upgrade.ts';

test('production runtime suspends and resumes without closing the database or replacing the authenticated account scope', async () => {
  const events = [], storage = new MemoryPreferences({auth_token: 'synthetic', user_id: 'account', last_refresh_time: String(Date.now() / 1000)});
  let pending = 3, token = 0, rejectConnect, cachedAccess, networkListener, networkReads = 0, networkStops = 0, workerOptions;
  const network = {read: async () => {networkReads++; return {};}, subscribe(listener) {networkListener = listener; return () => {networkStops++;};}};
  class Database {
    async init() {events.push('init');}
    async close() {events.push('close'); rejectConnect?.(new Error('closed'));}
    async connect() {events.push('connect'); await new Promise((_resolve, reject) => {rejectConnect = reject;});}
    async disconnect() {events.push('disconnect'); rejectConnect?.(new Error('aborted')); rejectConnect = null;}
    async execute() {pending++;}
    async writeTransaction(work) {return work(this);}
  }
  class Cache {constructor(directory, _md5, _guard, offline) {this.dataDirectory = directory; this.offline = offline;} setAvatarCache(avatars) {this.avatars = avatars;}}
  const articleCalls = [];
  const engine = {};
  class Worker {constructor(options) {workerOptions = options; cachedAccess = options.assertCachedAccess; assert.equal(options.engine, engine);} async open() {events.push('engine-open');} setOnline(online) {events.push(`network-${online}`);} start() {events.push('cache-start');} async suspend() {events.push('cache-pause');} resume() {events.push('cache-resume');} cancel() {} async close() {events.push('engine-close');} setInteractionBusy(busy, source) {events.push(`busy-${busy}-${source}`);} beginForeground() {return () => {};} async getArticleContent(...args) {articleCalls.push(args); return '<p>shared</p>';}}
  const bridge = {beginDataOwnership: async () => ({scanComplete: true, databaseCandidates: [], legacyDataDirectory: '/synthetic', newDatabaseDirectory: '/synthetic/new'}),
    endDataOwnership: async () => {events.push('release');}, newIdentifier: () => 'account-owner', md5String: value => value,
    beginStorageTransition: () => {events.push('begin'); return ++token;}, endStorageTransition: async () => {events.push('end');}};
  const api = {options: {baseUrl: 'https://synthetic.test'}, setBaseUrl(url) {this.options.baseUrl = url;}, sendMetrics: async () => {}, refresh: async value => value};
  const {createMobileDataRuntime} = await loadComponent('../../src/data/runtime.ts', {
    'expo/fetch': {fetch: async () => {}}, '../domain/session.ts': {SessionController}, '../domain/credential-readiness.ts': {CredentialReadiness, ReauthenticationRequiredError, CredentialsUnavailableError}, './api.ts': {createMobileApi: options => {assert.equal('pdfFetch' in options, false); return api;}},
    './cache.ts': {ArticleFileCache: Cache}, './account-cleanup.ts': {clearAccountData: async () => {throw new Error('Unexpected cleanup');}},
    './account-lease.ts': {AccountDatabaseLease, AccountInactiveError}, './offline-coordinator.ts': {OfflineCoordinator: Worker}, './native-offline-engine.ts': {loadOfflineEngine: () => engine}, './runtime-activity.ts': {RuntimeActivity},
    './native-network.ts': {nativeNetwork: {read: async () => ({}), subscribe: () => () => {}}},
    '../native/reader-image': {loadReaderImage: async () => assert.fail('No image request expected in lifecycle fixture')},
    '../native/platform': {activateReaderResources: async () => {}, revokeReaderResources: async () => {events.push('revoke');}},
    './connector.ts': {createSyncConnector: () => ({pause() {}, resume() {}, invalidate() {}, async prepareConnection() {return {endpoint: 'https://sync.example', token: 'synthetic'};}})}, './adoption.ts': {openVerifiedDatabase}, './adoption-profile.ts': {deriveReviewedAdoptionEvidence: () => undefined},
    './legacy-preferences.ts': {migrateLegacyPreferences: async () => {}}, './native-storage.ts': {loadLegacyBridge: () => bridge, nativePreferenceStorage: () => storage},
    './preferences.ts': {PreferenceStore, PREFERENCE_KEYS}, './repositories.ts': {MobileRepositories: class {constructor(lease) {this.lease = lease;}}},
    './schema.ts': {createMobileSchema: async () => ({}), SYNC_PARAMETERS: {}}, './upgrade.ts': {UpgradeVerificationRequired}, '@powersync/react-native': {PowerSyncDatabase: Database},
  });
  const runtime = createMobileDataRuntime({baseUrl: 'https://synthetic.test', platform: 'ios', version: 'fixture', network});
  await assert.rejects(runtime.getArticleContent('book'), /inactive/i);
  runtime.setInteractionBusy(true, 'scroll');
  await runtime.start(); runtime.markLibraryPresented(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(events.includes('engine-open'), 'Account entry opens the native owner'); assert.ok(events.includes('busy-true-scroll'), 'A busy flag set before admission reaches the account coordinator');
  assert.equal(workerOptions.scope.owner, 'account-owner'); assert.equal(workerOptions.scope.origin, 'https://synthetic.test'); assert.equal(workerOptions.scope.scope, JSON.stringify(['https://synthetic.test', 'account']));
  assert.equal(workerOptions.scope.clientType, 'ios'); assert.equal(workerOptions.scope.clientVersion, 'fixture'); assert.equal(workerOptions.scope.directory, '/synthetic');
  runtime.setInteractionBusy(false, 'scroll'); assert.equal(events.at(-1), 'busy-false-scroll');
  assert.equal(networkReads, 1); assert.doesNotThrow(cachedAccess);
  networkListener({isConnected: false}); assert.equal(events.at(-1), 'network-false'); assert.ok(events.includes('disconnect'), 'Offline disconnects PowerSync instead of retrying');
  const count = events.length; networkListener({isConnected: false}); assert.equal(events.length, count);
  networkListener({isConnected: true}); assert.equal(events.at(-1), 'network-true');
  const request = new AbortController();
  assert.equal(await runtime.getArticleContent('book', 'collection-owner', request.signal), '<p>shared</p>');
  assert.deepEqual(articleCalls, [['book', 'collection-owner', request.signal, undefined]]);
  const session = runtime.sessions.getSnapshot(), repositories = runtime.getRepositories(), cache = runtime.getCache(), preferences = runtime.getAccountPreferences(), database = runtime.getDatabase();
  await runtime.setForeground(false);
  assert.throws(cachedAccess, /inactive/i);
  assert.equal(runtime.sessions.getSnapshot(), session); assert.equal(runtime.getRepositories(), repositories);
  assert.equal(runtime.getCache(), cache); assert.equal(runtime.getAccountPreferences(), preferences); assert.equal(runtime.getDatabase(), database);
  assert.equal(runtime.getNativeResourceOwner(), 'account-owner'); assert.equal(pending, 3);
  assert.equal(events.includes('close'), false); assert.equal(events.includes('release'), false); assert.equal(events.includes('revoke'), false);
  await repositories.lease.execute('background position'); assert.equal(pending, 4);
  await runtime.setForeground(true); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(networkReads, 2); assert.doesNotThrow(cachedAccess);
  assert.equal(events.at(-1), 'connect'); assert.equal(runtime.sessions.getSnapshot(), session);
  const paused = runtime.setForeground(false);
  assert.equal(events.at(-1), 'disconnect', 'Pending connect cannot delay disconnect');
  const foreground = runtime.setForeground(true), background = runtime.setForeground(false);
  await Promise.all([paused, foreground, background]);
  assert.equal(events.filter(event => event === 'connect').length, 2, 'Superseded resume cannot reconnect');
  await runtime.setForeground(true); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(events.filter(event => event === 'connect').length, 3);
  runtime.credentials.reject(); assert.throws(cachedAccess, ReauthenticationRequiredError);
  await runtime.stop();
  const stoppedEvents = events.length; networkListener({isConnected: false}); assert.equal(events.length, stoppedEvents); assert.equal(networkStops, 1);
  await assert.rejects(runtime.getArticleContent('book'), /inactive/i);
  assert.equal(articleCalls.length, 1);
  assert.equal(events.filter(event => event === 'close').length, 1); assert.equal(events.filter(event => event === 'release').length, 1);
  assert.equal(events.filter(event => event === 'engine-close').length, 1, 'Stop closes the native owner exactly once');
  assert.equal(storage.values.auth_token, 'synthetic'); assert.equal(pending, 4);
});
