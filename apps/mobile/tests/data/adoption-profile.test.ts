import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {URL} from 'node:url';
import {deriveReviewedAdoptionEvidence, REVIEWED_ADOPTION_PROFILE} from '../../src/data/adoption-profile.ts';
import {openVerifiedDatabase, DatabaseAdoptionRejected} from '../../src/data/adoption.ts';
import type {DatabaseSnapshot} from '../../src/data/adoption.ts';
import type {LegacyInventory} from '../../src/data/upgrade.ts';
import {UpgradeVerificationRequired} from '../../src/data/upgrade.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {MOBILE_TABLES} from '../../src/data/schema.ts';
import {MemoryPreferences} from './helpers.ts';

const android = (root = '/data/data/com.slax.reader'): LegacyInventory => {
  const databasePath = `${root}/databases/powersync.db`;
  return {scanComplete: true, databaseCandidates: [databasePath], legacyDataDirectory: root, newDatabaseDirectory: `${root}/slax-powersync`, databaseIdentities: {[databasePath]: {owner: `android:com.slax.reader:${root}/files`, relativePath: 'databases/powersync.db'}}};
};
const simRoot = '/Users/test/Library/Developer/CoreSimulator/Devices/522DD84F-0407-4707-BBAB-0263B4ACE2DA/data/Containers/';
const app = '9F3CD522-89CD-4B8E-9074-F592D18ADCC3', group = 'CA892185-0726-4753-9AD1-B47FF2383CA5';
const ios = (containers = simRoot, application = app): LegacyInventory => {
  const support = `${containers}Data/Application/${application}/Library/Application Support`, databasePath = `${support}/databases/powersync.db`;
  return {scanComplete: true, databaseCandidates: [databasePath], legacyDataDirectory: support, newDatabaseDirectory: `${support}/slax-powersync`, databaseIdentities: {[databasePath]: {owner: `ios:app.slax.reader:${containers}Shared/AppGroup/${group}`, relativePath: 'Library/Application Support/databases/powersync.db', relocationPrefix: `${containers}Data/Application/`}}};
};

