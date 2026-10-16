import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, loadComponent, withNativeHost, nativeBoundary, flattenStyle} from '../reader/parity-host.mjs';
import {mobileColors} from '../../src/theme/index.ts';
import {installedAnimatedHost} from '../reader/installed-animated-host.mjs';

for (const platform of ['ios', 'android']) test(`sheet ${platform} keeps backdrop stationary and waits for the proper dismissal boundary`, nativeBoundary, async () => withNativeHost(async host => {
  let modal, reduced;
  const animations = [];
  const native = {...host.native, Platform: {OS: platform}, AccessibilityInfo: {isReduceMotionEnabled: async () => false, addEventListener: (_event, callback) => {reduced = callback; return {remove() {}};}},
    Modal: props => {modal = props; return props.visible ? React.createElement(host.native.View, props) : null;},
    Animated: {...host.native.Animated, timing: (value, options) => {const animation = {value, options, stopped: false, start(callback) {this.callback = callback; animations.push(this);}, stop() {this.stopped = true;}}; return animation;}},
  };
  const {SourceSheetModal} = await loadComponent('../../src/components/SourceSheetModal.tsx', {react: React, 'react-native': native, '../theme': {mobileColors}});
  let visible = false, closed = 0;
  const render = () => host.render(React.createElement(SourceSheetModal, {visible, onDismiss() {}, onDidDismiss() {closed++;}}, React.createElement(host.native.View, {testID: 'payload'})));
  await render(); assert.equal(modal.visible, false); assert.equal(animations.length, 0);
  visible = true; await render();
  assert.equal(modal.transparent, true); assert.equal(modal.presentationStyle, 'overFullScreen'); assert.equal(modal.animationType, 'none');
  await act(async () => {modal.onShow(); host.props.get('source-sheet-content').onLayout({nativeEvent: {layout: {height: 320}}});});
  const opening = animations.at(-1); assert.equal(opening.options.useNativeDriver, true); assert.equal(opening.options.toValue, 1);
  assert.equal(flattenStyle(host.props.get('source-sheet-backdrop').style).transform, undefined);
  assert.deepEqual(Array.from(host.props.get('source-sheet-content').style.transform[0].translateY.outputRange), [320, 0]);
  visible = false; await render(); const firstClose = animations.at(-1);
  assert.equal(modal.visible, true); assert.equal(firstClose.options.toValue, 0); assert.equal(closed, 0);
  visible = true; await render(); assert.equal(firstClose.stopped, true);
  await act(async () => firstClose.callback({finished: true})); assert.equal(modal.visible, true); assert.equal(closed, 0);
  visible = false; await render(); const close = animations.at(-1);
  await act(async () => {opening.callback({finished: true}); firstClose.callback({finished: true});});
  assert.equal(modal.visible, true, 'Obsolete opening/close completions cannot finish a later close');
  assert.equal(closed, 0);
  await act(async () => close.callback({finished: false})); assert.equal(modal.visible, true);
  await act(async () => {close.value.setValue(0); close.callback({finished: true});});
  assert.equal(modal.visible, false);
  assert.equal(closed, platform === 'ios' ? 0 : 1);
  const oldDismiss = modal.onDismiss;
  await act(async () => {modal.onDismiss(); modal.onDismiss();}); assert.equal(closed, 1);
  visible = true; await render(); await act(async () => {reduced(true); modal.onShow(); host.props.get('source-sheet-content').onLayout({nativeEvent: {layout: {height: 320}}});});
  assert.equal(animations.at(-1).options.duration, 0);
  assert.deepEqual(Array.from(host.props.get('source-sheet-content').style.transform[0].translateY.outputRange), [0, 0]);
  visible = false; await render();
  await act(async () => animations.at(-1).callback({finished: true}));
  await act(async () => oldDismiss());
  assert.equal(closed, platform === 'ios' ? 1 : 2, 'A retired native dismissal cannot complete a replacement presentation');
  await act(async () => modal.onDismiss()); assert.equal(closed, 2);
  visible = true; await render();
  await act(async () => {modal.onShow(); host.props.get('source-sheet-content').onLayout({nativeEvent: {layout: {height: 320}}});});
  visible = false; await render(); const abandoned = animations.at(-1), retired = modal;
  await host.render(null);
  await act(async () => {abandoned.callback({finished: true}); retired.onDismiss();});
  assert.equal(closed, 2, 'Unmounted sheet cannot hand off a native action');
}));

for (const platform of ['ios', 'android']) test(`sheet ${platform} measures before installed native animation and keeps keyboard/back rules through rotation`, nativeBoundary, async () => withNativeHost(async host => {
  const installed = installedAnimatedHost(host);
  let modal, keyboard, preference, visible = true, dismissible = true, closed = 0, requests = 0;
  const native = {...host.native, Animated: installed.Animated, Easing: installed.Easing, Platform: {OS: platform},
    AccessibilityInfo: {isReduceMotionEnabled: async () => false, addEventListener: (_name, callback) => {preference = callback; return {remove() {}};}},
    Modal: props => {modal = props; return props.visible ? React.createElement(host.native.View, props) : null;},
    KeyboardAvoidingView: props => {keyboard = props; return React.createElement(host.native.View, props);},
  };
  const {SourceSheetModal} = await loadComponent('../../src/components/SourceSheetModal.tsx', {react: React, 'react-native': native, '../theme': {mobileColors}});
  const render = () => host.render(React.createElement(SourceSheetModal, {visible, dismissible, onDismiss() {requests++;}, onDidDismiss() {closed++;}}, 'Body'));
  const measure = height => host.props.get('source-sheet-content').onLayout({nativeEvent: {layout: {height}}});
  await render(); assert.equal(installed.starts.length, 0);
  await act(async () => modal.onShow()); assert.equal(installed.starts.length, 0);
  await act(async () => measure(320)); assert.equal(installed.starts.at(-1).config.duration, 220);
  assert.equal(installed.starts.at(-1).config.useNativeDriver, true); assert.ok(installed.nativePending() > 0);
  assert.equal(keyboard.behavior, platform === 'ios' ? 'padding' : undefined);
  await act(async () => {installed.advance(70); measure(220);});
  assert.equal(host.props.get('source-sheet-content').style.transform[0].translateY.__getValue(), 220);
  visible = false; await render(); assert.equal(keyboard.pointerEvents, 'none');
  await act(async () => installed.advance(40));
  visible = true; await render(); await act(async () => installed.advance(400));
  assert.equal(modal.visible, true); assert.equal(closed, 0);
  dismissible = false; await render(); await act(async () => modal.onRequestClose()); assert.equal(requests, 0);
  dismissible = true; await render(); await act(async () => modal.onRequestClose()); assert.equal(requests, 1);
  await act(async () => preference(true)); assert.equal(installed.starts.at(-1).config.duration, 0);
  visible = false; await render(); await act(async () => installed.advance(20));
  assert.equal(modal.visible, false); assert.equal(closed, platform === 'ios' ? 0 : 1);
  await act(async () => {modal.onDismiss(); modal.onDismiss();}); assert.equal(closed, 1);
  await host.render(null); assert.equal(installed.nativePending(), 0);
}));
