import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PaymentController, parsePurchaseMessage, type StorePort, type StorePurchase} from '../src/payments/controller.ts';
import {PreferenceStore, type PreferenceValues} from '../src/data/preferences.ts';
import {SessionController, type Session} from '../src/domain/session.ts';
import {createMobileApi} from '../src/data/api.ts';
import {MemoryPreferences} from './data/helpers.ts';

const order = '64fda2b8-72eb-4b3e-9236-7ff59b125022';
const product = 'slax.reader.monthly';
const purchased: StorePurchase = {productId: product, transactionId: 'fixture-transaction', appAccountToken: order, purchaseToken: 'synthetic-signed-transaction', purchaseState: 'purchased'};
function gate() {
  let started!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => {started = resolve;}), pending = new Promise<void>(resolve => {release = resolve;});
  return {started, release, waiting, pending};
}
class HeldPaymentPreferences extends MemoryPreferences {
  private held: {gate: ReturnType<typeof gate>; skip: number} | null = null;
  private swap: ReturnType<typeof gate> | null = null;
  holdRead(skip = 0) {const value = gate(); this.held = {gate: value, skip}; return value;}
  holdSwap() {const value = gate(); this.swap = value; return value;}
  override async read() {
    const held = this.held;
    if (held?.skip) held.skip--;
    else if (held) {this.held = null; held.gate.started(); await held.gate.pending;}
    return super.read();
  }
  override async compareAndSwap(revision: number, values: PreferenceValues) {
    const held = this.swap; this.swap = null;
    if (held) {held.started(); await held.pending;}
    return super.compareAndSwap(revision, values);
  }
}
async function scopedFixture(transport?: typeof globalThis.fetch) {
  const storage = new HeldPaymentPreferences({auth_token: 'same-token', user_id: 'account-a'}), preferences = new PreferenceStore(storage);
  const sessions = new SessionController(preferences, {leave: async () => {}, enter: async () => {}});
  await sessions.restore();
  const requests: {bearer?: string; body: unknown}[] = [], finished: string[] = [], commands: unknown[] = [];
  let emit!: (purchase: StorePurchase) => void, emitError!: (error: {code?: string; message: string}) => void;
  let restores: StorePurchase[] = [], active: StorePurchase[] = [];
  const port: StorePort = {
    async start(onPurchase, onError) {emit = onPurchase; emitError = onError;}, async products() {}, async purchase(command) {commands.push(command);},
    async finish(purchase) {finished.push(purchase.transactionId!);}, async restore() {return restores;}, async pending() {return [];}, async entitlements() {return active;}, async stop() {},
  };
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async (url, request) => {
    requests.push({bearer: (request?.headers as Record<string, string>).Authorization, body: JSON.parse(String(request?.body))});
    return transport ? await transport(url, request) : Response.json({code: 200, data: {ok: true}});
  }});
  const controller = new PaymentController(port, sessions, preferences, api.checkIapResult);
  await controller.start([product]);
  return {controller, storage, preferences, sessions, port, requests, finished, commands,
    emit: (purchase: StorePurchase) => emit(purchase), emitError: (error: {code?: string; message: string}) => emitError(error),
    setPurchases: (value: StorePurchase[]) => {restores = value;}, setActive: (value: StorePurchase[]) => {active = value;},
  };
}

test('product-list transport failure is visible without exposing the server error', async () => {
  const f = await scopedFixture(); await f.controller.stop();
  await f.controller.loadProducts(async () => {throw new Error('Synthetic private server response');});
  assert.deepEqual(f.controller.getSnapshot(), {status: 'error', message: 'Unable to load subscription products'});
  await f.controller.stop();
});

test('StoreKit initialization failure remains visible when the native connection was not started', async () => {
  const f = await scopedFixture(); await f.controller.stop();
  f.port.start = async () => {throw new Error('StoreKit is unavailable');};
  await f.controller.start([product]);
  assert.deepEqual(f.controller.getSnapshot(), {status: 'error', message: 'StoreKit is unavailable'});
  await f.controller.stop();
});

