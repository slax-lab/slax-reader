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

const flush = () => new Promise(resolve => setImmediate(resolve));

function localFixture(t, overrides = {}) {
  let ready, subscriptions, entries, saved, stopped = 0, active = true, selected = null;
  let sources = [source], rows = [entry], bookmarks = new Map(), savedUrls = [];
  const calls = [];
  const local = {
    connect(onReady) {ready = onReady; return () => {stopped++;};},
    watchSubscriptions(callback) {subscriptions = callback; callback(sources); return () => {stopped++;};},
    watchEntries(id, callback) {selected = id; entries = callback; callback(rows.filter(row => id === null || row.subscription_id === id)); return () => {stopped++;};},
    watchSaved(urls, callback) {savedUrls = urls; saved = callback; callback(new Map([...bookmarks].filter(([url]) => urls.includes(url)))); return () => {stopped++;};},
  };
  const api = {
    rssLabs: async () => ({features: [{key: 'rss', enabled: true}]}),
    rssSubscriptions: async () => {calls.push('subscriptions'); return {items: [source]};},
    rssEntries: async (...args) => {calls.push(args); return page;},
    rssAdd: async () => ({...source, id: 'added'}),
    rssUpdate: async (id, remark) => ({...source, id, remark}),
    rssRemove: async () => ({}),
    rssRefresh: async () => ({status: 'accepted', next_allowed_at: '2026-11-01T00:00:00Z'}),
    rssSave: async () => ({bookmark_user_uuid: 'saved'}),
    ...overrides,
  };
  const controller = new RssController(api, () => Date.parse('2026-10-19T00:00:00Z'), () => active, local);
  controller.activate(); t.after(() => controller.dispose());
  return {controller, api, local, calls, ready: () => ready(), stopped: () => stopped, revoke: () => {active = false;},
    subscriptions: next => {sources = next; subscriptions?.(next);},
    entries: next => {rows = next; entries?.(next.filter(row => selected === null || row.subscription_id === selected));},
    bookmarks: next => {bookmarks = next; saved?.(new Map([...next].filter(([url]) => savedUrls.includes(url))));}, savedUrls: () => savedUrls};
}

test('local RSS keeps REST until first stream sync, then watches without REST list polling', async t => {
  const f = localFixture(t);
  await f.controller.load();
  f.subscriptions([{...source, title: 'Local title'}]);
  f.entries([{...entry, id: 'local'}]);
  assert.equal(f.controller.getSnapshot().entries[0].id, entry.id);
  f.ready();
  assert.equal(f.controller.getSnapshot().entries[0].id, 'local');
  assert.equal(f.controller.getSnapshot().subscriptions[0].title, 'Local title');
  const requests = f.calls.length;
  f.controller.poll(); await f.controller.load(); await f.controller.select(source.id);
  assert.equal(f.calls.length, requests);
});

test('late REST fallback cannot replace a synced local list', async t => {
  let release, started;
  const waiting = new Promise(resolve => {started = resolve;});
  const response = new Promise(resolve => {release = resolve;});
  const f = localFixture(t, {rssEntries: async () => {started(); return response;}});
  const loading = f.controller.load(); await waiting;
  f.entries([{...entry, id: 'local'}]); f.ready();
  release(page); await loading;
  assert.equal(f.controller.getSnapshot().entries[0].id, 'local');
});

