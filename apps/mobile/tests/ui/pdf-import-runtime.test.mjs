import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import {startPdfHttpFixture} from '../../tooling/pdf-http-fixture.mjs';

const mobile = fileURLToPath(new URL('../../', import.meta.url));
async function host(t, scenario = 'reader-pdf-import') {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'slax-import-runtime-')), modules = new Map(), events = [];
  let dispose = async () => {};
  t.after(async () => {try {await dispose();} finally {fs.rmSync(directory, {recursive: true, force: true});}});
  class Entry {
    constructor(...parts) {this.uri = pathToFileURL(path.join(...parts.map(part => {const value = typeof part === 'object' ? part.uri : part; return value.startsWith('file:') ? fileURLToPath(value) : value;}))).href;}
    get name() {return path.basename(fileURLToPath(this.uri));} get exists() {return fs.existsSync(fileURLToPath(this.uri));}
    delete() {fs.rmSync(fileURLToPath(this.uri), {recursive: true, force: true});}
  }
  class Directory extends Entry {
    get parentDirectory() {return new Directory(path.dirname(fileURLToPath(this.uri)));}
    create() {fs.mkdirSync(fileURLToPath(this.uri), {recursive: true});}
    list() {return fs.readdirSync(fileURLToPath(this.uri), {withFileTypes: true}).map(entry => new (entry.isDirectory() ? Directory : File)(this, entry.name));}
  }
  class File extends Entry {
    get parentDirectory() {return new Directory(path.dirname(fileURLToPath(this.uri)));} get size() {return fs.statSync(fileURLToPath(this.uri)).size;}
    textSync() {return fs.readFileSync(fileURLToPath(this.uri), 'utf8');} async text() {return this.textSync();}
    async bytes() {return new Uint8Array(fs.readFileSync(fileURLToPath(this.uri)));} async arrayBuffer() {return (await this.bytes()).buffer;}
    create() {fs.writeFileSync(fileURLToPath(this.uri), '', {flag: 'wx'});} write(value) {fs.writeFileSync(fileURLToPath(this.uri), value);}
    moveSync(target) {assert.equal(target.exists, false); fs.renameSync(fileURLToPath(this.uri), fileURLToPath(target.uri)); this.uri = target.uri;}
  }
  class Table {constructor(columns) {this.columns = columns;}}
  class Schema {constructor(tables) {this.tables = tables;}}
  class Database {
    constructor(options) {this.db = new DatabaseSync(path.join(options.database.dbLocation, options.database.dbFilename)); this.schema = options.schema; this.listeners = new Set();}
    async init() {for (const [name, table] of Object.entries(this.schema.tables)) this.db.exec(`CREATE TABLE ${name} (id TEXT PRIMARY KEY, ${Object.entries(table.columns).map(([key, type]) => `${key} ${type}`).join(',')})`); this.db.exec('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY,data TEXT)');}
    async getOptional(query, parameters = []) {return this.db.prepare(query).get(...parameters) ?? null;}
    async getAll(query, parameters = []) {return this.db.prepare(query).all(...parameters);}
    async execute(query, parameters = []) {return this.db.prepare(query).run(...parameters);}
    async writeTransaction(work) {const value = await work(this); queueMicrotask(() => {for (const notify of this.listeners) notify();}); return value;}
    watch(query, parameters, handler, {signal}) {const notify = () => {if (!signal.aborted) handler.onResult({rows: {_array: this.db.prepare(query).all(...parameters)}});}; this.listeners.add(notify); signal.addEventListener('abort', () => this.listeners.delete(notify), {once: true}); notify();}
    async close() {this.listeners.clear(); this.db.close();}
    async disconnectAndClear() {for (const name of [...Object.keys(this.schema.tables), 'ps_data_local__local_bookmark_info']) this.db.exec(`DELETE FROM ${name}`);}
  }
  const applicationRoot = path.join(directory, 'com.slax.reader.uifixture');
  const Paths = {cache: new Directory(applicationRoot, 'cache'), document: new Directory(applicationRoot, 'documents')}, appListeners = new Set();
  let resourceOwner = null;
  const storagePath = (root, owner, relative) => {
    const directory = root.startsWith('file:') ? fileURLToPath(root) : root;
    assert.equal(owner, resourceOwner); assert(relative.split('/').every(part => part !== '..'));
    if (relative.startsWith('pdf/')) {assert.equal(directory, applicationRoot); events.push(['pdf-path', relative]); return path.join(applicationRoot, 'files', relative);}
    assert(relative === 'bookmark' || relative.startsWith('bookmark/'));
    assert(directory === applicationRoot || directory.startsWith(path.join(applicationRoot, 'cache/slax-ui-fixtures') + path.sep));
    return path.join(directory, relative);
  };
  const writes = new Map();
  const nativeStorage = {
    beginWrite(owner) {assert.equal(owner, resourceOwner); const id = randomUUID(); writes.set(id, owner); return id;},
    endWrite(owner, id) {if (writes.get(id) === owner) writes.delete(id);},
    writeBlock(root, owner, id, relative, bytes) {return nativeStorage.writeBytes(root, owner, relative, bytes, true, () => {assert.equal(writes.get(id), owner);});},
    async writeText(root, owner, relative, text) {const file = storagePath(root, owner, relative); await fs.promises.mkdir(path.dirname(file), {recursive: true}); await fs.promises.writeFile(file, text); return pathToFileURL(file).href;},
    async readText(root, owner, relative) {const file = storagePath(root, owner, relative); return fs.existsSync(file) ? fs.promises.readFile(file, 'utf8') : null;},
    async writeBytes(root, owner, relative, bytes, versioned, check = () => {}) {
      assert.equal(versioned, true); check(); const entries = `${storagePath(root, owner, relative)}.entries`; await fs.promises.mkdir(entries, {recursive: true});
      const temporary = path.join(entries, `${randomUUID()}.tmp`), target = path.join(entries, 'committed.data');
      try {await fs.promises.writeFile(temporary, bytes); storagePath(root, owner, relative); check(); await fs.promises.rename(temporary, target); return pathToFileURL(target).href;}
      finally {await fs.promises.rm(temporary, {force: true});}
    },
    async readBytes(root, owner, relative, versioned) {assert.equal(versioned, true); const file = `${storagePath(root, owner, relative)}.entries/committed.data`; return fs.existsSync(file) ? new Uint8Array(await fs.promises.readFile(file)) : null;},
    async size(root, owner, relative, versioned) {assert.equal(versioned, true); const file = `${storagePath(root, owner, relative)}.entries/committed.data`; return fs.existsSync(file) ? (await fs.promises.stat(file)).size : null;},
    async list(root, owner, relative, versioned) {
      assert.equal(versioned, true); const directory = storagePath(root, owner, relative), result = [];
      const visit = async (directory, prefix) => {if (!fs.existsSync(directory)) return; for (const entry of await fs.promises.readdir(directory, {withFileTypes: true})) if (entry.isDirectory()) {if (entry.name.endsWith('.entries')) result.push(`${prefix}/${entry.name.slice(0, -8)}`); else await visit(path.join(directory, entry.name), `${prefix}/${entry.name}`);}};
      await visit(directory, relative); return result;
    },
    async remove(root, owner, relative, versioned) {await fs.promises.rm(storagePath(root, owner, relative) + (versioned ? '.entries' : ''), {recursive: true, force: true});},
  };
  function load(filename) {
    filename = path.resolve(filename); if (modules.has(filename)) return modules.get(filename);
    if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
    const exports = {}; modules.set(filename, exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code, {exports, __DEV__: true, URL, Headers, Response, ReadableStream, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, AbortController, TypeError, Error, setTimeout, clearTimeout, console, require(name) {
      if (name === 'expo-file-system') return {Directory, File, Paths};
      if (name === 'expo/fetch') return {fetch: (...args) => {events.push(['expo-fetch']); return fetch(...args);}};
      if (name === 'react-native') return {Platform: {OS: 'android'}, AppState: {currentState: 'active', addEventListener(_event, listener) {appListeners.add(listener); return {remove() {appListeners.delete(listener);}};}}};
      if (name === 'expo') return {uuid: {v4: randomUUID}, requireNativeModule: module => module === 'SlaxStorage' ? nativeStorage : module === 'ExponentConstants' ? {manifest: JSON.stringify({slug: 'slax-reader-ui-fixture', scheme: 'slaxreader-ui-fixture', ios: {bundleIdentifier: 'app.slax.reader.uifixture'}, android: {package: 'com.slax.reader.uifixture'}})} : {imageCacheFileUri: (root, _key, relative) => pathToFileURL(path.join(root, relative)).href, pdfCacheFileUri(root, relative) {assert.equal(fileURLToPath(root), applicationRoot); events.push(['pdf-path', relative]); return pathToFileURL(path.join(applicationRoot, 'files', relative)).href;}}};
      if (name === '@powersync/react-native') return {PowerSyncDatabase: Database, Table, Schema, column: {text: 'TEXT', integer: 'INTEGER'}};
      if (name === '../src/config') return {mobileConfig: {platform: 'android'}};
      if (name === '../src/native/platform') return {activateReaderResources: async owner => {resourceOwner = owner; events.push(['activate', owner]);}, revokeReaderResources: async () => {resourceOwner = null; events.push(['revoke']);}};
      if (name === '@slax-reader/contracts/pdf') return load(path.resolve(mobile, '../../packages/contracts/src/pdf.ts'));
      let target = path.resolve(path.dirname(filename), name); if (!path.extname(target)) target = fs.existsSync(`${target}.ts`) ? `${target}.ts` : path.join(target, 'index.ts'); return load(target);
    }}, {filename}); return exports;
  }
  const bundle = JSON.parse(fs.readFileSync(path.join(mobile, 'fixtures/scenarios.json'), 'utf8'));
  const {createFixtureRuntime} = load(path.join(mobile, 'fixtures/runtime.ts')), {fixtureActions} = load(path.join(mobile, 'src/components/fixture-actions.ts'));
  const payload = structuredClone(bundle.scenarios[scenario].payload), run = await createFixtureRuntime(scenario, payload, 'a'.repeat(64), 'en');
  const deactivate = fixtureActions.activate(run.scopeUri), value = await run.value();
  dispose = async () => {deactivate(); await run.dispose(); assert.equal(appListeners.size, 0);};
  return {run, value, File, Paths, appListeners, events};
}

