import test from 'node:test';
import assert from 'node:assert/strict';
import {React, act, nativeBoundary, loadComponent, withNativeHost} from '../reader/parity-host.mjs';
import {mobileColors, mobileTypography} from '../../src/theme/index.ts';
import {appMessages} from '../../src/i18n/appMessages.ts';

async function nativeExports() {
  const files = new Map(), directories = new Set(), shared = []; let available = true, blocked = false, finish, writeFailure = false;
  class Directory {
    constructor(base, name) {this.uri = `${typeof base === 'string' ? base : base.uri}${name ? `/${name}` : ''}`;}
    get exists() {return directories.has(this.uri);}
    create() {directories.add(this.uri);}
    list() {return [...files.keys()].filter(uri => uri.startsWith(this.uri + '/')).map(uri => new File(uri));}
  }
  class File {
    constructor(base, name) {this.uri = `${typeof base === 'string' ? base : base.uri}${name ? `/${name}` : ''}`; this.name = this.uri.split('/').at(-1);}
    get exists() {return files.has(this.uri);}
    get modificationTime() {return files.get(this.uri)?.time ?? null;}
    get size() {return new TextEncoder().encode(files.get(this.uri)?.text ?? '').length;}
    async write(text) {if (writeFailure) throw new Error('write failed'); files.set(this.uri, {text, time: Date.now()});}
    async text() {return files.get(this.uri)?.text;}
    delete() {files.delete(this.uri);}
  }
  const module = await loadComponent('../../src/diagnostics/native-export.ts', {'./storage': await import('../../src/diagnostics/storage.ts'), 'expo-file-system': {File, Directory, Paths: {cache: 'file:///cache'}}, 'expo-sharing': {isAvailableAsync: async () => available, shareAsync: async (uri, options) => {
    assert.ok(files.has(uri)); shared.push({uri, options, text: files.get(uri).text}); if (blocked) await new Promise(resolve => {finish = resolve;});
  }}}, {TextEncoder});
  return {module, files, shared, directories, setAvailable(value) {available = value;}, block() {blocked = true;}, finish: () => finish?.(), failWrite() {writeFailure = true;}};
}
test('native export passes actual file URI/type and protects active files from stale cleanup', async () => {
  const f = await nativeExports(), now = new Date();
  const lines = JSON.stringify({v: 1, ts: now.toISOString(), src: 'app', launch: 'abcd1234', event: 'app.launch', app: '1.0.25 (795)', os: 'iOS 26.1'}) + '\n';
  const first = await f.module.stageDiagnosticFile(lines, now);
  const second = await f.module.stageDiagnosticFile(lines, now); assert.notEqual(first.uri, second.uri);
  f.files.get(first.uri).time = now.getTime() - 700000; f.files.get(second.uri).time = now.getTime() - 700000;
  const unrelated = 'file:///cache/diagnostics-export/private.db'; f.files.set(unrelated, {text: 'keep', time: 0});
  f.module.pruneDiagnosticExports(now.getTime()); assert.equal(f.files.has(first.uri), true); assert.equal(f.files.has(second.uri), true);
  f.block(); const sharing = f.module.shareDiagnosticFile(first); await new Promise(resolve => setTimeout(resolve, 0));
  f.module.pruneDiagnosticExports(now.getTime()); assert.equal(f.files.has(first.uri), true);
  assert.equal(f.shared[0].uri, first.uri); assert.deepEqual(JSON.parse(JSON.stringify(f.shared[0].options)), {mimeType: 'application/x-ndjson', UTI: 'public.json'});
  assert.equal(f.shared[0].text, await first.file.text());
  f.finish(); await sharing; first.release(); second.release();
  assert.equal(f.files.has(first.uri), false); assert.equal(f.files.has(second.uri), false); assert.equal(f.files.has(unrelated), true);
});
test('unavailable sharing and cancelled ownership never claim to share a file', async () => {
  const f = await nativeExports(), file = await f.module.stageDiagnosticFile('{}\n', new Date());
  f.setAvailable(false); await assert.rejects(f.module.shareDiagnosticFile(file), /sharing-unavailable/); assert.equal(f.shared.length, 0);
  f.setAvailable(true); await assert.rejects(f.module.shareDiagnosticFile(file, () => {throw new Error('closed');}), /closed/); assert.equal(f.shared.length, 0); file.release();
});
test('hidden viewer uses native file adapter and handles unavailable sharing cancellation and export failure', nativeBoundary, async () => withNativeHost(async host => {
  const f = await nativeExports(); let uploadCalls = 0, flushes = 0;
  const now = new Date(), day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const log = JSON.stringify({v: 1, ts: now.toISOString(), src: 'app', launch: 'abcd1234', event: 'auth.signout', cause: 'user', app: '1.0.25 (795)', os: 'iOS 26.1', sync: {connected: true}}) + '\n';
  const storage = {shareAvailable: true, list: async () => [{name: `${day}.app.ndjson`, size: log.length}], read: async () => log, export: f.module.exportDiagnosticFile};
  const runtime = {diagnostics: {storage, flush: async () => {flushes++;}}};
  const mobile = {runtime, api: {sendFeedback() {uploadCalls++;}}, t: key => appMessages.en[key] ?? key};
  const {DiagnosticLogScreen} = await loadComponent('../../src/screens/DiagnosticLogScreen.tsx', {'../diagnostics/storage': await import('../../src/diagnostics/storage.ts'), react: React, 'react-native': {...host.native, Platform: {OS: 'ios', Version: '26.1'}}, '../components': {...host.components, ScreenSurface: host.native.View, SourceButton: host.native.View}, '../runtime': {useMobile: () => mobile}, '../theme': {mobileColors, mobileTypography}}, {TextEncoder});
  await host.render(React.createElement(DiagnosticLogScreen, {navigation: {setOptions() {}}})); await host.settle();
  assert.equal(f.files.size, 0); assert.equal(flushes, 1);
  f.setAvailable(false); await act(async () => host.props.get('diagnostic_export').onPress()); await host.settle();
  assert.match(host.window.document.body.textContent, /Unable to complete/); assert.equal(f.shared.length, 0);
  f.setAvailable(true); f.block(); await act(async () => host.props.get('diagnostic_export').onPress()); await host.settle();
  assert.equal(host.props.get('diagnostic_export').disabled, true); assert.equal(f.shared.length, 1);
  const rows = f.shared[0].text.trim().split('\n').map(JSON.parse); assert.equal(rows.length, 1); assert.equal(rows[0].event, 'auth.signout');
  for (const key of ['app', 'os', 'sync']) assert.equal(key in rows[0], false);
  assert.ok(f.shared[0].uri.startsWith('file:///cache/diagnostics-export/slax-diagnostics-')); assert.ok(f.shared[0].uri.endsWith('.ndjson'));
  f.finish(); await host.settle(); assert.equal(host.props.get('diagnostic_export').disabled, false); assert.equal(uploadCalls, 0);
  f.failWrite(); await act(async () => host.props.get('diagnostic_export').onPress()); await host.settle();
  assert.match(host.window.document.body.textContent, /Unable to complete/); assert.equal(f.shared.length, 1); assert.equal(uploadCalls, 0); assert.equal(flushes, 4);
}));