test('local RSS overlays confirmed add, rename, refresh, remove and reader saves until sync agrees', async t => {
  const f = localFixture(t); await f.controller.load(); f.ready();
  await f.controller.edit(source.id, 'Renamed');
  f.subscriptions([source]);
  assert.equal(f.controller.getSnapshot().subscriptions[0].remark, 'Renamed');
  assert.equal(f.controller.getSnapshot().entries[0].source_title, 'Renamed');
  f.subscriptions([{...source, remark: 'Renamed'}]);
  f.subscriptions([{...source, remark: 'Later rename'}]);
  assert.equal(f.controller.getSnapshot().subscriptions[0].remark, 'Later rename');
  await f.controller.refresh(source.id);
  assert.equal(f.controller.getSnapshot().subscriptions[0].refreshing, true);
  assert.equal(f.controller.getSnapshot().subscriptions[0].next_allowed_at, '2026-11-01T00:00:00Z');
  f.subscriptions([source]); assert.equal(f.controller.getSnapshot().subscriptions[0].refreshing, true);
  f.subscriptions([{...source, refreshing: true, next_allowed_at: '2026-11-01T00:00:00Z'}]);
  f.subscriptions([{...source, next_allowed_at: '2026-11-01T00:00:00Z'}]);
  assert.equal(f.controller.getSnapshot().subscriptions[0].refreshing, false);
  reportRssSaved(entry.id, 'reader-saved', entry.article_url); f.entries([entry]);
  assert.equal(f.controller.getSnapshot().entries[0].bookmark_user_uuid, 'reader-saved');
  f.entries([{...entry, bookmark_user_uuid: 'reader-saved'}]); f.entries([entry]);
  assert.equal(f.controller.getSnapshot().entries[0].bookmark_user_uuid, null);
  await f.controller.save(entry); f.entries([entry]);
  assert.equal(f.controller.getSnapshot().entries[0].bookmark_user_uuid, 'saved');
  await f.controller.add('https://added.invalid', ''); f.subscriptions([source]);
  assert.equal(f.controller.getSnapshot().selected, 'added');
  assert.equal(f.controller.getSnapshot().subscriptions.length, 2);
  f.subscriptions([source, {...source, id: 'added'}]);
  await f.controller.remove('added');
  f.subscriptions([source, {...source, id: 'added'}]);
  assert.equal(f.controller.getSnapshot().subscriptions.length, 1);
  assert.equal(f.controller.getSnapshot().selected, null);
  f.subscriptions([source]);
  f.subscriptions([source, {...source, id: 'added'}]);
  assert.equal(f.controller.getSnapshot().subscriptions.length, 2, 'Matching removal retires the overlay');
});

test('local pagination uses before once, then cursors, appends deduplicated history and honors retry metadata', async t => {
  const f = localFixture(t); await f.controller.load();
  f.entries([{...entry, sort_at: '2026-10-19T00:00:00Z'}, {...entry, id: 'last', sort_at: '2026-10-18T00:00:00Z'}]); f.ready();
  f.api.rssEntries = async (...args) => {f.calls.push(args); return {...page, items: [{...entry, id: 'last', sort_at: '2026-10-18T00:00:00Z'}, {...entry, id: 'history', sort_at: '2026-10-17T00:00:00Z'}], next_cursor: 'history-cursor'};};
  await f.controller.more();
  assert.equal(f.calls.at(-1)[1], undefined); assert.equal(f.calls.at(-1)[2], true); assert.equal(f.calls.at(-1)[4], 'last');
  assert.deepEqual(Array.from(f.controller.getSnapshot().entries, row => row.id), [entry.id, 'last', 'history']);
  f.api.rssEntries = async (...args) => {f.calls.push(args); return {...page, items: [], next_cursor: 'next', has_more: true, history_status: 'retry', retry_at: '2026-11-01T00:00:00Z'};};
  await f.controller.more();
  assert.equal(f.calls.at(-2)[1], 'history-cursor'); assert.equal(f.calls.at(-2)[2], true); assert.equal(f.calls.at(-2)[4], undefined);
  assert.equal(f.calls.at(-1)[1], undefined); assert.equal(f.calls.at(-1)[2], false); assert.equal(f.calls.at(-1)[4], 'last', 'The expanded window is re-walked from the fixed anchor');
  assert.equal(f.controller.getSnapshot().historyStatus, 'retry');
  const requests = f.calls.length; await f.controller.more(); assert.equal(f.calls.length, requests);
});

test('local callbacks cannot publish after account replacement or disabled lab', async t => {
  const f = localFixture(t); await f.controller.load(); f.ready();
  f.api.rssLabs = async () => ({features: [{key: 'rss', enabled: false}]});
  await f.controller.load();
  assert.equal(f.controller.getSnapshot().enabled, false); assert.equal(f.controller.getSnapshot().entries.length, 0);
  assert.ok(f.stopped() >= 3);
  f.entries([entry]); f.ready(); f.subscriptions([source]);
  assert.equal(f.controller.getSnapshot().entries.length, 0);
  const g = localFixture(t); await g.controller.load(); g.revoke(); g.ready(); g.entries([{...entry, id: 'stale'}]);
  assert.equal(g.controller.getSnapshot().entries[0].id, entry.id);
});

