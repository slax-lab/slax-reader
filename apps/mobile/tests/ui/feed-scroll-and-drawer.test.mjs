import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React, {act} from 'react';
import {observeRelativeBoundaries} from '../reader/observe-mock.mjs';

const require = createRequire(import.meta.url);
const domPath = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});
async function load(file, boundaries, globals = {}) {
  const passthrough = ({children}) => children ?? null;
  const drawer = {SourceDrawer: passthrough};
  boundaries = {'./SourceDrawer': drawer, '../components/SourceDrawer': drawer, '../components/SearchGlyph': {SearchGlyph: () => null},
    ...observeRelativeBoundaries(boundaries), ...boundaries};
  const code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, __DEV__: false, setInterval, clearInterval, ...globals, require: name => {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}});
  return exports;
}
/** The production FeedList over a test FlatList; the clock steps past the scroll sampling window per event. */
async function feedList(FlatList, {platform = 'ios', step = 1000, timers = {setTimeout, clearTimeout}} = {}) {
  let now = 0;
  return load('../../src/components/FeedList.tsx', {react: React, 'react-native': {FlatList, Platform: {OS: platform}}}, {Date: {now: () => now += step}, ...timers});
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
    './AppImage': {AppImage: nil}, './fixture-actions': {}, './feed-scroll': scrolling, './FeedList': await feedList(FlatList),
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
  assert.deepEqual({...listProps.maintainVisibleContentPosition}, {minIndexForVisible: 0, autoscrollToTopThreshold: 1});
  assert.deepEqual(Array.from(listProps.data, value => listProps.keyExtractor(value)), ['prepended-entry', 'existing-entry']);
  assert.equal(position.offset, 270, 'A row update does not issue an application pixel reset');
  const beforeSourceChange = listProps, beforeSwitch = commands.length;
  selected = 'feed-b'; await act(async () => root.render(render()));
  assert.equal(commands.length, beforeSwitch + 1, 'A source change issues exactly one scroll command');
  assert.equal(commands.at(-1).offset, 0); assert.equal(commands.at(-1).animated, false, 'A source change lands at the top without an animation');
  assert.equal(position.source, 'feed-b'); assert.equal(position.offset, 0);
  assert.equal(listProps.instance, currentInstance, 'Changing RSS source keeps the native list and source rail mounted');
  assert.equal(listProps.maintainVisibleContentPosition, undefined, 'A replaced source is not a prepend: no native autoscroll-to-top animation or old-row anchoring');
  entries = [{id: 'feed-b-entry'}]; await act(async () => root.render(render()));
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 40));});
  assert.deepEqual({...listProps.maintainVisibleContentPosition}, {minIndexForVisible: 0, autoscrollToTopThreshold: 1}, 'Visible-position adjustment returns once the new source has rendered');
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
    './AppImage': {AppImage: () => null}, './fixture-actions': {}, './feed-scroll': await load('../../src/components/feed-scroll.ts', {react: React}), './FeedList': {FeedList: () => null},
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
  const busy = [];
  function RssFeed({scrollPosition}) {rssPosition = scrollPosition; const scrollTo = React.useCallback(offset => commands.push(['rss', offset]), []); lists.rss = {...scrolling.useFeedScrollPosition(scrollPosition, scrollTo).events, instance: React.useRef(Symbol('rss-component')).current}; return null;}
  const rssState = {enabled: true, selected: 'feed-a', subscriptions: [], entries: [], ready: true, busy: false, hasMore: false};
  class RssController {subscribe = () => () => {}; getSnapshot = () => rssState; activate() {} dispose() {} cancel() {} poll() {} async load() {}}
  const telemetry = {track() {}, element() {}, firebase() {}}, preferences = {}, api = {};
  const runtime = {getDatabase: () => null, getNativeResourceOwner: () => owner, setInteractionBusy: (value, source) => busy.push([value, source])};
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
    '../theme': {mobileColors: {}, mobileLayout: {drawerMaximumWidth: 320, librarySwipeActionHeight: 53}, mobileTypography: {}}, '../theme/testIds': {mobileTestIds: {}}, './collection-selection': selection, '../utils/source-time': await load('../../src/utils/source-time.ts', {}), '../components/feed-scroll': {...scrolling, useFeedScrollPosition: (...args) => {const value = scrolling.useFeedScrollPosition(...args); inboxPosition = args[0]; inboxReset = value.reset; return value;}}, '../components/SourceDrawer': {SourceDrawer: primitive},
    '../components/FeedList': await feedList(FlatList), '../components/useAppForeground': {useAppForeground: () => true},
  });
  const render = () => React.createElement(LibraryScreen, {navigation: {navigate() {}}, route: {params: {}}});
  const observe = (mode, y) => lists[mode].onScroll({nativeEvent: {contentOffset: {y}}});
  const restore = mode => {lists[mode].onLayout({nativeEvent: {layout: {height: 500}}}); lists[mode].onContentSizeChange(300, 1600);};
  const select = label => act(async () => menus.at(-1).items.find(item => item.label === label).onPress());
  await act(async () => root.render(render())); observe('inbox', 0); observe('inbox', 420);
  const firstInbox = lists.inbox.instance, renderBookmark = lists.inbox.renderItem;
  assert.equal(lists.inbox.getItemLayout, undefined, 'Wait for the scrolling collection header measurement');
  await act(async () => lists.inbox.ListHeaderComponent.props.onLayout({nativeEvent: {layout: {height: 104}}}));
  const many = Array.from({length: 6}, (_, index) => ({id: `row-${index}`})), layout = index => lists.inbox.getItemLayout(many, index);
  assert.deepEqual({...layout(3)}, {index: 3, length: 53.5, offset: 264.5}, 'A cell length covers its row and the separator rendered after it, after the measured header');
  assert.deepEqual({...layout(5)}, {index: 5, length: 53, offset: 371.5}, 'The last cell renders no separator');
  for (const [first, last] of [[0, 2], [1, 4], [2, 5]]) {
    const rendered = Array.from({length: last - first + 1}, (_, index) => 53 + (first + index < many.length - 1 ? 0.5 : 0)).reduce((sum, value) => sum + value, 0);
    assert.equal(layout(last).offset + layout(last).length - layout(first).offset, rendered, `VirtualizedList's spacer for cells ${first}..${last} equals their rendered rows and separators`);
  }
  for (let index = 0; index < many.length - 1; index++) assert.equal(layout(index).offset + layout(index).length, layout(index + 1).offset, 'Adjacent cells tile without gaps or overlap');
  await act(async () => inboxWatch([{id: 'prepended-bookmark'}, ...bookmarks]));
  assert.equal(lists.inbox.renderItem, renderBookmark, 'Incoming rows do not rebuild all row action callbacks');
  assert.equal(lists.inbox.instance, firstInbox, 'A same-feed sync update retains the native list anchor');
  assert.deepEqual({...lists.inbox.maintainVisibleContentPosition}, {minIndexForVisible: 0, autoscrollToTopThreshold: 1});
  assert.deepEqual(Array.from(lists.inbox.data, value => lists.inbox.keyExtractor(value)), ['prepended-bookmark', 'existing-bookmark']);
  assert.equal(inboxPosition.offset, 420);
  assert.equal(lists.inbox.scrollEnabled, undefined, 'The drawer never toggles list scrolling');
  assert.equal(lists.inbox.scrollsToTop, true, 'The visible closed-drawer feed owns status-bar scroll-to-top');
  await act(async () => {
    const event = {nativeEvent: {contentOffset: {y: 420}, contentSize: {height: 2000}, layoutMeasurement: {height: 500}}};
    lists.inbox.onScrollBeginDrag(event); lists.inbox.onScrollEndDrag(event); lists.inbox.onMomentumScrollBegin(event); lists.inbox.onMomentumScrollEnd(event);
  });
  assert.deepEqual(busy, [[true, 'library-scroll'], [false, 'library-scroll']], 'List scroll begin and momentum end report interaction busy state to the runtime');
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

