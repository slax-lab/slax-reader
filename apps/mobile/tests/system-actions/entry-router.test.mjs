import test from 'node:test';
import assert from 'node:assert/strict';
import {SystemEntryRouter} from '../../src/system-actions/entry-router.ts';
import {systemBookmarkId} from '../../src/system-actions/catalog-policy.ts';

const owner = {userId: 'u', origin: 'https://api.test', generation: 'g1'};
const opaqueId = systemBookmarkId(JSON.stringify(['u', 'https://api.test']), 'real-bookmark');
const invocation = {id: 'open-1', name: 'openBookmark', params: {bookmarkId: opaqueId}, createdAt: 1};
function setup(initialReceipts = []) {
  let currentOwner = owner, ready = false, receipts = initialReceipts;
  const events = [], calls = {lookups: 0};
  const router = new SystemEntryRouter({async read() {return structuredClone(receipts);}, async write(value) {receipts = structuredClone(value); events.push('receipt');},
    currentOwner: () => currentOwner, ready: () => ready,
    async getBookmark(id) {calls.lookups++; events.push(`lookup:${id}`); return {id: 'real-bookmark', title: 'title', aliasTitle: '', url: 'https://example.com', status: 'success', archiveStatus: 0, createdAt: 'now'};},
    navigate(id) {events.push(`navigate:${id}`);}, async removeInvocation() {events.push('ack');}, async donate(id, invocationId) {events.push(`donate:${id}:${invocationId}`);}});
  return {router, events, calls, get receipts() {return receipts;}, ready(value) {ready = value;}, owner(value) {currentOwner = value;}};
}

test('cold Spotlight entry waits for current account admission and navigation readiness', async () => {
  const f = setup(); await f.router.receive([invocation]);
  assert.equal(f.calls.lookups, 0); assert.deepEqual(f.events, []);
  f.ready(true); await f.router.contextChanged();
  assert.deepEqual(f.events.slice(0, 4), [`lookup:${opaqueId}`, 'navigate:real-bookmark', `donate:${opaqueId}:open-1`, 'receipt']);
  assert.equal(f.receipts[0].status, 'complete'); assert.equal(f.events.at(-1), 'receipt');
});

test('pending entry survives repeated readiness context changes before navigation is ready', async () => {
  const f = setup(); await f.router.receive([invocation]);
  assert.equal(f.calls.lookups, 0);
  await f.router.contextChanged();
  await f.router.contextChanged();
  assert.equal(f.calls.lookups, 0);
  f.ready(true); await f.router.contextChanged();
  assert.deepEqual(f.events.slice(0, 4), [`lookup:${opaqueId}`, 'navigate:real-bookmark', `donate:${opaqueId}:open-1`, 'receipt']);
  assert.equal(f.receipts[0].status, 'complete');
});

test('unavailable bookmark stays unacknowledged until explicit discard', async () => {
  const f = setup(); f.ready(true);
  // Replace the normal lookup with a current-account miss.
  f.router['ports'].getBookmark = async () => null;
  await f.router.receive([invocation]);
  assert.equal(f.receipts[0].status, 'unavailable'); assert.equal(f.events.includes('ack'), false);
  await f.router.discardUnavailable('open-1');
  assert.equal(f.receipts[0].status, 'discarded'); assert.equal(f.events.at(-1), 'receipt');
});

test('private or processing current-account entries never navigate', async () => {
  const f = setup(); f.ready(true);
  f.router['ports'].getBookmark = async () => ({id: 'real-bookmark', title: 'title', aliasTitle: '', url: 'https://example.com', status: 'processing', archiveStatus: 0, createdAt: 'now'});
  await f.router.receive([invocation]);
  assert.equal(f.events.some(value => value.startsWith('navigate:')), false);
  assert.equal(f.receipts[0].status, 'unavailable');
});

test('owner replacement during lookup fences navigation and completion', async () => {
  const f = setup(); f.ready(true);
  let resolve;
  f.router['ports'].getBookmark = () => new Promise(done => {resolve = done;});
  const work = f.router.receive([invocation]); await new Promise(resolveTick => setImmediate(resolveTick));
  f.owner({...owner, userId: 'other', generation: 'g2'}); resolve({id: 'opaque-id', title: 'title', aliasTitle: '', url: 'https://example.com', status: 'success', archiveStatus: 0, createdAt: 'now'});
  await work; assert.equal(f.events.some(value => value.startsWith('navigate:')), false); assert.equal(f.receipts.length, 0);
});

test('owner-scoped system identifiers cannot resolve against a replacement account', async () => {
  const f = setup(); f.owner({...owner, userId: 'other', generation: 'g2'}); f.ready(true);
  f.router['ports'].getBookmark = async () => null;
  await f.router.receive([invocation]);
  assert.equal(f.events.some(value => value.startsWith('navigate:')), false);
  assert.equal(f.receipts[0].status, 'unavailable');
});

test('unacknowledged receipt capacity retains native invocation rather than evicting tombstones', async () => {
  const existing = Array.from({length: 200}, (_, index) => ({id: `receipt-${index}`, bookmarkId: 'id', status: 'unavailable'}));
  const f = setup(existing); f.ready(true);
  await f.router.receive([invocation]);
  assert.equal(f.receipts.length, 200);
  assert.equal(f.events.includes('ack'), false);
  assert.equal(f.calls.lookups, 0);
});
