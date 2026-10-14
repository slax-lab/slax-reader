import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React, {act} from 'react';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {SessionController, SessionChangedError} from '../../src/domain/session.ts';
import {deleteCurrentAccount} from '../../src/domain/delete-account.ts';
import {MemoryPreferences} from '../data/helpers.ts';

const require = createRequire(import.meta.url);
const domPath = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};

function modules(boundaries, development = false) {
  const loaded = new Map();
  function load(path) {
    if (loaded.has(path)) return loaded.get(path);
    const exports = {};
    loaded.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
    }).outputText;
    vm.runInNewContext(code, {
      exports, __DEV__: development, AbortController, URL, console,
      require(name) {
        if (Object.hasOwn(boundaries, name)) return boundaries[name];
        assert.ok(name.startsWith('.'), `Unexpected external dependency ${name}`);
        const base = resolve(dirname(path), name);
        const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(file => existsSync(file) && /\.tsx?$/.test(file));
        assert.ok(resolved, `Cannot resolve ${name} from ${path}`);
        return load(resolved);
      },
    });
    return exports;
  }
  return file => load(fileURLToPath(new URL(file, import.meta.url)));
}

async function mounted(run) {
  const {Window} = await import(pathToFileURL(domPath).href);
  const window = new Window();
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true});
  const {createRoot} = await import('react-dom/client');
  const root = createRoot(window.document.body.appendChild(window.document.createElement('div')));
  try {await run(root);} finally {
    await act(async () => root.unmount());
    window.close();
    for (const name of names) {
      const old = previous.get(name);
      if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name];
    }
  }
}

