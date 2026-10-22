import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath, URL} from 'node:url';
import {ResourceScheduler, ResourceQueueFullError, type ResourceRequest, type ResourceLimits} from '../../src/data/resource-scheduler.ts';

const nativeRequire = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/react-native/package.json', import.meta.url))));
globalThis.AbortController = nativeRequire('abort-controller/dist/abort-controller').AbortController;
const deferred = <T>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(yes => {resolve = yes;}); return {promise, resolve};};
const serial: Partial<ResourceLimits> = {active: 1, domain: 1, host: 1, background: 1, backgroundDomain: 1, backgroundHost: 1};
const request = (id: string, run: (signal: AbortSignal) => Promise<string>, extra: Partial<ResourceRequest<string>> = {}): ResourceRequest<string> => ({identity: {kind: 'article', context: 'personal', resource: id}, host: 'api.test', lane: 'body', domain: 'personal', run, ...extra});

test('compatible consumers share a transfer and aborting one does not cancel the remaining consumer', async () => {
  const scheduler = new ResourceScheduler('account-a', () => {}), gate = deferred<string>();
  let calls = 0, transport: AbortSignal | undefined;
  const load = request('doc', async signal => {calls++; transport = signal; return gate.promise;});
  const first = new AbortController(), second = new AbortController();
  const a = scheduler.acquire(load, 'background', first.signal), rejected = assert.rejects(a, {name: 'AbortError'});
  const b = scheduler.acquire(load, 'foreground', second.signal);
  await setImmediate(); first.abort(); await rejected;
  assert.equal(calls, 1); assert.equal(transport?.aborted, false);
  gate.resolve('body'); assert.equal(await b, 'body'); await scheduler.close();
});

test('last-consumer cancellation fences late success and keeps transport capacity until it actually drains', async () => {
  const scheduler = new ResourceScheduler('owner', () => {}, serial), gate = deferred<string>();
  let started = 0, signal: AbortSignal | undefined;
  const controller = new AbortController();
  const first = scheduler.acquire(request('one', async value => {signal = value; return gate.promise;}), 'background', controller.signal);
  const rejected = assert.rejects(first, {name: 'AbortError'});
  await setImmediate(); controller.abort(); await rejected; assert.equal(signal?.aborted, true);
  const next = scheduler.acquire(request('one', async () => {started++; return 'replacement';}));
  await setImmediate(); assert.equal(started, 0);
  gate.resolve('stale'); assert.equal(await next, 'replacement'); assert.equal(started, 1); await scheduler.close();
});

test('joining a queued task promotes it ahead of newer and older automatic work without duplicate execution', async () => {
  const scheduler = new ResourceScheduler('owner', () => {}, serial), gate = deferred<string>(), order: string[] = [];
  const occupied = scheduler.acquire(request('busy', () => gate.promise)); await setImmediate();
  const older = scheduler.acquire(request('older', async () => {order.push('older'); return 'older';}));
  const load = request('promoted', async () => {order.push('promoted'); return 'shared';});
  const automatic = scheduler.acquire(load), visible = scheduler.acquire(load, 'foreground');
  gate.resolve('done'); await Promise.all([occupied, older, automatic, visible]);
  assert.deepEqual(order, ['promoted', 'older']); await scheduler.close();
});

test('foreground bursts are bounded and an aged background task can run before a new foreground burst', async () => {
  for (const aged of [false, true]) {
    let now = 0;
    const scheduler = new ResourceScheduler('owner', () => {}, {...serial, foregroundBurst: 2, agingMs: 100}, () => now);
    const gate = deferred<string>(), order: string[] = [];
    const busy = scheduler.acquire(request('busy', () => gate.promise)); await setImmediate();
    const background = scheduler.acquire(request('automatic', async () => {order.push('automatic'); return 'ok';}));
    if (aged) now = 101;
    const visible = Array.from({length: 5}, (_, index) => scheduler.acquire(request(`visible-${index}`, async () => {order.push(`visible-${index}`); return 'ok';}), 'foreground'));
    gate.resolve('done'); await Promise.all([busy, background, ...visible]);
    assert.equal(order.indexOf('automatic'), aged ? 0 : 2); await scheduler.close();
  }
});

test('global, destination and image budgets reserve foreground and body progress', async () => {
  const scheduler = new ResourceScheduler('owner', () => {}), gates: ReturnType<typeof deferred<string>>[] = [];
  const started: {id: string; host: string; lane: string}[] = [];
  const hold = (id: string, host: string, domain: 'personal' | 'collection', lane: 'body' | 'image', priority: 'background' | 'foreground' = 'background') => {
    const gate = deferred<string>(); gates.push(gate);
    return scheduler.acquire(request(id, async () => {started.push({id, host, lane}); return gate.promise;}, {host, domain, lane}), priority);
  };
  const images = [hold('image-a', 'img-a', 'personal', 'image'), hold('image-b', 'img-b', 'collection', 'image'), hold('image-c', 'img-c', 'personal', 'image')];
  await setImmediate(); assert.equal(started.length, 2);
  const bodies = [hold('body-a', 'api', 'personal', 'body'), hold('body-b', 'api', 'collection', 'body'), hold('body-c', 'api', 'personal', 'body')];
  await setImmediate(); assert.equal(started.filter(value => value.lane === 'body').length, 2);
  const foreground = hold('visible', 'api', 'personal', 'body', 'foreground'); await setImmediate();
  assert.equal(started.some(value => value.id === 'visible'), true); assert.equal(started.filter(value => value.host === 'api').length, 3);
  assert.ok(started.length <= 6);
  gates.forEach(gate => gate.resolve('done')); await Promise.all([...images, ...bodies, foreground]); await scheduler.close();
});

