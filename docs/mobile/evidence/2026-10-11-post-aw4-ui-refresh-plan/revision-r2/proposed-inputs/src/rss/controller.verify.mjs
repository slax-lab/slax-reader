import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

class ApiError extends Error { constructor(status, message, data) {super(message); this.status = status; this.data = data;} }
const code = ts.transpileModule(await readFile(new URL('./controller.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const nativeRequire = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/react-native/package.json', import.meta.url))));
const NativeAbortController = nativeRequire('abort-controller/dist/abort-controller').AbortController;
assert.equal(typeof new NativeAbortController().signal.throwIfAborted, 'undefined');
const abortExports = {};
const abortCode = ts.transpileModule(await readFile(new URL('../utils/abort.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(abortCode, {exports: abortExports, AbortController: NativeAbortController, Error, setTimeout, clearTimeout});
const exports = {};
vm.runInNewContext(code, {exports, AbortController: NativeAbortController, Date, URL, Set, Map, require: name => {
  if (name === '../utils/abort.ts') return abortExports;
  assert.equal(name, '../data/api'); return {ApiError};
}});
const {RssController, reportRssSaved} = exports;
const source = {id: 'source', title: 'Original', remark: null, last_success_at: '2026-10-10T00:00:00Z', next_allowed_at: '2026-10-09T00:00:00Z', refreshing: false};
const entry = id => ({id, subscription_id: source.id, source_title: source.title, article_url: `https://example.test/${id}`, bookmark_user_uuid: null});
let time = Date.parse('2026-10-10T00:00:00Z'), requests = [];
const api = {
  rssLabs: async () => ({features: [{key: 'rss', enabled: true}]}),
  rssSubscriptions: async () => ({items: [source]}),
  rssEntries: async (selected, cursor, fetchHistory) => {
    requests.push({selected, cursor, fetchHistory});
    return cursor ? {items: [entry('old')], next_cursor: null, cached_more: false, has_more: false, history_status: 'exhausted', retry_at: null} : {items: [entry('new')], next_cursor: 'cursor', cached_more: true, has_more: true, history_status: 'available', retry_at: null};
  },
  rssUpdate: async (_id, remark) => ({...source, remark}),
  rssSave: async () => ({bookmark_user_uuid: 'saved'}),
};
const controller = new RssController(api, () => time);
controller.activate();
assert.equal(await controller.load(), true);
assert.deepEqual(Array.from(controller.getSnapshot().entries, item => item.id), ['new']);
requests = [];
assert.equal(await controller.more(), true);
assert.deepEqual(requests.map(item => item.fetchHistory), [true, false, false], 'History fetch must be explicit, then re-read the expanded window');
assert.equal(requests[1].cursor, undefined);
assert.deepEqual(Array.from(controller.getSnapshot().entries, item => item.id), ['new', 'old']);
requests = [];
await controller.select('source');
requests = [];
await controller.select(null);
assert.equal(requests.length, 0, 'A fresh source cache must preserve its expanded window');
await controller.edit('source', 'Renamed');
assert(controller.getSnapshot().entries.every(item => item.source_title === 'Renamed'));
reportRssSaved('new', 'saved', 'https://example.test/new');
assert.equal(controller.getSnapshot().entries[0].bookmark_user_uuid, 'saved');
await controller.select('source');
assert.equal(controller.getSnapshot().entries[0].bookmark_user_uuid, 'saved', 'Saved state must update inactive cached lists');
requests = []; time += 60001; await controller.select(null);
assert.equal(requests.length, 2, 'Expired caches must reload all previously loaded pages');
controller.dispose();

let resolveLate;
const late = new RssController({...api, rssLabs: () => new Promise(resolve => {resolveLate = resolve;})});
late.activate();
const pending = late.load(); late.cancel(); resolveLate({features: [{key: 'rss', enabled: true}]});
assert.equal(await pending, false);
assert.equal(late.getSnapshot().enabled, false, 'A cancelled account-bound response must not populate state');
assert.equal(late.getSnapshot().error, null, 'Cancellation must not surface a transport error'); late.dispose();

const disabled = new RssController({...api, rssEntries: async () => {throw new ApiError(403, 'Forbidden', {error: 'lab_disabled'});}});
disabled.activate();
await disabled.load();
assert.equal(disabled.getSnapshot().enabled, false);
assert.equal(disabled.getSnapshot().entries.length, 0);
assert.equal(disabled.getSnapshot().error, 'lab_disabled'); disabled.dispose();
console.log('RSS verification passed: expanded history, source cache/expiry, rename/save propagation, cancellation, disabled-lab reset.');
