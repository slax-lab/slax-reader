import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const nativeRequire = createRequire(realpathSync(require.resolve('react-native/package.json')));
const NativeAbortController = nativeRequire('abort-controller/dist/abort-controller').AbortController;
const NativeResponse = nativeRequire('whatwg-fetch').Response;
const abortExports = {};
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(compile('../../src/utils/abort.ts'), {exports: abortExports});
const exports = {};
vm.runInNewContext(compile('../../fixtures/transport.ts'), {exports, URL, Response: NativeResponse, ReadableStream, TextEncoder, TextDecoder, setTimeout, clearTimeout, require(path) {assert.equal(path, '../src/utils/abort'); return abortExports;}});
const apiExports = {};
vm.runInNewContext(compile('../../src/data/api.ts'), {exports: apiExports, URL, AbortController: NativeAbortController, TextDecoder, setTimeout, clearTimeout, require(path) {assert.equal(path, '../utils/abort.ts'); return abortExports;}});
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
