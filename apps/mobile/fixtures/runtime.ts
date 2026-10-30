import {Directory, File, Paths} from 'expo-file-system';
import {AppState} from 'react-native';
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
import {prepareFixturePdfs, type FixturePdfPlan, type FixturePdfCounts} from './pdf';
import {OfflineCoordinator} from '../src/data/offline-coordinator';
import {createFixtureOfflineEngine} from './offline-engine';
import {AccountDatabaseLease} from '../src/data/account-lease';
import {fixtureActions} from '../src/components/fixture-actions';
import {activateReaderResources, revokeReaderResources} from '../src/native/platform';
import {createFixturePdfImport} from './pdf-import';
import {fetch as expoFetch} from 'expo/fetch';
import {createPdfHttpFetch, PDF_HTTP_ORIGIN, PDF_HTTP_TOKEN, type PdfHttpObservation} from './pdf-http';

export class FixtureControlLifecycle {
  private foreground = true;
  private disposed = false;
  private epoch = 0;
  private transition: Promise<void> = Promise.resolve();
  private waiters = new Set<() => void>();
  constructor(private apply: (foreground: boolean) => Promise<void>) {}
  setForeground(foreground: boolean): Promise<void> {
    this.foreground = foreground; this.epoch++;
    const next = this.transition.catch(() => undefined).then(() => {this.check(); return this.apply(foreground);});
    this.transition = next;
    void next.then(() => this.wake(), () => this.wake());
    return next;
  }
  private check() {if (this.disposed) throw Object.assign(new Error('Fixture scope was disposed'), {name: 'FixtureControlDisposed'});}
  private wake() {for (const wake of this.waiters) wake(); this.waiters.clear();}
  async ready(): Promise<void> {
    for (;;) {
      this.check();
      if (!this.foreground) {await new Promise<void>(resolve => this.waiters.add(resolve)); continue;}
      const transition = this.transition; await transition; this.check();
      if (this.foreground && transition === this.transition) return;
    }
  }
  async run<T>(work: () => Promise<T>, retryInterrupted = false): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.ready(); const epoch = this.epoch;
      try {const result = await work(); await this.ready(); return result;}
      catch (error) {
        this.check();
        const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
        const message = error && typeof error === 'object' && 'message' in error ? error.message : '';
        const interrupted = name === 'AbortError' || message === 'Automatic article cache inactive' || message === 'PDF fixture is inactive';
        if (!retryInterrupted || !interrupted || epoch === this.epoch || attempt >= 2) throw error;
      }
    }
  }
  dispose() {this.disposed = true; this.wake();}
}

let fixtureResourceOwner: string | null = null;
let fixtureResourceTransition: Promise<void> = Promise.resolve();
function resourceTransition(work: () => Promise<void>) {
  const next = fixtureResourceTransition.catch(() => undefined).then(work);
  fixtureResourceTransition = next; return next;
}

