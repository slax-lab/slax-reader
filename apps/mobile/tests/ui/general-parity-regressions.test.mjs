import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React, {act} from 'react';
import {observeRelativeBoundaries} from '../reader/observe-mock.mjs';
import * as sourceUrls from '../../src/utils/source-url.ts';

const require = createRequire(import.meta.url);
const domPath = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});
async function load(file, boundaries = {}, globals = {}) {
  const passthrough = ({children}) => children ?? null;
  const drawer = {SourceDrawer: passthrough};
  boundaries = {'./SourceDrawer': drawer, '../components/SourceDrawer': drawer, '../components/SearchGlyph': {SearchGlyph: () => null}, '../utils/source-url': sourceUrls,
    ...observeRelativeBoundaries(boundaries), ...boundaries};
  if (file.endsWith('/LinkInputDialog.tsx')) {
    boundaries['@slax-reader/contracts/rss'] = await load('../../../../packages/contracts/src/rss.ts', {}, {URL});
    boundaries['../pdf/usePdfImportSession'] = await load('../../src/pdf/usePdfImportSession.ts', {
      react: React, 'react-native': {...boundaries['react-native'], AppState: {currentState: 'active', addEventListener: () => ({remove() {}})}},
      '../runtime': boundaries['../runtime'], '@slax-reader/contracts/pdf': await load('../../../../packages/contracts/src/pdf.ts'),
      'expo-file-system': {File: class {constructor() {assert.fail('No file IO without an explicit PDF action');}}},
      '../native/pdf-import': {pickPdf() {assert.fail('No automatic picker in acquisition or title editing');}, removePickedPdf() {assert.fail('No temporary file exists in this fixture');}},
    }, {AbortController});
  }
  const code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, __DEV__: false, setTimeout, clearTimeout, setInterval, clearInterval, ...globals, require: name => {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}});
  return exports;
}
const theme = await load('../../src/theme/index.ts');
const time = await load('../../src/utils/source-time.ts');
async function mounted(run) {
  const {Window} = await import(pathToFileURL(domPath).href);
  const window = new Window(), names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true});
  const {createRoot} = await import('react-dom/client');
  const root = createRoot(window.document.body.appendChild(window.document.createElement('div')));
  try {await run(root);} finally {
    await act(async () => root.unmount()); window.close();
    for (const name of names) {const old = previous.get(name); if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name];}
  }
}
const flat = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const text = value => Array.isArray(value) ? value.map(text).join('') : React.isValidElement(value) ? text(value.props.children) : value ?? '';
function views() {
  const nodes = new Map();
  const native = (name, visible = false) => React.forwardRef((props, ref) => {
    const key = React.useRef(Symbol(name)).current;
    React.useLayoutEffect(() => {nodes.set(key, {name, props, key}); return () => nodes.delete(key);});
    React.useImperativeHandle(ref, () => ({focus() {}, blur() {}, scrollToOffset() {}, measureInWindow(callback) {callback(0, 0, 300, 40);}}), []);
    return React.createElement('div', null, visible && !props.visible ? null : name === 'FlatList' ? [props.ListHeaderComponent, props.children] : props.children);
  });
  const primitives = Object.fromEntries(['View', 'Text', 'Pressable', 'TextInput', 'Image', 'ScrollView', 'ActivityIndicator', 'FlatList', 'AppImage'].map(name => [name, native(name)]));
  const ui = Object.fromEntries(['SourceText', 'SourceButton', 'SourceIcon', 'TextAction', 'Divider', 'SourceProgress'].map(name => [name, native(name)]));
  return {nodes, native, primitives: {...primitives, Modal: native('Modal', true)}, ui: {...ui, SourceDialog: native('SourceDialog', true), SourceSheet: native('SourceSheet', true)}, all: name => [...nodes.values()].filter(node => node.name === name).map(node => node.props), one: (name, predicate = () => true) => {const matches = [...nodes.values()].filter(node => node.name === name && predicate(node.props)); assert.equal(matches.length, 1, `${name}: expected one node, got ${matches.length}`); return matches[0].props;}};
}
const nil = () => null;
const telemetry = {track() {}, element() {}, firebase() {}, identify() {}, screen() {}};

