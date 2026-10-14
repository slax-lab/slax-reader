import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React, {act} from 'react';
import {FixtureActionRouter} from '../../src/components/fixture-actions.ts';
import {BackgroundArticleCache} from '../../src/data/background-cache.ts';
import {PdfBlockCache, PDF_BLOCK_SIZE} from '../../src/data/pdf-cache.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {FixtureMemoryPreferences} from '../../fixtures/isolation.ts';
import {createHash} from 'node:crypto';

const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));
async function load(file, boundaries = {}, globals = {}) {
  const output = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText;
  const exports = {};
  vm.runInNewContext(output, {exports, __DEV__: true, setTimeout, clearTimeout, setInterval, clearInterval, ...globals, require(name) {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}});
  return exports;
}
const runtimeImports = ['expo-file-system', 'react-native', '@powersync/react-native', '../src/data/preferences', '../src/domain/session', '../src/data/repositories', '../src/data/cache', '../src/data/api', '../src/data/schema', '../src/payments/controller', '../src/telemetry/core', '../src/config', '../src/i18n', './transport', './isolation', './documents', './resources', './pdf', '../src/data/background-cache', '../src/data/pdf-cache', './pdf-storage', '../src/data/account-lease', '../src/components/fixture-actions', '../src/native/platform', './pdf-import', './pdf-production-storage', 'expo/fetch', './pdf-http'];
const {FixtureControlLifecycle} = await load('../../fixtures/runtime.ts', Object.fromEntries(runtimeImports.map(name => [name, {}])));

function lifecycle() {
  const listeners = new Set(), events = [], drains = [];
  const appState = {currentState: 'active', addEventListener(_event, listener) {listeners.add(listener); return {remove() {listeners.delete(listener);}};}};
  let current;
  const queue = {
    paused: false, calls: 0,
    async pause() {events.push('pause'); this.paused = true; current?.reject(Object.assign(new Error('PDF request cancelled'), {name: 'AbortError'})); await drains.shift()?.promise;},
    resume() {events.push('resume'); this.paused = false;},
    async cachePdf() {assert.equal(this.paused, false); this.calls++; current = deferred(); return current.promise;},
  };
  const controls = new FixtureControlLifecycle(async active => active ? queue.resume() : queue.pause());
  appState.addEventListener('change', state => {void controls.setForeground(state === 'active').catch(() => undefined);});
  const state = value => {appState.currentState = value; for (const listener of listeners) listener(value);};
  return {controls, events, drains, queue, state, finish: () => current.resolve(), reject: error => current.reject(error)};
}

test('inactive Android control waits for the actual pause drain and foreground resume before work', async () => {
  const f = lifecycle(), drain = deferred(); f.drains.push(drain);
  f.state('inactive'); await tick();
  let executed = false;
  const action = f.controls.run(async () => {executed = true; return 'inspected';}, true);
  f.state('active'); await tick(); assert.equal(executed, false); assert.deepEqual(f.events, ['pause']);
  drain.resolve(); assert.equal(await action, 'inspected'); assert.deepEqual(f.events, ['pause', 'resume']);
  f.controls.dispose();
});

test('an interrupted PDF fill retries after foreground and cannot report success until the real retry resolves', async () => {
  const f = lifecycle(); let completed = false;
  const action = f.controls.run(() => f.queue.cachePdf(), true).then(() => {completed = true;});
  await tick(); assert.equal(f.queue.calls, 1);
  f.state('background'); await tick(); assert.equal(completed, false); assert.equal(f.queue.calls, 1);
  f.state('active'); await tick(); assert.equal(f.queue.calls, 2); assert.equal(completed, false);
  f.finish(); await action; assert.equal(completed, true); assert.deepEqual(f.events, ['pause', 'resume']);
  f.controls.dispose();
});

test('an abort without lifecycle interruption and a real failure are not silently retried', async () => {
  for (const error of [Object.assign(new Error('abort without background'), {name: 'AbortError'}), new Error('real storage failure')]) {
    const f = lifecycle(), action = f.controls.run(() => f.queue.cachePdf(), true);
    await tick(); f.reject(error); await assert.rejects(action, reason => reason === error); assert.equal(f.queue.calls, 1); f.controls.dispose();
  }
});

