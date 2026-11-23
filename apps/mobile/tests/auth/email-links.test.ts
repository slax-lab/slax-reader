import test from 'node:test';
import assert from 'node:assert/strict';
import {EmailLinkLoginController, emailLinkWebOrigin} from '../../src/auth/email-link-login.ts';

const proof = {email: 'reader@example.com', request_id: '550e8400-e29b-41d4-a716-446655440000', token: 'a'.repeat(43)};
const link = (origin = 'https://r.slax.dev') => `${origin}/email-login#${new URLSearchParams(proof)}`;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(initial: string|null = null, status = 'unauthenticated', launch = {handled: false}) {
  const sessionState = (status: string) => status === 'authenticated' ? {status, session: {userId: 'owner', token: 'fixture'}} : {status};
  let state: any = sessionState(status), version = 0, onURL = (_url: string) => {}, onSession = () => {};
  const submissions: unknown[] = [], accepted: unknown[] = [], opened: string[] = [];
  let complete = async () => ({token: 'session', user_id: 'owner'});
  const sessions: any = {getSnapshot: () => state, subscribe(fn: () => void) {onSession = fn; return () => {onSession = () => {};};},
    captureIdentity() {const before = version; return () => {if (before !== version) throw new Error('replaced');};},
    async accept(token: string, userId: string, started: (guard: () => void) => void, signal: AbortSignal) {
      if (signal.aborted) throw new Error('aborted'); started(() => {}); accepted.push([token, userId]); state = {status: 'authenticated'}; onSession();
    }};
  const source = {initialURL: async () => initial, subscribe(fn: (url: string) => void) {onURL = fn; return () => {onURL = () => {};};}, openURL: async (url: string) => {opened.push(url);}};
  const api: any = {verifyLoginEmailLink: async (body: unknown, signal: AbortSignal) => {submissions.push([body, signal]); return complete();}};
  const controller = new EmailLinkLoginController({source, api, sessions, webOrigin: 'https://r.slax.dev'});
  controller.start(launch);
  return {controller, submissions, accepted, opened, emit: (url: string) => onURL(url),
    replace(next: string) {version++; state = sessionState(next); onSession();}, defer(fn: typeof complete) {complete = fn;}};
}

test('cold and warm links require agreement, then use the existing session owner', async () => {
  for (const cold of [true, false]) {
    const f = fixture(cold ? link() : null); await tick(); if (!cold) f.emit(link());
    assert.equal(f.controller.getSnapshot().status, 'agreement'); assert.equal(f.submissions.length, 0);
    await f.controller.confirm();
    assert.deepEqual(f.accepted, [['session', 'owner']]); assert.deepEqual((f.submissions[0] as any)[0], proof);
    f.controller.dispose();
  }
});
test('signed-in account takes priority and no proof is consumed', async () => {
  const f = fixture(link(), 'authenticated'); await tick();
  assert.equal(f.controller.getSnapshot().status, 'active'); await f.controller.confirm(); assert.equal(f.submissions.length, 0); f.controller.dispose();
});
test('initial link waits for local session readiness and decline discards it', async () => {
  const f = fixture(link(), 'loading'); await tick(); assert.equal(f.submissions.length, 0);
  f.replace('unauthenticated'); assert.equal(f.controller.getSnapshot().status, 'agreement');
  f.controller.dismiss(); await f.controller.confirm(); assert.equal(f.submissions.length, 0); f.controller.dispose();
});
test('another known environment can continue in browser without changing API or reopening App', async () => {
  const f = fixture(link('https://r-beta.slax.com')); await tick();
  assert.equal(f.controller.getSnapshot().status, 'environment'); await f.controller.continueOnWeb();
  const url = new URL(f.opened[0]); assert.equal(url.pathname, '/email-login-web'); assert.equal(url.origin, 'https://r-beta.slax.com'); assert.equal(url.hash, new URL(link()).hash);
  assert.equal(f.submissions.length, 0); f.controller.dispose();
});
test('unknown origin is rejected without API or browser dispatch', async () => {
  const f = fixture(link('https://attacker.test')); await tick(); await f.controller.continueOnWeb();
  assert.equal(f.submissions.length, 0); assert.equal(f.opened.length, 0); f.controller.dispose();
});
test('duplicate active delivery cannot start two requests and late completion cannot switch accounts', async () => {
  const f = fixture(link()); await tick(); let finish!: (result: any) => void;
  f.defer(() => new Promise(resolve => {finish = resolve;})); const pending = f.controller.confirm();
  f.emit(link()); await f.controller.confirm(); assert.equal(f.submissions.length, 1);
  f.replace('authenticated'); finish({token: 'late', user_id: 'late'}); await pending;
  assert.equal(f.accepted.length, 0); assert.equal((f.submissions[0] as any)[1].aborted, true); f.controller.dispose();
});
test('disposing a pending attempt cancels it without persisting late success', async () => {
  const f = fixture(link()); await tick(); let finish!: (result: any) => void;
  f.defer(() => new Promise(resolve => {finish = resolve;})); const pending = f.controller.confirm();
  f.controller.dispose(); finish({token: 'late', user_id: 'late'}); await pending; assert.equal(f.accepted.length, 0);
});
test('active API selects its own Web origin, including Beta with production Web config', () => {
  const config = {apiUrl: 'https://api-reader.slax.com', betaApiUrl: 'https://api-reader-beta.slax.com', webUrl: 'https://r.slax.com'};
  assert.equal(emailLinkWebOrigin(config, config.apiUrl), config.webUrl);
  assert.equal(emailLinkWebOrigin(config, config.betaApiUrl), 'https://r-beta.slax.com');
  assert.equal(emailLinkWebOrigin({...config, apiUrl: config.betaApiUrl, webUrl: 'https://r.slax.dev'}, config.betaApiUrl), 'https://r.slax.dev');
});

