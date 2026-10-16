import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import {Sha256} from '../../src/data/pdf-sha256.ts';
import {assertFixtureScope} from '../../fixtures/isolation.ts';

function load(relative, boundaries, development = true) {
  const filename = new URL(relative, import.meta.url), exports = {};
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports, __DEV__: development, TextEncoder, require(name) {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}}, {filename: filename.pathname}); return exports;
}
function fixture(t, platform = 'android', development = true) {
  const temp = fs.mkdtempSync(path.join(tmpdir(), 'slax-real-pdf-adapter-')); t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  const app = path.join(temp, platform === 'android' ? 'com.slax.reader.uifixture' : 'ios-container');
  const cache = platform === 'android' ? path.join(app, 'cache') : path.join(app, 'Library', 'Caches');
  const expectedRoot = platform === 'android' ? app : path.join(app, 'Library', 'Application Support');
  const storageRoot = platform === 'android' ? path.join(app, 'files') : expectedRoot;
  const canCreate = value => platform !== 'android' || [storageRoot, cache].some(root => value === root || value.startsWith(root + path.sep));
  const scope = pathToFileURL(path.join(cache, 'slax-ui-fixtures', 'reader-pdf-native-storage-one')).href;
  fs.mkdirSync(fileURLToPath(scope), {recursive: true});
  const markerPath = path.join(fileURLToPath(scope), 'slax-fixture.json');
  const marker = {controlledFixture: true, fixtureVersion: 1, scenario: 'reader-pdf-native-storage', inputSha256: 'a'.repeat(64)};
  fs.writeFileSync(markerPath, JSON.stringify(marker));
  const state = {config: {slug: 'slax-reader-ui-fixture', scheme: 'slaxreader-ui-fixture', ios: {bundleIdentifier: 'app.slax.reader.uifixture'}, android: {package: 'com.slax.reader.uifixture'}}, deny: false, active: true, calls: [], moves: 0};
  class Entry {
    constructor(...parts) {this.uri = pathToFileURL(path.join(...parts.map(part => {const value = typeof part === 'object' ? part.uri : part; return value.startsWith('file:') ? fileURLToPath(value) : value;}))).href;}
    get name() {return path.basename(fileURLToPath(this.uri));} get exists() {return fs.existsSync(fileURLToPath(this.uri));}
    get parentDirectory() {return new Directory(path.dirname(fileURLToPath(this.uri)));}
    delete() {fs.rmSync(fileURLToPath(this.uri), {recursive: true});}
  }
  class Directory extends Entry {create() {if (!canCreate(fileURLToPath(this.uri))) throw new Error("Missing 'WRITE' permission"); fs.mkdirSync(fileURLToPath(this.uri), {recursive: true});} list() {return fs.readdirSync(fileURLToPath(this.uri), {withFileTypes: true}).map(entry => new (entry.isDirectory() ? Directory : File)(this, entry.name));}}
  class File extends Entry {
    get size() {return fs.statSync(fileURLToPath(this.uri)).size;} textSync() {return fs.readFileSync(fileURLToPath(this.uri), 'utf8');}
    async bytes() {return new Uint8Array(fs.readFileSync(fileURLToPath(this.uri)));} create() {fs.writeFileSync(fileURLToPath(this.uri), '', {flag: 'wx'});} write(value) {fs.writeFileSync(fileURLToPath(this.uri), value);}
    moveSync(target, options) {assert.equal(options, undefined); assert.equal(target.exists, false); fs.renameSync(fileURLToPath(this.uri), fileURLToPath(target.uri)); this.uri = target.uri; state.moves++;}
  }
  const admitted = (root, relative) => {
    state.calls.push({root, relative});
    if (state.deny || fileURLToPath(root) !== expectedRoot || !relative.startsWith('pdf/') || relative.split('/').some(part => part === '..')) throw new Error('Unsafe PDF cache path');
    return path.join(storageRoot, relative);
  };
  const nativeStorage = {
    async writeBytes(root, _owner, relative, bytes, versioned) {
      assert.equal(versioned, true); const entries = `${admitted(root, relative)}.entries`; fs.mkdirSync(entries, {recursive: true});
      const target = path.join(entries, 'committed.data'), temporary = path.join(entries, 'pending.tmp');
      await fs.promises.writeFile(temporary, bytes); await fs.promises.rename(temporary, target); state.moves++; return pathToFileURL(target).href;
    },
    async readBytes(root, _owner, relative, versioned) {assert.equal(versioned, true); const file = `${admitted(root, relative)}.entries/committed.data`; return fs.existsSync(file) ? new Uint8Array(await fs.promises.readFile(file)) : null;},
    async size(root, _owner, relative, versioned) {assert.equal(versioned, true); const file = `${admitted(root, relative)}.entries/committed.data`; return fs.existsSync(file) ? (await fs.promises.stat(file)).size : null;},
    async list(root, _owner, relative, versioned) {
      assert.equal(versioned, true); const directory = admitted(root, relative), result = [];
      const visit = async (directory, prefix) => {if (!fs.existsSync(directory)) return; for (const entry of await fs.promises.readdir(directory, {withFileTypes: true})) if (entry.isDirectory()) {if (entry.name.endsWith('.entries')) result.push(`${prefix}/${entry.name.slice(0, -8)}`); else await visit(path.join(directory, entry.name), `${prefix}/${entry.name}`);}};
      await visit(directory, relative); return result;
    },
    async remove(root, _owner, relative, versioned) {await fs.promises.rm(admitted(root, relative) + (versioned ? '.entries' : ''), {recursive: true, force: true});},
  };
  const native = {requireNativeModule(name) {
    if (name === 'ExponentConstants') return {manifest: platform === 'android' ? JSON.stringify(state.config) : state.config};
    assert.equal(name, 'SlaxStorage'); return nativeStorage;
  }};
  const expo = {Directory, File, Paths: {cache: new Directory(cache)}};
  const abort = load('../../src/utils/abort.ts', {});
  const {NativeFileStore} = load('../../src/data/native-file-store.ts', {'expo-modules-core': native, '../utils/abort.ts': abort});
  const {PdfFileStorage} = load('../../src/data/pdf-file-storage.ts', {'./native-file-store.ts': {NativeFileStore}, './pdf-sha256.ts': {Sha256}});
  const {createFixtureProductionPdfStorage} = load('../../fixtures/pdf-production-storage.ts', {'expo-file-system': expo, 'expo-modules-core': native, 'react-native': {Platform: {OS: platform}}, '../src/data/pdf-file-storage': {PdfFileStorage}, '../src/data/pdf-sha256': {Sha256}, './isolation': {assertFixtureScope}}, development);
  return {state, marker, markerPath, scope, expectedRoot, storageRoot, Directory, PdfFileStorage, create: () => createFixtureProductionPdfStorage(scope, () => {if (!state.active) throw new Error('Account revoked');})};
}

