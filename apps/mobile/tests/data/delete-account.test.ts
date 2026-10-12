import test from 'node:test';
import assert from 'node:assert/strict';
import {createMobileApi} from '../../src/data/api.ts';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {SessionChangedError, SessionController} from '../../src/domain/session.ts';
import {deleteCurrentAccount} from '../../src/domain/delete-account.ts';
import {MemoryPreferences} from './helpers.ts';

async function harness() {
  const left: (string | null)[] = [];
  const sessions = new SessionController(new PreferenceStore(new MemoryPreferences({auth_token: 'a-token', user_id: 'a'})), {
    leave: async user => {left.push(user);}, enter: async () => {},
  });
  await sessions.restore();
  return {sessions, left};
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {release = resolve;});
  return {promise, release};
}
function apiFor(sessions: SessionController, fetch: typeof globalThis.fetch) {
  return createMobileApi({baseUrl: 'https://fixture-api.test', platform: 'ios', version: 'test', sessions, fetch});
}

for (const heldPart of ['headers', 'body'] as const) {
  test(`a deletion with held response ${heldPart} cannot sign out the next account`, async () => {
    const {sessions, left} = await harness();
    const started = deferred(), held = deferred();
    const api = apiFor(sessions, async (_url, request) => {
      assert.equal((request?.headers as Record<string, string>).Authorization, 'Bearer a-token');
      started.release();
      if (heldPart === 'headers') {await held.promise; return Response.json({code: 200, data: {canDelete: true}});}
      return new Response(new ReadableStream({start(controller) {
        void held.promise.then(() => {controller.enqueue(new TextEncoder().encode(JSON.stringify({code: 200, data: {canDelete: true}}))); controller.close();});
      }}), {headers: {'Content-Type': 'application/json'}});
    });
    const rejected = assert.rejects(deleteCurrentAccount({api, sessions, signal: new AbortController().signal, isActive: () => true}), SessionChangedError);
    await started.promise; await sessions.accept('b-token', 'b'); held.release(); await rejected;
    assert.equal((await sessions.getSession())?.userId, 'b');
    assert.deepEqual(left, ['a']);
  });
}

test('identical-token same-user relogin revokes the old deletion result', async () => {
  const {sessions, left} = await harness(), started = deferred(), held = deferred();
  const api = apiFor(sessions, async () => {started.release(); await held.promise; return Response.json({code: 200, data: {canDelete: true}});});
  const rejected = assert.rejects(deleteCurrentAccount({api, sessions, signal: new AbortController().signal, isActive: () => true}), SessionChangedError);
  await started.promise; await sessions.accept('a-token', 'a'); held.release(); await rejected;
  assert.equal((await sessions.getSession())?.token, 'a-token'); assert.deepEqual(left, []);
});

test('a stale mounted owner cannot begin deletion using a fresh current session', async () => {
  const {sessions} = await harness(); let sends = 0;
  await sessions.accept('b-token', 'b');
  const api = apiFor(sessions, async () => {sends++; return Response.json({code: 200, data: {canDelete: true}});});
  await assert.rejects(deleteCurrentAccount({api, sessions, signal: new AbortController().signal, isActive: () => false}), SessionChangedError);
  assert.equal(sends, 0); assert.equal((await sessions.getSession())?.userId, 'b');
});

test('a late deletion denial or transport failure cannot publish into a fresh session', async () => {
  for (const failure of [false, true]) {
    const {sessions} = await harness(), started = deferred(), held = deferred();
    const api = apiFor(sessions, async () => {
      started.release(); await held.promise;
      return Response.json({code: failure ? 400 : 200, message: 'old denial', data: {canDelete: false, reason: 'active_subscription'}}, {status: failure ? 400 : 200});
    });
    const rejected = assert.rejects(deleteCurrentAccount({api, sessions, signal: new AbortController().signal, isActive: () => true}), SessionChangedError);
    await started.promise; await sessions.accept('a-token', 'a'); held.release(); await rejected;
    assert.equal((await sessions.getSession())?.userId, 'a');
  }
});

test('server denial retains the session and successful deletion clears its initiating account', async () => {
  const {sessions, left} = await harness(); let allowed = false;
  const api = apiFor(sessions, async () => Response.json({code: 200, data: allowed ? {canDelete: true} : {canDelete: false, reason: 'active_subscription'}}));
  const remove = () => deleteCurrentAccount({api, sessions, signal: new AbortController().signal, isActive: () => true});
  assert.deepEqual(await remove(), {canDelete: false, reason: 'active_subscription'});
  assert.equal((await sessions.getSession())?.userId, 'a'); assert.deepEqual(left, []);
  allowed = true; assert.deepEqual(await remove(), {canDelete: true});
  assert.equal(await sessions.getSession(), null); assert.deepEqual(left, ['a']);
});
