import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {AppState, Platform, StatusBar, View, ActivityIndicator} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {Directory, File, Paths} from 'expo-file-system';
import {useNetworkState} from 'expo-network';
import Constants from 'expo-constants';
import {ApplicationRoutes} from '../../src/App';
import {FixtureMobileProvider, type MobileContextValue} from '../../src/runtime';
import {createMobileDataRuntime} from '../../src/data/runtime';
import {createTranslator, normalizeLocale} from '../../src/i18n';
import {mobileConfig} from '../../src/config';
import {PaymentController} from '../../src/payments/controller';
import {createExpoStore} from '../../src/payments/expo-store';
import {fixtureActions, type FixtureAction} from '../../src/components/fixture-actions';
import type {FixtureControl} from '../../fixtures/FixtureApp';
import scenarios from '../../fixtures/scenarios.json';
import manifest from '../../fixtures/manifest.json';

const API = process.env.EXPO_PUBLIC_SLAX_API_URL ?? '';
const SYNC = process.env.EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_URL ?? '';
const RUN_ID = process.env.EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_RUN_ID ?? '';
const SCENARIO = 'rss-local-native-offline';
const scope = new Directory(Paths.cache, 'slax-ui-fixtures', 'rss-real-sync');
const inputSha256 = (manifest as {files: {path: string; sha256: string}[]}).files.find(file => file.path === 'scenarios.json')?.sha256 ?? '';
const digest = (value: unknown) => JSON.stringify(value);
const loadingSession = {status: 'loading'} as const;
const idleUpgrade = {status: 'idle'} as const;
const noSubscribe = () => () => {};
const getLoadingSession = () => loadingSession;
const getIdleUpgrade = () => idleUpgrade;
function check(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
function assertLoopback(value: string, label: string) {
  const url = new URL(value);
  check(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && !!url.port, `${label} must use an explicit loopback HTTP origin`);
  return url.origin;
}

type Runtime = ReturnType<typeof createMobileDataRuntime>;
type SnapshotCounts = Awaited<ReturnType<typeof databaseSnapshot>>['counts'];
async function responseJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const value = await response.json() as {code?: number; message?: string; data?: T};
  if (!response.ok || value.code !== 200 || value.data === undefined) throw new Error(`Local fixture request failed (${response.status})`);
  return value.data;
}

async function sessionFor(owner: 'A'|'B') {
  return responseJson<{userId: string; token: string; owner: string}>(`${assertLoopback(API, 'API')}/fixture/session?owner=${owner}`);
}

async function databaseSnapshot(runtime: Runtime, owner: 'A'|'B') {
  const db = runtime.getDatabase();
  check(db, 'PowerSync database is not open');
  const [subscriptions, feeds, entries, bookmarks] = await Promise.all([
    db.getAll<{id: string; feed_id: string; remark: string|null}>('SELECT id, feed_id, remark FROM sr_rss_subscription ORDER BY id'),
    db.getAll<{id: string; title: string}>('SELECT id, title FROM sr_rss_feed ORDER BY id'),
    db.getAll<{id: string; feed_id: string; title: string; article_url: string|null}>('SELECT id, feed_id, title, article_url FROM sr_rss_entry ORDER BY id'),
    db.getAll<{id: string; target_url: string|null}>('SELECT id, json_extract(metadata, \'$.bookmark.target_url\') AS target_url FROM sr_user_bookmark WHERE deleted_at IS NULL ORDER BY id'),
  ]);
  return {
    subscriptions, feeds, entries, bookmarks,
    counts: {subscriptions: subscriptions.length, entries: entries.length, bookmarks: bookmarks.length,
      otherOwnerRows: owner === 'A'
        ? subscriptions.filter(row => row.id === 'rss-local-sub-b' || row.id === 'rss-local-sub-b-only').length + entries.filter(row => row.id === 'rss-local-entry-b-only').length + feeds.filter(row => row.id === 'rss-local-feed-b-only').length
        : subscriptions.filter(row => row.id === 'rss-local-sub-a').length + bookmarks.filter(row => row.target_url === 'https://rss-local-fixture.invalid/article-live').length,
      historyRows: entries.filter(row => row.id === 'rss-local-entry-history').length},
  };
}

