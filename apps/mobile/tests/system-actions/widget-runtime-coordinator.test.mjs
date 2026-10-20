import test from 'node:test';
import assert from 'node:assert/strict';
import {WidgetRuntimeCoordinator} from '../../src/widgets/runtime-coordinator.ts';

const ownerA = {userId: 'a', origin: 'https://api.test', generation: 'runtime-a'};
const ownerB = {userId: 'b', origin: 'https://api.test', generation: 'runtime-b'};
function setup(writeRead = async () => {}) {
  const calls = [], maps = [];
  let version = 0, stored;
  const boundary = {
    async nextVersion() {return ++version;},
    async publish(snapshot) {if (stored && snapshot.version <= stored.version) return false; stored = snapshot; calls.push(['publish', snapshot]); return true;},
    async revoke(snapshot) {if (!stored || snapshot.version > stored.version) stored = snapshot; calls.push(['revoke', snapshot]);},
    async reload() {calls.push(['reload']);},
    supported() {return true;},
    async start(payload) {calls.push(['start', payload]); return 'activity-1';},
    async update(id, payload) {calls.push(['update', id, payload]);},
    async end(id, payload) {calls.push(['end', id, payload]);},
  };
  const coordinator = new WidgetRuntimeCoordinator(boundary, async value => {maps.push(value);}, writeRead);
  let listener;
  const repositories = {watchWidgetSnapshot(callback) {listener = callback; return () => {listener = undefined;};}};
  return {coordinator, calls, maps, boundary, repositories, emit(source) {listener?.(source);}};
}

test('admitted bounded snapshot is owner-scoped, title redacted by opt-in, and refresh errors retry visibly', async () => {
  const f = setup(); f.coordinator.activate();
  f.coordinator.configure(ownerA, f.repositories, {titlesEnabled: true, countEnabled: false});
  f.emit({unreadCount: 7, suggestions: [{id: 'bookmark-1', title: 'Secret title', savedAt: 2, unread: true, archived: false, deleted: false}]});
  await new Promise(resolve => setTimeout(resolve, 0));
  const published = f.calls.find(call => call[0] === 'publish')[1];
  assert.equal(published.owner.userId, 'a'); assert.equal(published.unreadCount, null);
  assert.equal(published.suggestions[0].id.startsWith('b-'), true);
  assert.equal(published.suggestions[0].title, 'Secret title');
  assert.equal(f.maps.at(-1).owner, JSON.stringify(['a', 'https://api.test']));
});

test('title opt-out clears route map before count-only snapshot and owner changes revoke old state', async () => {
  const f = setup(); f.coordinator.activate();
  f.coordinator.configure(ownerA, f.repositories, {titlesEnabled: true, countEnabled: true});
  f.emit({unreadCount: 2, suggestions: [{id: 'one', title: 'Title', savedAt: 1, unread: true, archived: false, deleted: false}]});
  await new Promise(resolve => setTimeout(resolve, 0));
  f.coordinator.configure(ownerA, f.repositories, {titlesEnabled: false, countEnabled: true});
  f.emit({unreadCount: 2, suggestions: []}); await new Promise(resolve => setTimeout(resolve, 0));
  const countOnly = f.calls.filter(call => call[0] === 'publish').at(-1)[1];
  assert.equal(countOnly.unreadCount, 2); assert.deepEqual(countOnly.suggestions, []); assert.deepEqual(f.maps.at(-1).ids, {});
  f.coordinator.configure(ownerB, f.repositories, {titlesEnabled: false, countEnabled: true}); await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(f.calls.some(call => call[0] === 'revoke' && call[1].owner.userId === 'b'));
});

test('reading activity counts distinct successful read marks and ends on goal or owner change', async () => {
  const f = setup(); f.coordinator.activate(); f.coordinator.configure(ownerA, f.repositories, {titlesEnabled: false, countEnabled: false});
  assert.equal(await f.coordinator.startReadingSession(2), true);
  await f.coordinator.markRead('bookmark-a'); await f.coordinator.markRead('bookmark-a');
  await f.coordinator.markRead('bookmark-b'); await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.some(call => call[0] === 'end' && call[2].readCount === 2));
  await f.coordinator.startReadingSession(5); f.coordinator.configure(ownerB, f.repositories, {titlesEnabled: false, countEnabled: false}); await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.some(call => call[0] === 'end'));
  f.coordinator.dispose();
});

