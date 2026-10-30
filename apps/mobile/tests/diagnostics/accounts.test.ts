import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionController} from '../../src/domain/session.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {FixtureMemoryPreferences} from '../../fixtures/isolation.ts';
import {SlaxApi} from '../../src/data/api.ts';
import {createAccountDiagnostics} from '../../src/diagnostics/exchanges.ts';
import {CredentialReadiness} from '../../src/domain/credential-readiness.ts';
import {loginWithProvider} from '../../src/auth/login.ts';
import {uploadPendingTransactions, type PendingTransaction} from '../../src/data/uploader.ts';
import {deleteCurrentAccount} from '../../src/domain/delete-account.ts';
import type {DiagnosticExchange, DiagnosticSink, SignOutCause} from '../../src/domain/diagnostics.ts';

function setup(fetch: typeof globalThis.fetch = async () => new Response(JSON.stringify({code: 200, data: {token: 'new-token', user_id: 'user'}})), now = () => 100) {
  const records: {event: string; fields: any}[] = [], failed: DiagnosticExchange[] = [];
  const sink: DiagnosticSink = {record(event, fields) {records.push({event, fields});}};
  const sessions = new SessionController(new PreferenceStore(new FixtureMemoryPreferences({})), {leave: async () => {}, enter: async () => {}}, now, {diagnostics: sink});
  const observer = createAccountDiagnostics(sink, () => sessions.captureRequestScope().assertCurrent);
  const api = new SlaxApi({baseUrl: 'https://example.test', platform: 'ios', version: '1 (2)', sessions, fetch, sleep: async () => {}, onFailedExchange: value => {failed.push(value); observer.failed(value);}, onAccountSuccess: observer.succeeded});
  return {sessions, records, api, failed, sink};
}
for (const cause of ['user', 'unauthorized', 'account_deleted', 'environment_switch', 'other'] as SignOutCause[]) test(`one signout record for ${cause} action`, async () => {
  const f = setup(); await f.sessions.accept('secret-token', 'user'); await f.sessions.signOut(true, cause); await f.sessions.signOut(true, cause);
  assert.deepEqual(f.records, [{event: 'auth.signout', fields: {cause}}]);
});
test('successful rejection records once per identity epoch, including concurrent and repeated rejection', async () => {
  const f = setup(); await f.sessions.accept('secret', 'user'); const scope = f.sessions.captureRequestScope();
  const http = {method: 'POST', path: '/v1/user/refresh', status: 401, code: 401, cfRay: 'ray'};
  await Promise.all([f.sessions.rejectIfMatches('secret', scope, http), f.sessions.rejectIfMatches('secret', scope, http)]);
  await f.sessions.rejectIfMatches('secret', undefined, http); assert.equal(f.records.length, 1); assert.deepEqual(f.records[0]!.fields.http, http);
  await f.sessions.signOut(false, 'unauthorized'); assert.equal(f.records[1]!.fields.cause, 'unauthorized');
  await f.sessions.accept('new-secret', 'user'); await f.sessions.rejectIfMatches('new-secret', undefined, http); assert.equal(f.records.filter(row => row.event === 'auth.reauth_required').length, 2);
});
test('failing sinks never change session business results', async () => {
  const sessions = new SessionController(new PreferenceStore(new FixtureMemoryPreferences({})), {leave: async () => {}, enter: async () => {}}, undefined, {diagnostics: {record() {throw new Error('unwritable');}}});
  await sessions.accept('secret', 'user'); await sessions.rejectIfMatches('secret'); await sessions.signOut(false, 'unauthorized'); assert.equal(sessions.getSnapshot().status, 'unauthenticated');
});
test('account deletion retains normal result and records the cleanup cause', async () => {
  const f = setup(async () => new Response(JSON.stringify({code: 200, data: {canDelete: true}}))); await f.sessions.accept('secret', 'user');
  assert.deepEqual(await deleteCurrentAccount({api: f.api, sessions: f.sessions, signal: new AbortController().signal, isActive: () => true}), {canDelete: true});
  assert.deepEqual(f.records.map(row => row.event), ['account.delete', 'auth.signout']); assert.equal(f.records[1]!.fields.cause, 'account_deleted');
});
test('failed exchange observer gets login, refresh, envelope failure and 401 with safe headers and paths', async () => {
  let status = 400, code = 400;
  const f = setup(async () => new Response(JSON.stringify({code, message: 'sensitive message', data: 'sensitive body'}), {status, headers: {'CF-Ray': 'ray', 'Set-Cookie': 'secret'}}));
  await f.sessions.accept('abcdefgh', 'user');
  await assert.rejects(f.api.login({type: 'google', code: 'oauth-secret', platform: 'ios', redirect_uri: 'private'}));
  assert.equal(f.records[0]!.event, 'auth.login'); assert.equal(f.records[0]!.fields.provider, 'google');
  status = 503; await assert.rejects(f.api.refresh('abcdefgh')); assert.equal(f.records[1]!.event, 'auth.refresh_failed');
  status = 200; code = 403; await assert.rejects(f.api.request('/v1/user/login', 'POST', {type: 'apple'}));
  assert.equal(f.failed.at(-1)!.http.status, 200); assert.equal(f.failed.at(-1)!.http.code, 403);
  status = 401; code = 401; await assert.rejects(f.api.request('/v1/private?secret=value'));
  const reauth = f.records.find(row => row.event === 'auth.reauth_required'); assert.equal(reauth!.fields.http.path, '/v1/private');
  assert.equal(f.failed.at(-1)!.http.cfRay, 'ray'); assert.deepEqual(f.failed.at(-1)!.headers.request.Authorization, {present: true, len: 8, tail4: 'efgh'});
  assert.equal(JSON.stringify(f.records).includes('oauth-secret'), false); assert.equal(JSON.stringify(f.failed.map(({error, ...value}) => value)).includes('sensitive'), false);
});
test('observer exceptions do not change business errors, and network failures never reach the observer', async () => {
  const network = setup(async () => {throw new TypeError('Network request failed');});
  await assert.rejects(network.api.login({type: 'apple', code: '', platform: 'ios', redirect_uri: ''})); await assert.rejects(network.api.refresh('secret')); assert.deepEqual(network.failed, []); assert.deepEqual(network.records, []);
  const f = setup(async () => new Response(JSON.stringify({code: 400, message: 'original', data: 'value'}), {status: 400}));
  f.api.options.onFailedExchange = () => {throw new Error('observer');}; await assert.rejects(f.api.request('/v1/user/login'), error => error instanceof Error && error.message === 'original');
});
test('successful login and denied deletion keep complete safe outcomes', async () => {
  const f = setup(); await f.api.login({type: 'google', code: 'private', redirect_uri: 'private', platform: 'ios'});
  assert.equal(f.records[0]!.fields.ok, true); assert.equal(f.records[0]!.fields.http.code, 200); assert.ok(f.records[0]!.fields.durationMs >= 0);
  const denied = setup(async () => new Response(JSON.stringify({code: 200, data: {canDelete: false, reason: 'active_subscription'}})));
  await denied.api.deleteAccount(); assert.equal(denied.records[0]!.fields.canDelete, false); assert.equal(denied.records[0]!.fields.reason, 'active_subscription');
});
test('24 hours of fake-clock retryable PowerSync uploads emit zero diagnostic records', async context => {
  context.mock.timers.enable({apis: ['Date'], now: new Date('2026-10-28T00:00:00Z').getTime()});
  const f = setup(async () => new Response(JSON.stringify({code: 503, message: 'retry'}), {status: 503, headers: {'Retry-After': '60'}}));
  await f.sessions.accept('secret', 'user'); let completed = 0, attempts = 0;
  const transaction: PendingTransaction = {transactionId: 1, crud: [{table: 'sr_user_bookmark', id: '1', op: 'PATCH', opData: {is_starred: 1}}], complete: async () => {completed++;}};
  const queue = {async *getCrudTransactions() {yield transaction;}};
  for (let minute = 0; minute < 24 * 60; minute++) {await assert.rejects(uploadPendingTransactions(queue, changes => {attempts++; return f.api.uploadChanges(changes);}, async () => {})); context.mock.timers.tick(60000);}
  assert.equal(attempts, 1440); assert.equal(completed, 0); assert.deepEqual(f.records, []); assert.equal(new Date().toISOString(), '2026-10-29T00:00:00.000Z');
});
test('refresh failure records once per failure streak across 24 hours of CredentialReadiness backoff retries', async () => {
  let clock = new Date('2026-10-28T00:00:00Z').getTime(), status = 503, refreshes = 0, timer: {callback(): void; at: number} | undefined;
  const f = setup(async () => {refreshes++; return new Response(JSON.stringify(status === 200 ? {code: 200, data: {token: `token-${refreshes}`}} : {code: status, message: 'unavailable'}), {status});}, () => clock / 1000);
  const readiness = new CredentialReadiness({read: () => f.sessions.getSession(), refresh: signal => f.sessions.refreshIfNeeded(f.api.refresh, signal), changed() {}, now: () => clock,
    setTimer: (callback, delay) => {timer = {callback, at: clock + delay}; return 1 as unknown as ReturnType<typeof setTimeout>;}, clearTimer() {timer = undefined;}});
  const failures = () => f.records.filter(row => row.event === 'auth.refresh_failed').length;
  const step = async () => {const next = timer!; timer = undefined; clock = next.at; next.callback(); await readiness.ensure().catch(() => undefined);};
  const day = async () => {const end = clock + 24 * 60 * 60 * 1000; while (timer && timer.at <= end) await step();};
  await f.sessions.accept('secret', 'user'); clock += 86401 * 1000; await readiness.ensure().catch(() => undefined);
  await day(); assert.ok(refreshes > 250, `${refreshes} refresh attempts`); assert.equal(failures(), 1); assert.equal(readiness.getSnapshot().status, 'retry');
  assert.equal(f.records[0]!.fields.http.status, 503); assert.equal(f.records[0]!.fields.http.path, '/v1/user/refresh');
  status = 200; await step(); assert.equal(readiness.getSnapshot().status, 'ready'); assert.equal(failures(), 1);
  status = 503; await step(); await day(); assert.equal(failures(), 2);
  await f.sessions.signOut(false, 'other'); readiness.reset(); await f.sessions.accept('next-secret', 'user'); clock += 86401 * 1000; await readiness.ensure().catch(() => undefined); await day(); assert.equal(failures(), 3);
});
test('login use case records only sign-in failures without an HTTP exchange, never cancellation or stale attempts', async () => {
  const request = {type: 'apple' as const, code: 'oauth-secret', platform: 'ios', redirect_uri: 'private'};
  const network = setup(async () => {throw new TypeError('Network request failed');});
  await assert.rejects(loginWithProvider({provider: 'apple', api: network.api, diagnostics: network.sink, isCurrent: () => true, authenticate: async () => request}));
  assert.deepEqual(network.records.map(row => [row.event, row.fields.ok, row.fields.http]), [['auth.login', false, null]]); assert.equal(JSON.stringify(network.records).includes('oauth-secret'), false);
  const http = setup(async () => new Response(JSON.stringify({code: 400, message: 'denied'}), {status: 400}));
  await assert.rejects(loginWithProvider({provider: 'apple', api: http.api, diagnostics: http.sink, isCurrent: () => true, authenticate: async () => request}));
  assert.deepEqual(http.records.map(row => [row.event, row.fields.http.status]), [['auth.login', 400]]);
  const quiet = setup(async () => {throw new TypeError('Network request failed');});
  assert.equal(await loginWithProvider({provider: 'google', api: quiet.api, diagnostics: quiet.sink, isCurrent: () => true, authenticate: async () => null}), null);
  await assert.rejects(loginWithProvider({provider: 'google', api: quiet.api, diagnostics: quiet.sink, isCurrent: () => false, authenticate: async () => {throw new Error('stale');}}));
  assert.deepEqual(quiet.records, []);
  const ok = setup(); assert.equal((await loginWithProvider({provider: 'google', api: ok.api, diagnostics: ok.sink, isCurrent: () => true, authenticate: async () => ({...request, type: 'google'})}))?.token, 'new-token');
  assert.deepEqual(ok.records.map(row => [row.event, row.fields.ok]), [['auth.login', true]]);
});
test('recorded http fields are copied at record time', async () => {
  const f = setup(); await f.sessions.accept('secret', 'user'); const http = {method: 'GET', path: '/v1/private', status: 401, code: 401, cfRay: 'ray'};
  const pending = f.sessions.rejectIfMatches('secret', undefined, http); http.path = '/mutated'; await pending;
  assert.equal(f.records.find(row => row.event === 'auth.reauth_required')!.fields.http.path, '/v1/private');
  const exchanges = setup(async () => new Response(JSON.stringify({code: 400}), {status: 400})); let seen: DiagnosticExchange | undefined;
  exchanges.api.options.onFailedExchange = value => {seen = value; value.http.status = 0;};
  const error = await exchanges.api.request('/v1/user/login', 'POST', {type: 'google'}).catch(value => value);
  assert.ok(seen); assert.equal(exchanges.api.getFailedExchange(error)!.http.status, 400);
});
test('offline credential rejection records reauthentication without empty http fields', async () => {
  const f = setup(); await f.sessions.accept('secret', 'user'); await f.sessions.rejectIfMatches('secret', f.sessions.captureRequestScope());
  assert.deepEqual(f.records, [{event: 'auth.reauth_required', fields: {}}]);
});
