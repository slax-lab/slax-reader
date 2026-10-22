import test from 'node:test';
import assert from 'node:assert/strict';
import {SaveURLController, validateSaveURL} from '../../src/system-actions/controller.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const invocation = (id, url = 'https://example.com/a') => ({id, name: 'saveURL', params: {url, title: 'Example'}, createdAt: 1});
function setup({save = async () => ({bmId: '1'})} = {}) {
  let entries = [], owner = null, ready = true;
  const removed = [], calls = [];
  const controller = new SaveURLController({journal: {async read() {return structuredClone(entries);}, async write(value) {entries = structuredClone(value);}},
    async save(...args) {calls.push(args); return save(...args);}, async removeInvocation(id) {removed.push(id);}, currentOwner: () => owner, ready: () => ready});
  return {controller, calls, removed, get entries() {return entries;}, owner(value) {owner = value;}, ready(value) {ready = value;}};
}
const account = {userId: 'u1', origin: 'https://api.example', generation: 'g1'};

test('rejects unsafe or malformed save URLs', () => {
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/\nfoo', 'not a URL']) assert.equal(validateSaveURL(url), null);
  assert.equal(validateSaveURL('https://example.com/a'), 'https://example.com/a');
});

test('cold unknown-owner invocation is journaled, requires explicit claim, and duplicate delivery completes once', async () => {
  const f = setup(); f.owner(account);
  await f.controller.receive([invocation('i1')]);
  assert.equal(f.entries[0].owner, null); assert.equal(f.calls.length, 0); assert.deepEqual(f.removed, []);
  await f.controller.claim('i1');
  assert.equal(f.calls.length, 1); assert.equal(f.entries[0].status, 'complete'); assert.deepEqual(f.removed, ['i1']);
  await f.controller.receive([invocation('i1')]);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.removed, ['i1']);
});

test('retryable API failure remains journaled and succeeds only after explicit retry', async () => {
  let fail = true;
  const f = setup({save: async () => {if (fail) throw new Error('offline'); return {bmId: '2'};}}); f.owner(account);
  await f.controller.receive([invocation('i2')]); await f.controller.claim('i2');
  assert.equal(f.entries[0].status, 'failed'); assert.equal(f.entries[0].error, 'save_failed'); assert.deepEqual(f.removed, []);
  fail = false; await f.controller.retry('i2');
  assert.equal(f.entries[0].status, 'complete'); assert.deepEqual(f.removed, ['i2']);
});

test('owner replacement aborts in-flight work and fences stale completion', async () => {
  let resolveSave, signal;
  const f = setup({save: (_url, _title, currentSignal) => {signal = currentSignal; return new Promise((resolve, reject) => {resolveSave = resolve; currentSignal.addEventListener('abort', () => reject(currentSignal.reason), {once: true});});}});
  f.owner(account);
  await f.controller.receive([invocation('i3')]);
  const claiming = f.controller.claim('i3'); await tick();
  f.owner({...account, userId: 'u2', generation: 'g2'});
  await f.controller.contextChanged();
  assert.equal(signal.aborted, true);
  resolveSave({bmId: 'late'}); await claiming; await tick();
  assert.notEqual(f.entries[0].status, 'complete'); assert.deepEqual(f.removed, []);
  f.controller.dispose();
});

test('journal receipt is persisted as processing before API dispatch', async () => {
  let during;
  const f = setup({save: async () => {during = f.entries[0].status; return {};}}); f.owner(account);
  await f.controller.receive([invocation('i4')]); await f.controller.claim('i4');
  assert.equal(during, 'processing');
});

test('an unclaimed invocation is invalidated when an established account is replaced', async () => {
  const f = setup(); f.owner(account); await f.controller.contextChanged();
  await f.controller.receive([invocation('i5')]);
  f.owner({...account, userId: 'u2', generation: 'g2'}); await f.controller.contextChanged();
  assert.equal(f.entries[0].status, 'invalid'); assert.equal(f.entries[0].error, 'owner_changed');
  assert.equal(f.calls.length, 0); assert.deepEqual(f.removed, []);
});

test('successful save receipt survives native acknowledgement failure and replay only retries acknowledgement', async () => {
  let failAck = true, acknowledgements = 0, saves = 0, entries = [];
  const controller = new SaveURLController({journal: {async read() {return structuredClone(entries);}, async write(value) {entries = structuredClone(value);}},
    currentOwner: () => account, ready: () => true, save: async () => {saves++;}, removeInvocation: async () => {acknowledgements++; if (failAck) throw new Error('queue unavailable');}});
  await controller.receive([invocation('i6')]); await controller.claim('i6');
  assert.equal(entries[0].status, 'complete'); assert.equal(saves, 1); assert.equal(acknowledgements, 1);
  failAck = false; await controller.receive([invocation('i6')]);
  assert.equal(entries[0].status, 'complete'); assert.equal(saves, 1); assert.equal(acknowledgements, 2);
});

test('disposed controller ignores a late journal read', async () => {
  let resolveRead, writes = 0;
  const controller = new SaveURLController({journal: {read: () => new Promise(resolve => {resolveRead = resolve;}), async write() {writes++;}},
    currentOwner: () => account, ready: () => true, save: async () => {}, removeInvocation: async () => {}});
  const work = controller.receive([invocation('i7')]); await tick(); controller.dispose(); resolveRead([]); await work;
  assert.equal(writes, 0);
});
