import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {React, act, nativeBoundary, loadComponent, withNativeHost, flattenStyle} from '../reader/parity-host.mjs';
import {mobileColors, mobileTypography} from '../../src/theme/index.ts';
import * as coordinates from '../../src/reader/coordinates.ts';
import * as model from '../../src/reader/model.ts';
import * as motion from '../../src/reader/outline-motion.ts';

test('startup renders only the default surface until the current account is ready, without a spinner', nativeBoundary, async () => withNativeHost(async host => {
  const nil = () => null, screens = [];
  let context = {upgrade: {status: 'checking'}, session: {status: 'loading'}, t: key => key};
  const boundaries = {react: React, 'react-native': {...host.native, Text: host.native.View, StatusBar: nil},
    '@react-navigation/native': {NavigationContainer: host.native.View, createNavigationContainerRef: () => ({})},
    '@react-navigation/native-stack': {createNativeStackNavigator: () => ({Navigator: host.native.View, Group: host.native.View, Screen: props => {screens.push(props.name); return null;}})},
    'react-native-gesture-handler': {GestureHandlerRootView: host.native.View}, 'react-native-safe-area-context': {SafeAreaProvider: host.native.View, SafeAreaView: host.native.View},
    './runtime': {useMobile: () => context, MobileProvider: nil}, './theme': {mobileColors}, './telemetry': {useTelemetry: () => ({identify() {}})}, './components/SourceLine': {SourceLine: nil},
  };
  for (const name of ['Login','Library','Reader','Settings','About','Feedback','DeleteAccount','Subscription','Debug']) boundaries[`./screens/${name}Screen`] = {[`${name}Screen`]: nil};
  const {ApplicationRoutes} = await loadComponent('../../src/App.tsx', boundaries);
  const render = () => host.render(React.createElement(ApplicationRoutes));
  await render();
  assert.ok(host.props.has('app-startup-surface'));
  assert.equal(host.props.get('app-startup-surface').children, undefined);
  assert.deepEqual(screens, []);
  context = {...context, upgrade: {status: 'checking'}, session: {status: 'unauthenticated'}}; await render();
  assert.deepEqual(screens, ['Login']);
  context = {...context, session: {status: 'authenticated', session: {userId: 'current'}}}; await render();
  assert.equal(host.props.has('app-startup-surface'), false); assert.ok(screens.includes('Library'));
}));

test('more and archive artwork remains present and icon dimensions cannot shrink in its button', nativeBoundary, async () => withNativeHost(async host => {
  const artwork = Object.fromEntries(['ic_floating_panel_more','ic_floating_panel_archieve','ic_floating_panel_archieved'].map(name => [name, {uri: `bundled:${name}`} ]));
  const {SourceIcon} = await loadComponent('../../src/components/SourceUI.tsx', {react: React, 'react-native': host.native,
    'react-native-safe-area-context': {}, '../../assets': {mobileAssets: artwork}, '../theme': {mobileColors, mobileTypography}, './source-font-scaling': {}, './SourceSheetModal': {},
  });
  for (const name of Object.keys(artwork)) {
    const image = SourceIcon({name, size: 24});
    assert.equal(image.props.source, artwork[name]);
    assert.deepEqual(flattenStyle(image.props.style), {width: 24, height: 24, flexShrink: 0});
    const bytes = await readFile(new URL(`../../assets/drawable/${name}.png`, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG'); assert.ok(bytes.length > 100);
  }
  const {FloatingActions} = await loadComponent('../../src/reader/ReaderOverlays.tsx', {react: React, 'react-native': host.native,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 34})}, '../components': host.components,
    '../theme': {mobileColors, mobileTypography}, './coordinates.ts': coordinates, './model.ts': model, './outline-motion.ts': motion, './MarkdownView.tsx': {},
  });
  await host.render(React.createElement(FloatingActions, {visible: true, isCollection: false, starred: false, archived: false, outlineCollapsed: false, t: key => key, onStar() {}, onArchive() {}, onMore() {}, onOutline() {}}));
  const button = host.props.get('reader-floating-archive');
  assert.equal(button.style({pressed: false}).alignItems, 'center');
  assert.equal(host.props.get('reader-floating-archive-icon').name, 'ic_floating_panel_archieve');
}));
