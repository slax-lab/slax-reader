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
async function load(file, boundaries) {
  const passthrough = ({children}) => children ?? null;
  const drawer = {SourceDrawer: passthrough, DrawerScrollBoundary: passthrough, useDrawerGesture: () => null, useDrawerInput: () => null};
  boundaries = {'./SourceDrawer': drawer, '../components/SourceDrawer': drawer, '../components/SearchGlyph': {SearchGlyph: () => null}, '../utils/source-url': sourceUrls,
    ...observeRelativeBoundaries(boundaries), ...boundaries};
  const code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, __DEV__: false, setInterval, clearInterval, require: name => {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}});
  return exports;
}
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

test('actual feed hook preserves two unmounted feeds, fences provisional native zero and retains explicit resets', async () => mounted(async root => {
  const {FeedScrollPosition, useFeedScrollPosition} = await load('../../src/components/feed-scroll.ts', {react: React});
  const inbox = new FeedScrollPosition(), rss = new FeedScrollPosition();
  let props, select, active = 'inbox'; const commands = [];
  function Feed({position}) {
    const scrollTo = React.useCallback((offset, animated = false) => commands.push([active, offset, animated]), []);
    props = useFeedScrollPosition(position, scrollTo); return null;
  }
  function Harness() {const [value, setValue] = React.useState('inbox'); select = setValue; active = value; return React.createElement(Feed, {key: value, position: value === 'inbox' ? inbox : rss});}
  const observed = y => ({nativeEvent: {contentOffset: {y}}});
  const layout = height => ({nativeEvent: {layout: {height}}});
  await act(async () => root.render(React.createElement(Harness)));
  props.events.onScroll(observed(420));
  await act(async () => select('rss'));
  rss.select('feed-a'); props.events.onScroll(observed(195));
  await act(async () => select('inbox'));
  props.events.onScroll(observed(0));
  assert.equal(inbox.offset, 420, 'A new native list emits zero before its retained position can be restored');
  props.events.onLayout(layout(500)); props.events.onContentSizeChange(300, 600);
  assert.deepEqual(commands, [], 'A provisional native content height cannot clamp a retained position');
  props.events.onContentSizeChange(300, 1400);
  assert.deepEqual(commands, [['inbox', 420, false]]);
  props.events.onScroll(observed(420));
  await act(async () => select('rss'));
  props.events.onLayout(layout(500)); props.events.onContentSizeChange(300, 1000);
  assert.deepEqual(commands.at(-1), ['rss', 195, false]);
  props.events.onScroll(observed(195));
  rss.select('feed-a'); assert.equal(rss.offset, 195, 'Reentering the same RSS source preserves its saved position');
  rss.select('feed-b'); props.reset(); assert.equal(rss.offset, 0, 'An actual source change resets instead of restoring the old source');
  props.events.onScroll(observed(195)); assert.equal(rss.offset, 0, 'A late old scroll callback cannot undo the explicit reset');
  props.events.onScroll(observed(0)); props.events.onScrollBeginDrag(); props.events.onScroll(observed(75));
  assert.equal(rss.offset, 75);
}));

test('coarse scroll sampling still records the exact resting offset from drag and momentum end events', async () => mounted(async root => {
  const {FeedScrollPosition, useFeedScrollPosition} = await load('../../src/components/feed-scroll.ts', {react: React});
  const position = new FeedScrollPosition(), commands = []; let props;
  function Feed() {const scrollTo = React.useCallback(offset => commands.push(offset), []); props = useFeedScrollPosition(position, scrollTo); return null;}
  const observed = y => ({nativeEvent: {contentOffset: {y}, contentSize: {height: 2000}, layoutMeasurement: {height: 500}}});
  await act(async () => root.render(React.createElement(Feed)));
  assert.ok(props.events.scrollEventThrottle >= 32, 'Feed scroll callbacks are sampled below display rate');
  props.events.onScrollBeginDrag(); props.events.onScroll(observed(180));
  props.events.onScrollEndDrag(observed(212)); assert.equal(position.offset, 212);
  props.events.onMomentumScrollEnd(observed(640.5)); assert.equal(position.offset, 640.5);
  props.events.onMomentumScrollEnd(observed(1800)); assert.equal(position.offset, 1500, 'End events clamp to the scrollable range');
  props.events.onMomentumScrollEnd(observed(0)); assert.equal(position.offset, 0);
  position.offset = 420; await act(async () => root.render(React.createElement(Feed, {key: 'remount'})));
  props.events.onMomentumScrollEnd(observed(0));
  assert.equal(position.offset, 420, 'A provisional end event cannot overwrite a pending restore');
  assert.deepEqual(commands, []);
}));

