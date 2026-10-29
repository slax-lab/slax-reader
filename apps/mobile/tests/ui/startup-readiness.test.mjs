import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, nativeBoundary, loadComponent, withNativeHost} from '../reader/parity-host.mjs';
import * as theme from '../../src/theme/index.ts';
import {PreferenceStore, readContinueReading} from '../../src/data/preferences.ts';
import {FixtureMemoryPreferences} from '../../fixtures/isolation.ts';
import {CollectionSelection} from '../../src/screens/collection-selection.ts';
import {parseSourceTimestamp} from '../../src/utils/source-time.ts';

const nil = () => null;
const telemetry = {track() {}, element() {}, firebase() {}, identify() {}};
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const text = node => Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : node ?? '';

for (const status of ['authenticated', 'unauthenticated']) test(`mounted ${status} routes retain navigator across pending, failed and retried DB admission`, nativeBoundary, async () => withNativeHost(async host => {
  let mounted = 0, unmounted = 0, route, setRoute;
  const screens = new Map();
  const context = {upgrade: {status: 'checking'}, session: status === 'authenticated' ? {status, session: {userId: 'local'}} : {status}, t: key => key};
  function Navigator({children}) {
    const [current, update] = React.useState(status === 'authenticated' ? 'Library' : 'Login'); route = current; setRoute = update;
    React.useEffect(() => {mounted++; return () => {unmounted++;};}, []);
    return React.createElement(host.native.View, null, children);
  }
  const boundaries = {
    react: React, 'react-native': {...host.native, Text: host.native.View, StatusBar: nil},
    '@react-navigation/native': {NavigationContainer: host.native.View, createNavigationContainerRef: () => React.createRef()},
    '@react-navigation/native-stack': {createNativeStackNavigator: () => ({Navigator, Group: host.native.View, Screen: props => {screens.set(props.name, props); return null;}})},
    'react-native-gesture-handler': {GestureHandlerRootView: host.native.View}, 'react-native-safe-area-context': {SafeAreaProvider: host.native.View, SafeAreaView: host.native.View},
    './runtime': {useMobile: () => context, MobileProvider: nil}, './theme': theme, './telemetry': {useTelemetry: () => telemetry}, './components/SourceLine': {SourceLine: nil},
    './screens/AppRecoveryScreen': {AppRecoveryScreen: nil}, './navigation/reader-route': {readerScreenOptions: () => ({}), useReaderPrewarm() {}},
  };
  for (const name of ['Login', 'Library', 'Reader', 'Settings', 'About', 'Feedback', 'DeleteAccount', 'Subscription', 'Debug', 'DiagnosticLog']) boundaries[`./screens/${name}Screen`] = {[`${name}Screen`]: nil};
  const {ApplicationRoutes} = await loadComponent('../../src/App.tsx', boundaries);
  const render = () => host.render(React.createElement(ApplicationRoutes));
  await render(); assert.equal(mounted, 1);
  if (status === 'authenticated') {assert.ok(screens.has('Settings')); await act(async () => setRoute('Settings'));}
  for (const upgrade of [{status: 'error', error: new Error('Synthetic admission failure')}, {status: 'verification-required', inventory: {}}, {status: 'checking'}, {status: 'ready'}]) {
    context.upgrade = upgrade; await render();
    assert.equal(mounted, 1); assert.equal(unmounted, 0);
    assert.equal(route, status === 'authenticated' ? 'Settings' : 'Login');
    assert.equal(host.props.has('app-startup-surface'), false);
  }
}));

