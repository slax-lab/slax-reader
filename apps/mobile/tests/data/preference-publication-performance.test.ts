import test from 'node:test';
import assert from 'node:assert/strict';
import {PreferenceStore} from '../../src/data/preferences.ts';
import type {PreferenceValues} from '../../src/data/preferences.ts';
import {MobileTelemetry} from '../../src/telemetry/core.ts';
import {AccountInactiveError} from '../../src/data/account-lease.ts';
import {MemoryPreferences} from './helpers.ts';

class CountedPreferences extends MemoryPreferences {
  reads = 0;
  swaps = 0;
  writes = 0;
  override async read() {this.reads++; return super.read();}
  override async compareAndSwap(revision: number, values: PreferenceValues) {
    this.swaps++;
    const committed = await super.compareAndSwap(revision, values);
    if (committed) this.writes++;
    return committed;
  }
}

test('after initial observation telemetry reads an existing device ID without edits, CAS, or notifications', async () => {
  const storage = new CountedPreferences({analytics_device_id: 'stable-device', user_language: 'en'});
  const preferences = new PreferenceStore(storage);
  let publications = 0, generated = 0, edits = 0;
  preferences.subscribe(() => {publications++;});
  await preferences.read();
  assert.equal(publications, 1);
  publications = 0; storage.reads = 0;
  const update = preferences.update.bind(preferences);
  preferences.update = edit => {edits++; return update(edit);};
  const delivered: string[] = [];
  const telemetry = new MobileTelemetry({preferences, platform: 'ios', version: 'fixture', locale: () => 'en',
    generateIdentifier: () => {generated++; return 'unused';},
    api: {async sendClientEvents(deviceId) {delivered.push(deviceId);}},
  });
  for (let index = 0; index < 20; index++) telemetry.track('fixture_event');
  await telemetry.flush();
  assert.deepEqual(delivered, Array(20).fill('stable-device'));
  assert.equal(storage.reads, 20);
  assert.equal(storage.swaps, 0); assert.equal(storage.writes, 0);
  assert.equal(publications, 0); assert.equal(generated, 0); assert.equal(edits, 0);
});

test('concurrent first use persists exactly one device ID and subsequent use never rewrites it', async () => {
  const storage = new CountedPreferences({user_language: 'en'}), preferences = new PreferenceStore(storage);
  let generated = 0, publications = 0;
  await preferences.read();
  preferences.subscribe(() => {publications++;});
  const ids = await Promise.all(Array.from({length: 12}, () => preferences.deviceId(() => `candidate-${++generated}`)));
  assert.equal(new Set(ids).size, 1);
  assert.equal(ids[0], storage.values.analytics_device_id);
  assert.equal(storage.writes, 1); assert.equal(storage.revision, 1); assert.equal(publications, 1);
  const swaps = storage.swaps;
  assert.equal(await preferences.deviceId(() => {throw new Error('Must not generate again');}), ids[0]);
  assert.equal(storage.swaps, swaps);
  assert.equal(storage.values.user_language, 'en');
});

test('initialization adopts an external CAS winner and later reads observe external replacements', async () => {
  const storage = new CountedPreferences({user_language: 'en'}), preferences = new PreferenceStore(storage);
  storage.beforeSwap = () => {
    storage.beforeSwap = undefined;
    storage.values.analytics_device_id = 'extension-device'; storage.revision++;
  };
  assert.equal(await preferences.deviceId(() => 'losing-candidate'), 'extension-device');
  assert.equal(storage.swaps, 1); assert.equal(storage.writes, 0);
  storage.values.analytics_device_id = 'migrated-device'; storage.revision++;
  assert.equal(await preferences.deviceId(() => {throw new Error('Already initialized');}), 'migrated-device');
  assert.equal(storage.swaps, 1);
});

test('device initialization retries stale CAS without regenerating or overwriting concurrent keys', async () => {
  const storage = new CountedPreferences({user_language: 'en'}), preferences = new PreferenceStore(storage);
  let generated = 0;
  storage.beforeSwap = () => {
    storage.beforeSwap = undefined;
    storage.values.cache_count = 200; storage.revision++;
  };
  assert.equal(await preferences.deviceId(() => `candidate-${++generated}`), 'candidate-1');
  assert.equal(generated, 1); assert.equal(storage.swaps, 2); assert.equal(storage.writes, 1);
  assert.deepEqual(storage.values, {user_language: 'en', cache_count: 200, analytics_device_id: 'candidate-1'});
});