test('mounted RSS uses its retained source identity rather than resetting each time the mode is entered', async () => mounted(async root => {
  const scrolling = await load('../../src/components/feed-scroll.ts', {react: React});
  const position = new scrolling.FeedScrollPosition(); position.source = 'feed-a'; position.offset = 270;
  const commands = []; let listProps, selected = 'feed-a', entries = [{id: 'existing-entry'}];
  const primitive = ({children}) => React.createElement('div', null, children), nil = () => null;
  const FlatList = React.forwardRef((props, ref) => {
    listProps = {...props, instance: React.useRef(Symbol('native-rss-list')).current}; React.useImperativeHandle(ref, () => ({scrollToOffset: value => commands.push(value)}), []); return null;
  });
  const {RssFeed} = await load('../../src/components/RssFeed.tsx', {
    react: React, 'react-native': {FlatList, View: primitive, Pressable: primitive, ScrollView: primitive, Image: nil, TextInput: nil, ActivityIndicator: nil, StyleSheet: {create: value => value}},
    '../runtime': {useMobile: () => ({t: value => value})}, '../rss/controller': {rssDisplayName: () => 'Feed'}, '../theme': {mobileColors: {}, mobileTypography: {}},
    './SourceUI': {SourceButton: nil, SourceDialog: nil, SourceIcon: nil, SourceSheet: nil, SourceText: primitive, SourceProgress: nil, TextAction: nil, Divider: nil}, './SourceMenu': {SourceMenu: nil},
    './AppImage': {AppImage: nil}, './fixture-actions': {}, './feed-scroll': scrolling,
  });
  const state = () => ({enabled: true, selected, subscriptions: [], entries, ready: true, busy: false, hasMore: false});
  const dismiss = () => {}, controller = {};
  const render = () => React.createElement(RssFeed, {state: state(), scrollPosition: position, controller, adding: false, onDismissAdd: dismiss});
  await act(async () => root.render(render()));
  assert.deepEqual(commands, [], 'Mounting the same source does not issue an eager zero-offset command');
  listProps.onLayout({nativeEvent: {layout: {height: 500}}}); listProps.onContentSizeChange(300, 1500);
  assert.equal(commands.at(-1).offset, 270);
  listProps.onScroll({nativeEvent: {contentOffset: {y: 270}}});
  const unmounted = listProps;
  await act(async () => root.render(null));
  await act(async () => root.render(render()));
  const beforeStale = commands.length;
  unmounted.onScrollBeginDrag(); unmounted.onScroll({nativeEvent: {contentOffset: {y: 0}}});
  unmounted.onLayout({nativeEvent: {layout: {height: 500}}}); unmounted.onContentSizeChange(300, 500); unmounted.onEndReached({distanceFromEnd: 0});
  assert.equal(position.offset, 270, 'An unmounted RSS list cannot overwrite the retained position of its replacement');
  assert.equal(commands.length, beforeStale, 'An unmounted RSS list cannot issue a restoration command');
  listProps.onLayout({nativeEvent: {layout: {height: 500}}}); listProps.onContentSizeChange(300, 1500);
  assert.equal(commands.at(-1).offset, 270);
  listProps.onScroll({nativeEvent: {contentOffset: {y: 270}}});
  const currentInstance = listProps.instance;
  entries = [{id: 'prepended-entry'}, ...entries]; await act(async () => root.render(render()));
  assert.equal(listProps.instance, currentInstance, 'Same-source incoming rows preserve the native list lifetime');
  assert.deepEqual({...listProps.maintainVisibleContentPosition}, {minIndexForVisible: 0});
  assert.deepEqual(Array.from(listProps.data, value => listProps.keyExtractor(value)), ['prepended-entry', 'existing-entry']);
  assert.equal(position.offset, 270, 'A row update does not issue an application pixel reset');
  const beforeSourceChange = listProps, beforeSwitch = commands.length;
  selected = 'feed-b'; await act(async () => root.render(render()));
  assert.equal(commands.length, beforeSwitch + 1, 'A source change issues exactly one scroll command');
  assert.equal(commands.at(-1).offset, 0); assert.equal(position.source, 'feed-b'); assert.equal(position.offset, 0);
  assert.equal(listProps.instance, currentInstance, 'Changing RSS source keeps the native list and source rail mounted');
  assert.equal(listProps.maintainVisibleContentPosition, undefined, 'A new source starts with native anchoring disabled');
  listProps.onScroll({nativeEvent: {contentOffset: {y: 0}}});
  beforeSourceChange.onScrollBeginDrag(); beforeSourceChange.onScroll({nativeEvent: {contentOffset: {y: 400}}});
  assert.equal(position.offset, 0, 'A callback captured for the old source cannot move the newly selected source');
}));

