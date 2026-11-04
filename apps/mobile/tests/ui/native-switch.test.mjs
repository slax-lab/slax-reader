import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, loadComponent, withNativeHost, nativeBoundary} from '../reader/parity-host.mjs';

for (const platform of ['ios', 'android']) test(`${platform} native switch preserves the controlled setting contract`, nativeBoundary, async () => withNativeHost(async host => {
  let control;
  const native = {...host.native, Platform: {OS: platform}, Switch: props => {control = props; return null;}};
  const {SourceSwitch} = await loadComponent('../../src/components/SourceUI.tsx', {
    react: React, 'react-native': native, '../../assets': {mobileAssets: {}},
  });
  const changes = []; let value = false, disabled = false;
  const render = () => host.render(React.createElement(SourceSwitch, {label: 'PDF', value, disabled, onChange: next => changes.push(next)}));
  await render();
  assert.equal(control.accessibilityLabel, 'PDF');
  assert.equal(control.value, false);
  await act(async () => control.onValueChange(true));
  assert.deepEqual(changes, [true], 'The native value reaches the existing controller once, without another toggle');
  assert.equal(control.value, false, 'The control waits for its authoritative setting value');
  disabled = true; await render();
  assert.equal(control.disabled, true, 'A pending server-backed setting stays disabled');
  assert.equal(control.value, false, 'A rejected or pending write cannot invent enabled state');
  value = true; disabled = false; await render();
  assert.equal(control.value, true); assert.equal(control.disabled, false);
  await act(async () => control.onValueChange(false));
  assert.deepEqual(changes, [true, false]);
}));