test('source timestamps use UTC fallback in every host timezone and retain explicit offsets and subsecond precision', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      for (const value of ['2026-10-11T12:30:45', '2026-10-11t12:30:45', '2026-10-11 12:30:45', '2026-10-11T12:30:45Z', '2026-10-11t12:30:45z']) assert.equal(time.parseSourceTimestamp(value), Date.UTC(2026, 9, 11, 12, 30, 45), `${zone} ${value}`);
      assert.equal(time.parseSourceTimestamp('2026-10-11 12:30'), Date.UTC(2026, 9, 11, 12, 30));
      assert.equal(time.parseSourceTimestamp('2026-10-11T12:30.123456789'), Date.UTC(2026, 9, 11, 12, 30, 0, 123));
      assert.equal(time.parseSourceTimestamp('2026-10-11 12:30:45.987654321+08:00'), Date.UTC(2026, 9, 11, 4, 30, 45, 987));
      assert.equal(time.parseSourceTimestamp('2026-10-11t12:30-05:30:15'), Date.UTC(2026, 9, 11, 18, 0, 15));
      assert.equal(time.parseSourceTimestamp('0099-02-28T00:00:00Z'), Date.parse('0099-02-28T00:00:00Z'));
      assert.equal(time.parseSourceTimestamp('2024-02-29T00:00:00+18:00'), Date.UTC(2024, 1, 28, 6));
      assert.equal(time.parseSourceTimestamp('1969-12-31T23:59:59.999999999Z'), -1);
      assert.equal(time.parseSourceTimestamp('2026-10-11T12:30:45+08'), Date.UTC(2026, 9, 11, 4, 30, 45));
      assert.equal(time.parseSourceTimestamp('2026-10-11T12:30:45-00:00:30'), Date.UTC(2026, 9, 11, 12, 31, 15));
      assert.equal(time.parseSourceTimestamp('+12026-10-11T00:00:00Z'), Date.parse('+012026-10-11T00:00:00Z'));
      assert.equal(time.parseSourceTimestamp('-0001-10-11T00:00:00Z'), Date.parse('-000001-10-11T00:00:00Z'));
      for (const value of ['', ' ', '2026-10-11', '2026-02-29T00:00:00Z', '2026-04-31 12:00', '2026-01-00 12:00', '2026-13-01 12:00', '2026-10-11T25:00Z', '2026-10-11T12:60Z', '2026-10-11T12:30:61Z', '2026-10-11T12:30+18:01', '2026-10-11T12:30+08:60', ' 2026-10-11T12:30Z', '2026-10-11T12:30Z ', '2026-10-11T12:30Z\n', 'not-a-timestamp']) assert.ok(Number.isNaN(time.parseSourceTimestamp(value)), `${zone} rejects ${value}`);
    }
  } finally {if (original === undefined) delete process.env.TZ; else process.env.TZ = original;}
});

for (const platform of ['android', 'ios']) test(`mounted ${platform} Login preserves dismiss/disagree distinction, pending provider and shared WebView identity`, async () => mounted(async root => {
  const v = views(), authentication = [], sessions = [];
  let height = 800;
  const WebView = v.native('WebView');
  const sessionState = {status: 'unauthenticated'};
  const mobile = {t: value => value, config: {webUrl: 'https://example.test'}, api: {login: async request => ({token: request.provider, user_id: 'one'}), emailLoginStatus: async () => ({enabled: false})}, sessions: {getSnapshot: () => sessionState, captureIdentity: () => () => {}, accept: async (token, userId, onStarted) => {onStarted?.(() => {}); sessions.push([token, userId]);}}};
  const {LoginScreen} = await load('../../src/screens/LoginScreen.tsx', {
    react: React, 'react-native': {...v.primitives, Alert: {alert() {}}, Platform: {OS: platform}, StyleSheet: {create: value => value, absoluteFill: {}}, useWindowDimensions: () => ({width: 375, height})},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 44, bottom: 34})}, 'react-native-webview': {WebView}, '../../assets': {mobileAssets: {}}, '../auth/providers': {authenticate: async provider => {authentication.push(provider); return {provider};}},
    '../runtime': {useMobile: () => mobile}, '../theme': theme, '../theme/testIds': {mobileTestIds: {}}, '../telemetry': {useTelemetry: () => telemetry}, '../native/fixture-document': {}, '../components/fixture-actions': {}, '../auth/login': await load('../../src/auth/login.ts', {'../domain/diagnostics.ts': await load('../../src/domain/diagnostics.ts')}),
    '../auth/EmailCodeDialog': {EmailCodeDialog: () => null}, '../auth/email-auth-errors': await load('../../src/auth/email-auth-errors.ts'),
    '../native/passkeys': {nativePasskeys: {isSupported: () => false}},
    '../auth/useEmailLogin': await load('../../src/auth/useEmailLogin.ts', {react: React, './passkeys': await load('../../src/auth/passkeys.ts')}),
  }, {AbortController});
  const render = () => root.render(React.createElement(LoginScreen));
  const press = predicate => act(async () => v.one('Pressable', predicate).onPress());
  const provider = name => press(props => props.accessibilityLabel === `login_${name}`);
  const action = name => press(props => text(props.children) === `agreement_btn_${name}`);
  const link = name => act(async () => v.one('Text', props => props.accessibilityRole === 'link' && text(props.children) === `agreement_${name}`).onPress());
  const checked = () => v.one('Pressable', props => props.accessibilityRole === 'checkbox').accessibilityState.checked;
  await act(async () => render());
  await provider(platform === 'ios' ? 'apple' : 'google');
  assert.deepEqual(authentication, []);
  assert.equal(v.one('WebView').source.uri, `https://example.test/${platform === 'ios' ? 'privacy' : 'terms'}`);
  const firstWebView = [...v.nodes.values()].find(node => node.name === 'WebView').key;
  const tabs = v.all('Pressable').filter(props => props.accessibilityRole === 'tab');
  assert.ok(tabs.every(props => flat(props.style).alignItems === 'center'));
  const sheet = v.one('View', props => props.accessibilityViewIsModal);
  assert.equal(flat(sheet.style).paddingHorizontal, 24); assert.equal(flat(sheet.style).paddingTop, 24);
  assert.equal(flat(sheet.style).height, 640);
  assert.equal(flat(v.one('WebView').containerStyle).height, (640 - 24 - 40 - 9) * 0.7);
  assert.equal(flat(v.one('WebView').containerStyle).flex, 0);
  assert.equal(flat(v.one('Pressable', props => text(props.children) === 'agreement_btn_agree').style).marginHorizontal, 16);
  await act(async () => tabs.find(props => !props.accessibilityState.selected).onPress());
  assert.equal([...v.nodes.values()].find(node => node.name === 'WebView').key, firstWebView, 'Switching source URL does not reconstruct the native WebView');
  await act(async () => v.one('Modal').onRequestClose());
  await link('user_agreement'); await action('agree');
  assert.equal(checked(), true); assert.deepEqual(authentication, [], 'Ordinary dismissal canceled the pending sign-in');
  await link('privacy_policy'); await act(async () => v.one('Modal').onRequestClose()); assert.equal(checked(), true);
  await link('user_agreement'); await action('disagree'); assert.equal(checked(), false);
  await provider('google'); await action('disagree');
  await link('user_agreement'); await action('agree'); assert.deepEqual(authentication, [], 'Disagree also canceled the pending sign-in');
  if (platform === 'ios') await act(async () => v.one('Modal').onDismiss());
  await press(props => props.accessibilityRole === 'checkbox');
  await provider('google'); await action('agree');
  if (platform === 'ios') {assert.deepEqual(authentication, []); await act(async () => v.one('Modal').onDismiss());}
  assert.deepEqual(authentication, ['google']); assert.deepEqual(sessions, [['google', 'one']]);
  height = 1000; await link('user_agreement'); await act(async () => render());
  assert.equal(flat(v.one('WebView').containerStyle).height, (800 - 24 - 40 - 9) * 0.7);
}));

