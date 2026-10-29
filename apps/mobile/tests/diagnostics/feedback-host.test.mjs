import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, nativeBoundary, loadComponent, withNativeHost} from '../reader/parity-host.mjs';
import {SlaxApi} from '../../src/data/api.ts';
import {appMessages} from '../../src/i18n/appMessages.ts';
import {mobileColors, mobileTypography} from '../../src/theme/index.ts';

async function fixture(host, screen = 'Feedback', locale = 'en', platform = 'ios') {
  let epoch = 0, mode = 'success', staged = 0, released = 0, flushed = 0, shares = 0, dialog, navigationOptions, back = 0, deferred;
  const listeners = new Set(), requests = [], events = [], files = [], navigations = [];
  const capture = () => {const value = epoch; return () => {if (epoch !== value) throw new Error('Account changed');};};
  const sessions = {captureIdentity: capture, prepareRequest: async () => {}, captureRequestScope() {return {assertCurrent: capture(), getSession: async () => ({token: 'test-token', userId: 'test-user', refreshedAt: 0})};}, getSession: async () => null, clearIfMatches: async () => false,
    getSnapshot: () => ({status: 'authenticated'}), subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);}};
  const api = new SlaxApi({baseUrl: 'https://api.example.org', platform, version: '1.0.25', sessions, fetch: async (_url, init) => {
    requests.push(init);
    if (mode === 'network') throw new Error('network failure');
    if (mode === 'pending') await new Promise(resolve => {deferred = resolve;});
    return new Response(JSON.stringify({code: mode === 'persistence' ? 500 : 200, data: 'ok', message: 'failure'}), {status: 200});
  }});
  const now = new Date(), day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const log = JSON.stringify({v: 1, ts: now.toISOString(), src: 'app', launch: 'abcd1234', event: 'app.launch', app: '1.0.25 (795)', os: 'iOS 26.1'}) + '\n';
  const storage = {shareAvailable: true, list: async () => mode === 'empty' ? [] : [{name: `${day}.app.ndjson`, size: log.length}], read: async () => log, async stage(lines) {
    staged++; if (mode === 'export') throw new Error('File write failed');
    if (mode === 'stage-pending') await new Promise(resolve => {deferred = resolve;});
    const file = new Blob([mode === 'oversized' ? new Uint8Array(12582913) : lines], {type: 'application/x-ndjson'}); files.push(file);
    return {uri: 'file:///cache/slax-diagnostics-test.ndjson', filename: 'slax-diagnostics-test.ndjson', file, release() {released++;}};
  }, async share(file, current) {current(); shares++; assert.equal(JSON.parse((await file.file.text()).trim()).event, 'app.launch');}, export: async () => {}};
  const unexpected = () => {throw new Error('diagnostics must not collect runtime state');};
  const runtime = {sessions, diagnostics: {storage, flush: async () => {flushed++;}}, preferences: {read: unexpected}, getDatabase: unexpected, credentials: {getSnapshot: unexpected}};
  const translator = language => (key, replacements = {}) => Object.entries(replacements).reduce((value, [key, replacement]) => value.replace(`{${key}}`, replacement), appMessages[language][key] ?? key);
  const t = translator(locale);
  const mobile = {api, runtime, t, config: {platform, version: '1.0.25', buildNumber: 794}, repositories: {watchUser(fn) {fn([{email: 'test@example.org'}]); return () => {};}, getBookmark: async () => ({title: 'Article context'})}};
  const telemetry = {firebase: (...args) => events.push(args)};
  const native = {...host.native, Platform: {OS: platform, Version: '26.1', constants: {Release: '17'}}};
  const {ScreenSurface} = await loadComponent('../../src/components/SourceUI.tsx', {react: React, 'react-native': native,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: platform === 'android' ? 48 : 34})}, '../../assets': {mobileAssets: {}}, '../theme': {mobileColors, mobileTypography},
    './source-font-scaling': {}, './AppImage': {AppImage: host.native.Image}, './SourceSheetModal': {}, './SheetBody': {},
  });
  const components = {...host.components, ScreenSurface, SourceDialog: props => {dialog = props; return props.visible ? React.createElement(host.native.View, null, props.children, props.actions) : null;}};
  const module = await loadComponent(`../../src/screens/${screen}Screen.tsx`, {react: React, 'react-native': native, '../components': components, '../runtime': {useMobile: () => mobile}, '../telemetry': {useTelemetry: () => telemetry}, '../theme': {mobileColors, mobileTypography}}, {TextEncoder, Blob});
  const navigation = {setOptions(value) {navigationOptions = value;}, goBack() {back++;}, navigate(...args) {navigations.push(args);}};
  const element = () => React.createElement(module[`${screen}Screen`], {navigation, route: {key: 'feedback', params: {bookmarkId: 'bookmark', entryPoint: 'reader', targetUrl: 'https://example.org/article'}}});
  await host.render(element()); await host.settle();
  return {api, storage, element, requests, files, events, navigations, t, async setLocale(value) {mobile.t = translator(value); await host.render(element());}, setMode(value) {mode = value;}, resolve() {deferred?.();}, replaceAccount() {epoch++; for (const listener of listeners) listener();},
    stats: () => ({staged, released, flushed, shares, back, listeners: listeners.size}), dialog: () => dialog, options: () => navigationOptions,
    async type(value) {await act(async () => host.props.get('feedback_input').onChangeText(value));},
    async press(id) {await act(async () => host.props.get(id).onPress()); await host.settle();},
  };
}

