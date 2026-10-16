import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React, {act} from 'react';

const require = createRequire(import.meta.url);
const domPath = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});
async function load(file, boundaries) {
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
    './fixture-actions': {}, './feed-scroll': scrolling,
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
  const beforeSourceChange = listProps;
  selected = 'feed-b'; await act(async () => root.render(render()));
  assert.equal(commands.at(-1).offset, 0); assert.equal(position.source, 'feed-b'); assert.equal(position.offset, 0);
  assert.notEqual(listProps.instance, currentInstance, 'Changing RSS source replaces its native anchor state');
  listProps.onScroll({nativeEvent: {contentOffset: {y: 0}}});
  beforeSourceChange.onScrollBeginDrag(); beforeSourceChange.onScroll({nativeEvent: {contentOffset: {y: 400}}});
  assert.equal(position.offset, 0, 'An old RSS source callback cannot move the newly selected source');
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
  const FlatList = React.forwardRef((props, ref) => {lists.inbox = {...props, instance: React.useRef(Symbol('native-inbox-list')).current}; React.useImperativeHandle(ref, () => ({scrollToOffset: value => commands.push(['inbox', value.offset])}), []); return null;});
  function RssFeed({scrollPosition}) {rssPosition = scrollPosition; const scrollTo = React.useCallback(offset => commands.push(['rss', offset]), []); lists.rss = {...scrolling.useFeedScrollPosition(scrollPosition, scrollTo).events, instance: React.useRef(Symbol('rss-component')).current}; return null;}
  const rssState = {enabled: true, selected: 'feed-a', subscriptions: [], entries: [], ready: true, busy: false, hasMore: false};
  class RssController {subscribe = () => () => {}; getSnapshot = () => rssState; activate() {} dispose() {} cancel() {} poll() {} async load() {}}
  const telemetry = {track() {}, element() {}, firebase() {}}, preferences = {}, api = {};
  const runtime = {getDatabase: () => null, getNativeResourceOwner: () => owner};
  const collections = [{id: 'collection-a', name: 'Collection', ownerId: 'owner-a', status: 1, subscriptionEndTime: '2080-01-01T00:00:00Z', hasNew: true}];
  const bookmarks = [{id: 'existing-bookmark'}];
  const repositories = {watchBookmarks: (_sort, callback) => {inboxWatch = callback; callback(bookmarks); return () => {};}, watchCollections: callback => {callback(collections); return () => {};}, watchUser: () => () => {}, watchSubscription: () => () => {}, watchCollectionBookmarks: () => () => {}, markCollectionRead: async id => {markedRead.push(id);}};
  const context = {t: value => value, repositories, preferences, runtime, api, sessions: {}, config: {platform: 'android'}};
  const components = Object.fromEntries(['BookmarkRow', 'Divider', 'LinkInputDialog', 'RssFeedSwitcher', 'SourceAvatar', 'SourceButton', 'SourceDialog', 'SourceIcon', 'SourceProgress', 'TextAction'].map(name => [name, nil]));
  const {LibraryScreen} = await load('../../src/screens/LibraryScreen.tsx', {
    react: React, 'react-native': {View: primitive, Pressable: props => {if (props.accessibilityRole === 'tab') tabs.push(props); return primitive(props);}, ScrollView: primitive, FlatList, ActivityIndicator: nil, Animated: {}, AppState: {currentState: 'active', addEventListener: () => ({remove() {}})}, Linking: {}, PixelRatio: {roundToNearestPixel: value => value}, Platform: {OS: 'android', select: values => values.android}, StyleSheet: {create: value => value, absoluteFill: {}}, useWindowDimensions: () => ({width: 400, height: 800})},
    '@react-navigation/native': {useFocusEffect: callback => React.useEffect(callback, [callback])}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0})}, 'expo-network': {useNetworkState: () => ({isConnected: true})},
    '../telemetry': {useTelemetry: () => telemetry}, '../components/SourceSyncAvatar': {SourceSyncAvatar: nil}, '../components/SourceLine': {SourceLine: nil}, '../components/SourceRing': {SourceCircle: nil}, '../components/SourceShape': {SourceShape: primitive}, '../components/sync-state': {sourceSyncState: () => ({kind: 'idle'})}, '../components/fixture-actions': {},
    '../components': {...components, RssFeed, ScreenSurface: primitive, SourceText: primitive, SourceMenu: props => {menus.push(props); return null;}}, '../data': {readContinueReading: async () => null}, '../rss/controller': {RssController}, '../runtime': {useMobile: () => ({...context, nativeResourceOwner: owner})},
    '../theme': {mobileColors: {}, mobileLayout: {drawerMaximumWidth: 320}, mobileTypography: {}}, '../theme/testIds': {mobileTestIds: {}}, './collection-selection': selection, '../components/feed-scroll': {...scrolling, useFeedScrollPosition: (...args) => {const value = scrolling.useFeedScrollPosition(...args); inboxPosition = args[0]; inboxReset = value.reset; return value;}}, '../components/SourceDrawer': {SourceDrawer: primitive},
  });
  const render = () => React.createElement(LibraryScreen, {navigation: {navigate() {}}});
  const observe = (mode, y) => lists[mode].onScroll({nativeEvent: {contentOffset: {y}}});
  const restore = mode => {lists[mode].onLayout({nativeEvent: {layout: {height: 500}}}); lists[mode].onContentSizeChange(300, 1600);};
  const select = label => act(async () => menus.at(-1).items.find(item => item.label === label).onPress());
  await act(async () => root.render(render())); observe('inbox', 0); observe('inbox', 420);
  const firstInbox = lists.inbox.instance;
  await act(async () => inboxWatch([{id: 'prepended-bookmark'}, ...bookmarks]));
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

