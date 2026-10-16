import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError, createMobileApi} from '../../src/data/api.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {SessionChangedError, SessionController} from '../../src/domain/session.ts';
import {clearAccountData} from '../../src/data/account-cleanup.ts';
import {createSyncConnector} from '../../src/data/connector.ts';
import {MemoryPreferences, testJwt} from './helpers.ts';

class HeldReadPreferences extends MemoryPreferences {
  private nextRead: {started: () => void; gate: Promise<void>; skip: number} | null = null;
  holdNextRead(skip = 0) {
    let started!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => {started = resolve;});
    const gate = new Promise<void>(resolve => {release = resolve;});
    this.nextRead = {started, gate, skip};
    return {waiting, release};
  }
  override async read() {
    const held = this.nextRead;
    if (held && held.skip > 0) held.skip--;
    else if (held) {this.nextRead = null; held.started(); await held.gate;}
    return super.read();
  }
}

test('a held old-account POST cannot acquire the next account bearer', async () => {
  const storage = new HeldReadPreferences({auth_token: 'a-token', user_id: 'a'});
  const sessions = new SessionController(new PreferenceStore(storage), {leave: async () => {}, enter: async () => {}});
  await sessions.restore();
  const sent: {bearer: string | undefined; body: unknown}[] = [];
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async (_url, request) => {
    sent.push({bearer: (request?.headers as Record<string, string>).Authorization, body: JSON.parse(String(request?.body))});
    return Response.json({code: 200, data: {bmId: 'b-bookmark'}});
  }});
  const held = storage.holdNextRead();
  const oldPost = assert.rejects(api.addBookmarkUrl('https://account-a.example/private-article'), SessionChangedError);
  await held.waiting; await sessions.accept('b-token', 'b'); held.release(); await oldPost;
  assert.deepEqual(sent, []);
  await api.addBookmarkUrl('https://account-b.example/article');
  assert.deepEqual(sent, [{bearer: 'Bearer b-token', body: {target_url: 'https://account-b.example/article'}}]);
});

test('logout and fresh same-user login permanently revoke old request credentials even with identical tokens', async () => {
  const storage = new HeldReadPreferences({auth_token: 'same-token', user_id: 'a'});
  const sessions = new SessionController(new PreferenceStore(storage), {leave: async () => {}, enter: async () => {}});
  await sessions.restore();
  let sends = 0;
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async () => {sends++; return Response.json({code: 200, data: {features: []}});}});
  const held = storage.holdNextRead();
  const oldRequest = assert.rejects(api.rssLabs(), SessionChangedError);
  await held.waiting; await sessions.signOut(); await sessions.accept('same-token', 'a'); held.release(); await oldRequest;
  assert.equal(sends, 0); await api.rssLabs(); assert.equal(sends, 1);
});

test('a pending retry cannot send an old request after account switching', async () => {
  const sessions = new SessionController(new PreferenceStore(new MemoryPreferences({auth_token: 'a-token', user_id: 'a'})), {leave: async () => {}, enter: async () => {}});
  await sessions.restore();
  let sends = 0;
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions,
    sleep: async () => {await sessions.accept('b-token', 'b');},
    fetch: async () => {sends++; return Response.json({}, {status: 503});},
  });
  await assert.rejects(api.rssLabs(), SessionChangedError); assert.equal(sends, 1);
});

test('persisted startup and account-enter API credentials remain usable independently of local presentation', async () => {
  const preferences = new PreferenceStore(new MemoryPreferences({auth_token: 'stored-token', user_id: 'a'}));
  const sent: string[] = [];
  let api!: ReturnType<typeof createMobileApi>;
  const sessions = new SessionController(preferences, {leave: async () => {}, enter: async () => {
    await api.getSyncToken();
  }});
  api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async (_url, request) => {
    sent.push((request?.headers as Record<string, string>).Authorization); return Response.json({code: 200, data: {endpoint: 'https://sync.example', token: 'sync-token'}});
  }});
  await api.getSyncToken(); await sessions.restore();
  assert.deepEqual(sent, ['Bearer stored-token', 'Bearer stored-token']);
  await sessions.signOut(); await sessions.accept('new-token', 'b');
  assert.deepEqual(sent, ['Bearer stored-token', 'Bearer stored-token', 'Bearer new-token']);
});