test('writes before the first stream sync keep the REST reload, and a local watch failure falls back to REST', async t => {
  const f = localFixture(t); let failEntries;
  const watchEntries = f.local.watchEntries;
  f.local.watchEntries = (id, callback, onError) => {failEntries = onError; return watchEntries(id, callback, onError);};
  await f.controller.load();
  const before = f.calls.filter(call => call === 'subscriptions').length;
  await f.controller.add('https://added.invalid', '');
  assert.equal(f.calls.filter(call => call === 'subscriptions').length, before + 1);
  f.ready();
  const fallback = f.calls.filter(call => call === 'subscriptions').length;
  failEntries(new Error('watch failed')); await flush();
  assert.equal(f.calls.filter(call => call === 'subscriptions').length, fallback + 1, 'A local failure reloads the REST list');
  assert.equal(f.controller.getSnapshot().error, null, 'A working REST fallback hides the local failure');
  assert.equal(f.controller.getSnapshot().entries[0].id, entry.id);
  const requests = f.calls.length; await f.controller.load();
  assert.ok(f.calls.length > requests, 'REST lists load again after the local source failed');
});

test('a local failure only surfaces an error when the REST fallback also fails', async t => {
  const f = localFixture(t); let failEntries;
  const watchEntries = f.local.watchEntries;
  f.local.watchEntries = (id, callback, onError) => {failEntries = onError; return watchEntries(id, callback, onError);};
  await f.controller.load(); f.ready();
  f.api.rssSubscriptions = async () => {throw new ApiError(503, 'Unavailable', {error: 'source_unavailable'});};
  failEntries(new Error('watch failed'));
  assert.equal(f.controller.getSnapshot().error, null);
  await flush();
  assert.equal(f.controller.getSnapshot().error, 'source_unavailable');
  assert.equal(f.controller.getSnapshot().entries[0].id, entry.id, 'The last list stays visible');
});

test('local add shows the confirmed first REST page and source switches hide other sources at once', async t => {
  const f = localFixture(t); await f.controller.load(); f.ready();
  f.api.rssEntries = async (...args) => {f.calls.push(args); return {...page, items: [{...entry, id: 'added-entry', subscription_id: 'added'}], next_cursor: 'added-cursor'};};
  await f.controller.add('https://added.invalid', '');
  assert.deepEqual(f.calls.at(-1).slice(0, 3), ['added', undefined, false]);
  assert.deepEqual(Array.from(f.controller.getSnapshot().entries, row => row.id), ['added-entry']);
  assert.equal(f.controller.getSnapshot().cursor, 'added-cursor');
  await f.controller.select(null);
  f.local.watchEntries = () => () => {};
  f.entries([entry, {...entry, id: 'other', subscription_id: 'added'}]);
  await f.controller.select(source.id);
  assert.deepEqual(Array.from(f.controller.getSnapshot().entries, row => row.subscription_id), [source.id]);
});

