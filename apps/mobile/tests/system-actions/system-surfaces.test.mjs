import test from 'node:test';
import assert from 'node:assert/strict';
import {SystemSurfacesController, BOOKMARK_ENTITY_KIND, OPEN_BOOKMARK_INTENT} from '../../src/system-actions/system-surfaces.ts';
import {systemBookmarkId} from '../../src/system-actions/catalog-policy.ts';

const ownerA = {userId: 'a', origin: 'https://api.test', generation: 'g1'};
const ownerB = {userId: 'b', origin: 'https://api.test', generation: 'g2'};
const snapshot = [{id: 'bookmark-1', title: 'Title', aliasTitle: '', url: 'https://example.com/x', status: 'success', createdAt: 'now', archiveStatus: 0}];
function setup() {
  let owner = ownerA, state = {}, onRows, watchStops = 0, failDelete = false;
  const calls = [];
  const controller = new SystemSurfacesController({
    async read() {return structuredClone(state);}, async write(value) {state = structuredClone(value);},
    async setCatalog(kind, entities) {calls.push(['catalog', kind, entities]); if (kind !== BOOKMARK_ENTITY_KIND) throw new Error('wrong kind');},
    async deleteDonations(filter) {calls.push(['delete', filter]); if (failDelete) throw new Error('os failure'); return [];},
    async donate(name, params) {calls.push(['donate', name, params]); return 'donation-1';},
    watchSnapshot(listener) {onRows = listener; return () => {watchStops++;};}, currentOwner: () => owner,
  });
  return {controller, calls, get state() {return state;}, get watchStops() {return watchStops;}, emit(rows = snapshot) {onRows?.(rows);}, owner(value) {owner = value;}, failDelete(value) {failDelete = value;}};
}

test('catalog publication is opt-in, bounded by projected data, and cleared on opt-out', async () => {
  const f = setup(); f.controller.activate(); await f.controller.reconcile(false, false); assert.equal(f.calls.length, 0);
  await f.controller.reconcile(true, false); f.emit(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls[0][0], 'catalog'); assert.equal(f.calls[0][2][0].id, systemBookmarkId(JSON.stringify(['a', 'https://api.test']), 'bookmark-1'));
  await f.controller.reconcile(false, false);
  assert.ok(f.calls.some(call => call[0] === 'catalog' && call[2].length === 0)); assert.ok(f.watchStops > 0);
});

test('old owner catalog is revoked before replacement owner publishes', async () => {
  const f = setup(); f.controller.activate(); await f.controller.reconcile(true, false); f.emit(); await new Promise(resolve => setImmediate(resolve));
  const before = f.calls.length; f.owner(ownerB); await f.controller.reconcile(true, false);
  const changes = f.calls.slice(before).map(call => call[0] === 'catalog' ? ['catalog', call[2].length] : call[0]);
  assert.deepEqual(changes.slice(0, 2), [['catalog', 0], 'delete']);
});

test('failed OS revocation stays pending and blocks publication until retry', async () => {
  const f = setup(); f.controller.activate(); await f.controller.reconcile(true, true); f.emit(); await new Promise(resolve => setImmediate(resolve));
  f.failDelete(true); f.owner(ownerB); await f.controller.reconcile(true, true);
  assert.equal(f.controller.getSnapshot(), true); assert.equal(f.state.revokedCatalog, true);
  f.failDelete(false); await f.controller.reconcile(true, true);
  assert.equal(f.state.revokedCatalog, false); assert.equal(f.state.catalogOwner, undefined);
});

test('only successful open actions are donated and replayed action ids are deduplicated', async () => {
  const f = setup(); f.controller.activate(); await f.controller.reconcile(false, true);
  await f.controller.donateSuccessfulOpen('bookmark-1', 'intent-1');
  await f.controller.donateSuccessfulOpen('bookmark-1', 'intent-1');
  assert.equal(f.calls.filter(call => call[0] === 'donate').length, 1);
  assert.equal(f.calls.find(call => call[0] === 'donate')[1], OPEN_BOOKMARK_INTENT);
  assert.deepEqual(f.calls.find(call => call[0] === 'donate')[2], {bookmarkId: systemBookmarkId(JSON.stringify(['a', 'https://api.test']), 'bookmark-1')});
});

