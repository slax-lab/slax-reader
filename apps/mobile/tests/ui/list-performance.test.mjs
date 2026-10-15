import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, loadComponent, withNativeHost, nativeBoundary} from '../reader/parity-host.mjs';
import {installedMotionHost, loadWorkletComponent} from './installed-motion-host.mjs';
import {installedAnimatedHost} from '../reader/installed-animated-host.mjs';

const theme = await loadComponent('../../src/theme/index.ts', {});
const touch = (x, y) => ({allTouches: [{absoluteX: x, absoluteY: y}]});

test('production row uses installed UI worklets, yields closed right/vertical drags and resumes interrupted 40/80% settling', nativeBoundary, async () => withNativeHost(async host => {
  const motion = installedMotionHost(host.native.View), drawer = motion.gestures.Gesture.Pan();
  const presses = [], writes = [], events = [], opens = [], edits = [], failures = [];
  let menus, renders = 0;
  const {BookmarkRow} = loadWorkletComponent(new URL('../../src/components/BookmarkRow.tsx', import.meta.url), {
    react: React, 'react-native': {...host.native, PixelRatio: {roundToNearestPixel: value => value}, Pressable: props => {presses.push(props); return React.createElement(host.native.Pressable, props);}},
    'react-native-gesture-handler': motion.gestures, 'react-native-reanimated': motion.reanimated,
    './SourceDrawer': {useDrawerGesture: () => drawer}, 'expo-haptics': {impactAsync: async () => {}, ImpactFeedbackStyle: {Medium: 'medium'}},
    '../data/repositories': {bookmarkDisplayTitle: item => item.title}, '../theme': theme, '../theme/testIds': {mobileTestIds: {}},
    './SourceUI': {SourceIcon: () => null}, './SourceLine': {SourceLine: () => {renders++; return null;}}, './SourceMenu': {SourceMenu: props => {menus = props; return null;}},
  });
  const item = {id: 'one', title: 'Article', status: 'success', isStarred: 0, archiveStatus: 0, downloadStatus: 0};
  const props = {item, owned: true, sort: 'inbox', t: key => key, onOpen: value => opens.push(value.id), onEdit: value => edits.push(value.id), onError: error => failures.push(error), repositories: {updateBookmark: async (...args) => writes.push(args), deleteBookmark: async id => writes.push(['delete', id])}, telemetry: {element: (...args) => events.push(args), firebase() {}}};
  await host.render(React.createElement(BookmarkRow, props));
  const gesture = motion.detectors()[0], offset = motion.values[0];
  assert.equal(gesture.shouldUseReanimated, true, 'Installed RNGH recognizes every compiled callback as a UI worklet');
  assert.equal(gesture.config.blocksHandlers[0], drawer);
  function begin(dx, dy = 0) {
    let result;
    gesture.handlers.onTouchesDown(touch(0, 0));
    gesture.handlers.onTouchesMove(touch(dx, dy), {fail() {result = 'failed';}, activate() {result = 'active'; gesture.handlers.onStart();}});
    if (result === 'active') gesture.handlers.onUpdate({translationX: dx});
    return result;
  }
  function end(success = true) {gesture.handlers.onEnd({}, success); gesture.handlers.onFinalize({}, success);}
  assert.equal(begin(20), 'failed', 'Closed rightward row drag yields to drawer');
  assert.equal(begin(2, 20), 'failed', 'Vertical intent yields to native scroll');
  assert.equal(begin(-51), 'active'); end(); motion.advance(200); assert.equal(offset.value, 0);
  assert.equal(begin(-52), 'active'); end(); motion.advance(100); const partial = offset.value;
  assert.ok(partial < -52 && partial > -130);
  assert.equal(begin(12), 'active'); assert.equal(offset.value, partial + 12, 'No stale JS animation listener is used as a new drag origin');
  end(); motion.advance(200); assert.equal(offset.value, 0);
  begin(-80); end(); motion.advance(200); assert.equal(offset.value, -130);
  begin(25); end(); motion.advance(200); assert.equal(offset.value, -130, 'Above the closing 80% threshold stays revealed');
  begin(27); end(); motion.advance(200); assert.equal(offset.value, 0);
  begin(-100); end(false); motion.advance(200); assert.equal(offset.value, 0);
  assert.equal(motion.jsCalls.length, 0, 'No row drag frame crosses to JS');
  await host.render(React.createElement(BookmarkRow, {...props})); assert.equal(renders, 1, 'Stable data/actions skip row rendering');
  const press = () => presses.filter(value => value.accessibilityLabel === 'Article').at(-1);
  await act(async () => {gesture.handlers.onTouchesDown(touch(0, 0)); press().onPress();}); assert.deepEqual(opens, ['one']);
  begin(-80); end(); motion.advance(200);
  await act(async () => {gesture.handlers.onTouchesDown(touch(0, 0)); press().onPress();}); assert.deepEqual(opens, ['one']); motion.advance(200); assert.equal(offset.value, 0);
  await act(async () => presses.find(value => value.accessibilityLabel === 'bookmark_star').onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [['one', {isStarred: 1}]], 'Write starts without waiting for the close animation');
  await act(async () => {gesture.handlers.onTouchesDown(touch(0, 0)); press().onLongPress();}); assert.equal(menus.visible, true);
  await act(async () => menus.items.find(value => value.label === 'bookmark_edit_title').onPress()); assert.deepEqual(edits, ['one']);
  await act(async () => menus.items.find(value => value.label === 'bookmark_delete').onPress()); assert.deepEqual(writes.at(-1), ['delete', 'one']); assert.deepEqual(failures, []);
  await host.render(React.createElement(BookmarkRow, {...props, owned: false})); assert.equal(motion.detectors()[0].config.enabled, false);
}));