async function readFixtureSession(runtime: Runtime) {
  const values = await runtime.preferences.read();
  if (typeof values.auth_token === 'string' && typeof values.user_id === 'string' && values.auth_token && values.user_id) {
    return {owner: values.user_id.endsWith('-b') ? 'B' as const : 'A' as const, userId: values.user_id, token: values.auth_token};
  }
  const session = await sessionFor('A');
  await runtime.preferences.update(values => {
    values.auth_token = session.token; values.user_id = session.userId; values.last_refresh_time = String(Math.floor(Date.now() / 1000));
    values.selected_env = 'LOCAL'; values.user_language = 'en'; values.cache_count = 0; values.download_images = 0;
  });
  return {owner: 'A' as const, userId: session.userId, token: session.token};
}

export default function RssRealSyncFixtureApp() {
  const [runtime, setRuntime] = useState<Runtime|null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const network = useNetworkState();
  useEffect(() => {
    let active = true, stopActions: (() => void)|undefined, stopSession: (() => void)|undefined, stopUpgrade: (() => void)|undefined, stopPrefs: (() => void)|undefined, appState: ReturnType<typeof AppState.addEventListener>|undefined;
    let currentSession: Awaited<ReturnType<typeof readFixtureSession>>|undefined;
    let dataRuntime: Runtime|undefined;
    let observedRssRepository: unknown, rssStreamFirstSync = false, initialEmptyReceiptReused = false;
    let coldLaunchDatabaseCounts: SnapshotCounts|null = null, coldLaunchSyncHasSynced: boolean|null = null;
    const run = async () => {
      check(__DEV__ && Platform.OS === 'ios', 'Real RSS sync fixture requires the isolated iOS development client');
      check(Constants.expoConfig?.ios?.bundleIdentifier === 'app.slax.reader.uifixture.rssacceptance', 'Real RSS sync fixture refuses any non-task app identity');
      check(Boolean(inputSha256 && (scenarios as {scenarios: Record<string, unknown>}).scenarios[SCENARIO]), 'RSS fixture manifest is missing');
      const baseUrl = assertLoopback(API, 'API'), localSyncEndpoint = assertLoopback(SYNC, 'PowerSync endpoint');
      check(Boolean(RUN_ID), 'Local real-sync run ID is missing');
      scope.create({idempotent: true, intermediates: true});
      const emptyReceiptFile = new File(scope, 'fresh-empty-receipt.json');
      if (emptyReceiptFile.exists) {
        let receipt: {kind?: string; version?: number; runId?: string; bundleId?: string; scopeUri?: string};
        try {receipt = JSON.parse(await emptyReceiptFile.text()) as typeof receipt;}
        catch {throw new Error('Existing real-sync empty receipt is invalid; refusing to reset or reseed this database');}
        check(receipt.kind === 'rss-real-sync-fresh-empty' && receipt.version === 1 && receipt.runId === RUN_ID &&
          receipt.bundleId === 'app.slax.reader.uifixture.rssacceptance' && receipt.scopeUri === scope.uri,
          'Existing real-sync empty receipt belongs to another run, app identity, or database scope');
        initialEmptyReceiptReused = true;
      }
      const runtime = createMobileDataRuntime({baseUrl, localSyncEndpoint, platform: 'ios', version: `${mobileConfig.version} (${mobileConfig.buildNumber})`});
      dataRuntime = runtime;
      const observeRssStream = () => {
        const repository = runtime.getRepositories()?.rss;
        if (!repository || repository === observedRssRepository) return;
        observedRssRepository = repository; rssStreamFirstSync = false;
        const connect = repository.connect.bind(repository);
        repository.connect = (onReady, onError) => connect(() => {rssStreamFirstSync = true; if (active) setRevision(value => value + 1); onReady();}, onError);
      };
      const update = () => {observeRssStream(); if (active) setRevision(value => value + 1);};
      stopSession = runtime.sessions.subscribe(update); stopUpgrade = runtime.subscribeUpgrade(update); stopPrefs = runtime.preferences.subscribe(update);
      appState = AppState.addEventListener('change', state => {void runtime.setForeground(state === 'active').catch(() => undefined);});
      currentSession = await readFixtureSession(runtime);
      await runtime.start();
      observeRssStream();
      check(active, 'Fixture was disposed during startup');
      if (initialEmptyReceiptReused) {
        coldLaunchDatabaseCounts = (await databaseSnapshot(runtime, currentSession.owner)).counts;
        coldLaunchSyncHasSynced = runtime.getDatabase()?.currentStatus.hasSynced ?? false;
      }
      const releaseScope = fixtureActions.activate(scope.uri);
      const request = async (path: string, body?: Record<string, unknown>) => {
        const session = runtime.sessions.getSnapshot();
        const token = session.status === 'authenticated' ? session.session.token : currentSession?.token;
        return responseJson<unknown>(`${baseUrl}${path}`, {method: body ? 'POST' : 'GET', ...(body ? {headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify(body)} : {headers: {Authorization: `Bearer ${token}`}})});
      };
      const control = (operation: string, details: Record<string, unknown> = {}) => request('/fixture/control', {runId: RUN_ID, operation, ...details});
      const capture = async () => {
        const session = runtime.sessions.getSnapshot();
        const snapshot = await databaseSnapshot(runtime, currentSession?.owner ?? 'A');
        const db = runtime.getDatabase(), sync = db?.currentStatus;
        const controller = (globalThis as typeof globalThis & {__SLAX_UI_RSS_STATE__?: unknown}).__SLAX_UI_RSS_STATE__ ?? null;
        const report = {kind: 'slax-rss-real-sync-native', version: 1, apiOrigin: baseUrl, syncOrigin: localSyncEndpoint,
          owner: currentSession?.owner ?? null, sessionUserId: session.status === 'authenticated' ? session.session.userId : null,
          upgrade: runtime.getUpgradeSnapshot().status, nativeResourceOwner: runtime.getNativeResourceOwner() !== null,
          initialEmptyReceiptReused, coldLaunchDatabaseCounts, coldLaunchSyncHasSynced,
          actualPowerSyncDatabase: true, rssStreamFirstSync, powerSyncStatus: sync ? {connected: sync.connected, connecting: sync.connecting, downloading: sync.downloading, uploading: sync.uploading, hasSynced: sync.hasSynced, lastSyncedAt: sync.lastSyncedAt} : null,
          actualRssController: controller, sqlite: snapshot, capturedAt: new Date().toISOString()};
        new File(scope, 'real-sync-native-state.json').write(digest(report));
        return report;
      };
      const stopHandler = fixtureActions.subscribe('rss-real-sync', async (action: FixtureAction) => {
        if (action.kind === 'real-sync-snapshot') {await capture(); return true;}
        if (action.kind === 'real-sync-checkpoint') {
          const ownerName = currentSession?.owner ?? 'A', snapshot = await databaseSnapshot(runtime, ownerName), owner = ownerName === 'B' ? 'b' : 'a';
          const controller = (globalThis as typeof globalThis & {__SLAX_UI_RSS_STATE__?: {subscriptions?: {id: string; remark: string|null}[]; entries?: {id: string; bookmarkId: string|null}[]}}).__SLAX_UI_RSS_STATE__;
          const body = {name: String(action.name), owner, firstSync: rssStreamFirstSync,
            rssSubscriptions: snapshot.counts.subscriptions, rssEntries: snapshot.counts.entries, bookmarks: snapshot.counts.bookmarks,
            otherOwnerRows: snapshot.counts.otherOwnerRows, historyRows: snapshot.counts.historyRows,
            ownRemarkVisible: controller?.subscriptions?.some(row => row.remark?.includes(owner === 'a' ? 'Owner A' : 'Owner B')) ?? false,
            otherRemarkVisible: controller?.subscriptions?.some(row => row.remark?.includes(owner === 'a' ? 'Owner B' : 'Owner A')) ?? false,
            liveEntryVisible: controller?.entries?.some(row => row.id === 'rss-local-entry-live') ?? false};
          await request('/fixture/checkpoints', body); await capture(); return true;
        }
        if (action.kind === 'real-sync-switch-owner') {
          const owner = action.owner === 'B' ? 'B' : 'A', next = await sessionFor(owner);
          rssStreamFirstSync = false; await runtime.sessions.accept(next.token, next.userId); currentSession = {owner, userId: next.userId, token: next.token}; observeRssStream(); await capture(); return true;
        }
        if (action.kind === 'real-sync-control') {await control(String(action.operation), action.details && typeof action.details === 'object' ? action.details as Record<string, unknown> : {}); return true;}
        if (action.kind === 'real-sync-labs') {await runtime.api.rssEnable(action.enabled === true); return true;}
        if (action.kind === 'real-sync-wait') {
          const timeoutMs = Math.min(15000, Math.max(0, Number(action.timeoutMs) || 0)), started = Date.now();
          const predicate = String(action.predicate ?? 'rss-ready');
          do {
            const state = (globalThis as typeof globalThis & {__SLAX_UI_RSS_STATE__?: {ready?: boolean; enabled?: boolean; subscriptions?: unknown[]; entries?: unknown[]}}).__SLAX_UI_RSS_STATE__;
            const snap = await databaseSnapshot(runtime, currentSession?.owner ?? 'A');
            if (predicate === 'rss-ready' && state?.ready || predicate === 'rss-stream-first-sync' && rssStreamFirstSync || predicate === 'one-subscription' && snap.counts.subscriptions === 1 || predicate === 'two-subscriptions' && snap.counts.subscriptions === 2 || predicate === 'zero-subscriptions' && snap.counts.subscriptions === 0 || predicate === 'one-entry' && snap.counts.entries === 1 || predicate === 'two-entries' && snap.counts.entries === 2) {await capture(); return true;}
            await new Promise(resolve => setTimeout(resolve, 250));
          } while (Date.now() - started < timeoutMs);
          await capture(); throw new Error(`Real RSS sync wait timed out: ${predicate}`);
        }
        return false;
      });
      stopActions = () => {stopHandler(); releaseScope();};
      if (!initialEmptyReceiptReused) {
        const serviceStatus = await request('/fixture/status') as {apiAvailable?: boolean; syncAvailable?: boolean};
        const empty = await databaseSnapshot(runtime, 'A');
        check(serviceStatus.apiAvailable === true && serviceStatus.syncAvailable === false, 'Fresh-empty checkpoint requires the local API up and sync transport gate closed');
        check(empty.counts.subscriptions === 0 && empty.feeds.length === 0 && empty.counts.entries === 0 && empty.counts.bookmarks === 0 && empty.counts.otherOwnerRows === 0 && empty.counts.historyRows === 0,
          'Fresh real-sync database must contain no RSS, bookmark, owner-private, or history rows before sync is enabled');
        check(!rssStreamFirstSync, 'RSS stream cannot have first-synced before the fresh-empty checkpoint');
        await request('/fixture/checkpoints', {name: 'fresh-empty', owner: 'a', firstSync: false, rssSubscriptions: 0, rssEntries: 0, bookmarks: 0,
          otherOwnerRows: 0, historyRows: 0, ownRemarkVisible: false, otherRemarkVisible: false, liveEntryVisible: false});
        emptyReceiptFile.write(JSON.stringify({kind: 'rss-real-sync-fresh-empty', version: 1, runId: RUN_ID,
          bundleId: 'app.slax.reader.uifixture.rssacceptance', scopeUri: scope.uri, acceptedAt: new Date().toISOString()}));
      }
      const fixtureControl: FixtureControl = {
        scenario: SCENARIO, locale: 'en', inputSha256, scopeUri: scope.uri,
        plannedActions: [{kind: 'select-list', list: 'rss'}],
        setSync() {throw new Error('Real PowerSync transport state cannot be changed through the synthetic fixture control');},
        async setNetwork() {throw new Error('Real network state cannot be changed through the synthetic fixture control');},
        async setLocale(locale) {
          check(locale === 'en', 'Real-sync fixture supports only the seeded English locale');
          await runtime.preferences.update(values => {values.user_language = locale;});
        },
        selectCase(scenario) {check(scenario === SCENARIO, 'Real-sync fixture cannot switch to a synthetic scenario');},
        async perform(input: FixtureAction|number) {
          const action = typeof input === 'number' ? this.plannedActions[input] as FixtureAction|undefined : input;
          check(action, 'Unknown real-sync fixture action');
          return {handler: await fixtureActions.dispatch(action), nativeInteractionVerified: false as const};
        },
        captureContext: capture,
      };
      globalThis.__SLAX_UI_FIXTURE__ = fixtureControl;
      await capture();
      if (active) setRuntime(runtime); else await runtime.stop();
    };
    void run().catch(reason => {if (active) setError(reason instanceof Error ? reason.message : 'Unable to start real RSS sync fixture'); void dataRuntime?.stop().catch(() => undefined);});
    return () => {active = false;
      const control = (globalThis as typeof globalThis & {__SLAX_UI_FIXTURE__?: {scopeUri?: string}}).__SLAX_UI_FIXTURE__;
      if (control?.scopeUri === scope.uri) delete (globalThis as typeof globalThis & {__SLAX_UI_FIXTURE__?: unknown}).__SLAX_UI_FIXTURE__;
      stopActions?.(); stopSession?.(); stopUpgrade?.(); stopPrefs?.(); appState?.remove(); void dataRuntime?.stop().catch(() => undefined);};
  }, []);
  const activeRuntime = runtime;
  const session = useSyncExternalStore(activeRuntime?.sessions.subscribe ?? noSubscribe, activeRuntime?.sessions.getSnapshot ?? getLoadingSession, activeRuntime?.sessions.getSnapshot ?? getLoadingSession);
  const upgrade = useSyncExternalStore(activeRuntime?.subscribeUpgrade ?? noSubscribe, activeRuntime?.getUpgradeSnapshot ?? getIdleUpgrade, activeRuntime?.getUpgradeSnapshot ?? getIdleUpgrade);
  const [settings, setSettings] = useState<Record<string, string|number|boolean|string[]>>({});
  useEffect(() => activeRuntime?.preferences.subscribe(setSettings), [activeRuntime]);
  const context = useMemo<MobileContextValue|null>(() => {
    if (!activeRuntime || !runtime) return null;
    const owner = activeRuntime.getNativeResourceOwner(), repositories = owner ? activeRuntime.getRepositories() : null;
    const preferences = activeRuntime.getAccountPreferences() ?? activeRuntime.preferences, locale = normalizeLocale(typeof settings.user_language === 'string' ? settings.user_language : 'en');
    const t = createTranslator(locale), payments = new PaymentController(createExpoStore(), activeRuntime.sessions, preferences, activeRuntime.api.checkIapResult);
    return {runtime: activeRuntime, api: activeRuntime.api, preferences, sessions: activeRuntime.sessions, nativeResourceOwner: owner, repositories,
      cache: owner ? activeRuntime.getCache() : null, session, upgrade, settings, locale, t, config: {...mobileConfig, apiUrl: API, isBeta: false}, payments,
      webSession: {ready: false, error: null}, retryStart: async () => {await activeRuntime.stop(); await activeRuntime.start();},
      fixtureOnly: {network: {isConnected: network.isConnected ?? false, isInternetReachable: network.isInternetReachable ?? false}, dataDirectory: scope.uri}};
  }, [activeRuntime, runtime, revision, session, upgrade, settings, network]);
  if (error) throw new Error(`RSS real-sync fixture startup failed: ${error}`);
  return <GestureHandlerRootView style={{flex: 1}}><SafeAreaProvider><StatusBar barStyle="dark-content"/>
    {context ? <FixtureMobileProvider value={context}><ApplicationRoutes/></FixtureMobileProvider> : <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}><ActivityIndicator/></View>}
  </SafeAreaProvider></GestureHandlerRootView>;
}