test('RSS rail offers All first and returns to the combined timeline from a source', async () => mounted(async root => {
  const tabs = [], primitive = ({children}) => React.createElement('div', null, children);
  const {RssFeedSwitcher} = await load('../../src/components/RssFeed.tsx', {
    react: React, 'react-native': {FlatList: () => null, View: primitive, Pressable: props => {if (props.accessibilityRole === 'tab') tabs.push(props); return primitive(props);}, ScrollView: primitive, Image: () => null, TextInput: null, ActivityIndicator: null, StyleSheet: {create: value => value}},
    '../runtime': {useMobile: () => ({t: value => value})}, '../rss/controller': {rssDisplayName: () => 'Feed'}, '../theme': {mobileColors: {}, mobileTypography: {}},
    './SourceUI': {SourceButton: () => null, SourceDialog: () => null, SourceIcon: () => null, SourceText: primitive, SourceProgress: () => null, TextAction: () => null, Divider: () => null}, './SourceMenu': {SourceMenu: () => null},
    './AppImage': {AppImage: () => null}, './fixture-actions': {}, './feed-scroll': await load('../../src/components/feed-scroll.ts', {react: React}),
  });
  const calls = [], state = {enabled: true, selected: null, subscriptions: [{id: 'feed-a', title: 'A'}, {id: 'feed-b', title: 'B'}], entries: [], ready: true, busy: false, hasMore: false};
  const controller = {select: id => {calls.push(id); return Promise.resolve(true);}};
  const render = () => React.createElement(RssFeedSwitcher, {state: {...state}, controller, onAdd() {}});
  await act(async () => root.render(render()));
  assert.equal(tabs.length, 3, 'All precedes the two subscriptions');
  assert.equal(tabs[0].accessibilityLabel, 'rss_all'); assert.equal(tabs[0].accessibilityState.selected, true);
  assert.equal(tabs[1].accessibilityState.selected, false);
  await act(async () => tabs[0].onPress());
  assert.deepEqual(calls, [null], 'All selects the combined timeline');
  state.selected = 'feed-a'; tabs.length = 0; await act(async () => root.render(render()));
  assert.equal(tabs[0].accessibilityState.selected, false);
  assert.equal(tabs[1].accessibilityState.selected, true);
}));

test('feed cleanup rejects captured reset and native callbacks while StrictMode remount setup remains live', async () => mounted(async root => {
  const {FeedScrollPosition, useFeedScrollPosition} = await load('../../src/components/feed-scroll.ts', {react: React});
  const position = new FeedScrollPosition(); position.offset = 310;
  let props; const commands = [];
  function Feed() {const scrollTo = React.useCallback(value => commands.push(value), []); props = useFeedScrollPosition(position, scrollTo); return null;}
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Feed))));
  props.events.onLayout({nativeEvent: {layout: {height: 500}}}); props.events.onContentSizeChange(300, 1500);
  assert.deepEqual(commands, [310], 'StrictMode setup after cleanup restores the live hook lifetime');
  props.events.onScroll({nativeEvent: {contentOffset: {y: 310}}});
  const unmounted = props;
  await act(async () => root.render(null));
  await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(Feed))));
  const beforeStale = commands.length;
  unmounted.reset(true); unmounted.events.onScrollBeginDrag(); unmounted.events.onScroll({nativeEvent: {contentOffset: {y: 0}}});
  unmounted.events.onLayout({nativeEvent: {layout: {height: 500}}}); unmounted.events.onContentSizeChange(300, 2000); unmounted.events.onEndReached({distanceFromEnd: 0});
  assert.equal(position.offset, 310, 'An obsolete reset cannot clear the position shared with a newly mounted list');
  assert.equal(commands.length, beforeStale);
  props.events.onLayout({nativeEvent: {layout: {height: 500}}}); props.events.onContentSizeChange(300, 1500);
  assert.equal(commands.at(-1), 310);
}));

