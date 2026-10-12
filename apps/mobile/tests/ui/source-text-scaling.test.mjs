import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';

async function load(file, boundaries = {}) {
  const source = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {exports, require: name => {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}});
  return exports;
}
const scaling = await load('../../src/components/source-font-scaling.ts');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('source font anchors and relative SP line height reproduce the original enlarged paragraph measurement', () => {
  // These anchors come from the actual pinned ui-unit 1.11.2 factory bytecode.
  close(scaling.sourceSpToDp(14, 1.5), 22);
  close(scaling.sourceSpToDp(17, 1.5), 23.5);
  close(scaling.sourceSpToDp(20, 1.5), 26);
  close(scaling.sourceSpToDp(14, Math.fround(1.15)), 16.4);
  close(scaling.sourceSpToDp(14, 1), 14);
  close(scaling.sourceSpToDp(14, .85), 11.9);
  close(scaling.sourceSpToDp(14, 2.5), 35);
  close(scaling.sourceSpToDp(120, 1.5), 120);
  const paragraph = scaling.sourceTextDimensions({fontSize: 14, lineHeight: 20}, 1.5);
  close(paragraph.fontSize * 2.625, 57.75);
  close(paragraph.lineHeight * 2.625, 82.5);
  assert.equal(Math.ceil(paragraph.lineHeight * 2.625), 83, 'Original measured row spacing is retained; independently scaling 20sp gives 69px');
  close(scaling.sourceTextDimensions({fontSize: 14, lineHeight: 20}, 1).lineHeight, 20);
  assert.throws(() => scaling.sourceSpToDp(14, 0));
  assert.throws(() => scaling.sourceSpToDp(NaN, 1.5));
});

test('actual SourceText responds to system font scale once while retaining styles, caller limits and iOS behavior', async () => {
  const theme = await load('../../src/theme/index.ts');
  let fontScale = 1;
  const flatten = values => Object.assign({}, ...values.flat(Infinity).filter(Boolean));
  const native = {Platform: {OS: 'android'}, Text: 'Text', StyleSheet: {create: value => value, flatten, absoluteFill: {}}, useWindowDimensions: () => ({fontScale})};
  const ui = await load('../../src/components/SourceUI.tsx', {
    react: React, 'react-native': native, 'react-native-safe-area-context': {}, '../../assets': {mobileAssets: {}}, '../theme': theme, './source-font-scaling': scaling,
    './SourceSheetModal': await load('../../src/components/SourceSheetModal.tsx', {react: React, 'react-native': native, '../theme': theme}),
  });
  const props = {children: 'Synthetic accessible paragraph', accessibilityLabel: 'Synthetic paragraph', testID: 'source-paragraph', style: [{fontSize: 14}, {lineHeight: 20, marginTop: 16}]};
  const actual = override => ui.SourceText({...props, ...override}).props;
  let value = actual();
  assert.equal(value.allowFontScaling, false);
  assert.equal(value.textBreakStrategy, 'simple'); assert.equal(value.android_hyphenationFrequency, 'none');
  close(flatten(value.style).fontSize, 14); close(flatten(value.style).lineHeight, 20);
  fontScale = 1.5; value = actual();
  close(flatten(value.style).fontSize, 22); close(flatten(value.style).lineHeight, 20 / 14 * 22);
  assert.equal(flatten(value.style).marginTop, 16);
  assert.equal(value.children, props.children); assert.equal(value.accessibilityLabel, props.accessibilityLabel); assert.equal(value.testID, props.testID);
  const disabled = actual({allowFontScaling: false}); close(flatten(disabled.style).fontSize, 14); close(flatten(disabled.style).lineHeight, 20);
  const limited = actual({maxFontSizeMultiplier: 1.2}); close(flatten(limited.style).fontSize, 16.8); close(flatten(limited.style).lineHeight, 24);
  const exception = actual({textBreakStrategy: 'balanced', android_hyphenationFrequency: 'full'});
  assert.equal(exception.textBreakStrategy, 'balanced'); assert.equal(exception.android_hyphenationFrequency, 'full');
  const natural = actual({style: {fontSize: 12, lineHeight: undefined}});
  close(flatten(natural.style).fontSize, 18);
  assert.equal(flatten(natural.style).lineHeight, undefined, 'An original RSS Text without an explicit line height does not inherit the app body 24sp line box');
  native.Platform.OS = 'ios'; value = actual();
  assert.equal(value.allowFontScaling, undefined); assert.equal(value.textBreakStrategy, undefined); assert.equal(value.android_hyphenationFrequency, undefined);
  close(flatten(value.style).fontSize, 14); close(flatten(value.style).lineHeight, 20);
  assert.equal(actual({allowFontScaling: false}).allowFontScaling, false);
});