test('actual Library holds row publications while the feed scrolls, flushes the latest on rest, ignores replaced scopes and keeps list chrome elements stable', async () => mounted(async root => {
  const scrolling = await load('../../src/components/feed-scroll.ts', {react: React});
  const selection = await load('../../src/screens/collection-selection.ts', {});
  const primitive = ({children}) => React.createElement('div', null, children), nil = () => null;
  let list, headerRenders = 0; const menus = [], watches = [], busy = [];
  const FlatList = React.forwardRef((props, ref) => {list = props; React.useImperativeHandle(ref, () => ({scrollToOffset() {}}), []); return props.ListHeaderComponent;});
  const rssState = {enabled: false, selected: null, subscriptions: [], entries: [], ready: true, busy: false, hasMore: false};
  class RssController {subscribe = () => () => {}; getSnapshot = () => rssState; activate() {} dispose() {} cancel() {} poll() {} async load() {}}
  const telemetry = {track() {}, element() {}, firebase() {}}, preferences = {};
  const collections = [{id: 'collection-a', name: 'Collection', ownerId: 'owner-a', status: 1, subscriptionEndTime: '2080-01-01T00:00:00Z', hasNew: false}];
  const repositories = {library: {watch: (sort, owner, callback) => {watches.push({sort, owner, callback}); callback([{id: `${sort}-initial`}]); return () => {};}},
    watchLibraryCollections: callback => {callback(collections); return () => {};}, watchLibraryUser: callback => {callback([]); return () => {};}, watchSubscription: () => () => {}, markCollectionRead: async () => {}};
  const runtime = {getNativeResourceOwner: () => 'account', getRepositories: () => repositories, getAccountPreferences: () => preferences, getUpgradeSnapshot: () => ({status: 'ready'}), setInteractionBusy: (value, source) => busy.push([value, source])};
  const context = {t: value => value, repositories, preferences, runtime, api: {}, sessions: {}, config: {platform: 'ios'}, upgrade: {status: 'ready'}, nativeResourceOwner: 'account'};
  const components = Object.fromEntries(['BookmarkRow', 'Divider', 'LinkInputDialog', 'RssFeedSwitcher', 'SourceAvatar', 'SourceButton', 'SourceDialog', 'SourceIcon', 'SourceProgress', 'TextAction', 'RssFeed'].map(name => [name, nil]));
  const {LibraryScreen} = await load('../../src/screens/LibraryScreen.tsx', {
    react: React, 'react-native': {View: primitive, Pressable: primitive, ScrollView: primitive, FlatList, Animated: {}, Linking: {}, PixelRatio: {roundToNearestPixel: value => value}, Platform: {OS: 'ios', select: values => values.default}, StyleSheet: {create: value => value, absoluteFill: {}}, useWindowDimensions: () => ({width: 400, height: 800, fontScale: 1})},
    '@react-navigation/native': {useFocusEffect: callback => React.useEffect(callback, [callback])}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})},
    '../telemetry': {useTelemetry: () => telemetry}, '../components/LibrarySyncAvatar': {LibrarySyncAvatar: nil}, '../components/LibrarySyncStatus': {LibrarySyncStatus: nil}, '../components/SourceLine': {SourceLine: nil}, '../components/SourceRing': {SourceCircle: () => {headerRenders++; return null;}}, '../components/SourceShape': {SourceShape: primitive}, '../components/fixture-actions': {},
    './LibraryDataStatus': {LibraryDataStatus: nil}, '../components/PdfImportDialog': {PdfImportDialog: nil}, '../pdf/usePdfLab': {usePdfLab: () => ({ready: true, enabled: false})},
    '../components': {...components, ScreenSurface: primitive, SourceText: primitive, SourceMenu: props => {menus.push(props); return null;}}, '../components/useVisibleSnapshot': await load('../../src/components/useVisibleSnapshot.ts', {react: React}), '../data': {readContinueReading: async () => null}, '../rss/controller': {RssController}, '../runtime': {useMobile: () => context},
    '../theme': {mobileColors: {}, mobileLayout: {drawerMaximumWidth: 320, librarySwipeActionHeight: 53}, mobileTypography: {}}, '../theme/testIds': {mobileTestIds: {}}, './collection-selection': selection, '../utils/source-time': await load('../../src/utils/source-time.ts', {}), '../components/feed-scroll': scrolling, '../components/SourceDrawer': {SourceDrawer: primitive},
    '../components/FeedList': await feedList(FlatList), '../components/useAppForeground': {useAppForeground: () => true},
  });
  const navigation = {navigate() {}, setParams() {}}, render = () => act(async () => root.render(React.createElement(LibraryScreen, {navigation, route: {params: {}}})));
  const keys = () => Array.from(list.data, value => list.keyExtractor(value));
  const rest = {nativeEvent: {contentOffset: {x: 0, y: 300}, contentSize: {width: 400, height: 2000}, layoutMeasurement: {width: 400, height: 800}}};
  await render();
  const inbox = watches.at(-1).callback, header = list.ListHeaderComponent, footer = list.ListFooterComponent, contentStyle = list.contentContainerStyle, rendered = headerRenders;
  assert.deepEqual(keys(), ['inbox-initial']);
  await render();
  assert.equal(list.ListHeaderComponent, header, 'An unrelated Library render keeps the header element, so the collection strip does not re-render');
  assert.equal(list.ListFooterComponent, footer); assert.equal(list.contentContainerStyle, contentStyle); assert.equal(headerRenders, rendered);
  await act(async () => inbox([{id: 'immediate'}, {id: 'inbox-initial'}]));
  assert.deepEqual(keys(), ['immediate', 'inbox-initial'], 'A resting feed applies rows at once (optimistic row actions stay immediate)');
  assert.equal(list.ListHeaderComponent, header, 'Row content changes keep the header element');
  await act(async () => list.onScrollBeginDrag(rest));
  await act(async () => inbox([{id: 'first'}, {id: 'immediate'}, {id: 'inbox-initial'}]));
  await act(async () => inbox([{id: 'latest'}, {id: 'first'}, {id: 'immediate'}, {id: 'inbox-initial'}]));
  assert.deepEqual(keys(), ['immediate', 'inbox-initial'], 'Rows arriving while the user scrolls are not applied under the finger');
  await act(async () => list.onScrollEndDrag(rest));
  assert.deepEqual(keys(), ['immediate', 'inbox-initial'], 'A drag that flows into momentum is still scrolling');
  await act(async () => {list.onMomentumScrollBegin(rest); list.onMomentumScrollEnd(rest);});
  assert.deepEqual(keys(), ['latest', 'first', 'immediate', 'inbox-initial'], 'The latest buffered publication applies once the feed rests');
  assert.deepEqual(busy.map(([value]) => value), [true, false]);
  await act(async () => list.onScrollBeginDrag(rest));
  await act(async () => inbox([{id: 'stale-old-scope'}]));
  await act(async () => menus.at(-1).items.find(item => item.label === 'inbox_starred').onPress());
  assert.deepEqual(keys(), ['starred-initial'], 'A replaced scope publishes its own rows instead of showing the previous list');
  await act(async () => inbox([{id: 'stale-after-replacement'}]));
  await act(async () => list.onMomentumScrollEnd(rest));
  assert.deepEqual(keys(), ['starred-initial'], 'Buffered and late publications for a replaced scope stay no-ops when flushed');
  const starred = watches.at(-1).callback;
  await act(async () => list.onScrollBeginDrag(rest));
  await act(async () => starred([{id: 'held-until-unmount'}, {id: 'starred-initial'}]));
  assert.deepEqual(keys(), ['starred-initial']);
  await act(async () => root.render(null));
  assert.deepEqual(busy.at(-1), [false, 'library-scroll'], 'Unmounting mid-scroll settles the feed');
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

