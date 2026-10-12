import React, {useEffect, useState} from 'react';
import {Platform, ScrollView, Text} from 'react-native';
import {File, Paths} from 'expo-file-system';
import {PowerSyncDatabase} from '@powersync/react-native';
import {createMobileSchema} from '../../src/data/schema.ts';
import {loadLegacyBridge, nativePreferenceStorage} from '../../src/data/native-storage.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {migrateLegacyPreferences} from '../../src/data/legacy-preferences.ts';
import {openVerifiedDatabase, unchangedDatabaseData, type DatabaseSnapshot} from '../../src/data/adoption.ts';
import {uploadPendingTransactions} from '../../src/data/uploader.ts';
import {ApiError} from '../../src/data/api.ts';
import {controlledNativeFixturePaths} from './native-fixture-paths.ts';

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const localFile = (path: string) => new File(`file://${encodeURI(path)}`);
interface FixtureTransaction {transactionId?: number; crud: {clientId: number; id: string; op: string; table: string; opData: unknown; previousValues: unknown}[]}
async function pending(database: PowerSyncDatabase): Promise<FixtureTransaction[]> {
  const result: FixtureTransaction[] = [];
  for await (const transaction of database.getCrudTransactions()) result.push({transactionId: transaction.transactionId, crud: transaction.crud.map(entry => ({clientId: entry.clientId, id: entry.id, op: entry.op, table: entry.table, opData: entry.opData ?? null, previousValues: entry.previousValues ?? null}))});
  return result;
}
function equal(a: unknown, b: unknown) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
/** This test component is never mounted by the production entry point. */
export async function runNativeAdoptionFixture() {
  check(__DEV__ && ['android', 'ios'].includes(Platform.OS), 'This controlled fixture requires a native development build');
  // The marker is checked before inventory or database access. Missing marker means no database is opened.
  const iosContainer = decodeURIComponent(Paths.document.uri).replace(/^file:\/\//, '').replace(/\/Documents\/?$/, '');
  const markerRoot = Platform.OS === 'android' ? '/data/user/0/com.slax.reader' : `${iosContainer}/Library/Application Support`;
  const reportDirectory = Platform.OS === 'android' ? `${markerRoot}/files` : markerRoot;
  const marker = localFile(`${reportDirectory}/legacy-fixture-report.json`);
  check(marker.exists, 'Install and launch the original Kotlin fixture in a fresh isolated emulator or simulator first');
  const source = JSON.parse(await marker.text()) as {controlledFixture?: boolean; fixtureVersion: number; androidBundleId?: string; iosBundleId?: string; nativePlatform?: string; producer: string; coreVersion: string; databasePath: string; transactions: FixtureTransaction[]; localJson: string};
  const platformIdentity = Platform.OS === 'android' ? source.androidBundleId === 'com.slax.reader' : source.iosBundleId === 'app.slax.reader' && source.nativePlatform === 'ios-simulator';
  check(source.controlledFixture === true && source.fixtureVersion === 1 && platformIdentity && source.producer === 'powersync-kotlin-1.14.1' && source.coreVersion.startsWith('0.5.1/'), 'Unrecognized controlled fixture marker');
  const {databasePaths: allowedPaths, cacheRoot: root, containerRelocated} = controlledNativeFixturePaths(Platform.OS, markerRoot, source.databasePath);
  check(source.transactions.length === 2 && source.transactions.flatMap(transaction => transaction.crud).map(entry => entry.id).join(',') === 'tag-1,bookmark-1,bookmark-1,comment-1', 'This database is outside the synthetic fixture identity');
  const requestFile = localFile(`${reportDirectory}/native-adoption-fault-request.json`);
  const firstRequest = requestFile.exists ? JSON.parse(await requestFile.text()) as {kind?: string; version?: number; runId?: string; requestedAt?: number; phase?: string; originalDatabasePath?: string} : undefined;
  if (firstRequest) check(firstRequest.kind === 'slax-native-adoption-fault-request' && firstRequest.version === 1 && /^[a-zA-Z0-9-]{1,64}$/.test(firstRequest.runId ?? '') && Number.isSafeInteger(firstRequest.requestedAt) && (firstRequest.requestedAt ?? 0) > 0 && ['hold-before-first-sdk-open', 'resume-first-sdk-open'].includes(firstRequest.phase ?? '') && firstRequest.originalDatabasePath === source.databasePath, 'Unrecognized first-adoption fault request');
  if (firstRequest) check(!localFile(`${reportDirectory}/native-adoption-report.json`).exists, 'First-upgrade interruption requires a fresh original fixture, not a completed upgrade');
  const bridge = loadLegacyBridge(), preferences = new PreferenceStore(nativePreferenceStorage(bridge));
  let database: PowerSyncDatabase | null = null, owns = false;
  const schema = await createMobileSchema();
  try {
    let inventory = await bridge.beginDataOwnership(); owns = true;
    check(inventory.databaseCandidates.length === 1 && allowedPaths.includes(inventory.databaseCandidates[0]!), 'The fixture has an ambiguous legacy owner');
    const databasePath = inventory.databaseCandidates[0]!;
    const evidence = {databasePath, legacySdk: 'powersync-kotlin-1.14.1', targetSdk: 'powersync-react-native-2.3.1', schemaVersion: '2', supportedOnDiskAdoption: true, verifiedFixtures: {pendingQueue: true, transactionBoundaries: true, offlineRows: true, localJson: true, reconnectOrder: true}, report: 'Controlled fixture exercise only; this does not enable production adoption'} as const;
    const open = () => openVerifiedDatabase({inventory, evidence, inspector: bridge, preferences, open: async location => {
      if (firstRequest?.phase === 'hold-before-first-sdk-open') {
        const snapshot = await bridge.inspectLegacyDatabase(databasePath);
        check(snapshot.pendingOperations === 4 && snapshot.pendingTransactions === 2, 'First interruption requires the genuine original pending queue');
        check(JSON.parse(String((await preferences.read())._slax_database_adoption_v1)).phase === 'opening', 'The production opening checkpoint was not committed');
        localFile(`${reportDirectory}/native-adoption-fault-state.json`).write(JSON.stringify({kind: 'slax-native-adoption-fault-state', version: 1, runId: firstRequest.runId, phase: firstRequest.phase, requestedAt: firstRequest.requestedAt, writtenAt: Date.now(), readyForExternalKill: true, baseline: snapshot, sdkOpened: false}, null, 2));
        return await new Promise<never>(() => {});
      }
      const db = new PowerSyncDatabase({schema, database: {dbFilename: location.dbFilename, dbLocation: location.dbLocation}});
      try {await db.init(); return db;} catch (error) {await db.close(); throw error;}
    }});
    const legacyPreferences = await bridge.readLegacyPreferences();
    check(legacyPreferences !== null, 'Original AndroidX preference fixture is missing');
    await migrateLegacyPreferences(preferences, bridge);
    const values = await preferences.read();
    check(values.auth_token === 'fixture-auth-token-NOT-A-REAL-CREDENTIAL' && values.user_id === 'synthetic-user' && values.last_refresh_time === '1700000000', 'Original session preference values changed');
    check(values.powersync_refresh_time === 1700000000123 && values.cache_count === -1 && values.download_images === 1 && values.selected_env === 'BETA' && values.analytics_device_id === 'fixture-stable-device-id', 'Original settings or timestamp units changed');
    check(values.user_language === 'zh-CN' && values.user_setting_detail_do_not_alert === '1' && values.future_boolean === true && equal(values.future_strings, ['one', 'two']), 'Original or future preference fields changed');
    check(JSON.parse(String(values.continue_reading_bookmark)).collectionOwnerId === 'synthetic-owner', 'Continue-reading owner context changed');
    check(equal(await bridge.readLegacyPreferences(), legacyPreferences), 'Preference migration changed the original DataStore file');
    const before = await bridge.inspectLegacyDatabase(databasePath);
    if (firstRequest?.phase === 'resume-first-sdk-open') {
      const state = JSON.parse(await localFile(`${reportDirectory}/native-adoption-fault-state.json`).text()) as {kind?: string; version?: number; runId?: string; phase?: string; readyForExternalKill?: boolean; baseline: DatabaseSnapshot};
      check(state.kind === 'slax-native-adoption-fault-state' && state.version === 1 && state.runId === firstRequest.runId && state.phase === 'hold-before-first-sdk-open' && state.readyForExternalKill === true && unchangedDatabaseData(state.baseline, before), 'The original queue changed across first-upgrade interruption');
      check(JSON.parse(String((await preferences.read())._slax_database_adoption_v1)).phase === 'opening', 'The original interrupted opening checkpoint is missing');
    }
    database = await open();
    const {version: coreVersion} = await database.get<{version: string}>('SELECT powersync_rs_version() AS version');
    check(coreVersion.startsWith('0.5.3/'), 'The controlled upgrade did not load the pinned native core');
    check(equal(await pending(database), source.transactions), 'Legacy CRUD values, identifiers, order or transaction boundaries changed');
    check((await database.get<{data: string}>('SELECT data FROM ps_data_local__local_bookmark_info WHERE id=?', ['bookmark-1'])).data === source.localJson, 'Hidden local JSON changed');
    check(unchangedDatabaseData(before, await bridge.inspectLegacyDatabase(databasePath)), 'Schema initialization modified offline or pending data');
    check(localFile(`${root}/bookmark/bookmark-1/content.html`).textSync().includes('Controlled offline fixture'), 'The original cached article is unavailable');
    await database.writeTransaction(async transaction => {
      await transaction.execute('UPDATE sr_user_bookmark SET alias_title=? WHERE id=?', ['After upgrade, still offline', 'bookmark-1']);
      await transaction.execute('INSERT INTO sr_user_tag(id,user_id,tag_name,display) VALUES(?,?,?,?)', ['tag-3', 'synthetic-user', 'new-offline', 'New offline']);
    });
    const afterWrite = await pending(database); check(afterWrite.length === 3 && afterWrite[2]!.crud.map(entry => entry.clientId).join(',') === '5,6', 'New offline writes did not extend the same queue');
    await database.close(); database = null; await bridge.endDataOwnership(); owns = false;
    inventory = await bridge.beginDataOwnership(); owns = true; database = await open();
    check(equal(await pending(database), afterWrite), 'Interrupted/offline reopen changed pending writes');
    let failed = false;
    try {await uploadPendingTransactions(database, async () => {throw new ApiError(503, 'Synthetic offline retry');});} catch {failed = true;}
    check(failed && equal(await pending(database), afterWrite), 'A retryable upload lost queue data');
    const uploadedIds: string[] = [];
    await uploadPendingTransactions(database, async changes => {uploadedIds.push(...changes.map(change => change.id));});
    check(uploadedIds.join(',') === 'tag-1,bookmark-1,bookmark-1,comment-1,bookmark-1,tag-3', 'Upload order changed across the upgrade');
    check((await pending(database)).length === 0, 'Completed transactions remained pending');
    const report = {status: 'passed', platform: Platform.OS, sdk: 'powersync-react-native-2.3.1', sdkVersion: database.sdkVersion, coreVersion, databasePath, originalDatabasePath: source.databasePath, containerRelocated, nativeDriver: 'OP-SQLite', sameIdentityReplacement: true, pendingQueue: true, transactionBoundaries: true, offlineRows: true, hiddenLocalJson: true, originalCache: true, originalAndroidXPreferences: true, originalPreferencesUntouched: true, interruptionAfterOfflineWrite: true, retryRetainsQueue: true, uploadOrder: true, firstUpgradeInterruption: firstRequest?.phase === 'resume-first-sdk-open', logicalIdentityReturned: !!inventory.databaseIdentities?.[databasePath], serviceReconnect: false, releaseSignedUpgrade: false, ios: Platform.OS === 'ios'};
    localFile(`${reportDirectory}/native-adoption-report.json`).write(JSON.stringify(report, null, 2));
    if (firstRequest?.phase === 'resume-first-sdk-open') localFile(`${reportDirectory}/native-adoption-fault-state.json`).write(JSON.stringify({kind: 'slax-native-adoption-fault-state', version: 1, runId: firstRequest.runId, phase: firstRequest.phase, requestedAt: firstRequest.requestedAt, writtenAt: Date.now(), readyForExternalKill: false, baseline: await bridge.inspectLegacyDatabase(databasePath)}, null, 2));
    return report;
  } finally {if (database) await database.close(); if (owns) await bridge.endDataOwnership();}
}
export default function NativeAdoptionFixtureApp() {
  check(__DEV__ && ['android', 'ios'].includes(Platform.OS), 'This controlled fixture requires a native development build');
  const container = decodeURIComponent(Paths.document.uri).replace(/^file:\/\//, '').replace(/\/Documents\/?$/, '');
  const directory = Platform.OS === 'android' ? '/data/user/0/com.slax.reader/files' : `${container}/Library/Application Support`;
  if (localFile(`${directory}/native-runtime-lifecycle-request.json`).exists) {
    const Lifecycle = require('./NativeRuntimeLifecycleFixtureApp.tsx').default as React.ComponentType;
    return <Lifecycle/>;
  }
  if (localFile(`${directory}/native-upgrade-ui-request.json`).exists) {
    const Visible = require('./NativeUpgradeVisibleFixtureApp.tsx').default as React.ComponentType;
    return <Visible/>;
  }
  return <NativeAdoptionFixtureRunner/>;
}

function NativeAdoptionFixtureRunner() {
  const [result, setResult] = useState('Running controlled PowerSync native adoption fixture…');
  useEffect(() => {
    const run = async () => {
      check(__DEV__ && ['android', 'ios'].includes(Platform.OS), 'This controlled fixture requires a native development build');
      const container = decodeURIComponent(Paths.document.uri).replace(/^file:\/\//, '').replace(/\/Documents\/?$/, '');
      const directory = Platform.OS === 'android' ? '/data/user/0/com.slax.reader/files' : `${container}/Library/Application Support`;
      // Only the explicitly selected development fixture reads these synthetic control files.
      if (localFile(`${directory}/native-stream-request.json`).exists) return require('./NativeStreamingFixture.ts').runNativeStreamingFixture();
      if (localFile(`${directory}/native-runtime-start-request.json`).exists) return require('./NativeRuntimeStartupFixture.ts').runNativeRuntimeStartupFixture();
      if (localFile(`${directory}/native-preference-cas-request.json`).exists) return require('./NativePreferenceCasFixture.ts').runNativePreferenceCasFixture();
      const request = localFile(`${directory}/native-adoption-fault-request.json`);
      if (request.exists) {
        const phase = (JSON.parse(await request.text()) as {phase?: string}).phase;
        if (phase === 'service-reconnect' || phase === 'service-first-upgrade' || phase === 'hold-service-first-upgrade' || phase === 'resume-service-first-upgrade') return require('./NativeServiceReconnectFixture.ts').runNativeServiceReconnectFixture();
        if (phase === 'hold-before-first-sdk-open' || phase === 'resume-first-sdk-open') return runNativeAdoptionFixture();
        return require('./NativeAdoptionFaultFixture.ts').runNativeAdoptionFaultFixture();
      }
      return runNativeAdoptionFixture();
    };
    void run().then(report => setResult(JSON.stringify(report, null, 2))).catch(error => setResult(`FAILED: ${error instanceof Error ? error.message : 'Fixture failure'}`));
  }, []);
  return <ScrollView contentContainerStyle={{padding: 24}}><Text selectable>{result}</Text></ScrollView>;
}
