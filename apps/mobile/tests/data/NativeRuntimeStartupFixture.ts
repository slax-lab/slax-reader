import {Platform} from 'react-native';
import {File, Paths} from 'expo-file-system';
import {createMobileDataRuntime} from '../../src/data/runtime.ts';
import {loadLegacyBridge, type SlaxLegacyBridge} from '../../src/data/native-storage.ts';
import {unchangedDatabaseData, type DatabaseSnapshot} from '../../src/data/adoption.ts';
import {REVIEWED_ADOPTION_PROFILE} from '../../src/data/adoption-profile.ts';

const file = (path: string) => new File(`file://${encodeURI(path)}`);
function check(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}

/** Executes the normal runtime/coordinator without a device-specific adoption evidence override. */
export async function runNativeRuntimeStartupFixture() {
  check(__DEV__ && ['ios', 'android'].includes(Platform.OS), 'Normal startup verification requires a selected controlled native fixture');
  const container = decodeURIComponent(Paths.document.uri).replace(/^file:\/\//, '').replace(/\/Documents\/?$/, '');
  const directory = Platform.OS === 'android' ? '/data/user/0/com.slax.reader/files' : `${container}/Library/Application Support`;
  const request = JSON.parse(await file(`${directory}/native-runtime-start-request.json`).text()) as {kind?: string; version?: number; nonce?: string; device?: string; platform?: string; requestedAt?: number};
  check(request.kind === 'slax-controlled-normal-runtime-start' && request.version === 1 && request.platform === Platform.OS && /^[0-9a-f-]{36}$/.test(request.nonce ?? '') && Number.isSafeInteger(request.requestedAt), 'Unrecognized controlled normal-start request');
  check(Platform.OS === 'android' ? /^emulator-\d+$/.test(request.device ?? '') : directory.includes(`/CoreSimulator/Devices/${request.device}/data/Containers/Data/Application/`), 'Only the exact controlled simulator/emulator is allowed');
  const source = JSON.parse(await file(`${directory}/legacy-fixture-report.json`).text()) as {controlledFixture?: boolean; producer?: string; androidBundleId?: string; iosBundleId?: string; transactions?: {crud: {id: string}[]}[]};
  check(source.controlledFixture === true && source.producer === 'powersync-kotlin-1.14.1' && (Platform.OS === 'android' ? source.androidBundleId === 'com.slax.reader' : source.iosBundleId === 'app.slax.reader') && source.transactions?.flatMap(value => value.crud).map(value => value.id).join(',') === 'tag-1,bookmark-1,bookmark-1,comment-1', 'A genuine original synthetic producer is required');
  const serviceText = await file(`${directory}/native-service-report.json`).text();
  const service = JSON.parse(serviceText) as {status?: string; platform?: string; originalLegacyFirstQueueUpload?: boolean; pendingOperations?: number; credentialsPersisted?: boolean; exactServerSqlReceipts?: unknown[][]};
  check(service.status === 'passed' && service.platform === Platform.OS && service.originalLegacyFirstQueueUpload === true && service.pendingOperations === 0 && service.credentialsPersisted === false && service.exactServerSqlReceipts?.flat().length === 6, 'Completed original-six real service acceptance is required');
  const cas = JSON.parse(await file(`${directory}/native-preference-cas-report.json`).text()) as {status?: string; mode?: string; device?: string; unrelatedPreferencesUnchanged?: boolean; databaseUnchanged?: boolean};
  check(cas.status === 'passed' && cas.mode === 'lock-read' && cas.device === request.device && cas.unrelatedPreferencesUnchanged === true && cas.databaseUnchanged === true, 'Actual native preference-lock verification is required');
  const actual = loadLegacyBridge();
  const beforePreferences = await actual.readPreferences();
  check(beforePreferences.values.auth_token === 'fixture-auth-token-NOT-A-REAL-CREDENTIAL' && beforePreferences.values.user_id === 'synthetic-user', 'Do not open another account in this controlled fixture');
  const inspections: DatabaseSnapshot[] = [];
  let inventoryObserved = false;
  const bridge: SlaxLegacyBridge = {
    beginDataOwnership: async () => {inventoryObserved = true; return actual.beginDataOwnership();},
    endDataOwnership: () => actual.endDataOwnership(),
    inspectLegacyDatabase: async location => {const snapshot = await actual.inspectLegacyDatabase(location); inspections.push(snapshot); return snapshot;},
    readLegacyPreferences: () => actual.readLegacyPreferences(),
    readPreferences: () => actual.readPreferences(),
    compareAndSwapPreferences: (revision, values) => actual.compareAndSwapPreferences(revision, values),
    newIdentifier: () => actual.newIdentifier(), md5String: value => actual.md5String(value),
  };
  const deniedRequestPaths: string[] = [];
  const runtime = createMobileDataRuntime({platform: Platform.OS as 'ios' | 'android', version: 'controlled-normal-start',
    baseUrl: 'http://127.0.0.1:9', betaBaseUrl: 'http://127.0.0.1:9', localSyncEndpoint: 'http://127.0.0.1:9', nativeBridge: bridge,
    fetch: async input => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      check(url.origin === 'http://127.0.0.1:9', 'No external request is permitted by the controlled normal-start fixture');
      deniedRequestPaths.push(url.pathname);
      // Exercise normal account startup without transmitting even synthetic credentials.
      return new Response(JSON.stringify({code: 403, message: 'Controlled transport refuses network forwarding', data: null}), {status: 403, headers: {'Content-Type': 'application/json'}});
    },
  });
  try {
    await runtime.start();
    check(inventoryObserved && runtime.getUpgradeSnapshot().status === 'ready', 'The default runtime did not accept the reviewed current native inventory');
    check(inspections.length >= 2 && unchangedDatabaseData(inspections[0]!, inspections[1]!), 'The normal SDK initialization changed the inspected on-disk snapshot');
    check(runtime.sessions.getSnapshot().status === 'authenticated' && runtime.getNativeResourceOwner(), 'The normal runtime did not restore its guarded synthetic account');
    const database = runtime.getDatabase(), repositories = runtime.getRepositories(), cache = runtime.getCache();
    check(database && repositories && cache, 'Normal account-bound services are unavailable');
    const bookmark = await repositories.getBookmark('bookmark-1');
    const tag = await database.getOptional<{id: string}>('SELECT id FROM sr_user_tag WHERE id=?', ['tag-1']);
    const comment = await database.getOptional<{id: string}>('SELECT id FROM sr_bookmark_comment WHERE id=?', ['comment-1']);
    const local = await database.get<{data: string}>('SELECT data FROM ps_data_local__local_bookmark_info WHERE id=?', ['bookmark-1']);
    const localValues = JSON.parse(local.data) as Record<string, unknown>;
    check(bookmark?.id === 'bookmark-1' && tag?.id === 'tag-1' && comment?.id === 'comment-1' && Number(localValues.read_position) === 348.25 && (localValues.future_field as {preserve?: boolean})?.preserve === true, 'Normal repositories lost original rows, position or hidden JSON');
    check((await cache.readArticle('bookmark-1'))?.includes('Controlled offline fixture'), 'Normal account cache cannot read the original article');
    const coreVersion = await database.get<{value: string}>('SELECT powersync_rs_version() AS value');
    check(coreVersion.value === REVIEWED_ADOPTION_PROFILE.targetCore, 'Actual opened core differs from the reviewed profile');
    await runtime.stop();
    check(runtime.getDatabase() === null && runtime.getNativeResourceOwner() === null, 'Normal shutdown retained an account resource owner');
    const report = {kind: 'slax-controlled-normal-runtime-start-report', version: 1, status: 'passed', platform: Platform.OS, device: request.device, nonce: request.nonce, requestedAt: request.requestedAt,
      normalCreateMobileDataRuntimeExecuted: true, explicitAdoptionEvidenceProvided: false, defaultProfile: REVIEWED_ADOPTION_PROFILE.id,
      actualNativeInventoryAndInspector: true, actualNativeAccountResourceActivation: true, schemaInitializationSnapshotUnchanged: true,
      firstInspection: inspections[0], afterSchemaInspection: inspections[1], coreVersion: coreVersion.value,
      originalBookmarkTagCommentAvailableInNormalRepositories: true, originalReadPosition: 348.25, originalHiddenJsonRetained: true, originalCacheReadByNormalAccountCache: true,
      completedServiceReportMd5: actual.md5String(serviceText), deniedRequestPaths, networkRequestsForwarded: 0,
      shutdownReleasedDatabaseAndNativeResourceOwner: true, productionDefaultProfileWired: true,
      visibleLibraryOrReaderUiAcceptance: false, publisherUpgrade: false, testFlight: false};
    file(`${directory}/native-runtime-start-report.json`).write(JSON.stringify(report, null, 2));
    return report;
  } finally {await runtime.stop();}
}
