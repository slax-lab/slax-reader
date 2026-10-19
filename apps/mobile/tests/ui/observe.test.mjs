import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, loadComponent, nativeBoundary, withNativeHost} from '../reader/parity-host.mjs';
import * as theme from '../../src/theme/index.ts';

const nil = () => null;

test('Observe configuration filters user-bearing route parameters and disables debug dispatch', async () => {
  let config;
  const observe = {
    Observe: {configure: value => {config = value;}},
    ObserveRoot: {wrap: component => component},
    useObserve: () => ({markInteractive() {}}),
  };
  await loadComponent('../../src/observe/index.ts', {
    react: React,
    '@react-navigation/native': {NavigationContainer: () => null},
    'expo-observe': observe,
    'expo-observe/integrations/react-navigation': {ObserveNavigationContainer: () => null},
  });
  assert.equal(config.dispatchInDebug, false);
  assert.deepEqual(Array.from(config.integrations['react-navigation'].filteredParams), [
    'bookmarkId',
    'collectionOwnerId',
    'collectionId',
    'rssEntryId',
    'title',
    'targetUrl',
    'openedFrom',
    'entryPoint',
  ]);
});

test('fixture mode disables Observe dispatching', async () => {
  let config;
  await loadComponent('../../src/observe/index.ts', {
    react: React,
    '@react-navigation/native': {NavigationContainer: () => null},
    'expo-observe': {
      Observe: {configure: value => {config = value;}},
      ObserveRoot: {wrap: component => component},
      useObserve: () => ({markInteractive() {}}),
    },
    'expo-observe/integrations/react-navigation': {ObserveNavigationContainer: () => null},
  }, {process: {env: {EXPO_PUBLIC_SLAX_UI_FIXTURE: '1'}}});
  assert.equal(config.dispatchingEnabled, false);
});

test('route readiness predicates require rendered content or a normal error state', async () => {
  const observe = await loadComponent('../../src/observe/index.ts', {
    react: React,
    '@react-navigation/native': {NavigationContainer: () => null},
    'expo-observe': {Observe: {configure() {}}, ObserveRoot: {wrap: component => component}, useObserve: () => ({markInteractive() {}})},
    'expo-observe/integrations/react-navigation': {ObserveNavigationContainer: () => null},
  });
  assert.equal(observe.libraryIsInteractive(false, null), false);
  assert.equal(observe.libraryIsInteractive(true, null), true);
  assert.equal(observe.libraryIsInteractive(false, new Error('blocked')), true);
  assert.equal(observe.libraryRecoveryVisible(false, 'error'), true);
  assert.equal(observe.libraryRecoveryVisible(false, 'verification-required'), true);
  assert.equal(observe.libraryRecoveryVisible(false, 'checking'), false);
  assert.equal(observe.libraryRecoveryVisible(true, 'error'), false);
  assert.equal(observe.readerIsInteractive(false, null, null, null), false);
  assert.equal(observe.readerIsInteractive(true, null, null, null), true);
  assert.equal(observe.readerIsInteractive(false, new Error('blocked'), null, null), true);
  assert.equal(observe.readerIsInteractive(false, null, 'source_unavailable', null), true);
  assert.equal(observe.readerIsInteractive(false, null, null, 'native_failure'), true);
});

test('Observe configuration failure is contained', async () => {
  const loaded = await loadComponent('../../src/observe/index.ts', {
    react: React,
    '@react-navigation/native': {NavigationContainer: () => null},
    'expo-observe': {
      Observe: {configure() {throw new Error('unavailable');}},
      ObserveRoot: {wrap: component => component},
      useObserve: () => ({markInteractive() {throw new Error('unavailable');}}),
    },
    'expo-observe/integrations/react-navigation': {ObserveNavigationContainer: () => null},
  });
  const Component = () => null;
  assert.equal(loaded.ObserveRoot.wrap(Component), Component);
});

test('marker call failures are contained', nativeBoundary, async () => withNativeHost(async host => {
  const loaded = await loadComponent('../../src/observe/index.ts', {
    react: React,
    '@react-navigation/native': {NavigationContainer: () => null},
    'expo-observe': {
      Observe: {configure() {}},
      ObserveRoot: {wrap: component => component},
      useObserve: () => ({markInteractive() {throw new Error('unavailable');}}),
    },
    'expo-observe/integrations/react-navigation': {ObserveNavigationContainer: () => null},
  });
  function Probe() {
    const markInteractive = loaded.useObserveMarkInteractive();
    React.useEffect(() => {markInteractive();}, [markInteractive]);
    return null;
  }
  await act(async () => host.render(React.createElement(Probe)));
}));