for (const platform of ['android', 'ios']) test(`${platform} diagnostic executes actual PdfFileStorage and cleanup cannot touch a neighboring namespace`, async t => {
  const f = fixture(t, platform), adapter = f.create();
  assert.ok(adapter.storage instanceof f.PdfFileStorage);
  if (platform === 'android') assert.throws(() => new f.Directory(f.expectedRoot, 'pdf/new.entries').create(), /Missing 'WRITE' permission/);
  const neighbor = path.join(f.storageRoot, 'pdf/v1/foreign-namespace/keep.data'); fs.mkdirSync(path.dirname(neighbor), {recursive: true}); fs.writeFileSync(neighbor, 'foreign');
  const result = await adapter.diagnose();
  assert.equal(result.adapter, 'PdfFileStorage'); assert.equal(result.writeRead, true); assert.equal(result.replacement, true); assert.equal(result.remove, true); assert.equal(f.state.moves, 2);
  assert.ok(f.state.calls.length > 10); assert.ok(f.state.calls.every(call => call.relative.startsWith(adapter.prefix.slice(0, -1))));
  await adapter.storage.writeAtomic(`${adapter.prefix}doc/manifest.json`, new Uint8Array([1]));
  assert.equal(fs.existsSync(path.join(f.storageRoot, adapter.prefix, 'doc/manifest.json.entries')), true);
  f.state.active = false; await adapter.cleanup();
  assert.equal(fs.existsSync(path.join(f.storageRoot, adapter.prefix)), false); assert.equal(fs.readFileSync(neighbor, 'utf8'), 'foreign');
});

for (const invalid of ['release', 'production-app', 'marker', 'scenario', 'native-path']) test(`production adapter fixture rejects ${invalid} without writes`, async t => {
  const f = fixture(t, 'android', invalid !== 'release');
  if (invalid === 'production-app') f.state.config.android.package = 'com.slax.reader';
  if (invalid === 'marker') fs.writeFileSync(f.markerPath, JSON.stringify({...f.marker, controlledFixture: false}));
  if (invalid === 'scenario') fs.writeFileSync(f.markerPath, JSON.stringify({...f.marker, scenario: 'reader-pdf'}));
  if (invalid === 'native-path') {const adapter = f.create(); f.state.deny = true; await assert.rejects(adapter.diagnose(), /Unsafe PDF cache path/);} else assert.throws(f.create);
  assert.equal(f.state.moves, 0);
});

test('fixture identity is revalidated before cleanup rather than trusting a stale marker', t => {
  const f = fixture(t), adapter = f.create(); f.state.config.ios.bundleIdentifier = 'app.slax.reader';
  assert.throws(() => adapter.cleanup(), /isolated fixture/); assert.equal(f.state.calls.length, 0);
});
