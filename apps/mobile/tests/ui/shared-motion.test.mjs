import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, loadComponent, withNativeHost, nativeBoundary} from '../reader/parity-host.mjs';
import {installedMotionHost, loadWorkletComponent} from './installed-motion-host.mjs';
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

for (const reducedMotion of [false, true]) test(`drawer fences delayed UI-to-JS completion, reverses and resizes (reduced=${reducedMotion})`, nativeBoundary, async () => withNativeHost(async host => {
  let overlay, surface, drawerStyle, back, update;
  const changes = [];
  const View = props => {
    if ('accessibilityViewIsModal' in props) overlay = props;
    else if ('collapsable' in props) surface = props;
    if (props.testID === 'drawer') drawerStyle = props.style;
    return React.createElement(host.native.View, props);
  };
  const live = () => overlay.pointerEvents !== 'none' || surface.pointerEvents !== 'none';
  const motion = installedMotionHost(View, {reducedMotion, deferJS: true});
  const {SourceDrawer} = loadWorkletComponent(new URL('../../src/components/SourceDrawer.tsx', import.meta.url), {
    react: React, 'react-native': {...host.native, View, BackHandler: {addEventListener: (_name, handler) => {back = handler; return {remove() {back = undefined;}};}}},
    'react-native-reanimated': motion.reanimated, 'react-native-gesture-handler': motion.gestures,
    '@react-navigation/native': {useFocusEffect: callback => React.useEffect(callback, [callback])},
  });
  let width = 320;
  function Harness() {const [open, setOpen] = React.useState(false); update = setOpen; return React.createElement(SourceDrawer, {testID: 'drawer', open, width, onOpenChange: next => {changes.push(next); setOpen(next);}, drawer: 'Drawer', children: 'Feed'});}
  const render = () => host.render(React.createElement(Harness));
  const drag = (gesture, dx, success = true) => {gesture.handlers.onStart(); gesture.handlers.onUpdate({translationX: dx}); gesture.handlers.onEnd({velocityX: 0}, success); gesture.handlers.onFinalize({}, success);};
  await render(); assert.equal(overlay.pointerEvents, 'none'); assert.ok(live(), 'Closed drawer leaves the feed interactive');
  await act(async () => {drag(motion.detectors()[0], 220); motion.advance(reducedMotion ? 0 : 300); motion.flushJS();});
  assert.deepEqual(changes, [true]); assert.equal(overlay.pointerEvents, 'auto'); assert.ok(live(), 'Open drawer keeps its dismiss surface interactive'); assert.equal(motion.values[0].value, 1); assert.ok(back);
  await act(async () => update(false));
  await act(async () => motion.advance(reducedMotion ? 0 : 300));
  const oldClose = motion.started.at(-1);
  await act(async () => update(true));
  await act(async () => {oldClose.callback?.(true); motion.flushJS();});
  assert.equal(overlay.pointerEvents, 'auto', 'A queued old close cannot hide a reopened drawer');
  await act(async () => motion.advance(reducedMotion ? 0 : 300)); assert.equal(motion.values[0].value, 1);
  await act(async () => {drag(motion.detectors()[1], -70, false); motion.advance(reducedMotion ? 0 : 300); motion.flushJS();});
  assert.equal(motion.values[0].value, 1); assert.deepEqual(changes, [true], 'Cancelled closing never commits a close');
  width = 480; await render();
  assert.equal(drawerStyle[0].width, 480); assert.equal(drawerStyle[1].transform[0].translateX, 0);
  await act(async () => {drag(motion.detectors()[1], -400); motion.advance(reducedMotion ? 0 : 300); motion.flushJS();});
  assert.deepEqual(changes, [true, false]); assert.equal(overlay.pointerEvents, 'none'); assert.ok(live(), 'Closing the drawer restores feed interaction'); assert.equal(back, undefined);
  await act(async () => {drag(motion.detectors()[0], 400); motion.advance(reducedMotion ? 0 : 300); drag(motion.detectors()[1], -400); motion.advance(reducedMotion ? 0 : 300); drag(motion.detectors()[0], 400); motion.advance(reducedMotion ? 0 : 300); motion.flushJS();});
  assert.deepEqual(changes, [true, false, true], 'Only the last rapid-reversal gesture may publish its open callback');
  await act(async () => update(false)); const active = motion.started.at(-1);
  await host.render(null);
  await act(async () => {active.callback?.(true); motion.flushJS();});
  assert.equal(motion.pending(), 0); assert.deepEqual(changes, [true, false, true]);
}));

