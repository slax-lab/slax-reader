import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, renameSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import {Sha256} from '../../src/data/pdf-sha256.ts';
import {assertFixtureScope} from '../../fixtures/isolation.ts';

async function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'slax-pdf-storage-test-'));
  const scope = pathToFileURL(path.join(root, 'slax-ui-fixtures', 'run-1')).href;
  mkdirSync(fileURLToPath(scope), {recursive: true});
  const marker = path.join(fileURLToPath(scope), 'slax-fixture.json');
  writeFileSync(marker, JSON.stringify({controlledFixture: true, fixtureVersion: 1}));
  const state = {asyncMoves: [], syncMoves: [], failures: [], pending: [], failMove: false, active: true, afterWrite: null};
  t.after(async () => {await Promise.allSettled(state.pending); rmSync(root, {recursive: true, force: true});});
  class Entry {
    constructor(...parts) {this.uri = pathToFileURL(path.join(...parts.map(part => {const value = typeof part === 'object' ? part.uri : part; return value.startsWith('file:') ? fileURLToPath(value) : value;}))).href;}
    get name() {return path.basename(fileURLToPath(this.uri));}
    get exists() {return existsSync(fileURLToPath(this.uri));}
    delete() {rmSync(fileURLToPath(this.uri), {recursive: true});}
  }
  class Directory extends Entry {
    create() {mkdirSync(fileURLToPath(this.uri), {recursive: true});}
    list() {return readdirSync(fileURLToPath(this.uri), {withFileTypes: true}).map(entry => new (entry.isDirectory() ? Directory : File)(this, entry.name));}
  }
  const relocate = (file, target, options) => {
    if (options?.overwrite && target.exists) target.delete();
    if (state.failMove) throw new Error('Native move failed');
    if (target.exists) throw new Error('Native destination already exists');
    renameSync(fileURLToPath(file.uri), fileURLToPath(target.uri));
    file.uri = target.uri;
  };
  class File extends Entry {
    get parentDirectory() {return new Directory(path.dirname(fileURLToPath(this.uri)));}
    get size() {return statSync(fileURLToPath(this.uri)).size;}
    textSync() {return readFileSync(fileURLToPath(this.uri), 'utf8');}
    async bytes() {return new Uint8Array(readFileSync(fileURLToPath(this.uri)));}
    create() {writeFileSync(fileURLToPath(this.uri), '', {flag: 'wx'});}
    write(bytes) {writeFileSync(fileURLToPath(this.uri), bytes); state.afterWrite?.();}
    move(target, options) {
      state.asyncMoves.push({source: this.uri, target: target.uri, options});
      const pending = new Promise((resolve, reject) => setImmediate(() => {try {relocate(this, target, options); resolve();} catch (error) {reject(error);}}));
      state.pending.push(pending); void pending.catch(error => state.failures.push(error)); return pending;
    }
    moveSync(target, options) {state.syncMoves.push({source: this.uri, target: target.uri, options}); relocate(this, target, options);}
  }
  const exports = {}, filename = new URL('../../fixtures/pdf-storage.ts', import.meta.url);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  let counter = 0;
  const boundaries = {'expo-file-system': {Directory, File, Paths: {cache: new Directory(root)}}, 'expo-modules-core': {uuid: {v4: () => `test-${++counter}`}}, '../src/data/pdf-sha256': {Sha256}, './isolation': {assertFixtureScope}};
  vm.runInNewContext(code, {exports, TextEncoder, require(name) {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}}, {filename: filename.pathname});
  const storage = new exports.FixturePdfStorage(scope, () => {if (!state.active) throw new Error('Fixture account revoked');});
  return {storage, state, scope, marker, files: () => readdirSync(fileURLToPath(scope), {recursive: true}).filter(name => statSync(path.join(fileURLToPath(scope), name)).isFile())};
}
const logical = 'pdf/v1/account/bookmark/manifest.json';

