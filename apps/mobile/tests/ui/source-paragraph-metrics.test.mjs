import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React, {act} from 'react';

const require = createRequire(import.meta.url);
const domPath = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});
async function transpile(path) {
  return ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText;
}
const source = await transpile('../../src/components/SourceParagraph.tsx');
const scaling = {};
vm.runInNewContext(await transpile('../../src/components/source-font-scaling.ts'), {exports: scaling});

test('actual paragraph rejects delayed width, text and font metrics while retaining accessible enlarged content', async () => {
  const {Window} = await import(pathToFileURL(domPath).href);
  const window = new Window();
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true});
  const {createRoot} = await import('react-dom/client');
  let props, fontScale = 1, windowWidth = 412, windowHeight = 914;
  const boundaries = {
    react: React,
    'react-native': {Platform: {OS: 'android'}, useWindowDimensions: () => ({fontScale, scale: 2.625, width: windowWidth, height: windowHeight})},
    'expo': {requireNativeView: (module, view) => {
      assert.equal(module, 'SlaxPlatform'); assert.equal(view, 'SlaxTextView');
      return values => {props = values; return null;};
    }},
    './SourceUI': {SourceText: () => {throw new Error('Android must use fractional native paint');}},
    './source-font-scaling': scaling,
  };
  const exports = {};
  vm.runInNewContext(source, {exports, require: name => {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}});
  const root = createRoot(window.document.body);
  const render = override => root.render(React.createElement(exports.SourceParagraph, {text: 'Synthetic original description', fontSize: 14, lineHeight: 20, color: '#333333CC', testID: 'source-description', style: {marginTop: 16}, ...override}));
  const metric = (override = {}) => ({height: 50, layoutWidth: 356, text: props.text, fontSize: props.fontSize, fontWeight: props.fontWeight, fontScale, lineHeightSp: props.lineHeightSp, maxLines: props.maxLines, paragraph: true, measurementKey: props.measurementKey, ...override});
  const height = () => props.style[0].height;
  const layout = width => props.onLayout({nativeEvent: {layout: {width}}});
  const deliver = value => props.onTextMetrics({nativeEvent: value});
  try {
    await act(async () => render());
    assert.equal(props.paragraph, true); assert.equal(props.maxLines, 0);
    assert.equal(props.accessibilityRole, 'text'); assert.equal(props.accessibilityLabel, props.text); assert.equal(props.testID, 'source-description');
    assert.equal(props.style[1].marginTop, 16);
    await act(async () => deliver(metric()));
    assert.equal(height(), 20, 'Metrics before an observed width cannot size the paragraph');
    await act(async () => layout(356));
    const previous = metric();
    await act(async () => deliver(previous));
    assert.equal(height(), 50);
    await act(async () => layout(240));
    assert.equal(height(), 20);
    await act(async () => deliver(previous));
    assert.equal(height(), 20, 'An old wider paragraph cannot clip the newly wrapped content');
    await act(async () => deliver(metric({layoutWidth: 240, height: 80})));
    assert.equal(height(), 80);
    await act(async () => deliver(metric({layoutWidth: 240 + 1 / 2.625, height: 81})));
    assert.equal(height(), 81, 'Yoga float versus rounded Android bounds may differ by one physical pixel');
    await act(async () => deliver(metric({layoutWidth: 241, height: 10})));
    assert.equal(height(), 81, 'A different native layout width cannot resize the current frame');
    fontScale = 1.5;
    await act(async () => render({text: 'Changed translated description'}));
    assert.equal(height(), 20 / 14 * 22);
    await act(async () => deliver(previous));
    assert.equal(height(), 20 / 14 * 22);
    await act(async () => deliver(metric({layoutWidth: 240, height: 92})));
    assert.equal(height(), 92);
    const portrait = metric({layoutWidth: 240, height: 92});
    windowWidth = 914; windowHeight = 412;
    await act(async () => render({text: 'Changed translated description'}));
    await act(async () => deliver(portrait));
    assert.equal(height(), 20 / 14 * 22, 'Rotation invalidates previously accepted height even before onLayout');
    await act(async () => layout(810));
    await act(async () => deliver(metric({layoutWidth: 810, height: 45})));
    assert.equal(height(), 45);
    await act(async () => deliver(metric({layoutWidth: NaN, height: -1})));
    assert.equal(height(), 45);
    const iosExports = {};
    const iosBoundaries = {...boundaries,
      'react-native': {...boundaries['react-native'], Platform: {OS: 'ios'}},
      'expo': {requireNativeView: () => {throw new Error('An existing iOS binary must not request the Android paragraph view');}},
      './SourceUI': {SourceText: values => {props = values; return null;}},
    };
    vm.runInNewContext(source, {exports: iosExports, require: name => iosBoundaries[name]});
    await act(async () => root.render(React.createElement(iosExports.SourceParagraph, {text: 'Original iOS path', fontSize: 14, lineHeight: 20, color: '#333333CC', maxLines: 3, testID: 'ios-description'})));
    assert.equal(props.children, 'Original iOS path'); assert.equal(props.testID, 'ios-description');
    assert.equal(props.numberOfLines, 3); assert.equal(props.style[0].fontSize, 14); assert.equal(props.style[0].lineHeight, 20);
  } finally {
    await act(async () => root.unmount());
    window.happyDOM.abort();
    for (const [name, descriptor] of descriptors) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];}
  }
});
