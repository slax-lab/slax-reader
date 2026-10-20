import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadingSessionController, WidgetSnapshotController} from '../../src/widgets/controller.ts';

const owner = {userId: 'u1', origin: 'https://api.example', generation: 'g1'};
const other = {userId: 'u2', origin: 'https://api.example', generation: 'g2'};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('snapshot coalescing and owner replacement prevent a late prior-owner refresh from winning', async () => {
  const writes = [], reloads = [];
  let release, version = 0;
  const controller = new WidgetSnapshotController({async nextVersion() {return ++version;}, async publish(snapshot) {
    if (snapshot.owner?.userId === owner.userId && !release) await new Promise(resolve => {release = resolve;});
    writes.push(snapshot); return true;
  }, async revoke(snapshot) {writes.push(snapshot);}, async reload() {reloads.push(writes.at(-1)?.owner?.userId);}}, () => 1234);
  controller.configure(owner, {titlesEnabled: true, countEnabled: true});
  const first = controller.publish({unreadCount: 9, suggestions: []});
  await tick();
  controller.configure(other, {titlesEnabled: true, countEnabled: true});
  const second = controller.publish({unreadCount: 2, suggestions: [
    {id: 'a', title: 'A', savedAt: 1, unread: true, archived: false, deleted: false},
    {id: 'b', title: 'B', savedAt: 3, unread: true, archived: false, deleted: false},
    {id: 'c', title: 'C', savedAt: 2, unread: true, archived: false, deleted: false},
    {id: 'd', title: 'D', savedAt: 4, unread: true, archived: false, deleted: false},
    {id: 'x', title: 'hidden', savedAt: 5, unread: true, archived: true, deleted: false},
  ]});
  release(); await Promise.all([first, second]);
  assert.equal(writes.at(-1).owner.userId, 'u2');
  assert.ok(writes.at(-1).version > writes[0].version);
  assert.deepEqual(writes.at(-1).suggestions.map(item => item.id), ['d', 'b', 'c']);
  assert.equal(writes.at(-1).updatedAt, 1234);
  const lastPriorOwnerWrite = writes.findLastIndex(item => item.owner?.userId === owner.userId);
  const firstNewOwnerWrite = writes.findIndex(item => item.owner?.userId === other.userId);
  assert.ok(lastPriorOwnerWrite < firstNewOwnerWrite, 'no old-owner snapshot is committed after new-owner publication');
});

test('signed-out and opt-in snapshots redact count and titles', async () => {
  const writes = [];
  let version = 0;
  const controller = new WidgetSnapshotController({async nextVersion() {return ++version;}, async publish(value) {writes.push(value); return true;}, async revoke(snapshot) {writes.push(snapshot);}, async reload() {}}, () => 55);
  await controller.configure(owner, {titlesEnabled: false, countEnabled: false});
  await controller.publish({unreadCount: 8, suggestions: [{id: 'opaque', title: 'private title', savedAt: 1, unread: true, archived: false, deleted: false}]});
  await controller.configure(null, {titlesEnabled: false, countEnabled: false});
  assert.equal(writes.at(-1).state, 'signedOut');
  assert.equal(writes.at(-1).unreadCount, null);
  assert.deepEqual(writes.at(-1).suggestions, []);
  await controller.configure(owner, {titlesEnabled: false, countEnabled: true});
  await controller.publish({unreadCount: 8, suggestions: [{id: 'opaque', title: 'private title', savedAt: 1, unread: true, archived: false, deleted: false}]});
  assert.equal(writes.at(-1).unreadCount, 8);
  assert.deepEqual(writes.at(-1).suggestions, []);
  await controller.configure(owner, {titlesEnabled: true, countEnabled: true});
  assert.equal(writes.at(-1).unreadCount, 8, 'preference changes reuse the latest admitted source');
  assert.equal(writes.at(-1).suggestions[0].title, 'private title');
  assert.equal(JSON.stringify(writes.at(-2)).includes('private title'), false);
});

