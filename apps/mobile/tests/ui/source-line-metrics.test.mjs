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
const source = ts.transpileModule(await readFile(new URL('../../src/components/SourceLine.tsx', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
}).outputText;

test('actual source line ignores delayed metrics from a previous text or font scale and preserves intrinsic sizing/accessibility', async () => {
  const {Window} = await import(pathToFileURL(domPath).href);
  const window = new Window();
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true});
  const {createRoot} = await import('react-dom/client');
  let props, fontScale = 1;
  const boundaries = {
    react: React,
    'react-native': {Platform: {OS: 'android'}, useWindowDimensions: () => ({fontScale})},
    'expo-modules-core': {requireNativeViewManager: (module, view) => {
      assert.equal(module, 'SlaxPlatform'); assert.equal(view, 'SlaxTextView');
      return values => {props = values; return null;};
    }},
    './SourceUI': {SourceText: () => {throw new Error('Android must use its native text renderer');}},
  };
  const exports = {};
  vm.runInNewContext(source, {exports, require: name => {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}});
  const root = createRoot(window.document.body);
  const render = text => root.render(React.createElement(exports.SourceLine, {text, fontSize: 17, lineHeight: 24, fontWeight: 500, color: '#0F1419', fitContent: true, testID: 'source-header'}));
  const measure = values => props.onTextMetrics({nativeEvent: {height: 20, width: 42, text: 'Inbox', fontSize: 17, fontWeight: 500, fontScale: 1, ...values}});
  const size = () => props.style[0];
  try {
    await act(async () => render('Inbox'));
    await act(async () => measure({}));
    assert.equal(size().width, 42); assert.equal(size().height, 20);
    assert.equal(props.accessibilityLabel, 'Inbox'); assert.equal(props.accessibilityRole, 'text'); assert.equal(props.testID, 'source-header');
    fontScale = 1.5;
    await act(async () => render('Starred'));
    assert.equal(size().width, 1); assert.equal(size().height, 36);
    await act(async () => measure({}));
    assert.equal(size().width, 1, 'A delayed old label measurement cannot size the current label');
    await act(async () => measure({text: 'Starred'}));
    assert.equal(size().height, 36, 'A delayed old font-scale measurement cannot clip enlarged text');
    await act(async () => measure({text: 'Starred', fontScale: 1.5, width: 80, height: 30}));
    assert.equal(size().width, 80); assert.equal(size().height, 30);
    await act(async () => measure({text: 'Starred', fontScale: 1.5, width: NaN, height: -1}));
    assert.equal(size().width, 80); assert.equal(size().height, 30);
    assert.equal(props.accessibilityLabel, 'Starred');
  } finally {
    await act(async () => root.unmount());
    window.happyDOM.abort();
    for (const [name, descriptor] of descriptors) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];}
  }
});