test('local Load more merges REST history into the local timeline across feeds with different cadences', async t => {
  const fast = {...source, id: 'fast', title: 'Daily'}, slow = {...source, id: 'slow', title: 'Monthly'};
  const row = (id, subscription, at, extra = {}) => ({...entry, id, subscription_id: subscription.id, source_title: subscription.title, article_url: `https://fixture.invalid/${id}`, sort_at: at, ...extra});
  const f = localFixture(t); await f.controller.load();
  f.subscriptions([fast, slow]);
  f.entries([row('a1', fast, '2026-10-19T00:00:00Z'), row('a2', fast, '2026-10-18T00:00:00Z'), row('a3', fast, '2026-10-17T00:00:00Z'), row('b1', slow, '2026-10-10T00:00:00Z')]);
  f.ready();
  f.bookmarks(new Map([['https://fixture.invalid/a-old', 'local-bookmark']]));
  const firstPage = {...page, next_cursor: 'after-a-old', items: [
    row('b-history', slow, '2026-10-15T00:00:00Z', {bookmark_user_uuid: 'stale-rest'}),
    row('a3', fast, '2026-10-17T00:00:00Z', {title: 'REST copy'}),
    row('a-old', fast, '2026-10-05T00:00:00Z'),
    {...row('b-old', slow, undefined), published_at: null, first_seen_at: '2026-10-08T00:00:00Z'},
  ]};
  f.api.rssEntries = async (...args) => {f.calls.push(args); return firstPage;};
  await f.controller.more();
  assert.equal(f.calls.at(-1)[4], 'b1', 'The first request anchors on the last displayed local row');
  const ids = () => Array.from(f.controller.getSnapshot().entries, value => value.id);
  assert.deepEqual(ids(), ['a1', 'a2', 'a3', 'b-history', 'b1', 'b-old', 'a-old']);
  const byId = id => f.controller.getSnapshot().entries.find(value => value.id === id);
  assert.notEqual(byId('a3').title, 'REST copy', 'The local row wins over its REST duplicate');
  assert.equal(byId('b-history').bookmark_user_uuid, null, 'REST saved state is ignored in local mode');
  assert.equal(byId('a-old').bookmark_user_uuid, 'local-bookmark');
  assert.deepEqual(Array.from(f.savedUrls()), ['https://fixture.invalid/a-old', 'https://fixture.invalid/a3', 'https://fixture.invalid/b-history', 'https://fixture.invalid/b-old']);
  reportRssSaved('b-history', 'reader-saved', 'https://fixture.invalid/b-history');
  assert.equal(byId('b-history').bookmark_user_uuid, 'reader-saved');
  f.bookmarks(new Map([['https://fixture.invalid/a-old', 'local-bookmark'], ['https://fixture.invalid/b-history', 'reader-saved']]));
  f.bookmarks(new Map([['https://fixture.invalid/a-old', 'local-bookmark']]));
  assert.equal(byId('b-history').bookmark_user_uuid, null, 'The save overlay retires once local bookmarks agree');
  const lastPage = {...page, next_cursor: null, has_more: false, history_status: 'exhausted', items: [
    {...row('a-oldest', fast, undefined), published_at: '2026-10-01T00:00:00Z'},
  ]};
  f.api.rssEntries = async (...args) => {f.calls.push(args); return args[4] === 'b1' ? {...firstPage, cached_more: true} : lastPage;};
  await f.controller.more();
  assert.deepEqual(f.calls.slice(-3).map(call => [call[1], call[2], call[4]]), [['after-a-old', true, undefined], [undefined, false, 'b1'], ['after-a-old', false, undefined]]);
  assert.deepEqual(ids(), ['a1', 'a2', 'a3', 'b-history', 'b1', 'b-old', 'a-old', 'a-oldest']);
  assert.equal(f.controller.getSnapshot().hasMore, false);
});

test('a removal overlay survives a late sync of its own add and retires only after the row disappears', async t => {
  const f = localFixture(t); await f.controller.load(); f.ready();
  const added = {...source, id: 'added'};
  await f.controller.add('https://added.invalid', '');
  await f.controller.remove('added');
  assert.deepEqual(Array.from(f.controller.getSnapshot().subscriptions, row => row.id), [source.id]);
  f.subscriptions([source]);
  f.subscriptions([source, added]);
  assert.deepEqual(Array.from(f.controller.getSnapshot().subscriptions, row => row.id), [source.id], 'The late add must not resurrect the removed row');
  f.subscriptions([source]);
  f.subscriptions([source, added]);
  assert.equal(f.controller.getSnapshot().subscriptions.length, 2, 'Once synced removal was seen, later rows are trusted');
});

