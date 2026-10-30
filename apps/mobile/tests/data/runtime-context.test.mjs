import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, nativeBoundary, loadComponent, withNativeHost} from '../reader/parity-host.mjs';

async function mountProvider(host) {
  const state = {session: {status: 'unauthenticated'}, owner: null, repositories: null, cache: null, scoped: null, upgrade: {status: 'ready'}, stops: 0, appState: null};
  const listeners = new Set(), preferenceListeners = new Set(), changes = [], cookies = [], reconciles = [], entryChanges = [];
  const preferences = {subscribe: listener => {preferenceListeners.add(listener); return () => preferenceListeners.delete(listener);}, read: async () => ({user_language: 'en'})};
  const sessions = {subscribe: listener => {listeners.add(listener); return () => listeners.delete(listener);}, getSnapshot: () => state.session, captureRequestScope: () => ({assertCurrent() {}}), prepareRequest: async () => {}};
  const runtime = {preferences, sessions, api: {options: {baseUrl: 'https://api.test'}}, getNativeResourceOwner: () => state.owner,
    getAccountPreferences: () => state.scoped, getRepositories: () => state.repositories, getCache: () => state.cache,
    subscribeUpgrade: () => () => {}, getUpgradeSnapshot: () => state.upgrade, start: async () => {}, stop: async () => {state.stops++;}, setForeground: async value => {changes.push(value);},
    presentedCalls: 0, presentedOwner: null, presentationListeners: new Set(),
    markLibraryPresented() {runtime.presentedCalls++; if (state.upgrade.status === 'ready' && state.owner && runtime.presentedOwner !== state.owner) {runtime.presentedOwner = state.owner; runtime.presentationListeners.forEach(listener => listener());}},
    isLibraryPresented: () => runtime.presentedOwner !== null && runtime.presentedOwner === state.owner,
    subscribeLibraryPresented: listener => {runtime.presentationListeners.add(listener); return () => runtime.presentationListeners.delete(listener);}};
  const module = await loadComponent('../../src/runtime.tsx', {
    react: React, 'react-native': {...host.native, Platform: {OS: 'android'}, AppState: {currentState: 'active', addEventListener: (_name, listener) => {state.appState = listener; return {remove() {state.appState = null;}};}}},
    'expo-localization': {getLocales: () => [{languageTag: 'en'}]}, 'expo-file-system': {},
    './data': {createMobileDataRuntime: () => runtime}, './i18n': {normalizeLocale: value => value, createTranslator: locale => key => `${locale}:${key}`},
    './reader/security.ts': {readerProtectedHosts: () => ['fixture.test'], readerImageProxyOrigins: () => ['https://fixture.test']},
    './config': {mobileConfig: {apiUrl: 'https://api.test', betaApiUrl: 'https://beta.test', platform: 'android', version: 'test', buildNumber: '1'}},
    './payments/controller': {PaymentController: class {}}, './payments/expo-store': {createExpoStore: () => ({})},
    './native/platform': {setWebSessionCookie: async (...args) => {cookies.push(args);}}, './controlled-upgrade-visibility': {},
    './system-actions/SaveURLHost': {SaveURLHost: () => null},
    './system-actions/adapters': {
      createSaveURLController: () => ({subscribe: () => () => {}, getSnapshot: () => [], contextChanged: async () => {}, activate() {}, dispose() {}}),
      createSystemSurfacesController: () => ({subscribe: () => () => {}, getSnapshot: () => false, activate() {}, reconcile: async (...args) => {reconciles.push({owner: state.owner, session: state.session.status, args});}, dispose() {}}),
      createSystemEntryRouter: () => ({router: {subscribe: () => () => {}, getSnapshot: () => null, activate() {}, contextChanged: async () => {entryChanges.push(state.owner);}, dispose() {}}, setNavigator() {}}),
    }
  });
  const emitSession = () => act(async () => {listeners.forEach(listener => listener());});
  const writePreferences = values => act(async () => {preferenceListeners.forEach(listener => listener(values));});
  return {module, runtime, state, changes, cookies, reconciles, entryChanges, emitSession, writePreferences};
}

