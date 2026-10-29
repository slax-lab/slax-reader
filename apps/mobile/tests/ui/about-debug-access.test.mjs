import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, loadComponent, nativeBoundary, withNativeHost} from '../reader/parity-host.mjs';
import * as theme from '../../src/theme/index.ts';

test('About exposes only the version entry; five taps reach Debug and its diagnostics action', nativeBoundary, async () => withNativeHost(async host => {
  const routes = [], buttons = [];
  const navigation = {setOptions() {}, navigate: route => routes.push(route)};
  const components = {...host.components, ScreenSurface: host.native.View,
    SourceButton: props => {buttons.push(props); return React.createElement(host.native.Pressable, props, props.label);},
    SourceSheet: () => null, Divider: () => null,
  };
  const database = {currentStatus: {connected: true}, registerListener: () => () => {}};
  const context = {t: key => key, config: {version: '1.0.25', buildNumber: 795, apiUrl: 'https://fixture.test'},
    runtime: {getDatabase: () => database}, preferences: {}, repositories: null, cache: null, fixtureOnly: true};
  const boundaries = {react: React, 'react-native': host.native, '../components': components, '../theme': theme, '../runtime': {useMobile: () => context, useMobileSettings: () => ({})}};
  const {AboutScreen} = await loadComponent('../../src/screens/AboutScreen.tsx', boundaries);
  await host.render(React.createElement(AboutScreen, {navigation}));
  assert.equal(host.window.document.body.textContent, 'Slax Readerabout_version 1.0.25 (795)');
  assert.equal(buttons.length, 0, 'About has no diagnostic view or share buttons');
  assert.equal(host.props.has('about-diagnostic-view'), false);
  assert.equal(host.props.has('about-diagnostic-share'), false);
  assert.ok(host.props.has('about-version'));
  const tap = () => act(async () => host.props.get('about-version').onPress());
  for (let index = 0; index < 4; index++) await tap();
  assert.deepEqual(routes, []);
  await tap(); assert.deepEqual(routes, ['Debug']);
  for (let index = 0; index < 4; index++) await tap();
  assert.deepEqual(routes, ['Debug'], 'The five-tap counter resets after navigation');
  await tap(); assert.deepEqual(routes, ['Debug', 'Debug']);

  const {DebugScreen} = await loadComponent('../../src/screens/DebugScreen.tsx', {...boundaries,
    '@react-navigation/native': {useFocusEffect: callback => React.useEffect(callback, [callback])},
    'expo/fetch': {fetch: async () => {assert.fail('Controlled fixture must not make network requests');}},
    'expo-sensors': {Accelerometer: {isAvailableAsync: async () => false}},
    '../native/platform': {systemInfo: () => ({}), resolveDns: async () => {assert.fail('Controlled fixture must not resolve DNS');}},
    '../components/SourceRing': {SourceRing: () => null},
  });
  await host.render(React.createElement(DebugScreen, {navigation}));
  const diagnostics = host.props.get('debug_diagnostic_logs');
  assert.equal(diagnostics.label, 'diagnostic_open');
  await act(async () => diagnostics.onPress());
  assert.deepEqual(routes, ['Debug', 'Debug', 'DiagnosticLog']);
}));
