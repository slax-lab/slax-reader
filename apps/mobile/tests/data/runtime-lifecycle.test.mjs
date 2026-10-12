import test from 'node:test';
import assert from 'node:assert/strict';
import {loadComponent} from '../reader/parity-host.mjs';
import {RuntimeActivity} from '../../src/data/runtime-activity.ts';
import {AccountDatabaseLease, AccountInactiveError} from '../../src/data/account-lease.ts';
import {PreferenceStore, PREFERENCE_KEYS} from '../../src/data/preferences.ts';
import {SessionController} from '../../src/domain/session.ts';
import {MemoryPreferences} from './helpers.ts';
import {openVerifiedDatabase} from '../../src/data/adoption.ts';
import {UpgradeVerificationRequired} from '../../src/data/upgrade.ts';

test('production runtime suspends and resumes without closing the database or replacing the authenticated account scope', async () => {
  const events = [], storage = new MemoryPreferences({auth_token: 'synthetic', user_id: 'account', last_refresh_time: String(Date.now() / 1000)});
  let pending = 3, token = 0, rejectConnect;
  class Database {
    async init() {events.push('init');}
    async close() {events.push('close'); rejectConnect?.(new Error('closed'));}
    async connect() {events.push('connect'); await new Promise((_resolve, reject) => {rejectConnect = reject;});}
    async disconnect() {events.push('disconnect'); rejectConnect?.(new Error('aborted')); rejectConnect = null;}
    async execute() {pending++;}
    async writeTransaction(work) {return work(this);}
  }
  class Cache {constructor(directory) {this.dataDirectory = directory;}}
  class Worker {start() {events.push('cache-start');} async pause() {events.push('cache-pause');} resume() {events.push('cache-resume');} cancel() {} async stop() {} beginForeground() {return () => {};}}
  const bridge = {beginDataOwnership: async () => ({scanComplete: true, databaseCandidates: [], legacyDataDirectory: '/synthetic', newDatabaseDirectory: '/synthetic/new'}),
    endDataOwnership: async () => {events.push('release');}, newIdentifier: () => 'account-owner', md5String: value => value,
    beginStorageTransition: () => {events.push('begin'); return ++token;}, endStorageTransition: async () => {events.push('end');}};
  const api = {options: {baseUrl: 'https://synthetic.test'}, setBaseUrl(url) {this.options.baseUrl = url;}, sendMetrics: async () => {}, refresh: async value => value};
  const {createMobileDataRuntime} = await loadComponent('../../src/data/runtime.ts', {
    'expo/fetch': {fetch: async () => {}}, '../domain/session.ts': {SessionController}, './api.ts': {createMobileApi: () => api},
    './cache.ts': {ArticleFileCache: Cache}, './account-cleanup.ts': {clearAccountData: async () => {throw new Error('Unexpected cleanup');}},
    './account-lease.ts': {AccountDatabaseLease, AccountInactiveError}, './background-cache.ts': {BackgroundArticleCache: Worker}, './runtime-activity.ts': {RuntimeActivity},
    './image-fetch.ts': {fetchCacheImage: async () => {}}, '../native/platform': {activateReaderResources: async () => {}, revokeReaderResources: async () => {events.push('revoke');}},
    './connector.ts': {createSyncConnector: () => ({})}, './adoption.ts': {openVerifiedDatabase}, './adoption-profile.ts': {deriveReviewedAdoptionEvidence: () => undefined},
    './legacy-preferences.ts': {migrateLegacyPreferences: async () => {}}, './native-storage.ts': {loadLegacyBridge: () => bridge, nativePreferenceStorage: () => storage},
    './preferences.ts': {PreferenceStore, PREFERENCE_KEYS}, './repositories.ts': {MobileRepositories: class {constructor(lease) {this.lease = lease;}}},
    './schema.ts': {createMobileSchema: async () => ({}), SYNC_PARAMETERS: {}}, './upgrade.ts': {UpgradeVerificationRequired}, '@powersync/react-native': {PowerSyncDatabase: Database},
  });
  const runtime = createMobileDataRuntime({baseUrl: 'https://synthetic.test', platform: 'ios', version: 'fixture'});
  await runtime.start();
  const session = runtime.sessions.getSnapshot(), repositories = runtime.getRepositories(), cache = runtime.getCache(), preferences = runtime.getAccountPreferences(), database = runtime.getDatabase();
  await runtime.setForeground(false);
  assert.equal(runtime.sessions.getSnapshot(), session); assert.equal(runtime.getRepositories(), repositories);
  assert.equal(runtime.getCache(), cache); assert.equal(runtime.getAccountPreferences(), preferences); assert.equal(runtime.getDatabase(), database);
  assert.equal(runtime.getNativeResourceOwner(), 'account-owner'); assert.equal(pending, 3);
  assert.equal(events.includes('close'), false); assert.equal(events.includes('release'), false); assert.equal(events.includes('revoke'), false);
  await repositories.lease.execute('background position'); assert.equal(pending, 4);
  await runtime.setForeground(true);
  assert.equal(events.at(-1), 'connect'); assert.equal(runtime.sessions.getSnapshot(), session);
  const paused = runtime.setForeground(false);
  assert.equal(events.at(-1), 'disconnect', 'Pending connect cannot delay disconnect');
  const foreground = runtime.setForeground(true), background = runtime.setForeground(false);
  await Promise.all([paused, foreground, background]);
  assert.equal(events.filter(event => event === 'connect').length, 2, 'Superseded resume cannot reconnect');
  await runtime.setForeground(true);
  assert.equal(events.filter(event => event === 'connect').length, 3);
  await runtime.stop();
  assert.equal(events.filter(event => event === 'close').length, 1); assert.equal(events.filter(event => event === 'release').length, 1);
  assert.equal(storage.values.auth_token, 'synthetic'); assert.equal(pending, 4);
});
