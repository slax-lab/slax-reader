import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, nativeBoundary, loadComponent, withNativeHost, flattenStyle} from '../reader/parity-host.mjs';

test('adaptive source labels retain their width measurement while selection changes the visible weight', nativeBoundary, async () => withNativeHost(async host => {
  const views = new Map();
  let fontScale = 1;
  const NativeText = props => {
    const identity = React.useRef(Symbol()).current;
    views.set(props.testID, {identity, props});
    return React.createElement(host.native.View, props);
  };
  const {SourceLine} = await loadComponent('../../src/components/SourceLine.tsx', {
    react: React, 'react-native': {...host.native, Platform: {OS: 'android'}, StyleSheet: {...host.native.StyleSheet, flatten: flattenStyle}, useWindowDimensions: () => ({fontScale})},
    expo: {requireNativeView: () => NativeText}, './SourceUI': {SourceText: host.native.View},
  });
  const render = (selected, text = 'Medium source') => host.render(React.createElement(SourceLine, {
    text, fontSize: 10, lineHeight: 14, fontWeight: selected ? 500 : 400, reserveFontWeight: 500,
    fitContent: true, alignment: 'center', ellipsis: 'middle', color: '#333333', testID: 'source-label', style: {maxWidth: 72, marginTop: 4},
  }));
  const metrics = (text, scale, width) => ({nativeEvent: {text, fontScale: scale, fontSize: 10, fontWeight: 500, width, height: 12 * scale}});
  await render(false);
  assert.ok(views.has('source-label-measure'), 'The stable measurement must be independent of the selected label');
  const initial = views.get('source-label-measure');
  assert.equal(initial.props.fontWeight, 500);
  assert.equal(views.get('source-label-text').props.fontWeight, 400);
  assert.equal(flattenStyle(views.get('source-label-text').props.style).width, undefined, 'The painted text fills the reserved width from its first frame');
  await act(async () => initial.props.onTextMetrics(metrics('Medium source', 1, 54)));
  assert.equal(flattenStyle(views.get('source-label-measure').props.style).width, 54);
  assert.equal(flattenStyle(views.get('source-label-measure').props.style).height, 14, 'Native intrinsic font height must not replace the requested label line height');
  assert.equal(flattenStyle(views.get('source-label-text').props.style).height, 14);
  await render(true);
  assert.equal(views.get('source-label-measure').identity, initial.identity);
  assert.equal(flattenStyle(views.get('source-label-measure').props.style).width, 54, 'Selecting does not reset the measured width to its bootstrap size');
  assert.equal(views.get('source-label-text').props.fontWeight, 500);
  await render(false);
  assert.equal(flattenStyle(views.get('source-label-measure').props.style).width, 54);
  fontScale = 1.5;
  await render(false, 'Long replacement source');
  await act(async () => initial.props.onTextMetrics(metrics('Medium source', 1, 54)));
  assert.equal(flattenStyle(views.get('source-label-measure').props.style).width, 1, 'Old text/scale measurements cannot size a replacement name');
  await act(async () => views.get('source-label-measure').props.onTextMetrics(metrics('Long replacement source', 1.5, 120)));
  assert.equal(flattenStyle(host.props.get('source-label').style).maxWidth, 72);
  assert.equal(flattenStyle(views.get('source-label-measure').props.style).height, 21);
  assert.equal(flattenStyle(views.get('source-label-text').props.style).height, 21);
}));
