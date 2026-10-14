import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFixtureScope, decodeFixtureArtwork, FixtureMemoryPreferences, planFixtureRows, preparedRssCacheKeys} from '../../fixtures/isolation.ts';
import {MOBILE_TABLES} from '../../src/data/schema.ts';

test('fixture scope requires a marked direct child of the cache fixture root', () => {
  const marker = {controlledFixture: true, fixtureVersion: 1};
  assertFixtureScope('file:///app/cache/slax-ui-fixtures/run-1/', 'file:///app/cache/', marker);
  for (const path of ['file:///app/data/slax-ui-fixtures/run-1', 'file:///app/cache/slax-ui-fixtures/../data', 'file:///app/cache/slax-ui-fixtures/run-1/nested', 'file:///app/cache/slax-ui-fixtures/%2e%2e', 'file:///app/cache/slax-ui-fixtures/run%2fdata', 'https://fixture.test/cache/slax-ui-fixtures/run-1']) assert.throws(() => assertFixtureScope(path, 'file:///app/cache/', marker));
  assert.throws(() => assertFixtureScope('file:///app/cache/slax-ui-fixtures/run-1', 'file:///app/cache/', {controlledFixture: false, fixtureVersion: 1}));
});
test('fixture preferences are isolated memory CAS snapshots including synthetic authentication', async () => {
  const storage = new FixtureMemoryPreferences({auth_token: 'synthetic-not-auth', user_id: 'fixture', choice: ['en']});
  const first = await storage.read(); first.values.auth_token = 'changed'; (first.values.choice as string[]).push('zh');
  assert.equal((await storage.read()).values.auth_token, 'synthetic-not-auth'); assert.deepEqual((await storage.read()).values.choice, ['en']);
  assert.equal(await storage.compareAndSwap(0, {user_id: 'new-fixture'}), true); assert.equal(await storage.compareAndSwap(0, {user_id: 'stale'}), false);
  assert.deepEqual((await storage.read()).values, {user_id: 'new-fixture'});
});
test('fixture SQL is constrained to the known schema and preserves complete local JSON', () => {
  const local = JSON.stringify({id: 'fixture', future_field: {retained: true}});
  const plans = planFixtureRows(MOBILE_TABLES, {sr_user: [{id: 'fixture', name: 'Synthetic', unknown_column: 'excluded'}], ps_data_local__local_bookmark_info: [{id: 'fixture', data: local}]});
  assert.equal(plans[0]!.sql, 'INSERT INTO sr_user (id, name) VALUES (?, ?)'); assert.deepEqual(plans[1]!.parameters, ['fixture', local]);
  assert.throws(() => planFixtureRows(MOBILE_TABLES, {production_credentials: [{id: 'fixture'}]}));
  assert.throws(() => planFixtureRows(MOBILE_TABLES, {ps_data_local__local_bookmark_info: [{id: 'fixture', data: 'invalid JSON'}]}));
  assert.deepEqual([...decodeFixtureArtwork('AQIDBA==')], [1, 2, 3, 4]);
});
test('prepared RSS artwork keys cover list, history and reader detail without unsafe paths', () => {
  const route = {method: 'GET', path: '/v1/rss/entries', query: {}, status: 200, delayMs: 0};
  assert.deepEqual(preparedRssCacheKeys([{...route, json: {data: {items: [{id: 'entry-1'}]}}}, {...route, query: {cursor: 'history'}, json: {data: {items: [{id: 'earlier'}]}}}, {...route, path: '/v1/rss/entries/entry-1', json: {data: {id: 'entry-1'}}}]), ['rss-fixture', 'rss-entry-1', 'rss-earlier']);
  assert.throws(() => preparedRssCacheKeys([{...route, json: {data: {items: [{id: '../outside'}]}}}]), /safe synthetic/);
});
