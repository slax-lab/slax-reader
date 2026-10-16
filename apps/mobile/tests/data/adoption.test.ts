import test from 'node:test';
import assert from 'node:assert/strict';
import {openVerifiedDatabase, DatabaseAdoptionRejected} from '../../src/data/adoption.ts';
import type {DatabaseSnapshot} from '../../src/data/adoption.ts';
import type {LegacyInventory} from '../../src/data/upgrade.ts';
import {MOBILE_TABLES} from '../../src/data/schema.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {MemoryPreferences} from './helpers.ts';

const inventory = {scanComplete: true, databaseCandidates: ['/controlled/powersync.db'], legacyDataDirectory: '/controlled', newDatabaseDirectory: '/controlled/new'};
const evidence = {databasePath: inventory.databaseCandidates[0]!, legacySdk: 'powersync-kotlin-1.14.1', targetSdk: 'powersync-react-native-2.3.1', schemaVersion: '2', supportedOnDiskAdoption: true, verifiedFixtures: {pendingQueue: true, transactionBoundaries: true, offlineRows: true, localJson: true, reconnectOrder: true}, report: 'synthetic unit profile; this is not native upgrade evidence'} as const;
const snapshot = (): DatabaseSnapshot => ({databasePath: evidence.databasePath, formatVersion: 14, userVersion: 1, integrityValid: true, storageTables: Object.keys(MOBILE_TABLES).map(table => `${table === 'local_bookmark_info' ? 'ps_data_local__' : 'ps_data__'}${table}`), pendingOperations: 4, pendingTransactions: 2, queueDigest: 'a'.repeat(64), dataDigest: 'b'.repeat(64), localDigest: 'c'.repeat(64)});

test('accepted adoption retains data and checkpoints before exposing the SDK owner', async () => {
  const storage = new MemoryPreferences({auth_token: 'synthetic-session'}), preferences = new PreferenceStore(storage), events: string[] = [];
  const opened = {close: async () => {events.push('close');}};
  const result = await openVerifiedDatabase({inventory, evidence, preferences, inspector: {inspectLegacyDatabase: async () => {events.push('inspect'); return snapshot();}}, open: async location => {events.push('open'); assert.equal(location.dbLocation, '/controlled'); assert.equal(JSON.parse(String(storage.values._slax_database_adoption_v1)).phase, 'opening'); return opened;}});
  assert.equal(result, opened); assert.deepEqual(events, ['inspect', 'open', 'inspect']);
  assert.equal(JSON.parse(String(storage.values._slax_database_adoption_v1)).phase, 'accepted'); assert.equal(storage.values.auth_token, 'synthetic-session');
});
test('changed pending state closes the new owner and blocks automatic rollback', async () => {
  const preferences = new PreferenceStore(new MemoryPreferences()); let inspections = 0, closes = 0, opens = 0;
  const options = {inventory, evidence, preferences, inspector: {inspectLegacyDatabase: async () => ({...snapshot(), queueDigest: (++inspections > 1 ? 'd' : 'a').repeat(64)})}, open: async () => {opens++; return {close: async () => {closes++;}};}};
  await assert.rejects(openVerifiedDatabase(options), error => error instanceof DatabaseAdoptionRejected && /changed/.test(error.message));
  assert.equal(closes, 1); assert.equal(opens, 1);
  await assert.rejects(openVerifiedDatabase(options), /rollback is blocked/); assert.equal(opens, 1);
});
test('interrupted opening can resume only while the complete queue and data snapshot is unchanged', async () => {
  const preferences = new PreferenceStore(new MemoryPreferences());
  const options = {inventory, evidence, preferences, inspector: {inspectLegacyDatabase: async () => snapshot()}, open: async () => {throw new Error('Synthetic process interruption');}};
  await assert.rejects(openVerifiedDatabase(options), /interruption/);
  assert.equal(JSON.parse(String((await preferences.read())._slax_database_adoption_v1)).phase, 'opening');
  let opens = 0;
  await assert.rejects(openVerifiedDatabase({...options, inspector: {inspectLegacyDatabase: async () => ({...snapshot(), pendingOperations: 3})}, open: async () => {opens++; return {close: async () => {}};}}), /Interrupted/);
  assert.equal(opens, 0);
  await openVerifiedDatabase({...options, open: async () => {opens++; return {close: async () => {}};}}); assert.equal(opens, 1);
});
test('unknown legacy tables or storage format stop before opening any SDK', async () => {
  let opens = 0;
  for (const invalid of [{...snapshot(), storageTables: [...snapshot().storageTables, 'ps_data__future_table']}, {...snapshot(), formatVersion: 15}, {...snapshot(), integrityValid: false}]) {
    await assert.rejects(openVerifiedDatabase({inventory, evidence, preferences: new PreferenceStore(new MemoryPreferences()), inspector: {inspectLegacyDatabase: async () => invalid}, open: async () => {opens++; return {close: async () => {}};}}), DatabaseAdoptionRejected);
  }
  assert.equal(opens, 0);
});