test('mounted title editor rejects whitespace via confirm and IME without dismissing, then trims a valid edit', async () => mounted(async root => {
  const v = views(), submitted = []; let dismissals = 0, visible = true;
  const {LinkInputDialog} = await load('../../src/components/LinkInputDialog.tsx', {
    react: React, 'react-native': {...v.primitives, Platform: {OS: 'ios'}, StyleSheet: {create: value => value}}, 'expo-clipboard': {getStringAsync: async () => ''}, '../runtime': {useMobile: () => ({t: value => value})}, '../theme': theme, '../theme/testIds': {mobileTestIds: {}}, './SourceUI': v.ui,
  });
  await act(async () => root.render(React.createElement(LinkInputDialog, {visible, initialTitle: 'Initial', onSubmit: value => submitted.push(value), onDismiss: () => {dismissals++; visible = false;}})));
  for (const whitespace of ['', '  \t\n ', '\u3000']) {
    await act(async () => v.one('TextInput').onChangeText(whitespace));
    await act(async () => v.one('SourceButton').onPress());
    await act(async () => v.one('TextInput').onSubmitEditing());
    assert.deepEqual(submitted, []); assert.equal(dismissals, 0); assert.equal(visible, true);
  }
  await act(async () => v.one('TextInput').onChangeText('  Edited 标题  '));
  await act(async () => v.one('TextInput').onSubmitEditing());
  assert.deepEqual(submitted, ['Edited 标题']); assert.equal(dismissals, 1);
}));

test('add-link silently ignores unrelated clipboard text and never overwrites typing with a late clipboard result', async () => mounted(async root => {
  const v = views(), submitted = []; let clipboard = Promise.resolve('Plain text without a link'), resolveClipboard;
  const {LinkInputDialog} = await load('../../src/components/LinkInputDialog.tsx', {
    react: React, 'react-native': {...v.primitives, Platform: {OS: 'ios'}, StyleSheet: {create: value => value}}, 'expo-clipboard': {getStringAsync: () => clipboard}, '../runtime': {useMobile: () => ({t: value => value})}, '../theme': theme, '../theme/testIds': {mobileTestIds: {AddLinkError: 'clipboard-error'}}, './SourceUI': v.ui,
  });
  const render = visible => root.render(React.createElement(LinkInputDialog, {visible, onSubmit: value => submitted.push(value), onDismiss() {}}));
  await act(async () => render(true)); await act(async () => {await new Promise(resolve => setTimeout(resolve, 370));});
  assert.equal(v.one('TextInput').value, ''); assert.equal(v.all('SourceText').some(node => node.testID === 'clipboard-error'), false);
  await act(async () => v.one('SourceButton').onPress()); assert.equal(v.one('SourceText', node => node.testID === 'clipboard-error').children, 'add_link_error_invalid_url');
  await act(async () => render(false)); clipboard = new Promise(resolve => {resolveClipboard = resolve;}); await act(async () => render(true));
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 370));});
  await act(async () => v.one('TextInput').onChangeText('https://typed.test/first'));
  await act(async () => resolveClipboard('https://clipboard.test/late'));
  assert.equal(v.one('TextInput').value, 'https://typed.test/first');
  await act(async () => v.one('SourceButton').onPress()); assert.deepEqual(submitted, ['https://typed.test/first']);
}));