test('a gesture that supersedes the first close still publishes the close and restores feed interaction', nativeBoundary, async () => withNativeHost(async host => {
  let overlay, surface, lock, openState = false;
  const changes = [];
  const View = props => {
    if ('accessibilityViewIsModal' in props) overlay = props;
    else if ('collapsable' in props) surface = props;
    return React.createElement(host.native.View, props);
  };
  const motion = installedMotionHost(View, {deferJS: true});
  const {SourceDrawer, useDrawerInput} = loadWorkletComponent(new URL('../../src/components/SourceDrawer.tsx', import.meta.url), {
    react: React, 'react-native': {...host.native, View, BackHandler: {addEventListener: () => ({remove() {}})}},
    'react-native-reanimated': motion.reanimated, 'react-native-gesture-handler': motion.gestures,
    '@react-navigation/native': {useFocusEffect: callback => React.useEffect(callback, [callback])},
  });
  function Feed() {lock = useDrawerInput(); return null;}
  function Harness() {const [open, setOpen] = React.useState(false); openState = open; return React.createElement(SourceDrawer, {open, width: 320, onOpenChange: next => {changes.push(next); setOpen(next);}, drawer: 'Drawer', children: React.createElement(Feed)});}
  const render = () => host.render(React.createElement(Harness));
  const drag = (gesture, dx, velocity = 0, success = true) => {gesture.handlers.onStart(); gesture.handlers.onUpdate({translationX: dx}); gesture.handlers.onEnd({velocityX: velocity}, success); gesture.handlers.onFinalize({}, success);};
  await render();
  assert.equal(lock.value, false, 'The closed drawer leaves row input unlocked');
  await act(async () => {drag(motion.detectors()[0], 40); motion.advance(300); motion.flushJS();});
  assert.equal(openState, false, 'A short opening pan settles closed');
  assert.equal(lock.value, false, 'A cancelled short open restores row input');
  assert.deepEqual(changes, []);
  await act(async () => {drag(motion.detectors()[0], 240, 500); motion.advance(300); motion.flushJS();});
  assert.equal(openState, true);
  await act(async () => {drag(motion.detectors()[1], -240, -500);}); // close result still queued for JS
  await act(async () => {drag(motion.detectors()[1], -20, -500);}); // a newer gesture bumps the UI generation
  await act(async () => {motion.flushJS(); motion.advance(300); motion.flushJS();});
  assert.equal(openState, false, 'A newer gesture must not swallow the close the parent still needs');
  assert.equal(overlay.pointerEvents, 'none', 'The closed drawer no longer intercepts touches');
  assert.notEqual(surface.pointerEvents, 'none', 'The closed drawer leaves the feed interactive');
  const beforeReopen = changes.length;
  await act(async () => {drag(motion.detectors()[0], 240, 500); motion.advance(300); motion.flushJS();});
  assert.equal(openState, true, 'A later opening gesture still opens the drawer');
  assert.deepEqual(changes.slice(beforeReopen), [true]);
}));