async function harness(root) {
  const nodes = new Map(), scripts = [], listeners = new Set();
  const native = name => React.forwardRef((props, ref) => {
    const key = React.useRef(Symbol(name)).current;
    React.useLayoutEffect(() => {nodes.set(key, {name, props}); return () => nodes.delete(key);});
    React.useImperativeHandle(ref, () => ({injectJavaScript: value => scripts.push(value)}), []);
    return props.visible === false ? null : React.createElement('div', null, props.children, props.actions);
  });
  const h = {
    owner: 'owner-a', focused: true, origin: 'https://api.test', scripts, listeners,
    rssRequests: [], mutations: [], deletionRequests: [], navigation: [], headers: [],
    labs: async () => ({features: [{key: 'rss', enabled: false}, {key: 'pdf', enabled: true}]}),
    enable: async () => {}, deletion: async () => ({canDelete: false, reason: 'active_subscription'}),
  };
  const store = new PreferenceStore(new MemoryPreferences({auth_token: 'fixture-token', user_id: 'fixture-user'}));
  const sessions = new SessionController(store, {enter: async () => {}, leave: async () => {}});
  await sessions.restore();
  h.store = store;
  h.sessions = sessions;
  const runtime = {getNativeResourceOwner: () => h.owner};
  const api = {
    rssLabs(signal) {h.rssRequests.push(signal); return h.labs(signal);},
    rssEnable(value, signal) {h.mutations.push({value, signal}); return h.enable(value, signal);},
    setLab: async () => {},
    deleteAccount(signal) {h.deletionRequests.push(signal); return h.deletion(signal);},
  };
  const t = value => value;
  h.preferences = store;
  h.settings = {};
  const useMobile = () => ({
    api, runtime, sessions, t, session: sessions.getSnapshot(), nativeResourceOwner: h.owner,
    settings: h.settings, preferences: h.preferences, locale: h.locale ?? 'en',
    config: {webUrl: 'https://reader.test', apiUrl: h.origin},
  });
  const appState = {
    currentState: 'active',
    addEventListener(name, callback) {
      assert.equal(name, 'change');
      listeners.add(callback);
      return {remove: () => listeners.delete(callback)};
    },
  };
  const ui = Object.fromEntries(['ScreenSurface', 'SourceButton', 'SourceDialog', 'SourceIcon', 'SourceSwitch', 'SourceText', 'TextAction', 'Divider'].map(name => [name, native(name)]));
  const load = modules({
    react: React,
    'react-native': {AppState: appState, StyleSheet: {create: value => value}, ...Object.fromEntries(['Pressable', 'ScrollView', 'View'].map(name => [name, native(name)]))},
    'react-native-webview': {WebView: native('WebView')},
    '@react-navigation/native': {useFocusEffect: callback => React.useEffect(() => h.focused ? callback() : undefined, [callback, h.focused])},
    '../runtime': {useMobile},
    '../components': ui,
    '../components/SourceParagraph': {SourceParagraph: native('SourceParagraph')},
    '../domain/delete-account': {deleteCurrentAccount},
    '../domain/session': {SessionChangedError},
    'expo-file-system': {File: class {constructor() {assert.fail('Production UI must not access fixture files');}}},
  });
  h.all = name => [...nodes.values()].filter(node => node.name === name).map(node => node.props);
  h.one = (name, predicate = () => true) => {
    const matches = h.all(name).filter(predicate);
    assert.equal(matches.length, 1, `${name}: expected one node, got ${matches.length}`);
    return matches[0];
  };
  h.renderRoute = async name => {
    const {[name]: Screen} = load(`../../src/screens/${name}.tsx`);
    const navigation = {navigate: (...args) => h.navigation.push(args), setOptions: value => h.headers.push(value)};
    h.render = () => root.render(React.createElement(Screen, {navigation}));
    await act(async () => h.render());
  };
  h.renderRss = async () => {
    const {useAccountScope} = load('../../src/settings/account-scope.ts');
    const {useRssLab} = load('../../src/settings/useRssLab.ts');
    function Probe() {
      const scope = useAccountScope({...useMobile(), apiOrigin: h.origin});
      h.rss = useRssLab(api, scope);
      return null;
    }
    h.render = () => root.render(React.createElement(Probe));
    await act(async () => h.render());
  };
  h.background = status => act(async () => {
    appState.currentState = status;
    for (const callback of listeners) callback(status);
  });
  h.rerender = () => act(async () => h.render());
  h.button = () => h.one('SourceButton', props => props.label === 'delete_account_button');
  h.dialog = () => h.one('SourceDialog', props => props.title === 'delete_account_confirm_title');
  h.notice = () => h.one('WebView');
  h.readNotice = async (bottom = true) => {
    await act(async () => h.notice().onLoadStart());
    await act(async () => h.notice().onLoad({nativeEvent: {url: 'https://reader.test/delete-account-notice'}}));
    const generation = Number(scripts.at(-1).match(/generation:(\d+)/)[1]);
    await act(async () => h.notice().onMessage({nativeEvent: {url: 'https://reader.test', data: JSON.stringify({
      kind: 'delete-notice-geometry', generation, documentUrl: 'https://reader.test/delete-account-notice',
      ready: true, hasContent: true, height: 1200, visible: 600, y: bottom ? 600 : 0,
    })}}));
  };
  h.ask = () => act(async () => h.button().onPress());
  h.confirm = () => act(async () => h.one('TextAction', props => props.label === 'delete_account_confirm_button').onPress());
  return h;
}

test('Settings route renders original choices, language, image preference and delete navigation with real state', async () => mounted(async root => {
  const h = await harness(root);
  await h.renderRoute('SettingsScreen');
  assert.equal(h.headers.at(-1).headerTitleAlign, 'center');
  assert.deepEqual(h.all('Pressable').filter(props => props.accessibilityLabel).map(props => props.accessibilityLabel), ['30', '50', '100', '200', '∞']);
  await act(async () => h.one('Pressable', props => props.accessibilityLabel === '∞').onPress());
  await act(async () => h.one('Pressable', props => props.accessibilityRole === 'checkbox').onPress());
  await act(async () => h.one('Pressable', props => props.testID === 'setting_language').onPress());
  await act(async () => h.all('Pressable').filter(props => props.accessibilityRole === 'radio')[0].onPress());
  const values = await h.store.read();
  assert.equal(values.cache_count, -1);
  assert.equal(values.download_images, 0);
  assert.equal(values.user_language, 'zh');
  assert.equal(h.one('SourceDialog', props => props.title === 'setting_language').visible, false);
  await act(async () => h.one('SourceButton', props => props.label === 'setting_delete_account').onPress());
  assert.deepEqual(h.navigation, [['DeleteAccount']]);
}));

