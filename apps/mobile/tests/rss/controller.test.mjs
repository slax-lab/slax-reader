import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {SlaxApi, ApiError} from '../../src/data/api.ts';
import {SessionController} from '../../src/domain/session.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {MemoryPreferences} from '../data/helpers.ts';
import {throwIfAborted} from '../../src/utils/abort.ts';
import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const code = ts.transpileModule(await readFile(new URL('../../src/rss/controller.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const exported = {};
const nativeRequire = createRequire(realpathSync(fileURLToPath(new URL('../../node_modules/react-native/package.json', import.meta.url))));
const NativeAbortController = nativeRequire('abort-controller/dist/abort-controller').AbortController;
vm.runInNewContext(code, {exports: exported, AbortController: NativeAbortController, Date, URL, Set, Map, require: name => {
  if (name === '../utils/abort.ts') return {throwIfAborted};
  assert.equal(name, '../data/api'); return {ApiError};
}});
const {RssController, reportRssSaved} = exported;
const source = {id: 'fixture-feed', title: 'Synthetic feed', remark: null, last_success_at: '2026-10-10T00:00:00Z', next_allowed_at: '2026-10-09T00:00:00Z', refreshing: false};
const entry = {id: 'fixture-entry', subscription_id: source.id, source_title: source.title, article_url: 'https://fixture.invalid/article', bookmark_user_uuid: null};
const page = {items: [entry], next_cursor: 'fixture-cursor', cached_more: false, has_more: true, history_status: 'available', retry_at: null};
const envelope = data => new Response(JSON.stringify({code: 200, message: '', data}), {status: 200});

async function fixture(heldRoute) {
  let owner = 0;
  const sessions = new SessionController(new PreferenceStore(new MemoryPreferences()), {leave: async () => {owner++;}, enter: async () => {owner++;}});
  await sessions.accept('fixture-token-a', 'fixture-user-a');
  const capturedOwner = owner;
  let release, markStarted, hold = true;
  const pending = new Promise(resolve => {release = resolve;});
  const started = new Promise(resolve => {markStarted = resolve;});
  const calls = [];
  const api = new SlaxApi({baseUrl: 'https://fixture-api.invalid', platform: 'android', version: 'fixture', sessions, fetch: async (value, init) => {
    const url = new URL(value), path = url.pathname, history = url.searchParams.get('fetch_history') === '1';
    calls.push({path, history, authorization: init.headers.Authorization});
    if (hold && ((heldRoute === 'load' && path === '/v1/user/labs') || (heldRoute === 'history' && history) || (heldRoute === 'save' && path.endsWith('/save')))) {
      hold = false; markStarted(); await pending;
    }
    if (path === '/v1/user/labs') return envelope({features: [{key: 'rss', enabled: true}]});
    if (path === '/v1/rss/subscriptions') return envelope({items: [source]});
    if (path === '/v1/rss/entries') return envelope(page);
    if (path.endsWith('/save')) return envelope({bookmark_user_uuid: init.headers.Authorization === 'Bearer fixture-token-b' ? 'fresh-bookmark' : 'old-bookmark'});
    throw new Error(`Unprepared RSS request: ${path}`);
  }});
  const old = new RssController(api, Date.now, () => owner === capturedOwner);
  old.activate();
  return {sessions, old, api, calls, started, release, getOwner: () => owner};
}

test('RSS chained load/history cannot continue under a later account', async t => {
  for (const route of ['load', 'history']) await t.test(route, async () => {
    const f = await fixture(route);
    try {
      if (route === 'history') assert.equal(await f.old.load(), true);
      const pending = route === 'load' ? f.old.load() : f.old.more();
      await f.started;
      await f.sessions.accept('fixture-token-b', 'fixture-user-b');
      const before = f.calls.length;
      f.release();
      assert.equal(await pending, false);
      assert.equal(f.calls.length, before, 'The cancelled run must not start subscription/page follow-up requests');
      assert.equal(f.old.getSnapshot().error, null);
      assert.equal(await f.old.load(), false, 'A stale mounted owner cannot initiate a new account request');
      assert.equal(f.calls.length, before);
    } finally {f.release(); f.old.dispose();}
  });
});

test('late RSS save cannot publish its old bookmark into a new account feed', async t => {
  for (const identicalCredentials of [false, true]) await t.test(identicalCredentials ? 'identical-token fresh session' : 'different account', async () => {
    const f = await fixture('save');
    let fresh;
    try {
      assert.equal(await f.old.load(), true);
      const pending = f.old.save(f.old.getSnapshot().entries[0]);
      await f.started;
      await f.sessions.accept(identicalCredentials ? 'fixture-token-a' : 'fixture-token-b', identicalCredentials ? 'fixture-user-a' : 'fixture-user-b');
      const freshOwner = f.getOwner();
      fresh = new RssController(f.api, Date.now, () => f.getOwner() === freshOwner);
      fresh.activate(); assert.equal(await fresh.load(), true);
      f.release();
      assert.equal(await pending, false);
      assert.equal(fresh.getSnapshot().entries[0].bookmark_user_uuid, null);
      assert.equal(fresh.getSnapshot().error, null);
      assert.equal(f.old.getSnapshot().error, null);
      if (identicalCredentials) {
        assert.equal(f.old.getSnapshot().busy, false, 'Revoked work must release busy state for the current owner');
        assert.equal(await f.old.load(), true, 'The same owner can start a new run with its fresh session');
      } else {
        reportRssSaved(entry.id, 'fresh-bookmark', entry.article_url);
        assert.equal(fresh.getSnapshot().entries[0].bookmark_user_uuid, 'fresh-bookmark');
        assert.equal(f.old.getSnapshot().entries[0].bookmark_user_uuid, null, 'Old subscribers must ignore the new account save');
      }
    } finally {f.release(); f.old.dispose(); fresh?.dispose();}
  });
});
