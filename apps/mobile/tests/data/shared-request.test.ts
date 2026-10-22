import test from 'node:test';
import assert from 'node:assert/strict';
import {SharedRequestCache} from '../../src/data/shared-request.ts';
import {createMobileApi} from '../../src/data/api.ts';
import {SessionController} from '../../src/domain/session.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {MemoryPreferences} from './helpers.ts';

function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(yes => {resolve = yes;}); return {resolve, promise};}
const current = () => {};

test('concurrent consumers share acquisition and one cancellation does not abort another', async () => {
  const request = deferred<string>(), cache = new SharedRequestCache<string>();
  let loads = 0, signal!: AbortSignal;
  const load = (value: AbortSignal) => {loads++; signal = value; return request.promise;};
  const first = new AbortController(), second = new AbortController();
  const a = cache.read(load, current, first.signal), b = cache.read(load, current, second.signal);
  const rejected = assert.rejects(a, {name: 'AbortError'});
  await Promise.resolve(); first.abort(); await rejected;
  assert.equal(loads, 1); assert.equal(signal.aborted, false);
  request.resolve('shared'); assert.equal(await b, 'shared');
  assert.equal(await cache.read(load, current), 'shared'); assert.equal(loads, 1);
});

test('last cancellation retires an ignoring transport and its late completion cannot refill the cache', async () => {
  const request = deferred<string>(), cache = new SharedRequestCache<string>();
  const controller = new AbortController(); let signal!: AbortSignal;
  const first = cache.read(value => {signal = value; return request.promise;}, current, controller.signal);
  const rejected = assert.rejects(first, {name: 'AbortError'});
  await Promise.resolve(); controller.abort(); await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(await cache.read(async () => 'replacement', current), 'replacement');
  request.resolve('retired'); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await cache.read(async () => 'wrong', current), 'replacement');
});

test('explicit invalidation rejects all old consumers without waiting for transport completion', async () => {
  const request = deferred<string>(), cache = new SharedRequestCache<string>();
  const first = cache.read(() => request.promise, current), second = cache.read(() => request.promise, current);
  const rejected = Promise.all([assert.rejects(first, {name: 'AbortError'}), assert.rejects(second, {name: 'AbortError'})]);
  cache.invalidate(); await rejected;
  assert.equal(await cache.read(async () => 'new', current), 'new');
  request.resolve('old');
});

test('expired or revoked cached values are not reused', async () => {
  let now = 0, owner = 1, loads = 0;
  const cache = new SharedRequestCache<number>(10, () => now);
  const capture = () => {const expected = owner; return () => {assert.equal(owner, expected);};};
  assert.equal(await cache.read(async () => ++loads, capture()), 1);
  now = 11; assert.equal(await cache.read(async () => ++loads, capture()), 2);
  owner++; assert.equal(await cache.read(async () => ++loads, capture()), 3);
});

async function apiFixture(transport: typeof fetch) {
  const sessions = new SessionController(new PreferenceStore(new MemoryPreferences({auth_token: 'synthetic-a', user_id: 'a'})), {enter: async () => {}, leave: async () => {}});
  await sessions.restore();
  return {sessions, api: createMobileApi({baseUrl: 'https://api.test', platform: 'ios', version: 'test', sessions, fetch: transport})};
}

test('RSS and PDF share the actual Labs request and settings mutation invalidates its result', async () => {
  let reads = 0, writes = 0, enabled = false;
  const {api} = await apiFixture(async (_url, options) => {
    if (options?.method === 'POST') {writes++; enabled = true; return Response.json({code: 200, data: null});}
    reads++; return Response.json({code: 200, data: {features: [{key: 'pdf', enabled}]}});
  });
  const [rss, pdf] = await Promise.all([api.rssLabs(), api.rssLabs()]);
  assert.equal(reads, 1); assert.deepEqual(rss, pdf);
  rss.features[0].enabled = true;
  assert.equal((await api.rssLabs()).features[0].enabled, false);
  await api.setLab('pdf', true);
  assert.equal((await api.rssLabs()).features[0].enabled, true);
  assert.equal(reads, 2); assert.equal(writes, 1);
});

test('Labs cached data cannot cross an account or API origin replacement', async () => {
  let reads = 0;
  const {api, sessions} = await apiFixture(async () => Response.json({code: 200, data: {features: [{key: `read-${++reads}`, enabled: true}]}}));
  assert.equal((await api.rssLabs()).features[0].key, 'read-1');
  await sessions.accept('synthetic-b', 'b');
  assert.equal((await api.rssLabs()).features[0].key, 'read-2');
  api.setBaseUrl('https://other.test');
  assert.equal((await api.rssLabs()).features[0].key, 'read-3');
});