test('scope disposal releases foreground waiters and non-idempotent actions are not replayed', async () => {
  const f = lifecycle(); f.state('inactive');
  let calls = 0; const waiting = f.controls.run(async () => {calls++;});
  await tick(); f.controls.dispose(); await assert.rejects(waiting, /disposed/); assert.equal(calls, 0);
  const next = lifecycle(), action = next.controls.run(() => next.queue.cachePdf());
  await tick(); next.state('inactive'); await assert.rejects(action, error => error.name === 'AbortError'); next.state('active'); await tick(); assert.equal(next.queue.calls, 1); next.controls.dispose();
});

test('control lifecycle executes the production PDF queue through abort, retained blocks, resume and verified completion', async () => {
  const bytes = new Uint8Array(PDF_BLOCK_SIZE + 13).fill(7), files = new Map(), locals = new Map(), requests = [], second = deferred();
  const descriptor = {size: bytes.length, document_id: createHash('sha256').update(bytes).digest('hex'), url: '/v1/bookmark/pdf', filename: 'fixture.pdf', source: 'upload', text_status: 'ready'};
  const database = {async getOptional(_sql, args) {const data = locals.get(args[0]); return data ? {data} : null;}, async execute(_sql, args) {locals.set(args[0], args[1]);}, async writeTransaction(work) {return work(database);}, watch() {}};
  const storage = {async read(path) {return files.get(path)?.slice() ?? null;}, async writeAtomic(path, value) {files.set(path, value.slice());}, async remove(path) {files.delete(path);}, async list(prefix) {return [...files.keys()].filter(path => path.startsWith(prefix));}};
  const cache = new PdfBlockCache(storage, 'fixture-account', () => {});
  let attempt = 0;
  const worker = new BackgroundArticleCache({database, preferences: new PreferenceStore(new FixtureMemoryPreferences({cache_count: 0})), cache: {}, assertActive() {}, content: async () => {throw new Error('Unexpected HTML');}, image: async () => {throw new Error('Unexpected image');}, pdf: {cache, metadata: async () => descriptor, async range(_id, _identity, begin, end, signal) {
    requests.push({begin, signal});
    if (begin === 0) return bytes.slice(begin, end);
    if (++attempt === 1) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('PDF request cancelled'), {name: 'AbortError'})), {once: true}));
    await second.promise; return bytes.slice(begin, end);
  }}});
  const controls = new FixtureControlLifecycle(async active => active ? worker.resume() : worker.pause());
  let completed = false;
  const action = controls.run(() => worker.cachePdf('fixture-pdf'), true).then(() => {completed = true;});
  const until = async predicate => {for (let i = 0; i < 100 && !predicate(); i++) await tick(); assert.ok(predicate());};
  try {
    await until(() => requests.length === 2); await controls.setForeground(false);
    assert.equal(requests[1].signal.aborted, true); assert.equal(completed, false); assert.equal((await cache.status('fixture-pdf')).downloadedBytes, PDF_BLOCK_SIZE);
    await controls.setForeground(true); await until(() => requests.length === 3); assert.equal(completed, false);
    second.resolve(); await action;
    assert.equal((await worker.pdfCacheStatus('fixture-pdf')).complete, true); assert.equal(JSON.parse(locals.get('fixture-pdf')).is_downloaded, 2);
    assert.equal(requests.filter(request => request.begin === 0).length, 1);
  } finally {controls.dispose(); await worker.stop();}
});