test('mounted RSS editor keeps rename failure, busy state, selectable readonly URL and separate removal sheet', async () => mounted(async root => {
  const v = views(), edits = []; let ok = false;
  let state = {enabled: true, busy: false, selected: 'feed-a', subscriptions: [{id: 'feed-a', feed_url: 'https://source.test/feed.xml', remark: 'Original', next_allowed_at: '2020-01-01T00:00:00Z'}], entries: [], ready: true, hasMore: false};
  const controller = {edit: async (...values) => {edits.push(values); return ok;}};
  const {RssFeed} = await load('../../src/components/RssFeed.tsx', {
    react: React, 'react-native': {...v.primitives, StyleSheet: {create: value => value, absoluteFill: {}}}, '../runtime': {useMobile: () => ({t: value => value})}, '../rss/controller': {rssDisplayName: source => source.remark}, '../theme': theme, './SourceUI': v.ui, './SourceLine': {SourceLine: v.native('SourceLine')}, './SourceMenu': {SourceMenu: v.native('SourceMenu')}, './AppImage': {AppImage: v.native('AppImage')}, './fixture-actions': {}, './feed-scroll': {useFeedScrollPosition: () => ({events: {}, reset() {}})}, './FeedList': {FeedList: props => React.createElement(v.primitives.FlatList, props)},
  });
  const position = {source: 'feed-a', select() {}};
  const render = () => root.render(React.createElement(RssFeed, {state, controller, scrollPosition: position}));
  const input = label => v.one('TextInput', props => props.accessibilityLabel === label);
  const button = label => v.one('SourceButton', props => props.label === label);
  await act(async () => render());
  assert.equal(v.all('SourceSheet').length, 1, 'Only the existing editor remains; acquisition has no bottom sheet');
  assert.equal(v.one('SourceSheet').visible, false);
  await act(async () => v.one('SourceMenu').items.find(item => item.label === 'rss_edit').onPress());
  const readonly = v.one('SourceText', props => props.accessibilityLabel === 'rss_url');
  assert.equal(readonly.selectable, true); assert.equal(readonly.accessibilityState.disabled, false); assert.equal(readonly.children, 'https://source.test/feed.xml');
  assert.equal(v.all('TextInput').filter(props => props.accessibilityLabel === 'rss_url').length, 0, 'Readonly URL uses the native selectable text control, not disabled EditText');
  await act(async () => input('rss_name').onChangeText('Renamed'));
  state = {...state, busy: true}; await act(async () => render());
  assert.equal(input('rss_name').editable, false); assert.equal(v.one('SourceText', props => props.accessibilityLabel === 'rss_url').selectable, false); assert.equal(button('rss_save_name').disabled, true);
  state = {...state, busy: false}; await act(async () => render());
  await act(async () => button('rss_save_name').onPress());
  assert.deepEqual(edits, [['feed-a', 'Renamed']]);
  state = {...state, error: 'invalid_remark'}; await act(async () => render());
  assert.equal(v.one('SourceSheet').visible, true); assert.equal(input('rss_name').value, 'Renamed');
  assert.ok(v.all('SourceText').some(props => props.children === 'rss_error_invalid_remark'));
  ok = true; await act(async () => button('rss_save_name').onPress());
  assert.equal(v.one('SourceSheet').visible, false);
  await act(async () => v.one('SourceMenu').items.find(item => item.label === 'rss_remove').onPress());
  assert.equal(v.one('SourceDialog').visible, true); assert.equal(v.one('SourceDialog').title, 'rss_remove');
  state = {...state, enabled: false}; await act(async () => render());
  assert.equal(v.one('SourceDialog').visible, false);
}));