for (const platform of ['android', 'ios']) test(`actual ${platform} drawer is one UI-thread pan: leading edge while closed, full surface while open, scrim inside the content and visible-only Back`, async () => mounted(async root => {
  const {installedMotionHost, loadWorkletComponent, drawerMotionModule} = await import('./installed-motion-host.mjs');
  const changes = []; let back, setOpen, scrim, content, panel;
  const primitive = props => {
    if (props.animatedProps && 'pointerEvents' in props.animatedProps) scrim = props;
    else if (props.animatedProps) (props.children === 'Drawer' ? panel = props : content = props);
    return React.createElement('div', null, props.children);
  };
  const motion = installedMotionHost(primitive);
  const {SourceDrawer} = loadWorkletComponent(new URL('../../src/components/SourceDrawer.tsx', import.meta.url), {
    react: React, 'react-native': {View: primitive, Pressable: primitive, Platform: {OS: platform}, StyleSheet: {absoluteFill: {}, create: value => value}, BackHandler: {addEventListener: (_name, callback) => {back = callback; return {remove() {back = undefined;}};}}},
    'react-native-gesture-handler': motion.gestures, 'react-native-reanimated': motion.reanimated, 'react-native-worklets': motion.worklets,
    '@react-navigation/native': {useFocusEffect: callback => React.useEffect(callback, [callback])}, './drawer-motion': drawerMotionModule(),
  });
  function Harness() {const [open, update] = React.useState(false); setOpen = update; return React.createElement(SourceDrawer, {open, width: 320, onOpenChange: value => {changes.push(value); update(value);}, drawer: 'Drawer', children: 'Feed'});}
  await act(async () => root.render(React.createElement(Harness)));
  const pan = () => motion.detectors()[0], config = () => pan().config, progress = motion.values[0];
  const hidden = view => platform === 'android' ? view.animatedProps.importantForAccessibility === 'no-hide-descendants' : view.animatedProps.accessibilityElementsHidden;
  const drag = (dx, velocityX = 0, canceled = false) => act(async () => {
    pan().handlers.onActivate({}); const calls = motion.jsCalls.length;
    pan().handlers.onUpdate({translationX: dx}); assert.equal(motion.jsCalls.length, calls, 'Tracking never dispatches to JS');
    pan().handlers.onDeactivate({translationX: dx, velocityX, canceled});
  });
  const edge = platform === 'ios' ? 32 : 50, slop = platform === 'ios' ? 10 : 8;
  assert.equal(motion.detectors().length, 1, 'Opening and closing share one pan');
  assert.equal(pan().shouldUseReanimated, true, 'Every drawer callback is a UI worklet');
  assert.deepEqual({...config().hitSlop}, {left: 0, width: edge}, 'Closed: only the leading edge can start the drawer');
  assert.equal(config().activeOffsetX, platform === 'ios' ? 5 : 20, 'Closed: rightward activation');
  assert.equal(config().failOffsetX, -1, 'Closed: any leftward travel fails');
  assert.deepEqual([...config().failOffsetY], [-slop, slop], 'Vertical travel fails the drawer so list scrolling never waits on it');
  for (const relation of ['block', 'simultaneousWith', 'requireToFail']) assert.equal(config()[relation], undefined, 'No relation with list or row gestures');
  assert.equal(back, undefined); assert.equal(motion.pending(), 0);
  assert.equal(scrim.animatedProps.pointerEvents, 'none'); assert.equal(hidden(content), false); assert.equal(hidden(panel), true);
  await act(async () => {pan().handlers.onActivate({}); pan().handlers.onUpdate({translationX: 110});});
  assert.equal(scrim.animatedProps.pointerEvents, 'auto', 'While dragging, the backdrop inside the content owns touches above the list');
  assert.equal(hidden(content), true); assert.equal(hidden(panel), false);
  await act(async () => {pan().handlers.onDeactivate({translationX: 110, velocityX: 0, canceled: false}); motion.advance(300);});
  assert.deepEqual(changes, []); assert.equal(back, undefined); assert.equal(scrim.animatedProps.pointerEvents, 'none');
  await drag(180); await act(async () => motion.advance(300));
  assert.deepEqual(changes, [true]); assert.ok(back);
  assert.equal(config().hitSlop, undefined, 'Open: the whole surface drags the drawer');
  assert.deepEqual([...config().activeOffsetX], [-slop, slop]); assert.equal(config().failOffsetX, undefined);
  assert.equal(scrim.animatedProps.pointerEvents, 'auto'); assert.equal(hidden(content), true); assert.equal(hidden(panel), false);
  assert.equal(scrim.style.find(value => value?.backgroundColor)?.backgroundColor, 'rgba(0, 0, 0, 0.32)');
  await drag(-210, -450, true); await act(async () => motion.advance(300));
  assert.deepEqual(changes, [true], 'A cancelled close returns to the published open state'); assert.equal(progress.value, 1);
  await act(async () => assert.equal(back(), true));
  assert.deepEqual(changes, [true, false]); assert.equal(back, undefined);
  assert.equal(scrim.animatedProps.pointerEvents, 'none', 'The list is interactive as soon as the close resolves, before the animation ends');
  await act(async () => motion.advance(100));
  const interrupted = progress.value;
  assert.ok(interrupted > 0 && interrupted < 1);
  await drag(20, 450);
  assert.ok(Math.abs(progress.value - Math.min(1, interrupted + 20 / 320)) < 1e-9, 'Reversing continues at the actual in-flight position');
  await act(async () => motion.advance(300)); assert.equal(progress.value, 1); assert.deepEqual(changes, [true, false, true]);
  await act(async () => setOpen(false)); await act(async () => motion.advance(300)); assert.equal(back, undefined); assert.equal(progress.value, 0);
  const beforeCancel = changes.length;
  await drag(240, 450, true); await act(async () => motion.advance(300));
  assert.equal(changes.length, beforeCancel); assert.equal(back, undefined); assert.equal(progress.value, 0);
}));