for (const locale of ['en', 'zh']) for (const platform of ['ios', 'android']) test(`mounted ${locale} ${platform} feedback keeps bounded multiline draft and accessible keyboard actions`, nativeBoundary, async () => withNativeHost(async host => {
  const f = await fixture(host, 'Feedback', locale, platform);
  assert.equal(host.props.get('feedback-attach-logs').accessibilityState.checked, false);
  assert.equal(host.props.get('feedback-follow-up').accessibilityState.checked, true);
  assert.equal(host.props.get('feedback_submit').disabled, true);
  const input = host.props.get('feedback_input'); assert.equal(input.multiline, true); assert.equal(input.submitBehavior, 'newline'); assert.ok(input.style.height <= 160);
  assert.equal(host.props.get('feedback-scroll').keyboardShouldPersistTaps, 'handled');
  const surfaceStyle = Object.assign({}, ...host.props.get('feedback_screen').style.filter(Boolean));
  assert.equal(surfaceStyle.paddingBottom, platform === 'android' ? 48 : 34);
  assert.equal(host.props.get('feedback-keyboard-layout').behavior, platform === 'ios' ? 'padding' : 'height');
  await act(async () => host.props.get('feedback-measured-surface').onLayout());
  assert.equal(host.props.get('feedback-keyboard-layout').keyboardVerticalOffset, 200);
  await f.type('first\nsecond'); await act(async () => f.options().headerRight().props.onPress());
  assert.equal(host.dismisses(), 1); assert.equal(host.props.get('feedback_input').value, 'first\nsecond'); assert.equal(f.requests.length, 0);
  assert.match(host.props.get('feedback-attach-logs').accessibilityHint, locale === 'en' ? /anyone.*seven days|seven days.*anyone/ : /七天.*任何人/);
  await f.press('feedback-follow-up'); assert.equal(host.props.get('feedback-attach-logs').accessibilityState.checked, false);
  await f.press('feedback_submit'); assert.equal(f.requests.length, 1); assert.equal(f.stats().staged, 0); assert.equal(f.stats().flushed, 0);
  const body = JSON.parse(f.requests[0].body); assert.equal(body.content, 'first\nsecond'); assert.equal(body.bookmark_uuid, 'bookmark'); assert.equal(body.allow_follow_up, false);
  assert.equal(f.dialog().title, 'feedback_success_title'); assert.equal(host.props.get('feedback_input').value, '');
}));

test('mounted checked feedback retries fresh files, retains consent and draft on every failure, then clears on success', nativeBoundary, async () => withNativeHost(async host => {
  const f = await fixture(host); await f.type('Keep my draft'); await f.press('feedback-attach-logs');
  for (const mode of ['export', 'network', 'persistence']) {
    f.setMode(mode); await f.press('feedback_submit');
    assert.equal(host.props.get('feedback_input').value, 'Keep my draft'); assert.equal(host.props.get('feedback-attach-logs').accessibilityState.checked, true);
    assert.equal(f.dialog().title, 'feedback_error_title'); assert.equal(host.props.get('feedback_submit').disabled, false);
  }
  f.setMode('success'); await f.press('feedback_submit');
  assert.equal(f.stats().staged, 4); assert.equal(f.requests.length, 3); assert.ok(f.requests.every(request => request.body instanceof FormData));
  const form = await new Request('https://api.example.org', f.requests.at(-1)).formData();
  assert.equal(JSON.parse(form.get('report')).attach_diagnostic_log, true);
  const rows = (await form.get('diagnostic_log').text()).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 1); assert.equal(rows[0].event, 'app.launch'); assert.equal(rows[0].sync, undefined);
  assert.equal(f.stats().released, 3); assert.equal(host.props.get('feedback_input').value, ''); assert.equal(host.props.get('feedback-attach-logs').accessibilityState.checked, false);
}));

test('mounted submission is single-flight and cancel aborts without late success', nativeBoundary, async () => withNativeHost(async host => {
  const f = await fixture(host); f.setMode('pending'); await f.type('pending draft'); await f.press('feedback-attach-logs');
  await f.press('feedback_submit'); await f.press('feedback_submit'); assert.equal(f.requests.length, 1); assert.equal(host.props.get('feedback_input').editable, false);
  assert.equal(host.props.get('feedback-attach-logs').disabled, true); await f.press('feedback-cancel'); assert.equal(f.stats().back, 1); assert.equal(f.requests[0].signal.aborted, true);
  f.resolve(); await host.settle(); assert.equal(f.events.length, 0); assert.equal(host.props.get('feedback_input').value, 'pending draft'); assert.equal(f.stats().released, 1);
}));