test('actual Library preserves both modes through toggles and gives a new native account owner fresh positions', async () => mounted(async root => {
  const scrolling = await load('../../src/components/feed-scroll.ts', {react: React});
  const selection = await load('../../src/screens/collection-selection.ts', {});
  const commands = [], lists = {}, menus = [], tabs = [], markedRead = []; let owner = 'account-a', rssPosition, inboxPosition, inboxReset, inboxWatch;
  const primitive = ({children}) => React.createElement('div', null, children), nil = () => null;
  const FlatList = React.forwardRef((props, ref) => {lists.inbox = {...props, instance: React.useRef(Symbol('native-inbox-list')).current}; React.useImperativeHandle(ref, () => ({scrollToOffset: value => commands.push(['inbox', value.offset])}), []); return props.ListHeaderComponent;});
  function RssFeed({scrollPosition}) {rssPosition = scrollPosition; const scrollTo = React.useCallback(offset => commands.push(['rss', offset]), []); lists.rss = {...scrolling.useFeedScrollPosition(scrollPosition, scrollTo).events, instance: React.useRef(Symbol('rss-component')).current}; return null;}
  const rssState = {enabled: true, selected: 'feed-a', subscriptions: [], entries: [], ready: true, busy: false, hasMore: false};
  class RssController {subscribe = () => () => {}; getSnapshot = () => rssState; activate() {} dispose() {} cancel() {} poll() {} async load() {}}
  const telemetry = {track() {}, element() {}, firebase() {}}, preferences = {}, api = {};
  const runtime = {getDatabase: () => null, getNativeResourceOwner: () => owner};
  const collections = [{id: 'collection-a', name: 'Collection', ownerId: 'owner-a', status: 1, subscriptionEndTime: '2080-01-01T00:00:00Z', hasNew: true}];
  const bookmarks = [{id: 'existing-bookmark'}];
  const repositories = {library: {watch: (_sort, _owner, callback) => {inboxWatch = callback; callback(bookmarks); return () => {};}},
    watchLibraryCollections: callback => {callback(collections); return () => {};}, watchLibraryUser: callback => {callback([]); return () => {};}, watchBookmarks: (_sort, callback) => {inboxWatch = callback; callback(bookmarks); return () => {};}, watchCollections: callback => {callback(collections); return () => {};}, watchUser: () => () => {}, watchSubscription: () => () => {}, watchCollectionBookmarks: () => () => {}, markCollectionRead: async id => {markedRead.push(id);}};
  Object.assign(runtime, {getRepositories: () => repositories, getAccountPreferences: () => preferences, getUpgradeSnapshot: () => ({status: 'ready'})});
  const context = {t: value => value, repositories, preferences, runtime, api, sessions: {}, config: {platform: 'android'}, upgrade: {status: 'ready'}};
  const components = Object.fromEntries(['BookmarkRow', 'Divider', 'LinkInputDialog', 'RssFeedSwitcher', 'SourceAvatar', 'SourceButton', 'SourceDialog', 'SourceIcon', 'SourceProgress', 'TextAction'].map(name => [name, nil]));
  const {LibraryScreen} = await load('../../src/screens/LibraryScreen.tsx', {
    react: React, 'react-native': {View: primitive, Pressable: props => {if (props.accessibilityRole === 'tab') tabs.push(props); return primitive(props);}, ScrollView: primitive, FlatList, ActivityIndicator: nil, Animated: {}, AppState: {currentState: 'active', addEventListener: () => ({remove() {}})}, Linking: {}, PixelRatio: {roundToNearestPixel: value => value}, Platform: {OS: 'android', select: values => values.android}, StyleSheet: {create: value => value, absoluteFill: {}}, useWindowDimensions: () => ({width: 400, height: 800})},
    '@react-navigation/native': {useFocusEffect: callback => React.useEffect(callback, [callback])}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0})}, 'expo-network': {useNetworkState: () => ({isConnected: true})},
    '../telemetry': {useTelemetry: () => telemetry}, '../components/LibrarySyncAvatar': {LibrarySyncAvatar: nil}, '../components/LibrarySyncStatus': {LibrarySyncStatus: nil}, '../components/SourceSyncAvatar': {SourceSyncAvatar: nil}, '../components/SourceLine': {SourceLine: nil}, '../components/SourceRing': {SourceCircle: nil}, '../components/SourceShape': {SourceShape: primitive}, '../components/sync-state': {sourceSyncState: () => ({kind: 'idle'})}, '../components/fixture-actions': {},
    './LibraryDataStatus': {LibraryDataStatus: nil}, '../components/PdfImportDialog': {PdfImportDialog: nil}, '../pdf/usePdfLab': {usePdfLab: () => ({ready: true, enabled: false})},
    '../components': {...components, RssFeed, ScreenSurface: primitive, SourceText: primitive, SourceMenu: props => {menus.push(props); return null;}}, '../components/useVisibleSnapshot': await load('../../src/components/useVisibleSnapshot.ts', {react: React}), '../data': {readContinueReading: async () => null}, '../rss/controller': {RssController}, '../runtime': {useMobile: () => ({...context, nativeResourceOwner: owner})},
    '../theme': {mobileColors: {}, mobileLayout: {drawerMaximumWidth: 320, librarySwipeActionHeight: 53}, mobileTypography: {}}, '../theme/testIds': {mobileTestIds: {}}, './collection-selection': selection, '../utils/source-time': await load('../../src/utils/source-time.ts', {}), '../components/feed-scroll': {...scrolling, useFeedScrollPosition: (...args) => {const value = scrolling.useFeedScrollPosition(...args); inboxPosition = args[0]; inboxReset = value.reset; return value;}}, '../components/SourceDrawer': {SourceDrawer: primitive, DrawerScrollBoundary: ({children}) => children},
  });
  const render = () => React.createElement(LibraryScreen, {navigation: {navigate() {}}, route: {params: {}}});
  const observe = (mode, y) => lists[mode].onScroll({nativeEvent: {contentOffset: {y}}});
  const restore = mode => {lists[mode].onLayout({nativeEvent: {layout: {height: 500}}}); lists[mode].onContentSizeChange(300, 1600);};
  const select = label => act(async () => menus.at(-1).items.find(item => item.label === label).onPress());
  await act(async () => root.render(render())); observe('inbox', 0); observe('inbox', 420);
  const firstInbox = lists.inbox.instance, renderBookmark = lists.inbox.renderItem;
  assert.equal(lists.inbox.getItemLayout, undefined, 'Wait for the scrolling collection header measurement');
  await act(async () => lists.inbox.ListHeaderComponent.props.onLayout({nativeEvent: {layout: {height: 104}}}));
  assert.deepEqual({...lists.inbox.getItemLayout(bookmarks, 3)}, {index: 3, length: 53, offset: 264.5}, 'Fixed rows include the measured collection header and separators');
  await act(async () => inboxWatch([{id: 'prepended-bookmark'}, ...bookmarks]));
  assert.equal(lists.inbox.renderItem, renderBookmark, 'Incoming rows do not rebuild all row action callbacks');
  assert.equal(lists.inbox.instance, firstInbox, 'A same-feed sync update retains the native list anchor');
  assert.deepEqual({...lists.inbox.maintainVisibleContentPosition}, {minIndexForVisible: 0});
  assert.deepEqual(Array.from(lists.inbox.data, value => lists.inbox.keyExtractor(value)), ['prepended-bookmark', 'existing-bookmark']);
  assert.equal(inboxPosition.offset, 420);
  await select('rss_feeds'); observe('rss', 195); const firstRss = lists.rss;
  await select('inbox_title'); observe('inbox', 0); restore('inbox'); assert.deepEqual(commands.at(-1), ['inbox', 420]); observe('inbox', 420);
  await select('rss_feeds'); observe('rss', 0); restore('rss'); assert.deepEqual(commands.at(-1), ['rss', 195]); observe('rss', 195);
  assert.equal(commands.filter(([mode, offset]) => mode === 'inbox' && offset === 0).length, 1, 'The account initialization effect does not run again on a mode switch');
  assert.equal(rssPosition.offset, 195);
  const oldPosition = rssPosition, staleRss = lists.rss, staleReset = inboxReset; owner = 'account-b'; await act(async () => root.render(render()));
  assert.notEqual(rssPosition, oldPosition, 'A new account owner receives a distinct saved-position scope');
  assert.notEqual(lists.rss.instance, staleRss.instance, 'The native owner key also remounts the RSS component');
  assert.equal(rssPosition.offset, 0); assert.equal(rssPosition.source, undefined);
  const beforeStale = commands.length;
  firstRss.onScroll({nativeEvent: {contentOffset: {y: 600}}}); staleRss.onScroll({nativeEvent: {contentOffset: {y: 700}}}); staleReset(true);
  assert.equal(rssPosition.offset, 0);
  assert.equal(commands.length, beforeStale, 'Captured account-A reset cannot issue a command against B');
  await select('inbox_title'); restore('inbox'); observe('inbox', 0); observe('inbox', 95);
  const selectCollection = tabs.at(-1).onPress;
  const inboxBeforeCollection = lists.inbox;
  await select('rss_feeds'); observe('rss', 55);
  await select('inbox_title'); restore('inbox'); assert.deepEqual(commands.at(-1), ['inbox', 95]);
  await select('rss_feeds'); restore('rss'); observe('rss', 55);
  const beforeCollection = commands.length;
  await act(async () => selectCollection());
  assert.equal(commands.length, beforeCollection, 'A collection reset while Inbox is absent does not scroll the RSS native list');
  assert.deepEqual(markedRead, ['collection-a']); assert.equal(rssPosition.offset, 55);
  await select('inbox_title'); observe('inbox', 0); observe('inbox', 120);
  assert.notEqual(lists.inbox.instance, inboxBeforeCollection.instance, 'Explicit collection selection does not reuse old native anchor state');
  inboxBeforeCollection.onScrollBeginDrag(); inboxBeforeCollection.onScroll({nativeEvent: {contentOffset: {y: 999}}});
  assert.equal(inboxPosition.offset, 120, 'Captured old collection callbacks cannot overwrite the active collection');
  assert.equal(commands.length, beforeCollection, 'The selected collection begins at top instead of restoring the old Inbox offset');
}));

