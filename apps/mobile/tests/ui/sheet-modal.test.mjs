import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, loadComponent, withNativeHost, nativeBoundary, flattenStyle} from '../reader/parity-host.mjs';
import {mobileColors} from '../../src/theme/index.ts';

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
  await act(async () => {close.value.setValue(0); close.callback({finished: true});});
  assert.equal(modal.visible, false);
  assert.equal(closed, platform === 'ios' ? 0 : 1);
  await act(async () => {modal.onDismiss(); modal.onDismiss();}); assert.equal(closed, 1);
  visible = true; await render(); await act(async () => {reduced(true); modal.onShow(); host.props.get('source-sheet-content').onLayout({nativeEvent: {layout: {height: 320}}});});
  assert.equal(animations.at(-1).options.duration, 0);
  assert.deepEqual(Array.from(host.props.get('source-sheet-content').style.transform[0].translateY.outputRange), [0, 0]);
}));