test('closed menus create no native animation or timer, while open/close retains source durations and cancellation', nativeBoundary, async () => withNativeHost(async host => {
  const installed = installedAnimatedHost(host);
  let timerCalls = 0;
  const {SourceMenu} = await loadComponent('../../src/components/SourceMenu.tsx', {react: React, 'react-native': {...host.native, Animated: installed.Animated}, '../theme': theme, './SourceUI': host.components}, {setTimeout() {timerCalls++; throw new Error('A menu must not wait on an artificial timer');}});
  const props = {visible: false, items: [{label: 'Action', onPress() {}}], anchor: {x: 30, y: 40}, onDismiss() {}};
  await host.render(React.createElement(SourceMenu, props)); assert.equal(installed.starts.length, 0); assert.equal(timerCalls, 0); assert.equal(installed.attached(), 0);
  await host.render(React.createElement(SourceMenu, {...props, visible: true})); assert.equal(installed.starts.at(-1).config.duration, 200);
  await act(async () => installed.advance(80));
  await host.render(React.createElement(SourceMenu, props)); assert.equal(installed.starts.at(-1).config.duration, 150);
  await host.render(React.createElement(SourceMenu, {...props, visible: true})); await act(async () => installed.advance(400)); assert.ok(installed.attached() > 0, 'Cancelled close cannot unmount a reopened menu');
  await host.render(React.createElement(SourceMenu, props)); await act(async () => installed.advance(400)); assert.equal(installed.attached(), 0);
}));

