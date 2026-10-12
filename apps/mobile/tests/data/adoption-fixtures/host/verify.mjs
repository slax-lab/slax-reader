import {register, createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {copyFileSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inspectFixture} from './inspect.mjs';
const repo = process.env.SLAX_FIXTURE_REPOSITORY || fileURLToPath(new URL('../../../../../../', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('../', import.meta.url));
const extensionPath = process.env.SLAX_FIXTURE_CORE_EXTENSION;
if (!extensionPath || process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This fixture requires the official macOS arm64 PowerSync core 0.5.3 extension');
assert.equal(createHash('sha256').update(readFileSync(extensionPath)).digest('hex'), '4fa96a98d7edb64a188493beb277bddcb7e85b286e2533d685ecf49ff51c6807', 'Unexpected official extension checksum');
const requireMobile = createRequire(`${repo}/apps/mobile/package.json`);
register('./loader.mjs', import.meta.url);
const sdk = await import(pathToFileURL(requireMobile.resolve('@powersync/react-native')).href);
const {DBAdapter, LockContext} = sdk;
class FixtureContext extends LockContext {
  constructor(db) {super(); this.db = db;}
  async executeRaw(sql, parameters = []) {
    const stmt = this.db.prepare(sql), columnNames = stmt.columns().map(column => column.name);
    const rows = stmt.all(...parameters);
    return {columnNames, rawRows: rows.map(row => columnNames.map(name => row[name]))};
  }
}
class FixtureAdapter extends DBAdapter {
  constructor(path) {super(); this.name = path; this.tail = Promise.resolve(); this.db = new DatabaseSync(path, {allowExtension:true}); this.db.loadExtension(extensionPath, 'sqlite3_powersync_init'); this.ctx = new FixtureContext(this.db);}
  lock(work) {const result = this.tail.then(() => work(this.ctx)); this.tail = result.catch(() => {}); return result;}
  readLock(work) {return this.lock(work);}
  writeLock(work) {return this.lock(work);}
  async refreshSchema() {}
  async close() {await this.tail; this.db.close();}
}
const source = `${fixtureRoot}/kotlin-jvm/generated`;
const target = `${fixtureRoot}/host/new-owner`; mkdirSync(target, {recursive:true});
const path = `${target}/powersync.db`;
// A closed Kotlin connection can still leave a WAL containing all recent operations.
// This is an isolated fixture clone, not a production migration/copy strategy.
for(const suffix of ['', '-wal', '-shm']) {
  rmSync(path + suffix, {force:true});
  if(existsSync(`${source}/powersync.db${suffix}`)) copyFileSync(`${source}/powersync.db${suffix}`,path + suffix);
}
const expected = JSON.parse(readFileSync(`${source}/old-sdk-report.json`, 'utf8'));
const {createMobileSchema} = await import(pathToFileURL(`${repo}/apps/mobile/src/data/schema.ts`).href);
const {uploadPendingTransactions} = await import(pathToFileURL(`${repo}/apps/mobile/src/data/uploader.ts`).href);
const {openVerifiedDatabase} = await import(pathToFileURL(`${repo}/apps/mobile/src/data/adoption.ts`).href);
const {PreferenceStore} = await import(pathToFileURL(`${repo}/apps/mobile/src/data/preferences.ts`).href);
const {MemoryPreferences} = await import(pathToFileURL(`${repo}/apps/mobile/tests/data/helpers.ts`).href);
const {decodeLegacyPreferences, migrateLegacyPreferences} = await import(pathToFileURL(`${repo}/apps/mobile/src/data/legacy-preferences.ts`).href);
const schema = await createMobileSchema();
const inventory = {scanComplete: true, databaseCandidates: [path], legacyDataDirectory: target, newDatabaseDirectory: `${target}/unused-new-owner`};
const evidence = {databasePath: path, legacySdk: 'powersync-kotlin-1.14.1', targetSdk: 'powersync-react-native-2.3.1', schemaVersion: '2', supportedOnDiskAdoption: true, verifiedFixtures: {pendingQueue: true, transactionBoundaries: true, offlineRows: true, localJson: true, reconnectOrder: true}, report: 'Controlled host fixture only; native paths, OP-SQLite and service reconnect remain unverified'};
const preferenceBytes = readFileSync(`${source}/user.preferences_pb`);
const preferenceFingerprint = createHash('sha256').update(preferenceBytes).digest('hex');
const legacyPreferences = {readLegacyPreferences: async () => ({bytes: [...preferenceBytes], fingerprint: preferenceFingerprint})};
const decoded = decodeLegacyPreferences(preferenceBytes);
assert.equal(Object.keys(decoded).length, 15);
assert.equal(decoded.auth_token, 'fixture-auth-token-NOT-A-REAL-CREDENTIAL');
assert.equal(decoded.user_id, 'synthetic-user'); assert.equal(decoded.last_refresh_time, '1700000000');
assert.equal(decoded.powersync_refresh_time, 1700000000123); assert.equal(decoded.powersync_token, 'fixture-sync-token-NOT-A-REAL-CREDENTIAL');
assert.equal(decoded.powersync_connect_url, 'https://sync.invalid/controlled-fixture');
assert.equal(decoded.cache_count, -1); assert.equal(decoded.download_images, 1); assert.equal(decoded.selected_env, 'BETA');
assert.equal(decoded.analytics_device_id, 'fixture-stable-device-id'); assert.equal(decoded.user_language, 'zh-CN'); assert.equal(decoded.user_setting_detail_do_not_alert, '1');
assert.equal(decoded.future_boolean, true); assert.deepEqual([...decoded.future_strings].sort(), ['one', 'two']);
assert.equal(JSON.parse(decoded.continue_reading_bookmark).collectionOwnerId, 'synthetic-owner');
const preferenceStorage = new MemoryPreferences();
let interrupted = true;
preferenceStorage.beforeSwap = () => {if (interrupted) {interrupted = false; throw new Error('Controlled import interruption');}};
const preferences = new PreferenceStore(preferenceStorage);
await assert.rejects(migrateLegacyPreferences(preferences, legacyPreferences), /interruption/);
assert.deepEqual(await preferences.read(), {});
preferenceStorage.beforeSwap = () => {preferenceStorage.beforeSwap = undefined; preferenceStorage.values.concurrent_extension_setting = 'retained'; preferenceStorage.revision++;};
assert.equal(await migrateLegacyPreferences(preferences, legacyPreferences), 'migrated');
const migrated = await preferences.read();
for (const [key, value] of Object.entries(decoded)) assert.deepEqual(migrated[key], value);
assert.equal(migrated.concurrent_extension_setting, 'retained');
assert.equal(await migrateLegacyPreferences(preferences, legacyPreferences), 'already-migrated');
assert.equal(createHash('sha256').update(readFileSync(`${source}/user.preferences_pb`)).digest('hex'), preferenceFingerprint);
const initialSnapshot = inspectFixture(path);
async function open() {return openVerifiedDatabase({inventory, evidence, preferences, inspector: {inspectLegacyDatabase: async path => inspectFixture(path)}, open: async () => {const db = new sdk.PowerSyncDatabase({schema, opened:new FixtureAdapter(path)}); try {await db.init(); return db;} catch (error) {await db.close(); throw error;}}});}
function normalized(transaction) {return {transactionId:transaction.transactionId, crud:transaction.crud.map(entry => ({clientId:entry.clientId, id:entry.id, op:entry.op, table:entry.table, opData:entry.opData == null ? null : Object.fromEntries(Object.entries(entry.opData).map(([key,value]) => [key,value == null ? null : String(value)])), previousValues:entry.previousValues == null ? null : Object.fromEntries(Object.entries(entry.previousValues).map(([key,value]) => [key,value == null ? null : String(value)]))}))};}
async function queue(db) {const result=[]; for await(const tx of db.getCrudTransactions()) result.push(normalized(tx)); return result;}
let db = await open();
try {
  assert.deepEqual(await queue(db), expected.transactions);
  assert.equal((await db.get('SELECT data FROM ps_data_local__local_bookmark_info WHERE id=?',['bookmark-1'])).data, expected.localJson);
  assert.equal((await db.get('SELECT alias_title,is_starred FROM sr_user_bookmark WHERE id=?',['bookmark-1'])).alias_title,'Offline article');
  await db.writeTransaction(async tx => {await tx.execute('UPDATE sr_user_bookmark SET alias_title=? WHERE id=?',['After upgrade, still offline','bookmark-1']); await tx.execute('INSERT INTO sr_user_tag(id,user_id,tag_name,display) VALUES(?,?,?,?)',['tag-3','synthetic-user','new-offline','New offline']);});
  const afterWrite = await queue(db); assert.equal(afterWrite.length,3); assert.deepEqual(afterWrite[2].crud.map(entry => entry.clientId), [5,6]);
  await db.close(); db = await open(); assert.deepEqual(await queue(db),afterWrite);
  // A failed upload must leave old and new operations untouched, including transaction IDs.
  await assert.rejects(uploadPendingTransactions(db,async () => {throw new Error('synthetic offline failure');}));
  assert.deepEqual(await queue(db),afterWrite);
  const uploads=[];
  const result=await uploadPendingTransactions(db,async changes=>{uploads.push(changes.map(change=>({id:change.id,table:change.table,op:change.op})));});
  assert.deepEqual(uploads.flat().map(entry=>entry.id),['tag-1','bookmark-1','bookmark-1','comment-1','bookmark-1','tag-3']);
  assert.equal((await queue(db)).length,0); assert.equal(result.uploaded,3);
  const report={producer:expected.producer,consumer:'powersync-react-native-2.3.1',consumerCore:db.sdkVersion,adapter:'public DBAdapter backed by Node SQLite; native OP-SQLite and actual device paths not exercised',initialSnapshot:{...initialSnapshot,databasePath:'controlled-fixture/powersync.db'},originalAndroidXSerializer:true,preferenceFieldsPreserved:Object.keys(decoded).length,preferenceImportInterruption:true,preferenceImportCASContention:true,preferenceImportIdempotence:true,originalPreferencesUntouched:true,coordinatorVerified:true,pendingQueue:true,transactionBoundaries:true,offlineRows:true,localJson:true,interruptionAfterOfflineWrite:true,retryRetainsQueue:true,uploadOrder:true,serviceReconnect:false,deviceUpgrade:false};
  writeFileSync(`${target}/new-sdk-report.json`,JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report));
} finally {await db.close();}
