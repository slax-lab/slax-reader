import {Platform} from 'react-native';
import {File, Paths} from 'expo-file-system';
import {fetch as expoFetch} from 'expo/fetch';
import {PowerSyncDatabase, SyncStreamConnectionMethod} from '@powersync/react-native';
import {createMobileSchema, LEGACY_MOBILE_TABLES, SYNC_PARAMETERS} from '../../src/data/schema.ts';
import {loadLegacyBridge, nativePreferenceStorage} from '../../src/data/native-storage.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import type {PreferenceSnapshot, PreferenceStorage, PreferenceValues} from '../../src/data/preferences.ts';
import {openVerifiedDatabase, unchangedDatabaseData, type DatabaseSnapshot} from '../../src/data/adoption.ts';
import {migrateLegacyPreferences} from '../../src/data/legacy-preferences.ts';
import {diffChanges} from '../../src/data/uploader.ts';
import type {SqlRow} from '../../src/data/uploader.ts';
import {SlaxApi} from '../../src/data/api.ts';
import type {SyncChange} from '../../src/data/api.ts';
import {SessionController} from '../../src/domain/session.ts';
import {createSyncConnector} from '../../src/data/connector.ts';
import {controlledNativeFixturePaths} from './native-fixture-paths.ts';
import {linkedAbortTimeout} from '../../src/utils/abort.ts';
import {materializedFixtureValuesMatch} from './native-service-materialization.ts';
import {validateServiceLocalJson} from './pre-reconnect-evidence.ts';

const file = (path: string) => new File(`file://${encodeURI(path)}`);
function check(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
function equal(a: unknown, b: unknown) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
class VolatilePreferences implements PreferenceStorage {
  private snapshot: PreferenceSnapshot = {revision: 0, values: {}};
  async read() {return {revision: this.snapshot.revision, values: {...this.snapshot.values}};}
  async compareAndSwap(revision: number, values: PreferenceValues) {
    if (revision !== this.snapshot.revision) return false;
    this.snapshot = {revision: revision + 1, values: {...values}}; return true;
  }
}
interface ServiceStatus {
  runId: string; initialized: boolean; platform: string; rejectedUploads: number;
  committedUploads: SyncChange[][]; mutations: {tagId: string; display: string}[];
  traffic: {streamHttpRequests: number; webSocketUpgrades: number; serverToClientBytes: number};
}
function loopbackOrigin(value: unknown): string {
  check(typeof value === 'string', 'Missing controlled loopback origin');
  const url = new URL(value);
  check(url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) > 1024 && url.origin === value, 'Only an explicit controlled loopback origin is accepted');
  return value;
}
async function pending(database: PowerSyncDatabase) {
  const values: {transactionId?: number; crud: {clientId: number; id: string; op: string; table: string; opData: unknown; previousValues: unknown}[]}[] = [];
  for await (const transaction of database.getCrudTransactions()) values.push({transactionId: transaction.transactionId, crud: transaction.crud.map(entry => ({clientId: entry.clientId, id: entry.id, op: entry.op, table: entry.table, opData: entry.opData ?? null, previousValues: entry.previousValues ?? null}))});
  return values;
}
type FixtureQueue = Awaited<ReturnType<typeof pending>>;
interface ServiceFaultState {
  kind: string; version: number; runId: string; phase: string; requestedAt: number;
  readyForExternalKill: boolean; baseline: DatabaseSnapshot; offlineQueue: FixtureQueue;
  legacyPreferenceFingerprint: string; localJson: string;
  preReconnectReceiptMd5?: string; preReconnectSnapshot?: DatabaseSnapshot;
}
async function waitFor(condition: () => Promise<boolean>, name: string) {
  for (let count = 0; count < 120; count++) {if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 500));}
  throw new Error(`Controlled service ${name} did not complete`);
}

