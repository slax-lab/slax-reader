import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {nativeBoundary, withNativeHost} from '../reader/parity-host.mjs';
import * as theme from '../../src/theme/index.ts';

function moduleAt(path, require) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, require, __DEV__: false});
  return exports;
}

for (const loggedIn of [false, true]) test(`route registration initializes only the active ${loggedIn ? 'Library' : 'Login'} screen`, nativeBoundary, async () => withNativeHost(async host => {
  const loaded = [], routes = new Map(), Screen = () => null;
  const context = {session: loggedIn ? {status: 'authenticated', session: {userId: 'synthetic'}} : {status: 'unauthenticated'}, upgrade: {status: 'checking'}, t: value => value};
  const primitive = host.native.View;
  const boundaries = {
    react: React, 'react-native': {...host.native, Text: primitive, StatusBar: Screen},
    'expo-app-intents': {isAvailable: () => false, useAppIntents() {}},
    '@react-navigation/native': {NavigationContainer: primitive, createNavigationContainerRef: () => React.createRef()},
    '@react-navigation/native-stack': {createNativeStackNavigator: () => ({Navigator: primitive, Group: primitive, Screen: props => {
      routes.set(props.name, props);
      return props.name === (loggedIn ? 'Library' : 'Login') ? React.createElement(props.getComponent()) : null;
    }})},
    'react-native-gesture-handler': {GestureHandlerRootView: primitive},
    'react-native-safe-area-context': {SafeAreaProvider: primitive, SafeAreaView: primitive},
    './runtime': {useMobile: () => context, MobileProvider: Screen}, './theme': theme,
    './telemetry': {useTelemetry: () => ({identify() {}})}, './components/SourceLine': {SourceLine: Screen},
    './screens/AppRecoveryScreen': {AppRecoveryScreen: Screen}, './navigation/reader-route': {readerScreenOptions: () => ({}), useReaderPrewarm() {}},
  };
  const {ApplicationRoutes} = moduleAt('../../src/App.tsx', name => {
    if (name === './observe') return {ObserveRoot: {wrap: component => component}, ObserveNavigationContainer: primitive};
    if (Object.hasOwn(boundaries, name)) return boundaries[name];
    assert.match(name, /^\.\/screens\/\w+Screen$/);
    loaded.push(name);
    return {LoginScreen: Screen, LibraryScreen: Screen, ReaderScreen: Screen};
  });
  assert.deepEqual(loaded, []);
  await host.render(React.createElement(ApplicationRoutes));
  assert.deepEqual(loaded, [`./screens/${loggedIn ? 'Library' : 'Login'}Screen`]);
  if (loggedIn) {
    routes.get('Reader').getComponent();
    assert.deepEqual(loaded, ['./screens/LibraryScreen', './screens/ReaderScreen']);
  }
}));

test('PDF helper import does not initialize resources until a PDF document is composed', () => {
  let reads = 0;
  const {composePdfDocument} = moduleAt('../../src/reader/pdf-document.ts', name => {
    if (name === '../theme/index.ts') return theme;
    if (name === './pdf-types.ts') return {PDF_ORIGIN: 'https://pdf.reader.slax.invalid/', PDF_BRIDGE_CHUNK_BYTES: 131072};
    assert.equal(name, '../../assets/pdf/bundle.json');
    reads++; return {script: '', worker: '', resources: {}};
  });
  assert.equal(reads, 0);
  const html = composePdfDocument({pageId: 'synthetic', descriptor: {filename: 'synthetic.pdf', size: 1, document_id: 'a'.repeat(64)}, currentUserId: 1});
  assert.equal(reads, 1);
  assert.match(html, /__SLAX_PDF_ASSETS__/);
});
