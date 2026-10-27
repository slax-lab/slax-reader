import {AvatarResourcesContext} from './components/AvatarResources';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {AppState, Platform} from 'react-native';
import { getLocales } from 'expo-localization';
import {File} from 'expo-file-system';
import { createMobileDataRuntime, type MobileDataRuntime, type MobileRepositories, type PreferenceValues } from './data';
import { createTranslator, normalizeLocale, type MobileLocale } from './i18n';
import { mobileConfig } from './config';
import {readerImageProxyOrigins, readerProtectedHosts} from './reader/security.ts';
import {PaymentController} from './payments/controller';
import {createExpoStore} from './payments/expo-store';
import {setWebSessionCookie} from './native/platform';
import type {MobileTelemetry} from './telemetry/core';
import type {LoginProvider} from './auth/providers';
import type {LoginRequest} from './data/api';
import type {ReaderObservation} from './reader/ReaderWebView';
import {upgradeVisibilityPhase, validateVisibilityRequest, validateVisibleLegacyProducer, validatePreReconnectVisibility, validatePostServiceVisibility} from './controlled-upgrade-visibility';
import type {CredentialReadinessState} from './domain/credential-readiness';
import {SaveURLHost} from './system-actions/SaveURLHost';
import {createSaveURLController, createSystemEntryRouter, createSystemSurfacesController} from './system-actions/adapters';
import type {SystemSurfacesController} from './system-actions/system-surfaces';
import {systemSurfaceCapabilities, systemSurfacePreferences} from './settings/system-surface-preferences';

const idleCredentials: CredentialReadinessState = {status: 'idle'};
const noCredentialSubscription = () => () => {};
const idleCredentialSnapshot = () => idleCredentials;

export interface MobileContextValue {
  runtime: MobileDataRuntime;
  api: MobileDataRuntime['api'];
  preferences: MobileDataRuntime['preferences'];
  nativeResourceOwner: string | null;
  sessions: MobileDataRuntime['sessions'];
  repositories: MobileRepositories | null;
  cache: ReturnType<MobileDataRuntime['getCache']>;
  session: ReturnType<MobileDataRuntime['sessions']['getSnapshot']>;
  upgrade: ReturnType<MobileDataRuntime['getUpgradeSnapshot']>;
  credentialState?: CredentialReadinessState;
  settings: PreferenceValues;
  locale: MobileLocale;
  t: ReturnType<typeof createTranslator>;
  config: typeof mobileConfig;
  payments: PaymentController;
  systemSurfaces?: SystemSurfacesController;
  systemIntentsAvailable?: boolean;
  systemDiscoveryAvailable?: boolean;
  systemEntry?: ReturnType<typeof createSystemEntryRouter>;
  webSession: {ready: boolean; error: Error|null};
  acquireWebSession?(): () => void;
  telemetryOverride?: MobileTelemetry;
  fixtureOnly?: {network: {isConnected: boolean; isInternetReachable: boolean|null}; dataDirectory: string; pdfNativeOwner?: true; nativePdfImport?: 'seeded-synthetic-only'; deleteNoticeHtml?: string; agreementHtml?: Partial<Record<'terms'|'privacy', string>>; subscriptionHtml?: string; authenticate?(provider: LoginProvider): Promise<LoginRequest|null>};
  retryStart(): Promise<void>;
}
/** Account and runtime services; preference values and web-session readiness have their own contexts. */
export type MobileServices = Omit<MobileContextValue, 'settings' | 'webSession'>;
export type MobileWebSession = MobileContextValue['webSession'];
type SettingsStore = {getSnapshot(): PreferenceValues; subscribe(listener: () => void): () => void};
const MobileContext = createContext<MobileServices | null>(null);
const ReadingContext = createContext<MobileServices | null>(null);
const SettingsContext = createContext<SettingsStore | null>(null);
const WebSessionContext = createContext<MobileWebSession | null>(null);
const unpreparedWebSession: MobileWebSession = {ready: false, error: null};
function createSettingsStore(initial: PreferenceValues) {
  let values = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => values,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    set(next: PreferenceValues) {if (next !== values) {values = next; listeners.forEach(listener => listener());}},
  };
}
const staticSubscription = () => () => {};
function MobileContexts({services, reading, settings, webSession, children}: {services: MobileServices; reading: MobileServices; settings: SettingsStore; webSession: MobileWebSession; children: React.ReactNode}) {
  return <MobileContext.Provider value={services}><ReadingContext.Provider value={reading}><SettingsContext.Provider value={settings}><WebSessionContext.Provider value={webSession}>{children}</WebSessionContext.Provider></SettingsContext.Provider></ReadingContext.Provider></MobileContext.Provider>;
}
function FixtureContexts({value, children}: {value: MobileContextValue; children: React.ReactNode}) {
  const settings = useMemo<SettingsStore>(() => ({getSnapshot: () => value.settings, subscribe: staticSubscription}), [value.settings]);
  return <MobileContexts services={value} reading={value} settings={settings} webSession={value.webSession}>{children}</MobileContexts>;
}


