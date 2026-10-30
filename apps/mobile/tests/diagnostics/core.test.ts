import test from 'node:test';
import assert from 'node:assert/strict';
import {DIAGNOSTIC_DAILY_BYTES, DIAGNOSTIC_QUOTA_BYTES, diagnosticDay, diagnosticTimestamp, parseDiagnosticFilename, recordDiagnostic} from '../../src/domain/diagnostics.ts';
import {redactError} from '../../src/diagnostics/redact.ts';
import {redactAuthorization, redactHeaders} from '../../src/domain/diagnostic-headers.ts';
import {createDiagnosticTransport, type DiagnosticClock} from '../../src/diagnostics/transport.ts';
import {pruneDiagnostics, type DiagnosticStorage} from '../../src/diagnostics/storage.ts';
import {ApiError, DataTransportError} from '../../src/data/api.ts';
import {createInteractiveSignal} from '../../src/observe/interactive.ts';

const common = {launch: 'cold-start', app: '1 (2)', os: 'iOS 26.1'};
function fixture() {
  let now = new Date(2026, 9, 28, 12), next = 0, fail = false, gate: Promise<void> | undefined, inFlight = 0, maximum = 0;
  const timers = new Map<number, {callback(): void; at: number}>(), files = new Map<string, string>(), calls: string[] = [], stats: string[] = [];
  const clock: DiagnosticClock = {now: () => now, schedule(callback, ms) {const id = ++next; timers.set(id, {callback, at: now.getTime() + ms}); return id;}, cancel(id) {timers.delete(id as number);}};
  const transport = createDiagnosticTransport({size: name => {stats.push(name); return new TextEncoder().encode(files.get(name) ?? '').length;}, async append(name, lines) {calls.push(name); maximum = Math.max(maximum, ++inFlight); try {await gate; if (fail) throw new Error('write denied'); files.set(name, (files.get(name) ?? '') + lines);} finally {inFlight--;}}}, common, clock);
  const record = (fields = {}) => transport.transport({rawMsg: [{...common, v: 1, ts: diagnosticTimestamp(now), src: 'app', event: 'app.launch', ...fields}]});
  return {transport, record, files, calls, stats, clock, timers, maximum: () => maximum, fail: (value: boolean) => {fail = value;}, gate: (value?: Promise<void>) => {gate = value;}, date: (value: Date) => {now = value;},
    async advance(ms: number) {now = new Date(now.getTime() + ms); for (const [id, timer] of [...timers]) if (timer.at <= now.getTime()) {timers.delete(id); timer.callback();} await transport.flush();},
    records: () => [...files.values()].flatMap(text => text.trim().split('\n').map(line => JSON.parse(line))),
  };
}
test('headers and errors remove tokens, bodies, arbitrary headers, and freeform messages', () => {
  assert.deepEqual(redactAuthorization('Bearer abcdefgh'), {present: true, len: 8, tail4: 'efgh'});
  for (const [value, len] of [['abc', 3], ['Bearer abcd', 4], ['', 0], [undefined, 0]] as const) assert.deepEqual(redactAuthorization(value), {present: len > 0, len});
  assert.deepEqual(redactAuthorization('abcde'), {present: true, len: 5, tail4: 'bcde'});
  const request = redactHeaders(new Headers({authorization: 'Bearer abcdefgh', cookie: 'secret', 'X-CLIENT-TYPE': 'ios', 'User-Agent': 'SlaxReader'}), 'request');
  assert.deepEqual(request, {'User-Agent': 'SlaxReader', 'X-CLIENT-TYPE': 'ios', Authorization: {present: true, len: 8, tail4: 'efgh'}});
  assert.deepEqual(redactHeaders(new Headers({'CF-Ray': 'ray', 'Set-Cookie': 'secret'}), 'response'), {'CF-Ray': 'ray'});
  assert.deepEqual(redactError(new ApiError(503, 'secret document title', {token: 'private'})), {class: 'ApiError', code: 'http_server_error', status: 503});
  assert.deepEqual(redactError(new DataTransportError('timeout', 'api')), {class: 'DataTransportError', code: 'request_timeout'});
  assert.deepEqual(redactError(Object.assign(new Error('/private/file/token'), {domain: 'NSURLErrorDomain', code: -1009})), {class: 'Error', domain: 'NSURLErrorDomain', code: -1009});
  const hostile = new Proxy({}, {get() {throw new Error('getter');}});
  assert.doesNotThrow(() => redactHeaders(hostile, 'request')); assert.doesNotThrow(() => redactError(hostile));
  assert.doesNotThrow(() => recordDiagnostic({record() {throw new Error('sink');}}, 'app.launch', {}));
});
test('local date and timestamp names are zero padded and validate calendar dates', () => {
  const date = new Date(2026, 0, 2, 3, 4, 5, 6);
  assert.equal(diagnosticDay(date), '2026-01-02'); assert.match(diagnosticTimestamp(date), /^2026-01-02T03:04:05\.006[+-]\d{2}:\d{2}$/);
  assert.deepEqual(parseDiagnosticFilename('2026-01-02.share-ios.ndjson'), {day: '2026-01-02', src: 'share-ios'});
  assert.equal(parseDiagnosticFilename('2026-02-30.app.ndjson'), null); assert.equal(parseDiagnosticFilename('../2026-01-02.app.ndjson'), null);
});
test('queue is bounded, drops oldest, and emits overflow count once on successful flush', async () => {
  const f = fixture(); for (let i = 0; i < 205; i++) f.record({index: i});
  assert.equal(f.transport.getState().pending, 200); assert.equal(f.transport.getState().dropped, 5);
  await f.transport.flush(); const rows = f.records(); assert.equal(rows[0].event, 'log.dropped'); assert.equal(rows[0].count, 5); assert.equal(rows[1].index, 5);
  f.record(); await f.transport.flush(); assert.equal(f.records().filter(row => row.event === 'log.dropped').length, 1);
});
test('pretransport scheduling is bounded too and background drains immediately', async () => {
  const f = fixture(); for (let i = 0; i < 210; i++) f.transport.schedule(() => f.record({index: i}));
  assert.equal(f.transport.getState().pending, 200); f.transport.background(); await f.transport.flush();
  assert.equal(f.records()[0].count, 10); assert.equal(f.records()[1].index, 10); assert.equal(f.timers.size, 0);
});
test('first pending entry arms a two-second timer and writes never overlap', async () => {
  const f = fixture(); f.record(); assert.equal([...f.timers.values()][0]!.at - f.clock.now().getTime(), 2000);
  let release!: () => void; f.gate(new Promise(resolve => {release = resolve;}));
  const first = f.transport.flush(); await Promise.resolve(); await Promise.resolve(); f.record(); const second = f.transport.flush(); assert.equal(first, second); release(); await first; f.gate(); await f.transport.flush(); assert.equal(f.maximum(), 1);
});
test('three consecutive failures disable until process restart and never retry without records', async () => {
  const f = fixture(); f.fail(true);
  for (let i = 0; i < 3; i++) {f.record(); await assert.doesNotReject(f.transport.flush()); assert.equal(f.timers.size, 0);}
  assert.equal(f.transport.getState().disabled, true); f.fail(false); f.record(); f.transport.background(); await f.transport.flush(); assert.equal(f.calls.length, 3);
});
test('successful write resets consecutive failures and overflow survives failed flush', async () => {
  const f = fixture(); f.fail(true); for (let i = 0; i < 201; i++) f.record(); await f.transport.flush();
  assert.equal(f.transport.getState().dropped, 1); f.fail(false); f.record(); await f.transport.flush(); assert.equal(f.transport.getState().failures, 0); assert.equal(f.records()[0].count, 1);
});
test('date rollover preserves event date and allowance permits one truncation marker', async () => {
  const f = fixture(); const name = '2026-10-28.app.ndjson'; f.files.set(name, ' '.repeat(DIAGNOSTIC_DAILY_BYTES - 1)); f.record(); f.record(); await f.transport.flush();
  assert.equal((f.files.get(name)!.match(/log.truncated/g) ?? []).length, 1); const size = f.files.get(name)!.length; f.record(); await f.transport.flush(); assert.equal(f.files.get(name)!.length, size);
  f.date(new Date(2026, 9, 29)); f.record(); await f.transport.flush(); assert.ok(f.files.has('2026-10-29.app.ndjson'));
});
test('daily size is cached so normal flushes only append; rollover, write errors and forget re-read it', async () => {
  const f = fixture(); for (let i = 0; i < 5; i++) {f.record(); await f.transport.flush();}
  assert.deepEqual(f.stats, ['2026-10-28.app.ndjson']); assert.equal(f.calls.length, 5);
  f.fail(true); f.record(); await f.transport.flush(); f.fail(false); f.record(); await f.transport.flush(); assert.equal(f.stats.length, 2);
  f.transport.forget(); f.files.clear(); f.record(); await f.transport.flush(); assert.equal(f.stats.length, 3);
  f.date(new Date(2026, 9, 29)); f.record(); await f.transport.flush(); f.record(); await f.transport.flush(); assert.deepEqual(f.stats.slice(3), ['2026-10-29.app.ndjson']);
  const full = fixture(); full.files.set('2026-10-28.app.ndjson', ' '.repeat(DIAGNOSTIC_DAILY_BYTES)); for (let i = 0; i < 3; i++) {full.record(); await full.transport.flush();}
  assert.equal(full.stats.length, 1); assert.equal(full.calls.length, 0);
});
test('oversized UTF-8 lines and malformed inputs are dropped without throwing', async () => {
  const f = fixture(); f.record({extra: '你'.repeat(1500)}); assert.equal(f.transport.getState().pending, 0);
  const cyclic: any = {}; cyclic.self = cyclic; assert.doesNotThrow(() => f.record(cyclic));
  assert.doesNotThrow(() => f.transport.transport({rawMsg: null}));
  const hostile = new Proxy({}, {get() {throw new Error('unsafe');}}); assert.doesNotThrow(() => f.transport.transport({rawMsg: [hostile]}));
  const broken = createDiagnosticTransport({size() {throw new Error('stat');}, async append() {throw new Error('append');}}, common, {now() {throw new Error('clock');}, schedule() {throw new Error('schedule');}, cancel() {throw new Error('cancel');}});
  assert.doesNotThrow(() => broken.schedule(() => {throw new Error('work');})); assert.doesNotThrow(() => broken.background()); await assert.doesNotReject(broken.flush()); assert.doesNotThrow(() => broken.dispose());
});
test('retention removes expired files then oldest first to quota and preserves nonlogs', async () => {
  const files = [{name: '2026-09-01.app.ndjson', size: 1}, {name: '2026-10-01.app.ndjson', size: DIAGNOSTIC_QUOTA_BYTES}, {name: '2026-10-28.share-ios.ndjson', size: 5}, {name: 'keep.txt', size: 999}]; const removed: string[] = [];
  await pruneDiagnostics({list: async () => files, remove: async name => {removed.push(name);}} as DiagnosticStorage, new Date(2026, 9, 28));
  assert.deepEqual(removed, ['2026-09-01.app.ndjson', '2026-10-01.app.ndjson']);
});
test('first-interactive signal fires once for early and late subscribers and honors unsubscribe', () => {
  const signal = createInteractiveSignal(), calls: string[] = [];
  signal.subscribe(() => calls.push('early')); const stop = signal.subscribe(() => calls.push('removed')); stop(); signal.subscribe(() => {throw new Error('listener');});
  assert.equal(calls.length, 0); signal.mark(); signal.mark(); signal.subscribe(() => calls.push('late'));
  assert.deepEqual(calls, ['early', 'late']);
});
