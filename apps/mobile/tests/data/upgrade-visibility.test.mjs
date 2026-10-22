import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const retained = JSON.parse(readFileSync(new URL('./adoption-fixtures/reports/ios-source-valid-original-queue-real-service.json', import.meta.url), 'utf8'));
const source = retained.originalNativeProducer;
const device = retained.device;
const directory = retained.sameIdentityReplacement.currentContainer + '/Library/Application Support';
const request = {kind: 'slax-controlled-visible-upgrade-request', version: 1, phase: 'pre-reconnect', platform: 'ios', device, runId: 'controlled-new-offline-test', nonce: 'b11e9552-5964-4f28-80c9-e0e0362d0ff9', requestedAt: 100, visibleInputsSHA256: retained.inputsSHA256};
const snapshot = retained.openingHold.baseline;
const offline = {
  version: 1, status: 'passed', ...request,
  kind: 'slax-controlled-pre-reconnect-visible-startup', capturedAt: 101,
  explicitAdoptionEvidenceProvided: false, networkRequestsForwarded: 0,
  actualNativeResourceOwner: 'controlled-native-owner', before: structuredClone(snapshot), afterSchema: structuredClone(snapshot),
  pending: source.transactions, nativeDatabaseIdentity: {owner: 'controlled-group-owner', relativePath: 'Library/Application Support/databases/powersync.db'},
  originalCacheRetained: true, originalLocalJsonRetained: true, originalPreferencesUntouched: true,
  originalBookmarkTagCommentAvailableInNormalRepositories: true,
  afterAccountStart: structuredClone(snapshot), normalCreateMobileDataRuntimeExecuted: true, actualSdkVersion: '2.3.1', actualCoreVersion: '0.5.3/2ba6b280',
};

function provider(platform = 'ios', cacheRoot = platform === 'ios' ? directory : '/data/user/0/com.slax.reader') {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../../src/runtime.tsx', import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText;
  let markers = {};
  class File {
    constructor(location) {this.name = location.split('/').at(-1);}
    get exists() {return Object.hasOwn(markers, this.name);}
    textSync() {return JSON.stringify(markers[this.name]);}
  }
  vm.runInNewContext(code, {exports, __DEV__: true, Error, require: name => {
    if (name === 'react') return React;
    if (name === 'react-native') return {Platform: {OS: platform}};
    if (name === 'expo-file-system') return {File};
    if (name === './components/AvatarResources') return {AvatarResourcesContext: React.createContext(null), useAvatarResource: (_slot, url) => url};
    if (name === './controlled-upgrade-visibility') return require('../../src/controlled-upgrade-visibility.ts');
    if (name === './settings/system-surface-preferences') return require('../../src/settings/system-surface-preferences.ts');
    assert(['expo-localization', './components/AvatarResources', './data', './i18n', './config', './payments/controller', './payments/expo-store', './native/platform', './system-actions/SaveURLHost', './system-actions/adapters'].includes(name), name);
    return {};
  }});
  const session = {status: 'authenticated', session: {userId: 'synthetic-user', token: 'fixture-auth-token-NOT-A-REAL-CREDENTIAL'}};
  const cache = {dataDirectory: cacheRoot}, repositories = {}, preferences = {}, upgrade = {status: 'ready'};
  const sessions = {getSnapshot: () => session};
  const runtime = {api: {options: {baseUrl: 'http://127.0.0.1:9'}}, sessions,
    getCache: () => cache, getRepositories: () => repositories, getAccountPreferences: () => preferences,
    getUpgradeSnapshot: () => upgrade, getNativeResourceOwner: () => offline.actualNativeResourceOwner};
  const value = {runtime, api: runtime.api, sessions, session, cache, repositories, preferences, upgrade,
    nativeResourceOwner: runtime.getNativeResourceOwner(), config: {apiUrl: 'http://127.0.0.1:9'}};
  const element = (nextMarkers, patch = {}, selectedDevice = device, children = React.createElement('span', null, 'actual routes')) => {
    markers = nextMarkers;
    return React.createElement(exports.ControlledUpgradeFixtureProvider, {value: {...value, ...patch}, device: selectedDevice}, children);
  };
  return {element, value, useMobile: exports.useMobile, render: (...args) => renderToStaticMarkup(element(...args))};
}

test('actual controlled provider renders genuine pending original edits before any service report exists', () => {
  const mounted = provider();
  assert.equal(mounted.render({'legacy-fixture-report.json': source, 'native-upgrade-ui-request.json': request, 'native-upgrade-offline-report.json': offline}), '<span>actual routes</span>');
});

const preMarkers = () => ({'legacy-fixture-report.json': structuredClone(source), 'native-upgrade-ui-request.json': {...request}, 'native-upgrade-offline-report.json': structuredClone(offline)});