test('a rename overlay only replaces the remark and yields to a later synced rename', async t => {
  const synced = {...source, last_success_at: '2026-10-18T00:00:00Z', error: null};
  const f = localFixture(t, {rssUpdate: async (id, remark) => ({...source, id, remark, error: 'source_unavailable', last_success_at: '2026-01-01T00:00:00Z'})});
  f.subscriptions([synced]);
  await f.controller.load(); f.ready();
  await f.controller.edit(source.id, 'Mine');
  f.subscriptions([{...synced, refreshing: true, last_success_at: '2026-10-19T00:00:00Z'}]);
  let row = f.controller.getSnapshot().subscriptions[0];
  assert.equal(row.remark, 'Mine');
  assert.equal(row.refreshing, true); assert.equal(row.error, null); assert.equal(row.last_success_at, '2026-10-19T00:00:00Z');
  assert.equal(f.controller.getSnapshot().entries[0].source_title, 'Mine');
  f.subscriptions([{...synced, remark: 'Other device'}]);
  row = f.controller.getSnapshot().subscriptions[0];
  assert.equal(row.remark, 'Other device', 'A different synced rename wins');
  f.subscriptions([{...synced, remark: 'Other device'}]);
  assert.equal(f.controller.getSnapshot().entries[0].source_title, 'Other device');
  await f.controller.edit(source.id, '  ');
  assert.equal(f.controller.getSnapshot().subscriptions[0].remark, null);
  f.subscriptions([{...synced, remark: null}]); f.subscriptions([{...synced, remark: 'Third'}]);
  assert.equal(f.controller.getSnapshot().subscriptions[0].remark, 'Third', 'A matching sync retires the overlay');
});

test('an admitted RSS cache renders before first sync or Labs and remains usable offline', async t => {
  let resolveLabs;
  const labs = new Promise(resolve => {resolveLabs = resolve;});
  const f = localFixture(t, {rssLabs: () => labs});
  f.local.hasCachedData = async () => true;
  let subscriptionWatches = 0, entryWatches = 0;
  const watchSubscriptions = f.local.watchSubscriptions, watchEntries = f.local.watchEntries;
  f.local.watchSubscriptions = (...args) => {subscriptionWatches++; return watchSubscriptions(...args);};
  f.local.watchEntries = (...args) => {entryWatches++; return watchEntries(...args);};
  assert.equal(await f.controller.load(), true);
  assert.equal(f.controller.getSnapshot().busy, false);
  assert.equal(f.controller.getSnapshot().entries[0].id, entry.id);
  assert.equal(f.controller.getSnapshot().error, null);
  assert.equal(await f.controller.select(source.id), true);
  assert.equal(f.controller.getSnapshot().entries[0].id, entry.id);
  const watchesBeforeSync = [subscriptionWatches, entryWatches];
  f.ready();
  assert.deepEqual([subscriptionWatches, entryWatches], watchesBeforeSync, 'First sync reuses the cache watchers');
  resolveLabs({features: [{key: 'rss', enabled: true}]});
  await flush();
  assert.equal(f.controller.getSnapshot().error, null);
});

test('offline Labs rejection preserves admitted RSS rows and confirmed disable clears them', async t => {
  const f = localFixture(t, {rssLabs: async () => {throw new TypeError('offline');}});
  f.local.hasCachedData = async () => true;
  await f.controller.load();
  await flush();
  assert.equal(f.controller.getSnapshot().entries[0].id, entry.id);
  assert.equal(f.controller.getSnapshot().error, null);
  assert.equal(f.controller.getSnapshot().busy, false);
  f.api.rssLabs = async () => ({features: [{key: 'rss', enabled: false}]});
  await f.controller.load();
  assert.equal(f.controller.getSnapshot().enabled, false);
    assert.equal(f.controller.getSnapshot().entries.length, 0);
    assert.equal(f.controller.getSnapshot().subscriptions.length, 0);
});

test('late cached Labs disable is ignored after cancellation, disposal, or account replacement', async t => {
  for (const lifecycle of ['cancel', 'dispose', 'account replacement']) await t.test(lifecycle, async () => {
    let resolveLabs;
    const labs = new Promise(resolve => {resolveLabs = resolve;});
    const f = localFixture(t, {rssLabs: () => labs});
    f.local.hasCachedData = async () => true;
    await f.controller.load();
    if (lifecycle === 'cancel') f.controller.cancel();
    else if (lifecycle === 'dispose') f.controller.dispose();
    else f.revoke();
    resolveLabs({features: [{key: 'rss', enabled: false}]});
    await flush();
    assert.equal(f.controller.getSnapshot().enabled, true);
  });
});

