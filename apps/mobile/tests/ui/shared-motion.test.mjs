import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, loadComponent, withNativeHost, nativeBoundary} from '../reader/parity-host.mjs';
import {drawerMotionModule, installedMotionHost, loadWorkletComponent} from './installed-motion-host.mjs';
import {motionModules} from './motion-modules.mjs';

const theme = await loadComponent('../../src/theme/index.ts', {});

test('shared reduced-motion subscription fences stale initial reads, removed listeners and remounts', nativeBoundary, async () => withNativeHost(async host => {
  const reads = [], subscriptions = [], snapshots = new Map();
  const native = {...host.native, AccessibilityInfo: {
    isReduceMotionEnabled: () => new Promise((resolve, reject) => reads.push({resolve, reject})),
    addEventListener: (_name, callback) => {const entry = {callback, removed: false, remove() {this.removed = true;}}; subscriptions.push(entry); return entry;},
  }};
  const {useReducedMotion} = motionModules({react: React, 'react-native': native})['../motion/useReducedMotion'];
  function Probe({id}) {snapshots.set(id, useReducedMotion()); return null;}
  const tree = ids => React.createElement(React.Fragment, null, ids.map(id => React.createElement(Probe, {key: id, id})));
  await host.render(tree(['sheet', 'row']));
  assert.equal(subscriptions.length, 1); assert.equal(reads.length, 1);
  assert.equal(snapshots.get('sheet'), false, 'Animations are not disabled by default');
  await act(async () => subscriptions[0].callback(true));
  await act(async () => reads[0].resolve(false));
  assert.equal(snapshots.get('sheet'), true); assert.equal(snapshots.get('row'), true, 'Late initial read cannot reverse an observed preference change');
  await host.render(tree(['row'])); assert.equal(subscriptions[0].removed, false);
  await host.render(null); assert.equal(subscriptions[0].removed, true);
  await host.render(tree(['sheet'])); assert.equal(subscriptions.length, 2);
  await act(async () => {subscriptions[0].callback(false); reads[1].reject(new Error('Unavailable preference'));});
  assert.equal(snapshots.get('sheet'), true, 'Old listener and failed read retain the last known preference');
  await act(async () => subscriptions[1].callback(false)); assert.equal(snapshots.get('sheet'), false);
  await host.render(null); await host.render(tree(['row']));
  await host.render(null); await host.render(tree(['sheet']));
  await act(async () => reads[2].resolve(true)); assert.equal(snapshots.get('sheet'), false, 'Unmounted query cannot update the new subscriber generation');
  await act(async () => reads[3].resolve(true)); assert.equal(snapshots.get('sheet'), true);
}));

function drawerHarness(host, {reducedMotion = false} = {}) {
  const views = {}, changes = [];
  const View = props => {
    if (props.animatedProps && 'pointerEvents' in props.animatedProps) views.scrim = props;
    else if (props.testID === 'drawer') views.panel = props;
    else if (props.animatedProps) views.content = props;
    return React.createElement(host.native.View, props);
  };
  const motion = installedMotionHost(View, {reducedMotion, deferJS: true});
  let back;
  const {SourceDrawer} = loadWorkletComponent(new URL('../../src/components/SourceDrawer.tsx', import.meta.url), {
    react: React, 'react-native': {...host.native, View, BackHandler: {addEventListener: (_name, handler) => {back = handler; return {remove() {back = undefined;}};}}},
    'react-native-reanimated': motion.reanimated, 'react-native-gesture-handler': motion.gestures, 'react-native-worklets': motion.worklets,
    '@react-navigation/native': {useFocusEffect: callback => React.useEffect(callback, [callback])}, './drawer-motion': drawerMotionModule(),
  });
  const pan = () => motion.detectors()[0];
  const drag = (dx, velocityX = 0, canceled = false) => {pan().handlers.onActivate({}); pan().handlers.onUpdate({translationX: dx}); pan().handlers.onDeactivate({translationX: dx, velocityX, canceled});};
  return {SourceDrawer, motion, views, changes, pan, drag, back: () => back, blocking: () => views.scrim.animatedProps.pointerEvents === 'auto'};
}