test('mounted startup shows recoverable local errors, suppresses duplicate retries and returns to Login', nativeBoundary, async () => withNativeHost(async host => {
  const controls = new Map(), gate = deferred(); let retries = 0;
  const context = {session: {status: 'loading'}, upgrade: {status: 'error', error: new Error('Private storage detail must not be displayed')}, t: key => key,
    retryStart: async () => {retries++; await gate.promise; context.session = {status: 'unauthenticated'}; context.upgrade = {status: 'ready'};}};
  const primitive = props => {if (props.onPress) controls.set(text(props.children), props); return React.createElement(host.native.View, props);};
  const {AppRecoveryScreen} = await loadComponent('../../src/screens/AppRecoveryScreen.tsx', {
    react: React, 'react-native': {...host.native, Pressable: primitive, StyleSheet: {create: value => value}},
    'react-native-safe-area-context': {SafeAreaView: host.native.View}, '../components': {SourceText: host.native.View}, '../theme': theme,
  });
  const screens = [];
  const boundaries = {
    react: React, 'react-native': {...host.native, Text: host.native.View, StatusBar: nil},
    '@react-navigation/native': {NavigationContainer: host.native.View, createNavigationContainerRef: () => React.createRef()},
    '@react-navigation/native-stack': {createNativeStackNavigator: () => ({Navigator: host.native.View, Group: host.native.View, Screen: props => {screens.push(props.name); return null;}})},
    'react-native-gesture-handler': {GestureHandlerRootView: host.native.View}, 'react-native-safe-area-context': {SafeAreaProvider: host.native.View, SafeAreaView: host.native.View},
    './runtime': {useMobile: () => context, MobileProvider: nil}, './theme': theme, './telemetry': {useTelemetry: () => telemetry}, './components/SourceLine': {SourceLine: nil}, './screens/AppRecoveryScreen': {AppRecoveryScreen}, './navigation/reader-route': {readerScreenOptions: () => ({}), useReaderPrewarm() {}},
  };
  for (const name of ['Login', 'Library', 'Reader', 'Settings', 'About', 'Feedback', 'DeleteAccount', 'Subscription', 'Debug', 'DiagnosticLog']) boundaries[`./screens/${name}Screen`] = {[`${name}Screen`]: nil};
  const {ApplicationRoutes} = await loadComponent('../../src/App.tsx', boundaries);
  const render = () => host.render(React.createElement(ApplicationRoutes));
  await render();
  assert(host.props.has('app-startup-recovery')); assert.equal(host.props.has('app-startup-surface'), false);
  assert.doesNotMatch(host.window.document.body.textContent, /Private storage detail/);
  const retry = controls.get('rss_retry').onPress;
  await act(async () => {retry(); retry();}); assert.equal(retries, 1);
  assert.equal(controls.get('rss_retry').disabled, true);
  await act(async () => gate.resolve()); await render();
  assert(screens.includes('Login')); assert.equal(host.props.has('app-startup-recovery'), false);
}));