/** Real service exercise only in the explicitly selected, synthetic development entry. */
export async function runNativeServiceReconnectFixture() {
  check(__DEV__ && ['android', 'ios'].includes(Platform.OS), 'A selected native development fixture is required');
  const container = decodeURIComponent(Paths.document.uri).replace(/^file:\/\//, '').replace(/\/Documents\/?$/, '');
  const markerRoot = Platform.OS === 'android' ? '/data/user/0/com.slax.reader' : `${container}/Library/Application Support`;
  const directory = Platform.OS === 'android' ? `${markerRoot}/files` : markerRoot;
  const marker = JSON.parse(await file(`${directory}/legacy-fixture-report.json`).text()) as {controlledFixture?: boolean; fixtureVersion?: number; producer?: string; coreVersion?: string; databasePath: string; androidBundleId?: string; iosBundleId?: string; nativePlatform?: string; transactions: FixtureQueue; localJson: string};
  check(marker.controlledFixture === true && marker.fixtureVersion === 1 && marker.producer === 'powersync-kotlin-1.14.1' && marker.coreVersion?.startsWith('0.5.1/'), 'Unknown original synthetic producer');
  check(marker.transactions.length === 2 && marker.transactions.flatMap(value => value.crud).map(value => value.id).join(',') === 'tag-1,bookmark-1,bookmark-1,comment-1', 'Unknown original synthetic operations');
  check(Platform.OS === 'android' ? marker.androidBundleId === 'com.slax.reader' : marker.iosBundleId === 'app.slax.reader' && marker.nativePlatform === 'ios-simulator', 'Another application owns the fixture');
  const request = JSON.parse(await file(`${directory}/native-adoption-fault-request.json`).text()) as {kind?: string; version?: number; phase?: string; runId: string; requestedAt: number; apiOrigin?: string; syncOrigin?: string; originalDatabasePath?: string};
  check(request.kind === 'slax-native-adoption-fault-request' && request.version === 1 && ['service-reconnect', 'service-first-upgrade', 'hold-service-first-upgrade', 'resume-service-first-upgrade'].includes(request.phase ?? '') && /^[a-zA-Z0-9-]{1,64}$/.test(request.runId) && Number.isSafeInteger(request.requestedAt) && request.requestedAt > 0 && request.originalDatabasePath === marker.databasePath, 'Unknown controlled service request');
  const firstUpgrade = request.phase !== 'service-reconnect', resuming = request.phase === 'resume-service-first-upgrade';
  const adoptionFile = file(`${directory}/native-adoption-report.json`);
  if (firstUpgrade) check(!adoptionFile.exists, 'Real original-queue adoption requires a fresh producer, never a completed/reset upgrade');
  else {
    const adoption = JSON.parse(await adoptionFile.text()) as {status?: string; platform?: string; sameIdentityReplacement?: boolean};
    check(adoption.status === 'passed' && adoption.platform === Platform.OS && adoption.sameIdentityReplacement === true, 'A completed genuine synthetic upgrade is required');
  }
  const apiOrigin = loopbackOrigin(request.apiOrigin), syncOrigin = loopbackOrigin(request.syncOrigin);
  check(apiOrigin !== syncOrigin, 'Independent controlled API and sync origins are required');
  const locations = controlledNativeFixturePaths(Platform.OS, markerRoot, marker.databasePath);
  const bridge = loadLegacyBridge(), nativePreferences = new PreferenceStore(nativePreferenceStorage(bridge));
  const credentials = new PreferenceStore(new VolatilePreferences());
  const sessions = new SessionController(credentials, {enter: async () => {}, leave: async () => {}});
  await sessions.accept('fixture-auth-token-NOT-A-REAL-CREDENTIAL', 'synthetic-user');
  const api = new SlaxApi({baseUrl: apiOrigin, platform: Platform.OS as 'android' | 'ios', version: 'controlled-native-service', sessions, fetch: expoFetch});
  const connector = createSyncConnector(api, credentials, sessions, syncOrigin);
  const schema = await createMobileSchema();
  let database: PowerSyncDatabase | null = null, owns = false;
  const sdkCompletions: {transactionId?: number; clientIds: number[]}[] = [];
  const progress = (phase: string) => file(`${directory}/native-service-progress.json`).write(JSON.stringify({runId: request.runId, phase, writtenAt: Date.now()}));
  try {
    let inventory = await bridge.beginDataOwnership(); owns = true;
    check(inventory.databaseCandidates.length === 1 && locations.databasePaths.includes(inventory.databaseCandidates[0]!), 'Only the exact original synthetic database may open');
    const databasePath = inventory.databaseCandidates[0]!;
    const evidence = {databasePath, legacySdk: 'powersync-kotlin-1.14.1', targetSdk: 'powersync-react-native-2.3.1', schemaVersion: '2', supportedOnDiskAdoption: true, verifiedFixtures: {pendingQueue: true, transactionBoundaries: true, offlineRows: true, localJson: true, reconnectOrder: true}, report: 'Isolated actual service exercise only; production adoption remains disabled'} as const;
    const originalPreferences = await bridge.readLegacyPreferences();
    check(originalPreferences !== null, 'Missing original synthetic AndroidX preferences');
    await migrateLegacyPreferences(nativePreferences, bridge);
    check((await nativePreferences.read()).auth_token === 'fixture-auth-token-NOT-A-REAL-CREDENTIAL' && equal(await bridge.readLegacyPreferences(), originalPreferences), 'Original synthetic preferences were not imported intact');
    const before = await bridge.inspectLegacyDatabase(databasePath);
    const stateFile = file(`${directory}/native-adoption-fault-state.json`);
    let held: ServiceFaultState | null = null;
    if (resuming) {
      held = JSON.parse(await stateFile.text()) as ServiceFaultState;
      check(held.kind === 'slax-native-adoption-fault-state' && held.version === 1 && held.runId === request.runId && held.phase === 'hold-service-first-upgrade' && held.readyForExternalKill === true && held.requestedAt < request.requestedAt && unchangedDatabaseData(held.baseline, before) && held.legacyPreferenceFingerprint === originalPreferences.fingerprint, 'Actual original-queue failure checkpoint changed across process kill');
    } else if (firstUpgrade && stateFile.exists) {
      const opening = JSON.parse(await stateFile.text()) as ServiceFaultState;
      check(opening.kind === 'slax-native-adoption-fault-state' && opening.version === 1 && opening.runId === request.runId && opening.phase === 'hold-before-first-sdk-open' && opening.readyForExternalKill === true && opening.requestedAt < request.requestedAt && unchangedDatabaseData(opening.baseline, before), 'Original pending queue changed across first-opening kill');
    }
    const open = () => openVerifiedDatabase({inventory, evidence, inspector: bridge, preferences: nativePreferences, open: async location => {
      const opened = new PowerSyncDatabase({schema, logger: {log() {}}, database: {dbFilename: location.dbFilename, dbLocation: location.dbLocation}});
      try {
        await opened.init();
        const originalTransactions = opened.getCrudTransactions.bind(opened);
        // Observe completion only after the real native SDK callback resolves.
        // The production connector/uploader still owns when it is called.
        opened.getCrudTransactions = async function* () {
          for await (const transaction of originalTransactions()) {
            const complete = transaction.complete;
            transaction.complete = async (...args) => {
              await complete.apply(transaction, args);
              sdkCompletions.push({transactionId: transaction.transactionId, clientIds: transaction.crud.map(entry => entry.clientId)});
            };
            yield transaction;
          }
          return null;
        };
        return opened;
      } catch (error) {await opened.close(); throw error;}
    }});
    database = await open();
    check((await database.get<{version: string}>('SELECT powersync_rs_version() AS version')).version.startsWith('0.5.3/'), 'The controlled original-queue upgrade did not load the pinned native core');
    const initialQueue = await pending(database);
    if (firstUpgrade) check(equal(initialQueue, resuming ? held!.offlineQueue : marker.transactions) && unchangedDatabaseData(before, await bridge.inspectLegacyDatabase(databasePath)), 'SDK initialization changed the genuine original queue/snapshot');
    else check(initialQueue.length === 0, 'Preserve unexpected pending writes instead of starting service replication');
    const localJson = (await database.get<{data: string}>('SELECT data FROM ps_data_local__local_bookmark_info WHERE id=?', ['bookmark-1'])).data;
    let preReconnectReceiptMd5: string|undefined, preReconnectSnapshot: DatabaseSnapshot|undefined;
    if (firstUpgrade) {
      const preReceipt = file(`${directory}/native-upgrade-offline-finished.json`);
      if (preReceipt.exists) {
        const text = await preReceipt.text();
        check(text.length <= 2 * 1024 * 1024, 'The bounded offline visibility receipt is too large');
        preReconnectReceiptMd5 = bridge.md5String(text);
        check(!held || held.preReconnectReceiptMd5 === preReconnectReceiptMd5, 'The finished offline visibility receipt changed across service process kill');
        preReconnectSnapshot = held?.preReconnectSnapshot ?? before;
        const nativeDatabaseIdentity = inventory.databaseIdentities?.[databasePath];
        check(nativeDatabaseIdentity, 'Current native identity is required after offline visibility');
        validateServiceLocalJson(marker.localJson, localJson, {source: marker as unknown as Record<string, unknown>, receipt: JSON.parse(text) as Record<string, unknown>,
          platform: Platform.OS, runId: request.runId, nativeDatabaseIdentity, originalSnapshot: preReconnectSnapshot, currentLocalJson: localJson, md5String: value => bridge.md5String(value)});
      } else {
        check(!held?.preReconnectReceiptMd5 && !held?.preReconnectSnapshot, 'Preserve the missing offline visibility receipt instead of relaxing its checkpoint');
        validateServiceLocalJson(marker.localJson, localJson);
      }
      check(!held || localJson === held.localJson, 'Complete local JSON changed across real service process kill');
    }
    if (!resuming) {
      const rows: Record<string, object[]> = {};
      for (const [name, table] of Object.entries(LEGACY_MOBILE_TABLES)) if (!table.options?.localOnly) rows[name] = await database.getAll(`SELECT * FROM ${name} ORDER BY id`);
      await api.request('/fixture/init', 'POST', {runId: request.runId, platform: Platform.OS, rows});
      progress('server-seeded');
    } else {
      const status = await api.request<ServiceStatus>('/fixture/status');
      check(status.runId === request.runId && status.platform === Platform.OS && status.rejectedUploads > 0 && status.committedUploads.length === 0, 'The exact original-queue service did not retain its real failure');
    }
    const tagId = `tag-service-${Platform.OS}-${request.runId.slice(0, 36)}`, alias = 'Controlled actual service offline edit';
    if (!resuming) {
      check(!(await database.getOptional('SELECT id FROM sr_user_tag WHERE id=?', [tagId])), 'This controlled service edit already exists; preserve it');
      await database.writeTransaction(async transaction => {
        await transaction.execute('UPDATE sr_user_bookmark SET alias_title=? WHERE id=?', [alias, 'bookmark-1']);
        await transaction.execute('INSERT INTO sr_user_tag(id,user_id,tag_name,display) VALUES(?,?,?,?)', [tagId, 'synthetic-user', 'actual-service', 'Before service']);
      });
    }
    const offlineQueue = await pending(database);
    check(offlineQueue.length === (firstUpgrade ? 3 : 1) && offlineQueue.at(-1)!.crud.map(value => value.id).join(',') === `bookmark-1,${tagId}` && (!firstUpgrade || equal(offlineQueue.slice(0, 2), marker.transactions)), 'Unexpected actual-service offline transaction');
    if (firstUpgrade) check(offlineQueue.at(-1)!.crud.map(value => value.clientId).join(',') === '5,6', 'New writes did not extend the real original pending queue');
    if (resuming) check(equal(offlineQueue, held!.offlineQueue), 'Original service queue changed across process kill');
    else {
      await database.connect(connector, {params: SYNC_PARAMETERS});
      await waitFor(async () => (await api.request<ServiceStatus>('/fixture/status')).rejectedUploads > 0 && database!.currentStatus.connected, 'real rejection and connection');
      check(sdkCompletions.length === 0 && equal(await pending(database), offlineQueue), 'Actual retryable HTTP failure completed or changed offline IDs/order/values');
      progress('real-503-retained');
      if (request.phase === 'hold-service-first-upgrade') {
        stateFile.write(JSON.stringify({kind: 'slax-native-adoption-fault-state', version: 1, runId: request.runId, phase: request.phase, requestedAt: request.requestedAt, writtenAt: Date.now(), readyForExternalKill: true, baseline: await bridge.inspectLegacyDatabase(databasePath), offlineQueue, legacyPreferenceFingerprint: originalPreferences.fingerprint, localJson,
          ...(preReconnectReceiptMd5 ? {preReconnectReceiptMd5, preReconnectSnapshot} : {})}, null, 2));
        await new Promise<never>(() => {});
      }
      await database.disconnect(); await database.close(); database = null; await bridge.endDataOwnership(); owns = false;
      inventory = await bridge.beginDataOwnership(); owns = true; database = await open();
      check(equal(await pending(database), offlineQueue), 'Reopen after actual service failure changed pending transactions');
    }
    await api.request('/fixture/release-uploads', 'POST');
    await database.connect(connector, {params: SYNC_PARAMETERS});
    await waitFor(async () => (await pending(database!)).length === 0 && (await api.request<ServiceStatus>('/fixture/status')).committedUploads.length > 0, 'real ordered upload');
    const firstSyncTimeout = linkedAbortTimeout(60000);
    try {await database.waitForFirstSync({signal: firstSyncTimeout.signal});} finally {firstSyncTimeout.cleanup();}
    const receipts = await api.request<{rows: SyncChange[][]; materializedLegacyRows: Record<string, Record<string, string | number | null>[]>; replicationSlots: {active: boolean; confirmedFlushLsn: string}[]; traffic: ServiceStatus['traffic']}>('/fixture/server-receipts');
    const expectedChanges = offlineQueue.flatMap(transaction => transaction.crud.map(entry => ({table: entry.table, id: entry.id, op: entry.op, ...diffChanges(entry.opData as SqlRow | null, entry.previousValues as SqlRow | null)})));
    check(equal(receipts.rows.flat(), expectedChanges), 'Server SQL receipts duplicated, omitted, changed or reordered a logical write');
    check(equal(sdkCompletions, offlineQueue.map(transaction => ({transactionId: transaction.transactionId, clientIds: transaction.crud.map(entry => entry.clientId)}))), 'Real native SDK completions duplicated, omitted or reordered a transaction');
    const materializedNativeRows: Record<string, Record<string, unknown>[]> = {};
    if (firstUpgrade) {
      const materialized = new Map<string, SqlRow>();
      for (const entry of offlineQueue.flatMap(transaction => transaction.crud)) {
        if (!['tag-1', 'bookmark-1', 'comment-1'].includes(entry.id)) continue;
        const key = `${entry.table}:${entry.id}`;
        materialized.set(key, {...materialized.get(key), ...(entry.opData as SqlRow)});
      }
      for (const [key, expected] of materialized) {
        const [table, id] = key.split(':');
        const row = receipts.materializedLegacyRows[table!]?.find(row => row.id === id);
        check(row && materializedFixtureValuesMatch(expected, row), 'The actual server did not materialize every original pending edit');
        const nativeRow = await database.get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=?`, [id!]);
        check(materializedFixtureValuesMatch(expected, nativeRow), 'Actual replicated values differ from original pending edits');
        materializedNativeRows[table!] = [nativeRow];
      }
    }
    check(receipts.replicationSlots.some(slot => slot.active && slot.confirmedFlushLsn), 'No actual PostgreSQL replication checkpoint was observed');
    const httpDisplay = 'Received through actual default service stream';
    await api.request('/fixture/replicate', 'POST', {tagId, display: httpDisplay});
    await waitFor(async () => (await database!.getOptional<{display: string}>('SELECT display FROM sr_user_tag WHERE id=?', [tagId]))?.display === httpDisplay, 'default downlink replication');
    progress('default-reconnect-replicated');
    await database.disconnect();
    await database.connect(connector, {params: SYNC_PARAMETERS, connectionMethod: SyncStreamConnectionMethod.WEB_SOCKET});
    await waitFor(async () => database!.currentStatus.connected && (await api.request<ServiceStatus>('/fixture/status')).traffic.webSocketUpgrades > 0, 'supported native WebSocket');
    const wsDisplay = 'Received through actual WebSocket service stream';
    await api.request('/fixture/replicate', 'POST', {tagId, display: wsDisplay});
    await waitFor(async () => (await database!.getOptional<{display: string}>('SELECT display FROM sr_user_tag WHERE id=?', [tagId]))?.display === wsDisplay, 'WebSocket downlink replication');
    check((await database.get<{alias_title: string}>('SELECT alias_title FROM sr_user_bookmark WHERE id=?', ['bookmark-1'])).alias_title === alias, 'Actual synchronization lost the committed edit');
    check((await database.get<{data: string}>('SELECT data FROM ps_data_local__local_bookmark_info WHERE id=?', ['bookmark-1'])).data === localJson, 'Actual synchronization altered complete local-only reading/cache state');
    check(equal(await bridge.readLegacyPreferences(), originalPreferences), 'Service exercise changed original AndroidX preferences');
    check(file(`${locations.cacheRoot}/bookmark/bookmark-1/content.html`).textSync().includes('Controlled offline fixture'), 'The original article cache disappeared');
    const status = await api.request<ServiceStatus>('/fixture/status');
    check(status.runId === request.runId && status.platform === Platform.OS && status.traffic.serverToClientBytes > 0 && status.traffic.webSocketUpgrades > 0, 'Missing actual native service traffic');
    const {version: coreVersion} = await database.get<{version: string}>('SELECT powersync_rs_version() AS version');
    const report = {status: 'passed', platform: Platform.OS, runId: request.runId, coreVersion, databasePath, serviceReconnect: true, productionAdoptionEnabled: false, originalLegacyFirstQueueUpload: firstUpgrade, originalQueueOperations: firstUpgrade ? 4 : 0, actualServiceProcessKillRecovery: resuming,
      ...(preReconnectReceiptMd5 ? {preReconnectReceiptMd5, observedPreReconnectReadingBaselinePreserved: true} : {}),
      offlineTransaction: offlineQueue, actualRetryRetainsQueue: true, exactServerSqlReceipts: receipts.rows, realNativeSdkCompletions: sdkCompletions, materializedLegacyRows: receipts.materializedLegacyRows, materializedNativeRows, replicationCheckpointObserved: true, defaultTransportReplicated: true, explicitWebSocketReplicated: true, traffic: status.traffic, originalPreferencesUntouched: true, completeLocalJsonUntouched: true, originalCacheRetained: true, pendingOperations: (await pending(database)).flatMap(value => value.crud).length, credentialsPersisted: false};
    file(`${directory}/native-service-report.json`).write(JSON.stringify(report, null, 2)); progress('passed'); return report;
  } catch {
    // SDK/network diagnostics can include credentials; publish only bounded fixture metadata.
    file(`${directory}/native-service-report.json`).write(JSON.stringify({status: 'failed', platform: Platform.OS, runId: request.runId, serviceReconnect: false, productionAdoptionEnabled: false, credentialsPersisted: false}, null, 2));
    throw new Error('Controlled real-service fixture failed; no credential diagnostics were recorded');
  } finally {
    try {if (database) {await database.disconnect(); await database.close();} if (owns) await bridge.endDataOwnership();}
    catch {throw new Error('Controlled real-service cleanup failed; terminate only the allocated fixture process before continuing');}
  }
}