const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
async function addDialogHarness(root, overrides = {}) {
  const v = views(), submitted = [], feeds = [], imports = [];
  const h = {v, owner: 'account-a', dismissals: 0, added: 0, submitted, feeds, imports};
  h.submitFeed = async () => true;
  const {LinkInputDialog} = await load('../../src/components/LinkInputDialog.tsx', {
    react: React, 'react-native': {...v.primitives, Platform: {OS: 'ios'}, StyleSheet: {create: value => value}},
    'expo-clipboard': {getStringAsync: async () => ''}, '../runtime': {useMobile: () => ({t: value => value, fixtureOnly: true, nativeResourceOwner: h.owner})},
    '../theme': theme, '../theme/testIds': {mobileTestIds: {AddLinkError: 'add-error'}}, './SourceUI': v.ui,
  });
  h.props = {visible: true, rssEnabled: true, pdfEnabled: true, onPdfSaved: id => imports.push(id), onSubmit: value => submitted.push(value),
    onSubmitFeed: (...args) => {feeds.push(args); return h.submitFeed(...args);}, onFeedAdded: () => h.added++,
    onDismiss: () => {h.dismissals++; h.props.visible = false; h.render();}, ...overrides};
  h.render = () => root.render(React.createElement(LinkInputDialog, h.props));
  h.tab = mode => v.one('Pressable', props => props.accessibilityRole === 'tab' && props.accessibilityLabel === `add_content_tab_${mode}`);
  h.address = () => v.one('TextInput', props => props.accessibilityLabel !== 'add_content_feed_name');
  h.name = () => v.one('TextInput', props => props.accessibilityLabel === 'add_content_feed_name');
  h.error = () => v.one('SourceText', props => props.testID === 'add-error');
  h.hint = () => v.all('SourceText').some(props => props.children === 'add_content_feed_hint');
  await act(async () => h.render());
  return h;
}

for (const rssEnabled of [false, true]) for (const pdf of [false, true]) test(`unified add tabs and feed hints require confirmed RSS=${rssEnabled}, PDF=${pdf}`, async () => mounted(async root => {
  const h = await addDialogHarness(root, {rssEnabled, pdfEnabled: pdf});
  const expected = ['url', ...(rssEnabled ? ['feed'] : []), ...(pdf ? ['file'] : [])];
  const tabs = h.v.all('Pressable').filter(props => props.accessibilityRole === 'tab');
  assert.deepEqual(tabs.map(props => props.accessibilityLabel), expected.length > 1 ? expected.map(mode => `add_content_tab_${mode}`) : []);
  await act(async () => h.address().onChangeText('https://example.test/feed/?format=atom&token=a%2Bb#keep'));
  assert.equal(h.hint(), rssEnabled); assert.deepEqual(h.feeds, []); assert.deepEqual(h.submitted, []);
}));

test('File remains independent of the Feed callback and title editing ignores all acquisition props', async () => mounted(async root => {
  const h = await addDialogHarness(root, {onSubmitFeed: undefined});
  assert.equal(h.tab('file').accessibilityState.selected, false);
  assert.equal(h.v.all('Pressable').filter(props => props.accessibilityRole === 'tab').length, 2);
  h.props.initialTitle = 'Existing title'; h.props.initialMode = 'feed'; await act(async () => h.render());
  assert.equal(h.v.all('Pressable').filter(props => props.accessibilityRole === 'tab').length, 0);
  assert.equal(h.address().value, 'Existing title'); assert.equal(h.v.one('SourceButton').label, 'btn_confirm');
  assert.equal(h.hint(), false);
  await act(async () => h.address().onChangeText('  Renamed title  '));
  await act(async () => h.address().onSubmitEditing());
  assert.deepEqual(h.submitted, ['Renamed title']); assert.deepEqual(h.feeds, []); assert.deepEqual(h.imports, []);
}));

test('feed hint switch preserves the complete address, name draft, dismissal and accepted styles', async () => mounted(async root => {
  const h = await addDialogHarness(root), address = 'https://example.test/feed/?format=atom&token=a%2Bb#keep';
  await act(async () => h.address().onChangeText(address));
  assert.equal(h.hint(), true);
  await act(async () => h.v.one('TextAction', props => props.testID === 'add-feed-keep').onPress());
  assert.equal(h.hint(), false);
  await act(async () => h.address().onChangeText(`${address}2`));
  await act(async () => h.v.one('TextAction', props => props.testID === 'add-feed-switch').onPress());
  assert.equal(h.tab('feed').accessibilityState.selected, true); assert.equal(h.address().value, `${address}2`);
  await act(async () => h.name().onChangeText('My feed'));
  await act(async () => h.tab('file').onPress()); assert.deepEqual(h.imports, []);
  await act(async () => h.tab('feed').onPress());
  assert.equal(h.address().value, `${address}2`); assert.equal(h.name().value, 'My feed');
  assert.equal(flat(h.address().style).minHeight, 50); assert.equal(flat(h.address().style).borderRadius, 8);
  assert.equal(flat(h.address().style).paddingHorizontal, 12); assert.equal(flat(h.name().style).marginTop, 10);
  assert.equal(flat(h.v.one('SourceButton').style).marginTop, 24); assert.equal(h.v.one('SourceButton').tone, undefined);
  assert.deepEqual(h.feeds, []); assert.deepEqual(h.submitted, []);
}));

