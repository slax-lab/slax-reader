import {createAvatarCache} from './native-avatar-cache.ts';
import type {AvatarCache} from './avatar-cache.ts';
import type {PowerSyncDatabase as Database} from '@powersync/react-native';
import {fetch as expoFetch} from 'expo/fetch';
import { SessionController } from '../domain/session.ts';
import {CredentialReadiness, ReauthenticationRequiredError, CredentialsUnavailableError} from '../domain/credential-readiness.ts';
import { createMobileApi } from './api.ts';
import type { MobileApiOptions } from './api.ts';
import { ArticleFileCache } from './cache.ts';
import { clearAccountData } from './account-cleanup.ts';
import { AccountDatabaseLease, AccountInactiveError } from './account-lease.ts';
import {OfflineCoordinator, type OfflineCredentialSource} from './offline-coordinator.ts';
import {loadOfflineEngine} from './native-offline-engine.ts';
import type {OfflineEngine} from './offline-engine.ts';
import {RuntimeActivity} from './runtime-activity.ts';
import {NetworkAvailability, type NetworkAvailabilitySource} from './network-availability.ts';
import {nativeNetwork} from './native-network.ts';
import {loadReaderImage} from '../native/reader-image';
import { activateReaderResources, revokeReaderResources } from '../native/platform';
import { createSyncConnector } from './connector.ts';
import { openVerifiedDatabase } from './adoption.ts';
import { deriveReviewedAdoptionEvidence } from './adoption-profile.ts';
import { migrateLegacyPreferences } from './legacy-preferences.ts';
import { loadLegacyBridge, nativePreferenceStorage } from './native-storage.ts';
import type { SlaxLegacyBridge } from './native-storage.ts';
import { PreferenceStore, PREFERENCE_KEYS as K } from './preferences.ts';
import { MobileRepositories } from './repositories.ts';
import { createMobileSchema, LEGACY_MOBILE_TABLES, SYNC_PARAMETERS } from './schema.ts';
import { UpgradeVerificationRequired } from './upgrade.ts';
import type { AdoptionEvidence, LegacyInventory } from './upgrade.ts';

