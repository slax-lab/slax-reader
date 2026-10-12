import {Directory, File, Paths} from 'expo-file-system';
import {PowerSyncDatabase, type SyncStatus} from '@powersync/react-native';
import {PreferenceStore, type PreferenceValues} from '../src/data/preferences';
import {SessionController} from '../src/domain/session';
import {MobileRepositories} from '../src/data/repositories';
import {ArticleFileCache} from '../src/data/cache';
import {createMobileApi} from '../src/data/api';
import {createMobileSchema, MOBILE_TABLES} from '../src/data/schema';
import {PaymentController} from '../src/payments/controller';
import {createMobileTelemetry} from '../src/telemetry/core';
import {mobileConfig} from '../src/config';
import {createTranslator, normalizeLocale} from '../src/i18n';
import type {MobileContextValue} from '../src/runtime';
import type {MobileDataRuntime, UpgradeState} from '../src/data/runtime';
import {createFixtureFetch, type FixtureTransportPayload} from './transport';
import {assertFixtureScope, decodeFixtureArtwork, FixtureMemoryPreferences, planFixtureRows, preparedRssCacheKeys} from './isolation';
import {fixtureDocuments} from './documents';
import {fixtureArtworkBase64, fixtureImageHashes} from './resources';

export interface FixturePayload extends FixtureTransportPayload {
  settings: PreferenceValues; session: {token: string; userId: string; refreshedAt: number};
  database: Record<string, Record<string, unknown>[]>; cache: {key: string; htmlFile: string}[];
  network: {isConnected: boolean; isInternetReachable: boolean};
  sync: {connected: boolean; connecting: boolean; downloading: boolean; uploading: boolean; hasSynced: boolean};
  upgrade?: {ownership: string};
  authentication?: {outcome: 'cancel'|'error'|'success'; delayMs: number; message: string};
}
/** This adapter never constructs the production runtime, native preferences or a network connector. */
export async function createFixtureRuntime(scenario: string, payload: FixturePayload, inputSha256: string, localeInput: string) {
  if (!__DEV__) throw new Error('UI fixture runtime is development-only');
  if (!/^[a-z0-9-]+$/.test(scenario)) throw new Error('Invalid fixture scenario');
  const scope = new Directory(Paths.cache, 'slax-ui-fixtures', `${scenario}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const marker = {controlledFixture: true as const, fixtureVersion: 1 as const, scenario, inputSha256};
  assertFixtureScope(scope.uri, Paths.cache.uri, marker);
  scope.create({intermediates: true}); new File(scope, 'slax-fixture.json').write(JSON.stringify(marker));
  assertFixtureScope(scope.uri, Paths.cache.uri, JSON.parse(await new File(scope, 'slax-fixture.json').text()));
  const preferences = new PreferenceStore(new FixtureMemoryPreferences({...payload.settings, auth_token: payload.session.token, user_id: payload.session.userId, last_refresh_time: String(payload.session.refreshedAt), user_language: normalizeLocale(localeInput), analytics_device_id: 'synthetic-ui-fixture'}));
  let database: PowerSyncDatabase | null = null, repositories: MobileRepositories | null = null, cache: ArticleFileCache | null = null;
  const sessions = new SessionController(preferences, {async enter() {}, async leave(_id, clear) {if (clear) {await database?.disconnectAndClear(); cache?.clearArticles();}}}, () => payload.session.refreshedAt);
  const api = createMobileApi({baseUrl: 'https://fixture-api.test', platform: mobileConfig.platform, version: 'fixture (1)', sessions, fetch: createFixtureFetch(payload), sleep: async () => undefined});
  const upgrade: UpgradeState = payload.upgrade?.ownership === 'verification-required' ? {status: 'verification-required', inventory: {scanComplete: true, databaseCandidates: ['fixture-only/powersync.db'], legacyDataDirectory: scope.uri, newDatabaseDirectory: scope.uri}} : {status: 'ready'};
  const statusListeners = new Set<(status: SyncStatus) => void>();
  let status = payload.sync as unknown as SyncStatus;
  let identifier = 1000;
  const uuid = () => `${(++identifier).toString(16).padStart(8, '0')}-0000-4000-8000-000000000001`;
  try {
    if (upgrade.status === 'ready') {
      const owned = new PowerSyncDatabase({schema: await createMobileSchema(), database: {dbFilename: 'fixture.db', dbLocation: scope.uri.replace(/^file:\/\//, '')}});
      await owned.init();
      database = new Proxy(owned, {get(target, key) {
        if (key === 'currentStatus') return status;
        if (key === 'registerListener') return (listener: {statusChanged?: (value: SyncStatus) => void}) => {if (listener.statusChanged) statusListeners.add(listener.statusChanged); return () => {if (listener.statusChanged) statusListeners.delete(listener.statusChanged);};};
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      }});
      const plans = planFixtureRows(MOBILE_TABLES, payload.database);
      await database.writeTransaction(async tx => {for (const plan of plans) await tx.execute(plan.sql, plan.parameters);});
      repositories = new MobileRepositories(database, uuid);
      cache = new ArticleFileCache(scope.uri.replace(/^file:\/\//, ''), url => {const hash = fixtureImageHashes[url]; if (!hash) throw new Error('No prepared fixture image hash'); return hash;});
      const artwork = decodeFixtureArtwork(fixtureArtworkBase64);
      for (const key of preparedRssCacheKeys(payload.api)) for (const url of Object.keys(fixtureImageHashes)) {if (url.includes('/failure.png')) continue; const file = cache.imageFile(key, url); file.parentDirectory.create({intermediates: true, idempotent: true}); file.write(artwork);}
      for (const article of payload.cache) {
        const html = fixtureDocuments[article.htmlFile]; if (html === undefined) throw new Error('No prepared fixture document'); cache.writeArticle(article.key, html);
        for (const url of Object.keys(fixtureImageHashes)) {if (url.includes('/failure.png')) continue; const file = cache.imageFile(article.key, url); file.parentDirectory.create({intermediates: true, idempotent: true}); file.write(artwork);}
      }
    }
    await sessions.restore();
    const telemetry = createMobileTelemetry({preferences, api: {async sendClientEvents() {}}, platform: mobileConfig.platform, version: 'fixture (1)', locale: () => normalizeLocale(localeInput), generateIdentifier: () => 'synthetic-ui-fixture'});
    const payments = new PaymentController({async start() {}, async products() {}, async purchase() {throw new Error('Native purchases are disabled in UI fixtures');}, async finish() {}, async restore() {return [];}, async pending() {return [];}, async entitlements() {return [];}, async stop() {}}, sessions, preferences, async () => ({ok: false}));
    const runtime: MobileDataRuntime = {preferences, sessions, api, async setForeground() {}, async start() {}, async stop() {await database?.close(); database = null; repositories = null; cache = null;}, getAccountPreferences: () => preferences, getNativeResourceOwner: () => null, beginArticleAccess: () => () => {}, getDatabase: () => database, getRepositories: () => repositories, getCache: () => cache, getUpgradeSnapshot: () => upgrade, subscribeUpgrade: () => () => undefined};
    const value = async (): Promise<MobileContextValue> => {
      const settings = await preferences.read(), locale = normalizeLocale(String(settings.user_language));
      return {runtime, api, preferences, sessions, nativeResourceOwner: null, repositories, cache, session: sessions.getSnapshot(), upgrade, settings, locale, t: createTranslator(locale), config: {...mobileConfig, apiUrl: 'https://fixture-api.test', betaApiUrl: 'https://fixture-api-beta.test', isBeta: false, webUrl: 'https://fixture-pages.test', webDomain: '.test', version: 'fixture', buildNumber: '1'}, payments, webSession: {ready: true, error: null}, telemetryOverride: telemetry, fixtureOnly: {network: payload.network, dataDirectory: scope.uri, deleteNoticeHtml: fixtureDocuments['articles/delete-notice.html'], agreementHtml: {terms: fixtureDocuments['articles/terms.html'], privacy: fixtureDocuments['articles/privacy.html']}, async authenticate(provider) {
        const plan = payload.authentication;
        if (!plan) throw new Error('Provider action has no prepared fixture outcome');
        await new Promise(resolve => setTimeout(resolve, plan.delayMs));
        if (plan.outcome === 'cancel') return null;
        if (plan.outcome === 'error') throw new Error(plan.message);
        return {type: provider, platform: mobileConfig.platform, code: 'fixture-identity-token-unusable', redirect_uri: '', id_token: provider === 'apple' ? 'fixture-apple-token-unusable' : ''};
      }}, async retryStart() {throw new Error('A fixture compatibility gate cannot be bypassed');}};
    };
    return {value, preferences, sessions, scopeUri: scope.uri, setSync(next: typeof payload.sync) {status = next as unknown as SyncStatus; statusListeners.forEach(listener => listener(status));}, async dispose() {await payments.stop(); await runtime.stop(); assertFixtureScope(scope.uri, Paths.cache.uri, JSON.parse(await new File(scope, 'slax-fixture.json').text())); scope.delete();}};
  } catch (error) {await database?.close(); assertFixtureScope(scope.uri, Paths.cache.uri, marker); scope.delete(); throw error;}
}