test('public login does not require a persisted authenticated session', async () => {
  const sessions = new SessionController(new PreferenceStore(new MemoryPreferences()), {leave: async () => {}, enter: async () => {}});
  await sessions.restore();
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async (_url, request) => {
    assert.equal((request?.headers as Record<string, string>).Authorization, undefined); return Response.json({code: 200, data: {token: 'a-token', user_id: 'a'}});
  }});
  assert.deepEqual(await api.login({code: 'synthetic-code', redirect_uri: 'app://login', platform: 'ios', type: 'apple'}), {token: 'a-token', user_id: 'a'});
});

test('public login can retry after local acceptance fails without reopening protected credentials', async () => {
  const storage = new MemoryPreferences(), preferences = new PreferenceStore(storage);
  const sessions = new SessionController(preferences, {leave: async () => {}, enter: async () => {}});
  await sessions.restoreLocal();
  const swap = storage.compareAndSwap.bind(storage);
  storage.compareAndSwap = async () => {throw new Error('Storage unavailable');};
  await assert.rejects(sessions.accept('first-token', 'a'), /Storage unavailable/);
  await assert.rejects(sessions.getSession(), SessionChangedError);
  let sends = 0;
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async (_url, request) => {
    sends++; assert.equal((request?.headers as Record<string, string>).Authorization, undefined);
    return Response.json({code: 200, data: {token: 'retry-token', user_id: 'a'}});
  }});
  const result = await api.login({code: 'synthetic-code', redirect_uri: '', platform: 'ios', type: 'google'});
  await assert.rejects(api.rssLabs(), SessionChangedError); assert.equal(sends, 1);
  storage.compareAndSwap = swap;
  await sessions.accept(result.token, result.user_id);
  assert.equal(sessions.getSnapshot().status, 'authenticated');
  assert.equal((await sessions.getSession())?.token, 'retry-token');
});

test('a public login retry cannot continue after account identity replacement', async () => {
  const sessions = new SessionController(new PreferenceStore(new MemoryPreferences()), {leave: async () => {}, enter: async () => {}});
  await sessions.restoreLocal();
  let sends = 0;
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions,
    sleep: async () => {await sessions.accept('replacement', 'other');},
    fetch: async () => {sends++; return Response.json({}, {status: 503});},
  });
  await assert.rejects(api.login({code: 'synthetic-code', redirect_uri: '', platform: 'ios', type: 'google'}), SessionChangedError);
  assert.equal(sends, 1);
});

test('failed account activation closes credentials and revokes its pending enter request', async () => {
  const storage = new HeldReadPreferences({auth_token: 'a-token', user_id: 'a'});
  let pending!: Promise<void>, held!: ReturnType<HeldReadPreferences['holdNextRead']>, api!: ReturnType<typeof createMobileApi>, sends = 0;
  const sessions = new SessionController(new PreferenceStore(storage), {leave: async () => {}, enter: async () => {
    held = storage.holdNextRead(); pending = assert.rejects(api.rssLabs(), SessionChangedError);
    await held.waiting; throw new Error('Native activation failed');
  }});
  api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async () => {sends++; return Response.json({code: 200, data: {features: []}});}});
  await assert.rejects(sessions.restore(), /Native activation failed/); held.release(); await pending;
  await assert.rejects(sessions.getSession(), SessionChangedError); assert.equal(sends, 0);
});

test('a late refresh cannot overwrite fresh same-user login credentials with an identical prior JWT', async () => {
  const sessions = new SessionController(new PreferenceStore(new MemoryPreferences({auth_token: 'same-token', user_id: 'a', last_refresh_time: '0'})), {leave: async () => {}, enter: async () => {}}, () => 100000);
  await sessions.restore();
  let started!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => {started = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const refreshing = sessions.refreshIfNeeded(async () => {started(); await gate; return 'old-refresh-token';});
  await waiting; await sessions.signOut(); await sessions.accept('same-token', 'a'); release(); await refreshing;
  assert.equal((await sessions.getSession())?.token, 'same-token');
});

test('a late unauthorized response cannot log out a fresh same-user session with an identical JWT', async () => {
  const sessions = new SessionController(new PreferenceStore(new MemoryPreferences({auth_token: 'same-token', user_id: 'a'})), {leave: async () => {}, enter: async () => {}});
  await sessions.restore();
  let started!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => {started = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async () => {
    started(); await gate; return Response.json({message: 'Unauthorized'}, {status: 401});
  }});
  const oldRequest = assert.rejects(api.rssLabs(), error => error instanceof ApiError && error.status === 401);
  await waiting; await sessions.signOut(); await sessions.accept('same-token', 'a'); release(); await oldRequest;
  // Wait behind the API's asynchronous clear attempt rather than depending on a timer.
  await sessions.clearIfMatches('unrelated-token');
  assert.equal((await sessions.getSession())?.token, 'same-token'); assert.equal(sessions.getSnapshot().status, 'authenticated');
});