test('account replacement while preparing logs cancels attachment and preserves checked draft', nativeBoundary, async () => withNativeHost(async host => {
  const f = await fixture(host); f.setMode('stage-pending'); await f.type('owned draft'); await f.press('feedback-attach-logs'); await f.press('feedback_submit');
  await act(async () => f.replaceAccount()); f.resolve(); await host.settle();
  assert.equal(f.requests.length, 0); assert.equal(f.stats().released, 1); assert.equal(host.props.get('feedback_input').value, 'owned draft'); assert.equal(host.props.get('feedback-attach-logs').accessibilityState.checked, true); assert.equal(host.props.get('feedback_submit').disabled, true);
}));

test('unmount cancels pending export and a new feedback draft starts unchecked', nativeBoundary, async () => withNativeHost(async host => {
  const f = await fixture(host); f.setMode('stage-pending'); await f.type('draft'); await f.press('feedback-attach-logs'); await f.press('feedback_submit');
  await host.render(null); f.resolve(); await host.settle(); assert.equal(f.requests.length, 0); assert.equal(f.stats().released, 1); assert.equal(f.stats().listeners, 0);
  await host.render(f.element()); await host.settle(); assert.equal(host.props.get('feedback-attach-logs').accessibilityState.checked, false); assert.equal(host.props.get('feedback_input').value, '');
}));

for (const locale of ['en', 'zh']) test(`empty logs keep ${locale} feedback draft and consent without a fake attachment or upload`, nativeBoundary, async () => withNativeHost(async host => {
  const f = await fixture(host, 'Feedback', locale); f.setMode('empty'); await f.type('Keep my draft'); await f.press('feedback-attach-logs'); await f.press('feedback_submit');
  assert.equal(f.stats().staged, 0); assert.equal(f.requests.length, 0); assert.equal(f.stats().flushed, 1);
  assert.equal(host.props.get('feedback_input').value, 'Keep my draft'); assert.equal(host.props.get('feedback-attach-logs').accessibilityState.checked, true);
  assert.ok(host.window.document.body.textContent.includes(appMessages[locale].feedback_logs_failed)); assert.equal(host.props.get('feedback_submit').disabled, false);
}));
test('oversized attachment preserves draft and only an explicit uncheck permits JSON retry', nativeBoundary, async () => withNativeHost(async host => {
  const f = await fixture(host); await f.type('retained'); await f.press('feedback-attach-logs'); f.setMode('oversized'); await f.press('feedback_submit');
  assert.equal(f.requests.length, 0); assert.equal(f.stats().released, 1); assert.equal(host.props.get('feedback-attach-logs').accessibilityState.checked, true); assert.equal(host.props.get('feedback_input').value, 'retained');
  assert.match(host.window.document.body.textContent, /12 MiB/);
  await f.press('feedback-attach-logs'); f.setMode('success'); await f.press('feedback_submit');
  assert.equal(f.stats().staged, 1); assert.equal(typeof f.requests[0].body, 'string'); assert.equal(JSON.parse(f.requests[0].body).attach_diagnostic_log, undefined);
}));
test('account replacement during upload aborts transport and suppresses stale acknowledgement', nativeBoundary, async () => withNativeHost(async host => {
  const f = await fixture(host); await f.type('owned'); await f.press('feedback-attach-logs'); f.setMode('pending'); await f.press('feedback_submit');
  await act(async () => f.replaceAccount()); assert.equal(f.requests[0].signal.aborted, true); f.resolve(); await host.settle();
  assert.equal(f.events.length, 0); assert.equal(f.stats().released, 1); assert.equal(host.props.get('feedback_input').value, 'owned'); assert.equal(host.props.get('feedback_submit').disabled, true);
}));
for (const outcome of ['success', 'persistence', 'account']) test(`locale replacement during feedback upload preserves ownership and handles ${outcome}`, nativeBoundary, async () => withNativeHost(async host => {
  const f = await fixture(host); await f.type('owned draft'); await f.press('feedback-attach-logs'); f.setMode('pending'); await f.press('feedback_submit');
  const signal = f.requests[0].signal; await f.setLocale('zh');
  assert.equal(signal.aborted, false); assert.equal(f.requests.length, 1); assert.equal(f.stats().listeners, 1);
  assert.equal(host.props.get('feedback_submit').disabled, true); assert.equal(host.props.get('feedback_input').value, 'owned draft');
  assert.equal(host.props.get('feedback-attach-logs').accessibilityState.checked, true);
  if (outcome === 'account') await act(async () => f.replaceAccount()); else f.setMode(outcome);
  f.resolve(); await host.settle();
  if (outcome === 'success') {assert.equal(f.events.length, 1); assert.equal(host.props.get('feedback_input').value, '');}
  else {
    assert.equal(host.props.get('feedback_input').value, 'owned draft'); assert.equal(f.events.length, 0);
    assert.equal(f.dialog().children.props.children.includes(appMessages.zh[outcome === 'account' ? 'feedback_owner_changed' : 'feedback_logs_failed']), true);
    assert.equal(f.dialog().children.props.children.includes('未发送当前反馈'), false);
  }
}));
