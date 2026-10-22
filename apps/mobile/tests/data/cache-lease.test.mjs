import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {imageCachePath, imageCacheReadPaths, normalizeImageUrl} from '../../src/data/cache-paths.ts';
import {throwIfAborted} from '../../src/utils/abort.ts';
import {memoryNativeFileStore} from '../fixtures/native-file-store.mjs';

function fixture(validate = (directory, key, path) => `file://${directory}/${path}`, resolveImage) {
  const contents = new Map(), native = memoryNativeFileStore(contents);
  class File {
    constructor(uri) {this.uri = uri;}
    get size() {const value = contents.get(this.uri); return typeof value === 'string' ? value.length : value?.byteLength ?? 0;}
    write() {assert.fail('Production cache must not call synchronous Expo writes');}
    delete() {assert.fail('Production cache must not call synchronous Expo deletion');}
  }
  const filename = new URL('../../src/data/cache.ts', import.meta.url);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(output, {exports, require(name) {
    if (name === 'expo-file-system') return {File};
    if (name === './native-file-store.ts') return native;
    if (name === './cache-paths.ts') return {imageCachePath, imageCacheReadPaths, normalizeImageUrl};
    if (name === 'expo') return {requireNativeModule(name) {assert.equal(name, 'SlaxCachePaths'); return {imageCacheFileUri: validate};}};
    if (name === '../utils/abort.ts') return {throwIfAborted};
    throw new Error(`Unexpected cache import ${name}`);
  }}, {filename: filename.pathname});
  const Cache = exports.ArticleFileCache;
  let active = true;
  const cache = new Cache('/app/data', () => 'prepared-hash', () => {if (!active) throw new Error('Account lease revoked');}, undefined, 'owner-a', resolveImage);
  return {cache, contents, native, revoke() {active = false;}, waitRead: native.waitRead, nextAccount() {return new Cache('/app/data', () => 'prepared-hash', undefined, undefined, 'owner-b');}};
}
test('revoked article cache cannot read, overwrite, measure, or clear the next account', async () => {
  const {cache, revoke, nextAccount} = fixture(); await cache.writeArticle('same-id', 'account A'); revoke();
  const next = nextAccount(); await next.writeArticle('same-id', 'account B');
  await assert.rejects(cache.writeArticle('same-id', 'late A'), /revoked/);
  await assert.rejects(cache.clearArticles(), /revoked/);
  await assert.rejects(cache.removeArticle('same-id'), /revoked/);
  await assert.rejects(cache.removeImages('same-id'), /revoked/);
  await assert.rejects(cache.articleBytes('same-id'), /revoked/);
  await assert.rejects(cache.imageBytes('same-id'), /revoked/);
  await assert.rejects(cache.readArticle('same-id'), /revoked/);
  await assert.rejects(cache.getResourceUri('same-id', 'https://images.test/a.png'), /revoked/);
  assert.equal(await next.readArticle('same-id'), 'account B');
});
test('a read suspended over logout cannot return the next account document', async () => {
  const {cache, revoke, nextAccount, waitRead} = fixture(); await cache.writeArticle('same-id', 'account A');
  let release; waitRead(new Promise(resolve => {release = resolve;}));
  const read = cache.readArticle('same-id'); revoke(); await nextAccount().writeArticle('same-id', 'account B'); release();
  await assert.rejects(read, /revoked/);
});
test('a delayed image load commits only while its captured account lease is active', async () => {
  const {cache, revoke, nextAccount, contents} = fixture(); let release, entered;
  const started = new Promise(resolve => {entered = resolve;});
  const pending = cache.ensureImage('same-id', 'https://images.test/a.png', () => new Promise(resolve => {release = resolve; entered();}));
  await started; revoke(); const next = nextAccount(); await next.ensureImage('same-id', 'https://images.test/a.png', async () => new Uint8Array([2]));
  release(new Uint8Array([1])); await assert.rejects(pending, /revoked/);
  const file = next.imageFile('same-id', 'https://images.test/a.png'); assert.equal(file.size, 1);
  assert.deepEqual([...contents.get(file.uri)], [2]);
  assert.equal(await next.ensureImage('same-id', 'https://images.test/a.png', async () => {throw new Error('Cached artwork should not fetch');}), file.uri);
});
test('an image canceled after its loader resolves cannot commit to the active account', async () => {
  const {cache, contents} = fixture(), controller = new AbortController();
  const pending = cache.ensureImage('same-id', 'https://images.test/a.png', () => {
    const bytes = Promise.resolve(new Uint8Array([1]));
    // Cancellation runs before ensureImage resumes from the resolved loader.
    bytes.then(() => controller.abort());
    return bytes;
  }, controller.signal);
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(contents.size, 0);
});