for (const failure of [false, true]) test(`delayed product-list ${failure ? 'failure' : 'success'} cannot affect the next account`, async () => {
  const f = await scopedFixture(), held = gate(), productCalls: string[][] = [];
  await f.controller.stop(); f.port.products = async ids => {productCalls.push(ids);};
  const loading = f.controller.loadProducts(async () => {
    held.started(); await held.pending;
    if (failure) throw new Error('Old account product-list response');
    return ['old-account-product'];
  });
  await held.waiting; await f.sessions.signOut(); await f.sessions.accept('b-token', 'account-b');
  await f.controller.start([product]); held.release(); await loading;
  assert.deepEqual(productCalls, [[product]]); assert.equal(f.controller.getSnapshot().status, 'idle');
  await f.controller.stop();
});

test('held native-order lookup cannot verify an A receipt with B credentials or publish a B error', async () => {
  const f = await scopedFixture(); await f.controller.purchase({productId: product, orderId: order}); f.setPurchases([purchased]);
  const held = f.storage.holdRead(1), restoring = f.controller.restore(); await held.waiting;
  await f.sessions.signOut(); await f.sessions.accept('b-token', 'account-b'); await f.controller.start([product]);
  const states: string[] = []; f.controller.subscribe(() => {states.push(f.controller.getSnapshot().status);});
  held.release(); await restoring;
  assert.deepEqual(f.requests, []); assert.deepEqual(f.finished, []); assert.deepEqual(states, []);
  assert.match(String((await f.preferences.read())[`iap_order:${order}`]), /account-a/); await f.controller.stop();
});

test('fresh same-user login with identical JWT revokes in-flight backend verification', async () => {
  const held = gate(), f = await scopedFixture(async () => {held.started(); await held.pending; return Response.json({code: 200, data: {ok: true}});});
  await f.controller.purchase({productId: product, orderId: order}); f.setPurchases([purchased]);
  const restoring = f.controller.restore(); await held.waiting;
  await f.sessions.signOut(); await f.sessions.accept('same-token', 'account-a'); await f.controller.start([product]);
  held.release(); await restoring;
  assert.equal(f.requests[0]?.bearer, 'Bearer same-token'); assert.deepEqual(f.finished, []);
  assert.ok((await f.preferences.read())[`iap_order:${order}`]); assert.equal(f.controller.getSnapshot().status, 'idle'); await f.controller.stop();
});

test('native purchase events queued under A cannot execute later under B', async () => {
  const f = await scopedFixture(); await f.controller.purchase({productId: product, orderId: order});
  const held = f.storage.holdRead(1); f.emit(purchased); await held.waiting;
  f.emit({...purchased, transactionId: 'second-a-transaction'});
  await f.sessions.signOut(); await f.sessions.accept('b-token', 'account-b'); await f.controller.start([product]);
  held.release(); await f.controller.restore();
  assert.deepEqual(f.requests, []); assert.deepEqual(f.finished, []); assert.ok((await f.preferences.read())[`iap_order:${order}`]); await f.controller.stop();
});

test('known A order arriving after B login stays recoverable without backend verification', async () => {
  const f = await scopedFixture(); await f.controller.purchase({productId: product, orderId: order});
  await f.sessions.signOut(); await f.sessions.accept('b-token', 'account-b'); await f.controller.start([product]);
  f.emit(purchased); await f.controller.restore();
  assert.deepEqual(f.requests, []); assert.deepEqual(f.finished, []); assert.ok((await f.preferences.read())[`iap_order:${order}`]); await f.controller.stop();
});

test('purchase preference setup and old native errors cannot cross a fresh login', async () => {
  const f = await scopedFixture(), held = f.storage.holdRead(1);
  const purchasing = f.controller.purchase({productId: product, orderId: order}); await held.waiting;
  await f.sessions.signOut(); await f.sessions.accept('same-token', 'account-a'); await f.controller.start([product]);
  held.release(); await purchasing;
  assert.deepEqual(f.commands, []); assert.equal((await f.preferences.read())[`iap_order:${order}`], undefined);
  f.emitError({code: 'user-cancelled', message: 'Old purchase result'}); assert.equal(f.controller.getSnapshot().status, 'idle'); await f.controller.stop();
});

test('a stale native purchase request retains its persisted owner and suppresses its late StoreKit error', async () => {
  const f = await scopedFixture(), held = gate();
  f.port.purchase = async () => {held.started(); await held.pending; const error = {code: 'user-cancelled', message: 'Old native sheet result'}; f.emitError(error); throw error;};
  const purchasing = f.controller.purchase({productId: product, orderId: order}); await held.waiting;
  await f.sessions.signOut(); await f.sessions.accept('same-token', 'account-a'); await f.controller.start([product]);
  held.release(); await purchasing;
  assert.equal(f.controller.getSnapshot().status, 'idle'); assert.ok((await f.preferences.read())[`iap_order:${order}`]); assert.deepEqual(f.finished, []); await f.controller.stop();
});