for (const platform of ['android', 'ios']) test(`actual ${platform} drawer uses source touch slop, cancels both directions, and consumes Back only while visible`, async () => mounted(async root => {
  const geometry = await load('../../src/components/drawer-motion.ts', {});
  const detectors = [], changes = []; let back, setOpen, scrimStyle;
  const primitive = ({children}) => React.createElement('div', null, children);
  class Value {
    constructor(value) {this.value = value; this.listeners = new Map();}
    setValue(value) {this.value = value; for (const callback of this.listeners.values()) callback({value});}
    addListener(callback) {this.listeners.set('listener', callback); return 'listener';}
    removeListener(id) {this.listeners.delete(id);} stopAnimation() {} interpolate(value) {return value;}
  }
  const Pan = () => {
    const result = {handlers: {}, configuration: {}};
    for (const method of ['runOnJS', 'activeOffsetX', 'failOffsetX', 'failOffsetY', 'enabled']) result[method] = value => {result.configuration[method] = value; return result;};
    for (const method of ['onStart', 'onUpdate', 'onEnd', 'onFinalize']) result[method] = callback => {result.handlers[method] = callback; return result;};
    return result;
  };
  const {SourceDrawer} = await load('../../src/components/SourceDrawer.tsx', {
    react: React, 'react-native': {View: primitive, Pressable: primitive, Platform: {OS: platform}, StyleSheet: {absoluteFill: {}}, Animated: {Value, View: props => {if (props.pointerEvents === 'none') scrimStyle = props.style; return primitive(props);}, timing: (value, options) => ({start(callback) {value.setValue(options.toValue); callback?.({finished: true});}})}, BackHandler: {addEventListener: (_name, callback) => {back = callback; return {remove() {back = undefined;}}}}},
    'react-native-gesture-handler': {Gesture: {Pan}, GestureDetector: ({gesture, children}) => {detectors.push(gesture); return React.createElement('div', null, children);}},
    '@react-navigation/native': {useFocusEffect: callback => React.useEffect(callback, [callback])}, './drawer-motion': geometry, '../theme': {mobileColors: {scrim: '#00000080'}},
  });
  function Harness() {const [open, update] = React.useState(false); setOpen = update; return React.createElement(SourceDrawer, {open, width: 320, onOpenChange: value => {changes.push(value); update(value);}, drawer: 'Drawer', children: 'Feed'});}
  await act(async () => root.render(React.createElement(Harness)));
  assert.equal(back, undefined);
  const slop = platform === 'ios' ? 10 : 8;
  const opening = detectors.at(-1); assert.equal(opening.configuration.activeOffsetX, slop); assert.equal(opening.configuration.failOffsetX, -slop, 'Closed drawer leaves the opposite row swipe direction to its own handler');
  assert.deepEqual(Array.from(opening.configuration.failOffsetY), [-slop, slop]);
  await act(async () => {opening.handlers.onStart(); opening.handlers.onUpdate({translationX: 110}); opening.handlers.onEnd({velocityX: 0}, true); opening.handlers.onFinalize({}, true);});
  assert.deepEqual(changes, []); assert.equal(back, undefined, 'A short opening gesture returns to the closed anchor');
  const second = detectors.at(-1);
  await act(async () => {second.handlers.onStart(); second.handlers.onUpdate({translationX: 180}); second.handlers.onEnd({velocityX: 0}, true); second.handlers.onFinalize({}, true);});
  assert.deepEqual(changes, [true]); assert.ok(back);
  assert.equal(scrimStyle.at(-1).backgroundColor, 'rgba(0, 0, 0, 0.32)', 'The drawer uses the pinned Material3 .32 scrim without changing dialog tokens');
  const closing = detectors.at(-1);
  await act(async () => {closing.handlers.onStart(); closing.handlers.onUpdate({translationX: -210}); closing.handlers.onEnd({velocityX: -450}, false); closing.handlers.onFinalize({}, false);});
  assert.deepEqual(changes, [true], 'A canceled drag preserves the committed open state');
  await act(async () => assert.equal(back(), true)); assert.deepEqual(changes, [true, false]); assert.equal(back, undefined);
  await act(async () => setOpen(true));
  const fling = detectors.at(-1);
  await act(async () => {fling.handlers.onStart(); fling.handlers.onUpdate({translationX: -20}); fling.handlers.onEnd({velocityX: -450}, true); fling.handlers.onFinalize({}, true);});
  assert.deepEqual(changes.at(-1), false, 'The pinned directional 400dp/s fling closes before the distance threshold');
  const canceledOpening = detectors.at(-1), beforeCancel = changes.length;
  await act(async () => {canceledOpening.handlers.onStart(); canceledOpening.handlers.onUpdate({translationX: 240}); canceledOpening.handlers.onEnd({velocityX: 450}, false); canceledOpening.handlers.onFinalize({}, false);});
  assert.equal(changes.length, beforeCancel, 'SDK onEnd(false) before onFinalize(false) cannot commit a canceled opening even beyond the distance/fling threshold');
  assert.equal(back, undefined);
}));

test('source circular progress forwards pinned center and saving geometry through the owned native ring', async () => {
  const {SourceCircularProgress} = await load('../../src/components/SourceRing.tsx', {
    react: React, 'react-native': {View: 'View', Platform: {OS: 'android'}, PixelRatio: {roundToNearestPixel: value => value}},
    'expo-modules-core': {requireNativeViewManager: () => 'NativeRing'},
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