test('a held connector cache read cannot return fresh same-user credentials to an old connection', async () => {
  const storage = new HeldReadPreferences({auth_token: 'same-token', user_id: 'a'}), preferences = new PreferenceStore(storage);
  const sessions = new SessionController(preferences, {leave: async () => {}, enter: async () => {}});
  await sessions.restore();
  let sends = 0;
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async () => {sends++; return Response.json({code: 200, data: {endpoint: 'https://sync.example', token: 'network-token'}});}});
  const connector = createSyncConnector(api, preferences, sessions, undefined, () => 2000);
  const held = storage.holdNextRead(1), oldCredentials = connector.fetchCredentials();
  await held.waiting; await sessions.signOut(); await sessions.accept('same-token', 'a');
  await preferences.update(values => {values.powersync_token = testJwt('a'); values.powersync_connect_url = 'https://fresh-sync.example'; values.powersync_refresh_time = 1000; values.powersync_api_origin = 'https://api.example'; values.powersync_user_id = 'a';});
  held.release(); assert.equal(await oldCredentials, null); assert.equal(sends, 0);
  assert.deepEqual(await connector.fetchCredentials(), {endpoint: 'https://fresh-sync.example', token: testJwt('a'), expiresAt: new Date(86401000)});
});

test('late connector network credentials cannot overwrite fresh same-user sync cache', async () => {
  const preferences = new PreferenceStore(new MemoryPreferences({auth_token: 'same-token', user_id: 'a'}));
  const sessions = new SessionController(preferences, {leave: async () => {}, enter: async () => {}});
  await sessions.restore();
  let started!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => {started = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async () => {
    started(); await gate; return Response.json({code: 200, data: {endpoint: 'https://old-sync.example', token: 'old-sync-token'}});
  }});
  const connector = createSyncConnector(api, preferences, sessions, undefined, () => 2000), oldCredentials = connector.fetchCredentials();
  await waiting; await sessions.signOut(); await sessions.accept('same-token', 'a');
  await preferences.update(values => {values.powersync_token = 'fresh-cache'; values.powersync_connect_url = 'https://fresh-sync.example';});
  release(); assert.equal(await oldCredentials, null);
  const values = await preferences.read(); assert.equal(values.powersync_token, 'fresh-cache'); assert.equal(values.powersync_connect_url, 'https://fresh-sync.example');
});

test('connector credential CAS retry rejects the expired connection scope', async () => {
  let nextSwap: {started: () => void; gate: Promise<void>} | null = null;
  class HeldSwapPreferences extends MemoryPreferences {
    override async compareAndSwap(revision: number, values: Parameters<MemoryPreferences['compareAndSwap']>[1]) {
      const held = nextSwap; nextSwap = null;
      if (held) {held.started(); await held.gate;}
      return super.compareAndSwap(revision, values);
    }
  }
  const preferences = new PreferenceStore(new HeldSwapPreferences({auth_token: 'same-token', user_id: 'a'}));
  const sessions = new SessionController(preferences, {leave: async () => {}, enter: async () => {}});
  await sessions.restore();
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async () => Response.json({code: 200, data: {endpoint: 'https://old-sync.example', token: testJwt('a', Math.floor(Date.now() / 1000) + 86400, Math.floor(Date.now() / 1000))}})});
  let started!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => {started = resolve;}), gate = new Promise<void>(resolve => {release = resolve;}); nextSwap = {started, gate};
  const oldCredentials = createSyncConnector(api, preferences, sessions).fetchCredentials();
  await waiting; await sessions.signOut(); await sessions.accept('same-token', 'a');
  await preferences.update(values => {values.powersync_token = 'fresh-cache';});
  release(); assert.equal(await oldCredentials, null); assert.equal((await preferences.read()).powersync_token, 'fresh-cache');
});