for (const reducedMotion of [false, true]) test(`drawer hit testing follows the resolved UI-thread state, reverses and resizes (reduced=${reducedMotion})`, nativeBoundary, async () => withNativeHost(async host => {
  const d = drawerHarness(host, {reducedMotion}), settle = reducedMotion ? 0 : 300;
  let update, width = 320;
  function Harness() {const [open, setOpen] = React.useState(false); update = setOpen; return React.createElement(d.SourceDrawer, {testID: 'drawer', open, width, onOpenChange: next => {d.changes.push(next); setOpen(next);}, drawer: 'Drawer', children: 'Feed'});}
  const render = () => host.render(React.createElement(Harness));
  await render(); assert.equal(d.blocking(), false, 'Closed drawer leaves the feed interactive');
  await act(async () => {d.drag(220); d.motion.advance(settle); d.motion.flushJS();});
  assert.deepEqual(d.changes, [true]); assert.equal(d.blocking(), true, 'Open drawer keeps its dismiss surface interactive'); assert.equal(d.motion.values[0].value, 1); assert.ok(d.back());
  await act(async () => update(false)); assert.equal(d.blocking(), false, 'A parent close releases hit testing without waiting for the animation');
  await act(async () => d.motion.advance(settle / 2));
  await act(async () => update(true));
  assert.equal(d.blocking(), true, 'Reopening during the close owns touches again; no stale completion is involved');
  await act(async () => d.motion.advance(settle)); assert.equal(d.motion.values[0].value, 1);
  await act(async () => {d.drag(-70, 0, true); d.motion.advance(settle); d.motion.flushJS();});
  assert.equal(d.motion.values[0].value, 1); assert.deepEqual(d.changes, [true], 'Cancelled closing never commits a close');
  width = 480; await render();
  assert.equal(d.views.panel.style[0].width, 480); assert.equal(d.views.panel.style[1].transform[0].translateX, 0);
  await act(async () => {d.drag(-400); d.motion.advance(settle); d.motion.flushJS();});
  assert.deepEqual(d.changes, [true, false]); assert.equal(d.blocking(), false, 'Closing the drawer restores feed interaction'); assert.equal(d.back(), undefined);
  await act(async () => {d.drag(400); d.motion.advance(settle); d.drag(-400); d.motion.advance(settle); d.drag(400); d.motion.advance(settle); d.motion.flushJS();});
  assert.deepEqual(d.changes, [true, false, true], 'Only the last rapid-reversal gesture may publish its open callback');
  await act(async () => update(false));
  await host.render(null);
  await act(async () => d.motion.flushJS());
  assert.equal(d.motion.pending(), 0); assert.deepEqual(d.changes, [true, false, true]);
}));

test('a gesture that supersedes the first close still publishes the close and restores feed interaction', nativeBoundary, async () => withNativeHost(async host => {
  const d = drawerHarness(host); let openState = false;
  function Harness() {const [open, setOpen] = React.useState(false); openState = open; return React.createElement(d.SourceDrawer, {open, width: 320, onOpenChange: next => {d.changes.push(next); setOpen(next);}, drawer: 'Drawer', children: 'Feed'});}
  await host.render(React.createElement(Harness));
  assert.equal(d.blocking(), false, 'The closed drawer leaves rows and the list untouched');
  await act(async () => {d.drag(40); d.motion.advance(300); d.motion.flushJS();});
  assert.equal(openState, false, 'A short opening pan settles closed'); assert.equal(d.blocking(), false); assert.deepEqual(d.changes, []);
  await act(async () => {d.pan().handlers.onActivate({}); d.motion.flushJS();});
  assert.equal(openState, false, 'Activation alone does not publish an open'); assert.equal(d.blocking(), true);
  await act(async () => {d.pan().handlers.onUpdate({translationX: 240}); d.pan().handlers.onDeactivate({translationX: 240, velocityX: 500, canceled: false}); d.motion.advance(300); d.motion.flushJS();});
  assert.equal(openState, true);
  await act(async () => {
    d.drag(-240, -500); // close result still queued for JS
    d.drag(-20, -500); // a newer gesture supersedes it before JS runs
  });
  assert.equal(d.blocking(), false, 'The resolved close stops intercepting touches before JS hears about it');
  await act(async () => {d.motion.flushJS(); d.motion.advance(300); d.motion.flushJS();});
  assert.equal(openState, false, 'A newer gesture must not swallow the close the parent still needs');
  assert.equal(d.blocking(), false, 'The closed drawer no longer intercepts touches');
  assert.deepEqual({...d.pan().config.hitSlop}, {left: 0, width: 32}, 'The closed drawer returns to leading-edge hit testing');
  const beforeReopen = d.changes.length;
  await act(async () => {d.drag(240, 500); d.motion.advance(300); d.motion.flushJS();});
  assert.equal(openState, true, 'A later opening gesture still opens the drawer');
  assert.deepEqual(d.changes.slice(beforeReopen), [true]);
}));