test('fixture runtime activates a unique native reader owner and obsolete disposal cannot revoke its replacement', async () => {
  const files = new Map(), events = [], gate = deferred(); let first = true;
  class Directory {constructor(...parts) {this.uri = parts.map(part => typeof part === 'string' ? part : part.uri).join('/');} get name() {return this.uri.split('/').at(-1);} create() {} delete() {}}
  class File extends Directory {write(value) {files.set(this.uri, value);} async text() {return files.get(this.uri);}}
  class Database {async init() {} async writeTransaction(work) {await work({execute: async () => {}});} async close() {events.push('close');}}
  class Sessions {constructor(_preferences, lifecycle) {this.lifecycle = lifecycle;} async restore() {await this.lifecycle.enter({userId: 'fixture-user'});} getSnapshot() {return {status: 'authenticated'};}}
  class Cache {constructor(dataDirectory) {this.dataDirectory = dataDirectory;}}
  class Queue {start() {events.push('start');} cancel() {} async stop() {} async pdfCacheStatus() {return {complete: false, downloadedBytes: 0, totalBytes: 0};}}
  class Lease {assertActive() {} invalidate() {} async drainWrites() {}}
  const boundaries = {...Object.fromEntries(runtimeImports.map(name => [name, {}])),
    'expo-file-system': {Directory, File, Paths: {cache: new Directory('file:///cache')}}, 'react-native': {AppState: {currentState: 'active', addEventListener: () => ({remove() {}})}}, '@powersync/react-native': {PowerSyncDatabase: Database},
    '../src/data/preferences': {PreferenceStore}, '../src/domain/session': {SessionController: Sessions}, '../src/data/repositories': {MobileRepositories: class {local = {read: async () => ({})};}}, '../src/data/cache': {ArticleFileCache: Cache}, '../src/data/api': {createMobileApi: () => ({})}, '../src/data/schema': {createMobileSchema: async () => ({}), MOBILE_TABLES: {}}, '../src/payments/controller': {PaymentController: class {async stop() {}}}, '../src/telemetry/core': {createMobileTelemetry: () => ({})}, '../src/config': {mobileConfig: {platform: 'android'}}, '../src/i18n': {normalizeLocale: value => value}, './transport': {createFixtureFetch: () => () => {}}, './isolation': {FixtureMemoryPreferences, assertFixtureScope() {}, decodeFixtureArtwork: () => new Uint8Array(), planFixtureRows: () => [], preparedRssCacheKeys: () => []}, './documents': {fixtureDocuments: {}}, './resources': {fixtureImageHashes: {}}, './pdf': {prepareFixturePdfs: () => new Map([['fixture-pdf', {}]])}, '../src/data/background-cache': {BackgroundArticleCache: Queue}, '../src/data/pdf-cache': {PdfBlockCache: class {}}, './pdf-storage': {FixturePdfStorage: class {}}, '../src/data/account-lease': {AccountDatabaseLease: Lease},
    '../src/native/platform': {async activateReaderResources(owner) {events.push(['activate', owner]); if (first) {first = false; await gate.promise;}}, async revokeReaderResources() {events.push('revoke');}},
  };
  const {createFixtureRuntime} = await load('../../fixtures/runtime.ts', boundaries);
  const payload = {settings: {}, session: {token: 'synthetic', userId: 'fixture-user', refreshedAt: 0}, database: {}, cache: [], api: [], network: {isConnected: true, isInternetReachable: true}, sync: {}, pdf: []};
  const pending = createFixtureRuntime('reader-pdf', payload, 'digest', 'en');
  await tick(); assert.equal(events.length, 1); assert.equal(events[0][0], 'activate');
  gate.resolve(); const old = await pending, next = await createFixtureRuntime('reader-pdf', payload, 'digest', 'en');
  const owners = events.filter(event => Array.isArray(event)).map(event => event[1]); assert.equal(owners.length, 2); assert.notEqual(owners[0], owners[1]);
  assert.equal(events.filter(event => event === 'start').length, 2);
  await old.dispose(); assert.equal(events.includes('revoke'), false);
  await next.dispose(); assert.equal(events.filter(event => event === 'revoke').length, 1);
});

const require = createRequire(import.meta.url);
const domPath = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});
async function mounted(run) {
  const {Window} = await import(pathToFileURL(domPath).href), window = new Window();
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'], previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true});
  const {createRoot} = await import('react-dom/client'), root = createRoot(window.document.body.appendChild(window.document.createElement('div')));
  try {await run(root);} finally {await act(async () => root.unmount()); window.close(); for (const name of names) {const old = previous.get(name); if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name];}}
}

