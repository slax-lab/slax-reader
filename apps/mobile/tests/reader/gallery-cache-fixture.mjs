import {readFileSync, realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {imageCachePath, imageCacheReadPaths, normalizeImageUrl} from '../../src/data/cache-paths.ts';
import {AccountInactiveError} from '../../src/data/account-lease.ts';
import {throwIfAborted} from '../../src/utils/abort.ts';
import {memoryNativeFileStore} from '../fixtures/native-file-store.mjs';

const require = createRequire(import.meta.url);
const nativeRequire = createRequire(realpathSync(require.resolve('react-native/package.json')));
export const NativeAbortController = nativeRequire('abort-controller').AbortController;

/** Execute the production cache with its native filesystem and containment boundaries replaced. */
export function galleryCacheFixture(resolveImage) {
  const contents = new Map(), native = memoryNativeFileStore(contents);
  class Directory {
    constructor(uri) {this.uri = uri;}
    create() {}
  }
  class File {
    constructor(uri) {this.uri = uri;}
    get exists() {return contents.has(this.uri);}
    get size() {return contents.get(this.uri)?.byteLength ?? 0;}
    get parentDirectory() {return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/')));}
    write(bytes) {contents.set(this.uri, bytes);}
  }
  const filename = new URL('../../src/data/cache.ts', import.meta.url);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(output, {exports, require(name) {
    if (name === 'expo-file-system') return {Directory, File};
    if (name === './cache-paths.ts') return {imageCachePath, imageCacheReadPaths, normalizeImageUrl};
    if (name === './native-file-store.ts') return native;
    if (name === 'expo') return {requireNativeModule() {return {imageCacheFileUri: (directory, _key, path) => `file://${directory}/${path}`};}};
    if (name === '../utils/abort.ts') return {throwIfAborted};
    throw new Error(`Unexpected native cache boundary: ${name}`);
  }}, {filename: filename.pathname});
  const md5 = url => createHash('md5').update(url).digest('hex');
  let active = true;
  const assertActive = () => {if (!active) throw new AccountInactiveError();};
  const cache = new exports.ArticleFileCache('/app/data', md5, assertActive, undefined, resolveImage ? 'owner-a' : null, resolveImage);
  return {cache, contents, isActive: () => active, revoke() {active = false;}, nextAccount() {return new exports.ArticleFileCache('/app/data', md5);}};
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
export const imageResponse = (bytes = [1, 2, 3], {status = 200, type = 'image/png'} = {}) => ({
  ok: status >= 200 && status < 300,
  headers: new Headers(type === null ? {} : {'content-type': type}),
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
});
