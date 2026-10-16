import type {PowerSyncDatabase as Database} from '@powersync/react-native';
import {fetch as expoFetch} from 'expo/fetch';
import { SessionController } from '../domain/session.ts';
import { createMobileApi } from './api.ts';
import type { MobileApiOptions } from './api.ts';
import { ArticleFileCache } from './cache.ts';
import { clearAccountData } from './account-cleanup.ts';
import { AccountDatabaseLease, AccountInactiveError } from './account-lease.ts';
import {BackgroundArticleCache} from './background-cache.ts';
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
  let upgradeState: UpgradeState = {status: 'idle'};
  const listeners = new Set<(state: UpgradeState) => void>();
  const emit = (state: UpgradeState) => { upgradeState = state; listeners.forEach(listener => listener(state)); };
  const revokeAccountScope = () => {
    accountGeneration++;
    const previousBackground = backgroundCache; backgroundCache = null; previousBackground?.cancel();
    accountLease?.invalidate(); accountLease = null; accountPreferences = null; nativeResourceOwner = null; repositories = null; cache = null;
    return previousBackground;
  };
  const sessions = new SessionController(preferences, {
    async leave(_userId, clear) {
      const previousBackground = revokeAccountScope(); await previousBackground?.stop();
      if (!database) throw new Error('Application database is not ready');
      if (clear) await clearAccountData(database, adminCache, preferences, revokeReaderResources);
      else {await revokeReaderResources(); await database.disconnect();}
    },
    async enter() {
      if (stopping) throw new AccountInactiveError();
      if (!database || !adminCache) throw new Error('Application database is not ready');
      const opened = database, directory = adminCache.dataDirectory;
      const previousBackground = revokeAccountScope(); await previousBackground?.stop();
      if (stopping || database !== opened) throw new AccountInactiveError();
      const generation = accountGeneration;
      const owner = bridge.newIdentifier();
      await activateReaderResources(owner);
      if (stopping || generation !== accountGeneration || database !== opened) throw new AccountInactiveError();
      const lease = new AccountDatabaseLease(opened);
      accountLease = lease;
      nativeResourceOwner = owner;
      accountPreferences = preferences.scoped(() => lease.assertActive());
      repositories = new MobileRepositories(lease, () => bridge.newIdentifier());
      cache = new ArticleFileCache(directory, value => bridge.md5String(value), () => lease.assertActive());
      backgroundCache = new BackgroundArticleCache({database: lease, preferences: accountPreferences, cache,
        assertActive: () => lease.assertActive(),
        content: (id, owner, signal) => owner ? api.getCollectionBookmarkRawContent(id, owner, signal) : api.getBookmarkRawContent(id, signal),
        image: async (url, signal) => {
          const request = new AbortController(), abort = () => request.abort(signal.reason);
          signal.addEventListener('abort', abort, {once: true}); if (signal.aborted) abort();
          const timeout = setTimeout(() => request.abort(), 30_000);
          try {
            const response = await (options.fetch ?? expoFetch)(url, {signal: request.signal});
            if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/')) throw new Error('Automatic image cache request failed');
            return new Uint8Array(await response.arrayBuffer());
          } finally {clearTimeout(timeout); signal.removeEventListener('abort', abort);}
        },
      });
      backgroundCache.start();
      void api.sendMetrics('heartbeat').catch(() => undefined);
      // Local authenticated content renders while connection/credential refresh runs in the background.
      void opened.connect(connector, {params: SYNC_PARAMETERS}).catch(() => undefined);
    },
  });
  const api = createMobileApi({...options, fetch: options.fetch ?? expoFetch, sessions});
  const connector = createSyncConnector(api, preferences, sessions, options.localSyncEndpoint);
  async function start() {
    if (startPromise) return startPromise;
    stopping = false;
    startPromise = (async () => {
      emit({status: 'checking'});
      try {
        const inventory = await bridge.beginDataOwnership(); hasLease = true;
        const evidence = options.adoptionEvidence ?? deriveReviewedAdoptionEvidence(inventory, options.platform);
        await migrateLegacyPreferences(preferences, bridge);
        if ((await preferences.read())[K.environment] === 'BETA') {
          if (!options.betaBaseUrl) throw new Error('The selected beta environment requires its configured API origin');
          api.setBaseUrl(options.betaBaseUrl);
        } else api.setBaseUrl(options.baseUrl);
        adminCache = new ArticleFileCache(inventory.legacyDataDirectory, value => bridge.md5String(value));
        const {PowerSyncDatabase} = await import('@powersync/react-native');
        const schema = await createMobileSchema();
        database = await openVerifiedDatabase({inventory, evidence, inspector: bridge, preferences, open: async location => {
          const opened = new PowerSyncDatabase({schema, database: {dbFilename: location.dbFilename, dbLocation: location.dbLocation}});
          try {await opened.init(); return opened;} catch (error) {await opened.close(); throw error;}
        }});
        await sessions.restore();
        emit({status: 'ready'});
        void sessions.refreshIfNeeded(api.refresh).catch(() => undefined);
      } catch (reason) {
        const error = reason instanceof Error ? reason : new Error('Application data initialization failed');
        const previousBackground = revokeAccountScope(); await previousBackground?.stop(); adminCache = null;
        emit(error instanceof UpgradeVerificationRequired ? {status: 'verification-required', inventory: error.inventory} : {status: 'error', error});
        if (database) { await database.close(); database = null; }
        if (hasLease) { await bridge.endDataOwnership(); hasLease = false; }
        throw error;
      }
    })();
    return startPromise;
  }
  async function stop() {
    stopping = true;
    const previousBackground = revokeAccountScope(); await previousBackground?.stop();
    if (startPromise) await startPromise.catch(() => undefined);
    const lateBackground = revokeAccountScope(); await lateBackground?.stop(); adminCache = null;
    if (database) { await revokeReaderResources(); await database.close(); database = null; }
    if (hasLease) { await bridge.endDataOwnership(); hasLease = false; }
    startPromise = null; emit({status: 'idle'});
  }
  return {
    preferences, sessions, api, start, stop,
    getAccountPreferences: () => accountPreferences,
    getNativeResourceOwner: () => nativeResourceOwner,
    beginArticleAccess: (key: string) => backgroundCache?.beginForeground(key) ?? (() => {}),
    getDatabase: () => database,
    getRepositories: () => repositories,
    getCache: () => cache,
    getUpgradeSnapshot: () => upgradeState,
    subscribeUpgrade: (listener: (state: UpgradeState) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type MobileDataRuntime = ReturnType<typeof createMobileDataRuntime>;