test('pre-reconnect closes operation order, transaction IDs, values, native snapshots and account ownership', async t => {
  for (const [name, change] of [
    ['reordered old operations', d => d['native-upgrade-offline-report.json'].pending[0].crud.reverse()],
    ['missing old mark', d => d['native-upgrade-offline-report.json'].pending[1].crud.pop()],
    ['duplicate old operation', d => d['native-upgrade-offline-report.json'].pending[1].crud.push(d['native-upgrade-offline-report.json'].pending[1].crud[0])],
    ['new transaction identifier', d => d['native-upgrade-offline-report.json'].pending[1].transactionId = 3],
    ['changed old value', d => d['native-upgrade-offline-report.json'].pending[1].crud[1].opData.comment = 'another mark'],
    ['changed business checksum', d => d['native-upgrade-offline-report.json'].afterSchema.dataDigest = 'a'.repeat(64)],
    ['changed account-start queue', d => d['native-upgrade-offline-report.json'].afterAccountStart.queueDigest = 'b'.repeat(64)],
    ['other nonce', d => d['native-upgrade-offline-report.json'].nonce = 'a11e9552-5964-4f28-80c9-e0e0362d0ff9'],
    ['other run', d => d['native-upgrade-offline-report.json'].runId = 'another-run'],
    ['other native account owner', d => d['native-upgrade-offline-report.json'].actualNativeResourceOwner = 'another-owner'],
    ['no normal coordinator', d => d['native-upgrade-offline-report.json'].explicitAdoptionEvidenceProvided = true],
    ['another SDK', d => d['native-upgrade-offline-report.json'].actualSdkVersion = 'different'],
    ['network forwarded', d => d['native-upgrade-offline-report.json'].networkRequestsForwarded = 1],
    ['completed service cannot be replayed', d => d['native-service-report.json'] = retained.actualNativeService],
    ['unknown original source', d => d['legacy-fixture-report.json'].fixtureScenario = 'other'],
  ]) await t.test(name, () => {const markers = preMarkers(); change(markers); assert.throws(() => provider().render(markers));});
});

test('post-service remains a separate default phase with the actual original-six prerequisites', () => {
  const startup = {kind: 'slax-controlled-normal-runtime-start-report', status: 'passed', platform: 'ios', device,
    explicitAdoptionEvidenceProvided: false, networkRequestsForwarded: 0, originalBookmarkTagCommentAvailableInNormalRepositories: true, originalCacheReadByNormalAccountCache: true};
  const markers = {'legacy-fixture-report.json': source, 'native-upgrade-ui-request.json': {...request, phase: undefined}, 'native-service-report.json': retained.actualNativeService, 'native-runtime-start-report.json': startup};
  assert.equal(provider().render(markers), '<span>actual routes</span>');
  for (const change of [d => d['native-service-report.json'].pendingOperations = 4, d => d['native-service-report.json'].realNativeSdkCompletions.reverse(),
    d => d['native-runtime-start-report.json'].device = 'different', d => delete d['native-service-report.json']]) {
    const changed = structuredClone(markers); change(changed); assert.throws(() => provider().render(changed));
  }
  assert.throws(() => provider().render(preMarkers(), {fixtureOnly: {dataDirectory: directory}}));
  assert.throws(() => provider().render({...preMarkers(), 'native-upgrade-ui-request.json': {...request, phase: 'unknown'}}));
});

test('actual Android provider rejects files as cache root, another app root and root suffix lookalikes', () => {
  const markers = preMarkers(); markers['legacy-fixture-report.json'].androidBundleId = 'com.slax.reader';
  markers['native-upgrade-ui-request.json'] = {...request, platform: 'android', device: 'emulator-5564'};
  markers['native-upgrade-offline-report.json'] = {...offline, platform: 'android', device: 'emulator-5564'};
  for (const root of ['/data/user/0/com.slax.reader/files', '/data/user/0/com.slax.reader.other', '/unowned/data/user/0/com.slax.reader']) assert.throws(() => provider('android', root).render(markers, {}, 'emulator-5564'));
});

test('client-mounted controlled provider passes the exact normal runtime references to product children', async () => {
  const domPath = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});
  const {Window} = await import(pathToFileURL(domPath).href), window = new Window();
  const names = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'], previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true});
  const {createRoot} = await import('react-dom/client');
  const host = window.document.createElement('div'); window.document.body.append(host); const root = createRoot(host), mounted = provider();
  let value, mounts = 0, unmounts = 0;
  function Child() {value = mounted.useMobile(); React.useEffect(() => {mounts++; return () => {unmounts++;};}, []); return React.createElement('span', null, 'original offline routes');}
  try {
    await React.act(async () => root.render(mounted.element(preMarkers(), {}, device, React.createElement(Child))));
    assert.equal(host.textContent, 'original offline routes'); assert.equal(mounts, 1);
    assert.equal(value.runtime, mounted.value.runtime); assert.equal(value.repositories, mounted.value.runtime.getRepositories());
    assert.equal(value.cache, mounted.value.runtime.getCache()); assert.equal(value.fixtureOnly, undefined);
    await React.act(async () => root.unmount()); assert.equal(unmounts, 1);
  } finally {
    if (unmounts === 0) await React.act(async () => root.unmount());
    window.happyDOM.cancelAsync();
    for (const name of names) {const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];}
  }
});

test('actual Android provider uses the native cache root and separate files marker directory', () => {
  const androidSource = {...source, androidBundleId: 'com.slax.reader'};
  const androidRequest = {...request, platform: 'android', device: 'emulator-5564'};
  const androidOffline = {...offline, platform: 'android', device: androidRequest.device};
  assert.equal(provider('android').render({'legacy-fixture-report.json': androidSource, 'native-upgrade-ui-request.json': androidRequest, 'native-upgrade-offline-report.json': androidOffline}, {}, androidRequest.device), '<span>actual routes</span>');
});