test('a Live Activity start resolving after owner replacement cannot activate the replacement session', async () => {
  const f = setup(); f.coordinator.activate();
  f.coordinator.configure(ownerA, f.repositories, {titlesEnabled: false, countEnabled: false});
  let resolveStart;
  f.calls.length = 0;
  f.coordinator['boundary'].start = payload => new Promise(resolve => {resolveStart = () => {f.calls.push(['start', payload]); resolve('late-activity');};});
  const starting = f.coordinator.startReadingSession(3);
  await new Promise(resolve => setImmediate(resolve));
  f.coordinator.configure(ownerB, f.repositories, {titlesEnabled: false, countEnabled: false});
  resolveStart();
  assert.equal(await starting, false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.coordinator.getSnapshot().activityActive, false);
  assert.ok(f.calls.some(call => call[0] === 'end' && call[1] === 'late-activity'));
});

test('StrictMode cleanup can clear retained routes and safely reactivate the same coordinator', async () => {
  const f = setup(); f.coordinator.activate();
  f.coordinator.configure(ownerA, f.repositories, {titlesEnabled: true, countEnabled: false});
  f.emit({unreadCount: 1, suggestions: [{id: 'one', title: 'Title', savedAt: 1, unread: true, archived: false, deleted: false}]});
  await new Promise(resolve => setImmediate(resolve));
  f.coordinator.dispose();
  f.coordinator.activate();
  f.coordinator.configure(ownerA, f.repositories, {titlesEnabled: true, countEnabled: false});
  f.emit({unreadCount: 1, suggestions: [{id: 'two', title: 'New title', savedAt: 2, unread: true, archived: false, deleted: false}]});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.maps.at(-1).owner, JSON.stringify(['a', 'https://api.test']));
  assert.deepEqual(Object.values(f.maps.at(-1).ids), ['two']);
  assert.equal(f.calls.filter(call => call[0] === 'publish').at(-1)[1].suggestions[0].title, 'New title');
  f.coordinator.dispose();
});

test('a read write from an old owner or replaced session cannot count in the new session', async () => {
  let resolveWrite;
  const f = setup(() => new Promise(resolve => {resolveWrite = resolve;}));
  f.coordinator.activate(); f.coordinator.configure(ownerA, f.repositories, {titlesEnabled: false, countEnabled: false});
  await f.coordinator.startReadingSession(3);
  const oldOwnerRead = f.coordinator.markRead('old-account-bookmark');
  await new Promise(resolve => setImmediate(resolve));
  f.coordinator.configure(ownerB, f.repositories, {titlesEnabled: false, countEnabled: false});
  await f.coordinator.startReadingSession(3);
  resolveWrite();
  assert.equal(await oldOwnerRead, false);
  assert.equal(f.calls.filter(call => call[0] === 'update').length, 0);

  await f.coordinator.stopReadingSession();
  await f.coordinator.startReadingSession(3);
  const oldSessionRead = f.coordinator.markRead('same-owner-old-session');
  await new Promise(resolve => setImmediate(resolve));
  await f.coordinator.stopReadingSession();
  await f.coordinator.startReadingSession(3);
  resolveWrite();
  assert.equal(await oldSessionRead, false);
  assert.equal(f.calls.filter(call => call[0] === 'update').length, 0);
  f.coordinator.dispose();
});

test('failed read mutations can retry and the same bookmark contributes once', async () => {
  let fail = true;
  const f = setup(async () => {if (fail) throw new Error('local write failed');});
  f.coordinator.activate(); f.coordinator.configure(ownerA, f.repositories, {titlesEnabled: false, countEnabled: false});
  await f.coordinator.startReadingSession(3);
  await assert.rejects(f.coordinator.markRead('bookmark-1'), /local write failed/);
  assert.equal(f.calls.filter(call => call[0] === 'update').length, 0);
  fail = false;
  assert.equal(await f.coordinator.markRead('bookmark-1'), true);
  assert.equal(await f.coordinator.markRead('bookmark-1'), false);
  assert.equal(f.calls.filter(call => call[0] === 'update').length, 1);
  assert.equal(f.calls.find(call => call[0] === 'update')[2].readCount, 1);
  f.coordinator.dispose();
});

test('widget cleanup remains retryable after sign-out', async () => {
  const f = setup(); f.coordinator.activate();
  f.coordinator.configure(ownerA, f.repositories, {titlesEnabled: true, countEnabled: true});
  await new Promise(resolve => setImmediate(resolve));
  const revoke = f.boundary.revoke.bind(f.boundary); let fail = true, attempts = 0;
  f.boundary.revoke = async snapshot => {attempts++; if (fail) throw new Error('native storage busy'); await revoke(snapshot);};
  f.coordinator.configure(null, null, {titlesEnabled: false, countEnabled: false});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.coordinator.getSnapshot().failed, true);
  fail = false;
  await f.coordinator.retry();
  assert.equal(attempts, 2);
  assert.equal(f.coordinator.getSnapshot().failed, false);
  assert.equal(f.maps.at(-1).owner, '');
});
