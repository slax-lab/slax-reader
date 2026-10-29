import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {createFixturePdf} from '../../fixtures/pdf.ts';
import {throwIfAborted} from '../../src/utils/abort.ts';
import * as contracts from '../../../../packages/contracts/src/pdf.ts';
import * as transportErrors from '../../src/data/transport-errors.ts';

async function load(file, boundaries, globals = {}) {
  const exports = {}, code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports, URL, Headers, Response, ReadableStream, TextEncoder, TextDecoder, Uint8Array, AbortController, TypeError, Error, setTimeout, clearTimeout, ...globals, require(name) {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}}); return exports;
}
const {createFixtureFetch} = await load('../../fixtures/transport.ts', {'../src/utils/abort': {throwIfAborted}});
const sharedRequest = await load('../../src/data/shared-request.ts', {'../utils/abort.ts': {throwIfAborted}});
const boundedBody = await load('../../src/data/bounded-body.ts', {'../utils/abort.ts': {throwIfAborted}});
const headerRedaction = await load('../../src/domain/diagnostic-headers.ts', {});
const {createMobileApi} = await load('../../src/data/api.ts', {'../utils/abort.ts': {throwIfAborted}, '@slax-reader/contracts/pdf': contracts, './transport-errors.ts': transportErrors, './shared-request.ts': sharedRequest, './bounded-body.ts': boundedBody, '../domain/diagnostic-headers.ts': headerRedaction});
async function fixture(publish) {
  const document = createFixturePdf('eight-pages'), records = [], published = [], timers = new Map(); let sequence = 0, active = true, ready = Promise.resolve();
  const {createFixturePdfImport} = await load('../../fixtures/pdf-import.ts', {'../src/utils/abort.ts': {throwIfAborted}}, {setTimeout(fn, delay) {const id = ++sequence; timers.set(id, {fn, delay}); return id;}, clearTimeout(id) {timers.delete(id);}});
  const importer = createFixturePdfImport({document, bookmarkId: 'fixture-pdf-imported', delayMs: 2000, active: () => active, foreground: () => ready, publish: publish ?? (async () => {published.push('fixture-pdf-imported');}), record: state => records.push(state)});
  const payload = {api: [], network: {isConnected: true, isInternetReachable: true}}, counts = {metadataRequests: 0, rangeRequests: 0, bytesServed: 0, offlineRequests: 0, rejectedRequests: 0};
  const transport = createFixtureFetch(payload, 'https://fixture-api.test', {documents: new Map(), counts, record() {}, importPdf: importer});
  const calls = [], api = createMobileApi({baseUrl: 'https://fixture-api.test', platform: 'ios', version: 'fixture', sessions: {getSession: async () => ({token: 'synthetic-not-auth', userId: 'fixture-user'})}, fetch: (...args) => {calls.push(args); return transport(...args);}});
  return {document, importer, api, calls, records, published, timers, payload, transport, revoke() {active = false;}, waitForeground(value) {ready = value;}, async advance() {const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.fn()); await new Promise(resolve => setImmediate(resolve));}};
}

test('production uploadPdf sends the raw File, verifies the exact seeded bytes, then waits for delayed simulated publication', async () => {
  const f = await fixture(), file = new File([f.document.bytes], 'slax-synthetic-eight-pages.pdf', {type: 'application/pdf'});
  const result = await f.api.uploadPdf(file, file.name);
  assert.equal(f.calls[0][1].body, file); assert.equal(f.calls[0][1].headers['Content-Type'], 'application/pdf');
  assert.equal(result.bookmark_uid, 'fixture-pdf-imported'); assert.deepEqual(f.published, []);
  assert.equal(f.records.at(-1).matchedBytes, f.document.bytes.length); assert.equal(f.records.at(-1).synchronization, 'pending');
  assert.equal([...f.timers.values()][0].delay, 2000);
  await f.advance(); assert.deepEqual(f.published, ['fixture-pdf-imported']); assert.equal(f.records.at(-1).synchronization, 'published');
  await f.api.uploadPdf(file, file.name); await f.advance(); assert.equal(f.published.length, 1, 'Retry never fabricates a second synchronized row');
});