test('sync-before-REST save retires on a reader event and a later bookmark deletion clears saved state', async t => {
  let resolveSave, started;
  const waiting = new Promise(resolve => {started = resolve;});
  const saveResponse = new Promise(resolve => {resolveSave = resolve;});
  const f = localFixture(t, {rssSave: () => {started(); return saveResponse;}});
  await f.controller.load(); f.ready();
  const saving = f.controller.save(entry);
  await waiting;
  f.entries([{...entry, bookmark_user_uuid: 'synced-bookmark'}]);
  reportRssSaved(entry.id, 'synced-bookmark', entry.article_url);
  resolveSave({bookmark_user_uuid: 'synced-bookmark'});
  await saving;
  assert.equal(f.controller.getSnapshot().entries[0].bookmark_user_uuid, 'synced-bookmark');
  f.entries([entry]);
  assert.equal(f.controller.getSnapshot().entries[0].bookmark_user_uuid, null);
});

test('sync-before-REST rename yields to a later synced remark and keeps current metadata', async t => {
  let resolveRename, started;
  const waiting = new Promise(resolve => {started = resolve;});
  const renameResponse = new Promise(resolve => {resolveRename = resolve;});
  const f = localFixture(t, {rssUpdate: () => {started(); return renameResponse;}});
  const baseline = {...source, remark: 'A', last_success_at: '2026-10-18T00:00:00Z'};
  f.subscriptions([baseline]);
  await f.controller.load(); f.ready();
  const editing = f.controller.edit(source.id, 'Mine');
  await waiting;
  f.subscriptions([{...baseline, remark: 'Mine', last_success_at: '2026-10-19T00:00:00Z', error: null}]);
  resolveRename({...baseline, remark: 'Mine', last_success_at: '2026-01-01T00:00:00Z', error: 'source_unavailable'});
  await editing;
  f.subscriptions([{...baseline, remark: 'Other', last_success_at: '2026-10-20T00:00:00Z', error: null}]);
  const row = f.controller.getSnapshot().subscriptions[0];
  assert.equal(row.remark, 'Other');
  assert.equal(row.last_success_at, '2026-10-20T00:00:00Z');
  assert.equal(row.error, null);
  assert.equal(f.controller.getSnapshot().entries[0].source_title, 'Other');
});

test('sync-before-add response followed by synced deletion does not resurrect the subscription', async t => {
  let resolveAdd, started;
  const waiting = new Promise(resolve => {started = resolve;});
  const addResponse = new Promise(resolve => {resolveAdd = resolve;});
  const added = {...source, id: 'added'};
  const f = localFixture(t, {rssAdd: () => {started(); return addResponse;}});
  await f.controller.load(); f.ready();
  const adding = f.controller.add('https://added.invalid', '');
  await waiting;
  f.subscriptions([source, added]);
  resolveAdd(added);
  await adding;
  assert.ok(f.controller.getSnapshot().subscriptions.some(row => row.id === 'added'));
  f.subscriptions([source]);
  assert.ok(f.controller.getSnapshot().subscriptions.every(row => row.id !== 'added'));
});

test('a refresh already settled in sync before its REST response does not leave a refreshing overlay', async t => {
  let resolveRefresh, started;
  const waiting = new Promise(resolve => {started = resolve;});
  const refreshResponse = new Promise(resolve => {resolveRefresh = resolve;});
  const next = '2026-11-01T00:00:00Z';
  const f = localFixture(t, {rssRefresh: () => {started(); return refreshResponse;}});
  await f.controller.load(); f.ready();
  const refreshing = f.controller.refresh(source.id);
  await waiting;
  f.subscriptions([{...source, refreshing: false, next_allowed_at: next}]);
  resolveRefresh({status: 'accepted', next_allowed_at: next});
  await refreshing;
  assert.equal(f.controller.getSnapshot().subscriptions[0].refreshing, false);
  assert.equal(f.controller.getSnapshot().subscriptions[0].next_allowed_at, next);
});

test('a cached RSS watcher setup exception uses the REST fallback', async t => {
  const f = localFixture(t);
  f.local.hasCachedData = async () => true;
  f.local.watchSubscriptions = () => {throw new Error('watch setup failed');};
  await f.controller.load();
  await flush();
  assert.equal(f.controller.getSnapshot().entries[0].id, entry.id);
  assert.equal(f.controller.getSnapshot().error, null);
  assert.ok(f.calls.includes('subscriptions'));
});

