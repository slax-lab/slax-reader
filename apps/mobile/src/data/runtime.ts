import type {PowerSyncDatabase as Database} from '@powersync/react-native';
import {fetch as expoFetch} from 'expo/fetch';
import { SessionController } from '../domain/session.ts';
import {CredentialReadiness} from '../domain/credential-readiness.ts';
import { createMobileApi } from './api.ts';
import type { MobileApiOptions } from './api.ts';
import { ArticleFileCache } from './cache.ts';
import {PdfBlockCache} from './pdf-cache.ts';
import {PdfFileStorage} from './pdf-file-storage.ts';
import type {PdfDescriptor} from '@slax-reader/contracts/pdf';
import { clearAccountData } from './account-cleanup.ts';
import { AccountDatabaseLease, AccountInactiveError } from './account-lease.ts';
import {BackgroundArticleCache} from './background-cache.ts';
import {RuntimeActivity} from './runtime-activity.ts';
import {fetchCacheImage} from './image-fetch.ts';
import { activateReaderResources, revokeReaderResources } from '../native/platform';
import { createSyncConnector } from './connector.ts';
import { openVerifiedDatabase } from './adoption.ts';
import { deriveReviewedAdoptionEvidence } from './adoption-profile.ts';
import { migrateLegacyPreferences } from './legacy-preferences.ts';
import { loadLegacyBridge, nativePreferenceStorage } from './native-storage.ts';
import type { SlaxLegacyBridge } from './native-storage.ts';
import { PreferenceStore, PREFERENCE_KEYS as K } from './preferences.ts';
import { MobileRepositories } from './repositories.ts';
import { createMobileSchema, SYNC_PARAMETERS } from './schema.ts';
import { UpgradeVerificationRequired } from './upgrade.ts';
import type { AdoptionEvidence, LegacyInventory } from './upgrade.ts';