test('Settings preference errors are shown only for the active owner and disposed writes cannot mutate', async () => mounted(async root => {
  const h = await harness(root), pending = deferred();
  h.preferences = {update: edit => {h.edit = edit; return pending.promise;}};
  await h.renderRoute('SettingsScreen');
  await act(async () => h.one('Pressable', props => props.accessibilityLabel === '30').onPress());
  const oldEdit = h.edit;
  h.owner = 'owner-b';
  await h.rerender();
  const values = {};
  oldEdit(values);
  assert.deepEqual(values, {});
  await act(async () => pending.reject(new Error('Old preference failure')));
  assert.equal(h.one('SourceDialog', props => props.title === 'feedback_error_title').visible, false);
  h.preferences = {update: async () => {throw new Error('Current preference failure');}};
  await h.rerender();
  await act(async () => h.one('Pressable', props => props.accessibilityLabel === '30').onPress());
  assert.equal(h.one('SourceDialog', props => props.title === 'feedback_error_title').visible, true);
  assert.ok(h.all('SourceText').some(props => props.children === 'Current preference failure'));
}));

test('RSS waits for ownership admission and loads after null owner becomes admitted without remount', async () => mounted(async root => {
  const h = await harness(root);
  h.owner = null;
  await h.renderRss();
  assert.equal(h.rssRequests.length, 0);
  h.owner = 'admitted';
  await h.rerender();
  assert.equal(h.rssRequests.length, 1);
  assert.equal(h.rss.ready, true);
}));

test('RSS cancels account/origin replacement, rejects old success and failure, and keeps the replacement flight', async () => mounted(async root => {
  const h = await harness(root), first = deferred(), second = deferred();
  h.labs = () => first.promise;
  await h.renderRss();
  h.owner = 'owner-b'; h.labs = () => second.promise;
  await h.rerender();
  assert.equal(h.rssRequests[0].aborted, true);
  await act(async () => first.resolve({features: [{key: 'rss', enabled: true}]}));
  assert.equal(h.rss.ready, false);
  await act(async () => {void h.rss.load();});
  assert.equal(h.rssRequests.length, 2);
  h.origin = 'https://new-api.test'; h.labs = async () => ({features: []});
  await h.rerender();
  assert.equal(h.rssRequests[1].aborted, true);
  await act(async () => second.reject(new Error('Old transport error')));
  assert.equal(h.rss.enabled, false);
  assert.equal(h.rss.failed, false);
  assert.equal(h.rss.busy, false);
}));

test('RSS foreground and focus own one subscription, cancellation, retry and mutation', async () => mounted(async root => {
  const h = await harness(root), pending = deferred();
  h.labs = () => pending.promise;
  await h.renderRss();
  assert.equal(h.listeners.size, 1);
  await h.background('background');
  assert.equal(h.rssRequests[0].aborted, true);
  await act(async () => {void h.rss.load(true);});
  assert.equal(h.mutations.length, 0);
  h.labs = async () => {throw new Error('Offline');};
  await h.background('active');
  assert.equal(h.rss.failed, true);
  h.labs = async () => ({features: [{key: 'rss', enabled: true}]});
  await act(async () => h.rss.load());
  assert.equal(h.rss.enabled, true);
  const mutation = deferred(); h.enable = () => mutation.promise;
  await act(async () => {void h.rss.load(false);});
  assert.equal(h.rss.busy, true);
  h.focused = false; await h.rerender();
  assert.equal(h.mutations[0].signal.aborted, true);
  assert.equal(h.listeners.size, 0);
  h.focused = true; await h.rerender();
  await act(async () => mutation.resolve());
  await act(async () => pending.resolve({features: []}));
  assert.equal(h.rss.enabled, true);
  assert.equal(h.listeners.size, 1);
  await act(async () => root.render(null));
  assert.equal(h.listeners.size, 0);
}));

test('DeleteAccount real route keeps blank/native-only notices disabled, requires bottom and confirmation', async () => mounted(async root => {
  const h = await harness(root);
  await h.renderRoute('DeleteAccountScreen');
  assert.equal(h.headers.at(-1).headerTitleAlign, 'left');
  assert.equal(h.button().disabled, true);
  await act(async () => h.notice().onScroll({nativeEvent: {contentSize: {height: 400}, layoutMeasurement: {height: 600}, contentOffset: {y: 0}}}));
  await h.ask();
  assert.equal(h.dialog().visible, false);
  await h.readNotice(false);
  assert.equal(h.button().disabled, true);
  await act(async () => h.notice().onScroll({nativeEvent: {contentSize: {height: 1200}, layoutMeasurement: {height: 600}, contentOffset: {y: 600}}}));
  assert.equal(h.button().disabled, false);
  assert.equal(h.deletionRequests.length, 0);
  await h.ask();
  assert.equal(h.dialog().visible, true);
  assert.equal(h.deletionRequests.length, 0);
  await h.confirm();
  assert.equal(h.deletionRequests.length, 1);
  assert.ok(h.all('SourceText').some(props => props.children === '无法删除账号：您有正在进行的订阅，请先取消订阅后再试'));
  assert.equal(sessionsStatus(h), 'authenticated');
}));

