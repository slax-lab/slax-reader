import {Platform} from 'react-native';
import {File, Paths} from 'expo-file-system';
import {loadLegacyBridge, nativePreferenceStorage} from '../../src/data/native-storage.ts';
import {PreferenceStore, type PreferenceValues} from '../../src/data/preferences.ts';
import {unchangedDatabaseData} from '../../src/data/adoption.ts';
import {controlledNativeFixturePaths} from './native-fixture-paths.ts';

const file = (path: string) => new File(`file://${encodeURI(path)}`);
function check(value: unknown, message: string): asserts value {if (!value) throw new Error(message);}
const equal = (a: unknown, b: unknown): boolean => {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
};
interface CasRequest {kind: string; version: number; nonce: string; mode: 'stale-cas' | 'lock-read'; requestedAt: number; platform: string; device: string; sourceSHA256: string; serviceRunId: string}
interface Probe {kind: string; version: number; nonce: string; requestedAt: number; platform: string; sourceSHA256: string; pid: number; phase: string; revisionBefore?: number; revisionAfter?: number; applied?: boolean; heldAt?: number; releasedAt?: number}

/** Selected synthetic fixture only; calls the actual compiled main native bridge. */
export async function runNativePreferenceCasFixture() {
  check(__DEV__ && ['android', 'ios'].includes(Platform.OS), 'Native CAS requires the selected development fixture');
  const container = decodeURIComponent(Paths.document.uri).replace(/^file:\/\//, '').replace(/\/Documents\/?$/, '');
  const markerRoot = Platform.OS === 'android' ? '/data/user/0/com.slax.reader' : `${container}/Library/Application Support`;
  const directory = Platform.OS === 'android' ? `${markerRoot}/files` : markerRoot;
  const marker = JSON.parse(await file(`${directory}/legacy-fixture-report.json`).text()) as {controlledFixture?: boolean; fixtureVersion?: number; producer?: string; coreVersion?: string; androidBundleId?: string; iosBundleId?: string; nativePlatform?: string; databasePath: string; transactions?: {crud: {id: string}[]}[]};
  check(marker.controlledFixture === true && marker.fixtureVersion === 1 && marker.producer === 'powersync-kotlin-1.14.1' && marker.coreVersion?.startsWith('0.5.1/') && marker.transactions?.length === 2 && marker.transactions.flatMap(value => value.crud).map(value => value.id).join(',') === 'tag-1,bookmark-1,bookmark-1,comment-1', 'Unrecognized genuine synthetic producer');
  check(Platform.OS === 'android' ? marker.androidBundleId === 'com.slax.reader' : marker.iosBundleId === 'app.slax.reader' && marker.nativePlatform === 'ios-simulator', 'Another application owns this marker');
  const locations = controlledNativeFixturePaths(Platform.OS, markerRoot, marker.databasePath);
  const serviceText = await file(`${directory}/native-service-report.json`).text(), service = JSON.parse(serviceText) as {status?: string; platform?: string; runId?: string; coreVersion?: string; originalLegacyFirstQueueUpload?: boolean; originalQueueOperations?: number; pendingOperations?: number; credentialsPersisted?: boolean; productionAdoptionEnabled?: boolean; realNativeSdkCompletions?: unknown; exactServerSqlReceipts?: unknown[][]};
  check(service.status === 'passed' && service.platform === Platform.OS && typeof service.runId === 'string' && service.runId.length > 0 && service.coreVersion === '0.5.3/2ba6b280' && service.originalLegacyFirstQueueUpload === true && service.originalQueueOperations === 4 && service.pendingOperations === 0 && service.credentialsPersisted === false && service.productionAdoptionEnabled === false && service.exactServerSqlReceipts?.flat().length === 6 && equal(service.realNativeSdkCompletions, [{transactionId: 1, clientIds: [1, 2]}, {transactionId: 2, clientIds: [3, 4]}, {transactionId: 3, clientIds: [5, 6]}]), 'A genuine completed original-service fixture is required before preference probing');
  const request = JSON.parse(await file(`${directory}/native-preference-cas-request.json`).text()) as CasRequest;
  check(request.kind === 'slax-native-preference-cas-request' && request.version === 1 && request.platform === Platform.OS && request.serviceRunId === service.runId && /^[0-9a-f-]{36}$/.test(request.nonce) && ['stale-cas', 'lock-read'].includes(request.mode) && Number.isSafeInteger(request.requestedAt) && request.requestedAt > 0 && /^[0-9a-f]{64}$/.test(request.sourceSHA256), 'Unrecognized controlled preference request');
  check(Platform.OS === 'android' ? /^emulator-\d+$/.test(request.device) : markerRoot.includes(`/CoreSimulator/Devices/${request.device}/data/Containers/Data/Application/`), 'Preference probing requires the exact controlled simulator/emulator');
  const bridge = loadLegacyBridge(), storage = nativePreferenceStorage(bridge);
  const stateFile = file(`${directory}/native-preference-cas-state.json`), probeFile = file(`${directory}/native-preference-cas-probe.json`), reportFile = file(`${directory}/native-preference-cas-report.json`);
  const snapshot = async () => {
    const inventory = await bridge.beginDataOwnership();
    try {check(inventory.databaseCandidates.length === 1 && locations.databasePaths.includes(inventory.databaseCandidates[0]!), 'Preference fixture cannot inspect another database'); return await bridge.inspectLegacyDatabase(inventory.databaseCandidates[0]!);} finally {await bridge.endDataOwnership();}
  };
  const beforeDatabase = await snapshot(), legacy = await bridge.readLegacyPreferences();
  check(legacy !== null, 'Original synthetic DataStore missing');
  const before = await storage.read();
  check(before.values.auth_token === 'fixture-auth-token-NOT-A-REAL-CREDENTIAL' && before.values.user_id === 'synthetic-user', 'Preserve unexpected preference identity without running the probe');
  stateFile.write(JSON.stringify({kind: 'slax-native-preference-cas-state', version: 1, nonce: request.nonce, requestedAt: request.requestedAt, writtenAt: Date.now(), phase: 'waiting-probe', revision: before.revision}, null, 2));
  const waitForProbe = async (phase: string): Promise<Probe> => {
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      if (probeFile.exists) {
        const value = JSON.parse(await probeFile.text()) as Probe;
        if (value.nonce === request.nonce) {
          check(value.kind === 'slax-native-preference-cas-probe' && value.version === 1 && value.requestedAt === request.requestedAt && value.platform === Platform.OS && value.sourceSHA256 === request.sourceSHA256 && Number.isInteger(value.pid) && value.pid > 1, 'Another process supplied this probe state');
          if (value.phase === phase) return value;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('The bounded preference probe did not reach its selected phase');
  };
  const casResults: boolean[] = [];
  let probe: Probe, readStartedAt: number | undefined, readFinishedAt: number | undefined;
  if (request.mode === 'stale-cas') {
    probe = await waitForProbe('committed');
    check(probe.applied === true && probe.revisionBefore === before.revision && probe.revisionAfter === before.revision + 1, 'The separate native process did not commit the expected revision');
    let delayedSnapshot = true;
    // Deliver the real native snapshot captured before the separate-process write.
    // The production PreferenceStore must retry its rejected actual native CAS.
    const preferences = new PreferenceStore({read: async () => {if (delayedSnapshot) {delayedSnapshot = false; return before;} return storage.read();}, compareAndSwap: async (revision, values) => {const result = await storage.compareAndSwap(revision, values); casResults.push(result); return result;}});
    await preferences.update(values => {values.native_cas_main = request.nonce;});
    check(equal(casResults, [false, true]), 'The actual native stale revision did not reject then rebase');
  } else {
    await waitForProbe('lock-held');
    readStartedAt = Date.now(); await storage.read(); readFinishedAt = Date.now();
    probe = await waitForProbe('lock-released');
    check(typeof probe.heldAt === 'number' && typeof probe.releasedAt === 'number' && probe.heldAt <= readStartedAt && probe.releasedAt - readStartedAt > 1000 && readFinishedAt >= probe.releasedAt - 50, 'The actual main native read did not wait for the separate-process preference lock');
  }
  const after = await storage.read();
  const withoutCas = (values: PreferenceValues) => Object.fromEntries(Object.entries(values).filter(([key]) => !['native_cas_main', 'native_cas_probe'].includes(key)));
  check(equal(withoutCas(before.values), withoutCas(after.values)), 'A preference race changed unrelated original, imported, future or journal values');
  if (request.mode === 'stale-cas') check(after.revision === before.revision + 2 && after.values.native_cas_main === request.nonce && after.values.native_cas_probe === request.nonce, 'One separate-process setting was lost');
  else check(equal(before, after), 'The lock-read probe changed preference values or revision');
  check((await bridge.readLegacyPreferences())?.fingerprint === legacy.fingerprint && unchangedDatabaseData(beforeDatabase, await snapshot()), 'Preference probing changed the original DataStore or database');
  const report = {kind: 'slax-native-preference-cas-report', version: 1, status: 'passed', platform: Platform.OS, device: request.device, mode: request.mode, nonce: request.nonce, requestedAt: request.requestedAt, sourceSHA256: request.sourceSHA256, beforeRevision: before.revision, afterRevision: after.revision, casResults, probe, readStartedAt, readFinishedAt, mainUsesActualNativeBridge: true, secondProcessUsesLiteralNativeBodies: true, bothSettingsRetained: request.mode === 'stale-cas', unrelatedPreferencesUnchanged: true, originalDataStoreUnchanged: true, databaseUnchanged: true, productionAdoptionProfileUsed: false, completedServiceReportMd5: bridge.md5String(serviceText)};
  reportFile.write(JSON.stringify(report, null, 2));
  stateFile.write(JSON.stringify({kind: 'slax-native-preference-cas-state', version: 1, nonce: request.nonce, requestedAt: request.requestedAt, phase: 'passed'}, null, 2));
  return report;
}
