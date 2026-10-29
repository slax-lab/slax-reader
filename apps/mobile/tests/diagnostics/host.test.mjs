import test from 'node:test';
import assert from 'node:assert/strict';
import {logger} from 'react-native-logs';
import {React, act, nativeBoundary, loadComponent, withNativeHost} from '../reader/parity-host.mjs';
import {mobileColors} from '../../src/theme/index.ts';

for (const scenario of ['empty', 'populated', 'unavailable']) test(`mounted diagnostic viewer ${scenario} reads snapshot and lazy records`, nativeBoundary, async () => withNativeHost(async host => {
  const files = new Map(), now = '2026-10-28T12:00:00.000+00:00'; let reads = 0, exported = '', dialog;
  if (scenario === 'populated') files.set('2026-10-28.share-ios.ndjson', JSON.stringify({v: 1, ts: now, src: 'share-ios', launch: 'share', app: '1 (2)', os: 'iOS 26.1', event: 'share.end', share: '1234abcd', outcome: 'success'}) + '\n');
  const storage = {shareAvailable: scenario !== 'unavailable', list: async () => [...files].map(([name, value]) => ({name, size: value.length})), read: async name => {reads++; return files.get(name);}, remove: async name => {files.delete(name);}, export: async lines => {exported = lines;}};
  const runtime = {diagnostics: {storage, flush: async () => {}}, preferences: {read: async () => ({selected_env: 'BETA'})}, sessions: {getSnapshot: () => ({status: 'authenticated', session: {token: 'private'}})}, credentials: {getSnapshot: () => ({status: 'ready'})}, getDatabase: () => ({currentStatus: {connected: true}, getUploadQueueStats: async () => ({count: 2})}), getNetworkSnapshot: () => 'online'};
  const controls = new Map(), primitive = props => {if (props.onPress) controls.set(props.label ?? props.testID ?? props.children, props); return React.createElement(host.native.View, props);};
  const components = {...host.components, ScreenSurface: host.native.View, SourceButton: primitive, TextAction: primitive, SourceDialog: props => {dialog = props; return props.visible ? React.createElement(host.native.View, null, props.children, props.actions) : null;}};
  const {DiagnosticLogScreen} = await loadComponent('../../src/screens/DiagnosticLogScreen.tsx', {react: React, 'react-native': {...host.native, Platform: {OS: 'ios', Version: '26.1'}, Pressable: primitive}, '../components': components, '../runtime': {useMobile: () => ({runtime, config: {version: '1', buildNumber: '2'}, t: key => key})}, '../theme': {mobileColors}}, {TextEncoder});
  await host.render(React.createElement(DiagnosticLogScreen, {navigation: {setOptions() {}}})); await host.settle();
  assert.match(host.window.document.body.textContent, /"pendingUploads": 2/); assert.equal(host.window.document.body.textContent.includes('private'), false); assert.equal(reads, 0);
  if (scenario === 'populated') {
    const openDay = [...controls.values()].find(value => value.children?.[0]?.props?.children === '2026-10-28'); assert.ok(openDay); await act(async () => openDay.onPress()); await host.settle(); assert.equal(reads, 1); assert.match(host.window.document.body.textContent, /share.end/);
    await act(async () => controls.get('diagnostic_export').onPress()); await host.settle(); assert.equal(JSON.parse(exported.split('\n')[0]).event, 'snapshot');
    await act(async () => controls.get('diagnostic_clear').onPress()); assert.equal(files.size, 1); assert.equal(dialog.visible, true);
    await act(async () => dialog.actions.props.children[1].props.onPress()); await host.settle(); assert.equal(files.size, 0);
  } else assert.match(host.window.document.body.textContent, /diagnostic_empty/);
  if (scenario === 'unavailable') assert.match(host.window.document.body.textContent, /diagnostic_share_unavailable/);
}));