test('the mounted Library feed hook fences old native callbacks across RSS absence and return', async () => mounted(async root => {
  const {FeedScrollPosition, useFeedScrollPosition} = await load('../../src/components/feed-scroll.ts', {react: React});
  const position = new FeedScrollPosition(); let props, toggle; const commands = [];
  function Harness() {
    const [active, setActive] = React.useState(true); toggle = setActive;
    const scrollTo = React.useCallback(offset => commands.push(offset), []);
    props = useFeedScrollPosition(position, scrollTo, active); return null;
  }
  const observed = y => ({nativeEvent: {contentOffset: {y}}});
  await act(async () => root.render(React.createElement(Harness)));
  const old = props.events; old.onScroll(observed(380));
  await act(async () => toggle(false)); old.onScroll(observed(0)); old.onScrollBeginDrag();
  assert.equal(position.offset, 380);
  await act(async () => toggle(true));
  old.onScroll(observed(0)); old.onScrollBeginDrag();
  props.events.onLayout({nativeEvent: {layout: {height: 500}}}); props.events.onContentSizeChange(300, 1400);
  assert.deepEqual(commands, [380], 'Only the fresh actual list callback can restore the retained Inbox');
  props.events.onScroll(observed(380)); assert.equal(position.offset, 380);
  props.reset(); props.events.onScroll(observed(380)); assert.equal(position.offset, 0);
  props.events.onScroll(observed(0)); assert.equal(position.offset, 0);
}));