test('an authenticated-session refusal never revives its proof after sign-out', async () => {
  const f = fixture(link(), 'authenticated'); await tick();
  assert.equal(f.controller.getSnapshot().status, 'active');
  f.replace('unauthenticated'); assert.equal(f.controller.getSnapshot().status, 'idle');
  await f.controller.confirm(); assert.equal(f.submissions.length, 0); f.controller.dispose();
});
test('an abandoned cold URL is consumed once across origin/controller replacement', async () => {
  const launch = {handled: false};
  const first = fixture(link('https://r-beta.slax.com'), 'unauthenticated', launch); await tick();
  first.controller.dismiss(); first.controller.dispose();
  const second = fixture(link(), 'unauthenticated', launch); await tick();
  assert.equal(second.controller.getSnapshot().status, 'idle'); assert.equal(second.submissions.length, 0);
  second.emit(link()); assert.equal(second.controller.getSnapshot().status, 'agreement'); second.controller.dispose();
});
test('a cold link waits for restored authenticated session and then shows sign-out guidance', async () => {
  const f = fixture(link(), 'loading'); await tick();
  f.replace('authenticated'); assert.equal(f.controller.getSnapshot().status, 'active');
  assert.equal(f.submissions.length, 0); f.replace('unauthenticated');
  assert.equal(f.controller.getSnapshot().status, 'idle'); f.controller.dispose();
});

test('same-account token refresh keeps the current-session notice visible', async () => {
  const f = fixture(link(), 'authenticated'); await tick();
  assert.equal(f.controller.getSnapshot().status, 'active');
  f.replace('authenticated'); assert.equal(f.controller.getSnapshot().status, 'active');
  assert.equal(f.submissions.length, 0); f.controller.dispose();
});
test('real SessionController hydration preserves agreement and a pending link submission', async () => {
  const {SessionController} = await import('../../src/domain/session.ts');
  const {PreferenceStore} = await import('../../src/data/preferences.ts');
  const {FixtureMemoryPreferences} = await import('../../fixtures/isolation.ts');
  const sessions = new SessionController(new PreferenceStore(new FixtureMemoryPreferences({})), {leave: async () => {}, enter: async () => {}});
  let complete!: (value: {token: string; user_id: string}) => void;
  let signal: AbortSignal | undefined;
  const controller = new EmailLinkLoginController({sessions, webOrigin: 'https://r.slax.dev',
    source: {initialURL: async () => link(), subscribe: () => () => {}, openURL: async () => {}},
    api: {verifyLoginEmailLink: async (_proof: unknown, current?: AbortSignal) => {signal = current; return new Promise(resolve => {complete = resolve;});}} as any});
  controller.start(); await tick(); await sessions.restoreLocal();
  assert.equal(controller.getSnapshot().status, 'agreement');
  await sessions.restore(); assert.equal(controller.getSnapshot().status, 'agreement');
  const pending = controller.confirm();
  await sessions.restore(); assert.equal(signal?.aborted, false); assert.equal(controller.getSnapshot().status, 'loading');
  complete({token: 'fixture-session', user_id: 'reader'}); await pending;
  assert.equal(sessions.getSnapshot().status, 'authenticated'); controller.dispose();
});