/** Server semantics: `before` lists rows after the anchor plus newer history rows; cursors are plain; history loads only on short pages. */
function timelineServer(rows, batches, limit = 2) {
  const stored = rows.map(row => ({...row})), calls = [];
  const position = row => [row.sort_at, row.id];
  const after = (row, at) => position(row)[0] < at[0] || (position(row)[0] === at[0] && row.id < at[1]);
  const listed = (source, at, anchored) => stored.filter(row => (!source || row.subscription_id === source) && (!at || after(row, at) || (anchored && row.history)))
    .sort((left, right) => right.sort_at.localeCompare(left.sort_at) || (left.id < right.id ? 1 : -1));
  const entries = async (source, cursor, history, _signal, before) => {
    calls.push({cursor, history, before});
    let at = null;
    if (before) {
      const anchor = stored.find(row => row.id === before);
      if (!anchor) throw new ApiError(404, 'Not found', {error: 'not_found'});
      at = position(anchor);
    } else if (cursor) at = JSON.parse(cursor);
    let found = listed(source, at, !!before);
    if (history && found.length <= limit && batches.length) {stored.push(...batches.shift().map(row => ({...row, history: true}))); found = listed(source, at, !!before);}
    const items = found.slice(0, limit), cachedMore = found.length > limit, hasMore = cachedMore || batches.length > 0;
    return {items: items.map(({history: _history, ...row}) => row), next_cursor: hasMore ? (items.length ? JSON.stringify(position(items.at(-1))) : cursor ?? (at && JSON.stringify(at))) : null,
      cached_more: cachedMore, has_more: hasMore, history_status: batches.length ? 'available' : 'exhausted', retry_at: null};
  };
  return {entries, calls, prune: id => stored.splice(stored.findIndex(row => row.id === id), 1)};
}

test('every local Load more re-walks the anchored window so history above the cursor appears in place', async t => {
  const row = (id, at) => ({...entry, id, article_url: `https://fixture.invalid/${id}`, sort_at: at.includes('T') ? `2026-10-${at}` : `2026-10-${at}T00:00:00Z`});
  const local = [row('l1', '19'), row('l2', '18')];
  const server = timelineServer(local, [[row('h1', '17'), row('h2', '16')], [row('above', '18T12:00:00Z'), row('h15', '15')], [row('h3', '14'), row('h4', '13'), row('h5', '12')]]);
  const f = localFixture(t, {rssEntries: server.entries});
  await f.controller.load(); f.entries(local); f.ready(); server.calls.length = 0;
  const ids = () => Array.from(f.controller.getSnapshot().entries, value => value.id);
  const walks = () => server.calls.filter(call => !call.history);

  await f.controller.more();
  assert.deepEqual(server.calls, [{cursor: undefined, history: true, before: 'l2'}], 'The first click anchors on the oldest local row and reuses its page');
  assert.deepEqual(ids(), ['l1', 'l2', 'h1', 'h2']);

  server.calls.length = 0;
  await f.controller.more();
  assert.deepEqual(server.calls[0], {cursor: JSON.stringify(['2026-10-16T00:00:00Z', 'h2']), history: true, before: undefined});
  assert.equal(walks().length, 2, 'The re-walk covers one more page than before');
  assert.equal(walks()[0].before, 'l2', 'The anchor stays fixed');
  assert.deepEqual(ids(), ['l1', 'above', 'l2', 'h1', 'h2', 'h15'], 'History fetched above the cursor is shown in timeline order');

  server.calls.length = 0;
  await f.controller.more();
  assert.equal(walks().length, 3);
  assert.deepEqual(ids(), ['l1', 'above', 'l2', 'h1', 'h2', 'h15', 'h3', 'h4']);

  server.prune('l2'); server.calls.length = 0;
  await f.controller.more();
  assert.deepEqual(walks().map(call => call.before).filter(Boolean), ['l2', 'l1'], 'A pruned anchor is re-anchored to the current oldest local row once');
  assert.equal(server.calls.filter(call => call.history).length, 1, 'The retry does not repeat the history request');
  assert.equal(f.controller.getSnapshot().error, null);
  assert.deepEqual(ids(), ['l1', 'above', 'l2', 'h1', 'h2', 'h15', 'h3', 'h4', 'h5']);
  assert.equal(f.controller.getSnapshot().hasMore, false);
});
