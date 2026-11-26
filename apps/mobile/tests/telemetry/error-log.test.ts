import test from 'node:test';
import assert from 'node:assert/strict';
import {createMobileErrorLog} from '../../src/telemetry/errorLog.ts';
import {PreferenceStore, type PreferenceValues} from '../../src/data/preferences.ts';
import {SessionController} from '../../src/domain/session.ts';
import {MemoryPreferences} from '../data/helpers.ts';

async function setup(endpoint: string | undefined, values: PreferenceValues = {auth_token: 'token', user_id: '42', analytics_device_id: 'device-1'}, pageUrl?: () => string | undefined) {
  const preferences = new PreferenceStore(new MemoryPreferences(values));
  const sessions = new SessionController(preferences, {leave: async () => {}, enter: async () => {}});
  await sessions.restore();
  const bodies: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {bodies.push(String(init.body)); return new Response(null, {status: 204});}) as typeof fetch;
  let screen: string | undefined = 'Reader';
  let ready!: () => void;
  const preferencesReady = new Promise<void>(resolve => {ready = resolve;});
  const log = createMobileErrorLog({endpoint, platform: 'android', version: '1.0.34', buildNumber: '809', env: () => 'production', preferences, sessions, screen: () => screen, pageUrl, generateIdentifier: () => 'generated', preferencesReady});
  await new Promise(resolve => setImmediate(resolve));
  const beforeReady = (await preferences.read()).analytics_device_id;
  ready();
  await new Promise(resolve => setImmediate(resolve));
  const records = () => bodies.flatMap(body => JSON.parse(body));
  return {log, bodies, records, beforeReady, setScreen: (value: string | undefined) => {screen = value;}, restore: () => {globalThis.fetch = original;}};
}

test('an empty ingestion endpoint sends nothing and capture never throws', async context => {
  const f = await setup(''); context.after(f.restore);
  assert.equal(f.log.capture('error', new Error('boom')), undefined);
  assert.equal(f.log.capture('powersync', undefined), undefined);
  await f.log.flush(true);
  assert.deepEqual(f.bodies, []);
});

test('a Mobile record carries the build release, numeric user, device and screen, and no page URL before navigation', async context => {
  const f = await setup('https://ingest.example'); context.after(f.restore);
  const fingerprint = f.log.capture('network', Object.assign(new Error('POST /v1/bookmarks failed (500)'), {name: 'ApiRequestError'}), {source: 'api', status: 500, ray: 'abc-SIN'});
  assert.match(fingerprint ?? '', /\S/);
  await f.log.flush(true);
  const [record] = f.records();
  assert.equal(record.app, 'android');
  assert.equal(record.env, 'production');
  assert.equal(record.release, '1.0.34+809');
  assert.equal(record.user_id, '42');
  assert.equal(record.device_id, 'device-1');
  assert.equal(record.kind, 'network');
  assert.equal(record.fingerprint, fingerprint);
  assert.equal(record.page_url, undefined);
  assert.equal(record.properties.screen, 'Reader');
  assert.equal(record.properties.ray, 'abc-SIN');
});

test('a non-numeric user id is omitted and a missing screen adds no property', async context => {
  const f = await setup('https://ingest.example', {auth_token: 'token', user_id: 'legacy-account', analytics_device_id: 'device-1'}); context.after(f.restore);
  f.setScreen(undefined);
  f.log.capture('error', new Error('boom'));
  await f.log.flush(true);
  const [record] = f.records();
  assert.equal(record.user_id, undefined);
  assert.equal(record.properties?.screen, undefined);
});

test('a device id outside the admission pattern is left out so the record is kept', async context => {
  const f = await setup('https://ingest.example', {auth_token: 'token', user_id: '42', analytics_device_id: 'legacy.device:id'}); context.after(f.restore);
  f.log.capture('error', new Error('boom'));
  await f.log.flush(true);
  const [record] = f.records();
  assert.equal(record.device_id, undefined);
  assert.equal(record.user_id, '42');
});

test('the device id is not created before legacy preferences are migrated', async context => {
  const f = await setup('https://ingest.example', {auth_token: 'token', user_id: '42'}); context.after(f.restore);
  assert.equal(f.beforeReady, undefined);
});

test('a Mobile record carries the slaxreader:// page address of the current route', async context => {
  const {pageAddress} = await import('../../src/telemetry/screen.ts');
  assert.equal(pageAddress('Reader', {bookmarkId: 'b-12345', title: 'Secret title'}), 'slaxreader://reader/b-12345');
  assert.equal(pageAddress('DeleteAccount', undefined), 'slaxreader://delete-account');
  assert.equal(pageAddress('Reader', {bookmarkId: 'bad id/../x'}), 'slaxreader://reader');
  assert.equal(pageAddress(undefined), undefined);
  const page = {url: 'slaxreader://reader/b-12345'};
  const f = await setup('https://ingest.example', undefined, () => page.url); context.after(f.restore);
  f.log.capture('error', new Error('boom'));
  f.log.telemetry('powersync_phase', {phase: 'token', outcome: 'success', duration_ms: 42}, 'token success');
  await f.log.flush(true);
  const records = f.records();
  assert.deepEqual(records.map(record => record.page_url), ['slaxreader://reader/b-12345', 'slaxreader://reader/b-12345']);
  const telemetry = records.find(record => record.kind === 'telemetry');
  assert.equal(telemetry.message, 'powersync_phase token success');
  assert.equal(telemetry.properties.duration_ms, 42);
  assert.equal(telemetry.properties.screen, 'Reader');
  assert.equal(telemetry.user_id, '42');
});