export type UpgradeState = {status: 'idle' | 'checking' | 'ready'} | {status: 'verification-required'; inventory: LegacyInventory} | {status: 'error'; error: Error};
export interface MobileDataRuntimeOptions extends Omit<MobileApiOptions, 'sessions'> { betaBaseUrl?: string; nativeBridge?: SlaxLegacyBridge; adoptionEvidence?: AdoptionEvidence; localSyncEndpoint?: string; network?: NetworkAvailabilitySource; freshStorage?: boolean; offlineEngine?: OfflineEngine; readerHosts?: {protectedHosts: string[]; imageProxyOrigins: string[]} }
/** Construct once at the app root; start before mounting account-bound watchers. */
export function createMobileDataRuntime(options: MobileDataRuntimeOptions) {
  const bridge = options.nativeBridge ?? loadLegacyBridge();
  const preferences = new PreferenceStore(nativePreferenceStorage(bridge));
  let database: Database | null = null, repositories: MobileRepositories | null = null, cache: ArticleFileCache | null = null;
  let adminCache: ArticleFileCache | null = null;
  let accountLease: AccountDatabaseLease | null = null;
  let accountPreferences: PreferenceStore | null = null;
  let nativeResourceOwner: string | null = null;
  let offline: OfflineCoordinator | null = null;
  const engine = options.offlineEngine ?? loadOfflineEngine();
  const interactionBusy = new Set<string>();
  let avatars: AvatarCache | null = null;
  let libraryPresented = false;
  const presentationListeners = new Set<() => void>();
  const notifyPresentation = () => presentationListeners.forEach(listener => listener());
  let pendingWarmup: (() => void) | undefined;
  let cancelWarmup: (() => void) | undefined;
  const scheduleWarmup = (worker: OfflineCoordinator, generation: number) => {
    cancelWarmup?.();
    const run = () => {
      cancelWarmup = undefined;
      if (!stopping && generation === accountGeneration && offline === worker && activity.isForeground()) worker.start();
    };
    if (!libraryPresented) {pendingWarmup = run; cancelWarmup = () => {pendingWarmup = undefined;}; return;}
    const idle = globalThis as typeof globalThis & {requestIdleCallback?: (callback: () => void, options: {timeout: number}) => number; cancelIdleCallback?: (id: number) => void};
    if (typeof idle.requestIdleCallback === 'function' && typeof idle.cancelIdleCallback === 'function') {
      const id = idle.requestIdleCallback(run, {timeout: 1500});
      cancelWarmup = () => idle.cancelIdleCallback?.(id);
    } else {
      const id = setTimeout(run, 0); cancelWarmup = () => clearTimeout(id);
    }
  };
  let accountGeneration = 0, stopping = false;
  let startPromise: Promise<void> | null = null, hasLease = false;
  let storageReady: Promise<void> | null = null, environmentReady: Promise<void> | null = null;
  let upgradeState: UpgradeState = {status: 'idle'};
  const listeners = new Set<(state: UpgradeState) => void>();
  const emit = (state: UpgradeState) => { upgradeState = state; listeners.forEach(listener => listener(state)); };
  let connecting: Promise<void> | undefined, connectionRequested = false;
  let syncRetry: ReturnType<typeof setTimeout> | undefined, syncFailures = 0;
  const clearSyncRetry = () => {if (syncRetry !== undefined) clearTimeout(syncRetry); syncRetry = undefined;};
  const network = new NetworkAvailability(options.network ?? nativeNetwork, state => {
    if (__DEV__) console.log('[mobile] network state', state);
    if (stopping) return;
    if (state === 'offline') {
      if (__DEV__) console.log('[mobile] sync paused while offline');
      connector.pause(); connectionRequested = false; clearSyncRetry();
      void database?.disconnect().catch(() => undefined);
    }
    offline?.setOnline(state !== 'offline');
    if (state === 'online' && activity.isForeground() && database && accountLease) {
      connector.resume();
      void connectAccount(database, accountGeneration);
    }
  });
  const connectAccount = (opened: Database, generation: number): Promise<void> => {
    if (!libraryPresented || network.getSnapshot() === 'offline') return Promise.resolve();
    if (connecting) return connecting;
    const current = () => !connectionRequested && !stopping && activity.isForeground() && generation === accountGeneration && database === opened && !!accountLease && network.getSnapshot() !== 'offline';
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
      readiness.pause(); connector.pause(); connectionRequested = false; clearSyncRetry(); cancelWarmup?.(); cancelWarmup = undefined;
      const worker = offline, lease = accountLease;
      await Promise.all([worker?.suspend(), database?.disconnect(), lease?.drainWrites()]);
    },
    async resume() {
      if (stopping) return;
      connector.resume(); network.refresh();
      offline?.resume();
      void environmentReady?.then(() => readiness.resume()).then(() => {
        if (!stopping && activity.isForeground() && database && accountLease) void connectAccount(database, accountGeneration);
      }).catch(() => undefined);
    },
  });
  const revokeAccountScope = () => {
    const wasPresented = libraryPresented; libraryPresented = false; pendingWarmup = undefined;
    if (wasPresented) notifyPresentation();
    accountGeneration++; cancelWarmup?.(); cancelWarmup = undefined; connecting = undefined; connectionRequested = false; connector.invalidate(); clearSyncRetry(); syncFailures = 0;
    const previousBackground = offline; offline = null; previousBackground?.cancel();
    avatars?.dispose(); avatars = null;
    accountLease?.invalidate(); accountLease = null; accountPreferences = null; nativeResourceOwner = null; repositories = null; cache = null;
    return previousBackground;
  };
  let retiredBackground: Promise<void> = Promise.resolve();
  const sessions = new SessionController(preferences, {
    revoke() {
      readiness.reset();
      const previous = revokeAccountScope();
      retiredBackground = Promise.all([retiredBackground, previous?.close()]).then(() => undefined);
    },
    rejected() {
      readiness.reject(); connector.pause(); connectionRequested = false; clearSyncRetry();
      void database?.disconnect().catch(() => undefined);
    },
    failed(reason) {
      if (stopping) return;
      readiness.pause(); connector.pause();
      const previous = revokeAccountScope();
      retiredBackground = Promise.all([retiredBackground, previous?.close(), database?.disconnect()]).then(() => undefined).catch(() => undefined);
      emit({status: 'error', error: reason instanceof Error ? reason : new Error('Application data initialization failed')});
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
      const previousBackground = revokeAccountScope(); await Promise.all([retiredBackground, previousBackground?.close()]);
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
      const previousBackground = revokeAccountScope(); await previousBackground?.close();
      if (stopping || database !== opened) throw new AccountInactiveError();
      const generation = accountGeneration;
      const owner = bridge.newIdentifier();
      await activateReaderResources(owner);
      if (stopping || generation !== accountGeneration || database !== opened) throw new AccountInactiveError();
      const lease = new AccountDatabaseLease(opened, work => activity.whileActive(work));
      accountLease = lease;
      nativeResourceOwner = owner;
      accountPreferences = preferences.scoped(() => lease.assertActive());
      repositories = new MobileRepositories(lease, () => bridge.newIdentifier(), undefined, (id, signal) => api.getRemoteBookmark(id, signal));
      const origin = api.options.baseUrl, cacheScope = JSON.stringify([origin, session.userId]);
      const accountGuard = () => {lease.assertActive(); if (api.options.baseUrl !== origin) throw new AccountInactiveError();};
      const credentials: OfflineCredentialSource = {
        current() {
          const state = sessions.getSnapshot();
          if (readiness.getSnapshot().status !== 'ready' || state.status !== 'authenticated' || state.session.userId !== session.userId || api.options.baseUrl !== origin) return null;
          const token = state.session.token, scope = sessions.captureRequestScope();
          return {token, reject: () => sessions.rejectIfMatches(token, scope)};
        },
        subscribe(listener) {
          const stopReadiness = readiness.subscribe(listener), stopSession = sessions.subscribe(listener);
          return () => {stopReadiness(); stopSession();};
        },
      };
      const worker = new OfflineCoordinator({engine, database: lease, preferences: accountPreferences, credentials, identifier: () => bridge.newIdentifier(), online: network.getSnapshot() !== 'offline',
        scope: {owner, scope: cacheScope, origin, directory, userAgent: `SlaxReader/${options.platform} ${options.version}`, clientType: options.platform, clientVersion: options.version, ...options.readerHosts},
        assertActive: accountGuard,
        assertCachedAccess: () => {
          if (!activity.isForeground()) throw new AccountInactiveError();
          const state = readiness.getSnapshot().status;
          if (state === 'reauthentication-required') throw new ReauthenticationRequiredError();
          if (state === 'paused') throw new CredentialsUnavailableError();
        },
      });
      offline = worker; interactionBusy.forEach(source => worker.setInteractionBusy(true, source));
      cache = new ArticleFileCache(directory, value => bridge.md5String(value), () => lease.assertActive(), worker, owner, loadReaderImage);
      avatars = createAvatarCache(directory, owner, cacheScope, accountGuard, value => bridge.md5String(value), options.fetch ?? expoFetch);
      cache.setAvatarCache(avatars);
      void worker.open(false).catch(error => {if (__DEV__) console.warn('[mobile] offline engine unavailable', error instanceof Error ? error.name : 'unknown');});
      if (activity.isForeground()) scheduleWarmup(worker, generation); else await worker.suspend();
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
    stopping = false; network.start(); emit({status: 'checking'});
    const sdkReady = Promise.all([import('@powersync/react-native'), createMobileSchema()]);
    sdkReady.catch(() => undefined);
    environmentReady = sessions.restoreLocal(async () => {
      const snapshot = await preferences.read();
      if (stopping) throw new AccountInactiveError();
      const migration = await migrateLegacyPreferences(preferences, bridge, snapshot);
      if (stopping) throw new AccountInactiveError();
      const values = migration === 'already-migrated' ? snapshot : await preferences.read();
      if (stopping) throw new AccountInactiveError();
      if (values[K.environment] === 'BETA') {
        if (!options.betaBaseUrl) throw new Error('The selected beta environment requires its configured API origin');
        api.setBaseUrl(options.betaBaseUrl);
      } else api.setBaseUrl(options.baseUrl);
      return values;
    }).then(() => undefined);
    void environmentReady.then(() => {
      if (!stopping && activity.isForeground()) return readiness.resume();
    }).catch(() => undefined);
    storageReady = (async () => {
      await environmentReady;
      if (stopping) throw new AccountInactiveError();
      const inventory = await (options.freshStorage && bridge.beginFreshDataOwnership ? bridge.beginFreshDataOwnership() : bridge.beginDataOwnership()); hasLease = true;
      if (stopping) throw new AccountInactiveError();
      const evidence = options.freshStorage ? undefined : options.adoptionEvidence ?? deriveReviewedAdoptionEvidence(inventory, options.platform);
      adminCache = new ArticleFileCache(inventory.legacyDataDirectory, value => bridge.md5String(value));
      const [{PowerSyncDatabase}, schema] = await sdkReady;
      if (stopping) throw new AccountInactiveError();
      let adoptedLegacySchema = false;
      database = await openVerifiedDatabase({inventory, evidence, inspector: bridge, preferences, fresh: options.freshStorage, open: (location, legacySchema) => activity.whileActive(async () => {
        adoptedLegacySchema = legacySchema === true;
        const opened = new PowerSyncDatabase({schema: legacySchema ? await createMobileSchema(LEGACY_MOBILE_TABLES) : schema, database: {dbFilename: location.dbFilename, dbLocation: location.dbLocation}});
        try {await opened.init(); return opened;} catch (error) {await opened.close(); throw error;}
      })});
      if (adoptedLegacySchema) await database.updateSchema(schema);
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
        if (__DEV__) console.error('[mobile] data initialization failed', error);
        network.stop(); readiness.pause(); connector.pause();
        const previousBackground = revokeAccountScope(); await previousBackground?.close(); adminCache = null;
        if (!stopping) emit(error instanceof UpgradeVerificationRequired ? {status: 'verification-required', inventory: error.inventory} : {status: 'error', error});
        if (database) {await database.close(); database = null;}
        if (hasLease) {await bridge.endDataOwnership(); hasLease = false;}
        throw error;
      }
    })();
    return startPromise;
  }
  async function stop() {
    stopping = true; network.stop(); sessions.releaseLocalOwner(); readiness.pause(); connector.pause();
    const previousBackground = revokeAccountScope(); await previousBackground?.close();
    if (startPromise) await startPromise.catch(() => undefined);
    const lateBackground = revokeAccountScope(); await lateBackground?.close(); adminCache = null;
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
    /** UI reports scroll/transition activity so offline status persistence waits; each source clears its own flag. */
    setInteractionBusy: (busy: boolean, source?: string) => {interactionBusy[busy ? 'add' : 'delete'](source ?? 'interaction'); offline?.setInteractionBusy(busy, source);},
    beginArticleAccess: (key: string) => offline?.beginForeground(key) ?? (() => {}),
    getArticleContent: (bookmarkId: string, ownerId?: string, signal?: AbortSignal, force?: boolean) => offline ? offline.getArticleContent(bookmarkId, ownerId, signal, force) : Promise.reject(new AccountInactiveError()),
    getPdfMetadata: (bookmarkId: string, ownerId?: string, signal?: AbortSignal) => offline ? offline.getPdfMetadata(bookmarkId, ownerId, signal) : Promise.reject(new AccountInactiveError()),
    cachePdf: (bookmarkId: string, ownerId?: string) => offline ? offline.cachePdf(bookmarkId, ownerId) : Promise.reject(new AccountInactiveError()),
    pdfCacheStatus: (bookmarkId: string, ownerId?: string) => offline ? offline.pdfCacheStatus(bookmarkId, ownerId) : Promise.reject(new AccountInactiveError()),
    markLibraryPresented() {
      if (libraryPresented || stopping || !accountLease || upgradeState.status !== 'ready') return;
      libraryPresented = true; notifyPresentation();
      const warmup = pendingWarmup; pendingWarmup = undefined;
      if (warmup && activity.isForeground()) warmup();
      if (database && activity.isForeground()) void connectAccount(database, accountGeneration);
    },
    isLibraryPresented: () => libraryPresented,
    subscribeLibraryPresented(listener: () => void) {presentationListeners.add(listener); return () => {presentationListeners.delete(listener);};},
    getDatabase: () => database,
    getRepositories: () => repositories,
    getCache: () => cache,
    getAvatarCache: () => avatars,
    getUpgradeSnapshot: () => upgradeState,
    subscribeUpgrade: (listener: (state: UpgradeState) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type MobileDataRuntime = Omit<ReturnType<typeof createMobileDataRuntime>, 'credentials'> & {credentials?: CredentialReadiness};