/** Numeric and boolean observations only; no document, selection, session or credential data. */
export type ControlledUpgradeReaderObservation = (
  | ReaderObservation
  | {type: 'position-persisted'; pageId: string; reason: string; requestedPixels: number; persistedPixels: number | null}
) & {cacheKey: string; routeKey: string; observedAt: number};
export type ControlledUpgradeReaderObserver = (event: ControlledUpgradeReaderObservation) => void;
const ControlledUpgradeReaderContext = createContext<ControlledUpgradeReaderObserver | undefined>(undefined);
export function useControlledUpgradeReaderObserver(): ControlledUpgradeReaderObserver | undefined {
  const observer = useContext(ControlledUpgradeReaderContext);
  return __DEV__ ? observer : undefined;
}

/** Development harnesses supply isolated storage and transport before any production runtime exists. */
export function FixtureMobileProvider({value, children}: {value: MobileContextValue; children: React.ReactNode}) {
  if (!__DEV__) throw new Error('UI fixtures are unavailable in production builds');
  if (!value.fixtureOnly?.dataDirectory.includes('/slax-ui-fixtures/')) throw new Error('UI fixtures require an isolated cache scope');
  return <FixtureContexts value={value}>{children}</FixtureContexts>;
}

/** Only an original synthetic native installation may render its actual migrated services. */
export function ControlledUpgradeFixtureProvider({value, device, onReaderObservation, children}: {value: MobileContextValue; device: string; onReaderObservation?: ControlledUpgradeReaderObserver; children: React.ReactNode}) {
  if (!__DEV__) throw new Error('Controlled upgrade rendering requires a development build');
  const runtime = value.runtime, cache = runtime.getCache(), session = runtime.sessions.getSnapshot();
  const cacheDirectory = cache?.dataDirectory;
  const directory = Platform.OS === 'android' && cacheDirectory ? `${cacheDirectory}/files` : cacheDirectory;
  const ownedDevice = Platform.OS === 'ios'
    ? /^[0-9A-Fa-f-]{36}$/.test(device) && directory?.includes(`/CoreSimulator/Devices/${device}/data/Containers/Data/Application/`)
    : Platform.OS === 'android' && /^emulator-\d+$/.test(device) && cacheDirectory === '/data/user/0/com.slax.reader';
  if (!ownedDevice || !directory || session.status !== 'authenticated' || session.session.userId !== 'synthetic-user' || session.session.token !== 'fixture-auth-token-NOT-A-REAL-CREDENTIAL') throw new Error('A controlled original synthetic installation is required');
  if (value.fixtureOnly || value.api !== runtime.api || value.sessions !== runtime.sessions || value.session !== session || value.repositories !== runtime.getRepositories() || value.cache !== cache || value.preferences !== runtime.getAccountPreferences() || value.nativeResourceOwner !== runtime.getNativeResourceOwner() || !value.nativeResourceOwner || value.upgrade !== runtime.getUpgradeSnapshot() || value.upgrade.status !== 'ready') throw new Error('Controlled upgrade views must use the actual active native runtime services');
  if (runtime.api.options.baseUrl !== 'http://127.0.0.1:9' || value.config.apiUrl !== 'http://127.0.0.1:9') throw new Error('Controlled upgrade rendering requires the blocked loopback transport');
  const read = (name: string) => {
    const marker = new File(`${directory}/${name}`);
    if (!marker.exists) throw new Error('Controlled native acceptance marker is missing');
    return JSON.parse(marker.textSync()) as Record<string, unknown>;
  };
  const source = read('legacy-fixture-report.json'), request = read('native-upgrade-ui-request.json');
  validateVisibleLegacyProducer(source, Platform.OS);
  validateVisibilityRequest(request, Platform.OS, device);
  if (upgradeVisibilityPhase(request.phase) === 'pre-reconnect') {
    if (new File(`${directory}/native-service-report.json`).exists || new File(`${directory}/native-adoption-report.json`).exists) throw new Error('Pending visibility requires an untouched original queue');
    validatePreReconnectVisibility(source, request, read('native-upgrade-offline-report.json'), value.nativeResourceOwner);
  } else validatePostServiceVisibility(Platform.OS, device, read('native-service-report.json'), read('native-runtime-start-report.json'));
  return <ControlledUpgradeReaderContext.Provider value={onReaderObservation}>
    <FixtureContexts value={value}>{children}</FixtureContexts>
  </ControlledUpgradeReaderContext.Provider>;
}

