import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Platform, StatusBar, Text, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {File, Paths} from 'expo-file-system';
import {requireNativeModule} from 'expo';
import {ApplicationRoutes, navigationRef} from '../../src/App';
import {ControlledUpgradeFixtureProvider, type MobileContextValue, type ControlledUpgradeReaderObserver, type ControlledUpgradeReaderObservation} from '../../src/runtime';
import {createMobileDataRuntime} from '../../src/data/runtime.ts';
import {loadLegacyBridge} from '../../src/data/native-storage.ts';
import {createTranslator, normalizeLocale} from '../../src/i18n';
import {PaymentController, type StorePort} from '../../src/payments/controller.ts';
import {createMobileTelemetry} from '../../src/telemetry/core.ts';
import {mobileConfig} from '../../src/config';
import {throwIfAborted} from '../../src/utils/abort.ts';
import {CONTROLLED_VISIBLE_INPUT_SHA256, upgradeVisibilityPhase, validateVisibleLegacyProducer, validatePreReconnectVisibility, validatePostServiceVisibility, sameControlledValue} from '../../src/controlled-upgrade-visibility.ts';
import {unchangedDatabaseData, type DatabaseSnapshot} from '../../src/data/adoption.ts';
import type {LegacyInventory} from '../../src/data/upgrade.ts';
import type {SlaxLegacyBridge} from '../../src/data/native-storage.ts';
import {REVIEWED_ADOPTION_PROFILE} from '../../src/data/adoption-profile.ts';
import {decodeLegacyPreferences} from '../../src/data/legacy-preferences.ts';

