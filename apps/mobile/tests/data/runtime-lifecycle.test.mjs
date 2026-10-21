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
import {PdfBlockCache} from '../../src/data/pdf-cache.ts';
import {Sha256} from '../../src/data/pdf-sha256.ts';

test('production runtime suspends and resumes without closing the database or replacing the authenticated account scope', async () => {
  const events = [], storage = new MemoryPreferences({auth_token: 'synthetic', user_id: 'account', last_refresh_time: String(Date.now() / 1000)});
  let pending = 3, token = 0, rejectConnect, cachedAccess, networkListener, networkReads = 0, networkStops = 0, pdfScope;
  const nativePdfFetch = async () => assert.fail('No PDF network call expected in this lifecycle case');
  const network = {read: async () => {networkReads++; return {};}, subscribe(listener) {networkListener = listener; return () => {networkStops++;};}};
  class Database {
    async init() {events.push('init');}
    async close() {events.push('close'); rejectConnect?.(new Error('closed'));}
    async connect() {events.push('connect'); await new Promise((_resolve, reject) => {rejectConnect = reject;});}
    async disconnect() {events.push('disconnect'); rejectConnect?.(new Error('aborted')); rejectConnect = null;}
    async execute() {pending++;}
    async writeTransaction(work) {return work(this);}
  }
  class Cache {constructor(directory) {this.dataDirectory = directory;} setAccessBarrier(barrier) {this.barrier = barrier;} setAvatarCache(avatars) {this.avatars = avatars;}}
  const articleCalls = [];
  class Worker {constructor(options) {cachedAccess = options.assertCachedAccess;} async setOnline(online) {events.push(`network-${online}`);} start() {events.push('cache-start');} async pause() {events.push('cache-pause');} resume() {events.push('cache-resume');} cancel() {} async stop() {} beginForeground() {return () => {};} async getArticleContent(...args) {articleCalls.push(args); return '<p>shared</p>';}}
  const bridge = {beginDataOwnership: async () => ({scanComplete: true, databaseCandidates: [], legacyDataDirectory: '/synthetic', newDatabaseDirectory: '/synthetic/new'}),
    endDataOwnership: async () => {events.push('release');}, newIdentifier: () => 'account-owner', md5String: value => value,
    beginStorageTransition: () => {events.push('begin'); return ++token;}, endStorageTransition: async () => {events.push('end');}};
  const api = {options: {baseUrl: 'https://synthetic.test'}, setBaseUrl(url) {this.options.baseUrl = url;}, sendMetrics: async () => {}, refresh: async value => value};
  class UnexpectedFileAccess {constructor() {assert.fail('Lifecycle transitions must not access PDF files');}}
  const {PdfFileStorage} = await loadComponent('../../src/data/pdf-file-storage.ts', {
    'expo-file-system': {Directory: UnexpectedFileAccess, File: UnexpectedFileAccess},
    'expo': {requireNativeModule: () => assert.fail('Lifecycle transitions must not resolve PDF paths'), uuid: {v4: () => assert.fail('Lifecycle transitions must not write PDF files')}},
    './pdf-sha256.ts': {Sha256},
  }, {TextEncoder});
  const {createMobileDataRuntime} = await loadComponent('../../src/data/runtime.ts', {
    'expo/fetch': {fetch: async () => {}}, '../domain/session.ts': {SessionController}, '../domain/credential-readiness.ts': {CredentialReadiness, ReauthenticationRequiredError, CredentialsUnavailableError}, './api.ts': {createMobileApi: options => {assert.equal(options.pdfFetch, nativePdfFetch); assert.equal(pdfScope(), null); return api;}},
    './pdf-cache.ts': {PdfBlockCache}, './pdf-file-storage.ts': {PdfFileStorage},
    './cache.ts': {ArticleFileCache: Cache}, './account-cleanup.ts': {clearAccountData: async () => {throw new Error('Unexpected cleanup');}},
    './account-lease.ts': {AccountDatabaseLease, AccountInactiveError}, './background-cache.ts': {BackgroundArticleCache: Worker}, './runtime-activity.ts': {RuntimeActivity},
    './native-network.ts': {nativeNetwork: {read: async () => ({}), subscribe: () => () => {}}},
    './native-pdf-transfer.ts': {createNativePdfFetch: scope => {pdfScope = scope; return nativePdfFetch;}},
    '../native/reader-image': {loadReaderImage: async () => assert.fail('No image request expected in lifecycle fixture')},
    './image-fetch.ts': {fetchCacheImage: async () => {}}, '../native/platform': {activateReaderResources: async () => {}, revokeReaderResources: async () => {events.push('revoke');}},
    './connector.ts': {createSyncConnector: () => ({pause() {}, resume() {}, invalidate() {}, async prepareConnection() {return {endpoint: 'https://sync.example', token: 'synthetic'};}})}, './adoption.ts': {openVerifiedDatabase}, './adoption-profile.ts': {deriveReviewedAdoptionEvidence: () => undefined},
    './legacy-preferences.ts': {migrateLegacyPreferences: async () => {}}, './native-storage.ts': {loadLegacyBridge: () => bridge, nativePreferenceStorage: () => storage},
    './preferences.ts': {PreferenceStore, PREFERENCE_KEYS}, './repositories.ts': {MobileRepositories: class {constructor(lease) {this.lease = lease;}}},
    './schema.ts': {createMobileSchema: async () => ({}), SYNC_PARAMETERS: {}}, './upgrade.ts': {UpgradeVerificationRequired}, '@powersync/react-native': {PowerSyncDatabase: Database},
  });
  const runtime = createMobileDataRuntime({baseUrl: 'https://synthetic.test', platform: 'ios', version: 'fixture', network});
  await assert.rejects(runtime.getArticleContent('book'), /inactive/i);
  await runtime.start(); runtime.markLibraryPresented(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(networkReads, 1); assert.doesNotThrow(cachedAccess);
  networkListener({isConnected: false}); assert.equal(events.at(-1), 'network-false');
  const count = events.length; networkListener({isConnected: false}); assert.equal(events.length, count);
  networkListener({isConnected: true}); assert.equal(events.at(-1), 'network-true');
  const request = new AbortController();
  assert.equal(await runtime.getArticleContent('book', 'collection-owner', request.signal), '<p>shared</p>');
  assert.deepEqual(articleCalls, [['book', 'collection-owner', request.signal]]);
  const session = runtime.sessions.getSnapshot(), repositories = runtime.getRepositories(), cache = runtime.getCache(), preferences = runtime.getAccountPreferences(), database = runtime.getDatabase();
  await runtime.setForeground(false);
  assert.throws(cachedAccess, /inactive/i);
  assert.equal(runtime.sessions.getSnapshot(), session); assert.equal(runtime.getRepositories(), repositories);
  assert.equal(runtime.getCache(), cache); assert.equal(runtime.getAccountPreferences(), preferences); assert.equal(runtime.getDatabase(), database);
  assert.equal(runtime.getNativeResourceOwner(), 'account-owner'); assert.equal(pending, 3);
  assert.equal(JSON.stringify(pdfScope()), JSON.stringify({owner: 'account-owner', origin: 'https://synthetic.test'}));
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
  assert.equal(storage.values.auth_token, 'synthetic'); assert.equal(pending, 4);
});