type AppIntentsRuntimePort = Pick<typeof import('expo-app-intents'), 'isAvailable' | 'useAppIntents' | 'removePendingInvocationAsync' | 'setEntityCatalogAsync' | 'deleteDonationsAsync' | 'donateIntentAsync'>;
export function MobileProvider({children, appIntents}: {children: React.ReactNode; appIntents?: AppIntentsRuntimePort}) {
  const [runtime] = useState(() => createMobileDataRuntime({baseUrl: mobileConfig.apiUrl, betaBaseUrl: mobileConfig.betaApiUrl, platform: mobileConfig.platform, version: `${mobileConfig.version} (${mobileConfig.buildNumber})`, readerHosts: {protectedHosts: readerProtectedHosts(mobileConfig), imageProxyOrigins: readerImageProxyOrigins(mobileConfig)}}));
  const [systemActions] = useState(() => createSaveURLController(runtime, appIntents?.removePendingInvocationAsync ?? (async () => {})));
  const unavailableIntentAction = async (): Promise<never> => {throw new Error('System App Intents are unavailable on this platform');};
  const [systemSurfaces] = useState(() => createSystemSurfacesController(runtime, {
    setEntityCatalogAsync: appIntents?.setEntityCatalogAsync ?? unavailableIntentAction,
    deleteDonationsAsync: appIntents?.deleteDonationsAsync ?? unavailableIntentAction,
    donateIntentAsync: appIntents?.donateIntentAsync ?? unavailableIntentAction,
  }));
  const [systemEntry] = useState(() => createSystemEntryRouter(runtime, systemSurfaces, appIntents?.removePendingInvocationAsync ?? (async () => {})));
  const session = useSyncExternalStore(runtime.sessions.subscribe, runtime.sessions.getSnapshot);
  const upgrade = useSyncExternalStore(runtime.subscribeUpgrade, runtime.getUpgradeSnapshot);
  const credentialState = useSyncExternalStore(runtime.credentials?.subscribe ?? noCredentialSubscription, runtime.credentials?.getSnapshot ?? idleCredentialSnapshot);
  const [settingsStore] = useState(() => createSettingsStore({}));
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const libraryPresented = useSyncExternalStore(runtime.subscribeLibraryPresented, runtime.isLibraryPresented);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [payments] = useState(() => new PaymentController(createExpoStore(), runtime.sessions, runtime.preferences, runtime.api.checkIapResult));
  const [webSession, setWebSession] = useState<{ready: boolean; error: Error|null; token: string|null; owner: string|null}>({ready: false, error: null, token: null, owner: null});
  const cookieSerial = useRef(Promise.resolve());
  const [webConsumers, setWebConsumers] = useState(0);
  const acquireWebSession = useCallback(() => {
    setWebConsumers(count => count + 1);
    let released = false;
    return () => {if (!released) {released = true; setWebConsumers(count => Math.max(0, count - 1));}};
  }, []);
  const token = session.status === 'authenticated' ? session.session.token : null;
  const userId = session.status === 'authenticated' ? session.session.userId : null;
  const reauthenticationRequired = credentialState.status === 'reauthentication-required';
  const reauthSignOut = useRef(false);
  useEffect(() => {
    if (credentialState.status !== 'reauthentication-required') {reauthSignOut.current = false; return;}
    if (reauthSignOut.current) return;
    reauthSignOut.current = true;
    // Rejected credentials do not ask for the previous account; drop the session and keep local data for Settings cleanup.
    void runtime.sessions.signOut(false).catch(() => undefined);
  }, [runtime, credentialState.status]);
  const nativeResourceOwner = runtime.getNativeResourceOwner();
  useEffect(() => {void systemActions.contextChanged();}, [systemActions, userId, runtime.api.options.baseUrl, nativeResourceOwner, upgrade.status, credentialState.status]);
  const surfaceCapabilities = systemSurfaceCapabilities(Platform.OS, Platform.Version, Boolean(appIntents?.isAvailable()));
  const surfacesReady = preferencesLoaded && Boolean(surfaceCapabilities.intents && userId && nativeResourceOwner && upgrade.status === 'ready' && credentialState.status === 'ready');
  // Signed-out revocation runs immediately; signed-in reconciliation and publishing wait for the Library.
  const surfacesKnown = preferencesLoaded && (session.status === 'unauthenticated' || (session.status === 'authenticated' && Boolean(nativeResourceOwner) && upgrade.status === 'ready' && libraryPresented));
  const surfacePreferences = systemSurfacePreferences(preferencesLoaded ? settings : null);
  const discoveryEnabled = surfacePreferences.discovery && surfaceCapabilities.discovery;
  const donationsEnabled = surfacePreferences.donations && surfaceCapabilities.donations;
  useEffect(() => {
    systemSurfaces.activate();
    if (!surfacesKnown) return () => systemSurfaces.dispose();
    void systemSurfaces.reconcile(discoveryEnabled, donationsEnabled, surfacesReady);
    return () => systemSurfaces.dispose();
  }, [systemSurfaces, surfacesKnown, userId, runtime.api.options.baseUrl, nativeResourceOwner, upgrade.status, credentialState.status, discoveryEnabled, donationsEnabled, surfacesReady]);
  // The router outlives readiness changes; disposing it on a credential transition drops pending Spotlight opens.
  useEffect(() => {
    systemEntry.router.activate();
    return () => systemEntry.router.dispose();
  }, [systemEntry, userId, runtime.api.options.baseUrl]);
  useEffect(() => {
    if (libraryPresented) void systemEntry.router.contextChanged();
  }, [systemEntry, nativeResourceOwner, upgrade.status, credentialState.status, libraryPresented]);
  useEffect(() => {
    let mounted = true;
    const current = () => mounted && runtime.sessions.getSnapshot() === session && runtime.getNativeResourceOwner() === nativeResourceOwner;
    setWebSession({ready: false, error: null, token, owner: nativeResourceOwner});
    const install = Boolean(token && nativeResourceOwner && webConsumers > 0 && !reauthenticationRequired);
    const prepare = install ? runtime.sessions.prepareRequest() : Promise.resolve();
    void prepare.then(() => {
      if (!current()) return;
      cookieSerial.current = cookieSerial.current.catch(() => undefined).then(async () => {
        if (current()) await setWebSessionCookie(mobileConfig.webUrl, install ? token : null, mobileConfig.webDomain);
      });
      return cookieSerial.current;
    }).then(() => {if (current() && install) setWebSession({ready: true, error: null, token, owner: nativeResourceOwner});}).catch(reason => {
      if (current() && install) setWebSession({ready: false, error: reason instanceof Error ? reason : new Error('Unable to prepare the web session'), token, owner: nativeResourceOwner});
    });
    return () => {mounted = false;};
  }, [runtime, session, token, nativeResourceOwner, reauthenticationRequired, webConsumers > 0]);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !userId || upgrade.status !== 'ready' || reauthenticationRequired) return;
    void payments.listen();
    return () => {void payments.stop().catch(() => undefined);};
  }, [payments, userId, nativeResourceOwner, upgrade.status, reauthenticationRequired]);
  useEffect(() => {
    // Only a true background transition pauses storage work; transient `inactive` keeps sync and acquisition running.
    const update = (state: string) => {void runtime.setForeground(state !== 'background').catch(() => undefined);};
    if (AppState.currentState) update(AppState.currentState);
    const subscription = AppState.addEventListener('change', update);
    return () => subscription.remove();
  }, [runtime]);
  useEffect(() => {
    const updateSettings = (value: PreferenceValues) => {settingsStore.set(value); setPreferencesLoaded(true);};
    const unsubscribe = runtime.preferences.subscribe(updateSettings);
    let mounted = true;
    runtime.start().catch(() => undefined).then(() => runtime.preferences.read()).then(value => { if (mounted) updateSettings(value); }).catch(() => undefined);
    return () => { mounted = false; unsubscribe(); void runtime.stop(); };
  }, [runtime, settingsStore]);
  const locale = normalizeLocale(typeof settings.user_language === 'string' ? settings.user_language : getLocales()[0]?.languageTag);
  const t = useMemo(() => createTranslator(locale), [locale]);
  const apiUrl = runtime.api.options.baseUrl;
  const config = useMemo(() => ({...mobileConfig, apiUrl, isBeta: !mobileConfig.development && apiUrl === mobileConfig.betaApiUrl}), [apiUrl]);
  const retryFlight = useRef<Promise<void> | null>(null);
  const retryStart = useCallback(() => {
    if (retryFlight.current) return retryFlight.current;
    const attempt = (async () => {setPreferencesLoaded(false); await runtime.stop(); await runtime.start(); settingsStore.set(await runtime.preferences.read()); setPreferencesLoaded(true);})()
      .finally(() => {if (retryFlight.current === attempt) retryFlight.current = null;});
    retryFlight.current = attempt;
    return attempt;
  }, [runtime, settingsStore]);
  const preferences = runtime.getAccountPreferences() ?? runtime.preferences;
  const dataReady = upgrade.status === 'ready' && nativeResourceOwner !== null;
  const repositories = dataReady ? runtime.getRepositories() : null, cache = dataReady ? runtime.getCache() : null;
  const visibleWebSession = useMemo<MobileWebSession>(() => webSession.token === token && webSession.owner === nativeResourceOwner ? {ready: webSession.ready, error: webSession.error} : unpreparedWebSession, [webSession, token, nativeResourceOwner]);
  const value = useMemo<MobileServices>(() => ({
    runtime, api: runtime.api, preferences, sessions: runtime.sessions, nativeResourceOwner, systemSurfaces, systemEntry,
    repositories, cache, session, upgrade, credentialState, locale, t, config, payments, systemIntentsAvailable: surfaceCapabilities.intents, systemDiscoveryAvailable: surfaceCapabilities.discovery,
    acquireWebSession, retryStart,
  }), [runtime, preferences, nativeResourceOwner, systemSurfaces, systemEntry, repositories, cache, session, upgrade, credentialState, locale, t, config, payments, surfaceCapabilities.intents, surfaceCapabilities.discovery, acquireWebSession, retryStart]);
  const reading = useMemo<MobileServices>(() => ({runtime, api: runtime.api, preferences, sessions: runtime.sessions, nativeResourceOwner, systemSurfaces, systemEntry,
    repositories, cache, session, upgrade, locale, t, config, payments, retryStart}),
  [runtime, preferences, nativeResourceOwner, systemSurfaces, systemEntry, repositories, cache, session, upgrade, locale, t, config, payments, retryStart]);
  const saveOwner = session.status === 'authenticated' && nativeResourceOwner ? {userId: session.session.userId, origin: apiUrl, generation: nativeResourceOwner} : null;
  const saveReady = Boolean(saveOwner && upgrade.status === 'ready' && credentialState.status === 'ready' && repositories);
  return <MobileContexts services={value} reading={reading} settings={settingsStore} webSession={visibleWebSession}><AvatarResourcesContext.Provider value={dataReady ? runtime.getAvatarCache?.() ?? null : null}>{children}<SaveURLHost controller={systemActions} router={systemEntry.router} owner={saveOwner} ready={saveReady} appIntents={appIntents} t={t}/></AvatarResourcesContext.Provider></MobileContexts>;
}
export function useReadingMobile(): MobileServices {
  const context = useContext(ReadingContext);
  if (!context) throw new Error('MobileProvider is missing');
  return context;
}
export function useMobile(): MobileServices {
  const context = useContext(MobileContext);
  if (!context) throw new Error('MobileProvider is missing');
  return context;
}
/** Re-renders only when the selected preference value changes; without a selector, on every preference write. */
export function useMobileSettings(): PreferenceValues;
export function useMobileSettings<T>(select: (settings: PreferenceValues) => T): T;
export function useMobileSettings<T>(select?: (settings: PreferenceValues) => T): T | PreferenceValues {
  const store = useContext(SettingsContext);
  if (!store) throw new Error('MobileProvider is missing');
  const snapshot = useCallback(() => select ? select(store.getSnapshot()) : store.getSnapshot(), [store, select]);
  return useSyncExternalStore(store.subscribe, snapshot);
}
export function useWebSession(): MobileWebSession {
  const context = useContext(WebSessionContext);
  if (!context) throw new Error('MobileProvider is missing');
  return context;
}