test('legacy nested image names are bounded read-only fallbacks, with the safe path preferred', async () => {
  for (const [url, suffix] of [
    ['https://example.com/image', 'com/image'],
    ['slaxstatics://example.com/image?size=2#tag', 'com/image'],
    ['https://example.com/a.b/image?size=2', 'b/image'],
    ['https://example.com/image#x', 'com/image#'],
    ['https://example.com/a.png?x=.com/image', 'com/image'],
  ]) {
    const {cache, contents, revoke} = fixture();
    const legacy = `file:///app/data/bookmark/article/images/prepared-hash.${suffix}`;
    contents.set(legacy, new Uint8Array([3]));
    assert.equal(await cache.getResourceUri('article', url), legacy);
    assert.equal(await cache.ensureImage('article', url, async () => {throw new Error('Offline legacy cache should not fetch');}), legacy);
    assert.equal(contents.size, 1);
    const current = cache.imageFile('article', url); assert(current.uri.endsWith('.jpg'));
    contents.set(current.uri, new Uint8Array([4]));
    assert.equal(await cache.getResourceUri('article', url), current.uri);
    assert.equal(contents.has(legacy), true);
    revoke(); await assert.rejects(cache.getResourceUri('article', url), /revoked/);
  }
});
test('missing legacy files write only the safe name; traversal and foreign bookmark keys never become fallbacks', async () => {
  const {cache, contents} = fixture();
  await cache.ensureImage('article', 'https://example.com/image', async () => new Uint8Array([5]));
  assert.deepEqual([...contents.keys()], ['file:///app/data/bookmark/article/images/prepared-hash.jpg']);
  for (const url of ['https://example.com//image', 'https://example.com/a\\image', 'https://example.com/a\u0000image']) assert.equal(imageCacheReadPaths('article', url, () => 'hash').length, 1);
  for (const key of ['../other', 'a/../../b', 'a\\b', '']) await assert.rejects(cache.getResourceUri(key, 'https://example.com/image'), /Invalid/);
  assert.deepEqual(imageCacheReadPaths('article', 'http://localhost/image', () => 'hash'), ['bookmark/article/images/hash.jpg']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(cache.ensureImage('article', 'https://example.com/image', async () => {throw new Error('should not load');}, controller.signal), error => error.name === 'AbortError');
});
test('native containment denial cannot read or write through an image path, including after a pending fetch', async () => {
  let allowed = false;
  const {cache, contents} = fixture((directory, _key, path) => allowed ? `file://${directory}/${path}` : null);
  const legacy = 'file:///app/data/bookmark/article/images/prepared-hash.com/image'; contents.set(legacy, 'foreign');
  assert.equal(await cache.getResourceUri('article', 'https://example.com/image'), null);
  await assert.rejects(cache.ensureImage('article', 'https://example.com/image', async () => new Uint8Array([1])), /Unsafe/);
  allowed = true;
  await assert.rejects(cache.ensureImage('new-article', 'https://example.com/image', async () => {allowed = false; return new Uint8Array([1]);}), /Unsafe/);
  assert.deepEqual([...contents.entries()], [[legacy, 'foreign']]);
});

test('article writes and measurements use the async native port and retain the captured owner', async () => {
  const {cache, contents, native} = fixture(); let release;
  native.waitWrite(new Promise(resolve => {release = resolve;}));
  let completed = false; const writing = cache.writeArticle('article', '正文').then(() => {completed = true;});
  await Promise.resolve(); assert.equal(completed, false); assert.equal(contents.size, 0);
  release(); await writing; assert.equal(await cache.articleBytes('article'), 6);
  assert.equal(await cache.readArticle('article'), '正文');
  assert(native.calls.every(call => call[1] === 'owner-a'));
  assert.equal(await cache.removeArticleContent('article'), true); assert.equal(await cache.articleBytes('article'), 0);
});

test('cancellation while the native image write is pending fences commit and releases its operation handle', async () => {
  const {cache, contents, native} = fixture(), controller = new AbortController(); let release;
  native.waitWrite(new Promise(resolve => {release = resolve;}));
  const pending = cache.ensureImage('article', 'https://images.test/one.png', async () => new Uint8Array([1, 2]), controller.signal);
  const rejected = assert.rejects(pending, {name: 'AbortError'});
  for (let index = 0; index < 20 && !native.pendingWrites(); index++) await Promise.resolve();
  assert.equal(native.pendingWrites(), 1); controller.abort(); release(); await rejected;
  assert.equal(native.pendingWrites(), 0); assert.equal(contents.size, 0);
});

test('production-owned image cache delegates URI resolution without JS image bytes or path I/O', async () => {
  const calls = [], uri = 'file:///app/data/bookmark/article/images/native.png';
  const f = fixture(() => assert.fail('Native resolver owns all path I/O'), async (request, signal) => {calls.push([request, signal]); return {uri, size: 3};});
  const controller = new AbortController();
  assert.equal(await f.cache.ensureImage('article', 'https://images.test/a', async () => assert.fail('Production image bytes must not enter JS'), controller.signal, false), uri);
  assert.equal(calls[0][0].owner, 'owner-a'); assert.equal(calls[0][0].directory, '/app/data'); assert.equal(calls[0][0].strict, false); assert.equal(calls[0][1], controller.signal);
  assert.equal(await f.cache.ensureImage('article', 'https://images.test/a'), uri); assert.equal(calls[1][0].strict, true);
  assert.equal(await f.cache.getResourceUri('article', 'https://images.test/a'), uri); assert.equal(calls[2][0].allowNetwork, false);
  assert.equal(f.native.calls.length, 0); assert.equal(f.contents.size, 0);
});

test('a late native URI cannot escape a revoked cache owner or a cancelled consumer', async () => {
  for (const cancel of [false, true]) {
    let release; const wait = new Promise(resolve => {release = resolve;});
    const f = fixture(undefined, async () => {await wait; return {uri: 'file:///app/data/bookmark/article/images/native.png', size: 3};});
    const controller = new AbortController(), pending = f.cache.ensureImage('article', 'https://images.test/a', undefined, controller.signal);
    const rejected = assert.rejects(pending, cancel ? {name: 'AbortError'} : /revoked/);
    if (cancel) controller.abort(); else f.revoke(); release(); await rejected;
  }
});

test('article fingerprints stay native and a cancelled atomic text commit retains the prior body', async () => {
  const f = fixture(), controller = new AbortController();
  assert.equal(await f.cache.articleFingerprint('doc'), null);
  const fingerprint = await f.cache.contentFingerprint('正文'); assert.equal(fingerprint.size, 6);
  await f.cache.writeArticle('doc', '正文'); assert.deepEqual(await f.cache.articleFingerprint('doc'), fingerprint);
  let release; f.native.waitWrite(new Promise(resolve => {release = resolve;}));
  const work = f.cache.writeArticle('doc', 'replacement', controller.signal), rejected = assert.rejects(work, {name: 'AbortError'});
  for (let index = 0; index < 20 && !f.native.pendingWrites(); index++) await Promise.resolve();
  assert.equal(f.native.pendingWrites(), 1); controller.abort(); release(); await rejected;
  assert.equal(await f.cache.readArticle('doc'), '正文'); assert.equal(f.native.pendingWrites(), 0);
  f.revoke(); await assert.rejects(f.cache.articleFingerprint('doc'), /revoked/);
});