const sessionsStatus = h => h.sessions.getSnapshot().status;

test('DeleteAccount early shell safely enables after admission without freezing its original null owner', async () => mounted(async root => {
  const h = await harness(root);
  h.owner = null;
  await h.renderRoute('DeleteAccountScreen');
  await h.readNotice();
  assert.equal(h.button().disabled, true);
  await h.ask();
  assert.equal(h.dialog().visible, false);
  h.owner = 'admitted';
  await h.rerender();
  assert.equal(h.button().disabled, false);
  await h.ask();
  h.deletion = async () => ({canDelete: true});
  await h.confirm();
  assert.equal(h.deletionRequests.length, 1);
  assert.equal(sessionsStatus(h), 'unauthenticated');
}));

test('DeleteAccount notice reload/error revokes confirmation and enforces fresh verified geometry', async () => mounted(async root => {
  const h = await harness(root);
  await h.renderRoute('DeleteAccountScreen');
  await h.readNotice(); await h.ask();
  const oldConfirm = h.one('TextAction', props => props.label === 'delete_account_confirm_button').onPress;
  await act(async () => h.notice().onHttpError());
  await act(async () => oldConfirm());
  assert.equal(h.deletionRequests.length, 0);
  assert.equal(h.dialog().visible, false);
  assert.equal(h.button().disabled, true);
  assert.equal(h.notice().onShouldStartLoadWithRequest({url: 'https://other.test/delete-account-notice'}), false);
  await h.readNotice();
  assert.equal(h.button().disabled, false);
}));

for (const outcome of ['success', 'denial', 'failure']) test(`DeleteAccount owner replacement aborts a pending ${outcome} and cannot affect another session`, async () => mounted(async root => {
  const h = await harness(root), pending = deferred();
  h.deletion = () => pending.promise;
  await h.renderRoute('DeleteAccountScreen'); await h.readNotice(); await h.ask(); await h.confirm();
  assert.equal(h.button().busy, true);
  await h.sessions.accept('replacement-token', 'replacement-user');
  h.owner = 'owner-b';
  await h.rerender();
  assert.equal(h.deletionRequests[0].aborted, true);
  await act(async () => outcome === 'failure' ? pending.reject(new Error('Stale failure')) : pending.resolve({canDelete: outcome === 'success', reason: 'active_subscription'}));
  assert.equal(h.sessions.getSnapshot().session.userId, 'replacement-user');
  assert.equal(h.one('SourceDialog', props => props.title === 'delete_account_error_title').visible, false);
  assert.equal(h.button().busy, false);
  assert.equal(h.button().disabled, true);
  assert.equal(h.dialog().visible, false);
  await h.ask();
  assert.equal(h.dialog().visible, false);
  assert.equal(h.deletionRequests.length, 1);
}));

test('DeleteAccount unmount aborts transport and stale same-user relogin cannot start a delete', async () => mounted(async root => {
  const h = await harness(root), pending = deferred();
  await h.renderRoute('DeleteAccountScreen'); await h.readNotice(); await h.ask();
  await h.sessions.accept('fixture-token', 'fixture-user');
  await h.confirm();
  assert.equal(h.deletionRequests.length, 0);
  await act(async () => root.render(null));
  await h.renderRoute('DeleteAccountScreen'); await h.readNotice(); await h.ask();
  h.deletion = () => pending.promise;
  await h.confirm();
  await act(async () => root.render(null));
  assert.equal(h.deletionRequests[0].aborted, true);
  await act(async () => pending.resolve({canDelete: true}));
  assert.equal(sessionsStatus(h), 'authenticated');
}));