test('production provider keeps services stable across preference writes, pauses only in the background, and leases web preparation to its consumers', nativeBoundary, async () => withNativeHost(async host => {
  const p = await mountProvider(host), {MobileProvider, useMobile, useMobileSettings, useWebSession} = p.module, {state, changes, cookies} = p;
  const services = [], settings = [], language = [], sessions = [];
  const selectLanguage = values => values.user_language;
  function ServicesConsumer() {services.push(useMobile()); return null;}
  function SettingsConsumer() {settings.push(useMobileSettings()); return null;}
  function LanguageConsumer() {language.push(useMobileSettings(selectLanguage)); return null;}
  function WebSessionConsumer() {sessions.push(useWebSession()); return null;}
  function SubscriptionConsumer() {const {acquireWebSession} = useMobile(); React.useEffect(() => acquireWebSession?.(), [acquireWebSession]); return null;}
  const consumers = [ServicesConsumer, SettingsConsumer, LanguageConsumer, WebSessionConsumer].map(type => React.createElement(type, {key: type.name}));
  const render = extra => host.render(React.createElement(MobileProvider, null, ...consumers, ...extra));
  await render([]);
  await host.settle();
  const initial = services.at(-1);
  await render([]);
  assert.equal(services.at(-1), initial);
  assert.equal('settings' in initial, false, 'Preference values are not part of the services context');
  assert.equal('webSession' in initial, false, 'Web-session readiness is not part of the services context');
  assert.equal(sessions.at(-1).ready, false, 'An unleased provider never prepares a web session');
  assert.ok(cookies.every(entry => entry[1] === null), 'Startup without a consumer clears the web cookie instead of installing a credential');
  await act(async () => {state.appState('inactive');});
  assert.deepEqual(changes, [true, true], 'A transient inactive state stays in the foreground');
  await act(async () => {state.appState('background'); state.appState('active');});
  assert.equal(state.stops, 0); assert.deepEqual(changes, [true, true, false, true]);
  const servicesRenders = services.length, languageRenders = language.length, settingsRenders = settings.length;
  await p.writePreferences({user_language: 'en', continue_reading_bookmark: '{"bookmarkId":"b"}'});
  assert.equal(services.length, servicesRenders, 'A preference write does not re-render services consumers');
  assert.equal(language.length, languageRenders, 'A selector consumer ignores writes to other preferences');
  assert.equal(settings.length, settingsRenders + 1); assert.equal(settings.at(-1).continue_reading_bookmark, '{"bookmarkId":"b"}');
  assert.equal(services.at(-1), initial);
  state.owner = 'new-owner'; state.repositories = {}; state.cache = {}; state.scoped = {};
  state.session = {status: 'authenticated', session: {userId: 'new-account', token: 'synthetic', refreshedAt: 1}};
  await p.emitSession(); await host.settle();
  const current = services.at(-1);
  assert.equal(current.session, state.session); assert.equal(current.nativeResourceOwner, state.owner);
  assert.equal(current.repositories, state.repositories); assert.equal(current.cache, state.cache); assert.equal(current.preferences, state.scoped);
  assert.equal(current.t, initial.t); assert.equal(current.config, initial.config);
  assert.equal(sessions.at(-1).ready, false, 'An authenticated owner alone does not prepare the web session');
  assert.ok(cookies.every(entry => entry[1] === null));
  await render([React.createElement(SubscriptionConsumer, {key: 'lease'})]);
  await host.settle();
  assert.equal(sessions.at(-1).ready, true, 'The leasing consumer receives the prepared web session');
  assert.equal(services.at(-1), current, 'Web-session readiness does not change the services identity');
  assert.equal(cookies.at(-1)[1], 'synthetic', 'Preparing the leased session installs its active owner token');
  await render([]);
  await host.settle();
  assert.equal(sessions.at(-1).ready, false, 'Releasing the last lease drops the prepared web session');
  assert.equal(cookies.at(-1)[1], null, 'Releasing the last lease clears the web cookie');
  assert.equal(state.stops, 0);
}));

test('system-surface reconciliation waits for the presented Library while signed-out revocation runs immediately', nativeBoundary, async () => withNativeHost(async host => {
  const p = await mountProvider(host), {MobileProvider} = p.module, {state, reconciles, entryChanges, runtime} = p;
  await host.render(React.createElement(MobileProvider, null));
  await host.settle();
  assert.deepEqual(reconciles.map(entry => entry.session), ['unauthenticated'], 'Signed-out revocation is not deferred');
  assert.deepEqual(entryChanges, [], 'Spotlight routing does not drain before the Library is presented');
  state.owner = 'owner-1'; state.repositories = {}; state.cache = {}; state.scoped = {};
  state.session = {status: 'authenticated', session: {userId: 'account', token: 'synthetic', refreshedAt: 1}};
  await p.emitSession(); await host.settle();
  assert.equal(reconciles.length, 1, 'A signed-in account does not reconcile or publish before the Library is presented');
  assert.deepEqual(entryChanges, []);
  await act(async () => {runtime.markLibraryPresented();}); await host.settle();
  assert.equal(runtime.presentedCalls, 1, 'The runtime still receives the presentation signal');
  assert.deepEqual(reconciles.slice(1).map(entry => entry.owner), ['owner-1']);
  assert.deepEqual(entryChanges, ['owner-1']);
  await act(async () => {runtime.markLibraryPresented();}); await host.settle();
  assert.equal(reconciles.length, 2, 'Repeated presentation of the same owner does not reconcile again');
  state.owner = null; state.repositories = null; state.cache = null; state.scoped = null; state.session = {status: 'unauthenticated'};
  await p.emitSession(); await host.settle();
  assert.equal(reconciles.at(-1).session, 'unauthenticated', 'Signing out revokes without waiting for a presentation');
  const signedOut = reconciles.length;
  state.owner = 'owner-2'; state.repositories = {}; state.cache = {}; state.scoped = {};
  state.session = {status: 'authenticated', session: {userId: 'account', token: 'synthetic', refreshedAt: 2}};
  await p.emitSession(); await host.settle();
  assert.equal(reconciles.length, signedOut, 'A new resource owner waits for its own Library presentation');
  await act(async () => {runtime.markLibraryPresented();}); await host.settle();
  assert.equal(reconciles.at(-1).owner, 'owner-2');
}));