export interface FixturePayload extends FixtureTransportPayload {
  settings: PreferenceValues; session: {token: string; userId: string; refreshedAt: number};
  database: Record<string, Record<string, unknown>[]>; cache: {key: string; htmlFile: string}[];
  network: {isConnected: boolean; isInternetReachable: boolean};
  sync: {connected: boolean; connecting: boolean; downloading: boolean; uploading: boolean; hasSynced: boolean};
  pdf?: FixturePdfPlan[];
  nativePdfImport?: {bookmarkId: string; syncDelayMs: number; rows: Record<string, Record<string, unknown>[]>};
  upgrade?: {ownership: string};
  authentication?: {outcome: 'cancel'|'error'|'success'; delayMs: number; message: string};
}
/** This adapter never constructs the production runtime, native preferences or a network connector. */
export async function createFixtureRuntime(scenario: string, payload: FixturePayload, inputSha256: string, localeInput: string) {
  if (!__DEV__) throw new Error('UI fixture runtime is development-only');
  if (!/^[a-z0-9-]+$/.test(scenario)) throw new Error('Invalid fixture scenario');
  // This one RSS acceptance scenario uses a stable app-private scope so a forced
  // process relaunch can reopen the exact same local database without reseeding.
  // All other fixtures retain their disposable, per-runtime scope.
  const persistentRssFixture = scenario === 'rss-local-native-offline';
  const scope = persistentRssFixture
    ? new Directory(Paths.cache, 'slax-ui-fixtures', scenario)
    : new Directory(Paths.cache, 'slax-ui-fixtures', `${scenario}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const marker = {controlledFixture: true as const, fixtureVersion: 1 as const, scenario, inputSha256};
  assertFixtureScope(scope.uri, Paths.cache.uri, marker);
  scope.create({intermediates: true, idempotent: true});
  const markerFile = new File(scope, 'slax-fixture.json');
  const existingMarker = persistentRssFixture && markerFile.exists ? JSON.parse(await markerFile.text()) : null;
  if (existingMarker && (existingMarker.scenario !== scenario || existingMarker.inputSha256 !== inputSha256 || existingMarker.fixtureVersion !== 1)) throw new Error('Persisted RSS fixture belongs to different fixture inputs');
  if (!existingMarker) markerFile.write(JSON.stringify(marker));
  assertFixtureScope(scope.uri, Paths.cache.uri, existingMarker ?? JSON.parse(await markerFile.text()));
  const seedCompleteFile = new File(scope, 'rss-seed-complete.json');
  const reusedExistingRssDatabase = Boolean(existingMarker && persistentRssFixture && seedCompleteFile.exists);
  const preferences = new PreferenceStore(new FixtureMemoryPreferences({...payload.settings, auth_token: payload.session.token, user_id: payload.session.userId, last_refresh_time: String(payload.session.refreshedAt), user_language: normalizeLocale(localeInput), analytics_device_id: 'synthetic-ui-fixture'}));
  let database: PowerSyncDatabase | null = null, repositories: MobileRepositories | null = null, cache: ArticleFileCache | null = null;
  let queue: OfflineCoordinator | null = null, lease: AccountDatabaseLease | null = null;
  const httpFixture = scenario === 'reader-pdf-http';
  const apiOrigin = httpFixture ? PDF_HTTP_ORIGIN : 'https://fixture-api.test';
  if (httpFixture && payload.session.token !== PDF_HTTP_TOKEN) throw new Error('Loopback fixture requires its synthetic session');
  const rangeEvidence = scenario === 'reader-pdf-native-storage' || httpFixture;
  let nativeResourceOwner: string | null = null, stopped = false, foreground = true, stopPdfActions: (() => void) | undefined, activityListener: {remove(): void} | undefined;
  const documents = prepareFixturePdfs(payload.pdf);
  const importPlan = payload.nativePdfImport;
  if (importPlan && (scenario !== 'reader-pdf-import' || importPlan.bookmarkId !== 'fixture-pdf-imported' || payload.pdf?.length !== 1 || payload.pdf[0]?.document !== 'eight-pages' || !documents.has(importPlan.bookmarkId) || importPlan.syncDelayMs !== 2000 || Object.keys(importPlan.rows).some(table => !['sr_user_bookmark', 'ps_data_local__local_bookmark_info'].includes(table)))) throw new Error('Invalid native PDF import fixture');
  let seedDirectory: Directory | undefined, importPdf: ReturnType<typeof createFixturePdfImport> | undefined;
  const controls = new FixtureControlLifecycle(async active => {foreground = active; if (active) queue?.resume(); else await queue?.suspend();});
  const counts: FixturePdfCounts = {metadataRequests: 0, rangeRequests: 0, bytesServed: 0, offlineRequests: 0, rejectedRequests: 0};
  const rangeEvents: {begin: number; end: number; state: string}[] = [];
  const httpEvents: PdfHttpObservation[] = [];
  const httpTransport = httpFixture ? createPdfHttpFetch(expoFetch as typeof globalThis.fetch, event => {
    if (!httpFixture || stopped) return;
    httpEvents.push(event); if (httpEvents.length > 128) httpEvents.shift();
    new File(scope, 'pdf-http.json').write(JSON.stringify({...marker, transport: 'expo/fetch', backend: 'synthetic-loopback-http', nativeOwnerRequired: true, events: httpEvents, nativeInteractionVerified: false}));
  }) : undefined;
  const recordPdf = () => {if (!stopped && documents.size) {assertFixtureScope(scope.uri, Paths.cache.uri, marker); new File(scope, 'pdf-transport.json').write(JSON.stringify({...marker, ...counts, ...(rangeEvidence ? {storageAdapter: 'fixture-offline-engine', rangeEvents} : {}), nativeInteractionVerified: false}));}};
  const transport = httpFixture ? httpTransport! : createFixtureFetch(payload, 'https://fixture-api.test', {documents, counts, record: recordPdf, slowRange: rangeEvidence, rangeEvent: event => {if (rangeEvidence) {rangeEvents.push(event); if (rangeEvents.length > 128) rangeEvents.shift(); recordPdf();}}, get importPdf() {return importPdf;}});
  const revoke = async () => {
    const owner = nativeResourceOwner;
    nativeResourceOwner = null; importPdf?.dispose(); queue?.cancel(); lease?.invalidate();
    await queue?.close(); await lease?.drainWrites(); queue = null; lease = null;
    if (owner) await resourceTransition(async () => {if (fixtureResourceOwner === owner) {await revokeReaderResources(); fixtureResourceOwner = null;}});
  };
  const sessions = new SessionController(preferences, {async enter(session) {
    // Non-PDF scenarios need no native PDF resources, but data-gated screens still require an owner.
    if (!documents.size && !persistentRssFixture) {if (!stopped) nativeResourceOwner = `fixture-${scope.name}`; return;}
    if (session.userId !== payload.session.userId) throw new Error('PDF fixture account has no prepared data');
    if (!database || !cache || stopped) throw new Error('PDF fixture database is unavailable');
    await revoke();
    const account = new AccountDatabaseLease(database); lease = account;
    const owner = `fixture-${scope.name}-${uuid()}`;
    await resourceTransition(async () => {account.assertActive(); await activateReaderResources(owner); fixtureResourceOwner = owner; nativeResourceOwner = owner;});
    repositories = new MobileRepositories(account, uuid);
    if (!documents.size) return;
    const prepared = cache;
    const engine = createFixtureOfflineEngine({fetch: transport, articles: key => prepared.readArticle(key)});
    queue = new OfflineCoordinator({engine, database: account, preferences: preferences.scoped(() => account.assertActive()), identifier: uuid,
      scope: {owner, scope: JSON.stringify([apiOrigin, session.userId]), origin: new URL(apiOrigin).origin, directory: prepared.dataDirectory, userAgent: `SlaxReader/${mobileConfig.platform} fixture (1)`, clientType: mobileConfig.platform, clientVersion: 'fixture (1)'},
      credentials: {current: () => {const state = sessions.getSnapshot(); return state.status === 'authenticated' ? {token: state.session.token, reject: async () => false} : null;}, subscribe: listener => sessions.subscribe(listener)},
      assertActive: () => {account.assertActive(); if (stopped) throw new Error('PDF fixture is inactive');},
      assertCachedAccess: () => {if (!foreground) throw new Error('PDF fixture is inactive');},
    });
    cache = new ArticleFileCache(prepared.dataDirectory, url => {const hash = fixtureImageHashes[url]; if (!hash) throw new Error('No prepared fixture image hash'); return hash;}, () => account.assertActive(), queue, owner);
    queue.start();
  }, async leave(_id, clear) {await revoke(); if (clear) {await database?.disconnectAndClear(); if (!documents.size) await cache?.clearArticles();}}}, () => payload.session.refreshedAt);
  const api = createMobileApi({baseUrl: apiOrigin, platform: mobileConfig.platform, version: 'fixture (1)', sessions, fetch: transport, ...(httpFixture ? {} : {sleep: async () => undefined})});
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
      if (!reusedExistingRssDatabase) {
        const plans = planFixtureRows(MOBILE_TABLES, payload.database);
        await database.writeTransaction(async tx => {for (const plan of plans) await tx.execute(plan.sql, plan.parameters);});
        if (persistentRssFixture) seedCompleteFile.write(JSON.stringify({...marker, seededRowsThisLaunch: true}));
      }
      repositories = new MobileRepositories(database, uuid);
      cache = new ArticleFileCache(scope.uri.replace(/^file:\/\//, ''), url => {const hash = fixtureImageHashes[url]; if (!hash) throw new Error('No prepared fixture image hash'); return hash;});
      const artwork = decodeFixtureArtwork(fixtureArtworkBase64);
      for (const key of preparedRssCacheKeys(payload.api)) for (const url of Object.keys(fixtureImageHashes)) {if (url.includes('/failure.png')) continue; const file = cache.imageFile(key, url); file.parentDirectory.create({intermediates: true, idempotent: true}); file.write(artwork);}
      for (const article of payload.cache) {
        const html = fixtureDocuments[article.htmlFile]; if (html === undefined) throw new Error('No prepared fixture document'); await cache.writeArticle(article.key, html);
        for (const url of Object.keys(fixtureImageHashes)) {if (url.includes('/failure.png')) continue; const file = cache.imageFile(article.key, url); file.parentDirectory.create({intermediates: true, idempotent: true}); file.write(artwork);}
      }
    }
    await sessions.restore();
    if (importPlan) {
      const account = lease as AccountDatabaseLease | null, owner = nativeResourceOwner, document = documents.get(importPlan.bookmarkId)!;
      if (!account || !owner) throw new Error('Native PDF import requires its fixture account');
      const active = () => !stopped && nativeResourceOwner === owner && !account.accountSignal.aborted;
      seedDirectory = new Directory(Paths.document, 'slax-ui-fixture-import', scope.name);
      seedDirectory.create({intermediates: true});
      const seed = new File(seedDirectory, 'slax-synthetic-eight-pages.pdf'); seed.write(document.bytes);
      const record = (state: object) => {if (!stopped) new File(scope, 'pdf-import.json').write(JSON.stringify({...marker, ...state, seedUri: seed.uri, expectedDocumentId: document.descriptor.document_id, expectedBytes: document.descriptor.size, bookmarkId: importPlan.bookmarkId, backend: 'synthetic-local-transport', synchronizationMechanism: 'simulated-local-database', nativeInteractionVerified: false}));};
      importPdf = createFixturePdfImport({document, bookmarkId: importPlan.bookmarkId, delayMs: importPlan.syncDelayMs, active, foreground: () => controls.ready(),
        async publish() {
          const rows = planFixtureRows(MOBILE_TABLES, importPlan.rows);
          await account.writeTransaction(async tx => {for (const row of rows) await tx.execute(row.sql, row.parameters);});
        }, record,
      });
      record({acceptedUploads: 0, rejectedUploads: 0, matchedBytes: 0, synchronization: 'waiting-upload'});
    }
    const telemetry = createMobileTelemetry({preferences, api: {async sendClientEvents() {}}, platform: mobileConfig.platform, version: 'fixture (1)', locale: () => normalizeLocale(localeInput), generateIdentifier: () => 'synthetic-ui-fixture'});
    const payments = new PaymentController({async start() {}, async products() {}, async purchase() {throw new Error('Native purchases are disabled in UI fixtures');}, async finish() {}, async restore() {return [];}, async pending() {return [];}, async entitlements() {return [];}, async stop() {}}, sessions, preferences, async () => ({ok: false}));
    const worker = () => {if (!queue || stopped) throw new Error('This fixture has no active PDF cache scope'); return queue;};
    const runtime: MobileDataRuntime = {preferences, sessions, api,
      markLibraryPresented() {}, isLibraryPresented: () => true, subscribeLibraryPresented: () => () => {}, getAvatarCache: () => null, setInteractionBusy: (busy, source) => queue?.setInteractionBusy(busy, source),
      setForeground: active => controls.setForeground(active), async start() {},
      async stop() {stopped = true; controls.dispose(); activityListener?.remove(); stopPdfActions?.(); await revoke(); await database?.close(); database = null; repositories = null; cache = null; if (seedDirectory?.exists) seedDirectory.delete();},
      getAccountPreferences: () => {const account = lease; return account ? preferences.scoped(() => account.assertActive()) : preferences;},
      getNativeResourceOwner: () => nativeResourceOwner, beginArticleAccess: key => queue?.beginForeground(key) ?? (() => {}),
      getArticleContent: (id, owner, signal) => {
        if (stopped) return Promise.reject(new Error('Fixture scope is inactive'));
        return queue ? queue.getArticleContent(id, owner, signal) : owner ? api.getCollectionBookmarkRawContent(id, owner, signal) : api.getBookmarkRawContent(id, signal);
      },
      getPdfMetadata: (id, owner, signal) => worker().getPdfMetadata(id, owner, signal),
      cachePdf: (id, owner) => worker().cachePdf(id, owner), pdfCacheStatus: (id, owner) => worker().pdfCacheStatus(id, owner),
      getDatabase: () => database, getRepositories: () => repositories, getCache: () => cache, getUpgradeSnapshot: () => upgrade, subscribeUpgrade: () => () => undefined};
    const network = payload.network;
    try {
      for (const plan of payload.pdf ?? []) if (plan.prepare === 'complete') {payload.network = {isConnected: true, isInternetReachable: true}; await runtime.cachePdf(plan.bookmarkId);}
    } finally {payload.network = network;}
    const inspectPdf = async () => {
      const states = [];
      for (const id of documents.keys()) {const status = await runtime.pdfCacheStatus(id), local = await repositories?.local.read(id); states.push({bookmarkId: id, ...status, position: local?.pdf_read_position ?? null, downloadState: local?.is_downloaded ?? 0});}
      if (stopped) return;
      assertFixtureScope(scope.uri, Paths.cache.uri, marker);
      const evidence = {...marker, counts, states, ...(rangeEvidence ? {storageAdapter: 'fixture-offline-engine', rangeEvents} : {}), nativeInteractionVerified: false};
      new File(scope, 'pdf-cache.json').write(JSON.stringify(evidence));
      if (rangeEvidence) {
        const checkpoint = states.every(state => state.complete) ? 'complete' : states.some(state => state.downloadedBytes > 0) ? 'partial' : 'empty';
        new File(scope, `pdf-cache-${checkpoint}.json`).write(JSON.stringify(evidence));
      }
    };
    if (documents.size) {recordPdf(); await inspectPdf();}
    activityListener = AppState.addEventListener('change', state => {void runtime.setForeground(state === 'active').catch(() => undefined);});
    if (AppState.currentState && AppState.currentState !== 'active') await runtime.setForeground(false);
    const value = async (): Promise<MobileContextValue> => {
      if (documents.size && !stopPdfActions) stopPdfActions = fixtureActions.subscribe('pdf-cache', async action => {
        if (action.kind === 'pdf-production-storage') {
          // PDF storage now belongs to the native offline engine; JavaScript has no production file adapter to diagnose.
          new File(scope, 'pdf-production-storage.json').write(JSON.stringify({...marker, adapter: 'SlaxOfflineEngine', jsAdapter: false, nativeInteractionVerified: false})); return true;
        }
        if (action.kind === 'pdf-http-mode' || action.kind === 'pdf-http-status') {
          if (!httpFixture || !httpTransport || !nativeResourceOwner) throw new Error('Loopback controls require the native HTTP fixture');
          const request = new AbortController(), timer = setTimeout(() => request.abort(), 5000);
          try {
            const mode = action.mode;
            if (action.kind === 'pdf-http-mode' && !['normal', 'metadata-404', 'slow'].includes(String(mode))) throw new Error('Unknown prepared HTTP mode');
            const response = await httpTransport(`${PDF_HTTP_ORIGIN}/__fixture/${action.kind === 'pdf-http-status' ? 'status' : `control?mode=${mode}`}`, {method: action.kind === 'pdf-http-status' ? 'GET' : 'POST', headers: {Authorization: `Bearer ${PDF_HTTP_TOKEN}`}, signal: request.signal});
            if (!response.ok) throw new Error('Loopback control rejected');
            const result = await response.json();
            if (!stopped) new File(scope, 'pdf-http-server.json').write(JSON.stringify({...marker, result, backend: 'synthetic-loopback-http', nativeInteractionVerified: false}));
          } finally {clearTimeout(timer);}
          return true;
        }
        if (httpFixture && action.kind.startsWith('pdf-network-')) throw new Error('Stop the loopback server to exercise actual network loss');
        if (!['pdf-fill-cache', 'pdf-cache-status', 'pdf-network-offline', 'pdf-network-online'].includes(action.kind)) return false;
        if (action.kind === 'pdf-fill-cache') {const id = typeof action.bookmarkId === 'string' ? action.bookmarkId : documents.keys().next().value; if (!id || !documents.has(id)) throw new Error('Unknown prepared PDF'); await runtime.cachePdf(id);}
        if (action.kind.startsWith('pdf-network-')) {const online = action.kind.endsWith('-online'), control = globalThis.__SLAX_UI_FIXTURE__; if (control?.scopeUri !== scope.uri) throw new Error('PDF fixture control scope is inactive'); await control.setNetwork({isConnected: online, isInternetReachable: online});}
        await inspectPdf(); return true;
      });
      const settings = await preferences.read(), locale = normalizeLocale(String(settings.user_language));
      return {runtime, api, preferences, sessions, nativeResourceOwner, repositories, cache, session: sessions.getSnapshot(), upgrade, settings, locale, t: createTranslator(locale), config: {...mobileConfig, apiUrl: apiOrigin, betaApiUrl: 'https://fixture-api-beta.test', isBeta: false, webUrl: 'https://fixture-pages.test', webDomain: '.test', version: 'fixture', buildNumber: '1'}, payments, webSession: {ready: true, error: null}, telemetryOverride: telemetry, fixtureOnly: {network: payload.network, dataDirectory: scope.uri, ...(httpFixture ? {pdfNativeOwner: true as const} : {}), ...(importPlan ? {nativePdfImport: 'seeded-synthetic-only' as const} : {}), deleteNoticeHtml: fixtureDocuments['articles/delete-notice.html'], agreementHtml: {terms: fixtureDocuments['articles/terms.html'], privacy: fixtureDocuments['articles/privacy.html']}, async authenticate(provider) {
        const plan = payload.authentication;
        if (!plan) throw new Error('Provider action has no prepared fixture outcome');
        await new Promise(resolve => setTimeout(resolve, plan.delayMs));
        if (plan.outcome === 'cancel') return null;
        if (plan.outcome === 'error') throw new Error(plan.message);
        return {type: provider, platform: mobileConfig.platform, code: 'fixture-identity-token-unusable', redirect_uri: '', id_token: provider === 'apple' ? 'fixture-apple-token-unusable' : ''};
      }}, async retryStart() {throw new Error('A fixture compatibility gate cannot be bypassed');}};
    };
    return {value, preferences, sessions, scopeUri: scope.uri, rssDatabasePersistence: persistentRssFixture ? {reusedExistingDatabase: reusedExistingRssDatabase, seededRowsThisLaunch: !reusedExistingRssDatabase} : null,
      async deleteBookmark(id: string) {if (!/^[A-Za-z0-9_-]+$/.test(id) || !repositories) throw new Error('Bookmark deletion requires a prepared synthetic local repository'); await repositories.deleteBookmark(id);},
      perform: (action: Parameters<typeof fixtureActions.dispatch>[0]) => controls.run(() => fixtureActions.dispatch(action), ['pdf-fill-cache', 'pdf-cache-status', 'pdf-network-offline', 'pdf-network-online'].includes(action.kind)),
      setSync(next: typeof payload.sync) {status = next as unknown as SyncStatus; statusListeners.forEach(listener => listener(status));},
      async dispose() {controls.dispose(); await payments.stop(); await runtime.stop(); assertFixtureScope(scope.uri, Paths.cache.uri, JSON.parse(await new File(scope, 'slax-fixture.json').text())); if (!persistentRssFixture) scope.delete();}};
  } catch (error) {stopped = true; controls.dispose(); activityListener?.remove(); stopPdfActions?.(); await revoke(); await database?.close(); if (seedDirectory?.exists) seedDirectory.delete(); assertFixtureScope(scope.uri, Paths.cache.uri, marker); if (!persistentRssFixture) scope.delete(); throw error;}
}