test('non-seeded bytes and wrong lengths are rejected without publishing or logging file contents', async () => {
  const f = await fixture(), wrong = f.document.bytes.slice(); wrong[100] ^= 1;
  for (const file of [new File([wrong], 'private-name.pdf'), new File(['private text'], 'other.pdf')]) await assert.rejects(f.api.uploadPdf(file, file.name), error => error.kind === 'network' && error.stage === 'pdf-upload');
  assert.equal(f.records.at(-1).rejectedUploads, 2); assert.equal(f.timers.size, 0); assert.deepEqual(f.published, []);
  assert.equal(JSON.stringify(f.records).includes('private'), false);
});

test('all other fixtures refuse raw upload and transport never falls through to external network', async () => {
  const f = await fixture(), file = new File([f.document.bytes], 'seed.pdf');
  const closed = createFixtureFetch({api: [], network: {isInternetReachable: true}});
  await assert.rejects(closed('https://fixture-api.test/v1/bookmark/upload_pdf', {method: 'POST', body: file}), /not enabled/);
  await assert.rejects(f.transport('https://real-server.test/v1/bookmark/upload_pdf', {method: 'POST', body: file}), /external origin/);
  await assert.rejects(f.transport('https://fixture-api.test/v1/bookmark/upload_pdf', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: file}), /raw PDF/);
  f.payload.network.isInternetReachable = false; await assert.rejects(f.api.uploadPdf(file, 'seed.pdf'), error => error.kind === 'network' && error.stage === 'pdf-upload');
  assert.deepEqual(f.published, []); assert.equal(f.timers.size, 0);
});

test('abort during File reading and account disposal fence delayed publication', async () => {
  const f = await fixture(), controller = new AbortController(); let resolve;
  const body = {size: f.document.bytes.length, arrayBuffer: () => new Promise(yes => {resolve = yes;})};
  const pending = f.importer.accept(body, controller.signal); controller.abort(); resolve(f.document.bytes.buffer);
  await assert.rejects(pending, error => error.name === 'AbortError'); assert.equal(f.timers.size, 0);
  await f.api.uploadPdf(new File([f.document.bytes], 'seed.pdf'), 'seed.pdf'); f.revoke(); await f.advance();
  assert.deepEqual(f.published, []); assert.equal(f.records.at(-1).synchronization, 'cancelled');
});

test('delayed synchronization remains pending during background and disposal prevents publication', async () => {
  const f = await fixture(); let foreground;
  f.waitForeground(new Promise(resolve => {foreground = resolve;}));
  await f.api.uploadPdf(new File([f.document.bytes], 'seed.pdf'), 'seed.pdf'); await f.advance();
  assert.deepEqual(f.published, []); assert.equal(f.records.at(-1).synchronization, 'pending');
  foreground(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.published.length, 1);
  const other = await fixture(); await other.api.uploadPdf(new File([other.document.bytes], 'seed.pdf'), 'seed.pdf'); other.importer.dispose(); await other.advance(); assert.deepEqual(other.published, []);
});

test('failed local database publication is recorded as failure, not synchronized success', async () => {
  const f = await fixture(async () => {throw new Error('private database failure');});
  await f.api.uploadPdf(new File([f.document.bytes], 'seed.pdf'), 'seed.pdf'); await f.advance();
  assert.equal(f.records.at(-1).synchronization, 'failed'); assert.deepEqual(f.published, []);
  assert.equal(JSON.stringify(f.records).includes('private'), false);
});

test('file sharing config is restricted to the native import fixture build', async () => {
  for (const scenario of [undefined, 'reader-pdf', 'reader-pdf-import']) {
    const {default: config} = await load('../../app.config.ts', {'./assets/source-auth-public.json': {default: {}}, './tooling/deploy-environment.cjs': {applyMobileEnvironment() {}}, './tooling/build-version.cjs': {readBuildVersion: () => ({version: '1.0.0', build: '1'})}}, {process: {env: {EXPO_PUBLIC_SLAX_UI_FIXTURE: scenario}}});
    assert.equal(config.ios.infoPlist.UIFileSharingEnabled, scenario === 'reader-pdf-import' ? true : undefined);
    assert.equal(config.ios.infoPlist.LSSupportsOpeningDocumentsInPlace, scenario === 'reader-pdf-import' ? true : undefined);
  }
});
