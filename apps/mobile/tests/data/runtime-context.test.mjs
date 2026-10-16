import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, nativeBoundary, loadComponent, withNativeHost} from '../reader/parity-host.mjs';

test('production provider keeps translation/config/context stable, backgrounds without account or route teardown, and leases web preparation to its consumers', nativeBoundary, async () => withNativeHost(async host => {
  let session = {status: 'unauthenticated'}, owner = null, repositories = null, cache = null, scoped = null;
  const upgrade = {status: 'ready'}, listeners = new Set(), preferenceListeners = new Set(), changes = [], values = [], cookies = [];
  let appState, stops = 0;
  const preferences = {subscribe: listener => {preferenceListeners.add(listener); return () => preferenceListeners.delete(listener);}, read: async () => ({user_language: 'en'})};
  const sessions = {subscribe: listener => {listeners.add(listener); return () => listeners.delete(listener);}, getSnapshot: () => session, captureRequestScope: () => ({assertCurrent() {}}), prepareRequest: async () => {}};
  const runtime = {preferences, sessions, api: {options: {baseUrl: 'https://api.test'}}, getNativeResourceOwner: () => owner,
    getAccountPreferences: () => scoped, getRepositories: () => repositories, getCache: () => cache,
    subscribeUpgrade: () => () => {}, getUpgradeSnapshot: () => upgrade, start: async () => {}, stop: async () => {stops++;}, setForeground: async value => {changes.push(value);}};
  const {MobileProvider, useMobile} = await loadComponent('../../src/runtime.tsx', {
    react: React, 'react-native': {...host.native, Platform: {OS: 'android'}, AppState: {currentState: 'active', addEventListener: (_name, listener) => {appState = listener; return {remove() {appState = null;}};}}},
    'expo-localization': {getLocales: () => [{languageTag: 'en'}]}, 'expo-file-system': {},
    './data': {createMobileDataRuntime: () => runtime}, './i18n': {normalizeLocale: value => value, createTranslator: locale => key => `${locale}:${key}`},
    './config': {mobileConfig: {apiUrl: 'https://api.test', betaApiUrl: 'https://beta.test', platform: 'android', version: 'test', buildNumber: '1'}},
    './payments/controller': {PaymentController: class {}}, './payments/expo-store': {createExpoStore: () => ({})},
    './native/platform': {setWebSessionCookie: async (...args) => {cookies.push(args);}}, './controlled-upgrade-visibility': {},
  });
  function Consumer() {values.push(useMobile()); return null;}
  function SubscriptionConsumer() {const {acquireWebSession} = useMobile(); React.useEffect(() => acquireWebSession?.(), [acquireWebSession]); return null;}
  const render = consumers => host.render(React.createElement(MobileProvider, null, React.createElement(Consumer), ...consumers));
  await render([]);
  await host.settle();
  const initial = values.at(-1);
  await render([]);
  assert.equal(values.at(-1), initial);
  assert.equal(initial.webSession.ready, false, 'An unleased provider never prepares a web session');
  assert.ok(cookies.every(entry => entry[1] === null), 'Startup without a consumer clears the web cookie instead of installing a credential');
  await act(async () => {appState('inactive'); appState('background'); appState('active');});
  assert.equal(stops, 0); assert.deepEqual(changes, [true, false, false, true]);
  await act(async () => {preferenceListeners.forEach(listener => listener({user_language: 'en', read_position: '10'}));});
  assert.equal(values.at(-1).t, initial.t); assert.equal(values.at(-1).config, initial.config);
  owner = 'new-owner'; repositories = {}; cache = {}; scoped = {};
  session = {status: 'authenticated', session: {userId: 'new-account', token: 'synthetic', refreshedAt: 1}};
  await act(async () => {listeners.forEach(listener => listener());}); await host.settle();
  const current = values.at(-1);
  assert.equal(current.session, session); assert.equal(current.nativeResourceOwner, owner);
  assert.equal(current.repositories, repositories); assert.equal(current.cache, cache); assert.equal(current.preferences, scoped);
  assert.equal(current.webSession.ready, false, 'An authenticated owner alone does not prepare the web session');
  assert.ok(cookies.every(entry => entry[1] === null));
  await render([React.createElement(SubscriptionConsumer)]);
  await host.settle();
  assert.equal(values.at(-1).webSession.ready, true, 'The leasing consumer receives the prepared web session');
  assert.equal(cookies.at(-1)[1], 'synthetic', 'Preparing the leased session installs its active owner token');
  await render([]);
  await host.settle();
  assert.equal(values.at(-1).webSession.ready, false, 'Releasing the last lease drops the prepared web session');
  assert.equal(cookies.at(-1)[1], null, 'Releasing the last lease clears the web cookie');
  assert.equal(stops, 0);
}));