test('useObserveMarkInteractive returns a stable callback across renders', nativeBoundary, async () => withNativeHost(async host => {
  const loaded = await loadComponent('../../src/observe/index.ts', {
    react: React,
    '@react-navigation/native': {NavigationContainer: () => null},
    'expo-observe': {
      Observe: {configure() {}},
      ObserveRoot: {wrap: component => component},
      useObserve: () => ({markInteractive() {}}),
    },
    'expo-observe/integrations/react-navigation': {ObserveNavigationContainer: () => null},
  });
  const callbacks = [];
  function Probe({tick}) {
    const markInteractive = loaded.useObserveMarkInteractive();
    callbacks.push(markInteractive);
    return React.createElement(host.native.View, {testID: `probe-${tick}`});
  }
  await act(async () => host.render(React.createElement(Probe, {tick: 0})));
  await act(async () => host.render(React.createElement(Probe, {tick: 1})));
  assert.equal(callbacks[0], callbacks[1]);
}));

test('ObserveRoot falls back when the wrapped root throws', nativeBoundary, async () => withNativeHost(async host => {
  const loaded = await loadComponent('../../src/observe/index.ts', {
    react: React,
    '@react-navigation/native': {NavigationContainer: () => null},
    'expo-observe': {
      Observe: {configure() {}},
      ObserveRoot: {wrap: () => () => {throw new Error('root failure');}},
      useObserve: () => ({markInteractive() {}}),
    },
    'expo-observe/integrations/react-navigation': {ObserveNavigationContainer: () => null},
  });
  const Original = () => React.createElement(host.native.View, {testID: 'observe-root-fallback'});
  const Wrapped = loaded.ObserveRoot.wrap(Original);
  await act(async () => host.render(React.createElement(Wrapped)));
  assert.ok(host.props.has('observe-root-fallback'));
}));

test('ObserveNavigationContainer falls back when the SDK container throws', nativeBoundary, async () => withNativeHost(async host => {
  const loaded = await loadComponent('../../src/observe/index.ts', {
    react: React,
    '@react-navigation/native': {NavigationContainer: props => React.createElement(host.native.View, {...props, testID: 'observe-navigation-fallback'})},
    'expo-observe': {
      Observe: {configure() {}},
      ObserveRoot: {wrap: component => component},
      useObserve: () => ({markInteractive() {}}),
    },
    'expo-observe/integrations/react-navigation': {ObserveNavigationContainer: () => {throw new Error('navigation failure');}},
  });
  await act(async () => host.render(React.createElement(loaded.ObserveNavigationContainer, {onReady() {}})));
  assert.ok(host.props.has('observe-navigation-fallback'));
}));

test('ApplicationRoutes uses the Observe navigation container and preserves the existing navigation ref', nativeBoundary, async () => withNativeHost(async host => {
  let observeRef, navigationRef, screens = [];
  const context = {session: {status: 'authenticated', session: {userId: 'fixture'}}, upgrade: {status: 'ready'}, t: key => key};
  const ObservationNavigationContainer = React.forwardRef((props, ref) => {
    observeRef = ref;
    return React.createElement(host.native.View, props);
  });
  const {ApplicationRoutes, navigationRef: exportedRef} = await loadComponent('../../src/App.tsx', {
    react: React,
    'react-native': {...host.native, StatusBar: nil},
    '@react-navigation/native': {NavigationContainer: host.native.View, createNavigationContainerRef: () => ({current: null})},
    '@react-navigation/native-stack': {createNativeStackNavigator: () => ({
      Navigator: host.native.View,
      Group: host.native.View,
      Screen: props => {screens.push(props.name); return null;},
    })},
    'react-native-gesture-handler': {GestureHandlerRootView: host.native.View},
    'react-native-safe-area-context': {SafeAreaProvider: host.native.View, SafeAreaView: host.native.View},
    './runtime': {useMobile: () => context, MobileProvider: ({children}) => children},
    './theme': theme,
    './telemetry': {useTelemetry: () => ({identify() {}, screen() {}})},
    './components/SourceLine': {SourceLine: nil},
    './screens/AppRecoveryScreen': {AppRecoveryScreen: nil},
    './screens/LoginScreen': {LoginScreen: nil, ReauthenticationScreen: nil},
    './screens/LibraryScreen': {LibraryScreen: nil},
    './screens/ReaderScreen': {ReaderScreen: nil},
    './screens/SettingsScreen': {SettingsScreen: nil},
    './screens/AboutScreen': {AboutScreen: nil},
    './screens/FeedbackScreen': {FeedbackScreen: nil},
    './screens/DeleteAccountScreen': {DeleteAccountScreen: nil},
    './screens/SubscriptionScreen': {SubscriptionScreen: nil},
    './screens/DebugScreen': {DebugScreen: nil},
    './observe': {ObserveRoot: {wrap: component => component}, ObserveNavigationContainer: ObservationNavigationContainer},
  });
  navigationRef = exportedRef;
  await act(async () => host.render(React.createElement(ApplicationRoutes)));
  assert.ok(screens.includes('Library'));
  assert.equal(typeof observeRef, 'function');
  const replacement = {getRootState() { return null; }};
  await act(async () => observeRef(replacement));
  assert.equal(navigationRef.current, replacement);
}));