test('Feed awaits success, keeps localized failure and draft, and blocks duplicate submit and tab switching', async () => mounted(async root => {
  const h = await addDialogHarness(root, {initialMode: 'feed'}), pending = deferred(); h.submitFeed = () => pending.promise;
  await act(async () => {h.address().onChangeText('  https://example.test/feed?format=atom&key=full  '); h.name().onChangeText('  My feed  ');});
  const submit = h.v.one('SourceButton').onPress;
  await act(async () => {void submit(); void submit(); void h.address().onSubmitEditing(); h.tab('url').onPress();});
  assert.equal(h.feeds.length, 1); assert.equal(h.v.one('SourceButton').busy, true); assert.equal(h.dismissals, 0);
  assert.equal(h.tab('feed').accessibilityState.selected, true); assert.equal(h.tab('file').disabled, true);
  assert.equal(h.address().editable, false);
  await act(async () => {h.props.feedError = 'invalid_feed'; h.render(); pending.resolve(false);});
  assert.equal(h.dismissals, 0); assert.equal(h.v.one('SourceButton').busy, false);
  assert.equal(h.address().value, '  https://example.test/feed?format=atom&key=full  '); assert.equal(h.name().value, '  My feed  ');
  assert.equal(h.error().children, 'rss_error_invalid_feed'); assert.equal(flat(h.error().style).marginTop, 8);
  assert.equal(flat(h.error().style).fontSize, theme.mobileTypography.metadata.fontSize);
  await act(async () => h.tab('url').onPress()); assert.equal(h.v.all('SourceText').some(props => props.testID === 'add-error'), false);
  await act(async () => h.tab('feed').onPress()); assert.equal(h.error().children, 'rss_error_invalid_feed');
  h.submitFeed = async () => true; await act(async () => h.v.one('SourceButton').onPress());
  assert.equal(h.dismissals, 1); assert.equal(h.added, 1); assert.equal(h.v.one('SourceDialog').visible, false);
  assert.deepEqual(h.feeds, [['https://example.test/feed?format=atom&key=full', 'My feed'], ['https://example.test/feed?format=atom&key=full', 'My feed']]);
}));

for (const mode of ['feed', 'file']) test(`removing active ${mode} gate resets stored mode to URL even after reenable`, async () => mounted(async root => {
  const h = await addDialogHarness(root, {initialMode: mode}); assert.equal(h.tab(mode).accessibilityState.selected, true);
  const pdfEnabled = h.props.pdfEnabled;
  if (mode === 'feed') h.props.rssEnabled = false; else h.props.pdfEnabled = false;
  await act(async () => h.render()); assert.equal(h.tab('url').accessibilityState.selected, true);
  h.props.rssEnabled = true; h.props.pdfEnabled = pdfEnabled; await act(async () => h.render());
  assert.equal(h.tab('url').accessibilityState.selected, true); assert.equal(h.tab(mode).accessibilityState.selected, false);
}));

for (const lifecycle of ['close', 'account', 'unmount']) test(`late feed success cannot affect a replaced dialog after ${lifecycle}`, async () => mounted(async root => {
  const h = await addDialogHarness(root, {initialMode: 'feed'}), pending = deferred(); h.submitFeed = () => pending.promise;
  await act(async () => h.address().onChangeText('https://example.test/feed'));
  await act(async () => {void h.v.one('SourceButton').onPress();});
  if (lifecycle === 'close') {
    await act(async () => h.v.one('SourceDialog').onDismiss());
    h.props.visible = true; await act(async () => h.render());
  } else if (lifecycle === 'account') {h.owner = 'account-b'; await act(async () => h.render());}
  else await act(async () => root.render(null));
  await act(async () => pending.resolve(true));
  assert.equal(h.added, 0); assert.equal(h.dismissals, lifecycle === 'close' ? 1 : 0);
  if (lifecycle !== 'unmount') {assert.equal(h.v.one('SourceDialog').visible, true); assert.equal(h.address().value, ''); assert.equal(h.v.one('SourceButton').busy, false);}
}));

test('controller busy false result without an error remains retryable and visible', async () => mounted(async root => {
  const h = await addDialogHarness(root, {initialMode: 'feed'}); h.submitFeed = async () => false;
  await act(async () => h.address().onChangeText('https://example.test/feed'));
  await act(async () => h.v.one('SourceButton').onPress());
  assert.equal(h.error().children, 'rss_error_source_unavailable'); assert.equal(h.dismissals, 0); assert.equal(h.address().value, 'https://example.test/feed');
}));

test('actual iOS SourceLine forwards middle, clip and default tail truncation to UIKit text', async () => mounted(async root => {
  const v = views();
  const {SourceLine} = await load('../../src/components/SourceLine.tsx', {react: React, 'react-native': {Platform: {OS: 'ios'}, useWindowDimensions: () => ({fontScale: 1})}, 'expo': {requireNativeView: () => {throw new Error('iOS must not load Android TextPaint');}}, './SourceUI': v.ui});
  for (const [ellipsis, expected] of [['middle', 'middle'], ['clip', 'clip'], [undefined, 'tail']]) {
    await act(async () => root.render(React.createElement(SourceLine, {text: 'A very long collection title', fontSize: 11, lineHeight: 14, color: '#999999', ellipsis})));
    assert.equal(v.one('SourceText').ellipsizeMode, expected); assert.equal(v.one('SourceText').numberOfLines, 1);
  }
}));

