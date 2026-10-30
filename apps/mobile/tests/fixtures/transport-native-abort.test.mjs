import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as pdfContracts from '@slax-reader/contracts/pdf';
const require = createRequire(import.meta.url);
const nativeRequire = createRequire(realpathSync(require.resolve('react-native/package.json')));
const NativeAbortController = nativeRequire('abort-controller/dist/abort-controller').AbortController;
const {Response: NativeResponse, Headers: NativeHeaders} = nativeRequire('whatwg-fetch');
const abortExports = {};
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(compile('../../src/utils/abort.ts'), {exports: abortExports, AbortController: NativeAbortController, setTimeout, clearTimeout});
const exports = {};
vm.runInNewContext(compile('../../fixtures/transport.ts'), {exports, URL, Response: NativeResponse, Headers: NativeHeaders, ReadableStream, TextEncoder, TextDecoder, setTimeout, clearTimeout, require(path) {assert.equal(path, '../src/utils/abort'); return abortExports;}});
const transportErrors = {};
vm.runInNewContext(compile('../../src/data/transport-errors.ts'), {exports: transportErrors, Error});
const apiExports = {}, sharedRequest = {};
vm.runInNewContext(compile('../../src/data/shared-request.ts'), {exports: sharedRequest, AbortController: NativeAbortController, setTimeout, clearTimeout, require(path) {assert.equal(path, '../utils/abort.ts'); return abortExports;}});
const headerRedaction = {};
vm.runInNewContext(compile('../../src/domain/diagnostic-headers.ts'), {exports: headerRedaction});
const apiImports = {'../utils/abort.ts': abortExports, '@slax-reader/contracts/pdf': pdfContracts, './transport-errors.ts': transportErrors, './shared-request.ts': sharedRequest, '../domain/diagnostic-headers.ts': headerRedaction};
const boundedBody = {};
vm.runInNewContext(compile('../../src/data/bounded-body.ts'), {exports: boundedBody, TextEncoder, TextDecoder, require(path) {assert.equal(path, '../utils/abort.ts'); return abortExports;}});
apiImports['./bounded-body.ts'] = boundedBody;
vm.runInNewContext(compile('../../src/data/api.ts'), {exports: apiExports, URL, AbortController: NativeAbortController, TextDecoder, setTimeout, clearTimeout, require(path) {assert.ok(Object.hasOwn(apiImports, path), `Unexpected API import: ${path}`); return apiImports[path];}});
const payload = {network: {isInternetReachable: true}, api: [{method: 'GET', path: '/v1/user/labs', query: {}, status: 200, delayMs: 0, json: {code: 200, data: {features: [{key: 'rss', enabled: true}]}}}]};
test('fixture API works with the exact React Native AbortController dependency', async () => {
  const controller = new NativeAbortController();
  assert.equal(controller.signal.throwIfAborted, undefined);
  const response = await exports.createFixtureFetch(payload)('https://fixture-api.test/v1/user/labs', {signal: controller.signal});
  assert.deepEqual(await response.json(), payload.api[0].json);
});
test('native abort cancels prepared delayed response without permitting a request after cancellation', async () => {
  const controller = new NativeAbortController();
  const fetch = exports.createFixtureFetch({...payload, api: [{...payload.api[0], delayMs: 30}]});
  const pending = fetch('https://fixture-api.test/v1/user/labs', {signal: controller.signal});
  controller.abort();
  await assert.rejects(pending, /aborted/i);
  await assert.rejects(fetch('https://fixture-api.test/v1/user/labs', {signal: controller.signal}), error => error.name === 'AbortError');
});
const streamPayload = () => ({network: {isInternetReachable: true}, api: [{method: 'POST', path: '/v1/bookmark/overview', query: {}, status: 200, delayMs: 0, contentType: 'text/event-stream', chunks: [
  {text: '{"type":"data","data":{"overview":"first "}}\n', delayMs: 1},
  {text: '{"type":"data","data":{"overview":"second","done":true}}\n', delayMs: 25},
]}]});
const api = payload => new apiExports.SlaxApi({baseUrl: 'https://fixture-api.test', platform: 'android', version: 'fixture', sessions: {getSession: async () => null}, fetch: exports.createFixtureFetch(payload)});
test('real API parser consumes timed fixture bytes with the exact RN Response polyfill', async () => {
  assert.equal(new NativeResponse(new ReadableStream()).body, undefined);
  const iterator = api(streamPayload()).streamAi('overview', 'synthetic');
  const first = await iterator.next();
  assert.equal(first.value.data.overview, 'first ');
  assert.equal(first.value.data.done, undefined);
  const second = await iterator.next();
  assert.equal(second.value.data.overview, 'second');
  assert.equal(second.value.data.done, true);
  assert.equal((await iterator.next()).done, true);
});
test('native abort prevents a second fixture stream chunk from reaching the actual parser', async () => {
  const controller = new NativeAbortController();
  const iterator = api(streamPayload()).streamAi('overview', 'synthetic', controller.signal);
  assert.equal((await iterator.next()).value.data.overview, 'first ');
  controller.abort();
  await assert.rejects(iterator.next(), error => error.name === 'AbortError');
});

