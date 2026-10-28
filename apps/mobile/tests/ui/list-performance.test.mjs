import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, loadComponent, withNativeHost, nativeBoundary} from '../reader/parity-host.mjs';
import {installedMotionHost, loadWorkletComponent} from './installed-motion-host.mjs';
import {installedAnimatedHost} from '../reader/installed-animated-host.mjs';

const theme = await loadComponent('../../src/theme/index.ts', {});

/** Tracks which labelled Pressables are mounted right now, in tree order. */
function liveRegistry(Primitive) {
  const mounted = new Set();
  function Live(props) {
    const entry = React.useRef({label: props.accessibilityLabel ?? props.testID}).current; entry.label = props.accessibilityLabel ?? props.testID;
    React.useLayoutEffect(() => {mounted.add(entry); return () => {mounted.delete(entry);};}, [entry]);
    return React.createElement(Primitive, props);
  }
  return {Live, labels: () => [...mounted].map(value => value.label)};
}
test('production row mounts as plain views at rest, uses one directional UI-thread pan, velocity settle, one haptic per threshold crossing and lifts only while its menu is mounted', nativeBoundary, async () => withNativeHost(async host => {
  let rowStyle;
  const View = props => {if (Array.isArray(props.style) && props.style.some(value => value?.transform)) rowStyle = props.style; return React.createElement(host.native.View, props);};
  const motion = installedMotionHost(View), {Live, labels} = liveRegistry(host.native.Pressable);
  const presses = [], writes = [], events = [], opens = [], edits = [], failures = [], haptics = [];
  let menus, renders = 0;
  const {BookmarkRow} = loadWorkletComponent(new URL('../../src/components/BookmarkRow.tsx', import.meta.url), {
    react: React, 'react-native': {...host.native, View, Animated: {...host.native.Animated, View: Live}, PixelRatio: {roundToNearestPixel: value => value}, Pressable: props => {presses.push(props); return React.createElement(Live, props);}},
    'react-native-gesture-handler': motion.gestures, 'react-native-reanimated': motion.reanimated, 'react-native-worklets': motion.worklets,
    'expo-haptics': {impactAsync: async () => {haptics.push('impact');}, selectionAsync: async () => {haptics.push('selection');}, ImpactFeedbackStyle: {Medium: 'medium'}},
    '../data/repositories': {bookmarkDisplayTitle: item => item.title}, '../theme': theme, '../theme/testIds': {mobileTestIds: {}},
    './SourceUI': {SourceIcon: () => null}, './SourceLine': {SourceLine: () => {renders++; return null;}}, './SourceMenu': {SourceMenu: props => {menus = props; return null;}},
    './BookmarkStatusIcon': {BookmarkStatusIcon: () => null, bookmarkDownloadStatus: value => value === 1 ? 'DOWNLOADING' : value === 2 ? 'COMPLETED' : value === 3 ? 'FAILED' : 'NONE'},
  });
  const item = {id: 'one', title: 'Article', status: 'success', isStarred: 0, archiveStatus: 0, downloadStatus: 0};
  const props = {item, owned: true, sort: 'inbox', t: key => key, onOpen: value => opens.push(value.id), onEdit: value => edits.push(value.id), onError: error => failures.push(error), repositories: {updateBookmark: async (...args) => writes.push(args), deleteBookmark: async id => writes.push(['delete', id])}, telemetry: {element: (...args) => events.push(args), firebase() {}}};
  const actionButtons = () => labels().filter(label => label === 'bookmark_star' || label === 'bookmark_archive').length;
  await host.render(React.createElement(BookmarkRow, props));
  assert.deepEqual(labels(), ['Article'], 'At rest only the row itself is mounted: no swipe action buttons');
  assert.equal(host.props.has('bookmark-row-title-flash'), false, 'No title-flash overlay at rest');
  assert.equal(motion.writes.length, 0, 'Mounting writes no shared value'); assert.equal(motion.cancels.length, 0, 'Mounting cancels no animation');
  assert.equal(motion.styles.length, 1, 'One animated style mapper per row');
  assert.deepEqual([...motion.styles[0].deps], [false], 'The mapper rebuilds only when the lift attaches or detaches');
  assert.ok(rowStyle.every(value => !('shadowOpacity' in (value ?? {}))) && rowStyle.some(value => value?.transform?.length === 1), 'At rest the surface style is only its translation');
  const row = presses.find(value => value.accessibilityLabel === 'Article');
  assert.deepEqual(Array.from(row.accessibilityActions, value => value.name), ['star', 'archive'], 'Swipe actions stay reachable by assistive technology while unmounted');
  const gesture = () => motion.detectors()[0], config = () => gesture().config, offset = motion.values[0];
  const ticks = () => haptics.filter(value => value === 'selection').length;
  assert.equal(gesture().shouldUseReanimated, true, 'Every row callback is a UI worklet');
  assert.deepEqual([...config().activeOffsetX], [-10, 10]); assert.deepEqual([...config().failOffsetY], [-10, 10]);
  assert.equal(config().failOffsetX, 5, 'A closed row fails a rightward drag before it could activate, yielding to the drawer; a plain number binds no shared-value listener');
  for (const relation of ['block', 'simultaneousWith', 'requireToFail']) assert.equal(config()[relation], undefined, 'No gesture relation and no input lock');
  const activate = () => act(async () => gesture().handlers.onActivate({}));
  await activate();
  const order = Array.from(presses.slice(-3), value => value.accessibilityLabel);
  assert.deepEqual(order, ['bookmark_star', 'bookmark_archive', 'Article'], 'Starting a drag mounts the actions before, so beneath, the sliding surface');
  assert.equal(actionButtons(), 2);
  const drag = (dx, {velocityX = 0, canceled = false} = {}) => act(async () => {gesture().handlers.onActivate({}); const calls = motion.jsCalls.length; gesture().handlers.onUpdate({translationX: dx}); assert.ok(motion.jsCalls.slice(calls).every(callback => callback.name === 'thresholdTick'), 'Drag frames cross to JS only for the threshold haptic'); gesture().handlers.onDeactivate({translationX: dx, velocityX, canceled});});
  const advance = ms => act(async () => motion.advance(ms));
  await drag(-51); await advance(200); assert.equal(offset.value, 0); assert.equal(ticks(), 0, 'Below the 40% threshold: no crossing, no haptic');
  assert.equal(actionButtons(), 0, 'Settling closed unmounts the actions again');
  await drag(-52); assert.equal(ticks(), 1, 'Crossing the reveal threshold plays one selection haptic');
  await advance(100); const partial = offset.value;
  assert.ok(partial < -52 && partial > -130);
  await drag(12); assert.equal(offset.value, partial + 12, 'No stale animation origin; the drag continues from the in-flight offset');
  await advance(200); assert.equal(offset.value, 0); assert.equal(ticks(), 2);
  await drag(-80); await advance(200); assert.equal(offset.value, -130); assert.equal(ticks(), 3);
  assert.equal(config().failOffsetX, Number.MAX_SAFE_INTEGER, 'A revealed row may be dragged closed to the right');
  assert.equal(actionButtons(), 2, 'A revealed row keeps its actions mounted');
  await drag(25); await advance(200); assert.equal(offset.value, -130, 'Above the closing 80% threshold stays revealed'); assert.equal(ticks(), 3);
  await drag(27); await advance(200); assert.equal(offset.value, 0); assert.equal(ticks(), 4);
  assert.equal(config().failOffsetX, 5); assert.equal(actionButtons(), 0);
  await drag(-100, {canceled: true}); await advance(200); assert.equal(offset.value, 0, 'A cancelled drag settles closed');
  const beforeFling = ticks();
  await drag(-30, {velocityX: -600}); await advance(200); assert.equal(offset.value, -130, 'A leftward fling reveals regardless of distance'); assert.equal(ticks(), beforeFling, 'Velocity settling plays no extra haptic');
  await drag(10, {velocityX: 600}); await advance(200); assert.equal(offset.value, 0, 'A rightward fling closes regardless of distance');
  assert.ok(motion.jsCalls.length > 0 && motion.jsCalls.every(callback => ['thresholdTick', 'setRevealed', 'setShowActions', 'dispatchSetState', 'bound dispatchSetState'].includes(callback.name)), 'Only the haptic and the drag/settle state cross to JS');
  const rendersBefore = renders;
  await host.render(React.createElement(BookmarkRow, {...props})); assert.equal(renders, rendersBefore, 'Stable data/actions skip row rendering');
  const press = () => presses.filter(value => value.accessibilityLabel === 'Article').at(-1);
  await act(async () => press().onPress()); assert.deepEqual(opens, ['one']);
  await drag(-80); await advance(200);
  await act(async () => press().onPress()); assert.deepEqual(opens, ['one'], 'Tapping a revealed row visibly closes it'); await advance(200); assert.equal(offset.value, 0);
  await drag(-80); await advance(200); await drag(60); await advance(50);
  await act(async () => press().onPress()); assert.deepEqual(opens, ['one', 'one'], 'A tap while the row settles closed opens it instead of being swallowed');
  await drag(-80); await advance(200);
  await act(async () => presses.filter(value => value.accessibilityLabel === 'bookmark_star').at(-1).onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [['one', {isStarred: 1}]], 'Write starts without waiting for the close animation');
  await advance(200); assert.equal(actionButtons(), 0);
  await act(async () => press().onAccessibilityAction({nativeEvent: {actionName: 'archive'}}));
  assert.deepEqual(JSON.parse(JSON.stringify(writes.at(-1))), ['one', {archiveStatus: 1}], 'The archive accessibility action performs the swipe action');
  assert.ok(rowStyle.every(value => !('shadowOpacity' in (value ?? {}))), 'The lift shadow is not attached before the menu mounts');
  await act(async () => press().onLongPress()); assert.equal(menus.visible, true);
  assert.ok(rowStyle.some(value => 'shadowOpacity' in (value ?? {})), 'The lift style attaches while the menu is mounted');
  assert.deepEqual([...motion.styles.at(-1).deps], [true]);
  assert.equal(config().enabled, false, 'An open menu disables the swipe');
  await act(async () => menus.items.find(value => value.label === 'bookmark_edit_title').onPress()); assert.deepEqual(edits, ['one']);
  await act(async () => menus.items.find(value => value.label === 'bookmark_delete').onPress()); assert.deepEqual(writes.at(-1), ['delete', 'one']); assert.deepEqual(failures, []);
  await act(async () => menus.onDismiss());
  await advance(2000);
  assert.ok(rowStyle.every(value => !('shadowOpacity' in (value ?? {}))), 'The lift style detaches once the menu has settled closed');
  await host.render(React.createElement(BookmarkRow, {...props, item: {...item, title: 'Renamed'}}));
  assert.ok(host.props.has('bookmark-row-title-flash'), 'A title change mounts the flash overlay for its pulse');
  assert.equal(labels().includes('bookmark-row-title-flash'), false, 'The overlay unmounts once the pulse completes');
  await host.render(React.createElement(BookmarkRow, {...props, owned: false})); assert.equal(config().enabled, false);
  assert.equal(press().accessibilityActions, undefined, 'An unowned row offers no row actions');
}));