test('expired purchase ownership CAS cannot overwrite the next account order binding', async () => {
  const f = await scopedFixture(), held = f.storage.holdSwap();
  const purchasing = f.controller.purchase({productId: product, orderId: order}); await held.waiting;
  await f.sessions.signOut(); await f.sessions.accept('b-token', 'account-b');
  await f.preferences.update(values => {values[`iap_order:${order}`] = JSON.stringify({userId: 'account-b', productId: product});});
  await f.controller.start([product]); held.release(); await purchasing;
  assert.deepEqual(f.commands, []); assert.match(String((await f.preferences.read())[`iap_order:${order}`]), /account-b/); await f.controller.stop();
});

test('expired completed-order CAS cannot erase a new account binding or publish old success', async () => {
  const f = await scopedFixture(); await f.controller.purchase({productId: product, orderId: order});
  // Finish legitimately starts while A is active; the following local deletion remains cancellable.
  const held = f.storage.holdSwap(); f.setPurchases([purchased]);
  const restoring = f.controller.restore(); await held.waiting;
  assert.deepEqual(f.finished, ['fixture-transaction']);
  await f.sessions.signOut(); await f.sessions.accept('b-token', 'account-b');
  await f.preferences.update(values => {values[`iap_order:${order}`] = JSON.stringify({userId: 'account-b', productId: product});});
  await f.controller.start([product]); held.release(); await restoring;
  assert.match(String((await f.preferences.read())[`iap_order:${order}`]), /account-b/); assert.equal(f.controller.getSnapshot().status, 'idle'); await f.controller.stop();
});

test('restore captures its account before a delayed native result', async () => {
  const f = await scopedFixture(); await f.controller.purchase({productId: product, orderId: order});
  const held = gate(); f.port.restore = async () => {held.started(); await held.pending; return [purchased];};
  const restoring = f.controller.restore(); await held.waiting;
  await f.sessions.signOut(); await f.sessions.accept('same-token', 'account-a'); await f.controller.start([product]);
  held.release(); await restoring;
  assert.deepEqual(f.requests, []); assert.deepEqual(f.finished, []); assert.ok((await f.preferences.read())[`iap_order:${order}`]); await f.controller.stop();
});

test('queued old start and entitlement results cannot populate the next account', async () => {
  const f = await scopedFixture(), stopped = gate(), productCalls: string[][] = [];
  f.port.stop = async () => {stopped.started(); await stopped.pending;}; f.port.products = async ids => {productCalls.push(ids);};
  const stopping = f.controller.stop(); await stopped.waiting;
  const oldStart = f.controller.start(['old-account-product']);
  await f.sessions.signOut(); await f.sessions.accept('b-token', 'account-b');
  const newStart = f.controller.start([product]); stopped.release(); await stopping; await oldStart; await newStart;
  assert.deepEqual(productCalls, [[product]]);
  const entitlement = gate(); const original = f.port.entitlements;
  f.port.entitlements = async () => {f.port.entitlements = original; entitlement.started(); await entitlement.pending; return [purchased];};
  const staleEntitlement = assert.rejects(f.controller.refreshEntitlements()); await entitlement.waiting;
  await f.sessions.signOut(); await f.sessions.accept('same-token', 'account-a'); await f.controller.start([product]);
  entitlement.release(); await staleEntitlement; assert.deepEqual(f.controller.getPurchasedIds(), []); await f.controller.stop();
});
function fixture(verify: () => Promise<{ok: boolean}> = async () => ({ok: true})) {
  let values: PreferenceValues = {}; let revision = 0;
  let beforeCommit: () => Promise<void> = async () => {};
  const preferences = new PreferenceStore({async read() { return {revision, values: {...values}}; }, async compareAndSwap(expected, next) { await beforeCommit(); if (revision !== expected) return false; values = next; revision++; return true; }});
  let session: Session|null = {userId: 'fixture-account-a', token: 'synthetic-session', refreshedAt: 0};
  let transactions: StorePurchase[] = []; let active: StorePurchase[] = [];
  const finished: string[] = []; const commands: unknown[] = [];
  let onPurchase: ((purchase: StorePurchase) => void)|undefined;
  let onStoreError: ((error: {code?: string; message: string}) => void)|undefined;
  const port: StorePort = {
    async start(callback, error) { onPurchase = callback; onStoreError = error; }, async products() {}, async purchase(command) { commands.push(command); },
    async finish(purchase) { finished.push(purchase.transactionId!); }, async restore() { return transactions; }, async pending() { return []; }, async entitlements() { return active; }, async stop() {},
  };
  const sessions = {async getSession() { return session; }, async clearIfMatches() { return false; }};
  const controller = new PaymentController(port, sessions, preferences, verify);
  return {controller, preferences, finished, commands, port, sessions, beforeCommit: (hook: () => Promise<void>) => { beforeCommit = hook; }, setSession: (next: Session|null) => { session = next; }, setPurchases: (next: StorePurchase[]) => { transactions = next; }, setActive: (next: StorePurchase[]) => { active = next; }, emit: (purchase: StorePurchase) => onPurchase!(purchase), emitError: (error: {code?: string; message: string}) => onStoreError!(error)};
}

