import {createAvatarCache} from './native-avatar-cache.ts';
import type {AvatarCache} from './avatar-cache.ts';
import type {PowerSyncDatabase as Database} from '@powersync/react-native';
import {fetch as expoFetch} from 'expo/fetch';
import { SessionController } from '../domain/session.ts';
import {CredentialReadiness, ReauthenticationRequiredError, CredentialsUnavailableError} from '../domain/credential-readiness.ts';
import { createConsoleLogger, LogLevels } from '@powersync/common';
import { createMobileApi } from './api.ts';
import { noopErrorLog, type MobileErrorLog } from '../domain/error-log.ts';
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
import { migrateLegacyPreferences } from './legacy-preferences.ts';
import { loadLegacyBridge, nativePreferenceStorage } from './native-storage.ts';
import type { SlaxLegacyBridge } from './native-storage.ts';
import { PreferenceStore, PREFERENCE_KEYS as K } from './preferences.ts';
import { MobileRepositories } from './repositories.ts';
import { createMobileSchema, SYNC_PARAMETERS } from './schema.ts';
import {createAccountDiagnostics} from '../diagnostics/exchanges.ts';
import {noDiagnostics, recordDiagnostic} from '../domain/diagnostics.ts';
import type {MobileDiagnostics} from '../diagnostics/native.ts';