async function libraryFixture(host) {
  const controls = new Map(), navigations = [], calls = {globalReads: 0, accountReads: 0, updates: 0, retries: 0, watches: 0};
  let listProps, readGate, updateGate;
  const contextValue = {bookmarkId: 'private-article', title: '  Private\nreading  ', collectionId: 'shared', collectionOwnerId: 'publisher'};
  const store = new PreferenceStore(new FixtureMemoryPreferences({continue_reading_bookmark: JSON.stringify(contextValue)}));
  const accountPreferences = {
    async read() {calls.accountReads++; if (readGate) await readGate.promise; return store.read();},
    async update(edit) {calls.updates++; if (updateGate) await updateGate.promise; return store.update(edit);},
  };
  const repositories = {
    library: {watch(_sort, _owner, callback) {calls.watches++; callback([]); return () => {};}},
    watchLibraryCollections: callback => {callback([]); return () => {};}, watchLibraryUser: callback => {callback([]); return () => {};},
    watchBookmarks(_sort, callback) {calls.watches++; callback([]); return () => {};},
    watchCollections: callback => {callback([]); return () => {};}, watchUser: () => () => {}, watchSubscription: () => () => {},
  };
  const context = {t: key => key, repositories: null, preferences: {read: async () => {calls.globalReads++; throw new Error('Unadmitted private read');}}, api: {}, sessions: {}, config: {platform: 'ios'}, nativeResourceOwner: null, upgrade: {status: 'checking'}, retryStart: async () => {calls.retries++;}};
  context.runtime = {getDatabase: () => null, getNativeResourceOwner: () => context.nativeResourceOwner, getRepositories: () => context.repositories, getAccountPreferences: () => context.nativeResourceOwner ? accountPreferences : null, getUpgradeSnapshot: () => context.upgrade};
  const primitive = props => {if (props.onPress) controls.set(props.accessibilityLabel ?? text(props.children), props); return React.createElement(host.native.View, props);};
  const FlatList = React.forwardRef((props, ref) => {listProps = props; React.useImperativeHandle(ref, () => ({scrollToOffset() {}}), []); return React.createElement(host.native.View, null, props.ListHeaderComponent, props.data.length ? null : props.ListEmptyComponent);});
  const native = {...host.native, Pressable: primitive, FlatList, PixelRatio: {roundToNearestPixel: value => value}, Platform: {OS: 'ios', select: options => options.default}, AppState: {currentState: 'active', addEventListener: () => ({remove() {}})}};
  const components = {...host.components, SourceProgress: primitive, SourceButton: primitive, ScreenSurface: primitive, Divider: nil, BookmarkRow: nil, LinkInputDialog: nil, RssFeed: nil, RssFeedSwitcher: nil, SourceMenu: nil};
  const {LibraryDataStatus} = await loadComponent('../../src/screens/LibraryDataStatus.tsx', {react: React, 'react-native': native, '../components': components, '../theme': theme});
  const rssState = {enabled: false};
  class RssController {subscribe = () => () => {}; getSnapshot = () => rssState; activate() {} dispose() {} cancel() {} poll() {} async load() {}}
  class FeedScrollPosition {reset() {}}
  const reset = () => {};
  const {LibraryScreen} = await loadComponent('../../src/screens/LibraryScreen.tsx', {
    react: React, 'react-native': native, '@react-navigation/native': {useFocusEffect: callback => React.useEffect(callback, [callback])},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 44, bottom: 34})}, 'expo-network': {useNetworkState: () => ({isConnected: false})},
    '../telemetry': {useTelemetry: () => telemetry}, '../components/LibrarySyncAvatar': {LibrarySyncAvatar: nil}, '../components/LibrarySyncStatus': {LibrarySyncStatus: nil}, '../components/SourceSyncAvatar': {SourceSyncAvatar: nil}, '../components/SourceLine': {SourceLine: props => React.createElement(host.native.View, null, props.text)}, '../components/SourceRing': {SourceCircle: nil}, '../components/SourceShape': {SourceShape: primitive}, '../components/sync-state': {sourceSyncState: () => ({kind: 'offline'})}, '../components/fixture-actions': {},
    '../components/PdfImportDialog': {PdfImportDialog: nil}, '../pdf/usePdfLab': {usePdfLab: () => ({ready: false, enabled: false})}, './LibraryDataStatus': {LibraryDataStatus},
    '../components': components, '../data': {readContinueReading}, '../rss/controller': {RssController}, '../runtime': {useMobile: () => context}, '../theme': theme, '../theme/testIds': {mobileTestIds: {EmptyInbox: 'empty-inbox'}}, './collection-selection': {CollectionSelection}, '../components/feed-scroll': {FeedScrollPosition, useFeedScrollPosition: () => ({events: {}, reset})}, '../components/SourceDrawer': {SourceDrawer: props => React.createElement(host.native.View, null, props.children, props.open ? props.drawer : null)}, '../components/FeedList': {FeedList: props => React.createElement(native.FlatList, props)}, '../utils/source-time': {parseSourceTimestamp},
  }, {setInterval, clearInterval});
  const render = () => {controls.clear(); return host.render(React.createElement(LibraryScreen, {navigation: {navigate: (...args) => navigations.push(args)}, route: {params: {}}}));};
  return {context, controls, calls, navigations, store, render, list: () => listProps, contextValue,
    admit() {Object.assign(context, {repositories, preferences: accountPreferences, nativeResourceOwner: 'admitted-owner', upgrade: {status: 'ready'}});},
    readGate(value) {readGate = value;}, updateGate(value) {updateGate = value;},
  };
}

