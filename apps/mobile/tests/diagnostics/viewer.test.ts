import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnosticLogController} from '../../src/diagnostics/controller.ts';
import {clearDiagnostics, defaultExportDays, exportDiagnostics, listDiagnosticDays, readDiagnosticDay, type DiagnosticStorage} from '../../src/diagnostics/storage.ts';
import {readDiagnosticSnapshot} from '../../src/diagnostics/snapshot.ts';
import {ApiError} from '../../src/data/api.ts';

const now = new Date('2026-10-28T12:00:00Z');
function fixture(shareAvailable = true) {
  const files = new Map<string, string>(), exports: string[] = [], reads: string[] = [];
  const storage: DiagnosticStorage = {shareAvailable, async list() {return [...files].map(([name, text]) => ({name, size: text.length}));}, async read(name) {reads.push(name); return files.get(name) ?? '';}, size: name => files.get(name)?.length ?? 0, async append(name, lines) {files.set(name, (files.get(name) ?? '') + lines);}, async remove(name) {files.delete(name);}, async export(lines) {exports.push(lines);}};
  const snapshot = () => readDiagnosticSnapshot({database: () => null, session: () => ({status: 'unauthenticated'}), reauthentication: () => 'idle', network: () => 'offline', environment: () => 'default', version: '1', build: '2', os: 'iOS 26.1'}, shareAvailable, now);
  const controller = createDiagnosticLogController({storage, snapshot, now: () => now});
  return {files, exports, reads, storage, snapshot, controller};
}
const record = (src: string, ts: string, event = src === 'app' ? 'app.launch' : 'share.end') => JSON.stringify({v: 1, src, ts, launch: 'id', app: '1 (2)', os: 'iOS 26.1', event, ...(src === 'app' ? {} : {share: '1234abcd', outcome: 'failed', stage: 'request', reason: 'http_400', token: {present: true, len: 8, tail4: 'abcd'}, http: {status: 400, errorName: 'ERROR_PARAM', code: 400, cfRay: 'ray'}})}) + '\n';
test('empty and App Group unavailable controller states remain useful and do not read files', async () => {
  for (const available of [true, false]) {const f = fixture(available); await f.controller.open(); const state = f.controller.getSnapshot(); assert.deepEqual(state.days, []); assert.equal(state.shareAvailable, available); assert.equal(state.snapshot?.shareAvailable, available); assert.equal(state.busy, false); assert.deepEqual(f.reads, []); f.controller.close();}
});
test('populated day listing is lazy, sorts newest first, filters source and selects record detail', async () => {
  const f = fixture(); f.files.set('2026-10-28.app.ndjson', record('app', '2026-10-28T08:00:00+00:00')); f.files.set('2026-10-28.share-ios.ndjson', record('share-ios', '2026-10-28T09:00:00+00:00')); f.files.set('2026-10-27.share-android.ndjson', record('share-android', '2026-10-27T12:00:00+00:00'));
  await f.controller.open(); assert.equal(f.controller.getSnapshot().days.length, 2); assert.equal(f.reads.length, 0);
  await f.controller.openDay('2026-10-28'); assert.deepEqual(f.controller.getSnapshot().records.map(row => row.src), ['share-ios', 'app']);
  f.controller.filter('app'); assert.equal(f.controller.getSnapshot().source, 'app'); const row = f.controller.getSnapshot().records[0]!; f.controller.selectRecord(row); assert.equal(f.controller.getSnapshot().detail, row); f.controller.back(); assert.equal(f.controller.getSnapshot().detail, null); f.controller.back(); assert.equal(f.controller.getSnapshot().day, null);
});
test('export merges app and both native share formats by instant with snapshot first', async () => {
  const f = fixture();
  f.files.set('2026-10-28.app.ndjson', record('app', '2026-10-28T10:00:00+00:00'));
  f.files.set('2026-10-28.share-ios.ndjson', record('share-ios', '2026-10-28T10:00:00+02:00'));
  f.files.set('2026-10-28.share-android.ndjson', record('share-android', '2026-10-28T09:00:00+00:00') + '{partial');
  await exportDiagnostics(f.storage, await f.snapshot(), await listDiagnosticDays(f.storage), now);
  const lines = f.exports[0]!.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines[0].event, 'snapshot'); assert.deepEqual(lines.slice(1).map(row => row.src), ['share-ios', 'share-android', 'app']);
  assert.equal(lines[1].http.cfRay, 'ray'); assert.equal([...f.files.values()].some(text => text.includes('snapshot')), false);
});
test('default export selection covers calendar last seven days, and user selection is honored', async () => {
  const f = fixture(); for (const day of ['2026-10-01', '2026-10-21', '2026-10-22', '2026-10-28']) f.files.set(`${day}.app.ndjson`, record('app', `${day}T12:00:00Z`));
  const days = await listDiagnosticDays(f.storage); assert.deepEqual(defaultExportDays(days, now), ['2026-10-28', '2026-10-22']);
  await f.controller.open(); f.controller.toggleDay('2026-10-22'); await f.controller.exportSelected(); assert.equal(f.exports[0]!.trim().split('\n').length, 2);
});
test('clear removes only diagnostic ndjson files and leaves all other files intact', async () => {
  const f = fixture(); f.files.set('2026-10-28.app.ndjson', record('app', now.toISOString())); f.files.set('partial.ndjson', 'partial'); f.files.set('account.db', 'data'); f.files.set('image.png', 'image');
  await clearDiagnostics(f.storage); assert.deepEqual([...f.files.keys()], ['account.db', 'image.png']);
  await f.controller.open(); await f.controller.clear(); assert.deepEqual(f.controller.getSnapshot().days, []); assert.deepEqual([...f.files.keys()], ['account.db', 'image.png']);
});
test('snapshot reads status and queue stats, redacts errors and never exposes session credentials', async () => {
  const snapshot = await readDiagnosticSnapshot({database: () => ({currentStatus: {connected: true, lastSyncedAt: now, uploadError: new ApiError(503, 'secret body'), downloadError: new Error('token=file:///private')}, getUploadQueueStats: async () => ({count: 3})}), session: () => ({status: 'authenticated', token: 'secret'}), reauthentication: () => 'reauthentication-required', network: () => 'online', environment: () => 'BETA', version: '1', build: '2', os: 'Android 17'}, true, now);
  assert.deepEqual(snapshot.sync, {connected: true, lastSyncedAt: now.toISOString(), uploadError: {class: 'ApiError', status: 503}, downloadError: {class: 'Error'}, pendingUploads: 3});
  assert.equal(snapshot.session, 'authenticated'); assert.equal(JSON.stringify(snapshot).includes('secret'), false); assert.equal(JSON.stringify(snapshot).includes('private'), false);
});
test('closed controller ignores late reads and errors, and exports are single flight', async () => {
  const f = fixture(); let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  const controller = createDiagnosticLogController({storage: f.storage, snapshot: async () => {await gate; return f.snapshot();}}); const opening = controller.open(); controller.close(); release(); await opening; assert.equal(controller.getSnapshot().snapshot, null);
  await f.controller.open(); let exported = 0, finish!: () => void; f.storage.export = async () => {exported++; await new Promise<void>(resolve => {finish = resolve;});};
  const first = f.controller.exportSelected(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await f.controller.exportSelected(); while (!finish) await Promise.resolve(); finish(); await first; assert.equal(exported, 1);
});
test('closing during delayed export prevents sharing stale results', async () => {
  const f = fixture(); f.files.set('2026-10-28.app.ndjson', record('app', now.toISOString())); await f.controller.open();
  let release!: () => void, reading = false; const gate = new Promise<void>(resolve => {release = resolve;});
  f.storage.read = async name => {reading = true; await gate; return f.files.get(name)!;};
  const exporting = f.controller.exportSelected(); while (!reading) await Promise.resolve(); f.controller.close(); release(); await exporting; assert.deepEqual(f.exports, []);
});
test('corrupt or oversized lines are ignored and inaccessible day files do not crash the viewer', async () => {
  const f = fixture(); f.files.set('2026-10-28.app.ndjson', record('app', now.toISOString()) + JSON.stringify({v: 1, src: 'app', event: 'app.launch', ts: now.toISOString(), value: 'x'.repeat(5000)}) + '\ninvalid\n');
  assert.equal((await readDiagnosticDay(f.storage, (await listDiagnosticDays(f.storage))[0]!)).length, 1);
  f.storage.read = async () => {throw new Error('removed concurrently');}; await f.controller.open(); await f.controller.openDay('2026-10-28'); assert.deepEqual(f.controller.getSnapshot().records, []);
});