test('a list of resting rows performs no per-row shared-value writes on mount or unmount and resets only on a real identity change', nativeBoundary, async () => withNativeHost(async host => {
  const motion = installedMotionHost(host.native.View), {Live, labels} = liveRegistry(host.native.Pressable);
  const {BookmarkRow} = loadWorkletComponent(new URL('../../src/components/BookmarkRow.tsx', import.meta.url), {
    react: React, 'react-native': {...host.native, Pressable: Live, PixelRatio: {roundToNearestPixel: value => value}},
    'react-native-gesture-handler': motion.gestures, 'react-native-reanimated': motion.reanimated, 'react-native-worklets': motion.worklets,
    'expo-haptics': {impactAsync: async () => {}, selectionAsync: async () => {}, ImpactFeedbackStyle: {Medium: 'medium'}},
    '../data/repositories': {bookmarkDisplayTitle: item => item.title}, '../theme': theme, '../theme/testIds': {mobileTestIds: {}},
    './SourceUI': {SourceIcon: () => null}, './SourceLine': {SourceLine: () => null}, './SourceMenu': {SourceMenu: () => null},
    './BookmarkStatusIcon': {BookmarkStatusIcon: () => null, bookmarkDownloadStatus: () => 'NONE'},
  });
  const base = {owned: true, sort: 'inbox', t: key => key, onOpen() {}, onEdit() {}, onError() {}, repositories: {}, telemetry: {element() {}, firebase() {}}};
  const items = Array.from({length: 20}, (_, index) => ({id: `row-${index}`, title: `Row ${index}`, status: 'success'}));
  const list = (rows, props = {}) => React.createElement(React.Fragment, null, rows.map(item => React.createElement(BookmarkRow, {key: item.id, ...base, ...props, item})));
  await host.render(list(items));
  assert.equal(motion.styles.length, items.length, 'One animated style mapper per row');
  assert.equal(motion.writes.length + motion.cancels.length, 0, 'Mounting twenty rows writes or cancels no shared value');
  assert.equal(labels().length, items.length, 'No resting row mounts swipe buttons; only the row pressables exist');
  assert.equal(host.props.has('bookmark-row-title-flash'), false, 'No resting row mounts a title-flash overlay');
  await host.render(list(items.map(item => ({...item, title: item.title})))); assert.equal(motion.writes.length + motion.cancels.length, 0, 'Same-identity updates do not reset rows');
  await host.render(list(items.slice(10))); assert.equal(motion.writes.length + motion.cancels.length, 0, 'Unmounting untouched rows does not cancel their animations');
  await host.render(list(items.slice(10), {sort: 'starred'}));
  assert.equal(motion.writes.length, 10, 'A real swipe-width change resets each row once');
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
    './FeedList': await loadComponent('../../src/components/FeedList.tsx', {react: React, 'react-native': {...host.native, FlatList}}),
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
