import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, loadComponent, withNativeHost, nativeBoundary, flattenStyle} from '../reader/parity-host.mjs';

for (const platform of ['ios', 'android']) test(`${platform} accent button paints press feedback without changing the brand fill or action contract`, nativeBoundary, async () => withNativeHost(async host => {
  let nativeButton, setPressed;
  const Pressable = props => {
    const [pressed, update] = React.useState(false);
    nativeButton = props; setPressed = update;
    return React.createElement(host.native.View, {...props, style: props.style({pressed})}, typeof props.children === 'function' ? props.children({pressed}) : props.children);
  };
  const {SourceButton} = await loadComponent('../../src/components/SourceUI.tsx', {
    react: React, 'react-native': {...host.native, Pressable, Text: host.native.View, Platform: {OS: platform}, StyleSheet: {...host.native.StyleSheet, flatten: flattenStyle}, useWindowDimensions: () => ({fontScale: 1})},
    '../../assets': {mobileAssets: {}},
  });
  let activations = 0;
  const render = options => host.render(React.createElement(SourceButton, {testID: 'confirm', label: 'Confirm', onPress: () => activations++, style: {borderRadius: 8, marginTop: 24}, ...options}));
  const fill = () => flattenStyle(host.props.get('confirm').style);
  const overlay = () => host.window.document.querySelector('[data-testid="confirm-pressed-overlay"]');
  const press = async () => {if (!nativeButton.disabled) await act(async () => setPressed(true));};
  const release = async cancelled => {await act(async () => setPressed(false)); if (!cancelled && !nativeButton.disabled) await act(async () => nativeButton.onPress());};
  await render();
  assert.equal(fill().backgroundColor, '#16B998'); assert.equal(overlay(), null);
  await press();
  assert.ok(overlay(), 'An enabled primary button must visibly shade while native Pressable is pressed');
  const paint = host.props.get('confirm-pressed-overlay');
  assert.equal(flattenStyle(paint.style).backgroundColor, '#00000014');
  assert.equal(flattenStyle(paint.style).borderRadius, 8, 'The press layer follows caller-supplied corners');
  assert.equal(flattenStyle(paint.style).position, 'absolute', 'Feedback does not change button layout');
  assert.equal(paint.pointerEvents, 'none'); assert.equal(paint.accessible, false);
  assert.equal(fill().backgroundColor, '#16B998'); assert.equal(fill().marginTop, 24);
  await release(true); assert.equal(overlay(), null); assert.equal(activations, 0, 'Cancellation never invokes the action');
  await press(); await release(false); assert.equal(overlay(), null); assert.equal(activations, 1);
  await render({disabled: true}); await press(); assert.equal(overlay(), null); assert.equal(nativeButton.disabled, true);
  await render({busy: true}); await press(); assert.equal(overlay(), null); assert.equal(nativeButton.disabled, true);
  assert.equal(host.window.document.body.textContent.includes('Confirm'), false, 'Busy keeps the existing spinner state');
  await render({tone: 'surface'}); await press(); assert.equal(overlay(), null); assert.equal(fill().backgroundColor, '#00000014', 'Non-accent pressed presentation is unchanged');
}));