for (const platform of ['android', 'ios']) test(`actual ${platform} drawer uses installed worklet gestures, reversible timing and visible-only Back`, async () => mounted(async root => {
  const {installedMotionHost, loadWorkletComponent} = await import('./installed-motion-host.mjs');
  const changes = []; let back, setOpen, scrimStyle;
  const primitive = props => {if (props.pointerEvents === 'none') scrimStyle = props.style; return React.createElement('div', null, props.children);};
  const motion = installedMotionHost(primitive);
  const {SourceDrawer} = loadWorkletComponent(new URL('../../src/components/SourceDrawer.tsx', import.meta.url), {
    react: React, 'react-native': {View: primitive, Pressable: primitive, Platform: {OS: platform}, StyleSheet: {absoluteFill: {}}, BackHandler: {addEventListener: (_name, callback) => {back = callback; return {remove() {back = undefined;}}}}},
    'react-native-gesture-handler': motion.gestures, 'react-native-reanimated': motion.reanimated,
    '@react-navigation/native': {useFocusEffect: callback => React.useEffect(callback, [callback])},
  });
  function Harness() {const [open, update] = React.useState(false); setOpen = update; return React.createElement(SourceDrawer, {open, width: 320, onOpenChange: value => {changes.push(value); update(value);}, drawer: 'Drawer', children: 'Feed'});}
  await act(async () => root.render(React.createElement(Harness)));
  const opening = () => motion.detectors()[0], closing = () => motion.detectors()[1];
  const drag = async (gesture, dx, velocity = 0, success = true) => act(async () => {gesture.handlers.onStart(); const calls = motion.jsCalls.length; gesture.handlers.onUpdate({translationX: dx}); assert.equal(motion.jsCalls.length, calls, 'Tracking never dispatches to JS'); gesture.handlers.onEnd({velocityX: velocity}, success); gesture.handlers.onFinalize({}, success);});
  assert.equal(back, undefined); assert.equal(motion.pending(), 0);
  const slop = platform === 'ios' ? 10 : 8;
  assert.equal(opening().config.activeOffsetXEnd, slop); assert.equal(opening().config.failOffsetXStart, -slop);
  assert.equal(opening().config.failOffsetYStart, -slop); assert.equal(opening().config.failOffsetYEnd, slop);
  assert.equal(opening().shouldUseReanimated, true); assert.equal(closing().shouldUseReanimated, true);
  await drag(opening(), 110); await act(async () => motion.advance(300));
  assert.deepEqual(changes, []); assert.equal(back, undefined);
  await drag(opening(), 180); await act(async () => motion.advance(300));
  assert.deepEqual(changes, [true]); assert.ok(back);
  assert.equal(scrimStyle.find(value => value.backgroundColor)?.backgroundColor, 'rgba(0, 0, 0, 0.32)');
  await drag(closing(), -210, -450, false); await act(async () => motion.advance(300));
  assert.deepEqual(changes, [true]); assert.equal(motion.values[0].value, 1);
  await act(async () => assert.equal(back(), true));
  await act(async () => motion.advance(100));
  const interrupted = motion.values[0].value;
  assert.ok(interrupted > 0 && interrupted < 1);
  await drag(closing(), 20, 450);
  assert.ok(Math.abs(motion.values[0].value - Math.min(1, interrupted + 20 / 320)) < 1e-9, 'Reversing continues at the actual in-flight position');
  await act(async () => motion.advance(300)); assert.equal(motion.values[0].value, 1);
  await act(async () => setOpen(false)); await act(async () => motion.advance(300)); assert.equal(back, undefined);
  const beforeCancel = changes.length;
  await drag(opening(), 240, 450, false); await act(async () => motion.advance(300));
  assert.equal(changes.length, beforeCancel); assert.equal(back, undefined);
}));

test('source circular progress forwards pinned center and saving geometry through the owned native ring', async () => {
  const {SourceCircularProgress} = await load('../../src/components/SourceRing.tsx', {
    react: React, 'react-native': {View: 'View', Platform: {OS: 'android'}, PixelRatio: {roundToNearestPixel: value => value}},
    'expo': {requireNativeView: () => 'NativeRing'},
  });
  for (const props of [{color: '#B45837'}, {color: '#B45837', size: 14, thickness: 1.5}]) {
    const progress = SourceCircularProgress(props), ringElement = progress.props.children;
    assert.equal(progress.props.accessibilityRole, 'progressbar');
    assert.equal(ringElement.props.size, props.size ?? 40); assert.equal(ringElement.props.thickness, props.thickness ?? 4);
    const native = ringElement.type(ringElement.props).props.children;
    assert.equal(native.props.geometry, 'material'); assert.equal(native.props.indeterminate, true); assert.equal(native.props.track, '#00000000');
    assert.equal(native.props.diameter, props.size ?? 40); assert.equal(native.props.thickness, props.thickness ?? 4);
  }
});