const simulatorPrefix = '/Users/test/Library/Developer/CoreSimulator/Devices/32D9AFE0-32C7-443A-8FEC-3EBB42135386/data/Containers/Data/Application/';
const relativePath = 'Library/Application Support/databases/powersync.db';
const oldPath = `${simulatorPrefix}E89DAAA5-06C8-4B8F-81E0-C8BBAF43944F/${relativePath}`;
const currentPath = `${simulatorPrefix}DA94D7FD-B7BB-404B-AE3D-FE0528BBE6F1/${relativePath}`;
const logicalIdentity = {owner: 'ios:app.slax.reader:/controlled/same-simulator/AppGroup/fixture-group', relativePath, relocationPrefix: simulatorPrefix};
const relocatedSnapshot = () => ({...snapshot(), databasePath: currentPath});
const relocatedInventory = () => ({...inventory, databaseCandidates: [currentPath], legacyDataDirectory: currentPath.slice(0, -'/databases/powersync.db'.length), databaseIdentities: {[currentPath]: logicalIdentity}});
const journal = (phase: 'accepted' | 'opening', scoped = true) => ({path: oldPath, phase, before: {...snapshot(), databasePath: oldPath}, targetSdk: evidence.targetSdk, ...(scoped ? {logicalIdentity} : {})});
async function openRelocated(previous: unknown, current: DatabaseSnapshot = relocatedSnapshot(), nativeInventory: LegacyInventory = relocatedInventory()) {
  const storage = new MemoryPreferences({_slax_database_adoption_v1: JSON.stringify(previous)});
  let opens = 0;
  const result = openVerifiedDatabase({inventory: nativeInventory, evidence: {...evidence, databasePath: currentPath}, preferences: new PreferenceStore(storage), inspector: {inspectLegacyDatabase: async () => current}, open: async () => {opens++; return {close: async () => {}};}});
  return {result, storage, opened: () => opens};
}
test('accepted native logical identity follows a same-app container update with subsequent offline changes', async () => {
  const current = {...relocatedSnapshot(), pendingOperations: 6, pendingTransactions: 3, queueDigest: 'd'.repeat(64), dataDigest: 'e'.repeat(64)};
  const run = await openRelocated(journal('accepted'), current);
  await run.result;
  assert.equal(run.opened(), 1);
  const accepted = JSON.parse(String(run.storage.values._slax_database_adoption_v1));
  assert.equal(accepted.path, currentPath); assert.equal(accepted.phase, 'accepted'); assert.deepEqual(accepted.logicalIdentity, logicalIdentity);
});
test('an interrupted relocated opening retries only against all unchanged raw checksums and queue boundaries', async () => {
  const unchanged = await openRelocated(journal('opening')); await unchanged.result; assert.equal(unchanged.opened(), 1);
  for (const changed of [{pendingOperations: 3}, {pendingTransactions: 1}, {queueDigest: 'd'.repeat(64)}, {dataDigest: 'e'.repeat(64)}, {localDigest: 'f'.repeat(64)}]) {
    const run = await openRelocated(journal('opening'), {...relocatedSnapshot(), ...changed});
    await assert.rejects(run.result, /Interrupted/); assert.equal(run.opened(), 0);
  }
});
test('a legacy absolute checkpoint can relocate only with the exact unchanged prior snapshot', async () => {
  const unchanged = await openRelocated(journal('accepted', false)); await unchanged.result; assert.equal(unchanged.opened(), 1);
  const changed = await openRelocated(journal('accepted', false), {...relocatedSnapshot(), queueDigest: 'd'.repeat(64)});
  await assert.rejects(changed.result, /unscoped relocated/); assert.equal(changed.opened(), 0);
});
test('relocated checkpoints reject another app owner, simulator, slot, noncanonical path or incomplete snapshot before SDK opening', async () => {
  const baseline = journal('accepted');
  for (const previous of [
    {...baseline, logicalIdentity: {...logicalIdentity, owner: 'ios:other-app:other-group'}},
    {...baseline, path: oldPath.replace('32D9AFE0', '12345678'), before: {...baseline.before, databasePath: oldPath.replace('32D9AFE0', '12345678')}},
    {...baseline, path: oldPath.replace('/databases/', '/other/'), before: {...baseline.before, databasePath: oldPath.replace('/databases/', '/other/')}},
    {...baseline, path: oldPath.replace('/databases/', '/databases/../databases/'), before: {...baseline.before, databasePath: oldPath.replace('/databases/', '/databases/../databases/')}},
    {...baseline, before: {...baseline.before, databasePath: '/different/powersync.db'}},
    {...baseline, before: {...baseline.before, storageTables: undefined}},
  ]) {
    const run = await openRelocated(previous);
    await assert.rejects(run.result, DatabaseAdoptionRejected); assert.equal(run.opened(), 0);
  }
  const noNativeIdentity = await openRelocated(baseline, relocatedSnapshot(), {...relocatedInventory(), databaseIdentities: {}});
  await assert.rejects(noNativeIdentity.result, DatabaseAdoptionRejected); assert.equal(noNativeIdentity.opened(), 0);
});