test('mounted Library confines admission loading/recovery to data area and preserves safe navigation without consuming private preferences', nativeBoundary, async () => withNativeHost(async host => {
  const f = await libraryFixture(host); await f.render();
  assert.ok(host.window.document.querySelector('[data-testid="library-local-data-loading"]'));
  assert.equal(host.window.document.querySelector('[data-testid="empty-inbox"]'), null);
  assert.equal(f.controls.get('Add Link').disabled, true);
  for (const upgrade of [{status: 'verification-required', inventory: {}}, {status: 'error', error: new Error('Synthetic admission failure')}]) {
    f.context.upgrade = upgrade; await f.render();
    assert.ok(host.window.document.querySelector('[data-testid="library-local-data-recovery"]'));
    await act(async () => f.controls.get('Menu').onPress());
    await act(async () => f.controls.get('sidebar_about').onPress());
    await act(async () => f.controls.get('rss_retry').onPress());
  }
  assert.equal(f.navigations.length, 2); assert.equal(f.navigations[0][0], 'About');
  assert.equal(f.calls.retries, 2); assert.equal(f.calls.watches, 0); assert.equal(f.calls.globalReads, 0); assert.equal(f.calls.accountReads, 0); assert.equal(f.calls.updates, 0);
  assert.equal(f.controls.has('continue_reading_desc'), false);
  assert.ok((await f.store.read()).continue_reading_bookmark);
}));

test('mounted Library keeps admitted data without a previous-account reauthentication prompt', nativeBoundary, async () => withNativeHost(async host => {
  const f = await libraryFixture(host); f.admit();
  f.context.credentialState = {status: 'reauthentication-required'}; await f.render();
  assert.equal(host.window.document.querySelector('[data-testid="library-reauthentication"]'), null);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.calls.globalReads, 0);
}));

test('continue-reading waits for admitted repository and non-null owner, then opens with private context and fences a captured stale click', nativeBoundary, async () => withNativeHost(async host => {
  const f = await libraryFixture(host); await f.render();
  f.context.upgrade = {status: 'ready'}; await f.render();
  assert.equal(f.calls.accountReads, 0); assert.equal(f.calls.globalReads, 0);
  f.admit(); const gate = deferred(); f.readGate(gate); await f.render();
  assert.equal(f.controls.has('continue_reading_desc'), false); assert.equal(f.calls.updates, 0);
  await act(async () => gate.resolve());
  assert.equal(f.calls.updates, 1); assert.equal((await f.store.read()).continue_reading_bookmark, undefined);
  const click = f.controls.get('continue_reading_desc').onPress;
  await act(async () => click());
  assert.deepEqual(JSON.parse(JSON.stringify(f.navigations)), [['Reader', {bookmarkId: 'private-article', collectionOwnerId: 'publisher', collectionId: 'shared', openedFrom: 'bookmarks'}]]);
  f.context.nativeResourceOwner = null; f.context.repositories = null;
  await act(async () => click()); assert.equal(f.navigations.length, 1);
  await f.render(); assert.equal(f.controls.has('continue_reading_desc'), false);
}));

for (const boundary of ['read', 'update']) test(`continue-reading ${boundary} completion after admission revocation cannot consume or reveal private context`, nativeBoundary, async () => withNativeHost(async host => {
  const f = await libraryFixture(host), gate = deferred(); f.admit(); f[`${boundary}Gate`](gate); await f.render();
  f.context.nativeResourceOwner = null; f.context.repositories = null; f.context.upgrade = {status: 'error', error: new Error('Revoked')}; await f.render();
  await act(async () => gate.resolve());
  assert.ok((await f.store.read()).continue_reading_bookmark);
  assert.equal(f.controls.has('continue_reading_desc'), false); assert.equal(f.navigations.length, 0);
}));

