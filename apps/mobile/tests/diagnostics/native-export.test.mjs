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
  const first = await f.module.stageDiagnosticFile('{"v":1,"event":"snapshot"}\n', now);
  const second = await f.module.stageDiagnosticFile('{}\n', now); assert.notEqual(first.uri, second.uri);
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
test('mounted About uses native file adapter, handles unavailable sharing, cancellation and export failure', nativeBoundary, async () => withNativeHost(async host => {
  const f = await nativeExports(); let uploadCalls = 0;
  const storage = {shareAvailable: true, list: async () => [], stage: f.module.stageDiagnosticFile, share: f.module.shareDiagnosticFile};
  const runtime = {diagnostics: {storage, flush: async () => {}}, preferences: {read: async () => ({})}, sessions: {subscribe: () => () => {}, getSnapshot: () => ({status: 'authenticated'})}, getDatabase: () => null};
  const mobile = {runtime, api: {captureFeedbackOwner: () => () => {}, sendFeedback() {uploadCalls++;}}, config: {version: '1.0.25', buildNumber: 794}, t: key => appMessages.en[key] ?? key};
  const {AboutScreen} = await loadComponent('../../src/screens/AboutScreen.tsx', {'../diagnostics/storage': await import('../../src/diagnostics/storage.ts'), react: React, 'react-native': {...host.native, Platform: {OS: 'ios', Version: '26.1'}}, '../components': {...host.components, ScreenSurface: host.native.View}, '../runtime': {useMobile: () => mobile}, '../theme': {mobileColors, mobileTypography}}, {TextEncoder});
  await host.render(React.createElement(AboutScreen, {navigation: {setOptions() {}}}));
  assert.equal(f.files.size, 0);
  f.setAvailable(false); await act(async () => host.props.get('about-diagnostic-share').onPress()); await host.settle();
  assert.match(host.window.document.body.textContent, /File sharing is unavailable/); assert.equal(f.shared.length, 0);
  f.setAvailable(true); f.block(); await act(async () => host.props.get('about-diagnostic-share').onPress()); await host.settle();
  assert.equal(host.props.get('about-diagnostic-share').disabled, true); assert.equal(f.shared.length, 1);
  assert.equal(JSON.parse(f.shared[0].text.trim()).event, 'snapshot'); assert.ok(f.shared[0].uri.startsWith('file:///cache/diagnostics-export/slax-diagnostics-')); assert.ok(f.shared[0].uri.endsWith('.ndjson'));
  f.finish(); await host.settle(); assert.equal(host.props.get('about-diagnostic-share').disabled, false); assert.equal(uploadCalls, 0);
  f.failWrite(); await act(async () => host.props.get('about-diagnostic-share').onPress()); await host.settle();
  assert.match(host.window.document.body.textContent, /Unable to complete/); assert.equal(f.shared.length, 1); assert.equal(uploadCalls, 0);
}));
