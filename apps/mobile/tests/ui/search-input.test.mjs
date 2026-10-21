import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React, {act} from 'react';
import {tagSuggestions} from '../../src/search/query.ts';

const require = createRequire(import.meta.url);
const domPath = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});

async function load(file, boundaries) {
  const code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, __DEV__: false, setInterval, clearInterval, require: name => {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}});
  return exports;
}

async function mounted(run) {
  const {Window} = await import(pathToFileURL(domPath).href);
  const window = new Window(), names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true});
  const {createRoot} = await import('react-dom/client');
  const root = createRoot(window.document.body.appendChild(window.document.createElement('div')));
  try {await run(root, window);} finally {
    await act(async () => root.unmount()); window.close();
    for (const name of names) {const old = previous.get(name); if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name];}
  }
}

test('search input clear button resets text and selected tags only when there is something to clear', async () => mounted(async (root, window) => {
  const pressables = [], inputs = [], views = [], keyboardListeners = new Map();
  const View = props => {views.push(props); return React.createElement('div', {}, props.children);};
  const Pressable = props => {pressables.push(props); return React.createElement('div', {role: 'button', 'aria-label': props.accessibilityLabel, onClick: props.onPress}, props.children);};
  const TextInput = React.forwardRef((props, ref) => {inputs.push(props); return React.createElement('input', {value: props.value, readOnly: true, ref, 'aria-label': props.accessibilityLabel});});
  const text = props => React.createElement('span', {role: props.accessibilityRole}, props.children);
  const native = {View, Pressable, TextInput, ScrollView: View, useWindowDimensions: () => ({height: 844, width: 393}), Keyboard: {dismiss() {}, metrics: () => undefined, addListener(name, callback) {keyboardListeners.set(name, callback); return {remove: () => keyboardListeners.delete(name)};}}, ActivityIndicator: () => null, StyleSheet: {create: value => value, hairlineWidth: 1}};
  const theme = {mobileColors: {surface: '#fff', text: '#000', bodyText: '#333', border: '#ddd', searchSelection: '#eef', searchSecondaryText: '#666', searchActionText: '#065'}};
  const picker = await load('../../src/search/SearchTagPicker.tsx', {
    react: React, 'react-native': native, '../theme': theme,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 59, bottom: 34})},
    '../components/SourceSheetModal': {SourceSheetModal: props => props.visible ? React.createElement(View, {}, props.children) : null},
    '../components/SourceUI': {SourceText: text},
    './SearchSymbols': {SearchCheck: () => null},
  });
  const {SearchInput} = await load('../../src/search/SearchInput.tsx', {
    react: React,
    'react-native': native,
    './SearchTagPicker': picker,
    '../components/SearchGlyph': {SearchGlyph: () => null},
    './SearchSymbols': {SearchChevron: () => null, SearchClose: () => null, SearchCheck: () => null},
    '../components/SourceUI': {SourceText: props => React.createElement('span', {role: props.accessibilityRole}, props.children)},
    '../theme': theme,
    './query': {tagSuggestions},
  });
  const calls = [];
  const render = props => React.createElement(SearchInput, {text: '', selected: [], tags: [], onText: value => calls.push(['text', value]), onTags: value => calls.push(['tags', value]), onSubmit: () => {}, busy: false, t: key => key, ...props});
  await act(async () => root.render(render({})));
  assert.equal(pressables.some(props => props.accessibilityLabel === 'search_clear'), false);
  await act(async () => root.render(render({text: 'needle', selected: ['tag-1']})));
  const clear = pressables.find(props => props.accessibilityLabel === 'search_clear');
  assert.ok(clear, 'nonempty searches expose a clear action');
  await act(async () => clear.onPress());
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'text');
  assert.equal(calls[0][1], '');
  assert.equal(calls[1][0], 'tags');
  assert.deepEqual([...calls[1][1]], []);
  let cleared = 0;
  await act(async () => root.render(render({sourceLabel: 'My feed', onClearSource: () => {cleared++;}})));
  const removeSource = pressables.find(props => props.accessibilityLabel === 'search_remove_source My feed');
  assert.ok(removeSource, 'a scoped Collection or RSS source is removable like a tag');
  await act(async () => removeSource.onPress());
  assert.equal(cleared, 1);
  pressables.length = 0;
  const tag = {id: 'tag-1', tag_name: 'Work', display: '1'};
  await act(async () => root.render(render({tags: [tag]})));
  assert.equal(pressables.some(props => props.accessibilityRole === 'checkbox'), false, 'tag choices are collapsed initially');
  const toggle = pressables.find(props => props.testID === 'search-tags-toggle');
  assert.ok(toggle);
  await act(async () => toggle.onPress());
  assert.ok(pressables.some(props => props.accessibilityRole === 'checkbox'), 'the tag sheet opens on request');
  const panel = () => Object.assign({}, ...views.findLast(props => props.testID === 'search-tag-panel').style);
  assert.equal(panel().height, Math.round(844 * 0.72), 'the panel has a concrete viewport height, independent of intrinsic wrappers');
  await act(async () => keyboardListeners.get('keyboardWillChangeFrame')({endCoordinates: {screenY: 500}}));
  assert.equal(panel().height, 500 - 59 - 12, 'the panel fits the visible area above the keyboard');
  assert.equal(panel().paddingBottom, 12);
  await act(async () => keyboardListeners.get('keyboardDidHide')());
  assert.equal(panel().height, Math.round(844 * 0.72));
  assert.equal(panel().paddingBottom, 46);
  const choice = pressables.findLast(props => props.accessibilityRole === 'checkbox' && props.accessibilityLabel === 'Work');
  calls.length = 0;
  await act(async () => choice.onPress());
  assert.deepEqual([...calls.at(-1)[1]], ['tag-1'], 'the sheet applies tag selection through the existing query port');
  const done = pressables.findLast(props => props.accessibilityLabel === 'search_tags_done');
  await act(async () => done.onPress());
  pressables.length = 0;
  await act(async () => root.render(render({tags: [tag], selected: ['tag-1'], sourceLabel: 'My feed', onClearSource: () => {}})));
  assert.equal(pressables.some(props => props.accessibilityRole === 'checkbox'), false, 'a scoped source hides the tag rail');
  assert.equal(pressables.some(props => props.accessibilityLabel === 'search_remove_tag Work'), false, 'a scoped source hides tag chips');
  assert.ok(pressables.some(props => props.accessibilityLabel === 'search_remove_source My feed'));
  assert.equal(window.document.querySelector('input').parentElement.textContent.includes('My feed'), false, 'scope stays outside the keyword field');
  pressables.length = 0;
  await act(async () => root.render(render({text: '机器 #', tags: [tag]})));
  const suggestion = pressables.find(props => props.accessibilityLabel === 'search_choose_tag Work');
  assert.ok(suggestion, 'typing # exposes known tags immediately without opening the sheet');
  calls.length = 0;
  await act(async () => suggestion.onPress());
  assert.equal(calls[0][0], 'text'); assert.equal(calls[0][1], '机器');
  assert.deepEqual([...calls[1][1]], ['tag-1']);
  pressables.length = 0;
  await act(async () => root.render(render({text: '#wo', tags: [tag], sourceLabel: 'My feed'})));
  assert.ok(pressables.some(props => props.accessibilityLabel === 'search_choose_tag Work'), 'explicit # input also offers tags inside a source scope');
  let submitted = 0;
  await act(async () => root.render(render({text: '机器', onSubmit: () => {submitted++;}})));
  await act(async () => inputs.findLast(props => props.testID === 'search-keyword').onSubmitEditing({nativeEvent: {isComposing: true}}));
  assert.equal(submitted, 0, 'IME confirmation does not submit');
  await act(async () => inputs.findLast(props => props.testID === 'search-keyword').onSubmitEditing({nativeEvent: {isComposing: false}}));
  assert.equal(submitted, 1);
  calls.length = 0;
  await act(async () => root.render(render({selected: ['one', 'two']})));
  await act(async () => inputs.findLast(props => props.testID === 'search-keyword').onKeyPress({nativeEvent: {key: 'Backspace'}}));
  assert.deepEqual([...calls.at(-1)[1]], ['one'], 'empty-field backspace removes only the trailing filter');
  await act(async () => root.render(render({text: '#unknown', invalid: true})));
  assert.equal(window.document.querySelector('[role=alert]').textContent, 'search_unknown_tag');
}));