test('accepted same-owner same-profile startup verifies only schema and leaves the journal and live offline data alone', async () => {
  const inventory = relocatedInventory(), evidenceHere = {...evidence, databasePath: currentPath};
  const previous = {...journal('accepted'), path: currentPath, before: relocatedSnapshot(), profile: evidence.report, schemaVersion: '2'};
  const storage = new MemoryPreferences({_slax_database_adoption_v1: JSON.stringify(previous)});
  const events: string[] = [];
  await openVerifiedDatabase({inventory, evidence: evidenceHere, preferences: new PreferenceStore(storage), inspector: {
    inspectLegacyDatabase: async () => {throw new Error('Full data hashing is forbidden for accepted startup');},
    inspectAcceptedDatabase: async () => {events.push('schema'); return relocatedSnapshot();},
  }, open: async () => {events.push('open'); return {close: async () => {}};}});
  assert.deepEqual(events, ['schema', 'open']); assert.equal(storage.revision, 1);
  assert.equal(JSON.parse(String(storage.values._slax_database_installation_v1)).mode, 'adopted');
  assert.deepEqual(JSON.parse(String(storage.values._slax_database_adoption_v1)), previous);
});

test('unscoped, old-profile, interrupted and mismatched-schema checkpoints retain full verification', async () => {
  const base = {...journal('accepted'), path: currentPath, before: relocatedSnapshot(), profile: evidence.report, schemaVersion: '2'};
  for (const patch of [{profile: undefined}, {profile: 'older'}, {schemaVersion: '1'}, {phase: 'opening'}, {logicalIdentity: undefined}]) {
    const storage = new MemoryPreferences({_slax_database_adoption_v1: JSON.stringify({...base, ...patch})});
    let inspections = 0, schemas = 0;
    await openVerifiedDatabase({inventory: relocatedInventory(), evidence: {...evidence, databasePath: currentPath}, preferences: new PreferenceStore(storage), inspector: {
      inspectLegacyDatabase: async () => {inspections++; return relocatedSnapshot();},
      inspectAcceptedDatabase: async () => {schemas++; return relocatedSnapshot();},
    }, open: async () => ({close: async () => {}})});
    assert.equal(inspections, 2); assert.equal(schemas, 0);
  }
  let opens = 0, inspections = 0;
  await assert.rejects(openVerifiedDatabase({inventory: relocatedInventory(), evidence: {...evidence, databasePath: currentPath}, preferences: new PreferenceStore(new MemoryPreferences({_slax_database_adoption_v1: JSON.stringify(base)})), inspector: {
    inspectAcceptedDatabase: async () => ({...relocatedSnapshot(), formatVersion: 99}),
    inspectLegacyDatabase: async () => {inspections++; return {...relocatedSnapshot(), formatVersion: 99};},
  }, open: async () => {opens++; return {close: async () => {}};}}), DatabaseAdoptionRejected);
  assert.equal(inspections, 1); assert.equal(opens, 0);
});