test('feed position clamps bounce, preserves prepend anchoring and clamps a restored shrunken document only at a real end', nativeBoundary, async () => withNativeHost(async host => {
  const {FeedScrollPosition, useFeedScrollPosition} = await loadComponent('../../src/components/feed-scroll.ts', {react: React});
  const position = new FeedScrollPosition(), commands = []; let scroll;
  function Feed() {const scrollTo = React.useCallback(offset => commands.push(offset), []); scroll = useFeedScrollPosition(position, scrollTo); return null;}
  const observed = (y, height = 1500) => ({nativeEvent: {contentOffset: {y}, contentSize: {height}, layoutMeasurement: {height: 500}}});
  await host.render(React.createElement(Feed));
  scroll.events.onLayout({nativeEvent: {layout: {height: 500}}}); scroll.events.onContentSizeChange(400, 1500);
  scroll.events.onScroll(observed(1100)); assert.equal(position.offset, 1000);
  scroll.events.onScroll(observed(-35)); assert.equal(position.offset, 0);
  scroll.events.onScroll(observed(500)); scroll.events.onContentSizeChange(400, 1700); scroll.events.onScroll(observed(700, 1700));
  assert.equal(position.offset, 700); assert.deepEqual(commands, [], 'Native prepend anchoring is not replaced with JS scroll commands');
  scroll.events.onContentSizeChange(400, 800); assert.equal(position.offset, 300);
  await host.render(null); position.offset = 900; await host.render(React.createElement(Feed));
  scroll.events.onLayout({nativeEvent: {layout: {height: 500}}}); scroll.events.onContentSizeChange(400, 800); scroll.events.onScroll(observed(0, 800));
  assert.equal(position.offset, 900); assert.deepEqual(commands, []);
  scroll.events.onEndReached({distanceFromEnd: 0}); assert.deepEqual(commands, [300]);
  scroll.events.onScroll(observed(300, 800)); assert.equal(position.offset, 300);
}));

test('RSS deadline ticks preserve row renders/callbacks and hidden feeds stop their clock', nativeBoundary, async () => withNativeHost(async host => {
  let now = Date.parse('2026-10-11T10:00:00Z'), listProps, rowRenders = 0;
  const timers = new Map(), actions = [];
  class Clock extends Date {static now() {return now;}}
  const scrolling = await loadComponent('../../src/components/feed-scroll.ts', {react: React});
  const nil = () => null, t = key => key, mobile = {t};
  const FlatList = React.forwardRef((props, ref) => {listProps = props; React.useImperativeHandle(ref, () => ({scrollToOffset() {}})); return React.createElement(React.Fragment, null, props.ListHeaderComponent, props.data.map(item => React.cloneElement(props.renderItem({item}), {key: item.id})), props.ListFooterComponent);});
  const text = props => {if (props.children === 'Article') rowRenders++; return React.createElement(host.native.View, props);};
  const {RssFeed} = await loadComponent('../../src/components/RssFeed.tsx', {
    react: React, 'react-native': {...host.native, FlatList}, '../runtime': {useMobile: () => mobile}, '../rss/controller': {rssDisplayName: () => 'Feed'}, '../theme': theme,
    './SourceUI': {...host.components, SourceText: text, SourceButton: nil, SourceDialog: nil, SourceSheet: nil, SourceProgress: nil, Divider: nil, TextAction: props => {actions.push(props); return null;}}, './SourceMenu': {SourceMenu: nil}, './AppImage': {AppImage: nil}, './fixture-actions': {}, './feed-scroll': scrolling,
  }, {Date: Clock, setInterval(callback) {const id = Symbol(); timers.set(id, callback); return id;}, clearInterval(id) {timers.delete(id);}});
  const position = new scrolling.FeedScrollPosition(), entry = {id: 'one', title: 'Article', summary: '', author: '', first_seen_at: '2026-10-11T09:00:00Z', article_url: 'https://example.test'};
  const state = {enabled: true, ready: true, busy: false, selected: 'feed', subscriptions: [{id: 'feed', next_allowed_at: new Date(now + 10000).toISOString()}], entries: [entry], hasMore: true, retryAt: new Date(now + 10000).toISOString()};
  const props = {state, controller: {}, adding: false, onDismissAdd() {}, onOpen() {}, scrollPosition: position};
  await host.render(React.createElement(RssFeed, props)); const renderItem = listProps.renderItem;
  assert.equal(timers.size, 1); assert.equal(rowRenders, 1); assert.equal(actions.at(-1).disabled, true);
  await act(async () => {now += 5000; for (const callback of timers.values()) callback();});
  assert.equal(rowRenders, 1); assert.equal(listProps.renderItem, renderItem);
  await act(async () => {now += 5000; for (const callback of timers.values()) callback();});
  assert.equal(actions.at(-1).disabled, false); assert.equal(rowRenders, 1); assert.equal(listProps.renderItem, renderItem);
  await host.render(React.createElement(RssFeed, {...props, active: false})); assert.equal(timers.size, 0); assert.equal(rowRenders, 1);
}));