test('development notice observer bounds diagnostics, validates fixture storage and disposes pending inspection', async () => mounted(async root => {
  const writes = [], scripts = [];
  let marker = async () => JSON.stringify({controlledFixture: true, fixtureVersion: 1});
  const load = modules({
    react: React,
    'expo-file-system': {File: class {
      constructor(directory, name) {this.directory = directory; this.name = name;}
      text() {assert.equal(this.name, 'slax-fixture.json'); return marker();}
      write(value) {writes.push({directory: this.directory, name: this.name, value: JSON.parse(value)});}
    }},
  }, true);
  const {fixtureActions} = load('../../src/components/fixture-actions.ts');
  const release = fixtureActions.activate('settings-notice');
  const {NoticeReadGate} = load('../../src/settings/notice-read-gate.ts');
  const {useDeleteNoticeObserver, useDeleteAccountFixture} = load('../../src/settings/development/useDeleteAccountFixture.ts');
  const gate = new NoticeReadGate('https://reader.test/delete-account-notice', true);
  const fixture = {dataDirectory: 'file:///cache/slax-ui-fixtures/settings-notice/'};
  const web = {current: {injectJavaScript: value => scripts.push(value)}};
  let observer, asks = 0, deletes = 0;
  let state = {canDelete: false, busy: false, confirm: false, askConfirmation() {asks++;}, async remove() {deletes++;}};
  function Probe() {
    observer = useDeleteNoticeObserver(fixture);
    useDeleteAccountFixture({fixture, observer, gate, read: true, state, web});
    return null;
  }
  try {
    await act(async () => root.render(React.createElement(Probe)));
    for (let index = 0; index < 30; index++) observer('geometry', {index}, gate.inspect());
    await fixtureActions.dispatch({kind: 'inspect-notice'});
    assert.equal(writes[0].name, 'delete-notice.json');
    assert.equal(writes[0].value.events.length, 16);
    await assert.rejects(fixtureActions.dispatch({kind: 'press-delete'}), /disabled/);
    await assert.rejects(fixtureActions.dispatch({kind: 'confirm-delete'}), /not open/);
    state = {...state, canDelete: true, confirm: true};
    await act(async () => root.render(React.createElement(Probe)));
    await fixtureActions.dispatch({kind: 'press-delete'});
    await fixtureActions.dispatch({kind: 'confirm-delete'});
    await fixtureActions.dispatch({kind: 'scroll', target: '#bottom'});
    assert.equal(asks, 1); assert.equal(deletes, 1);
    assert.match(scripts[0], /scrollIntoView/);
    marker = async () => '{}';
    await assert.rejects(fixtureActions.dispatch({kind: 'inspect-notice'}), /marker is invalid/);
    const pending = deferred(); marker = () => pending.promise;
    const inspection = fixtureActions.dispatch({kind: 'inspect-notice'});
    await act(async () => root.render(null));
    pending.resolve(JSON.stringify({controlledFixture: true, fixtureVersion: 1}));
    await inspection;
    assert.equal(writes.length, 1);
    await assert.rejects(fixtureActions.dispatch({kind: 'scroll'}), /no mounted handler/);
  } finally {release();}
}));

test('RSS mutation denial leaves the known setting intact, and retry success uses the requested value', async () => mounted(async root => {
  const h = await harness(root);
  await h.renderRss();
  h.enable = async () => {throw new Error('Denied');};
  await act(async () => h.rss.load(true));
  assert.equal(h.rss.enabled, false);
  assert.equal(h.rss.ready, true);
  assert.equal(h.rss.failed, true);
  h.enable = async () => {};
  await act(async () => h.rss.load(true));
  assert.equal(h.rss.enabled, true);
  assert.equal(h.rss.failed, false);
  assert.equal(h.mutations.length, 2);
}));

for (const replacement of ['owner', 'origin']) test(`DeleteAccount ${replacement} replacement revokes the admitted destructive route until remount`, async () => mounted(async root => {
  const h = await harness(root);
  await h.renderRoute('DeleteAccountScreen'); await h.readNotice(); await h.ask();
  if (replacement === 'owner') h.owner = 'new-owner'; else h.origin = 'https://replacement-api.test';
  await h.rerender();
  assert.equal(h.button().disabled, true);
  assert.equal(h.dialog().visible, false);
  await h.ask();
  assert.equal(h.dialog().visible, false);
  await act(async () => root.render(null));
  await h.renderRoute('DeleteAccountScreen'); await h.readNotice();
  assert.equal(h.button().disabled, false);
}));