test('deleting a catalog item revokes its successful-open donations', async () => {
  const f = setup(); f.controller.activate(); await f.controller.reconcile(false, true); f.emit(); await new Promise(resolve => setImmediate(resolve));
  await f.controller.donateSuccessfulOpen('bookmark-1', 'manual-1');
  f.emit([]); await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.some(call => call[0] === 'delete' && call[1].intent === OPEN_BOOKMARK_INTENT));
  assert.deepEqual(f.state.donationIds, []);
});

test('in-flight old-owner catalog publication is revoked before reconciliation settles', async () => {
  const f = setup(); f.controller.activate(); await f.controller.reconcile(true, false);
  let release; const pending = new Promise(resolve => {release = resolve;}); let held = false;
  const original = f.controller['ports'].setCatalog;
  f.controller['ports'].setCatalog = async (kind, entities) => {if (entities.length && !held) {held = true; await pending;} await original(kind, entities);};
  f.emit(); await new Promise(resolve => setImmediate(resolve));
  f.owner(ownerB); const replacement = f.controller.reconcile(true, false); release(); await replacement;
  assert.equal(f.state.catalogOwner, undefined);
  assert.ok(f.calls.some(call => call[0] === 'catalog' && call[2].length === 0));
});

test('catalog snapshots coalesce to the latest rows while an OS publish is pending', async () => {
  const f = setup(); f.controller.activate(); await f.controller.reconcile(true, false);
  let release; const pending = new Promise(resolve => {release = resolve;}); let held = false;
  const original = f.controller['ports'].setCatalog;
  f.controller['ports'].setCatalog = async (kind, entities) => {if (entities.length && !held) {held = true; await pending;} await original(kind, entities);};
  f.emit([snapshot[0]]); await new Promise(resolve => setImmediate(resolve));
  f.emit([{...snapshot[0], id: 'latest'}]); release(); await new Promise(resolve => setTimeout(resolve, 0));
  const published = f.calls.filter(call => call[0] === 'catalog' && call[2].length);
  assert.equal(published.at(-1)[2][0].id, systemBookmarkId(JSON.stringify(['a', 'https://api.test']), 'latest'));
});

test('failed donation remains pending and can be retried by the opted-in owner', async () => {
  const f = setup(); f.controller.activate(); await f.controller.reconcile(false, true);
  const original = f.controller['ports'].donate; let fail = true;
  f.controller['ports'].donate = async (...args) => {if (fail) throw new Error('os failure'); return original(...args);};
  await f.controller.donateSuccessfulOpen('bookmark-1', 'manual-failure');
  assert.equal(f.state.pendingDonations?.length, 1); assert.equal(f.controller.getSnapshot(), true);
  assert.deepEqual(f.state.donationAttempts, []);
  fail = false; await f.controller.retryPendingDonations();
  assert.equal(f.state.pendingDonations?.length, 0); assert.equal(f.state.donatedActions?.length, 1);
  assert.deepEqual(f.state.donationAttempts, []);
});

test('restart after OS acceptance and a failed completion write consumes the admitted receipt without donating twice', async () => {
  const f = setup(); await f.controller.reconcile(false, true);
  const ports = f.controller['ports'], write = ports.write;
  let failCompletion = true;
  ports.write = async state => {
    if (failCompletion && state.donatedActions?.includes('accepted-before-crash')) throw new Error('storage interrupted');
    await write(state);
  };
  await f.controller.donateSuccessfulOpen('bookmark-1', 'accepted-before-crash');
  assert.equal(f.calls.filter(call => call[0] === 'donate').length, 1);
  assert.deepEqual(f.state.donationAttempts, ['accepted-before-crash']);
  assert.equal(f.state.pendingDonations.length, 1);
  f.controller.dispose(); failCompletion = false;
  const resumed = new SystemSurfacesController(ports);
  await resumed.reconcile(false, true); await resumed.retryPendingDonations();
  await resumed.donateSuccessfulOpen('bookmark-1', 'accepted-before-crash');
  assert.equal(f.calls.filter(call => call[0] === 'donate').length, 1);
  assert.deepEqual(f.state.pendingDonations, []);
  assert.equal(f.state.donatedActions?.includes('accepted-before-crash') ?? false, false, 'ambiguous OS outcome is not recorded as confirmed success');
  resumed.dispose();
});