const INPUT_SHA256 = CONTROLLED_VISIBLE_INPUT_SHA256;
const file = (location: string) => new File(`file://${encodeURI(location)}`);
function check(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
const deniedStore = (): StorePort => {
  const refuse = async () => {throw new Error('StoreKit operations are outside the controlled visible-upgrade test');};
  return {start: refuse, products: refuse, purchase: refuse, finish: refuse, restore: refuse, pending: refuse, entitlements: refuse, stop: async () => {}};
};

/** Actual production screens, repositories and cache from a new genuine old-SDK installation. */
export default function NativeUpgradeVisibleFixtureApp() {
  const [value, setValue] = useState<MobileContextValue|null>(null), [error, setError] = useState(''), [device, setDevice] = useState('');
  const [readerObserver, setReaderObserver] = useState<ControlledUpgradeReaderObserver|undefined>(undefined);
  useEffect(() => {
    let active = true, stopCapture: ReturnType<typeof setInterval>|undefined;
    let runtime: ReturnType<typeof createMobileDataRuntime>|undefined;
    const unsubscribe: (() => void)[] = [];
    const prepare = async () => {
      check(__DEV__ && ['ios', 'android'].includes(Platform.OS), 'Only a selected native development fixture may render');
      const container = decodeURIComponent(Paths.document.uri).replace(/^file:\/\//, '').replace(/\/Documents\/?$/, '');
      const directory = Platform.OS === 'android' ? '/data/user/0/com.slax.reader/files' : `${container}/Library/Application Support`;
      const cacheDirectory = Platform.OS === 'android' ? '/data/user/0/com.slax.reader' : directory;
      const read = async (name: string) => JSON.parse(await file(`${directory}/${name}`).text()) as Record<string, unknown>;
      const requestText = await file(`${directory}/native-upgrade-ui-request.json`).text();
      check(requestText.length <= 8192, 'The controlled visible request must be bounded');
      const request = JSON.parse(requestText) as Record<string, unknown>;
      check(request.kind === 'slax-controlled-visible-upgrade-request' && request.version === 1 && request.platform === Platform.OS && typeof request.device === 'string' && /^[0-9a-f-]{36}$/.test(String(request.nonce)) && Number.isSafeInteger(request.requestedAt) && request.visibleInputsSHA256 === INPUT_SHA256, 'Unrecognized controlled visible-upgrade request');
      check(Platform.OS === 'ios' ? directory.includes(`/CoreSimulator/Devices/${request.device}/data/Containers/Data/Application/`) : /^emulator-\d+$/.test(request.device), 'Only the exact controlled simulator or emulator may render');
      const source = await read('legacy-fixture-report.json');
      validateVisibleLegacyProducer(source, Platform.OS);
      check(typeof request.runId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(request.runId), 'A controlled fresh run identifier is required');
      const phase = upgradeVisibilityPhase(request.phase);
      let serviceText: string|undefined, startup: Record<string, unknown>|undefined;
      if (phase === 'pre-reconnect') {
        for (const name of ['native-service-report.json', 'native-adoption-report.json', 'native-runtime-start-report.json']) check(!file(`${directory}/${name}`).exists, 'Preserve prior acceptance; pre-reconnect visibility requires a fresh original queue');
      } else {
        serviceText = await file(`${directory}/native-service-report.json`).text();
        const service = JSON.parse(serviceText) as Record<string, unknown>; startup = await read('native-runtime-start-report.json');
        validatePostServiceVisibility(Platform.OS, request.device, service, startup);
        check(service.runId === request.runId, 'Complete this exact six-operation service run first');
      }
      const actual = loadLegacyBridge(), credentials = await actual.readPreferences(), originalPreferences = await actual.readLegacyPreferences();
      const visibilityRequestMd5 = actual.md5String(requestText);
      check(originalPreferences, 'The controlled original preferences are required');
      const originalValues = decodeLegacyPreferences(new Uint8Array(originalPreferences.bytes));
      check(originalValues.auth_token === 'fixture-auth-token-NOT-A-REAL-CREDENTIAL' && originalValues.user_id === 'synthetic-user', 'Another original account cannot enter this controlled renderer');
      check((phase === 'pre-reconnect' && credentials.values.auth_token === undefined && credentials.values.user_id === undefined)
        || (credentials.values.auth_token === 'fixture-auth-token-NOT-A-REAL-CREDENTIAL' && credentials.values.user_id === 'synthetic-user'), 'Another current account cannot enter this controlled renderer');
      if (startup && serviceText) check(startup.completedServiceReportMd5 === actual.md5String(serviceText), 'The current normal-start report must bind this exact service run');
      const cachedBefore = phase === 'pre-reconnect' ? await file(`${cacheDirectory}/bookmark/bookmark-1/content.html`).text() : undefined;
      const inspections: DatabaseSnapshot[] = [];
      let inventory: LegacyInventory|undefined;
      const observedBridge: SlaxLegacyBridge = {
        beginDataOwnership: async () => {inventory = await actual.beginDataOwnership(); return inventory;}, endDataOwnership: () => actual.endDataOwnership(),
        inspectLegacyDatabase: async location => {const value = await actual.inspectLegacyDatabase(location); inspections.push(value); return value;},
        readLegacyPreferences: () => actual.readLegacyPreferences(), readPreferences: () => actual.readPreferences(),
        compareAndSwapPreferences: (revision, values) => actual.compareAndSwapPreferences(revision, values),
        newIdentifier: () => actual.newIdentifier(), md5String: value => actual.md5String(value),
      };
      const refusedRequests: string[] = [];
      runtime = createMobileDataRuntime({platform: Platform.OS as 'ios'|'android', version: 'controlled-visible-upgrade', baseUrl: 'http://127.0.0.1:9', betaBaseUrl: 'http://127.0.0.1:9', localSyncEndpoint: 'http://127.0.0.1:9',
        ...(phase === 'pre-reconnect' ? {nativeBridge: observedBridge} : {}),
        fetch: async (input, init) => {
          throwIfAborted(init?.signal);
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
          check(url.origin === 'http://127.0.0.1:9', 'The visible-upgrade renderer refuses every external origin');
          if (refusedRequests.length < 128) refusedRequests.push(url.pathname);
          return new Response(JSON.stringify({code: 403, message: 'Controlled offline transport refuses forwarding', data: null}), {status: 403, headers: {'Content-Type': 'application/json'}});
        },
      });
      const current = runtime;
      await current.start();
      if (!active) {await current.stop(); return;}
      const repositories = current.getRepositories(), cache = current.getCache();
      const account = current.sessions.getSnapshot();
      check(repositories && cache?.dataDirectory === cacheDirectory && current.getNativeResourceOwner() && account.status === 'authenticated'
        && account.session.userId === 'synthetic-user' && account.session.token === 'fixture-auth-token-NOT-A-REAL-CREDENTIAL', 'Actual account-bound native services are unavailable');
      const bookmark = await repositories.getBookmark('bookmark-1'), database = current.getDatabase();
      check(bookmark?.archiveStatus === 0 && bookmark.status === 'success' && bookmark.isStarred === 1 && bookmark.downloadStatus === 2 && database, 'The genuine full-row fixture cannot enter the normal inbox/detail routes');
      const comments = await database.getAll<{id: string; type: number; comment: string}>('SELECT id,type,comment FROM sr_bookmark_comment WHERE user_bookmark_uuid=?', ['bookmark-1']);
      check(comments.length === 1 && comments[0]?.id === 'comment-1' && comments[0].type === 2 && comments[0].comment === 'Pending comment', 'The original visible comment is missing');
      const cached = await cache.readArticle('bookmark-1');
      check(typeof cached === 'string' && cached.includes('id="controlled-quote"') && cached.includes('Controlled offline fixture') && cached.includes('controlled-paragraph-18'), 'Use the actual source-written cached article');
      const nativeOwner = current.getNativeResourceOwner();
      const pending = async () => {
        const values = [];
        for await (const transaction of database.getCrudTransactions()) values.push({transactionId: transaction.transactionId, crud: transaction.crud.map(entry => ({clientId: entry.clientId, id: entry.id, op: entry.op, table: entry.table, opData: entry.opData ?? null, previousValues: entry.previousValues ?? null}))});
        return values;
      };
      let offlineReport: Record<string, unknown>|undefined;
      if (phase === 'pre-reconnect') {
        check(inventory?.databaseCandidates.length === 1 && inspections.length >= 2 && unchangedDatabaseData(inspections[0]!, inspections[1]!), 'Normal adoption changed the original raw database');
        const databasePath = inventory.databaseCandidates[0]!;
        const afterAccountStart = await actual.inspectLegacyDatabase(databasePath);
        const local = await database.get<{data: string}>('SELECT data FROM ps_data_local__local_bookmark_info WHERE id=?', ['bookmark-1']);
        const core = await database.get<{value: string}>('SELECT powersync_rs_version() AS value');
        check(core.value === REVIEWED_ADOPTION_PROFILE.targetCore && `powersync-react-native-${database.sdkVersion}` === REVIEWED_ADOPTION_PROFILE.targetSdk, 'The actual SDK/core differs from the reviewed production profile');
        check(bookmark.isRead === 0 && bookmark.aliasTitle === 'Offline article' && cached === cachedBefore && local.data === source.localJson
          && sameControlledValue(await actual.readLegacyPreferences(), originalPreferences) && unchangedDatabaseData(inspections[0]!, afterAccountStart), 'Offline startup changed the original visible edits, cache, JSON or preferences');
        offlineReport = {...request, kind: 'slax-controlled-pre-reconnect-visible-startup', version: 1, status: 'passed', capturedAt: Date.now(), visibilityRequestMd5,
          normalCreateMobileDataRuntimeExecuted: true, explicitAdoptionEvidenceProvided: false, networkRequestsForwarded: 0, actualNativeResourceOwner: nativeOwner,
          before: inspections[0], afterSchema: inspections[1], afterAccountStart, pending: await pending(), nativeDatabaseIdentity: inventory.databaseIdentities?.[databasePath],
          originalLocalRows: await database.getAll<{id: string; data: string}>('SELECT id,data FROM ps_data_local__local_bookmark_info ORDER BY id'),
          actualSdkVersion: database.sdkVersion, actualCoreVersion: core.value, originalCacheRetained: true, originalLocalJsonRetained: true, originalPreferencesUntouched: true,
          originalBookmarkTagCommentAvailableInNormalRepositories: true, originalDataStoreFingerprint: originalPreferences.fingerprint, sourceCachedArticleMd5: actual.md5String(cached),
          visibleScreenshotsAndInputAcceptance: false};
        validatePreReconnectVisibility(source, request, offlineReport, nativeOwner!);
        file(`${directory}/native-upgrade-offline-report.json`).write(JSON.stringify(offlineReport, null, 2));
      }
      const readerEvents: ControlledUpgradeReaderObservation[] = [];
      const observeReader: ControlledUpgradeReaderObserver = event => {
        try {
          if (!active || !__DEV__ || !nativeOwner || current.getNativeResourceOwner() !== nativeOwner || event.cacheKey !== 'bookmark-1' || !Number.isFinite(event.observedAt) || event.observedAt < (request.requestedAt as number)) return;
          const liveText = file(`${directory}/native-upgrade-ui-request.json`).textSync();
          if (actual.md5String(liveText) !== visibilityRequestMd5) return;
          const live = JSON.parse(liveText) as Record<string, unknown>;
          if (live.kind !== request.kind || live.version !== request.version || live.device !== request.device || live.platform !== request.platform || live.runId !== request.runId || live.nonce !== request.nonce || live.requestedAt !== request.requestedAt || live.visibleInputsSHA256 !== INPUT_SHA256) return;
          const serialized = JSON.stringify(event);
          if (serialized.length > 8192) return;
          readerEvents.push(JSON.parse(serialized) as ControlledUpgradeReaderObservation);
          if (readerEvents.length > 128) readerEvents.shift();
          file(`${directory}/native-upgrade-reader-lifecycle.json`).write(JSON.stringify({kind: 'slax-controlled-visible-upgrade-reader-observations', version: 1, platform: Platform.OS, device: request.device, runId: request.runId, nonce: request.nonce, requestedAt: request.requestedAt, visibleInputsSHA256: INPUT_SHA256, visibilityRequestMd5, actualNativeResourceOwner: nativeOwner, observationsOnly: true, events: readerEvents}, null, 2));
        } catch { /* Missing observations cannot change the production reader's behavior. */ }
      };
      setReaderObserver(() => observeReader);
      const payments = new PaymentController(deniedStore(), current.sessions, current.preferences, async () => {throw new Error('Purchases are outside this controlled test');});
      const telemetry = createMobileTelemetry({preferences: current.preferences, api: current.api, platform: Platform.OS as 'ios'|'android', version: 'controlled-visible-upgrade', locale: () => 'zh', generateIdentifier: () => actual.newIdentifier(), captureRequestScope: () => current.sessions.captureRequestScope()});
      const refresh = async () => {
        const settings = await current.preferences.read(); if (!active) return;
        const locale = normalizeLocale(typeof settings.user_language === 'string' ? settings.user_language : 'en');
        setValue({runtime: current, api: current.api, preferences: current.getAccountPreferences()!, sessions: current.sessions, repositories: current.getRepositories(), cache: current.getCache(), session: current.sessions.getSnapshot(), upgrade: current.getUpgradeSnapshot(), nativeResourceOwner: current.getNativeResourceOwner(), settings, locale, t: createTranslator(locale),
          config: {...mobileConfig, apiUrl: 'http://127.0.0.1:9', betaApiUrl: 'http://127.0.0.1:9', webUrl: 'http://127.0.0.1:9', webDomain: '127.0.0.1', isBeta: true}, payments, telemetryOverride: telemetry, webSession: {ready: false, error: null}, retryStart: async () => {throw new Error('Do not restart the controlled visible runtime from a screen');}});
      };
      unsubscribe.push(current.preferences.subscribe(() => {void refresh().catch(reason => {if (active) setError(String(reason));});}), current.sessions.subscribe(() => {void refresh().catch(reason => {if (active) setError(String(reason));});}));
      if (Platform.OS === 'ios') await requireNativeModule<{setPreferencesAsync(settings: Record<string, boolean>): Promise<void>}>('DevMenuPreferences').setPreferencesAsync({showFloatingActionButton: false, showsAtLaunch: false});
      setDevice(request.device); await refresh();
      let capturing = false;
      const capture = async () => {
        if (!active || capturing || !navigationRef.isReady()) return;
        capturing = true;
        try {
        const local = await repositories.local.read('bookmark-1');
        if (!active) return;
        const currentPending = phase === 'pre-reconnect' ? await pending() : undefined;
        const currentInspection = phase === 'pre-reconnect' ? await actual.inspectLegacyDatabase(inventory!.databaseCandidates[0]!) : undefined;
        const currentLocalRows = phase === 'pre-reconnect' ? await database.getAll<{id: string; data: string}>('SELECT id,data FROM ps_data_local__local_bookmark_info ORDER BY id') : undefined;
        const currentCacheMd5 = phase === 'pre-reconnect' ? actual.md5String(await cache.readArticle('bookmark-1') ?? '') : actual.md5String(cached);
        const currentPreferences = phase === 'pre-reconnect' ? await actual.readLegacyPreferences() : originalPreferences;
        const pendingUnchanged = phase !== 'pre-reconnect' || (sameControlledValue(currentPending, source.transactions)
          && currentInspection?.pendingOperations === 4 && currentInspection.pendingTransactions === 2
          && currentInspection.queueDigest === inspections[0]?.queueDigest && currentInspection.dataDigest === inspections[0]?.dataDigest
          && currentCacheMd5 === offlineReport?.sourceCachedArticleMd5 && sameControlledValue(currentPreferences, originalPreferences));
        if (!active) return;
        file(`${directory}/native-upgrade-ui-context.json`).write(JSON.stringify({kind: 'slax-controlled-visible-upgrade-context', version: 1, platform: Platform.OS, device: request.device, nonce: request.nonce, requestedAt: request.requestedAt, capturedAt: Date.now(), visibleInputsSHA256: INPUT_SHA256,
          phase, runId: request.runId, visibilityRequestMd5, currentPending, currentInspection, currentLocalRows, originalPendingQueueAndDataUnchanged: phase === 'pre-reconnect' ? pendingUnchanged : undefined,
          realProductionRoutesMounted: true, simulatedUiRowsOrHtml: false, fixtureOnlyProviderUsed: false, explicitAdoptionEvidenceProvided: false, normalRuntimeReady: current.getUpgradeSnapshot().status === 'ready', actualNativeResourceOwner: current.getNativeResourceOwner(),
          observedRoute: navigationRef.getCurrentRoute(), observedNavigationState: navigationRef.getRootState(), canGoBack: navigationRef.canGoBack(), initialBookmark: bookmark, originalComment: comments[0], currentLocalJson: local, sourceCachedArticleMd5: currentCacheMd5, originalDataStoreFingerprint: currentPreferences?.fingerprint,
          refusedRequestPaths: refusedRequests, networkRequestsForwarded: 0, nativeScreenshotsAndInteractionAcceptance: 'pending-external-XCTest-or-emulator-evidence', publisherUpgrade: false, testFlight: false}, null, 2));
        check(pendingUnchanged, 'Stop offline visibility acceptance: a product route changed the original pending queue');
        } finally {capturing = false;}
      };
      stopCapture = setInterval(() => {void capture().catch(reason => {if (active) setError(String(reason));});}, 500);
    };
    void prepare().catch(reason => {if (active) setError(reason instanceof Error ? reason.message : String(reason));});
    return () => {active = false; if (stopCapture) clearInterval(stopCapture); unsubscribe.forEach(stop => stop()); void runtime?.stop().catch(() => undefined);};
  }, []);
  return <GestureHandlerRootView style={{flex: 1}}><SafeAreaProvider><StatusBar barStyle="dark-content"/>
    {error ? <View style={{flex: 1, padding: 24, justifyContent: 'center'}}><Text selectable>{error}</Text></View> : value ? <ControlledUpgradeFixtureProvider value={value} device={device} onReaderObservation={readerObserver}><ApplicationRoutes/></ControlledUpgradeFixtureProvider> : <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}><ActivityIndicator/></View>}
  </SafeAreaProvider></GestureHandlerRootView>;
}
