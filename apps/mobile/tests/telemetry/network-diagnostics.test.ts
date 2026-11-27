import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetworkDiagnostics, networkDiagnosticEligible, type NetworkDiagnosticFamily} from '../../src/domain/network-diagnostics.ts';
import type {MobileErrorLog} from '../../src/domain/error-log.ts';

const settle = () => new Promise(resolve => setImmediate(resolve));
function setup({online = true, probe = async (host: string) => ({dns: {system: {ms: 12, v4: 2, v6: 2}}, tcp: {v4: {ok: true, ms: 40}, v6: {ok: false, ms: 3000, error: 'timeout'}}, network: {transport: 'wifi', vpn: false}, host})}: {online?: boolean; probe?: (host: string) => Promise<Record<string, unknown>>} = {}) {
  const captured: {kind: string; error: Error; properties: Record<string, unknown>}[] = [], probed: string[] = [];
  const state = {online};
  const errorLog: MobileErrorLog = {capture: (kind, error, properties = {}) => {captured.push({kind, error: error as Error, properties}); return 'fingerprint';}, telemetry: () => {}, flush: async () => {}};
  const timers: (() => void)[] = [];
  const diagnostics = createNetworkDiagnostics({errorLog: () => errorLog, online: () => state.online, probe: host => {probed.push(host); return probe(host);},
    setTimeout: callback => {timers.push(callback); return timers.length;}, clearTimeout: () => {}});
  return {diagnostics, captured, probed, state, timers};
}

test('twenty image failures in one process record exactly one image diagnostic', async () => {
  const f = setup();
  for (let index = 0; index < 20; index++) f.diagnostics.report('image', {host: 'api-reader.slax.com', errorClass: 'SocketTimeoutException', timeout: true});
  await settle(); await settle();
  assert.equal(f.captured.length, 1);
  assert.deepEqual(f.probed, ['api-reader.slax.com'], 'A probe already running absorbs later failures');
  const [record] = f.captured;
  assert.equal(record!.kind, 'network');
  assert.equal(record!.error.name, 'NetworkDiagnostic');
  assert.equal(record!.properties.source, 'network_diagnostic');
  assert.equal(record!.properties.family, 'image');
  assert.equal(record!.properties.host, 'api-reader.slax.com');
  assert.deepEqual(record!.properties.failure, {error: 'SocketTimeoutException', timeout: true});
  assert.deepEqual((record!.properties.tcp as Record<string, unknown>).v6, {ok: false, ms: 3000, error: 'timeout'});
});

test('each failure family records its own diagnostic once', async () => {
  const f = setup();
  const families: NetworkDiagnosticFamily[] = ['image', 'content', 'powersync', 'image', 'content', 'powersync'];
  for (const family of families) f.diagnostics.report(family, {host: family === 'powersync' ? 'sync.slax.com' : 'api-reader.slax.com', status: 502});
  await settle(); await settle();
  assert.deepEqual(f.captured.map(record => record.properties.family), ['image', 'content', 'powersync']);
  assert.deepEqual(f.captured.map(record => record.properties.failure), [{status: 502}, {status: 502}, {status: 502}]);
});

test('an offline failure neither records nor consumes the family; a later online failure records', async () => {
  const f = setup({online: false});
  f.diagnostics.report('image', {host: 'api-reader.slax.com'});
  await settle();
  assert.equal(f.captured.length, 0); assert.equal(f.probed.length, 0);
  f.state.online = true;
  f.diagnostics.report('image', {host: 'api-reader.slax.com'});
  await settle(); await settle();
  assert.equal(f.captured.length, 1);
});

test('cancellations and client errors other than 408 and 429 do not record or consume the family', async () => {
  assert.equal(networkDiagnosticEligible({host: 'h', cancelled: true}), false);
  assert.equal(networkDiagnosticEligible({host: 'h', status: 401}), false);
  assert.equal(networkDiagnosticEligible({host: 'h', status: 404}), false);
  assert.equal(networkDiagnosticEligible({host: 'h', status: 408}), true);
  assert.equal(networkDiagnosticEligible({host: 'h', status: 429}), true);
  assert.equal(networkDiagnosticEligible({host: 'h', status: 503}), true);
  assert.equal(networkDiagnosticEligible({host: 'h'}), true);
  const f = setup();
  f.diagnostics.report('content', {host: 'api-reader.slax.com', status: 404});
  f.diagnostics.report('content', {host: 'api-reader.slax.com', cancelled: true});
  await settle();
  assert.equal(f.captured.length, 0);
  f.diagnostics.report('content', {host: 'api-reader.slax.com', errorClass: 'DataTransportError'});
  await settle(); await settle();
  assert.equal(f.captured.length, 1);
});

test('a new collector, as in a relaunched process, records again', async () => {
  const first = setup(); first.diagnostics.report('image', {host: 'api-reader.slax.com'}); await settle(); await settle();
  const second = setup(); second.diagnostics.report('image', {host: 'api-reader.slax.com'}); await settle(); await settle();
  assert.equal(first.captured.length, 1); assert.equal(second.captured.length, 1);
});

test('a failing or hanging probe still records once with what it has and never throws to the caller', async () => {
  const failing = setup({probe: async () => {throw Object.assign(new Error('Unsupported diagnostic host'), {name: 'CodedError'});}});
  assert.doesNotThrow(() => failing.diagnostics.report('powersync', {host: 'sync.slax.com'}));
  await settle(); await settle();
  assert.equal(failing.captured.length, 1);
  assert.equal(failing.captured[0]!.properties.probe_error, 'CodedError');
  failing.diagnostics.report('powersync', {host: 'sync.slax.com'}); await settle();
  assert.equal(failing.captured.length, 1, 'A failed probe still uses the family\'s single record');

  const hanging = setup({probe: () => new Promise(() => {})});
  hanging.diagnostics.report('image', {host: 'api-reader.slax.com'});
  await settle();
  assert.equal(hanging.captured.length, 0);
  hanging.timers.forEach(callback => callback());
  assert.equal(hanging.captured.length, 1);
  assert.equal(hanging.captured[0]!.properties.probe_error, 'timeout');

  const throwingLog = createNetworkDiagnostics({errorLog: () => {throw new Error('collector unavailable');}, online: () => true, probe: async () => ({})});
  assert.doesNotThrow(() => throwingLog.report('image', {host: 'api-reader.slax.com'}));
  await settle(); await settle();
});

test('recorded properties hold no addresses, URLs, tokens or unbounded error text', async () => {
  const f = setup({probe: async () => ({dns: {system: {ms: 5, v4: 1, v6: 0}, public: {ms: 9, v4: 1}}, tcp: {v4: {ok: true, ms: 33}}, network: {transport: 'cellular', vpn: true, private_dns: 'strict', ipv6_route: false}})});
  f.diagnostics.report('content', {host: 'API-Reader.slax.com.', status: 503, errorClass: 'https://evil.example/?token=secret'});
  f.diagnostics.report('image', {host: 'https://not-a-host/path'});
  await settle(); await settle();
  assert.equal(f.captured.length, 1, 'A non-host value is ignored instead of probed');
  const serialized = JSON.stringify(f.captured[0]!.properties);
  assert.equal(f.captured[0]!.properties.host, 'api-reader.slax.com');
  assert.deepEqual(f.captured[0]!.properties.failure, {status: 503}, 'An error class that is not a bounded identifier is dropped');
  assert.doesNotMatch(serialized, /\d+\.\d+\.\d+\.\d+|token|secret|https?:/);
});