for (const platform of ['android', 'ios']) test(`actual ${platform} FeedList is a plain FlatList that samples scroll in JS, always forwards drag/momentum ends and keeps its list policy constant`, async () => mounted(async root => {
  let listProps; const forwarded = [], activity = [];
  const FlatList = React.forwardRef((props, ref) => {listProps = props; React.useImperativeHandle(ref, () => ({scrollToOffset() {}}), []); return null;});
  const timers = new Map();
  let now = 1000, timer = 0;
  const {FeedList, feedScrollInterval} = await load('../../src/components/FeedList.tsx', {react: React, 'react-native': {FlatList, Platform: {OS: platform}}},
    {Date: {now: () => now}, setTimeout: (callback, delay) => {const id = ++timer; timers.set(id, {callback, delay}); return id;}, clearTimeout: id => timers.delete(id)});
  const handlers = {onScroll: event => forwarded.push(['scroll', event.nativeEvent.contentOffset.y]), onScrollBeginDrag: () => forwarded.push(['begin']), onScrollEndDrag: event => forwarded.push(['end', event.nativeEvent.contentOffset.y]), onMomentumScrollBegin: () => forwarded.push(['momentum-begin']), onMomentumScrollEnd: event => forwarded.push(['momentum', event.nativeEvent.contentOffset.y])};
  const renderItem = () => null, data = [];
  const render = active => act(async () => root.render(React.createElement(FeedList, {data, renderItem, active, onScrollActivity: value => activity.push(value), ...handlers})));
  await render(true);
  assert.equal(listProps.renderItem, renderItem, 'React Native FlatList receives the row renderer directly, without an animated cell wrapper');
  assert.equal(listProps.data, data);
  assert.deepEqual({...listProps.maintainVisibleContentPosition}, {minIndexForVisible: 0, autoscrollToTopThreshold: 1});
  assert.equal(listProps.windowSize, 9); assert.equal(listProps.maxToRenderPerBatch, platform === 'ios' ? 5 : 1);
  assert.equal(listProps.removeClippedSubviews, platform === 'android'); assert.equal(listProps.scrollsToTop, true);
  assert.equal(listProps.CellRendererComponent, undefined);
  assert.equal(feedScrollInterval, 48); assert.equal(listProps.scrollEventThrottle, feedScrollInterval, 'Native throttles scroll events to the JS sampling window');
  for (const name of ['onScroll', 'onScrollBeginDrag', 'onScrollEndDrag', 'onMomentumScrollBegin', 'onMomentumScrollEnd']) assert.equal(typeof listProps[name], 'function', `${name} is a plain JS handler`);
  const event = y => ({nativeEvent: {contentOffset: {x: 0, y}, contentSize: {width: 300, height: 2000}, layoutMeasurement: {width: 300, height: 500}}});
  listProps.onScrollBeginDrag(event(0)); listProps.onScroll(event(10));
  now += feedScrollInterval - 1; listProps.onScroll(event(20));
  now += 1; listProps.onScroll(event(30));
  listProps.onScrollEndDrag(event(31)); listProps.onMomentumScrollBegin(event(31)); now += feedScrollInterval; listProps.onScroll(event(32)); listProps.onMomentumScrollEnd(event(33));
  assert.deepEqual(forwarded, [['begin'], ['scroll', 10], ['scroll', 30], ['end', 31], ['momentum-begin'], ['scroll', 32], ['momentum', 33]], 'Samples inside the window are dropped; ends always reach the consumer');
  assert.deepEqual(activity, [true, false], 'Scrolling is busy from drag begin until momentum end');
  assert.equal(timers.size, 0, 'Momentum end settles at once and leaves no idle timer');
  listProps.onScrollBeginDrag(event(33)); listProps.onScrollEndDrag(event(40)); listProps.onMomentumScrollBegin(event(40));
  assert.equal(timers.size, 0, 'Momentum after a drag keeps the feed busy instead of settling on the drag-end idle timer');
  now += feedScrollInterval; listProps.onScroll(event(60)); assert.equal(timers.size, 1, 'Movement during momentum re-arms the idle fallback');
  listProps.onMomentumScrollEnd(event(70)); assert.deepEqual(activity, [true, false, true, false]);
  listProps.onScrollBeginDrag(event(70)); now += feedScrollInterval; listProps.onScrollEndDrag(event(80));
  assert.deepEqual(activity, [true, false, true, false, true]); assert.equal(timers.size, 1);
  for (const [id, {callback, delay}] of [...timers]) {assert.equal(delay, 250); timers.delete(id); callback();}
  assert.deepEqual(activity, [true, false, true, false, true, false], 'A drag that ends without momentum settles after the idle window');
  now += feedScrollInterval; listProps.onScroll(event(0)); assert.equal(timers.size, 0, 'A programmatic scroll while resting does not report activity');
  listProps.onScrollBeginDrag(event(0)); listProps.onScroll(event(10));
  now += 1000;
  for (const [id, {callback}] of [...timers]) {timers.delete(id); callback();}
  assert.equal(activity.at(-1), true, 'A held drag stays protected during a pause longer than the idle window');
  assert.equal(timers.size, 0, 'A held drag never arms the idle fallback');
  listProps.onScroll(event(40));
  assert.equal(activity.at(-1), true, 'Continued movement in the same drag remains protected');
  listProps.onScrollEndDrag(event(40)); listProps.onMomentumScrollBegin(event(40));
  now += feedScrollInterval; listProps.onScroll(event(50));
  const interruptedIdle = [...timers.values()][0].callback;
  listProps.onScrollBeginDrag(event(50)); listProps.onMomentumScrollEnd(event(50)); interruptedIdle();
  assert.equal(activity.at(-1), true, 'An old momentum end or idle callback cannot settle a new held drag');
  listProps.onScrollEndDrag(event(60));
  for (const [id, {callback}] of [...timers]) {timers.delete(id); callback();}
  assert.equal(activity.at(-1), false, 'Release without momentum still settles through the bounded fallback');
  listProps.onScrollBeginDrag(event(60)); assert.equal(activity.at(-1), true);
  await render(false); assert.equal(listProps.scrollsToTop, false, 'Only the active feed answers the status-bar tap');
  assert.equal(activity.at(-1), false, 'Covering or backgrounding the feed releases an interrupted held drag');
  assert.equal(timers.size, 0); await render(true);
  const stale = listProps; listProps.onScrollBeginDrag(event(40)); await act(async () => root.render(null));
  assert.equal(activity.at(-1), false, 'Unmounting mid-scroll releases the busy state');
  const before = [forwarded.length, activity.length];
  stale.onScrollBeginDrag(event(0)); now += feedScrollInterval; stale.onScroll(event(90)); stale.onScrollEndDrag(event(91)); stale.onMomentumScrollEnd(event(92));
  assert.deepEqual([forwarded.length, activity.length], before, 'An unmounted feed forwards no late native event');
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

test('actual FeedList replaces a content scope without native autoscroll or old-row anchoring, through an empty intermediate state', async () => mounted(async root => {
  let listProps;
  const FlatList = React.forwardRef((props, ref) => {listProps = props; React.useImperativeHandle(ref, () => ({scrollToOffset() {}}), []); return null;});
  const timers = new Map(); let timer = 0;
  const {FeedList, contentScopeSettle} = await load('../../src/components/FeedList.tsx', {react: React, 'react-native': {FlatList, Platform: {OS: 'ios'}}},
    {Date: {now: () => 0}, setTimeout: (callback, delay) => {const id = ++timer; timers.set(id, {callback, delay}); return id;}, clearTimeout: id => timers.delete(id)});
  const fire = delay => act(async () => {for (const [id, entry] of [...timers]) if (entry.delay === delay) {timers.delete(id); entry.callback();}});
  const policy = {minIndexForVisible: 0, autoscrollToTopThreshold: 1}, renderItem = () => null;
  const render = (contentScope, data) => act(async () => root.render(React.createElement(FeedList, {contentScope, data, renderItem})));
  const inbox = [{id: 'a'}], starred = [{id: 'b'}];
  await render('inbox', inbox);
  assert.deepEqual({...listProps.maintainVisibleContentPosition}, policy);
  await render('inbox', [{id: 'new'}, ...inbox]);
  assert.deepEqual({...listProps.maintainVisibleContentPosition}, policy, 'Same-scope prepends keep the visible-position policy');
  await render('starred', inbox);
  assert.equal(listProps.maintainVisibleContentPosition, undefined, 'Switching scope turns adjustment off in the same commit');
  await fire(16);
  assert.equal(listProps.maintainVisibleContentPosition, undefined, 'The old scope\'s rows are not the replacement');
  await render('starred', []);
  await fire(16);
  assert.equal(listProps.maintainVisibleContentPosition, undefined, 'An empty loading state is not the replacement either');
  await render('starred', starred);
  assert.equal(listProps.maintainVisibleContentPosition, undefined);
  await fire(16);
  assert.deepEqual({...listProps.maintainVisibleContentPosition}, policy, 'Adjustment returns one frame after the replacement rows rendered');
  await render('archived', starred);
  assert.equal(listProps.maintainVisibleContentPosition, undefined);
  await fire(contentScopeSettle);
  assert.deepEqual({...listProps.maintainVisibleContentPosition}, policy, 'A scope whose data never changes is restored after the bounded settle');
}));