test('equivalent primitive dictionaries and copied arrays do not write or publish', async () => {
  const storage = new CountedPreferences({language: 'en', enabled: false, count: 0, list: ['one', 'two'], empty: []});
  const preferences = new PreferenceStore(storage);
  let publications = 0;
  await preferences.read();
  preferences.subscribe(() => {publications++;});
  await preferences.update(() => {});
  await preferences.update(next => {next.list = ['one', 'two']; next.empty = [];});
  await preferences.update(next => {delete next.language; next.language = 'en';});
  await preferences.update(next => {next.extra = 'temporary'; delete next.extra;});
  assert.equal(storage.swaps, 0); assert.equal(storage.writes, 0); assert.equal(publications, 0);
  await preferences.update(next => {(next.list as string[]).reverse();});
  await preferences.update(next => {next.count = '0';});
  await preferences.update(next => {delete next.enabled;});
  assert.equal(storage.writes, 3); assert.equal(publications, 3);
  assert.deepEqual(storage.values, {language: 'en', count: '0', list: ['two', 'one'], empty: []});
});

test('key presence distinguishes deletion, null, and equal-length key replacements', async () => {
  const initial = {nullable: null, enabled: false} as unknown as PreferenceValues;
  const storage = new CountedPreferences(initial), preferences = new PreferenceStore(storage);
  await preferences.update(next => {delete next.nullable;});
  assert.equal(storage.writes, 1); assert.equal(Object.hasOwn(storage.values, 'nullable'), false);
  await preferences.update(next => {Object.assign(next, {nullable: null});});
  assert.equal(storage.writes, 2); assert.equal(storage.values.nullable, null);
  await preferences.update(next => {delete next.enabled; next.replacement = false;});
  assert.equal(storage.writes, 3); assert.equal(Object.hasOwn(storage.values, 'enabled'), false);
  await preferences.update(next => {Object.assign(next, {nullable: null});});
  assert.equal(storage.writes, 3);
});

test('a losing CAS publishes the external winner once without another already-satisfied write', async () => {
  const storage = new CountedPreferences({cache_count: 50}), preferences = new PreferenceStore(storage);
  let publications = 0, edits = 0;
  let visible = await preferences.read();
  preferences.subscribe(values => {publications++; visible = values;});
  storage.beforeSwap = () => {
    storage.beforeSwap = undefined;
    storage.values.cache_count = 100; storage.values.user_language = 'ja'; storage.revision++;
  };
  const values = await preferences.update(next => {edits++; next.cache_count = 100;});
  assert.equal(edits, 2); assert.equal(storage.swaps, 1); assert.equal(storage.writes, 0);
  assert.equal(publications, 1); assert.deepEqual(values, {cache_count: 100, user_language: 'ja'});
  assert.deepEqual(visible, values);
  await preferences.update(next => {next.cache_count = 100;});
  assert.equal(publications, 1); assert.equal(storage.swaps, 1);
  storage.beforeSwap = () => {storage.revision++;};
  await assert.rejects(preferences.update(next => {next.cache_count = 200;}), /storage is busy/);
  assert.equal(storage.swaps, 33); assert.equal(storage.writes, 0);
});

test('fast and no-op paths still assert account validity after async reads and edits', async () => {
  let active = true;
  const storage = new CountedPreferences({analytics_device_id: 'stable-device'});
  const assertActive = () => {if (!active) throw new AccountInactiveError();};
  const root = new PreferenceStore(storage), preferences = root.scoped(assertActive);
  const read = storage.read.bind(storage);
  storage.read = async () => {const snapshot = await read(); active = false; return snapshot;};
  await assert.rejects(preferences.deviceId(() => 'unused'), AccountInactiveError);
  active = true;
  await assert.rejects(preferences.update(() => {}), AccountInactiveError);
  storage.read = read; active = true;
  await assert.rejects(preferences.update(() => {active = false;}), AccountInactiveError);
  assert.equal(storage.swaps, 0); assert.equal(storage.writes, 0);
  let stalePublications = 0, currentPublications = 0;
  active = true; preferences.subscribe(() => {stalePublications++;});
  root.subscribe(() => {currentPublications++;});
  active = false;
  await root.update(next => {next.user_language = 'ja';});
  assert.equal(stalePublications, 0); assert.equal(currentPublications, 1);
});