test('dispose fences in-flight version allocation and publish from late publication or reload', async () => {
  for (const stage of ['version', 'publish']) {
    let finish, version = 0, nextVersionCalls = 0, state = null, reloads = [], entered;
    const atStage = new Promise(resolve => {entered = resolve;});
    const controller = new WidgetSnapshotController({
      async nextVersion() {if (stage === 'version' && nextVersionCalls++ === 0) {entered(); await new Promise(resolve => {finish = resolve;});} return ++version;},
      async publish(snapshot) {if (stage === 'publish') {entered(); await new Promise(resolve => {finish = resolve;});} state = snapshot; return true;},
      async revoke(snapshot) {state = snapshot;}, async reload() {reloads.push(state?.state);},
    });
    controller.configure(owner, {titlesEnabled: true, countEnabled: true});
    const publishing = controller.publish({unreadCount: 1, suggestions: []});
    await atStage;
    const disposing = controller.dispose();
    finish();
    await Promise.all([publishing, disposing]);
    assert.equal(state.state, 'signedOut', `${stage} completion must be followed by a fenced signed-out snapshot`);
    assert.deepEqual(state.suggestions, []);
    assert.equal(reloads.at(-1), 'signedOut', `${stage} completion must finish with a signed-out refresh`);
  }
});

test('failed clear is visible and explicit retry clears the old system snapshot', async () => {
  let version = 0, revokeAttempts = 0, stored = {owner, title: 'previous account title'};
  const controller = new WidgetSnapshotController({async nextVersion() {return ++version;}, async publish(snapshot) {stored = snapshot; return true;}, async revoke(snapshot) {if (!snapshot.owner && revokeAttempts++ === 0) throw new Error('temporary storage failure'); stored = snapshot;}, async reload() {} });
  controller.configure(owner, {titlesEnabled: true, countEnabled: true});
  await controller.publish({unreadCount: 1, suggestions: [{id: 'old', title: 'previous account title', savedAt: 1, unread: true, archived: false, deleted: false}]});
  await controller.configure(null, {titlesEnabled: false, countEnabled: false});
  assert.equal(controller.getSnapshot().state, 'error');
  assert.equal(controller.getSnapshot().error, 'revoke');
  assert.equal(stored.suggestions[0].title, 'previous account title', 'failed revoke remains visible as a failure, not a false success');
  await controller.retry();
  assert.equal(stored.state, 'signedOut');
  assert.equal(controller.getSnapshot().state, 'idle');
});

test('reading activity is explicitly started, bounded, and ends on goal or owner change', async () => {
  let now = 10_000;
  const calls = [];
  const controller = new ReadingSessionController({supported: () => true,
    async start(payload) {calls.push(['start', payload]); return 'activity-1';},
    async update(id, payload) {calls.push(['update', id, payload]);},
    async end(id, payload) {calls.push(['end', id, payload]);}}, () => now);
  controller.setOwner(owner);
  assert.equal(calls.length, 0, 'unread state must not start an activity');
  await controller.start(3, 60_000);
  assert.equal(calls[0][0], 'start');
  await controller.updateReadCount(1);
  assert.equal(calls[1][0], 'update');
  await controller.updateReadCount(3);
  assert.equal(calls[2][0], 'end');
  await controller.start(5, 60_000);
  controller.setOwner(other);
  await tick();
  assert.equal(calls.at(-1)[0], 'end');
});

test('activity marks stale and expires without accepting a late owner start', async () => {
  let now = 1000, finishStart;
  const calls = [];
  const controller = new ReadingSessionController({supported: () => true,
    start: payload => new Promise(resolve => {calls.push(['start', payload]); finishStart = resolve;}),
    async update(id, payload) {calls.push(['update', id, payload]);}, async end(id, payload) {calls.push(['end', id, payload]);}}, () => now);
  controller.setOwner(owner);
  const starting = controller.start(4, 60_000, 1000); await tick();
  controller.setOwner(other);
  finishStart('late-id'); await starting;
  assert.equal(calls.at(-1)[0], 'end');

  // A separate session demonstrates stale-state publication and finite expiry.
  const simple = new ReadingSessionController({supported: () => true,
    async start() {return 'id';}, async update(id, payload) {calls.push(['update', id, payload]);}, async end(id, payload) {calls.push(['end', id, payload]);}}, () => now);
  simple.setOwner(other); await simple.start(4, 60_000, 1000);
  now += 1001; await simple.markStale(); assert.equal(calls.at(-1)[2].stale, true);
  now += 60_000; await simple.markStale(); assert.equal(calls.at(-1)[0], 'end');
});
