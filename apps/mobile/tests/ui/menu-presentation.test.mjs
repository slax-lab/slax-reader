import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, loadComponent, withNativeHost, nativeBoundary} from '../reader/parity-host.mjs';
import {mobileColors, mobileLayout, mobileTypography} from '../../src/theme/index.ts';

for (const reduced of [false, true]) test(`menu waits for native presentation and ignores interrupted exits (reduced=${reduced})`, nativeBoundary, async () => withNativeHost(async host => {
  let modal; const motions = [];
  const native = {...host.native, Modal: props => {modal = props; return props.visible ? React.createElement(host.native.View, props) : null;},
    Animated: {...host.native.Animated, timing: (_value, config) => {const motion = {config, stopped: false, start(callback) {this.complete = callback;}, stop() {this.stopped = true;}}; motions.push(motion); return motion;}}};
  const {SourceMenu} = await loadComponent('../../src/components/SourceMenu.tsx', {
    react: React, 'react-native': native,
    '../theme': {mobileColors, mobileLayout, mobileTypography},
    './SourceUI': {SourceText: host.native.View, SourceIcon: () => null},
    '../motion/useReducedMotion': {useReducedMotion: () => reduced},
  });
  let visible = false;
  const render = () => host.render(React.createElement(SourceMenu, {visible, onDismiss() {}, items: [{label: 'Inbox', onPress() {}}], anchor: {x: 90, y: 100}}));
  await render(); visible = true; await render();
  assert.equal(motions.length, 0, 'An entrance cannot finish before Modal presents');
  await act(async () => modal.onShow());
  assert.equal(motions.at(-1).config.toValue, 1);
  assert.equal(motions.at(-1).config.duration, reduced ? 0 : 200);
  visible = false; await render(); const exit = motions.at(-1);
  assert.equal(exit.config.toValue, 0);
  visible = true; await render();
  assert.equal(exit.stopped, true);
  await act(async () => exit.complete({finished: true}));
  assert.equal(modal.visible, true, 'An obsolete exit cannot unmount a reopened picker');
  await host.render(null);
  assert.equal(motions.at(-1).stopped, true);
}));