for (const operation of ['update', 'deviceId', 'read'] as const) test(`${operation} publishes external changes once across root and scoped stores without writing`, async () => {
  const storage = new CountedPreferences({cache_count: 50, analytics_device_id: 'stable-device', labels: ['one', 'two']});
  const root = new PreferenceStore(storage), external = new PreferenceStore(storage), scoped = root.scoped(() => {}), nested = scoped.scoped(() => {});
  let visible = await root.read(), rootPublications = 0, scopePublications = 0;
  root.subscribe(values => {visible = values; rootPublications++;});
  scoped.subscribe(() => {scopePublications++;});
  await external.update(next => {next.cache_count = 100; next.labels = ['two', 'one'];});
  assert.equal(visible.cache_count, 50);
  const swaps = storage.swaps, writes = storage.writes;
  if (operation === 'update') await scoped.update(next => {next.cache_count = 100;});
  else if (operation === 'deviceId') assert.equal(await scoped.deviceId(() => 'unused'), 'stable-device');
  else await scoped.read();
  assert.equal(visible.cache_count, 100); assert.deepEqual(visible.labels, ['two', 'one']);
  assert.equal(rootPublications, 1); assert.equal(scopePublications, 1);
  await Promise.all(Array.from({length: 20}, (_, index) => (index % 2 ? root : nested).deviceId(() => 'unused')));
  await root.update(next => {next.cache_count = 100;});
  await nested.read();
  assert.equal(rootPublications, 1); assert.equal(scopePublications, 1);
  assert.equal(storage.swaps, swaps); assert.equal(storage.writes, writes);
  await external.update(next => {next.cache_count = '100'; delete next.labels;});
  await nested.update(next => {next.cache_count = '100';});
  assert.equal(rootPublications, 2); assert.equal(scopePublications, 2);
  assert.equal(visible.cache_count, '100'); assert.equal(Object.hasOwn(visible, 'labels'), false);
});

test('equivalent higher revisions are silent and returned arrays cannot mutate the shared observation', async () => {
  const storage = new CountedPreferences({cache_count: 50, labels: ['one', 'two']});
  const preferences = new PreferenceStore(storage);
  const first = await preferences.read(); let publications = 0;
  preferences.subscribe(() => {publications++;});
  (first.labels as string[]).reverse(); first.cache_count = 500;
  await preferences.read(); assert.equal(publications, 0);
  await storage.compareAndSwap(storage.revision, {labels: ['one', 'two'], cache_count: 50});
  await preferences.update(() => {}); assert.equal(publications, 0);
  assert.equal(storage.swaps, 1); assert.equal(storage.writes, 1);
});

test('late older reads and delayed successful CAS completions cannot republish stale snapshots', async () => {
  const storage = new CountedPreferences({cache_count: 50, analytics_device_id: 'stable-device'});
  let releaseRead!: () => void, readStarted!: () => void, holdRead = false;
  const readGate = new Promise<void>(resolve => {releaseRead = resolve;}), reading = new Promise<void>(resolve => {readStarted = resolve;});
  let releaseSwap!: () => void, swapStarted!: () => void, holdSwap = false;
  const swapGate = new Promise<void>(resolve => {releaseSwap = resolve;}), swapping = new Promise<void>(resolve => {swapStarted = resolve;});
  const root = new PreferenceStore({
    async read() {const snapshot = await storage.read(); if (holdRead) {holdRead = false; readStarted(); await readGate;} return snapshot;},
    async compareAndSwap(revision, values) {const result = await storage.compareAndSwap(revision, values); if (holdSwap) {holdSwap = false; swapStarted(); await swapGate;} return result;},
  });
  const scope = root.scoped(() => {}), external = new PreferenceStore(storage);
  const seen: unknown[] = []; await root.read(); root.subscribe(values => {seen.push(values.cache_count);});
  holdRead = true;
  const pending = scope.deviceId(() => 'unused'); await reading;
  await external.update(next => {next.cache_count = 100;}); await root.read();
  releaseRead(); await pending; assert.deepEqual(seen, [100]);
  holdSwap = true;
  const saving = scope.update(next => {next.cache_count = 200;}); await swapping;
  await external.update(next => {next.cache_count = 300;}); await root.read();
  releaseSwap(); await saving; assert.deepEqual(seen, [100, 300]);
  await scope.update(next => {next.cache_count = 300;}); assert.deepEqual(seen, [100, 300]);
});

for (const operation of ['update', 'deviceId'] as const) test(`revoked ${operation} cannot publish or consume a new-account observation`, async () => {
  const storage = new CountedPreferences({cache_count: 50, user_id: 'account-a', analytics_device_id: 'stable-device'});
  let active = true, hold = false, release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), reading = new Promise<void>(resolve => {started = resolve;});
  const root = new PreferenceStore({
    async read() {const snapshot = await storage.read(); if (hold) {hold = false; started(); await gate;} return snapshot;},
    compareAndSwap: (revision, values) => storage.compareAndSwap(revision, values),
  });
  const scoped = root.scoped(() => {if (!active) throw new AccountInactiveError();}), external = new PreferenceStore(storage);
  await root.read();
  let rootPublications = 0, stalePublications = 0;
  root.subscribe(() => {rootPublications++;}); scoped.subscribe(() => {stalePublications++;});
  await external.update(next => {next.user_id = 'account-b'; next.cache_count = 100;});
  hold = true;
  const pending = operation === 'update' ? scoped.update(next => {next.cache_count = 100;}) : scoped.deviceId(() => 'unused');
  await reading; active = false; release(); await assert.rejects(pending, AccountInactiveError);
  assert.equal(rootPublications, 0); assert.equal(stalePublications, 0);
  await root.deviceId(() => 'unused');
  assert.equal(rootPublications, 1); assert.equal(stalePublications, 0);
  await root.read(); assert.equal(rootPublications, 1);
  assert.equal(storage.swaps, 1); assert.equal(storage.writes, 1);
});