function nativeHost(location = 'ios', globals = {}) {
  const files = new Map(), directories = new Set(), shares = [], listeners = new Set(), sync = [], writes = [];
  class Directory {
    constructor(base, name) {this.uri = `${typeof base === 'string' ? base : base.uri}${name ? `/${name}` : ''}`;}
    get exists() {sync.push(`exists ${this.uri}`); return directories.has(this.uri);}
    create() {directories.add(this.uri);}
    list() {return [...files.keys()].filter(uri => uri.startsWith(this.uri + '/') && !uri.slice(this.uri.length + 1).includes('/')).map(uri => new File(uri));}
  }
  class File {
    constructor(base, name) {this.uri = `${typeof base === 'string' ? base : base.uri}${name ? `/${name}` : ''}`; this.name = this.uri.split('/').at(-1);}
    get exists() {sync.push(`exists ${this.uri}`); return files.has(this.uri);}
    get size() {sync.push(`size ${this.uri}`); return new TextEncoder().encode(files.get(this.uri) ?? '').length;}
    get modificationTime() {return Date.now();}
    create() {files.set(this.uri, '');}
    async write(lines, options) {writes.push(this.uri); if (!directories.has(this.uri.split('/').slice(0, -1).join('/'))) throw new Error('missing directory'); files.set(this.uri, (options?.append ? files.get(this.uri) ?? '' : '') + lines);}
    async text() {return files.get(this.uri);}
    delete() {files.delete(this.uri);}
  }
  const Paths = {document: new Directory('documents'), cache: new Directory('cache'), appleSharedContainers: {'group.app.slax.reader': new Directory('shared')}};
  const load = () => loadComponent('../../src/diagnostics/native.ts', {'react-native': {AppState: {addEventListener(_event, listener) {listeners.add(listener); return {remove() {listeners.delete(listener);}};}}, Platform: {OS: location, Version: '26.1', constants: {Release: '17'}}}, 'expo-file-system': {File, Directory, Paths}, 'expo-sharing': {isAvailableAsync: async () => true, shareAsync: async (...args) => shares.push(args)}, 'react-native-logs': {logger}}, {TextEncoder, ...globals});
  return {files, directories, shares, listeners, sync, writes, Paths, load};
}
test('native adapter uses App Group fallback, async append, background flush and staged sharing', async () => {
  const idles = new Map(); let id = 0;
  const {files, shares, listeners, Paths, load} = nativeHost('ios', {requestIdleCallback: callback => {const key = ++id; idles.set(key, callback); return key;}, cancelIdleCallback: key => idles.delete(key)});
  const module = await load();
  assert.equal(module.resolveDiagnosticLocation('ios', Paths).base.uri, 'shared');
  assert.equal(module.resolveDiagnosticLocation('ios', {document: 'documents', get appleSharedContainers() {throw new Error('entitlement');}}).shareAvailable, false);
  assert.equal(module.resolveDiagnosticLocation('android', Paths).base.uri, 'documents');
  const diagnostics = module.createMobileDiagnostics('1 (2)'), stop = diagnostics.start(); diagnostics.sink.record('app.launch', {});
  assert.equal(files.size, 0); for (const callback of listeners) callback('background'); await diagnostics.flush();
  assert.ok([...files.keys()][0].startsWith('shared/diagnostics/')); assert.equal(JSON.parse([...files.values()][0].trim()).event, 'app.launch');
  await diagnostics.storage.export('{"event":"snapshot"}\n', new Date('2026-10-28T12:00:00Z')); assert.equal(shares.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(shares[0][1])), {mimeType: 'application/x-ndjson', UTI: 'public.json'}); assert.match(shares[0][0], /^cache\/diagnostics-export\/slax-diagnostics-2026-10-28-/);
  stop(); assert.equal(listeners.size, 0);
});

test('native adapter defers retention until after first interactive, never forces idle, caches directory and size, and disposes on teardown', async () => {
  const idleOptions = [], timers = new Map(); let id = 0, now = new Date(2026, 9, 28, 12), interactiveListener;
  const {files, directories, listeners, sync, writes, load} = nativeHost('android', {requestIdleCallback: (callback, options) => {idleOptions.push(options); queueMicrotask(callback); return 0;}, cancelIdleCallback() {}});
  const clock = {now: () => now, schedule(callback, ms) {const key = ++id; timers.set(key, {callback, ms}); return key;}, cancel(key) {timers.delete(key);}};
  const interactive = {subscribe(listener) {interactiveListener = listener; return () => {interactiveListener = undefined;};}};
  const module = await load(), expired = 'documents/diagnostics/2026-08-01.app.ndjson';
  directories.add('documents/diagnostics'); files.set(expired, '{}\n');
  const diagnostics = module.createMobileDiagnostics('1 (2)', clock, interactive), stop = diagnostics.start();
  for (let i = 0; i < 4; i++) {diagnostics.sink.record('app.launch', {}); await new Promise(resolve => setTimeout(resolve, 0)); await diagnostics.flush();}
  assert.deepEqual(idleOptions.filter(value => value !== undefined), []); assert.equal(writes.length, 4); assert.ok(files.has(expired));
  assert.deepEqual(sync, ['exists documents/diagnostics/2026-10-28.app.ndjson', 'exists documents/diagnostics']);
  assert.equal([...timers.values()].some(timer => timer.ms === module.DIAGNOSTIC_RETENTION_DELAY_MS), false);
  interactiveListener(); interactiveListener();
  const retention = [...timers.entries()].filter(([, timer]) => timer.ms === module.DIAGNOSTIC_RETENTION_DELAY_MS); assert.equal(retention.length, 1); assert.ok(files.has(expired));
  timers.delete(retention[0][0]); retention[0][1].callback(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(files.has(expired), false); sync.length = 0;
  now = new Date(2026, 9, 29, 0, 1); diagnostics.sink.record('app.launch', {}); await new Promise(resolve => setTimeout(resolve, 0)); await diagnostics.flush();
  assert.deepEqual(sync, ['exists documents/diagnostics/2026-10-29.app.ndjson']); assert.ok(files.has('documents/diagnostics/2026-10-29.app.ndjson'));
  await diagnostics.storage.remove('2026-10-29.app.ndjson'); directories.delete('documents/diagnostics'); diagnostics.sink.record('app.launch', {}); await new Promise(resolve => setTimeout(resolve, 0)); await diagnostics.flush();
  diagnostics.sink.record('app.launch', {}); await new Promise(resolve => setTimeout(resolve, 0)); await diagnostics.flush(); assert.ok(files.has('documents/diagnostics/2026-10-29.app.ndjson'));
  const second = module.createMobileDiagnostics('1 (2)', clock, interactive), stopSecond = second.start(); interactiveListener();
  assert.ok([...timers.values()].some(timer => timer.ms === module.DIAGNOSTIC_RETENTION_DELAY_MS)); stopSecond(); assert.equal(interactiveListener, undefined);
  assert.equal([...timers.values()].some(timer => timer.ms === module.DIAGNOSTIC_RETENTION_DELAY_MS), false);
  stop(); assert.equal(listeners.size, 0); await new Promise(resolve => setTimeout(resolve, 0));
  const count = writes.length; diagnostics.sink.record('app.launch', {}); await new Promise(resolve => setTimeout(resolve, 0)); await diagnostics.flush(); assert.equal(writes.length, count);
});