test('StoreKit promise cancellation and deferral preserve listener states', async t => {
  for (const [code, status] of [['user-cancelled', 'cancelled'], ['deferred-payment', 'pending']] as const) {
    for (const listenerFirst of [false, true]) await t.test(`${code}; listenerFirst=${listenerFirst}`, async () => {
      const f = fixture(); await f.controller.start([product]);
      const errors: string[] = [];
      f.controller.subscribe(() => {const state = f.controller.getSnapshot(); if (state.status !== 'purchasing') errors.push(state.status);});
      f.port.purchase = async () => {const error = {code, message: 'Synthetic store result'}; if (listenerFirst) f.emitError(error); throw error;};
      await f.controller.purchase({productId: product, orderId: order});
      assert.equal(f.controller.getSnapshot().status, status);
      assert.deepEqual(errors, [status]);
      assert.ok((await f.preferences.read())[`iap_order:${order}`]);
      await f.controller.stop();
    });
  }
});

test('purchase is reserved before asynchronous session and preference setup', async t => {
  for (const phase of ['session', 'preferences']) await t.test(phase, async () => {
    const f = fixture(); await f.controller.start([product]);
    let unblock!: () => void;
    const gate = new Promise<void>(resolve => {unblock = resolve;});
    if (phase === 'session') { const read = f.sessions.getSession; f.sessions.getSession = async () => {await gate; return read();}; }
    else f.beforeCommit(() => gate);
    const first = f.controller.purchase({productId: product, orderId: order});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.controller.getSnapshot().status, 'purchasing');
    await f.controller.purchase({productId: product, orderId: '73fda2b8-72eb-4b3e-9236-7ff59b125022'});
    assert.deepEqual(f.commands, []);
    unblock(); await first;
    assert.equal(f.commands.length, 1);
    assert.equal((await f.preferences.read())['iap_order:73fda2b8-72eb-4b3e-9236-7ff59b125022'], undefined);
    await f.controller.stop();
  });
});

test('failed purchase setup releases reservation, and stopped setup cannot call StoreKit', async () => {
  const f = fixture(); await f.controller.start([product]);
  f.setSession(null); await f.controller.purchase({productId: product, orderId: order});
  assert.equal(f.controller.getSnapshot().status, 'error');
  f.setSession({userId: 'fixture-account-a', token: 'synthetic-session', refreshedAt: 0});
  let unblock!: () => void;
  const gate = new Promise<void>(resolve => {unblock = resolve;});
  const read = f.sessions.getSession; f.sessions.getSession = async () => {await gate; return read();};
  const pending = f.controller.purchase({productId: product, orderId: order});
  await f.controller.stop(); unblock(); await pending;
  assert.deepEqual(f.commands, []);
  assert.equal(f.controller.getSnapshot().status, 'idle');
});