test('mounted MobileProvider exposes no repository or cache before admission, even with provisional runtime services', nativeBoundary, async () => withNativeHost(async host => {
  const listeners = new Set(), credentialListeners = new Set(), session = {status: 'authenticated', session: {userId: 'local', token: 'synthetic'}};
  let upgrade = {status: 'checking'}, owner = 'provisional', visible, getters = 0, credentialState = {status: 'idle'}, restartGate, starts = 0, stops = 0, signOuts = 0;
  const preferences = {subscribe: () => () => {}, read: async () => ({})};
  const repositories = {library: {watch: () => () => {}}, watchLibraryCollections: () => () => {}, watchLibraryUser: () => () => {}}, cache = {};
  const runtime = {
    sessions: {subscribe: () => () => {}, getSnapshot: () => session, prepareRequest: async () => {}, signOut: async clear => {signOuts++; assert.equal(clear, false);}},
    getUpgradeSnapshot: () => upgrade, subscribeUpgrade: callback => {listeners.add(callback); return () => listeners.delete(callback);},
    getNativeResourceOwner: () => owner, getAccountPreferences: () => owner ? preferences : null,
    getRepositories: () => {getters++; return repositories;}, getCache: () => {getters++; return cache;},
    api: {options: {baseUrl: 'https://fixture.test'}}, preferences,
    credentials: {subscribe: callback => {credentialListeners.add(callback); return () => credentialListeners.delete(callback);}, getSnapshot: () => credentialState},
    start: async () => {starts++;}, stop: async () => {stops++; if (restartGate) await restartGate.promise;}, setForeground: async () => {},
    isLibraryPresented: () => false, subscribeLibraryPresented: () => () => {},
  };
  const {MobileProvider, useMobile} = await loadComponent('../../src/runtime.tsx', {
    react: React, 'react-native': {...host.native, Platform: {OS: 'android'}}, 'expo-localization': {getLocales: () => [{languageTag: 'en'}]}, 'expo-file-system': {},
    './data': {createMobileDataRuntime: () => runtime}, './i18n': {normalizeLocale: value => value, createTranslator: () => key => key}, './config': {mobileConfig: {apiUrl: 'https://fixture.test'}}, './reader/security.ts': {readerProtectedHosts: () => ['fixture.test'], readerImageProxyOrigins: () => ['https://fixture.test']},
    './payments/controller': {PaymentController: class {}}, './payments/expo-store': {createExpoStore: () => ({})}, './native/platform': {setWebSessionCookie: async () => {}}, './controlled-upgrade-visibility': {},
    './system-actions/SaveURLHost': {SaveURLHost: () => null}
  });
  function Probe() {visible = useMobile(); return null;}
  await host.render(React.createElement(MobileProvider, null, React.createElement(Probe)));
  assert.equal(visible.repositories, null); assert.equal(visible.cache, null); assert.equal(getters, 0);
  for (const next of [{status: 'error', error: new Error('Pending admission')}, {status: 'verification-required', inventory: {}}]) {
    await act(async () => {upgrade = next; for (const callback of listeners) callback();});
    assert.equal(visible.repositories, null); assert.equal(visible.cache, null); assert.equal(getters, 0);
  }
  await act(async () => {owner = null; upgrade = {status: 'ready'}; for (const callback of listeners) callback();});
  assert.equal(visible.repositories, null); assert.equal(visible.cache, null); assert.equal(getters, 0);
  await act(async () => {owner = 'admitted'; upgrade = {status: 'ready'}; for (const callback of listeners) callback();});
  assert.equal(visible.repositories, repositories); assert.equal(visible.cache, cache);
  await act(async () => {credentialState = {status: 'reauthentication-required'}; for (const callback of credentialListeners) callback();});
  assert.equal(visible.credentialState.status, 'reauthentication-required'); assert.equal(visible.repositories, repositories); assert.equal(signOuts, 1, 'Rejected credentials drop the session without a previous-account prompt');
  restartGate = deferred();
  const first = visible.retryStart(), second = visible.retryStart();
  assert.equal(first, second); assert.equal(stops, 1);
  await act(async () => {restartGate.resolve(); await first;});
  assert.equal(starts, 2);
}));