test('the reviewed profile binds immutable native execution reports, public SDK pins and compiled native source', () => {
  for (const evidence of REVIEWED_ADOPTION_PROFILE.evidence) {
    const bytes = readFileSync(new URL(`./adoption-fixtures/reports/${evidence.report}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), evidence.sha256);
    assert.equal(JSON.parse(bytes.toString()).status, 'passed');
  }
  for (const native of REVIEWED_ADOPTION_PROFILE.nativeCompatibilitySources) {
    const reviewedSource = 'reviewedSource' in native ? native.reviewedSource : native.path;
    assert.equal(createHash('sha256').update(readFileSync(new URL(`../../${reviewedSource}`, import.meta.url))).digest('hex'), native.sha256);
  }
  const dependencies = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).dependencies;
  assert.equal(`powersync-react-native-${dependencies['@powersync/react-native']}`, REVIEWED_ADOPTION_PROFILE.targetSdk);
  assert.equal(`op-sqlite-${dependencies['@op-engineering/op-sqlite']}`, REVIEWED_ADOPTION_PROFILE.sqliteDriver);
});

test('current native paths derive per-install evidence for Android users/work profiles and iOS device/container updates', () => {
  for (const [platform, inventory] of [['android', android()], ...['0', '1', '10', '999'].map(user => ['android', android(`/data/user/${user}/com.slax.reader`)] as const), ['ios', ios()], ['ios', ios(simRoot, 'D315E11D-47AA-4DC9-B770-FF2B5B4A67FF')], ['ios', ios('/private/var/mobile/Containers/')], ['ios', ios('/var/mobile/Containers/')]] as const) {
    const evidence = deriveReviewedAdoptionEvidence(inventory, platform)!;
    assert.equal(evidence.databasePath, inventory.databaseCandidates[0]);
    assert.equal(evidence.report, REVIEWED_ADOPTION_PROFILE.id);
  }
  assert.equal(deriveReviewedAdoptionEvidence({...android(), databaseCandidates: [], databaseIdentities: {}}, 'android'), undefined);
});

test('unknown paths, owners, native identities and incomplete/multiple inventories never acquire adoption evidence', () => {
  const a = android(), i = ios(), aPath = a.databaseCandidates[0]!, iPath = i.databaseCandidates[0]!;
  for (const [platform, inventory] of [
    ['android', {...a, scanComplete: false}], ['android', {...a, databaseCandidates: [aPath, `${a.legacyDataDirectory}/other/powersync.db`]}],
    ['android', {...a, databaseIdentities: {}}],
    ...['-1', '+1', '01', '1.0', '1e1', ' 10', '10/..', '١٠'].map(user => ['android', android(`/data/user/${user}/com.slax.reader`)]),
    ...['/tmp/data/user/10/com.slax.reader', '/data/user/10/other.app', '/data/user/10/com.slax.reader/..', '/data//user/10/com.slax.reader', '/data/user_de/10/com.slax.reader', '/data/data/other.app', '/data/user/10/com.slax.reader\n'].map(root => ['android', android(root)]),
    ['android', {...a, databaseIdentities: {[aPath]: {...a.databaseIdentities![aPath]!, owner: 'android:com.slax.reader:/data/user/10/com.slax.reader/files'}}}],
    ['android', {...a, databaseCandidates: [`${a.legacyDataDirectory}/other/powersync.db`]}],
    ['android', {...a, databaseIdentities: {[aPath]: {...a.databaseIdentities![aPath]!, owner: 'android:another-app:another-owner'}}}],
    ['android', {...a, databaseIdentities: {[aPath]: {...a.databaseIdentities![aPath]!, relativePath: 'other/powersync.db'}}}],
    ['android', {...a, databaseIdentities: {[aPath]: {...a.databaseIdentities![aPath]!, relocationPrefix: '/foreign/'}}}],
    ['ios', {...i, databaseIdentities: {}}],
    ['ios', {...i, databaseIdentities: {[iPath]: {...i.databaseIdentities![iPath]!, owner: i.databaseIdentities![iPath]!.owner.replace('app.slax.reader:', 'other.app:')}}}],
    ['ios', {...i, databaseIdentities: {[iPath]: {...i.databaseIdentities![iPath]!, owner: i.databaseIdentities![iPath]!.owner.replace('522DD84F', '12345678')}}}],
    ['ios', {...i, databaseIdentities: {[iPath]: {...i.databaseIdentities![iPath]!, relocationPrefix: simRoot.replace('522DD84F', '12345678') + 'Data/Application/'}}}],
    ['ios', {...i, databaseIdentities: {[iPath]: {...i.databaseIdentities![iPath]!, relativePath: 'databases/powersync.db'}}}],
    ['ios', {...i, legacyDataDirectory: i.legacyDataDirectory.replace('/Application/', '/Application/../Application/')}],
    ['ios', {...i, databaseCandidates: [iPath.replace('/databases/', '/databases/../databases/')]}],
  ] as [string, LegacyInventory][]) assert.throws(() => deriveReviewedAdoptionEvidence(inventory, platform), UpgradeVerificationRequired);
});

test('profile evidence still requires the complete native snapshot before any SDK or checkpoint mutation', async () => {
  const inventory = ios(), evidence = deriveReviewedAdoptionEvidence(inventory, 'ios')!;
  const snapshot: DatabaseSnapshot = {databasePath: evidence.databasePath, integrityValid: true, formatVersion: 14, userVersion: 1, storageTables: Object.keys(MOBILE_TABLES).map(table => `${table === 'local_bookmark_info' ? 'ps_data_local__' : 'ps_data__'}${table}`), pendingOperations: 4, pendingTransactions: 2, queueDigest: 'a'.repeat(64), dataDigest: 'b'.repeat(64), localDigest: 'c'.repeat(64)};
  for (const invalid of [{...snapshot, formatVersion: 15}, {...snapshot, userVersion: 2}, {...snapshot, integrityValid: false}, {...snapshot, storageTables: [...snapshot.storageTables, 'ps_data__unknown']}, {...snapshot, pendingOperations: -1}, {...snapshot, pendingTransactions: 0}, {...snapshot, pendingOperations: 0}, {...snapshot, pendingOperations: 1}, {...snapshot, queueDigest: ''}, {...snapshot, databasePath: '/another/powersync.db'}]) {
    let opens = 0; const storage = new MemoryPreferences({auth_token: 'synthetic-original-auth'});
    await assert.rejects(openVerifiedDatabase({inventory, evidence, preferences: new PreferenceStore(storage), inspector: {inspectLegacyDatabase: async () => invalid}, open: async () => {opens++; return {close: async () => {}};}}), DatabaseAdoptionRejected);
    assert.equal(opens, 0); assert.equal(storage.revision, 0); assert.deepEqual(storage.values, {auth_token: 'synthetic-original-auth'});
  }
  let opens = 0; const storage = new MemoryPreferences();
  await openVerifiedDatabase({inventory, evidence, preferences: new PreferenceStore(storage), inspector: {inspectLegacyDatabase: async () => snapshot}, open: async location => {opens++; assert.equal(location.dbFilename, 'powersync.db'); assert.equal(location.dbLocation, inventory.legacyDataDirectory + '/databases'); assert.equal(JSON.parse(String(storage.values._slax_database_adoption_v1)).phase, 'opening'); return {close: async () => {}};}});
  assert.equal(opens, 1); assert.equal(JSON.parse(String(storage.values._slax_database_adoption_v1)).phase, 'accepted');
});