function pdfFixture() {
  const descriptor = {url: '/v1/bookmark/pdf?bookmark_uid=synthetic-pdf', filename: 'synthetic.pdf', size: 8, document_id: 'a'.repeat(64), source: 'upload', text_status: 'ready', pages: 8};
  const pdf = {documents: new Map([['synthetic-pdf', {descriptor, bytes: new TextEncoder().encode('%PDF-1.4')}]]), counts: {metadataRequests: 0, rangeRequests: 0, bytesServed: 0, offlineRequests: 0, rejectedRequests: 0}, record() {}, importPdf: {async accept() {return {bookmark_uid: 'synthetic-pdf', bookmark_id: 'synthetic-pdf'};}}};
  const fetch = exports.createFixtureFetch({network: {isInternetReachable: true}, api: []}, 'https://fixture-api.test', pdf);
  const api = new apiExports.SlaxApi({baseUrl: 'https://fixture-api.test', platform: 'ios', version: 'fixture', sessions: {getSession: async () => ({token: 'synthetic', userId: 'fixture'})}, fetch});
  return {api, fetch, pdf, descriptor};
}

test('fixture PDF metadata body and binary ranges use the exact RN Response polyfill', async () => {
  assert.equal(new NativeResponse(JSON.stringify({code: 200})).body, undefined);
  const f = pdfFixture();
  const envelope = await (await f.fetch('https://fixture-api.test/v1/bookmark/metadata?bookmark_uid=synthetic-pdf')).json();
  assert.equal(envelope.data.pdf.document_id, f.descriptor.document_id);
  const range = await f.fetch('https://fixture-api.test/v1/bookmark/pdf?bookmark_uid=synthetic-pdf', {headers: {Range: 'bytes=0-7'}});
  assert.equal(range.status, 206); assert.equal(range.headers.get('ETag'), null); await range.body.cancel();
  assert.equal(range.headers.get('Content-Range'), 'bytes 0-7/8'); assert.equal(f.pdf.counts.rangeRequests, 1);
});

test('actual PDF upload parser consumes the exact RN Response success stream', async () => {
  const f = pdfFixture(), result = await f.api.uploadPdf(new Blob(['%PDF-1.4']), 'synthetic.pdf');
  assert.equal(result.bookmark_uid, 'synthetic-pdf');
});

for (const endpoint of ['metadata?bookmark_uid=synthetic-pdf', 'upload_pdf']) test(`native abort and body cancellation remain effective for ${endpoint}`, async () => {
  const f = pdfFixture(), controller = new NativeAbortController();
  const options = {signal: controller.signal, ...(endpoint === 'upload_pdf' ? {method: 'POST', headers: {'Content-Type': 'application/pdf'}, body: new Blob(['%PDF-1.4'])} : {})};
  const response = await f.fetch(`https://fixture-api.test/v1/bookmark/${endpoint}`, options);
  assert.equal(typeof response.body.getReader, 'function'); controller.abort();
  await assert.rejects(response.body.getReader().read(), error => error.name === 'AbortError');
  const fresh = await f.fetch(`https://fixture-api.test/v1/bookmark/${endpoint}`, {...options, signal: undefined});
  await fresh.body.cancel(); assert.equal((await fresh.body.getReader().read()).done, true);
});
