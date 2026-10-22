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

test('sidebar sync block renders connecting and download progress and hides after sync', async () => mounted(async (root, window) => {
  const listeners = [];
  let database = {currentStatus: {connected: false, connecting: true}, registerListener(listener) {listeners.push(listener); return () => {};}};
  const element = type => props => React.createElement(type, {'data-testid': props.testID}, props.children);
  const {LibrarySyncStatus} = await load('../../src/components/LibrarySyncStatus.tsx', {
    react: React,
    'react-native': {View: element('div')},
    'expo-network': {useNetworkState: () => ({isConnected: true, isInternetReachable: true})},
    '../runtime': {useMobile: () => ({t: key => key, runtime: {getDatabase: () => database}, fixtureOnly: undefined})},
    './sync-state': await import('../../src/components/sync-state.ts'),
    './SourceUI': {SourceText: element('span'), SourceProgress: props => React.createElement('div', {'data-testid': props.testID})},
    '../theme': {mobileColors: {bodyText: '#333', syncBackground: '#eee'}, mobileTypography: {syncStatus: {}}},
    '../theme/testIds': {mobileTestIds: {SyncStatusBar: 'sync_status_bar', SyncStatusText: 'sync_status_text', SyncProgress: 'sync_progress'}},
  });
  const text = () => window.document.body.textContent;
  await act(async () => root.render(React.createElement(LibrarySyncStatus)));
  assert.match(text(), /sync_connecting/);
  assert.ok(window.document.querySelector('[data-testid="sync_progress"]'), 'connecting shows an indeterminate progress bar');

  await act(async () => listeners[0].statusChanged({connected: false, connecting: false, downloading: true, downloadProgress: {downloadedOperations: 25, totalOperations: 100}}));
  assert.match(text(), /sync_downloading/);
  assert.match(text(), /25%/);
  assert.ok(window.document.querySelector('[data-testid="sync_progress"]'));

  await act(async () => listeners[0].statusChanged({connected: true, connecting: false, downloading: false, downloadProgress: null}));
  assert.doesNotMatch(text(), /sync_/);
  assert.equal(window.document.querySelector('[data-testid="sync_status_bar"]'), null);
}));