for (const platform of ['android', 'ios']) test(`actual ${platform} subscription route retains native header/back with source 20sp title`, async () => mounted(async root => {
  const v = views(), screens = [];
  const boundaries = {
    react: React, 'react-native': {...v.primitives, Platform: {OS: platform}, StatusBar: nil, StyleSheet: {create: value => value}, useWindowDimensions: () => ({fontScale: 1})},
    'expo-app-intents': {isAvailable: () => false, useAppIntents() {}},
    '@react-navigation/native': {NavigationContainer: v.native('NavigationContainer'), createNavigationContainerRef: () => React.createRef()}, '@react-navigation/native-stack': {createNativeStackNavigator: () => ({Navigator: v.native('Navigator'), Group: v.native('Group'), Screen: props => {screens.push(props); return null;}})},
    'react-native-gesture-handler': {GestureHandlerRootView: nil}, 'react-native-safe-area-context': {SafeAreaProvider: nil, SafeAreaView: nil}, './runtime': {MobileProvider: nil, useMobile: () => ({t: value => value, upgrade: {status: 'ready'}, session: {status: 'authenticated', session: {userId: 'user'}}})}, './theme': theme, './telemetry': {useTelemetry: () => telemetry}, './components/SourceLine': {SourceLine: nil},
  };
  for (const name of ['Login', 'Library', 'Reader', 'Settings', 'About', 'Feedback', 'DeleteAccount', 'Subscription', 'Debug']) boundaries[`./screens/${name}Screen`] = {[`${name}Screen`]: nil};
  boundaries['./screens/AppRecoveryScreen'] = {AppRecoveryScreen: nil};
  const readerScreenOptions = () => ({}), prewarmSources = [];
  boundaries['./navigation/reader-route'] = {readerScreenOptions, useReaderPrewarm: source => prewarmSources.push(source)};
  const {ApplicationRoutes} = await load('../../src/App.tsx', boundaries);
  await act(async () => root.render(React.createElement(ApplicationRoutes)));
  const {options} = screens.find(screen => screen.name === 'Subscription');
  assert.equal(options.title, 'Pro Reader'); assert.equal(options.headerTitleStyle.fontSize, 20); assert.equal(options.headerTitleStyle.fontWeight, '500');
  assert.equal(options.header, undefined); assert.equal(options.headerLeft, undefined); assert.equal(options.headerBackVisible, undefined);
  assert.equal(v.one('Navigator').screenOptions.headerBackButtonDisplayMode, 'minimal');
  assert.equal(screens.find(screen => screen.name === 'Reader').options, readerScreenOptions, 'The Reader route registers its static native header options');
  assert.equal(prewarmSources.at(-1), undefined, 'Without an account runtime the Reader is not prewarmed');
}));

