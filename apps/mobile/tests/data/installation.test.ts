import test from 'node:test';
import assert from 'node:assert/strict';
import {openVerifiedDatabase} from '../../src/data/adoption.ts';
import {createInstallationBinding, LEGACY_DATABASE_STORAGE_TABLES, DATABASE_STORAGE_TABLES, DatabaseInitializationError, INSTALLATION_KEY, initializedDatabaseLocation, readInstallationBinding} from '../../src/data/installation.ts';
import type {InstallationBinding} from '../../src/data/installation.ts';
import type {LegacyInventory} from '../../src/data/upgrade.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {MemoryPreferences} from './helpers.ts';

const root = '/data/user/0/com.slax.reader';
const path = `${root}/files/slax-react-native/powersync.db`;
const identity = {owner: `android:com.slax.reader:${root}/files`, relativePath: 'files/slax-react-native/powersync.db'};
const inventory = (): LegacyInventory => ({scanComplete: true, databaseCandidates: [], legacyDataDirectory: root, newDatabaseDirectory: `${root}/files/slax-react-native`, databaseIdentities: {[path]: identity}});
const schema = (databasePath = path) => ({databasePath, formatVersion: 14, userVersion: 1, storageTables: DATABASE_STORAGE_TABLES});
const binding = (): InstallationBinding => createInstallationBinding({dbLocation: `${root}/files/slax-react-native`, dbFilename: 'powersync.db', adopted: false}, inventory(), 'slax-native-format14-schema2-v1')!;

function run(storage: MemoryPreferences, current = inventory(), snapshot = schema()) {
  const events: string[] = [];
  const result = openVerifiedDatabase({preferences: new PreferenceStore(storage), inventory: current,
    inspector: {inspectLegacyDatabase: async () => {assert.fail('Normal initialized startup must not hash historical data');},
      inspectAcceptedDatabase: async () => {events.push('schema'); return snapshot;}},
    open: async () => {events.push('open'); return {close: async () => {events.push('close');}};},
  });
  return {result, events};
}

test('a newly created database is bound only after successful initialization and schema verification', async () => {
  const storage = new MemoryPreferences();
  const first = run(storage); await first.result;
  assert.deepEqual(first.events, ['open', 'schema']);
  assert.deepEqual(readInstallationBinding(storage.values[INSTALLATION_KEY]), binding());
  const revision = storage.revision;
  const second = run(storage, {...inventory(), initializedDatabase: {path, mode: 'native'}}); await second.result;
  assert.deepEqual(second.events, ['schema', 'open']);
  assert.equal(storage.revision, revision);
});

test('fresh native user_version zero is admitted and resumes from the same bound database', async () => {
  const storage = new MemoryPreferences(), nativeSchema = {...schema(), userVersion: 0};
  const first = run(storage, inventory(), nativeSchema); await first.result;
  assert.deepEqual(first.events, ['open', 'schema']);
  assert.equal(readInstallationBinding(storage.values[INSTALLATION_KEY])?.mode, 'native');

  const resumed = run(storage, {...inventory(), initializedDatabase: {path, mode: 'native'}}, nativeSchema); await resumed.result;
  assert.deepEqual(resumed.events, ['schema', 'open']);
  assert.equal(storage.revision, 1);
});

test('persisted adopted bindings reject user_version zero before opening and retain version one admission', async () => {
  const currentInventory = {...inventory(), databaseCandidates: [path], initializedDatabase: {path, mode: 'adopted' as const}};
  const adoptedBinding = createInstallationBinding({dbLocation: `${root}/files/slax-react-native`, dbFilename: 'powersync.db', adopted: true}, currentInventory, 'slax-native-format14-schema2-v1')!;
  const rejected = run(new MemoryPreferences({[INSTALLATION_KEY]: JSON.stringify(adoptedBinding)}), currentInventory, {...schema(), userVersion: 0});
  await assert.rejects(rejected.result, DatabaseInitializationError);
  assert.deepEqual(rejected.events, ['schema']);

  const accepted = run(new MemoryPreferences({[INSTALLATION_KEY]: JSON.stringify(adoptedBinding)}), currentInventory, schema());
  await accepted.result;
  assert.deepEqual(accepted.events, ['schema', 'open']);
});

test('initialized signed-in and signed-out relaunches use the same admitted database path', async () => {
  const sessions: import('../../src/data/preferences.ts').PreferenceValues[] = [{auth_token: 'synthetic', user_id: 'account'}, {_slax_sign_out_pending_v1: true}, {}];
  for (const session of sessions) {
    const storage = new MemoryPreferences({...session, [INSTALLATION_KEY]: JSON.stringify(binding())});
    const current = run(storage, {...inventory(), initializedDatabase: {path, mode: 'native'}}); await current.result;
    assert.deepEqual(current.events, ['schema', 'open']);
    assert.equal(storage.revision, 0);
  }
});

test('initialized startup rejects absent native binding rather than creating an empty replacement', async () => {
  const storage = new MemoryPreferences({[INSTALLATION_KEY]: JSON.stringify(binding())});
  const current = run(storage);
  await assert.rejects(current.result, DatabaseInitializationError);
  assert.deepEqual(current.events, []);
});