test('identity includes account generation, access context, immutable version and transport policy', async () => {
  const scheduler = new ResourceScheduler('owner-a:2', () => {}), other = new ResourceScheduler('owner-b:1', () => {});
  let calls = 0; const run = async () => String(++calls);
  const base = {kind: 'image' as const, context: 'personal', resource: 'https://img.test/a', version: 'v1', policy: 'public'};
  const inputs = [base, {...base, context: 'collection-owner'}, {...base, version: 'v2'}, {...base, policy: 'signed-proxy'}];
  const values = await Promise.all([...inputs.map(identity => scheduler.acquire(request('unused', run, {identity}))), other.acquire(request('unused', run, {identity: base}))]);
  assert.equal(new Set(values).size, 5); await Promise.all([scheduler.close(), other.close()]);
});

test('queue backpressure still lets a consumer join admitted work and cancellation frees a queued slot', async () => {
  const scheduler = new ResourceScheduler('owner', () => {}, {...serial, queued: 1}), gate = deferred<string>();
  const occupied = scheduler.acquire(request('busy', () => gate.promise)); await setImmediate();
  const controller = new AbortController(), queued = request('queued', async () => 'queued');
  const a = scheduler.acquire(queued, 'background', controller.signal), rejected = assert.rejects(a, {name: 'AbortError'});
  const joining = new AbortController(), b = scheduler.acquire(queued, 'foreground', joining.signal), detached = assert.rejects(b, {name: 'AbortError'});
  await assert.rejects(scheduler.acquire(request('overflow', async () => 'no')), ResourceQueueFullError);
  controller.abort(); joining.abort(); await Promise.all([rejected, detached]);
  const next = scheduler.acquire(request('next', async () => 'next')); gate.resolve('busy');
  assert.equal(await next, 'next'); await occupied; await scheduler.close();
});

test('pause and scope revocation reject consumers immediately and stale completions cannot publish', async () => {
  const scheduler = new ResourceScheduler('owner', () => {}), gate = deferred<string>();
  const first = scheduler.acquire(request('first', () => gate.promise)), rejected = assert.rejects(first, {name: 'AbortError'});
  await setImmediate(); const paused = scheduler.pause(); await rejected;
  await assert.rejects(scheduler.acquire(request('paused', async () => 'no')), {name: 'AbortError'});
  gate.resolve('stale'); await paused; scheduler.resume();
  assert.equal(await scheduler.acquire(request('current', async () => 'ok')), 'ok');
  await scheduler.close(); scheduler.resume(); await assert.rejects(scheduler.acquire(request('closed', async () => 'no')), {name: 'AbortError'});
  let active = true; const scope = new ResourceScheduler('owner', () => {if (!active) throw new Error('revoked');});
  const late = deferred<string>(), result = scope.acquire(request('late', () => late.promise));
  const revoked = assert.rejects(result, /revoked/); await setImmediate(); active = false; late.resolve('wrong'); await revoked; await scope.close();
});

test('automatic queue pruning preserves promoted consumers and running transfers', async () => {
  const scheduler = new ResourceScheduler('owner', () => {}, serial), gate = deferred<string>();
  const running = scheduler.acquire(request('running', () => gate.promise)); await setImmediate();
  const dropped = scheduler.acquire(request('dropped', async () => assert.fail('Pruned work must not run'))), rejected = assert.rejects(dropped, {name: 'AbortError'});
  let calls = 0; const shared = request('shared', async () => {calls++; return 'shared';});
  const automatic = scheduler.acquire(shared), visible = scheduler.acquire(shared, 'foreground');
  scheduler.cancelQueued(() => true); await rejected; gate.resolve('running');
  assert.deepEqual(await Promise.all([running, automatic, visible]), ['running', 'shared', 'shared']); assert.equal(calls, 1);
  await scheduler.close();
});

test('a task that rejects without a reason remains a rejection, not an empty successful resource', async () => {
  const scheduler = new ResourceScheduler('owner', () => {});
  await assert.rejects(scheduler.acquire(request('failed', () => Promise.reject(undefined))), /Resource request failed/);
  assert.equal(await scheduler.acquire(request('next', async () => 'ok')), 'ok'); await scheduler.close();
});

test('offline state rejects new and queued consumers, drains active work and cannot resume while paused', async () => {
  const scheduler = new ResourceScheduler('owner', () => {}, serial), gate = deferred<string>();
  const active = scheduler.acquire(request('active', () => gate.promise)), activeRejected = assert.rejects(active, {code: 'network_unavailable'});
  await setImmediate();
  const queued = scheduler.acquire(request('queued', async () => assert.fail('Offline queue must not run'))), queuedRejected = assert.rejects(queued, {code: 'network_unavailable'});
  const offline = scheduler.setOnline(false); await Promise.all([activeRejected, queuedRejected]);
  await assert.rejects(scheduler.acquire(request('offline', async () => 'no')), {code: 'network_unavailable'});
  gate.resolve('late'); await offline; await scheduler.pause(); await scheduler.setOnline(true);
  await assert.rejects(scheduler.acquire(request('paused', async () => 'no')), {name: 'AbortError'});
  scheduler.resume(); assert.equal(await scheduler.acquire(request('online', async () => 'yes')), 'yes'); await scheduler.close();
});