test('purchase bridge validates UUID and signed promotional fields', () => {
  assert.equal(parsePurchaseMessage('not-json'), null);
  assert.equal(parsePurchaseMessage('{"type":"unrelated"}'), null);
  assert.throws(() => parsePurchaseMessage(JSON.stringify({type: 'purchase', productId: product, orderId: 'not-a-uuid'})));
  const offer = {offerId: 'retention', keyID: 'public-key-id', nonce: order, signature: 'synthetic-offer-signature', timestamp: 1780000000};
  assert.deepEqual(parsePurchaseMessage(JSON.stringify({type: 'purchaseWithOffer', productId: product, orderId: order, ...offer})), {productId: product, orderId: order, offer});
  assert.throws(() => parsePurchaseMessage(JSON.stringify({type: 'purchaseWithOffer', productId: product, orderId: order, ...offer, timestamp: -1})));
});

test('validated transaction finishes once, retains account binding until success', async () => {
  const f = fixture(); await f.controller.start([product]);
  await f.controller.purchase({productId: product, orderId: order});
  assert.match(String((await f.preferences.read())[`iap_order:${order}`]), /fixture-account-a/);
  f.setPurchases([purchased, purchased]); await f.controller.restore();
  assert.deepEqual(f.finished, ['fixture-transaction']);
  assert.equal((await f.preferences.read())[`iap_order:${order}`], undefined);
  assert.equal(f.controller.getSnapshot().status, 'success'); await f.controller.stop();
});

test('backend rejection leaves transaction unfinished and purchase binding recoverable', async () => {
  const f = fixture(async () => ({ok: false})); await f.controller.start([product]);
  await f.controller.purchase({productId: product, orderId: order}); f.setPurchases([purchased]); await f.controller.restore();
  assert.deepEqual(f.finished, []); assert.ok((await f.preferences.read())[`iap_order:${order}`]);
  assert.equal(f.controller.getSnapshot().status, 'error'); await f.controller.stop();
});

test('different account and corrupt ownership cannot finish or erase pending purchase', async () => {
  let verifications = 0; const f = fixture(async () => { verifications++; return {ok: true}; }); await f.controller.start([product]);
  await f.controller.purchase({productId: product, orderId: order});
  f.setSession({userId: 'fixture-account-b', token: 'synthetic-second-session', refreshedAt: 0}); f.setPurchases([purchased]); await f.controller.restore();
  assert.equal(verifications, 0); assert.deepEqual(f.finished, []);
  await f.preferences.update(values => { values[`iap_order:${order}`] = '{invalid'; }); await f.controller.restore();
  assert.equal(f.controller.getSnapshot().status, 'error'); assert.equal(verifications, 0); await f.controller.stop();
});

test('account change during backend verification leaves StoreKit transaction recoverable', async () => {
  let resolveVerification!: (result: {ok: boolean}) => void;
  const f = fixture(() => new Promise(resolve => { resolveVerification = resolve; })); await f.controller.start([product]);
  await f.controller.purchase({productId: product, orderId: order}); f.setPurchases([purchased]);
  const restore = f.controller.restore(); await new Promise(resolve => setImmediate(resolve));
  f.setSession({userId: 'fixture-account-b', token: 'synthetic-second-session', refreshedAt: 0}); resolveVerification({ok: true}); await restore;
  assert.deepEqual(f.finished, []); assert.ok((await f.preferences.read())[`iap_order:${order}`]); await f.controller.stop();
});

test('stopping a controller invalidates in-flight verification before finish', async () => {
  let resolveVerification!: (result: {ok: boolean}) => void;
  const f = fixture(() => new Promise(resolve => { resolveVerification = resolve; })); await f.controller.start([product]);
  await f.controller.purchase({productId: product, orderId: order}); f.emit(purchased); await new Promise(resolve => setImmediate(resolve));
  const stop = f.controller.stop(); resolveVerification({ok: true}); await stop;
  assert.deepEqual(f.finished, []); assert.ok((await f.preferences.read())[`iap_order:${order}`]);
});

test('pending and revoked transactions never validate as successful purchases', async () => {
  let count = 0; const f = fixture(async () => { count++; return {ok: true}; }); f.setActive([purchased]); await f.controller.start([product]);
  assert.equal(f.controller.isPurchased(product), true);
  f.setPurchases([{...purchased, purchaseState: 'pending'}]); await f.controller.restore(); assert.equal(f.controller.getSnapshot().status, 'pending');
  f.setActive([]); f.setPurchases([{...purchased, revocationDateIOS: 1780000000}]); await f.controller.restore();
  assert.equal(f.controller.isPurchased(product), false); assert.equal(count, 0); assert.deepEqual(f.finished, []); await f.controller.stop();
});
