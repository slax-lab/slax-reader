import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {Platform} from 'react-native';
import { getLocales } from 'expo-localization';
import {File} from 'expo-file-system';
import { createMobileDataRuntime, type MobileDataRuntime, type MobileRepositories, type PreferenceValues } from './data';
import { createTranslator, normalizeLocale, type MobileLocale } from './i18n';
import { mobileConfig } from './config';
import {PaymentController} from './payments/controller';
import {createExpoStore} from './payments/expo-store';
import {setWebSessionCookie} from './native/platform';
import type {MobileTelemetry} from './telemetry/core';
import type {LoginProvider} from './auth/providers';
import type {LoginRequest} from './data/api';
import type {ReaderObservation} from './reader/ReaderWebView';
import {upgradeVisibilityPhase, validateVisibilityRequest, validateVisibleLegacyProducer, validatePreReconnectVisibility, validatePostServiceVisibility} from './controlled-upgrade-visibility';

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
  settings: PreferenceValues;
  locale: MobileLocale;
  t: ReturnType<typeof createTranslator>;
  config: typeof mobileConfig;
  payments: PaymentController;
  webSession: {ready: boolean; error: Error|null};
  telemetryOverride?: MobileTelemetry;
  fixtureOnly?: {network: {isConnected: boolean; isInternetReachable: boolean|null}; dataDirectory: string; deleteNoticeHtml?: string; agreementHtml?: Partial<Record<'terms'|'privacy', string>>; subscriptionHtml?: string; authenticate?(provider: LoginProvider): Promise<LoginRequest|null>};
  retryStart(): Promise<void>;
}
const MobileContext = createContext<MobileContextValue | null>(null);

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
  return <MobileContext.Provider value={value}>{children}</MobileContext.Provider>;
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
    <MobileContext.Provider value={value}>{children}</MobileContext.Provider>
  </ControlledUpgradeReaderContext.Provider>;
}

export function MobileProvider({children}: {children: React.ReactNode}) {
  const [runtime] = useState(() => createMobileDataRuntime({baseUrl: mobileConfig.apiUrl, betaBaseUrl: mobileConfig.betaApiUrl, platform: mobileConfig.platform, version: `${mobileConfig.version} (${mobileConfig.buildNumber})`}));
  const session = useSyncExternalStore(runtime.sessions.subscribe, runtime.sessions.getSnapshot);
  const upgrade = useSyncExternalStore(runtime.subscribeUpgrade, runtime.getUpgradeSnapshot);
  const [settings, setSettings] = useState<PreferenceValues>({});
  const [payments] = useState(() => new PaymentController(createExpoStore(), runtime.sessions, runtime.preferences, runtime.api.checkIapResult));
  const [webSession, setWebSession] = useState<{ready: boolean; error: Error|null; token: string|null; owner: string|null}>({ready: false, error: null, token: null, owner: null});
  const cookieSerial = useRef(Promise.resolve());
  const token = session.status === 'authenticated' ? session.session.token : null;
  const userId = session.status === 'authenticated' ? session.session.userId : null;
  const nativeResourceOwner = runtime.getNativeResourceOwner();
  useEffect(() => {
    let mounted = true;
    const current = () => mounted && runtime.sessions.getSnapshot() === session && runtime.getNativeResourceOwner() === nativeResourceOwner;
    setWebSession({ready: false, error: null, token, owner: nativeResourceOwner});
    cookieSerial.current = cookieSerial.current.catch(() => undefined).then(() => {
      if (current()) return setWebSessionCookie(mobileConfig.webUrl, token, mobileConfig.webDomain);
    }).then(() => { if (current()) setWebSession({ready: true, error: null, token, owner: nativeResourceOwner}); }).catch(reason => {
      if (current()) setWebSession({ready: false, error: reason instanceof Error ? reason : new Error('Unable to prepare the web session'), token, owner: nativeResourceOwner});
    });
    return () => { mounted = false; };
  }, [runtime, session, token, nativeResourceOwner]);
  useEffect(() => {
    if (Platform.OS !== 'ios' || !userId || upgrade.status !== 'ready') return;
    let alive = true;
    const scope = runtime.sessions.captureRequestScope();
    const request = new AbortController();
    void runtime.api.getIAPProductIds(request.signal).then(({products}) => {
      scope.assertCurrent();
      if (alive && runtime.getNativeResourceOwner() === nativeResourceOwner) return payments.start(products);
    }).catch(() => undefined);
    return () => { alive = false; request.abort(); void payments.stop().catch(() => undefined); };
  }, [runtime, payments, userId, session, nativeResourceOwner, upgrade.status]);
  useEffect(() => {
    const unsubscribe = runtime.preferences.subscribe(setSettings);
    let mounted = true;
    runtime.start().catch(() => undefined).then(() => runtime.preferences.read()).then(value => { if (mounted) setSettings(value); }).catch(() => undefined);
    return () => { mounted = false; unsubscribe(); void runtime.stop(); };
  }, [runtime]);
  const locale = normalizeLocale(typeof settings.user_language === 'string' ? settings.user_language : getLocales()[0]?.languageTag);
  const value: MobileContextValue = {
    runtime, api: runtime.api, preferences: runtime.getAccountPreferences() ?? runtime.preferences, sessions: runtime.sessions,
    nativeResourceOwner,
    repositories: runtime.getRepositories(), cache: runtime.getCache(), session, upgrade, settings,
    locale, t: createTranslator(locale), config: {...mobileConfig, apiUrl: runtime.api.options.baseUrl, isBeta: runtime.api.options.baseUrl === mobileConfig.betaApiUrl}, payments,
    webSession: webSession.token === token && webSession.owner === nativeResourceOwner ? webSession : {ready: false, error: null},
    async retryStart() { await runtime.stop(); await runtime.start(); setSettings(await runtime.preferences.read()); },
  };
  return <MobileContext.Provider value={value}>{children}</MobileContext.Provider>;
}
export function useMobile(): MobileContextValue {
  const context = useContext(MobileContext);
  if (!context) throw new Error('MobileProvider is missing');
  return context;
}