test('corrupt initialization records fail closed regardless of a logged-in session', async () => {
  for (const value of ['{', '{}', 'null', JSON.stringify({...binding(), state: 'opening'}), JSON.stringify({...binding(), targetSdk: 'unknown'}), JSON.stringify({...binding(), path: `${root}/files/../databases/powersync.db`})]) {
    const current = run(new MemoryPreferences({auth_token: 'synthetic', user_id: 'account', [INSTALLATION_KEY]: value}));
    await assert.rejects(current.result, DatabaseInitializationError);
    assert.deepEqual(current.events, []);
  }
});

test('foreign owner, wrong mode, missing identity and conflicting candidates cannot open initialized storage', async () => {
  const ready = {...inventory(), initializedDatabase: {path, mode: 'native' as const}};
  for (const current of [
    {...ready, scanComplete: false},
    {...ready, initializedDatabase: {path, mode: 'adopted' as const}},
    {...ready, databaseIdentities: {}},
    {...ready, databaseIdentities: {[path]: {...identity, owner: 'another-owner'}}},
    {...ready, databaseCandidates: [`${root}/databases/powersync.db`]},
    {...ready, newDatabaseDirectory: `${root}/another`},
  ]) {
    const attempt = run(new MemoryPreferences({[INSTALLATION_KEY]: JSON.stringify(binding())}), current);
    await assert.rejects(attempt.result, DatabaseInitializationError);
    assert.deepEqual(attempt.events, []);
  }
});

test('schema failure prevents initialized SDK opening and failed fresh opening leaves no ready binding', async () => {
  for (const invalidSnapshot of [{...schema(), formatVersion: 99}, {...schema(), userVersion: 2}]) {
    const current = run(new MemoryPreferences({[INSTALLATION_KEY]: JSON.stringify(binding())}), {...inventory(), initializedDatabase: {path, mode: 'native'}}, invalidSnapshot);
    await assert.rejects(current.result, DatabaseInitializationError);
    assert.deepEqual(current.events, ['schema']);
  }
  for (const invalidSnapshot of [{...schema(), storageTables: []}, {...schema(), userVersion: 2}]) {
    const fresh = new MemoryPreferences();
    const invalid = run(fresh, inventory(), invalidSnapshot);
    await assert.rejects(invalid.result, DatabaseInitializationError);
    assert.deepEqual(invalid.events, ['open', 'schema', 'close']);
    assert.equal(fresh.values[INSTALLATION_KEY], undefined);
  }
});

test('a failed installation-record commit closes the initialized database instead of publishing it', async () => {
  const storage = new MemoryPreferences();
  storage.compareAndSwap = async () => {throw new Error('Synthetic storage failure');};
  const current = run(storage);
  await assert.rejects(current.result, /storage failure/);
  assert.deepEqual(current.events, ['open', 'schema', 'close']);
});

test('native initialized inventory without its matching stored record is rejected', async () => {
  const current = run(new MemoryPreferences(), {...inventory(), initializedDatabase: {path, mode: 'native'}});
  await assert.rejects(current.result, /record changed/);
  assert.deepEqual(current.events, []);
});

test('initialized databases admit exactly legacy or current storage, never partial or foreign tables', async () => {
  for (const storageTables of [LEGACY_DATABASE_STORAGE_TABLES, DATABASE_STORAGE_TABLES]) {
    const current = run(new MemoryPreferences({[INSTALLATION_KEY]: JSON.stringify(binding())}), {...inventory(), initializedDatabase: {path, mode: 'native'}}, {...schema(), storageTables});
    await current.result;
    assert.deepEqual(current.events, ['schema', 'open']);
  }
  for (const storageTables of [LEGACY_DATABASE_STORAGE_TABLES.slice(1), DATABASE_STORAGE_TABLES.slice(1), [...LEGACY_DATABASE_STORAGE_TABLES, 'ps_data__unexpected'], [...DATABASE_STORAGE_TABLES, 'ps_data__unexpected']]) {
    const current = run(new MemoryPreferences({[INSTALLATION_KEY]: JSON.stringify(binding())}), {...inventory(), initializedDatabase: {path, mode: 'native'}}, {...schema(), storageTables});
    await assert.rejects(current.result, DatabaseInitializationError);
    assert.deepEqual(current.events, ['schema']);
  }
});

test('iOS initialization binding relocates only inside the same logical application container', () => {
  const prefix = '/private/var/mobile/Containers/Data/Application/';
  const relativePath = 'Library/Application Support/slax-react-native/powersync.db';
  const old = `${prefix}11111111-1111-4111-8111-111111111111/${relativePath}`;
  const next = `${prefix}22222222-2222-4222-8222-222222222222/${relativePath}`;
  const identity = {owner: 'ios:app.slax.reader:/private/var/mobile/Containers/Shared/AppGroup/33333333-3333-4333-8333-333333333333', relativePath, relocationPrefix: prefix};
  const value = {...binding(), path: old, identity};
  const accepted = readInstallationBinding(JSON.stringify(value))!;
  const current = {...inventory(), initializedDatabase: {path: next, mode: 'native' as const}, newDatabaseDirectory: next.slice(0, -'/powersync.db'.length), databaseIdentities: {[next]: identity}};
  assert.equal(initializedDatabaseLocation(accepted, current).dbLocation, current.newDatabaseDirectory);
  assert.throws(() => initializedDatabaseLocation(accepted, {...current, databaseIdentities: {[next]: {...identity, owner: 'another-group'}}}), DatabaseInitializationError);
});
