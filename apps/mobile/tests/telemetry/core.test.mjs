import test from 'node:test';
import assert from 'node:assert/strict';
import {createMobileTelemetry} from '../../src/telemetry/core.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {SessionController} from '../../src/domain/session.ts';
import {SlaxApi} from '../../src/data/api.ts';
import {MemoryPreferences} from '../data/helpers.ts';

function setup({platform = 'ios', firebaseFailure = false, apiFailure = false} = {}) {
  const calls = []; let locale = 'en'; let generated = 0;
  let snapshot = {revision: 0, values: {analytics_device_id: 'existing-source-device-id'}};
  const preferences = new PreferenceStore({read: async () => structuredClone(snapshot), compareAndSwap: async (revision, values) => {if (revision !== snapshot.revision) return false; snapshot = {revision: revision + 1, values}; return true;}});
  const telemetry = createMobileTelemetry({preferences, platform, version: '1.2.3 (45)', locale: () => locale, generateIdentifier: () => {generated++; return 'new-device';}, now: () => new Date('2026-10-10T08:00:00.123Z'),
    api: {sendClientEvents: async (deviceId, events) => {calls.push(['first-party', deviceId, events]); if (apiFailure) throw new Error('offline');}},
    firebase: {logEvent: async (name, params) => {calls.push(['firebase', name, params]); if (firebaseFailure) throw new Error('Firebase unavailable');}, setUserId: async id => {calls.push(['identity', id]); if (firebaseFailure) throw new Error('Firebase unavailable');}, setCrashlyticsUserId: async id => {calls.push(['crash-identity', id]);}, setUserProperty: async (name, value) => {calls.push(['property', name, value]);}},
  });
  return {telemetry, calls, setLocale: value => {locale = value;}, generated: () => generated};
}
test('preserves persisted source device ID, exact first-party payload and live locale', async () => {
  const fixture = setup(); fixture.telemetry.track('bookmark_opened', {bookmark_id: 'uuid', opened_from: 'bookmarks'}); fixture.setLocale('zh'); fixture.telemetry.element('detail_toolbar_open', 'detail'); await fixture.telemetry.flush();
  assert.equal(fixture.generated(), 0);
  assert.deepEqual(fixture.calls[0], ['first-party', 'existing-source-device-id', [{event_name: 'bookmark_opened', occurred_at: '2026-10-10T08:00:00.123Z', properties: {platform: 'ios', locale: 'en', client_version: '1.2.3 (45)', bookmark_id: 'uuid', opened_from: 'bookmarks'}}]]);
  assert.equal(fixture.calls[1][2][0].properties.locale, 'zh');
});
test('Firebase source event IDs, boolean params and protected platform/version fields survive', async () => {
  const {telemetry, calls} = setup({platform: 'android'}); telemetry.firebase('bookmark', 'use_outline', {is_subscribed: false, version: 'override', platform: 'web'}); telemetry.firebase('outline', 'interact', {}, 'expand'); telemetry.track('  '); await telemetry.flush();
  assert.deepEqual(calls, [['firebase', 'bookmark_use_outline', {is_subscribed: false, version: '1.2.3 (45)', platform: 'app', platform_type: 'android'}], ['firebase', 'outline_interact_expand', {platform: 'app', version: '1.2.3 (45)', platform_type: 'android'}]]);
});
test('manual source screen mapping includes bookmark context and omits RSS and Debug', async () => {
  const {telemetry, calls} = setup(); telemetry.screen('Reader', {bookmarkId: 'b', openedFrom: 'continue_reading'}); telemetry.screen('Reader', {bookmarkId: 'saved', rssEntryId: 'rss-entry'}); telemetry.screen('Debug'); telemetry.screen('DeleteAccount'); await telemetry.flush();
  assert.equal(calls.length, 4); assert.equal(calls[0][1], 'bookmark_view'); assert.deepEqual(calls[0][2], {bookmark_uuid: 'b', mode: 'snapshot', platform: 'app', version: '1.2.3 (45)', platform_type: 'ios'}); assert.equal(calls.find(call => call[0] === 'first-party' && call[2][0].event_name === 'bookmark_opened')[2][0].properties.opened_from, 'continue_reading'); assert.ok(calls.some(call => call[1] === 'user_view_delete_account'));
});
test('source page IDs match all remaining navigation screens', async () => {
  const {telemetry, calls} = setup(); ['Login', 'Library', 'Settings', 'About', 'Subscription', 'Feedback'].forEach(route => telemetry.screen(route)); await telemetry.flush();
  assert.deepEqual(calls.filter(call => call[0] === 'firebase').map(call => call[1]), ['user_view_login', 'bookmark_list_view', 'setting_view', 'about_view', 'subscription_view', 'feedback_view']);
  assert.deepEqual(calls.filter(call => call[0] === 'first-party').map(call => call[2][0].properties.screen_name), ['signup', 'settings', 'about', 'subscription', 'feedback']);
});
test('identity and collector failures are independent and never reject callers', async () => {
  const {telemetry, calls} = setup({firebaseFailure: true, apiFailure: true}); telemetry.identify('user'); telemetry.identify(null); telemetry.firebase('bookmark', 'share'); telemetry.element('detail_share_button', 'detail'); await telemetry.flush();
  assert.deepEqual(calls.filter(call => call[0].includes('identity')), [['identity', 'user'], ['crash-identity', 'user'], ['identity', null], ['crash-identity', null]]); assert.equal(calls.filter(call => call[0] === 'first-party').length, 1);
});
test('held analytics identity lookup cannot send an old event with a fresh session', async t => {
  for (const sameCredentials of [false, true]) await t.test(sameCredentials ? 'same-user same-token relogin' : 'different account', async () => {
    const preferences = new PreferenceStore(new MemoryPreferences());
    const sessions = new SessionController(preferences, {leave: async () => {}, enter: async () => {}});
    await sessions.accept('fixture-token-a', 'fixture-user-a');
    const sends = [];
    const api = new SlaxApi({baseUrl: 'https://fixture.slax.invalid', platform: 'android', version: 'fixture', sessions, fetch: async (_url, init) => {
      sends.push({authorization: init.headers.Authorization, events: JSON.parse(init.body).events});
      return new Response(null, {status: 204});
    }});
    let releaseLookup, markStarted;
    const started = new Promise(resolve => {markStarted = resolve;});
    const held = new Promise(resolve => {releaseLookup = resolve;});
    let holdFirst = true;
    const telemetry = createMobileTelemetry({platform: 'android', version: 'fixture', locale: () => 'en', generateIdentifier: () => 'fixture-device', api,
      captureRequestScope: () => sessions.captureRequestScope(),
      preferences: {deviceId: async () => {if (holdFirst) {holdFirst = false; markStarted(); await held;} return preferences.deviceId(() => 'fixture-device');}},
    });
    telemetry.track('bookmark_opened', {bookmark_id: 'old-owner-bookmark'});
    await started;
    await sessions.accept(sameCredentials ? 'fixture-token-a' : 'fixture-token-b', sameCredentials ? 'fixture-user-a' : 'fixture-user-b');
    releaseLookup();
    await telemetry.flush();
    assert.equal(sends.length, 0);
    telemetry.track('bookmark_opened', {bookmark_id: 'fresh-owner-bookmark'});
    await telemetry.flush();
    assert.equal(sends.length, 1);
    assert.equal(sends[0].events[0].properties.bookmark_id, 'fresh-owner-bookmark');
    assert.equal(sends[0].authorization, `Bearer ${sameCredentials ? 'fixture-token-a' : 'fixture-token-b'}`);
    assert.equal((await preferences.read()).analytics_device_id, 'fixture-device');
  });
});
