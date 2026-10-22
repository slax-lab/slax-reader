import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import {readerSignedImageProxy, readerAllowsImage, readerAllowsUrl} from '../../src/reader/security.ts';
import * as security from '../../src/reader/security.ts';
import {throwIfAborted} from '../../src/utils/abort.ts';

const origin = 'https://api.other.test';
const proxy = origin + '/static/image?m=rss&d=' + 'a'.repeat(32) + '&u=https%253A%252F%252Fimages.test%252Fa.png&r=https%3A%2F%2Ffeed.test%2Farticle';
test('signed image exception is exact-origin exact-path image-only and never navigation permission', () => {
  assert.equal(readerSignedImageProxy(proxy, [origin]), true);
  assert.equal(readerAllowsImage(proxy, ['api.other.test'], [origin]), true);
  assert.equal(readerAllowsUrl(proxy, ['api.other.test']), false);
  for (const value of [proxy.replace('/static/image?', '/static/image/other?'), proxy.replace(origin, 'https://api.other.test.evil.test'), proxy + '&d=' + 'b'.repeat(32), proxy + '&token=synthetic', proxy.replace('m=rss', 'm=other'), proxy.replace('d=' + 'a'.repeat(32), 'd=bad'), proxy + '#x']) assert.equal(readerSignedImageProxy(value, [origin]), false, value);
});

const source = await readFile(new URL('../../src/native/reader-image.ts', import.meta.url), 'utf8');
function fixture(native) {
  const exports = {};
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports, URL, setTimeout, clearTimeout, require(name) {
    if (name === 'expo') return {requireNativeModule: () => native};
    if (name === '../config') return {mobileConfig: {webUrl: 'https://r.slax.com', webDomain: '.slax.com', apiUrl: origin, betaApiUrl: 'https://beta-api.other.test'}};
    if (name === '../reader/security.ts') return security;
    if (name === '../utils/abort.ts') return {throwIfAborted};
    if (name === '../data/transport-errors.ts') return {retryAfterMs: value => Number(value) * 1000};
    throw new Error(name);
  }});
  return exports;
}
const request = url => ({url, owner: 'A', directory: '/app', key: 'book', allowNetwork: true, strict: true});
const resource = {uri: 'file:///app/bookmark/book/images/image.png', size: 3, mime: 'image/png'};
test('native image transport returns an admitted URI with account identity and no request credentials', async () => {
  let owner = 'A'; const calls = [];
  const api = fixture({readerResourceOwner: () => owner, begin: () => 'id', resolve: async (...args) => {calls.push(args); return resource;}, end() {}});
  assert.equal((await api.loadReaderImage(request(proxy))).uri, resource.uri);
  assert.equal(calls[0][0], 'A'); assert.equal(calls[0][2].url, proxy); assert.equal(calls[0][2].headers, undefined);
  await assert.rejects(api.loadReaderImage(request(origin + '/account')), /unavailable/);
  assert.equal(calls.length, 1);
});
test('native image cancellation and account replacement cannot deliver old URIs', async () => {
  let owner = 'A', release; const cancelled = new Set();
  const api = fixture({readerResourceOwner: () => owner, begin: () => 'id', resolve: () => new Promise(resolve => {release = resolve;}), end: (_owner, id) => cancelled.add(id)});
  const controller = new AbortController(); const work = api.loadReaderImage(request('https://images.test/a'), controller.signal);
  await Promise.resolve(); controller.abort(); release(resource);
  await assert.rejects(work, error => error.name === 'AbortError'); assert.equal(cancelled.size, 1);
  const next = api.loadReaderImage(request('https://images.test/a')); await Promise.resolve(); owner = 'B'; release(resource);
  await assert.rejects(next, /released/);
});
test('native image results reject remote, foreign-key, oversized and malformed resources', async () => {
  for (const result of [{...resource, uri: 'https://images.test/a'}, {...resource, uri: 'file:///app/bookmark/other/images/a'}, {...resource, size: 20 * 1024 * 1024 + 1}, {...resource, size: 0}]) {
    const api = fixture({readerResourceOwner: () => 'A', begin: () => 'id', resolve: async () => result, end() {}});
    await assert.rejects(api.loadReaderImage(request(proxy)), /Invalid Reader image/);
  }
});
test('native image failure retains HTTP denial and Retry-After classification', async () => {
  const api = fixture({readerResourceOwner: () => 'A', begin: () => 'id', resolve: async () => ({error: 'unavailable', status: 429, retryAfter: '17', terminal: false}), end() {}});
  await assert.rejects(api.loadReaderImage(request(proxy)), error => error.status === 429 && error.retryAfterMs === 17000 && error.kind === 'network');
});
test('gallery and share cannot issue remote fetch/Image fallback outside private native transport', async () => {
  const [gallery, resolver, share, android] = await Promise.all(['../../src/reader/ImageGallery.tsx', '../../src/reader/gallery-resource.ts', '../../src/reader/share.ts', '../../modules/slax-platform/android/src/main/java/com/slax/reader/platform/SlaxReaderView.kt'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  assert.doesNotMatch(gallery, /networkUri|setResolved\(\{uri: page\.image/);
  assert.doesNotMatch(resolver, /options\.fetch\(/);
  assert.doesNotMatch(share, /expoFetch|downloadFileAsync/);
  assert.match(share, /cache\.ensureImage/); assert.doesNotMatch(share, /file\.write|base64|atob/);
  assert.doesNotMatch(android, /if \(request\.method != "GET"\)/);
  assert.match(android, /request\.url\.scheme in listOf\("slaxmedia", "slaxmedias", "slaxstatic", "slaxstatics"\) && request\.method != "GET"/);
});