test('actual fixture runtime seeds a PDF, uses production API/File upload, and publishes only a delayed local bookmark', async t => {
  const h = await host(t), id = 'fixture-pdf-imported';
  assert.equal(h.value.fixtureOnly.nativePdfImport, 'seeded-synthetic-only'); assert.equal(await h.value.repositories.getBookmark(id), null);
  const diagnostic = () => JSON.parse(new h.File(h.run.scopeUri, 'pdf-import.json').textSync());
  const seed = new h.File(diagnostic().seedUri); assert.ok(seed.uri.startsWith(h.Paths.document.uri)); assert.equal(seed.size, diagnostic().expectedBytes);
  const copied = new h.File(h.Paths.cache, 'native-copy.pdf'); copied.parentDirectory.create(); copied.write(await seed.bytes());
  const observed = []; const stop = h.value.repositories.watchRows('SELECT id FROM sr_user_bookmark WHERE id = ?', [id], rows => observed.push(rows.length)); t.after(stop);
  const result = await h.value.api.uploadPdf(copied, 'slax-synthetic-eight-pages.pdf');
  assert.equal(result.bookmark_uid, id); assert.equal(diagnostic().acceptedUploads, 1); assert.equal(diagnostic().synchronization, 'pending');
  assert.equal(await h.value.repositories.getBookmark(id), null); assert.ok(observed.every(size => size === 0));
  const deadline = Date.now() + 4000;
  while (diagnostic().synchronization !== 'published' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(diagnostic().synchronization, 'published'); assert.equal(diagnostic().synchronizationMechanism, 'simulated-local-database'); assert.equal(diagnostic().nativeInteractionVerified, false);
  assert.equal((await h.value.repositories.getBookmark(id)).contentType, 'pdf'); assert.ok(observed.includes(1));
  const descriptor = await h.value.runtime.getPdfMetadata(id);
  assert.equal(descriptor.document_id, diagnostic().expectedSha256);
  assert.equal(new TextDecoder().decode(await h.value.runtime.readPdfRange(id, descriptor, 0, 8)), '%PDF-1.4');
});

test('native-storage scenario runs production file adapter and real queue through partial pause/resume', {timeout: 35000}, async t => {
  const h = await host(t, 'reader-pdf-native-storage'), id = 'fixture-pdf-native';
  await h.run.perform({kind: 'pdf-production-storage'});
  const proof = JSON.parse(new h.File(h.run.scopeUri, 'pdf-production-storage.json').textSync());
  assert.equal(proof.adapter, 'PdfFileStorage'); assert.equal(proof.remove, true); assert.equal(proof.nativeInteractionVerified, false);
  const transport = () => JSON.parse(new h.File(h.run.scopeUri, 'pdf-transport.json').textSync());
  const until = async predicate => {const deadline = Date.now() + 5000; while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(predicate());};
  let completed = false; const fill = h.run.perform({kind: 'pdf-fill-cache'}).then(() => {completed = true;});
  await until(() => transport().rangeEvents.some(event => event.begin === 262144 && event.state === 'requested'));
  for (const listener of h.appListeners) listener('background');
  await until(() => transport().rangeEvents.some(event => event.state === 'aborted'));
  assert.equal(completed, false);
  for (const listener of h.appListeners) listener('active');
  await h.run.perform({kind: 'pdf-cache-status'});
  const partial = JSON.parse(new h.File(h.run.scopeUri, 'pdf-cache-partial.json').textSync());
  assert.equal(partial.storageAdapter, 'PdfFileStorage'); assert.equal(partial.states[0].downloadedBytes, 262144); assert.equal(partial.states[0].complete, false);
  await fill;
  const status = await h.value.runtime.pdfCacheStatus(id); assert.equal(status.complete, true);
  const complete = JSON.parse(new h.File(h.run.scopeUri, 'pdf-cache-complete.json').textSync());
  assert.equal(complete.states[0].downloadedBytes, complete.states[0].totalBytes);
  assert.equal(transport().rangeEvents.filter(event => event.begin === 0 && event.state === 'requested').length, 1);
  assert.ok(h.events.some(event => event[0] === 'pdf-path'));
});

test('HTTP fixture composes real HTTP and production storage and requires native PDF owner context', async t => {
  const server = await startPdfHttpFixture(); t.after(() => server.close());
  const h = await host(t, 'reader-pdf-http'), id = 'fixture-pdf-http';
  assert.equal(h.value.fixtureOnly.pdfNativeOwner, true); assert.equal(h.value.config.apiUrl, 'http://127.0.0.1:8093');
  assert.ok(h.value.nativeResourceOwner); assert.ok(h.value.fixtureOnly.dataDirectory.includes('/slax-ui-fixtures/'));
  const descriptor = await h.value.runtime.getPdfMetadata(id);
  assert.equal(new TextDecoder().decode(await h.value.runtime.readPdfRange(id, descriptor, 0, 8)), '%PDF-1.4');
  assert.ok(h.events.some(event => event[0] === 'expo-fetch')); assert.ok(h.events.some(event => event[0] === 'pdf-path'));
  const evidence = JSON.parse(new h.File(h.run.scopeUri, 'pdf-http.json').textSync());
  assert.equal(evidence.nativeOwnerRequired, true); assert.ok(evidence.events.some(event => event.path === '/v1/bookmark/pdf' && event.status === 206));
  await h.run.perform({kind: 'pdf-http-mode', mode: 'metadata-404'});
  await assert.rejects(h.value.runtime.getPdfMetadata(id), error => error.status === 404);
  await assert.rejects(h.run.perform({kind: 'pdf-network-offline'}), /actual network loss/);
});