test('a newer row drag supersedes an in-flight settle, taps are never swallowed and reduced motion skips title pulses without changing swipe arbitration', nativeBoundary, async () => withNativeHost(async host => {
  const motion = installedMotionHost(host.native.View), presses = [], pulses = [];
  let preference;
  const native = {...host.native, PixelRatio: {roundToNearestPixel: value => value},
    AccessibilityInfo: {isReduceMotionEnabled: async () => false, addEventListener: (_name, callback) => {preference = callback; return {remove() {}};}},
    Pressable: props => {presses.push(props); return React.createElement(host.native.Pressable, props);},
    Animated: {...host.native.Animated, sequence: children => {const entry = {children, stopped: false, start() {pulses.push(this);}, stop() {this.stopped = true;}}; return entry;}},
  };
  const {BookmarkRow} = loadWorkletComponent(new URL('../../src/components/BookmarkRow.tsx', import.meta.url), {
    react: React, 'react-native': native, 'react-native-reanimated': motion.reanimated, 'react-native-gesture-handler': motion.gestures, 'react-native-worklets': motion.worklets,
    'expo-haptics': {impactAsync: async () => {}, selectionAsync: async () => {}, ImpactFeedbackStyle: {Medium: 'medium'}},
    '../data/repositories': {bookmarkDisplayTitle: item => item.title}, '../theme': theme, '../theme/testIds': {mobileTestIds: {}},
    './SourceUI': {SourceIcon: () => null}, './SourceLine': {SourceLine: () => null}, './SourceMenu': {SourceMenu: () => null},
    './BookmarkStatusIcon': {BookmarkStatusIcon: () => null, bookmarkDownloadStatus: value => value === 1 ? 'DOWNLOADING' : value === 2 ? 'COMPLETED' : value === 3 ? 'FAILED' : 'NONE'},
  });
  let item = {id: 'one', title: 'Before', status: 'success'};
  const opens = [], props = {owned: true, sort: 'inbox', t: value => value, onOpen: value => opens.push(value.id), onEdit() {}, onError() {}, repositories: {}, telemetry: {element() {}, firebase() {}}};
  const render = () => host.render(React.createElement(BookmarkRow, {...props, item}));
  await render();
  const gesture = () => motion.detectors()[0], offset = motion.values[0];
  const start = () => act(async () => gesture().handlers.onActivate({}));
  const move = dx => act(async () => gesture().handlers.onUpdate({translationX: dx}));
  const end = (canceled = false) => act(async () => gesture().handlers.onDeactivate({velocityX: 0, canceled}));
  const advance = ms => act(async () => motion.advance(ms));
  const tap = () => act(async () => presses.filter(value => value.accessibilityLabel === 'Before').at(-1).onPress());
  await start(); await move(-80); await end();
  await advance(80); const inFlight = offset.value; await start();
  assert.equal(motion.pending(), 0, 'A newer drag cancels the in-flight settle instead of racing its completion');
  await move(0); assert.equal(offset.value, inFlight, 'The new drag starts from the actual in-flight offset');
  await tap(); assert.deepEqual(opens, [], 'Tapping a revealed row visibly closes it instead of opening');
  await end(true); await advance(200); assert.equal(offset.value, 0);
  await tap(); assert.deepEqual(opens, ['one'], 'Once closed, the next tap opens the row');
  item = {...item, title: 'Changed'}; await render(); assert.equal(pulses.length, 1);
  host.values[0].setValue(0.05);
  await act(async () => preference(true));
  assert.equal(pulses[0].stopped, true); assert.equal(host.values[0].value, 0, 'Cancelled title pulse leaves no dark overlay');
  item = {...item, title: 'Reduced'}; await render(); assert.equal(pulses.length, 1);
  motion.setReducedMotion(true); await start(); await move(-80); await end(); await advance(0);
  assert.equal(offset.value, -130);
  await start(); await move(20); await end(true); await advance(0); assert.equal(offset.value, 0);
  await act(async () => preference(false));
  item = {...item, title: 'Again'}; await render(); assert.equal(pulses.length, 2, 'Returning to normal motion restores future feedback');
  motion.setReducedMotion(false); await start(); await move(-80); await end();
  item = {...item, id: 'replacement'}; await render(); assert.equal(motion.pending(), 0); assert.equal(offset.value, 0);
  await act(async () => presses.filter(value => value.accessibilityLabel === 'Again').at(-1).onPress());
  assert.deepEqual(opens, ['one', 'replacement'], 'A replaced item starts closed: its first tap opens it');
  await host.render(null); assert.equal(pulses.at(-1).stopped, true); assert.equal(motion.pending(), 0);
}));
