import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticDay} from '../../src/domain/diagnostics.ts';
import {buildDiagnosticExport, defaultExportDays, stageRecentDiagnostics, shareRecentDiagnostics, DIAGNOSTIC_UPLOAD_MAX_BYTES, type DiagnosticStorage} from '../../src/diagnostics/storage.ts';
import {sanitizeDiagnosticRecord} from '../../src/diagnostics/export-sanitize.ts';

const record = (ts: string, src = 'app') => ({v: 1, event: src === 'app' ? 'app.launch' : 'share.start', ts, src, launch: 'abcd1234', app: '1.0.25 (794)', os: 'iOS 26.1', share: 'abcd1234'});
function fixture() {
  const files = new Map<string, string>(), staged: string[] = []; let releases = 0, flushes = 0, shares = 0;
  const storage: DiagnosticStorage = {shareAvailable: true, size: () => 0, append: async () => {}, list: async () => [...files].map(([name, text]) => ({name, size: text.length})), read: async name => files.get(name)!, remove: async name => {files.delete(name);}, export: async () => {},
    async stage(lines) {staged.push(lines); return {uri: 'file:///cache/slax-diagnostics-test.ndjson', filename: 'slax-diagnostics-test.ndjson', file: new Blob([lines], {type: 'application/x-ndjson'}), release() {releases++;}};},
    async share(file) {assert.equal(await file.file.text(), staged.at(-1)); shares++;},
  };
  const source = {storage, now: () => new Date(2026, 9, 29, 0, 1), async flush() {flushes++;}};
  return {files, staged, source, storage, stats: () => ({releases, flushes, shares})};
}
test('recent exports flush real pending writes and never fabricate a snapshot or header', async () => {
  const f = fixture(); let count = 0;
  f.source.flush = async () => {count++; f.files.set('2026-10-29.app.ndjson', JSON.stringify(record(`2026-10-29T00:01:0${count}.000Z`)) + '\n');};
  const one = await stageRecentDiagnostics(f.source); one.release(); const two = await stageRecentDiagnostics(f.source); two.release();
  assert.equal(count, 2); assert.notEqual(f.staged[0], f.staged[1]);
  for (const text of f.staged) {const rows = text.trim().split('\n').map(line => JSON.parse(line)); assert.equal(rows.length, 1); assert.equal(rows[0].event, 'app.launch'); assert.equal(rows[0].sync, undefined);}
  await shareRecentDiagnostics(f.source); assert.equal(f.stats().shares, 1); assert.equal(f.stats().releases, 3);
});
test('empty and historical snapshot-only logs never stage or share an attachment', async () => {
  const f = fixture();
  await assert.rejects(stageRecentDiagnostics(f.source), /empty/);
  f.files.set('2026-10-29.app.ndjson', JSON.stringify({v: 1, event: 'snapshot', ts: '2026-10-29T00:00:00Z', sync: {connected: true}}) + '\n');
  await assert.rejects(shareRecentDiagnostics(f.source), /empty/);
  assert.deepEqual(f.stats(), {releases: 0, flushes: 2, shares: 0}); assert.deepEqual(f.staged, []); assert.equal(f.files.size, 1);
});
test('recent export uses local dates across midnight and daylight-saving boundaries', () => {
  const previous = process.env.TZ; process.env.TZ = 'America/New_York';
  try {
    for (const now of [new Date('2026-03-09T00:01:00-04:00'), new Date('2026-11-02T00:01:00-05:00'), new Date('2026-10-29T00:01:00-04:00')]) {
      const days = Array.from({length: 10}, (_, i) => {const date = new Date(now); date.setDate(date.getDate() - i); return {day: diagnosticDay(date), files: [], size: 0};});
      assert.deepEqual(defaultExportDays(days, now), days.slice(0, 7).map(day => day.day));
    }
  } finally {if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;}
});
test('recent merged output excludes old and future dates and sorts all sources by instant', async () => {
  const f = fixture();
  for (const [day, src, hour] of [['2026-10-22', 'app', '01'], ['2026-10-23', 'share-ios', '03'], ['2026-10-29', 'share-android', '01'], ['2026-10-23', 'app', '02'], ['2026-10-30', 'app', '01']]) f.files.set(`${day}.${src}.ndjson`, JSON.stringify(record(`${day}T${hour}:00:00.000Z`, src)) + '\n');
  const file = await stageRecentDiagnostics(f.source), rows = (await file.file.text()).trim().split('\n').map(line => JSON.parse(line)); file.release();
  assert.deepEqual(rows.map(row => row.src), ['app', 'share-ios', 'share-android']);
  assert.equal(rows.some(row => row.event === 'snapshot' || 'sync' in row), false);
});
test('export boundary strips legacy ordinary metadata and keeps lifecycle metadata and failure details', () => {
  const dirty = {...record('2026-10-29T00:00:00.000Z', 'share-ios'), event: 'share.end', outcome: 'failed', reason: 'network_timeout', body: 'secret-body', title: 'secret-title', token: {present: true, len: 20, tail4: 'abcd', raw: 'secret-token'}, host: 'https://example.org/private?token=secret',
    input: {url: {scheme: 'https', host: 'https://example.org/private', path: '/secret-path', query: 'secret-query'}, title: 'secret-title', types: ['public.url', 'file:///private/secret']},
    error: {domain: 'NSURLErrorDomain', code: -1001, message: 'secret-message', file: '/private/secret'}, shown: 'secret-response', http: {status: 400, errorName: 'ERROR_PARAM', body: 'secret-response'},
    net: {wait: 8000, failedIn: 'wait'}, ms: {request: 8000, total: 8010}, headers: {'Authorization': 'secret-token'}, network: {ip: 'secret-ip'}, sync: {connected: true, pendingUploads: 2}};
  const safe = sanitizeDiagnosticRecord(dirty)!;
  assert.equal(safe.host, 'example.org'); assert.deepEqual(safe.token, {present: true, len: 20, tail4: 'abcd'});
  assert.equal(JSON.stringify(safe).includes('secret'), false); assert.equal(safe.shown, '[redacted]');
  assert.deepEqual(safe.net, {wait: 8000, failedIn: 'wait'}); assert.deepEqual(safe.ms, {request: 8000, total: 8010});
  for (const key of ['app', 'os', 'sync', 'network']) assert.equal(key in safe, false);
  for (const src of ['app', 'share-ios', 'share-android']) {const start = sanitizeDiagnosticRecord(record(dirty.ts, src))!; assert.equal(start.app, '1.0.25 (794)'); assert.equal(start.os, 'iOS 26.1');}
  assert.equal(sanitizeDiagnosticRecord({...dirty, event: 'custom.event'}), null);
  assert.equal(sanitizeDiagnosticRecord({...dirty, event: 'snapshot'}), null);
  const auth = sanitizeDiagnosticRecord({...record(dirty.ts), event: 'auth.login', provider: 'google', ok: false, sync: {connected: true}, headers: {request: {'Authorization': 'Bearer secret-long-token-abcd', 'Cookie': 'secret-cookie', 'User-Agent': 'https://secret/path'}, response: {'Set-Cookie': 'secret-cookie', 'CF-Ray': '1234-LAX', 'Server': 'secret-server'}}})!;
  assert.deepEqual((auth.headers as {request: unknown}).request, {Authorization: {present: true, len: 22, tail4: 'abcd'}});
  assert.equal(JSON.stringify(auth).includes('secret'), false);
  for (const key of ['app', 'os', 'sync']) assert.equal(key in auth, false);
});
test('export does not silently drop unreadable selected files and releases oversized staged files', async () => {
  const f = fixture(), originalRead = f.storage.read; f.storage.read = async () => {throw new Error('I/O failure');};
  await assert.rejects(buildDiagnosticExport(f.storage, [{day: '2026-10-29', size: 10, files: [{name: '2026-10-29.app.ndjson', src: 'app', day: '2026-10-29', size: 10}]}]), /I.O failure/);
  f.storage.read = originalRead; f.files.set('2026-10-29.app.ndjson', JSON.stringify(record('2026-10-29T00:00:00Z')) + '\n');
  f.storage.stage = async () => ({uri: 'file:///big', filename: 'slax-diagnostics-big.ndjson', file: new Blob([new Uint8Array(DIAGNOSTIC_UPLOAD_MAX_BYTES + 1)]), release() {f.staged.push('released');}});
  await assert.rejects(stageRecentDiagnostics(f.source), /too-large/); assert.deepEqual(f.staged, ['released']);
});
test('cancellation after staging releases the file and never opens the share sheet', async () => {
  const f = fixture(); f.files.set('2026-10-29.app.ndjson', JSON.stringify(record('2026-10-29T00:00:00Z')) + '\n');
  let active = true; const original = f.storage.stage!; f.storage.stage = async (...args) => {const file = await original(...args); active = false; return file;};
  await assert.rejects(shareRecentDiagnostics(f.source, () => {if (!active) throw new Error('cancelled');}), /cancelled/);
  assert.equal(f.stats().releases, 1); assert.equal(f.stats().shares, 0);
});
test('mobile export and upload limits match the shared backend feedback contract', async () => {
  const shared = await import('@slax-reader/contracts/feedback');
  assert.equal(DIAGNOSTIC_UPLOAD_MAX_BYTES, shared.DIAGNOSTIC_ATTACHMENT_MAX_BYTES);
  const api = await import('../../src/data/api.ts');
  assert.equal(api.FEEDBACK_DIAGNOSTIC_MAX_BYTES, shared.DIAGNOSTIC_ATTACHMENT_MAX_BYTES);
  assert.equal(api.FEEDBACK_MULTIPART_OVERHEAD_BYTES, shared.DIAGNOSTIC_MULTIPART_OVERHEAD_MAX_BYTES);
  const f = fixture();
  f.files.set('2026-10-29.share-ios.ndjson', JSON.stringify({...record('2026-10-29T00:00:00Z', 'share-ios'), event: 'share.end', outcome: 'failed', reason: 'network_timeout'}) + '\n');
  const file = await stageRecentDiagnostics(f.source);
  for (const line of (await file.file.text()).trim().split('\n')) assert.ok(shared.sanitizeDiagnosticExportEntry(JSON.parse(line)));
  file.release();
});
test('invalid event shapes cannot poison an otherwise usable recent export', () => {
  const base = record('2026-10-29T00:00:00Z');
  for (const value of [{...base, event: 'auth.login'}, {...base, event: 'auth.signout', cause: 'not-a-cause'}, {...base, event: 'share.end'}, {...base, event: 'log.dropped', count: -1}]) assert.equal(sanitizeDiagnosticRecord(value), null);
  const safe = sanitizeDiagnosticRecord({...base, event: 'auth.refresh_failed', http: {path: '/v1/user/private-secret-link?token=sensitive'}, error: {class: 'a'.repeat(48), domain: 'file:///private/path'}});
  assert.equal(JSON.stringify(safe).includes('sensitive'), false); assert.equal(JSON.stringify(safe).includes('private'), false); assert.equal(JSON.stringify(safe).includes('a'.repeat(48)), false);
});