test('mounted FixtureApp waits for foreground, records only completed actions, and keeps reader mounted on sanitized command failure', async () => mounted(async root => {
  const files = new Map(), router = new FixtureActionRouter(), f = lifecycle(), warnings = [];
  let urlHandler, mounts = 0;
  const primitive = ({children}) => React.createElement('div', null, children);
  const payload = {settings: {user_language: 'en'}, network: {isConnected: true, isInternetReachable: true}};
  const api = {scopeUri: 'file:///cache/slax-ui-fixtures/control-run', preferences: {subscribe: () => () => {}, read: async () => payload.settings}, sessions: {subscribe: () => () => {}}, async value() {return {runtime: api, upgrade: {status: 'ready'}};}, perform: action => f.controls.run(() => router.dispatch(action), true), setSync() {}, async dispose() {f.controls.dispose();}};
  const controlGlobal = {};
  class File {constructor(directory, name) {this.path = `${directory}/${name}`;} write(value) {files.set(this.path, value);} async text() {return files.get(this.path);}}
  const {default: FixtureApp} = await load('../../fixtures/FixtureApp.tsx', {
    react: React, 'react-native': {ActivityIndicator: primitive, View: primitive, Text: primitive, StatusBar: () => null, Platform: {OS: 'android', constants: {Release: 'test'}}, Dimensions: {get: () => ({})}, PixelRatio: {get: () => 1}, useColorScheme: () => 'light', useWindowDimensions: () => ({width: 400, height: 800, fontScale: 1}), Linking: {addEventListener(_name, handler) {urlHandler = handler; return {remove() {}};}, getInitialURL: async () => null}},
    'react-native-gesture-handler': {GestureHandlerRootView: primitive}, 'react-native-safe-area-context': {SafeAreaProvider: primitive, useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}, 'expo-file-system': {File}, 'expo-modules-core': {},
    '../src/App': {ApplicationRoutes() {React.useEffect(() => {mounts++; return () => {mounts--;};}, []); return React.createElement('span', null, 'reader remains mounted');}, navigationRef: {isReady: () => false}}, '../src/runtime': {FixtureMobileProvider: primitive}, '../src/theme': {mobileColors: {}}, '../src/components/fixture-actions': {fixtureActions: router}, './runtime': {createFixtureRuntime: async () => api},
    './scenarios.json': {schemaVersion: 1, scenarios: {test: {route: {name: 'Library'}, payload, actions: [{kind: 'pdf-fill-cache'}]}}}, './manifest.json': {files: [{path: 'scenarios.json', sha256: 'prepared-digest'}]}, './commands': {parseFixtureCommand: () => ({kind: 'action', action: 0})},
  }, {globalThis: controlGlobal, process: {env: {EXPO_PUBLIC_SLAX_UI_FIXTURE: 'test'}}, console: {warn: value => warnings.push(value)}});
  await act(async () => root.render(React.createElement(FixtureApp)));
  const finish = deferred(); let calls = 0;
  router.subscribe('pdf-cache', async () => {calls++; await finish.promise; return true;});
  const contextPath = `${api.scopeUri}/render-context.json`;
  f.state('inactive'); let action;
  await act(async () => {action = controlGlobal.__SLAX_UI_FIXTURE__.perform(0); await tick();});
  assert.equal(calls, 0); assert.equal(mounts, 1); assert.equal(JSON.parse(files.get(contextPath)).preparedActions.length, 0);
  await act(async () => {f.state('active'); await tick();}); assert.equal(calls, 1); assert.equal(JSON.parse(files.get(contextPath)).preparedActions.length, 0);
  let result; await act(async () => {finish.resolve(); result = await action;});
  assert.equal(result.nativeInteractionVerified, false); assert.equal(JSON.parse(files.get(contextPath)).preparedActions.length, 1);
  router.subscribe('unused', () => false);
  api.perform = async () => {throw new Error('Bearer PRIVATE_DOCUMENT_TEXT file:///private/account');};
  await act(async () => {urlHandler({url: 'slaxreader-ui-fixture://control?index=1'}); await tick();});
  assert.equal(mounts, 1); assert.equal(JSON.parse(files.get(contextPath)).preparedActions.length, 1);
  const diagnostic = files.get(`${api.scopeUri}/command-error.json`); assert.equal(JSON.parse(diagnostic).code, 'failed'); assert.equal(JSON.parse(diagnostic).nativeInteractionVerified, false);
  assert.equal(diagnostic.includes('PRIVATE_DOCUMENT_TEXT'), false); assert.equal(warnings.some(value => value.includes('PRIVATE_DOCUMENT_TEXT')), false);
}));