for (const operation of ['write', 'noop', 'deviceId', 'read'] as const) test(`callback-time scope revocation during ${operation} still notifies active root and sibling subscribers`, async () => {
  const storage = new CountedPreferences({cache_count: 50, analytics_device_id: 'stable-device'});
  const root = new PreferenceStore(storage), external = new PreferenceStore(storage);
  let active = true;
  const scoped = root.scoped(() => {if (!active) throw new AccountInactiveError();}), sibling = root.scoped(() => {});
  await root.read();
  let initiatingCalls = 0, revokedCalls = 0;
  const rootValues: unknown[] = [], siblingValues: unknown[] = [];
  scoped.subscribe(() => {initiatingCalls++; active = false;});
  scoped.subscribe(() => {revokedCalls++;});
  root.subscribe(values => {rootValues.push(values.cache_count);});
  sibling.subscribe(values => {siblingValues.push(values.cache_count);});
  if (operation !== 'write') await external.update(next => {next.cache_count = 100;});
  const pending = operation === 'deviceId' ? scoped.deviceId(() => 'unused') : operation === 'read' ? scoped.read() : scoped.update(next => {next.cache_count = 100;});
  await assert.rejects(pending, AccountInactiveError);
  assert.equal(initiatingCalls, 1); assert.equal(revokedCalls, 0);
  assert.deepEqual(rootValues, [100]); assert.deepEqual(siblingValues, [100]);
  await root.read(); await sibling.update(() => {});
  assert.deepEqual(rootValues, [100]); assert.deepEqual(siblingValues, [100]);
  assert.equal(storage.swaps, 1); assert.equal(storage.writes, 1);
  await external.update(next => {next.cache_count = 200;}); await root.read();
  assert.equal(initiatingCalls, 1); assert.equal(revokedCalls, 0);
  assert.deepEqual(rootValues, [100, 200]); assert.deepEqual(siblingValues, [100, 200]);
});

for (const operation of ['write', 'noop', 'deviceId', 'read'] as const) test(`throwing subscribers during ${operation} do not prevent other subscribers observing the accepted snapshot`, async () => {
  const storage = new CountedPreferences({cache_count: 50, analytics_device_id: 'stable-device'});
  const root = new PreferenceStore(storage), scoped = root.scoped(() => {}), external = new PreferenceStore(storage);
  await root.read();
  const firstError = new Error('first subscriber failed'), secondError = new Error('second subscriber failed');
  let throwingCalls = 0;
  scoped.subscribe(() => {throwingCalls++; throw firstError;});
  scoped.subscribe(() => {throwingCalls++; throw secondError;});
  const rootValues: unknown[] = []; root.subscribe(values => {rootValues.push(values.cache_count);});
  if (operation !== 'write') await external.update(next => {next.cache_count = 100;});
  const pending = operation === 'deviceId' ? scoped.deviceId(() => 'unused') : operation === 'read' ? scoped.read() : scoped.update(next => {next.cache_count = 100;});
  await assert.rejects(pending, error => error === firstError);
  assert.equal(throwingCalls, 2); assert.deepEqual(rootValues, [100]);
  await root.read(); await root.update(() => {});
  assert.equal(throwingCalls, 2); assert.deepEqual(rootValues, [100]);
  assert.equal(storage.swaps, 1); assert.equal(storage.writes, 1);
});

test('a subscriber that revokes and throws still allows guarded fan-out before account rejection', async () => {
  const storage = new CountedPreferences({cache_count: 50}), root = new PreferenceStore(storage);
  let active = true, staleCalls = 0;
  const scoped = root.scoped(() => {if (!active) throw new AccountInactiveError();});
  await root.read();
  scoped.subscribe(() => {active = false; throw new Error('subscriber failure');});
  scoped.subscribe(() => {staleCalls++;});
  const values: unknown[] = []; root.subscribe(next => {values.push(next.cache_count);});
  await assert.rejects(scoped.update(next => {next.cache_count = 100;}), AccountInactiveError);
  assert.deepEqual(values, [100]); assert.equal(staleCalls, 0);
  await root.read(); assert.deepEqual(values, [100]);
  assert.equal(storage.writes, 1);
});