export type UpgradeState = {status: 'idle' | 'checking' | 'ready'} | {status: 'error'; error: Error};
export interface MobileDataRuntimeOptions extends Omit<MobileApiOptions, 'sessions'> { errorLog?: (deps: {preferences: PreferenceStore; sessions: SessionController; api: ReturnType<typeof createMobileApi>; generateIdentifier: () => string}) => MobileErrorLog; diagnostics?: MobileDiagnostics; betaBaseUrl?: string; nativeBridge?: SlaxLegacyBridge; localSyncEndpoint?: string; network?: NetworkAvailabilitySource; freshStorage?: boolean; offlineEngine?: OfflineEngine; readerHosts?: {protectedHosts: string[]; imageProxyOrigins: string[]} }
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
  let errorLog: MobileErrorLog = noopErrorLog;
  let syncConnectedAt: number | undefined, connectStartedAt: number | undefined, everConnected = false;
  let downloadingSince: number | undefined, lastSyncedAt: Date | undefined, apiFailures = 0;
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
        clearSyncRetry(); connectionRequested = true; connectStartedAt = Date.now();
        void opened.connect(connector, {params: SYNC_PARAMETERS}).catch(error => {
          if (generation !== accountGeneration) return;
          connectionRequested = false; syncFailures += 1;
          const info = captureSyncFailure('app.connect', error, 'connect');
          emitPhase(info.phase, 'failure', {...(info.fingerprint ? {fingerprint: info.fingerprint} : {}), ...(info.ray ? {ray: info.ray} : {})});
          noteSyncFailure(opened, generation);
        });
      }
    }).catch(error => {
      if (current() && readiness.getSnapshot().status === 'ready') {
        syncFailures += 1;
        const info = captureSyncFailure('app.credentials', error, 'token');
        emitPhase('token', 'failure', {...(info.fingerprint ? {fingerprint: info.fingerprint} : {}), ...(info.ray ? {ray: info.ray} : {})});
        noteSyncFailure(opened, generation);
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
      if (offline) {offline.resume(); scheduleWarmup(offline, accountGeneration);}
      void environmentReady?.then(() => readiness.resume()).then(() => {
        if (!stopping && activity.isForeground() && database && accountLease) void connectAccount(database, accountGeneration);
      }).catch(() => undefined);
    },
  });
  const revokeAccountScope = () => {
    const wasPresented = libraryPresented; libraryPresented = false; pendingWarmup = undefined;
    if (wasPresented) notifyPresentation();
    accountGeneration++; cancelWarmup?.(); cancelWarmup = undefined; connecting = undefined; connectionRequested = false; connector.invalidate(); clearSyncRetry(); syncFailures = 0; everConnected = false; downloadingSince = undefined;
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
  }, undefined, {diagnostics: options.diagnostics?.sink});
  const diagnosticExchanges = createAccountDiagnostics(options.diagnostics?.sink ?? noDiagnostics, () => sessions.captureRequestScope().assertCurrent);
  const api = createMobileApi({...options, fetch: options.fetch ?? expoFetch, sessions,
    getDeviceId: () => preferences.deviceId(() => bridge.newIdentifier()),
    onFailure: failure => {
      try {
        if (failure.status !== undefined && failure.status < 500) return;
        if (failure.path === '/v1/sync/token' || failure.path === '/v1/sync/changes') return;
        apiFailures += 1;
        const message = failure.status !== undefined ? `${failure.method.toUpperCase()} ${failure.path} failed (${failure.status})` : `${failure.method.toUpperCase()} ${failure.path} network failure`;
        errorLog.capture('network', Object.assign(new Error(message), {name: 'ApiRequestError'}), {source: 'api', phase: 'request', consecutive_failures: apiFailures, method: failure.method, path: failure.path, ...(failure.status !== undefined ? {status: failure.status} : {}), ...(failure.ray ? {ray: failure.ray} : {})});
      } catch {}
    },
    onSuccess: () => {apiFailures = 0;},
    onFailedExchange: diagnosticExchanges.failed, onAccountSuccess: diagnosticExchanges.succeeded});
  const baseErrorLog = options.errorLog?.({preferences, sessions, api, generateIdentifier: () => bridge.newIdentifier()}) ?? noopErrorLog;
  errorLog = {
    capture: (kind, error, properties = {}) => {
      try {
        // Failure counts and connection age describe the PowerSync family; API records count separately.
        return baseErrorLog.capture(kind, error, {
          online: network.getSnapshot() !== 'offline',
          foreground: activity.isForeground(),
          ...(kind === 'powersync' ? {consecutive_failures: syncFailures, ...(syncConnectedAt !== undefined ? {connection_ms: Math.max(0, Date.now() - syncConnectedAt)} : {})} : {}),
          ...properties
        });
      } catch {
        return undefined;
      }
    },
    flush: hiding => baseErrorLog.flush(hiding)
  };
  const observationId = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  // Observations belong to the signed-in account that produced them; a retired account sends nothing.
  const sendSyncEvent = (event_name: 'powersync_phase' | 'powersync_connection_lost', properties: Record<string, string | number | boolean>) => {
    try {
      if (stopping || !accountLease || sessions.getSnapshot().status !== 'authenticated') return;
      const generation = accountGeneration;
      void preferences.deviceId(() => bridge.newIdentifier()).then(deviceId => {
        if (generation !== accountGeneration || stopping) return;
        return api.sendClientEvents(deviceId, [{event_name, occurred_at: new Date().toISOString(), properties: {observation_id: observationId, ...properties}}]);
      }).catch(() => undefined);
    } catch {}
  };
  const emitPhase = (phase: 'token' | 'connect' | 'stream' | 'upload', outcome: 'success' | 'failure', properties: Record<string, string | number | boolean> = {}) => sendSyncEvent('powersync_phase', {phase, outcome, ...properties});
  const captureSyncFailure = (source: string, error: unknown, phase: 'token' | 'connect' | 'stream' | 'upload', stage?: string) => {
    const phaseProperty = typeof error === 'object' && error !== null && (error as {phase?: unknown}).phase === 'token' ? 'token' : phase;
    const ray = typeof error === 'object' && error !== null && typeof (error as {ray?: unknown}).ray === 'string' ? (error as {ray: string}).ray : undefined;
    const fingerprint = errorLog.capture('powersync', error ?? {name: 'PowerSyncError', message: source}, {source, phase: phaseProperty, ...(stage ? {stage} : {}), ...(ray ? {ray} : {})});
    return {fingerprint, ray, phase: phaseProperty};
  };
  const noteSyncFailure = (opened: Database, generation: number) => {
    if (stopping || network.getSnapshot() === 'offline') return;
    // syncFailures already counts the failure being retried: 5 s, 10 s, 20 s ... capped at 2 min.
    const delay = Math.min(120000, 5000 * 2 ** Math.min(Math.max(0, syncFailures - 1), 5));
    clearSyncRetry();
    syncRetry = setTimeout(() => {syncRetry = undefined; void connectAccount(opened, generation);}, delay);
  };
  // The SDK logs one stream failure twice ("Could not POST streaming…", then "Sync error") within
  // milliseconds and then retries on its own fixed delay; the window counts that failure once.
  const SDK_DUPLICATE_WINDOW_MS = 1000;
  const stopForStreamFailure = () => {
    const opened = database, generation = accountGeneration;
    if (!opened || stopping) return;
    connectionRequested = false; syncConnectedAt = undefined;
    void opened.disconnect().catch(() => undefined);
    noteSyncFailure(opened, generation);
  };
  const createSyncLogger = () => {
    const consoleLogger = createConsoleLogger();
    let windowKey = '', windowStart = 0;
    return {
      log(record: {level: number; message: string; error?: unknown}) {
        consoleLogger.log(record as never);
        // The SDK calls this from its sync loop without a guard, so nothing here may throw.
        try {
          if (record.level < LogLevels.error) return;
          const streamFailure = record.message === 'Sync error' || record.message.startsWith('Could not POST streaming');
          const captured = record.error ?? {name: 'PowerSyncLog', message: record.message};
          // Both stream-failure messages of one episode share a key, so the episode is counted once.
          const key = streamFailure ? 'stream' : captured instanceof Error ? `${captured.name}:${captured.message}` : record.message;
          const now = Date.now();
          if (key === windowKey && now - windowStart < SDK_DUPLICATE_WINDOW_MS) return;
          windowKey = key; windowStart = now;
          // Other error logs (watch, checkpoint, upload loop) have no phase and do not drive the backoff.
          if (!streamFailure) {errorLog.capture('powersync', captured, {source: 'sdk.logger'}); return;}
          syncFailures += 1;
          const info = captureSyncFailure('sdk.logger', captured, 'stream');
          emitPhase(info.phase, 'failure', {...(info.fingerprint ? {fingerprint: info.fingerprint} : {}), ...(info.ray ? {ray: info.ray} : {})});
          stopForStreamFailure();
        } catch {}
      }
    };
  };
  const connector = createSyncConnector(api, preferences, sessions, options.localSyncEndpoint, Date.now, {
    credentials: (source, durationMs) => emitPhase('token', 'success', {credential_source: source, duration_ms: durationMs}),
    submitted: (batchSize, durationMs) => emitPhase('upload', 'success', {step: 'submit', batch_size: batchSize, duration_ms: durationMs}),
    acknowledged: (batchSize, durationMs) => emitPhase('upload', 'success', {step: 'acknowledge', batch_size: batchSize, duration_ms: durationMs}),
  });
  // Wrap the upload to record a rejected submission; a connector without uploads (test doubles) is left as is.
  const uploadData = typeof connector.uploadData === 'function' ? connector.uploadData.bind(connector) : undefined;
  if (uploadData) connector.uploadData = async database => {
    try {
      await uploadData(database);
    } catch (error) {
      const info = captureSyncFailure('connector.upload', error, 'upload');
      emitPhase('upload', 'failure', {step: 'submit', ...(info.fingerprint ? {fingerprint: info.fingerprint} : {}), ...(info.ray ? {ray: info.ray} : {})});
      throw error;
    }
  };
  const readiness = new CredentialReadiness({
    read: () => sessions.getSession(),
    async refresh(signal) {
      const origin = api.options.baseUrl, scope = sessions.captureRequestScope(), prior = await scope.getSession();
      try {await sessions.refreshIfNeeded(api.refresh, signal, () => {if (api.options.baseUrl !== origin) throw new AccountInactiveError();});}
      catch (error) {
        if (prior && error && typeof error === 'object' && 'status' in error && error.status === 401 && api.options.baseUrl === origin) await sessions.rejectIfMatches(prior.token, scope, api.getFailedExchange(error)?.http);
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
    const location = (async () => {
      const inventory = await (options.freshStorage && bridge.beginFreshDataOwnership ? bridge.beginFreshDataOwnership() : bridge.beginDataOwnership());
      hasLease = true;
      if (stopping) throw new AccountInactiveError();
      return inventory;
    })();
    environmentReady = sessions.restoreLocal(async () => {
      const inventory = await location;
      const snapshot = await preferences.read();
      if (stopping) throw new AccountInactiveError();
      const migration = await migrateLegacyPreferences(preferences, bridge, snapshot, inventory.legacyReset === true);
      if (stopping) throw new AccountInactiveError();
      if (inventory.legacyReset) await bridge.finishLegacyReset();
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
      const inventory = await location;
      if (stopping) throw new AccountInactiveError();
      adminCache = new ArticleFileCache(inventory.legacyDataDirectory, value => bridge.md5String(value));
      const [{PowerSyncDatabase}, schema] = await sdkReady;
      if (stopping) throw new AccountInactiveError();
      database = await activity.whileActive(async () => {
        const opened = new PowerSyncDatabase({schema, database: {dbFilename: 'powersync.db', dbLocation: inventory.newDatabaseDirectory}, logger: createSyncLogger()});
        try {await opened.init();} catch (error) {await opened.close(); throw error;}
        // Connection status only drives backoff resets and uptime; a missing listener must not fail startup.
        try {
          opened.registerListener?.({statusChanged: status => {
            if (status.connected) {
              if (syncConnectedAt === undefined) {
                syncConnectedAt = Date.now();
                emitPhase('connect', 'success', {connection_kind: everConnected ? 'reconnect' : 'initial', ...(connectStartedAt !== undefined ? {duration_ms: Math.max(0, syncConnectedAt - connectStartedAt)} : {})});
                connectStartedAt = undefined; everConnected = true;
              }
              if (status.downloading && downloadingSince === undefined) downloadingSince = Date.now();
              if (!status.downloading && downloadingSince !== undefined && status.lastSyncedAt && status.lastSyncedAt !== lastSyncedAt) {
                emitPhase('stream', 'success', {duration_ms: Math.max(0, Date.now() - downloadingSince)});
                downloadingSince = undefined; lastSyncedAt = status.lastSyncedAt;
              }
              syncFailures = 0; clearSyncRetry();
            } else if (syncConnectedAt !== undefined && !status.connecting) {
              syncConnectedAt = undefined;
              if (connectionRequested && !stopping && network.getSnapshot() !== 'offline' && activity.isForeground()) sendSyncEvent('powersync_connection_lost', {reason: 'stream_lost'});
            }
          }});
        } catch {}
        return opened;
      });
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
        const info = captureSyncFailure('app.init', error, 'connect', 'init');
        emitPhase('connect', 'failure', {...(info.fingerprint ? {fingerprint: info.fingerprint} : {}), ...(info.ray ? {ray: info.ray} : {})});
        if (__DEV__) console.error('[mobile] data initialization failed', error);
        network.stop(); readiness.pause(); connector.pause();
        const previousBackground = revokeAccountScope(); await previousBackground?.close(); adminCache = null;
        if (!stopping) emit({status: 'error', error});
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
  recordDiagnostic(options.diagnostics?.sink, 'app.launch', {});
  return {
    errorLog, preferences, sessions, api, start, stop,
    diagnostics: options.diagnostics,
    credentials: readiness as CredentialReadiness | undefined,
    setForeground: (foreground: boolean) => {
      // Queued error records may not survive suspension, so they are delivered as the app backgrounds.
      if (!foreground) void errorLog.flush(true).catch(() => undefined);
      return activity.setForeground(foreground);
    },
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
export type MobileDataRuntime = Omit<ReturnType<typeof createMobileDataRuntime>, 'credentials' | 'diagnostics'> & {credentials?: CredentialReadiness; diagnostics?: MobileDiagnostics};