export type UpgradeState = {status: 'idle' | 'checking' | 'ready'} | {status: 'verification-required'; inventory: LegacyInventory} | {status: 'error'; error: Error};
export interface MobileDataRuntimeOptions extends Omit<MobileApiOptions, 'sessions'> { betaBaseUrl?: string; nativeBridge?: SlaxLegacyBridge; adoptionEvidence?: AdoptionEvidence; localSyncEndpoint?: string }
/** Construct once at the app root; start before mounting account-bound watchers. */
export function createMobileDataRuntime(options: MobileDataRuntimeOptions) {
  const bridge = options.nativeBridge ?? loadLegacyBridge();
  const preferences = new PreferenceStore(nativePreferenceStorage(bridge));
  let database: Database | null = null, repositories: MobileRepositories | null = null, cache: ArticleFileCache | null = null;
  let adminCache: ArticleFileCache | null = null;
  let accountLease: AccountDatabaseLease | null = null;
  let accountPreferences: PreferenceStore | null = null;
  let nativeResourceOwner: string | null = null;
  let backgroundCache: BackgroundArticleCache | null = null;
  let accountGeneration = 0, stopping = false;
  let startPromise: Promise<void> | null = null, hasLease = false;
  let storageReady: Promise<void> | null = null, environmentReady: Promise<void> | null = null;
  let upgradeState: UpgradeState = {status: 'idle'};
  const listeners = new Set<(state: UpgradeState) => void>();
  const emit = (state: UpgradeState) => { upgradeState = state; listeners.forEach(listener => listener(state)); };
  let connecting: Promise<void> | undefined, connectionRequested = false;
  let syncRetry: ReturnType<typeof setTimeout> | undefined, syncFailures = 0;
  const clearSyncRetry = () => {if (syncRetry !== undefined) clearTimeout(syncRetry); syncRetry = undefined;};
  const connectAccount = (opened: Database, generation: number): Promise<void> => {
    if (connecting) return connecting;
    const current = () => !connectionRequested && !stopping && activity.isForeground() && generation === accountGeneration && database === opened && !!accountLease;
    const attempt = readiness.ensure().then(async () => {
      if (!current()) return;
      const credentials = await connector.prepareConnection();
      if (credentials && current()) {
        clearSyncRetry(); syncFailures = 0; connectionRequested = true;
        void opened.connect(connector, {params: SYNC_PARAMETERS}).catch(() => {if (generation === accountGeneration) connectionRequested = false;});
      }
    }).catch(() => {
      if (current() && readiness.getSnapshot().status === 'ready') {
        clearSyncRetry();
        syncRetry = setTimeout(() => {syncRetry = undefined; void connectAccount(opened, generation);}, Math.min(300000, 5000 * 2 ** Math.min(syncFailures++, 6)));
      }
    }).finally(() => {if (connecting === attempt) connecting = undefined;});
    connecting = attempt; return attempt;
  };
  const activity = new RuntimeActivity({
    begin: bridge.beginStorageTransition ? () => bridge.beginStorageTransition!() : undefined,
    check: bridge.checkStorageTransition ? token => bridge.checkStorageTransition!(token) : undefined,
    end: bridge.endStorageTransition ? token => bridge.endStorageTransition!(token) : undefined,
    async pause() {
      readiness.pause(); connector.pause(); connectionRequested = false; clearSyncRetry();
      const worker = backgroundCache, lease = accountLease;
      await Promise.all([worker?.pause(), database?.disconnect(), lease?.drainWrites()]);
    },
    async resume() {
      if (stopping) return;
      connector.resume();
      backgroundCache?.resume();
      void environmentReady?.then(() => readiness.resume()).then(() => {
        if (!stopping && activity.isForeground() && database && accountLease) void connectAccount(database, accountGeneration);
      }).catch(() => undefined);
    },
  });
  const revokeAccountScope = () => {
    accountGeneration++; connecting = undefined; connectionRequested = false; connector.invalidate(); clearSyncRetry(); syncFailures = 0;
    const previousBackground = backgroundCache; backgroundCache = null; previousBackground?.cancel();
    accountLease?.invalidate(); accountLease = null; accountPreferences = null; nativeResourceOwner = null; repositories = null; cache = null;
    return previousBackground;
  };
  let retiredBackground: Promise<void> = Promise.resolve();
  const sessions = new SessionController(preferences, {
    revoke() {
      readiness.reset();
      const previous = revokeAccountScope();
      retiredBackground = Promise.all([retiredBackground, previous?.stop()]).then(() => undefined);
    },
    rejected() {
      readiness.reject(); connector.pause(); connectionRequested = false; clearSyncRetry();
      void database?.disconnect().catch(() => undefined);
    },
    accepted() {
      readiness.reset(); connector.invalidate(); connector.resume(); connecting = undefined; connectionRequested = false;
      const opened = database, generation = accountGeneration;
      if (activity.isForeground()) void Promise.all([readiness.resume(), opened?.disconnect()]).then(() => {
        if (!stopping && activity.isForeground() && opened && database === opened && generation === accountGeneration && accountLease) void connectAccount(opened, generation);
      }).catch(() => undefined);
      emit({...upgradeState});
    },
    async leave(_userId, clear) {
      readiness.reset();
      const previousBackground = revokeAccountScope(); await Promise.all([retiredBackground, previousBackground?.stop()]);
      await storageReady;
      if (stopping || !database) throw new AccountInactiveError();
      const opened = database;
      await activity.whileActive(async () => {
        if (clear) await clearAccountData(opened, adminCache, preferences, revokeReaderResources);
        else {await revokeReaderResources(); await opened.disconnect();}
      });
    },
    async enter(session) {
      await storageReady;
      if (stopping) throw new AccountInactiveError();
      if (!database || !adminCache) throw new Error('Application database is not ready');
      const opened = database, directory = adminCache.dataDirectory;
      const previousBackground = revokeAccountScope(); await previousBackground?.stop();
      if (stopping || database !== opened) throw new AccountInactiveError();
      const generation = accountGeneration;
      const owner = bridge.newIdentifier();
      await activateReaderResources(owner);
      if (stopping || generation !== accountGeneration || database !== opened) throw new AccountInactiveError();
      const lease = new AccountDatabaseLease(opened, work => activity.whileActive(work));
      accountLease = lease;
      nativeResourceOwner = owner;
      accountPreferences = preferences.scoped(() => lease.assertActive());
      repositories = new MobileRepositories(lease, () => bridge.newIdentifier());
      const origin = api.options.baseUrl;
      const pdfAccountGuard = () => {lease.assertActive(); if (api.options.baseUrl !== origin) throw new AccountInactiveError();};
      const pdfGuard = () => {pdfAccountGuard(); if (!activity.isForeground()) throw new AccountInactiveError();};
      const pdfStorage = new PdfFileStorage(directory, pdfAccountGuard);
      const pdf = new PdfBlockCache(pdfStorage, JSON.stringify([origin, session.userId]), pdfGuard, pdfAccountGuard);
      cache = new ArticleFileCache(directory, value => bridge.md5String(value), () => lease.assertActive(), {
        bytes: key => pdf.bytes(key), remove: async (key, check) => {lease.assertActive(); await backgroundCache?.forgetPdf(key); pdfGuard(); check?.(); await pdf.remove(key, check);}, clear: () => pdfStorage.clearScope(JSON.stringify([origin, session.userId])),
      });
      backgroundCache = new BackgroundArticleCache({database: lease, preferences: accountPreferences, cache,
        assertActive: () => lease.assertActive(),
        content: (id, owner, signal) => owner ? api.getCollectionBookmarkRawContent(id, owner, signal) : api.getBookmarkRawContent(id, signal),
        image: (url, signal) => fetchCacheImage(options.fetch ?? expoFetch, url, signal),
        pdf: {cache: pdf, metadata: (id, signal) => api.getPdfMetadata(id, signal), range: (id, documentId, begin, end, signal, expectedSize) => api.getPdfRange(id, documentId, begin, end, signal, expectedSize)},
      });
      if (activity.isForeground()) backgroundCache.start(); else await backgroundCache.pause();
      void api.sendMetrics('heartbeat').catch(() => undefined);
      connector.resume(); connectAccount(opened, generation);
    },
  });
  const api = createMobileApi({...options, fetch: options.fetch ?? expoFetch, sessions});
  const connector = createSyncConnector(api, preferences, sessions, options.localSyncEndpoint);
  const readiness = new CredentialReadiness({
    read: () => sessions.getSession(),
    async refresh(signal) {
      const origin = api.options.baseUrl, scope = sessions.captureRequestScope(), prior = await scope.getSession();
      try {await sessions.refreshIfNeeded(api.refresh, signal, () => {if (api.options.baseUrl !== origin) throw new AccountInactiveError();});}
      catch (error) {
        if (prior && error && typeof error === 'object' && 'status' in error && error.status === 401 && api.options.baseUrl === origin) await sessions.rejectIfMatches(prior.token, scope);
        throw error;
      }
    },
    changed() {
      connector.invalidate(); connectionRequested = false;
      const opened = database, generation = accountGeneration;
      if (opened && accountLease && !stopping && activity.isForeground()) void opened.disconnect().then(() => connectAccount(opened, generation)).catch(() => undefined);
    },
  });
  sessions.setRequestPreparation(async () => {
    if (!environmentReady) throw new AccountInactiveError();
    await environmentReady;
    if (stopping) throw new AccountInactiveError();
    await readiness.ensure();
  });
  async function start() {
    if (startPromise) return startPromise;
    stopping = false; emit({status: 'checking'});
    environmentReady = (async () => {
      await migrateLegacyPreferences(preferences, bridge);
      if (stopping) throw new AccountInactiveError();
      if ((await preferences.read())[K.environment] === 'BETA') {
        if (!options.betaBaseUrl) throw new Error('The selected beta environment requires its configured API origin');
        api.setBaseUrl(options.betaBaseUrl);
      } else api.setBaseUrl(options.baseUrl);
      if (stopping) throw new AccountInactiveError();
      await sessions.restoreLocal();
    })();
    void environmentReady.then(() => {
      if (!stopping && activity.isForeground()) return readiness.resume();
    }).catch(() => undefined);
    storageReady = (async () => {
      await environmentReady;
      if (stopping) throw new AccountInactiveError();
      const inventory = await bridge.beginDataOwnership(); hasLease = true;
      if (stopping) throw new AccountInactiveError();
      const evidence = options.adoptionEvidence ?? deriveReviewedAdoptionEvidence(inventory, options.platform);
      const adminPdf = new PdfFileStorage(inventory.legacyDataDirectory);
      adminCache = new ArticleFileCache(inventory.legacyDataDirectory, value => bridge.md5String(value), undefined, {bytes: async () => 0, remove: async () => {}, clear: () => adminPdf.clear()});
      const {PowerSyncDatabase} = await import('@powersync/react-native');
      const schema = await createMobileSchema();
      database = await openVerifiedDatabase({inventory, evidence, inspector: bridge, preferences, open: location => activity.whileActive(async () => {
        const opened = new PowerSyncDatabase({schema, database: {dbFilename: location.dbFilename, dbLocation: location.dbLocation}});
        try {await opened.init(); return opened;} catch (error) {await opened.close(); throw error;}
      })});
      if (stopping) throw new AccountInactiveError();
    })();
    startPromise = (async () => {
      try {
        await storageReady;
        await sessions.restore();
        if (stopping) throw new AccountInactiveError();
        emit({status: 'ready'});
        if (activity.isForeground()) void readiness.resume().then(() => {
          if (!stopping && activity.isForeground() && database && accountLease) void connectAccount(database, accountGeneration);
        }).catch(() => undefined);
      } catch (reason) {
        const error = reason instanceof Error ? reason : new Error('Application data initialization failed');
        readiness.pause(); connector.pause();
        const previousBackground = revokeAccountScope(); await previousBackground?.stop(); adminCache = null;
        if (!stopping) emit(error instanceof UpgradeVerificationRequired ? {status: 'verification-required', inventory: error.inventory} : {status: 'error', error});
        if (database) {await database.close(); database = null;}
        if (hasLease) {await bridge.endDataOwnership(); hasLease = false;}
        throw error;
      }
    })();
    return startPromise;
  }
  async function stop() {
    stopping = true; sessions.releaseLocalOwner(); readiness.pause(); connector.pause();
    const previousBackground = revokeAccountScope(); await previousBackground?.stop();
    if (startPromise) await startPromise.catch(() => undefined);
    const lateBackground = revokeAccountScope(); await lateBackground?.stop(); adminCache = null;
    await activity.whileActive(async () => {
      if (database) { await revokeReaderResources(); await database.close(); database = null; }
    });
    if (hasLease) { await bridge.endDataOwnership(); hasLease = false; }
    sessions.releaseLocalOwner(); startPromise = null; storageReady = null; environmentReady = null; emit({status: 'idle'});
  }
  return {
    preferences, sessions, api, start, stop,
    credentials: readiness as CredentialReadiness | undefined,
    setForeground: (foreground: boolean) => activity.setForeground(foreground),
    getAccountPreferences: () => accountPreferences,
    getNativeResourceOwner: () => nativeResourceOwner,
    beginArticleAccess: (key: string) => backgroundCache?.beginForeground(key) ?? (() => {}),
    getPdfMetadata: (bookmarkId: string, ownerId?: string, signal?: AbortSignal) => backgroundCache ? backgroundCache.getPdfMetadata(bookmarkId, ownerId, signal) : Promise.reject(new AccountInactiveError()),
    readPdfRange: (bookmarkId: string, descriptor: PdfDescriptor, begin: number, end: number, ownerId?: string, signal?: AbortSignal) => backgroundCache ? backgroundCache.readPdfRange(bookmarkId, descriptor, begin, end, ownerId, signal) : Promise.reject(new AccountInactiveError()),
    cachePdf: (bookmarkId: string, ownerId?: string) => backgroundCache ? backgroundCache.cachePdf(bookmarkId, ownerId) : Promise.reject(new AccountInactiveError()),
    pdfCacheStatus: (bookmarkId: string, ownerId?: string) => backgroundCache ? backgroundCache.pdfCacheStatus(bookmarkId, ownerId) : Promise.reject(new AccountInactiveError()),
    getDatabase: () => database,
    getRepositories: () => repositories,
    getCache: () => cache,
    getUpgradeSnapshot: () => upgradeState,
    subscribeUpgrade: (listener: (state: UpgradeState) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type MobileDataRuntime = Omit<ReturnType<typeof createMobileDataRuntime>, 'credentials'> & {credentials?: CredentialReadiness};