test('row cancellation cannot finish a newer drag and reduced motion skips title pulses without changing swipe arbitration', nativeBoundary, async () => withNativeHost(async host => {
  const motion = installedMotionHost(host.native.View), presses = [], pulses = [];
  let preference;
  const native = {...host.native, PixelRatio: {roundToNearestPixel: value => value},
    AccessibilityInfo: {isReduceMotionEnabled: async () => false, addEventListener: (_name, callback) => {preference = callback; return {remove() {}};}},
    Pressable: props => {presses.push(props); return React.createElement(host.native.Pressable, props);},
    Animated: {...host.native.Animated, sequence: children => {const entry = {children, stopped: false, start() {pulses.push(this);}, stop() {this.stopped = true;}}; return entry;}},
  };
  const {BookmarkRow} = loadWorkletComponent(new URL('../../src/components/BookmarkRow.tsx', import.meta.url), {
    react: React, 'react-native': native, 'react-native-reanimated': motion.reanimated, 'react-native-gesture-handler': motion.gestures,
    './SourceDrawer': {useDrawerGesture: () => null, useDrawerInput: () => null}, 'expo-haptics': {impactAsync: async () => {}, ImpactFeedbackStyle: {Medium: 'medium'}},
    '../data/repositories': {bookmarkDisplayTitle: item => item.title}, '../theme': theme, '../theme/testIds': {mobileTestIds: {}},
    './SourceUI': {SourceIcon: () => null}, './SourceLine': {SourceLine: () => null}, './SourceMenu': {SourceMenu: () => null},
    './BookmarkStatusIcon': {BookmarkStatusIcon: () => null, bookmarkDownloadStatus: value => value === 1 ? 'DOWNLOADING' : value === 2 ? 'COMPLETED' : value === 3 ? 'FAILED' : 'NONE'},
  });
  let item = {id: 'one', title: 'Before', status: 'success'};
  const opens = [], props = {owned: true, sort: 'inbox', t: value => value, onOpen: value => opens.push(value.id), onEdit() {}, onError() {}, repositories: {}, telemetry: {element() {}, firebase() {}}};
  const render = () => host.render(React.createElement(BookmarkRow, {...props, item}));
  await render();
  const gesture = () => motion.detectors()[0];
  const start = () => gesture().handlers.onStart();
  const end = success => {gesture().handlers.onEnd({}, success); gesture().handlers.onFinalize({}, success);};
  start(); gesture().handlers.onUpdate({translationX: -80}); end(true);
  const obsolete = motion.started.at(-1); motion.advance(80); start();
  obsolete.callback?.(true);
  assert.equal(motion.values[2].value, true, 'Obsolete settle cannot release the active drag press guard');
  await act(async () => presses.filter(value => value.accessibilityLabel === 'Before').at(-1).onPress());
  assert.deepEqual(opens, []);
  end(false); motion.advance(200); assert.equal(motion.values[0].value, 0); assert.equal(motion.values[2].value, false);
  item = {...item, title: 'Changed'}; await render(); assert.equal(pulses.length, 1);
  host.values[0].setValue(0.05);
  await act(async () => preference(true));
  assert.equal(pulses[0].stopped, true); assert.equal(host.values[0].value, 0, 'Cancelled title pulse leaves no dark overlay');
  item = {...item, title: 'Reduced'}; await render(); assert.equal(pulses.length, 1);
  motion.setReducedMotion(true); start(); gesture().handlers.onUpdate({translationX: -80}); end(true); motion.advance(0);
  assert.equal(motion.values[0].value, -130); assert.equal(motion.values[2].value, false);
  start(); gesture().handlers.onUpdate({translationX: 20}); end(false); motion.advance(0); assert.equal(motion.values[0].value, 0);
  await act(async () => preference(false));
  item = {...item, title: 'Again'}; await render(); assert.equal(pulses.length, 2, 'Returning to normal motion restores future feedback');
  motion.setReducedMotion(false); start(); gesture().handlers.onUpdate({translationX: -80}); end(true);
  item = {...item, id: 'replacement'}; await render(); assert.equal(motion.pending(), 0); assert.equal(motion.values[0].value, 0);
  await host.render(null); assert.equal(pulses.at(-1).stopped, true); assert.equal(motion.pending(), 0);
}));