for (const zone of ['Asia/Shanghai', 'America/Los_Angeles']) test(`mounted Library uses UTC subscription/collection expiry rather than ${zone} local time`, async () => mounted(async root => {
  const original = process.env.TZ; process.env.TZ = zone;
  try {
    const v = views(), selection = await load('../../src/screens/collection-selection.ts');
    let onCollections, onSubscription;
    const rows = [{id: 'shared-bookmark', title: 'Shared'}];
    const subscriptions = {library: {watch: (_sort, owner, callback) => {if (owner) callback(rows); return () => {};}}, watchLibraryCollections: callback => {onCollections = callback; callback([]); return () => {};}, watchLibraryUser: () => () => {}, watchBookmarks: () => () => {}, watchCollections: callback => {onCollections = callback; return () => {};}, watchUser: () => () => {}, watchSubscription: callback => {onSubscription = callback; return () => {};}, watchCollectionBookmarks: (_owner, callback) => {callback(rows); return () => {};}};
    const rssState = {enabled: false};
    class RssController {subscribe = () => () => {}; getSnapshot = () => rssState; activate() {} dispose() {} cancel() {} poll() {} async load() {}}
    const context = {t: key => key, repositories: subscriptions, preferences: {}, runtime: {getDatabase: () => null, getNativeResourceOwner: () => 'owner'}, api: {}, sessions: {}, config: {platform: 'ios'}, nativeResourceOwner: 'owner', upgrade: {status: 'ready'}};
    Object.assign(context.runtime, {getRepositories: () => subscriptions, getAccountPreferences: () => context.preferences, getUpgradeSnapshot: () => context.upgrade});
    const reset = () => {};
    class FeedScrollPosition {reset() {}}
    const components = {...v.ui, BookmarkRow: nil, LinkInputDialog: nil, RssFeed: nil, RssFeedSwitcher: nil, ScreenSurface: v.native('ScreenSurface'), SourceAvatar: nil, SourceMenu: nil};
    const {LibraryScreen} = await load('../../src/screens/LibraryScreen.tsx', {
      react: React, 'react-native': {...v.primitives, Animated: {}, AppState: {currentState: 'active', addEventListener: () => ({remove() {}})}, Linking: {}, PixelRatio: {roundToNearestPixel: value => value}, Platform: {OS: 'ios', select: values => values.default}, StyleSheet: {create: value => value, absoluteFill: {}}, useWindowDimensions: () => ({width: 375, height: 800})},
      '@react-navigation/native': {useFocusEffect: callback => React.useEffect(callback, [callback])}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 44, bottom: 34})}, 'expo-network': {useNetworkState: () => ({isConnected: true})},
      '../telemetry': {useTelemetry: () => telemetry}, '../components/LibrarySyncAvatar': {LibrarySyncAvatar: nil}, '../components/LibrarySyncStatus': {LibrarySyncStatus: nil}, '../components/SourceSyncAvatar': {SourceSyncAvatar: nil}, '../components/SourceLine': {SourceLine: nil}, '../components/SourceRing': {SourceCircle: nil}, '../components/SourceShape': {SourceShape: v.native('SourceShape')}, '../components/sync-state': {sourceSyncState: () => ({kind: 'idle'})}, '../components/fixture-actions': {},
      './LibraryDataStatus': {LibraryDataStatus: nil}, '../pdf/usePdfLab': {usePdfLab: () => ({ready: true, enabled: false})},
      '../components': components, '../components/useVisibleSnapshot': await load('../../src/components/useVisibleSnapshot.ts', {react: React}), '../data': {readContinueReading: async () => null}, '../rss/controller': {RssController}, '../runtime': {useMobile: () => context}, '../theme': theme, '../theme/testIds': {mobileTestIds: {}}, './collection-selection': selection, '../components/feed-scroll': {FeedScrollPosition, useFeedScrollPosition: () => ({events: {}, reset})}, '../components/SourceDrawer': {SourceDrawer: v.native('SourceDrawer')}, '../components/FeedList': {FeedList: props => React.createElement(v.primitives.FlatList, props)}, '../components/useAppForeground': {useAppForeground: () => true}, '../utils/source-time': time,
    }, {Date: class extends Date {static now() {return Date.UTC(2026, 9, 11, 12);}}});
    await act(async () => root.render(React.createElement(LibraryScreen, {navigation: {navigate() {}}, route: {params: {}}})));
    assert.equal(v.all('View').some(props => props.testID === 'library-collection-strip'), false, 'No collection must not reserve a selector strip');
    const collection = {id: 'shared', name: 'Shared', ownerId: 'owner', status: 1, hasNew: false, subscriptionEndTime: '2026-10-11 13:00:00'};
    await act(async () => {onCollections([collection]); onSubscription([{subscription_end_time: collection.subscriptionEndTime}]);});
    assert.equal(v.all('View').filter(props => props.testID === 'library-collection-strip').length, 1);
    const tabs = v.all('Pressable').filter(props => props.accessibilityRole === 'tab');
    await act(async () => tabs[1].onPress());
    assert.deepEqual(v.one('FlatList').data, rows, 'A future UTC collection must remain readable even in an ahead-of-UTC locale');
    const sidebar = () => v.one('SourceDrawer').drawer;
    const tree = node => !React.isValidElement(node) ? [] : [node, ...React.Children.toArray(node.props.children).flatMap(tree)];
    const subscriptionButton = () => tree(sidebar()).find(node => node.type === v.primitives.Pressable && tree(node).some(child => child.type === v.ui.SourceIcon && child.props.name === 'ic_xs_sidebar_subscribe'));
    const promotion = () => tree(sidebar()).find(node => node.type === v.primitives.Pressable && tree(node).some(child => child.type === v.ui.SourceIcon && child.props.name === 'ic_xs_sidebar_subscribed'));
    assert.ok(subscriptionButton()); assert.equal(promotion(), undefined);
    await act(async () => {onCollections([{...collection, subscriptionEndTime: '2026-10-11 11:00:00'}]); onSubscription([{subscription_end_time: '2026-10-11 11:00:00'}]);});
    assert.equal(v.one('FlatList').data.length, 0, 'A past UTC collection must expire even in a behind-UTC locale');
    assert.ok(promotion()); assert.equal(subscriptionButton(), undefined);
    assert.equal(text(v.one('FlatList').ListEmptyComponent), 'collection_expired_message');
    await act(async () => {onCollections([{...collection, subscriptionEndTime: '2026-10-11 12:00:00'}]); onSubscription([{subscription_end_time: '2026-10-11 12:00:00'}]);});
    assert.equal(v.one('FlatList').data.length, 0); assert.ok(promotion(), 'Exact expiry is no longer subscribed');
    await act(async () => {onCollections([{...collection, subscriptionEndTime: '2026-10-11 20:00:01+08:00'}]); onSubscription([{end_time: '2026-10-11 20:00:01+08:00'}]);});
    assert.deepEqual(v.one('FlatList').data, rows); assert.ok(subscriptionButton(), 'Explicit offset and legacy end_time fallback still apply');
  } finally {if (original === undefined) delete process.env.TZ; else process.env.TZ = original;}
}));
