import {Platform} from 'react-native';
import {File, Paths} from 'expo-file-system';
import {PowerSyncDatabase} from '@powersync/react-native';
import {createMobileSchema} from '../../src/data/schema.ts';
import {loadLegacyBridge, nativePreferenceStorage} from '../../src/data/native-storage.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {openVerifiedDatabase, unchangedDatabaseData, type DatabaseSnapshot} from '../../src/data/adoption.ts';
import {uploadPendingTransactions} from '../../src/data/uploader.ts';
import {ApiError} from '../../src/data/api.ts';
import {controlledNativeFixturePaths} from './native-fixture-paths.ts';
import {validateCompletedServicePrerequisite} from './completed-native-service.ts';

type Phase = 'hold-before-sdk-open' | 'resume-before-sdk-open' | 'hold-after-offline-commit' | 'resume-after-offline-commit' | 'hold-owner' | 'repeat-accepted';
interface Request {kind: 'slax-native-adoption-fault-request'; version: 1; runId: string; phase: Phase; requestedAt: number; originalDatabasePath: string}
interface PendingTransaction {transactionId?: number; crud: {clientId: number; id: string; op: string; table: string; opData: unknown; previousValues: unknown}[]}
interface State {kind: 'slax-native-adoption-fault-state'; version: 1; runId: string; phase: Phase; requestedAt: number; writtenAt: number; readyForExternalKill: boolean; baseline: DatabaseSnapshot; pending?: PendingTransaction[]; alias?: string; localJson?: string; ownerIdentity?: unknown; legacyPreferenceFingerprint?: string; nativePreferenceValues?: unknown; cacheContent?: string}
const phases: Phase[] = ['hold-before-sdk-open', 'resume-before-sdk-open', 'hold-after-offline-commit', 'resume-after-offline-commit', 'hold-owner', 'repeat-accepted'];
const file = (path: string) => new File(`file://${encodeURI(path)}`);
function check(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
function equal(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
async function pending(database: PowerSyncDatabase): Promise<PendingTransaction[]> {
  const values: PendingTransaction[] = [];
  for await (const transaction of database.getCrudTransactions()) values.push({transactionId: transaction.transactionId, crud: transaction.crud.map(entry => ({clientId: entry.clientId, id: entry.id, op: entry.op, table: entry.table, opData: entry.opData ?? null, previousValues: entry.previousValues ?? null}))});
  return values;
}
const waitForExternalKill = () => new Promise<never>(() => {});

/** Explicitly controlled synthetic fault phases. No runtime adoption profile is enabled. */
export async function runNativeAdoptionFaultFixture() {
  check(__DEV__ && ['android', 'ios'].includes(Platform.OS), 'Fault fixtures require the selected native development fixture entry');
  const container = decodeURIComponent(Paths.document.uri).replace(/^file:\/\//, '').replace(/\/Documents\/?$/, '');
  const markerRoot = Platform.OS === 'android' ? '/data/user/0/com.slax.reader' : `${container}/Library/Application Support`;
  const directory = Platform.OS === 'android' ? `${markerRoot}/files` : markerRoot;
  const marker = file(`${directory}/legacy-fixture-report.json`), adoption = file(`${directory}/native-adoption-report.json`);
  check(marker.exists, 'A genuine original synthetic fixture is required before fault tests');
  const source = JSON.parse(await marker.text()) as {controlledFixture?: boolean; fixtureVersion?: number; androidBundleId?: string; iosBundleId?: string; nativePlatform?: string; producer?: string; coreVersion?: string; databasePath: string; transactions?: {crud: {id: string}[]}[]};
  check(source.controlledFixture === true && source.fixtureVersion === 1 && source.producer === 'powersync-kotlin-1.14.1' && source.coreVersion?.startsWith('0.5.1/'), 'Unrecognized original synthetic fixture');
  check(Platform.OS === 'android' ? source.androidBundleId === 'com.slax.reader' : source.iosBundleId === 'app.slax.reader' && source.nativePlatform === 'ios-simulator', 'The marker belongs to another application or platform');
  check(source.transactions?.length === 2 && source.transactions.flatMap(value => value.crud).map(value => value.id).join(',') === 'tag-1,bookmark-1,bookmark-1,comment-1', 'Unexpected original fixture operations');
  const request = JSON.parse(await file(`${directory}/native-adoption-fault-request.json`).text()) as Request;
  check(request.kind === 'slax-native-adoption-fault-request' && request.version === 1 && /^[a-zA-Z0-9-]{1,64}$/.test(request.runId) && phases.includes(request.phase) && Number.isSafeInteger(request.requestedAt) && request.requestedAt > 0 && request.originalDatabasePath === source.databasePath, 'Unrecognized fault request');
  const service = file(`${directory}/native-service-report.json`);
  const servicePrerequisite = !adoption.exists;
  if (servicePrerequisite) {
    check(service.exists, 'A completed genuine original-to-Expo synthetic adoption or original-queue service fixture is required before fault tests');
    validateCompletedServicePrerequisite(JSON.parse(await service.text()), Platform.OS, request.phase, request.runId);
  } else {
    const successful = JSON.parse(await adoption.text()) as {status?: string; platform?: string; coreVersion?: string; sameIdentityReplacement?: boolean};
    check(successful.status === 'passed' && successful.platform === Platform.OS && successful.coreVersion?.startsWith('0.5.3/') && successful.sameIdentityReplacement === true, 'The genuine native adoption prerequisite has not passed');
  }
  const locations = controlledNativeFixturePaths(Platform.OS, markerRoot, source.databasePath);
  const bridge = loadLegacyBridge(), preferences = new PreferenceStore(nativePreferenceStorage(bridge)), schema = await createMobileSchema();
  const stateFile = file(`${directory}/native-adoption-fault-state.json`), reportFile = file(`${directory}/native-adoption-fault-report.json`);
  let database: PowerSyncDatabase | null = null, owns = false;
  try {
    const inventory = await bridge.beginDataOwnership(); owns = true;
    check(inventory.databaseCandidates.length === 1 && locations.databasePaths.includes(inventory.databaseCandidates[0]!), 'Fault fixture requires the exact single inventoried original database');
    const databasePath = inventory.databaseCandidates[0]!;
    if (servicePrerequisite) check(inventory.databaseIdentities?.[databasePath], 'The service-based repeat fixture requires the current native canonical owner and database slot');
    const baseline = await bridge.inspectLegacyDatabase(databasePath);
    const nativePreferenceValues = async () => Object.fromEntries(Object.entries(await preferences.read()).filter(([key]) => key !== '_slax_database_adoption_v1'));
    const evidence = {databasePath, legacySdk: 'powersync-kotlin-1.14.1', targetSdk: 'powersync-react-native-2.3.1', schemaVersion: '2', supportedOnDiskAdoption: true, verifiedFixtures: {pendingQueue: true, transactionBoundaries: true, offlineRows: true, localJson: true, reconnectOrder: true}, report: 'Synthetic fault exercise only; production adoption remains disabled'} as const;
    const state = (): State => ({kind: 'slax-native-adoption-fault-state', version: 1, runId: request.runId, phase: request.phase, requestedAt: request.requestedAt, writtenAt: Date.now(), readyForExternalKill: true, baseline, ownerIdentity: inventory.databaseIdentities?.[databasePath]});
    const readState = async (phase: Phase): Promise<State> => {
      check(stateFile.exists, 'Interrupted fixture state is missing');
      const value = JSON.parse(await stateFile.text()) as State;
      check(value.kind === 'slax-native-adoption-fault-state' && value.version === 1 && value.runId === request.runId && value.phase === phase && value.readyForExternalKill === true && value.requestedAt < request.requestedAt, 'Unexpected interrupted fixture state');
      check(unchangedDatabaseData({...value.baseline, databasePath}, baseline), 'Process interruption changed the complete raw queue or offline snapshot');
      if (servicePrerequisite || value.legacyPreferenceFingerprint !== undefined) {
        if (servicePrerequisite) check(value.ownerIdentity, 'The service-based repeat checkpoint lacks its native owner identity');
        check(value.legacyPreferenceFingerprint === (await bridge.readLegacyPreferences())?.fingerprint && equal(value.nativePreferenceValues, await nativePreferenceValues()), 'Reinstallation changed original or imported preferences');
        check(value.cacheContent === file(`${locations.cacheRoot}/bookmark/bookmark-1/content.html`).textSync(), 'Reinstallation changed the original cached article');
        check(equal(value.ownerIdentity, inventory.databaseIdentities?.[databasePath]), 'Reinstallation changed the native canonical database owner or slot');
      }
      return value;
    };
    if (request.phase === 'hold-owner') {stateFile.write(JSON.stringify(state(), null, 2)); return await waitForExternalKill();}
    if (request.phase === 'resume-before-sdk-open') await readState('hold-before-sdk-open');
    const committed = request.phase === 'resume-after-offline-commit' ? await readState('hold-after-offline-commit') : undefined;
    database = await openVerifiedDatabase({inventory, evidence, inspector: bridge, preferences, open: async location => {
      if (request.phase === 'hold-before-sdk-open') {
        const checkpoint = JSON.parse(String((await preferences.read())._slax_database_adoption_v1)) as {phase?: string};
        check(checkpoint.phase === 'opening', 'Production coordinator did not persist its opening checkpoint');
        stateFile.write(JSON.stringify(state(), null, 2)); return await waitForExternalKill();
      }
      const opened = new PowerSyncDatabase({schema, database: {dbFilename: location.dbFilename, dbLocation: location.dbLocation}});
      try {await opened.init(); return opened;} catch (error) {await opened.close(); throw error;}
    }});
    const {version: coreVersion} = await database.get<{version: string}>('SELECT powersync_rs_version() AS version');
    check(coreVersion.startsWith('0.5.3/'), 'Unexpected native core');
    if (request.phase === 'hold-after-offline-commit') {
      check((await pending(database)).length === 0, 'Preserve an unexpected pending queue instead of adding fault operations');
      check(!(await database.getOptional('SELECT id FROM sr_user_tag WHERE id=?', ['tag-native-fault-1'])), 'This logical fault transaction already exists; do not duplicate it');
      const alias = 'Controlled committed offline process-kill edit';
      const original = await database.get<{data: string}>('SELECT data FROM ps_data_local__local_bookmark_info WHERE id=?', ['bookmark-1']);
      const localJson = JSON.stringify({...JSON.parse(original.data) as object, native_fault_future: {retained: true, run: request.runId}});
      await database.writeTransaction(async transaction => {
        await transaction.execute('UPDATE sr_user_bookmark SET alias_title=? WHERE id=?', [alias, 'bookmark-1']);
        await transaction.execute('INSERT INTO sr_user_tag(id,user_id,tag_name,display) VALUES(?,?,?,?)', ['tag-native-fault-1', 'synthetic-user', 'native-fault', 'Native fault']);
        await transaction.execute('UPDATE ps_data_local__local_bookmark_info SET data=? WHERE id=?', [localJson, 'bookmark-1']);
      });
      const queue = await pending(database);
      check(queue.length === 1 && queue[0]!.crud.map(value => value.id).join(',') === 'bookmark-1,tag-native-fault-1', 'Unexpected committed fault transaction');
      const afterCommit = await bridge.inspectLegacyDatabase(databasePath);
      stateFile.write(JSON.stringify({...state(), baseline: afterCommit, pending: queue, alias, localJson, legacyPreferenceFingerprint: (await bridge.readLegacyPreferences())?.fingerprint, nativePreferenceValues: await nativePreferenceValues(), cacheContent: file(`${locations.cacheRoot}/bookmark/bookmark-1/content.html`).textSync()}, null, 2));
      return await waitForExternalKill();
    }
    let completedOperations = 0;
    if (committed) {
      check(equal(await pending(database), committed.pending), 'Reopening changed client IDs, operation values/order or transaction boundaries');
      check((await database.get<{alias_title: string}>('SELECT alias_title FROM sr_user_bookmark WHERE id=?', ['bookmark-1'])).alias_title === committed.alias, 'The committed offline edit is missing');
      check((await database.get<{data: string}>('SELECT data FROM ps_data_local__local_bookmark_info WHERE id=?', ['bookmark-1'])).data === committed.localJson, 'The committed local-only future JSON field is missing');
      let rejected = false;
      try {await uploadPendingTransactions(database, async () => {throw new ApiError(503, 'Controlled offline fault retry');});} catch {rejected = true;}
      check(rejected && equal(await pending(database), committed.pending), 'A post-kill retry lost pending data');
      const ids: string[] = [];
      await uploadPendingTransactions(database, async changes => {ids.push(...changes.map(value => value.id));});
      check(ids.join(',') === 'bookmark-1,tag-native-fault-1' && (await pending(database)).length === 0, 'Fault upload duplicated, omitted or reordered a logical operation');
      completedOperations = ids.length;
    }
    check(file(`${locations.cacheRoot}/bookmark/bookmark-1/content.html`).textSync().includes('Controlled offline fixture'), 'Original article cache is missing after the fault');
    const event = {phase: request.phase, status: 'passed', platform: Platform.OS, runId: request.runId, coreVersion, databasePath, pendingOperations: (await bridge.inspectLegacyDatabase(databasePath)).pendingOperations, completedOperations, logicalIdentityReturned: !!inventory.databaseIdentities?.[databasePath], containerRelocated: locations.containerRelocated, actualOriginalServicePrerequisite: servicePrerequisite, serviceReconnect: false, productionAdoptionEnabled: false};
    const prior = reportFile.exists ? JSON.parse(await reportFile.text()) as {kind?: string; events?: unknown[]} : undefined;
    check(!prior || prior.kind === 'slax-native-adoption-fault-report' && Array.isArray(prior.events), 'Unexpected fault report');
    reportFile.write(JSON.stringify({kind: 'slax-native-adoption-fault-report', version: 1, events: [...(prior?.events ?? []), event]}, null, 2));
    stateFile.write(JSON.stringify({...state(), readyForExternalKill: false}, null, 2));
    return event;
  } finally {if (database) await database.close(); if (owns) await bridge.endDataOwnership();}
}