test('fixture atomic write uses the synchronous Expo commit, not an unawaited asynchronous move', async t => {
  const f = await fixture(t);
  await f.storage.writeAtomic(logical, new Uint8Array([1, 2, 3]));
  await Promise.allSettled(f.state.pending);
  assert.equal(f.state.asyncMoves.length, 0, 'Expo File.move is asynchronous; committing must not race temporary cleanup');
  assert.equal(f.state.syncMoves.length, 1); assert.equal(f.state.syncMoves[0].options?.overwrite, undefined);
  assert.deepEqual(await f.storage.read(logical), new Uint8Array([1, 2, 3]));
  assert.deepEqual(f.state.failures, []); assert.equal(f.files().some(name => name.endsWith('.tmp')), false);
});

test('a failed replacement move leaves the old committed fixture bytes readable', async t => {
  const f = await fixture(t);
  await f.storage.writeAtomic(logical, new Uint8Array([7])); f.state.failMove = true;
  await assert.rejects(f.storage.writeAtomic(logical, new Uint8Array([8])), /Native move failed/);
  assert.deepEqual(await f.storage.read(logical), new Uint8Array([7]));
  assert.ok(f.state.syncMoves.every(move => move.options?.overwrite !== true));
  assert.equal(f.files().some(name => name.endsWith('.tmp')), false);
  assert.deepEqual(Array.from(await f.storage.list('pdf/v1/account/')), [logical]);
});

test('successful generations expose logical paths, sizes and deletion rather than staging files', async t => {
  const f = await fixture(t);
  await f.storage.writeAtomic(logical, new Uint8Array([1]));
  await f.storage.writeAtomic(logical, new Uint8Array([2, 3]));
  assert.deepEqual(await f.storage.read(logical), new Uint8Array([2, 3])); assert.equal(await f.storage.size(logical), 2);
  const moves = f.state.syncMoves; assert.notEqual(moves[0].target, moves[1].target);
  assert.equal(f.files().filter(name => name.endsWith('.data')).length, 1);
  assert.deepEqual(Array.from(await f.storage.list('pdf/')), [logical]);
  await f.storage.remove(logical); assert.equal(await f.storage.read(logical), null); assert.equal(await f.storage.size(logical), null);
  assert.deepEqual(Array.from(await f.storage.list('pdf/')), []);
});

test('marked fixture ownership and path checks still gate every storage operation', async t => {
  const f = await fixture(t);
  for (const candidate of ['pdf/../outside', 'pdf//block', '/pdf/block', 'pdf/%2fescape', 'bookmark/block']) await assert.rejects(f.storage.writeAtomic(candidate, new Uint8Array([1])), /Unsafe fixture PDF path/);
  await f.storage.writeAtomic(logical, new Uint8Array([9]));
  writeFileSync(f.marker, JSON.stringify({controlledFixture: false, fixtureVersion: 1}));
  await assert.rejects(f.storage.read(logical), /Controlled fixture marker/);
  await assert.rejects(f.storage.writeAtomic(logical, new Uint8Array([0])), /Controlled fixture marker/);
  await assert.rejects(f.storage.remove(logical), /Controlled fixture marker/);
  await assert.rejects(f.storage.list('pdf/'), /Controlled fixture marker/);
  assert.throws(() => f.storage.clear(), /Controlled fixture marker/);
  assert.equal(f.state.syncMoves.length, 1);
});

test('revoking an account after staging prevents commit and preserves its old generation', async t => {
  const f = await fixture(t);
  await f.storage.writeAtomic(logical, new Uint8Array([4]));
  const committed = fileURLToPath(f.state.syncMoves[0].target);
  f.state.afterWrite = () => {f.state.active = false;};
  await assert.rejects(f.storage.writeAtomic(logical, new Uint8Array([5])), /revoked/);
  assert.equal(f.state.syncMoves.length, 1); assert.deepEqual([...readFileSync(committed)], [4]);
  await assert.rejects(f.storage.read(logical), /revoked/);
});