test('an interrupted admission before native dispatch may lose an optional donation but never replays it', async () => {
  const f = setup(); await f.controller.reconcile(false, true);
  const ports = f.controller['ports'], write = ports.write;
  let interrupt = true;
  ports.write = async state => {
    await write(state);
    if (interrupt && state.donationAttempts?.includes('admitted-before-crash')) f.controller.dispose();
  };
  await f.controller.donateSuccessfulOpen('bookmark-1', 'admitted-before-crash');
  assert.equal(f.calls.filter(call => call[0] === 'donate').length, 0);
  interrupt = false;
  const resumed = new SystemSurfacesController(ports);
  await resumed.reconcile(false, true); await resumed.retryPendingDonations();
  assert.equal(f.calls.filter(call => call[0] === 'donate').length, 0);
  assert.deepEqual(f.state.pendingDonations, []);
  assert.deepEqual(f.state.donationAttempts, ['admitted-before-crash']);
  resumed.dispose();
});

test('a failed admission write never dispatches and leaves the queued donation retryable', async () => {
  const f = setup(); await f.controller.reconcile(false, true);
  const ports = f.controller['ports'], write = ports.write;
  let failAdmission = true;
  ports.write = async state => {
    if (failAdmission && state.donationAttempts?.length) throw new Error('storage unavailable');
    await write(state);
  };
  await f.controller.donateSuccessfulOpen('bookmark-1', 'queued-only');
  assert.equal(f.calls.filter(call => call[0] === 'donate').length, 0);
  assert.equal(f.state.pendingDonations.length, 1);
  failAdmission = false; await f.controller.retryPendingDonations();
  assert.equal(f.calls.filter(call => call[0] === 'donate').length, 1);
  assert.deepEqual(f.state.pendingDonations, []);
});

test('same-account runtime replacement after admission fences the old native dispatch', async () => {
  const f = setup(); await f.controller.reconcile(false, true);
  const ports = f.controller['ports'], write = ports.write;
  ports.write = async state => {
    await write(state);
    if (state.donationAttempts?.includes('old-runtime')) f.owner({...ownerA, generation: 'replacement'});
  };
  await f.controller.donateSuccessfulOpen('bookmark-1', 'old-runtime');
  assert.equal(f.calls.filter(call => call[0] === 'donate').length, 0);
});

test('legacy pending receipts with no provable pre-dispatch state are consumed conservatively', async () => {
  const f = setup(), key = JSON.stringify(['a', 'https://api.test']);
  await f.controller['ports'].write({donationOwner: key, pendingDonations: [{actionId: 'legacy-unknown', bookmarkId: 'b-legacy', owner: key}]});
  await f.controller.reconcile(false, true); await f.controller.retryPendingDonations();
  await f.controller.donateCatalogOpen('b-legacy', 'legacy-unknown');
  assert.equal(f.calls.filter(call => call[0] === 'donate').length, 0);
  assert.deepEqual(f.state.pendingDonations, []);
  assert.deepEqual(f.state.donationAttempts, ['legacy-unknown']);
});

test('turning donations off or signing out revokes prior OS suggestions', async () => {
  const f = setup(); f.controller.activate(); await f.controller.reconcile(false, true);
  await f.controller.donateSuccessfulOpen('bookmark-1', 'manual-2');
  const before = f.calls.filter(call => call[0] === 'delete').length;
  await f.controller.reconcile(false, false);
  assert.equal(f.calls.filter(call => call[0] === 'delete').length, before + 1);
  assert.equal(f.state.donationOwner, undefined);
});
