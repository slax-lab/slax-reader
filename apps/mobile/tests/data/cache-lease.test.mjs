import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {imageCachePath, imageCacheReadPaths, normalizeImageUrl} from '../../src/data/cache-paths.ts';
import {throwIfAborted} from '../../src/utils/abort.ts';

function fixture(validate = (directory, key, path) => `file://${directory}/${path}`) {
  const contents = new Map(); let readWait = null;
  class Directory {
    constructor(uri) {this.uri = uri;}
    get exists() {return [...contents.keys()].some(key => key.startsWith(`${this.uri}/`));}
    create() {}
    delete() {for (const key of contents.keys()) if (key.startsWith(`${this.uri}/`)) contents.delete(key);}
    list() {return [...contents.keys()].filter(key => key.startsWith(`${this.uri}/`)).map(key => new File(key));}
  }
  class File {
    constructor(uri) {this.uri = uri;}
    get exists() {return contents.has(this.uri);}
    get size() {const value = contents.get(this.uri); return typeof value === 'string' ? value.length : value?.byteLength ?? 0;}
    get parentDirectory() {return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/')));}
    async text() {if (readWait) await readWait; return contents.get(this.uri);}
    write(value) {contents.set(this.uri, value);}
    delete() {contents.delete(this.uri);}
  }
  const filename = new URL('../../src/data/cache.ts', import.meta.url);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(output, {exports, require(name) {
    if (name === 'expo-file-system') return {Directory, File};
    if (name === './cache-paths.ts') return {imageCachePath, imageCacheReadPaths, normalizeImageUrl};
    if (name === 'expo-modules-core') return {requireNativeModule(name) {assert.equal(name, 'SlaxCachePaths'); return {imageCacheFileUri: validate};}};
    if (name === '../utils/abort.ts') return {throwIfAborted};
    throw new Error(`Unexpected cache import ${name}`);
  }}, {filename: filename.pathname});
  const Cache = exports.ArticleFileCache;
  let active = true;
  const cache = new Cache('/app/data', () => 'prepared-hash', () => {if (!active) throw new Error('Account lease revoked');});
  return {cache, contents, revoke() {active = false;}, waitRead(promise) {readWait = promise;}, nextAccount() {return new Cache('/app/data', () => 'prepared-hash');}};
}
test('revoked article cache cannot read, overwrite, measure, or clear the next account', async () => {
  const {cache, revoke, nextAccount} = fixture(); cache.writeArticle('same-id', 'account A'); revoke();
  const next = nextAccount(); next.writeArticle('same-id', 'account B');
  assert.throws(() => cache.writeArticle('same-id', 'late A'), /revoked/);
  assert.throws(() => cache.clearArticles(), /revoked/);
  assert.throws(() => cache.removeArticle('same-id'), /revoked/);
  assert.throws(() => cache.removeImages('same-id'), /revoked/);
  assert.throws(() => cache.articleBytes('same-id'), /revoked/);
  assert.throws(() => cache.imageBytes('same-id'), /revoked/);
  await assert.rejects(cache.readArticle('same-id'), /revoked/);
  await assert.rejects(cache.getResourceUri('same-id', 'https://images.test/a.png'), /revoked/);
  assert.equal(await next.readArticle('same-id'), 'account B');
});
test('a read suspended over logout cannot return the next account document', async () => {
  const {cache, revoke, nextAccount, waitRead} = fixture(); cache.writeArticle('same-id', 'account A');
  let release; waitRead(new Promise(resolve => {release = resolve;}));
  const read = cache.readArticle('same-id'); revoke(); nextAccount().writeArticle('same-id', 'account B'); release();
  await assert.rejects(read, /revoked/);
});
test('a delayed image load commits only while its captured account lease is active', async () => {
  const {cache, revoke, nextAccount, contents} = fixture(); let release;
  const pending = cache.ensureImage('same-id', 'https://images.test/a.png', () => new Promise(resolve => {release = resolve;}));
  revoke(); const next = nextAccount(); await next.ensureImage('same-id', 'https://images.test/a.png', async () => new Uint8Array([2]));
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