test('stale 401 cannot clear a refreshed session; API never sends bearer to another origin', async () => {
  const storage = new MemoryPreferences({auth_token: 'older-fixture', user_id: 'u', last_refresh_time: '0'});
  const sessions = new SessionController(new PreferenceStore(storage), {leave: async () => {}, enter: async () => {}}, () => 100000);
  await sessions.restore();
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async (_url, request) => {
    assert.equal((request?.headers as Record<string, string>).Authorization, 'Bearer older-fixture');
    await sessions.refreshIfNeeded(async () => 'newer-fixture');
    return Response.json({message: 'Unauthorized'}, {status: 401});
  }});
  await assert.rejects(api.rssLabs(), error => error instanceof ApiError && error.status === 401);
  assert.equal((await sessions.getSession())?.token, 'newer-fixture');
  await assert.rejects(api.request('https://other.example/'), /relative/);
  await assert.rejects(api.request('//other.example/'), /relative/);
});
test('server and transport errors retry twice, HTTP 400 remains isolated with error data', async () => {
  let calls = 0; const delays: number[] = [];
  const sessions = {getSession: async () => null, clearIfMatches: async () => false};
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'android', version: 'test', sessions, sleep: async ms => {delays.push(ms);}, fetch: async () => {calls++; if (calls === 1) throw new Error('offline'); if (calls === 2) return Response.json({}, {status: 503}); return Response.json({code: 200, message: 'ok', data: {features: []}});}});
  assert.deepEqual(await api.rssLabs(), {features: []}); assert.equal(calls, 3); assert.deepEqual(delays, [1000, 2000]);
  const rejected = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async () => Response.json({message: 'retry later', data: {next_allowed_at: 123}}, {status: 400})});
  await assert.rejects(rejected.rssAdd('https://feed.example'), error => error instanceof ApiError && error.status === 400 && (error.data as {next_allowed_at: number}).next_allowed_at === 123);
});
test('startup API origin selection cannot send requests to the previous environment', async () => {
  const urls: string[] = [];
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions: {getSession: async () => null, clearIfMatches: async () => false}, fetch: async url => {urls.push(String(url)); return Response.json({code: 200, data: {features: []}});}});
  api.setBaseUrl('https://beta.example/');
  await api.rssLabs(); assert.equal(api.options.baseUrl, 'https://beta.example'); assert.deepEqual(urls, ['https://beta.example/v1/user/labs']);
  assert.throws(() => api.setBaseUrl('file:///private/data'), /HTTP/);
  assert.throws(() => api.setBaseUrl('https://user:password@example.com'), /credentials/);
  await assert.rejects(api.request('//api.example/v1/user/labs'), /relative/);
});
test('first-party events preserve the raw source envelope and device headers', async () => {
  const events = [{event_name: 'page_view', occurred_at: '2026-10-10T00:00:00Z', properties: {screen: 'reader'}}];
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'android', version: 'test', sessions: {getSession: async () => null, clearIfMatches: async () => false}, fetch: async (url, request) => {
    assert.equal(String(url), 'https://api.example/events'); assert.deepEqual(JSON.parse(String(request?.body)), {events});
    const headers = request?.headers as Record<string, string>; assert.equal(headers['X-Device-ID'], 'synthetic-device'); assert.equal(headers['X-CLIENT-TYPE'], 'android'); assert.equal(headers['X-CLIENT-VERSION'], 'test');
    return new Response('accepted');
  }});
  await api.sendClientEvents('synthetic-device', events);
});
test('AI streaming preserves split UTF8 and the final line, and abort cancels a pending read', async () => {
  const sessions = {getSession: async () => null, clearIfMatches: async () => false};
  const bytes = new TextEncoder().encode('{"type":"overview","data":{"overview":"中文"}}\r\n{"type":"done","data":{"done":true}}');
  let cancelled = false;
  const api = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async (_url, request) => {
    assert.equal((request?.headers as Record<string, string>).Accept, 'text/event-stream');
    return new Response(new ReadableStream({start(controller) {controller.enqueue(bytes.slice(0, 42)); controller.enqueue(bytes.slice(42)); controller.close();}, cancel() {cancelled = true;}}));
  }});
  const events = [];
  for await (const event of api.streamAi('overview', 'bookmark')) events.push(event);
  assert.deepEqual(events.map(event => event.data), [{overview: '中文'}, {done: true}]);
  const blocking = createMobileApi({baseUrl: 'https://api.example', platform: 'ios', version: 'test', sessions, fetch: async () => new Response(new ReadableStream({cancel() {cancelled = true;}}))});
  const controller = new AbortController(); const iterator = blocking.streamAi('outline', 'b', controller.signal); const pending = iterator.next();
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
  await assert.rejects(pending, error => (error as Error).name === 'AbortError'); assert.equal(cancelled, true);
});
test('account switching waits for cleanup, and CAS retries cannot report stale clear success', async () => {
  const storage = new MemoryPreferences({auth_token: 'a-token', user_id: 'a'}), events: string[] = [];
  const sessions = new SessionController(new PreferenceStore(storage), {leave: async user => {events.push(`leave:${user}`);}, enter: async session => {events.push(`enter:${session.userId}`);}});
  await sessions.restore(); await sessions.accept('b-token', 'b');
  assert.deepEqual(events, ['enter:a', 'leave:a', 'enter:b']);
  storage.beforeSwap = () => {storage.beforeSwap = undefined; storage.values = {auth_token: 'c-token', user_id: 'c'}; storage.revision++;};
  assert.equal(await sessions.clearIfMatches('b-token'), false);
  assert.equal((await sessions.getSession())?.token, 'c-token');
  assert.equal(sessions.getSnapshot().status, 'authenticated');
});
test('interrupted source sign-out clears adopted rows, local data and cache before another account enters', async () => {
  const preferences = new PreferenceStore(new MemoryPreferences({powersync_token: 'stale-a-sync', continue_reading_bookmark: '{"bookmarkId":"a-bookmark"}'}));
  const rows = new Set(['a-bookmark']), localRows = new Set(['a-hidden-local-json']), cache = new Set(['a-cached-article']);
  const events: string[] = [], states: string[] = [];
  let allowCleanup!: () => void, startedCleanup!: () => void;
  const cleanupGate = new Promise<void>(resolve => {allowCleanup = resolve;}), cleanupStarted = new Promise<void>(resolve => {startedCleanup = resolve;});
  const sessions = new SessionController(preferences, {
    async leave(user, clear) {
      assert.equal(user, null); assert.equal(clear, true); startedCleanup(); await cleanupGate;
      await clearAccountData({async disconnectAndClear(options) {
        rows.clear(); if (options?.clearLocal) localRows.clear(); events.push('clear-database');
      }}, {clearArticles() {cache.clear(); events.push('clear-cache');}}, preferences, async () => {events.push('revoke-native-resources');});
    },
    async enter(session) {
      assert.equal(rows.size, 0); assert.equal(localRows.size, 0); assert.equal(cache.size, 0);
      assert.equal((await preferences.read()).continue_reading_bookmark, undefined);
      events.push(`enter:${session.userId}`);
    },
  });
  sessions.subscribe(state => {states.push(state.status);});
  const restoring = sessions.restore(); await cleanupStarted;
  const accepting = sessions.accept('b-token', 'b');
  assert.equal(sessions.getSnapshot().status, 'loading'); assert.deepEqual(events, []);
  allowCleanup(); await restoring; await accepting;
  assert.deepEqual(events, ['revoke-native-resources', 'clear-database', 'clear-cache', 'enter:b']);
  assert.deepEqual(states, ['unauthenticated', 'authenticated']);
  assert.equal((await preferences.read()).powersync_token, undefined);
  assert.equal((await sessions.getSession())?.userId, 'b');
});
test('login without restored authentication cannot bypass failed account cleanup', async () => {
  const preferences = new PreferenceStore(new MemoryPreferences());
  let entering = false;
  const sessions = new SessionController(preferences, {async leave(user, clear) {
    assert.equal(user, null); assert.equal(clear, true); throw new Error('Cleanup failed');
  }, async enter() {entering = true;}});
  await assert.rejects(sessions.accept('b-token', 'b'), /Cleanup failed/);
  assert.equal(entering, false); await assert.rejects(sessions.getSession(), SessionChangedError);
  assert.equal(sessions.getSnapshot().status, 'loading');
});
test('failed native resource revocation prevents clearing and exposing the next account', async () => {
  const preferences = new PreferenceStore(new MemoryPreferences({continue_reading_bookmark: 'old-a'}));
  let databaseCleared = false, cacheCleared = false;
  await assert.rejects(clearAccountData({async disconnectAndClear() {databaseCleared = true;}}, {clearArticles() {cacheCleared = true;}}, preferences, async () => {throw new Error('Native reader still active');}), /Native reader still active/);
  assert.equal(databaseCleared, false); assert.equal(cacheCleared, false);
  assert.equal((await preferences.read()).continue_reading_bookmark, 'old-a');
});
