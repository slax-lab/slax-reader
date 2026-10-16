import test from 'node:test';
import assert from 'node:assert/strict';
import {PreferenceStore} from '../../src/data/preferences.ts';
import {migrateLegacyPreferences} from '../../src/data/legacy-preferences.ts';
import {SessionController} from '../../src/domain/session.ts';
import {CredentialReadiness} from '../../src/domain/credential-readiness.ts';
import {MemoryPreferences} from './helpers.ts';

const lifecycle = {enter: async () => {}, leave: async () => {}};

test('initialized bootstrap shares one preference read and request-time credentials still observe external updates', async () => {
  const storage = new MemoryPreferences({_slax_preferences_migration_v1: 'accepted', auth_token: 'synthetic-first', user_id: 'account', selected_env: 'BETA'});
  let reads = 0;
  const preferences = new PreferenceStore({read: async () => {reads++; return storage.read();}, compareAndSwap: (revision, values) => storage.compareAndSwap(revision, values)});
  const sessions = new SessionController(preferences, lifecycle);
  let environment: unknown;
  await sessions.restoreLocal(async () => {
    const values = await preferences.read();
    assert.equal(await migrateLegacyPreferences(preferences, {readLegacyPreferences: async () => {assert.fail('Initialized startup must not reimport legacy preferences');}}, values), 'already-migrated');
    environment = values.selected_env;
    return values;
  });
  assert.equal(reads, 1);
  assert.equal(environment, 'BETA');
  assert.equal(sessions.getSnapshot().status, 'authenticated');
  storage.values.auth_token = 'synthetic-extension-update'; storage.revision++;
  assert.equal((await sessions.getSession())?.token, 'synthetic-extension-update');
  assert.equal(reads, 2);
});

test('bootstrap snapshot is acquired inside the serialized identity owner and cannot publish after stop', async () => {
  const storage = new MemoryPreferences({auth_token: 'synthetic', user_id: 'account'}), preferences = new PreferenceStore(storage);
  const sessions = new SessionController(preferences, lifecycle);
  let resume!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => {resume = resolve;});
  const begin = new Promise<void>(resolve => {started = resolve;});
  const restore = sessions.restoreLocal(async () => {const values = await preferences.read(); started(); await gate; return values;});
  const rejected = assert.rejects(restore, /Account changed/);
  await begin; sessions.releaseLocalOwner(); resume(); await rejected;
  assert.equal(sessions.getSnapshot().status, 'loading');
});

test('signed-out initialized bootstrap does not resurrect credentials from the legacy file', async () => {
  const preferences = new PreferenceStore(new MemoryPreferences({_slax_preferences_migration_v1: 'accepted', _slax_sign_out_pending_v1: true, auth_token: 'unusable', user_id: 'account'}));
  const sessions = new SessionController(preferences, lifecycle);
  await sessions.restoreLocal(async () => {
    const values = await preferences.read();
    await migrateLegacyPreferences(preferences, {readLegacyPreferences: async () => {assert.fail('Sign-out cannot restore the legacy account');}}, values);
    return values;
  });
  assert.equal(sessions.getSnapshot().status, 'unauthenticated');
});

test('repeated ready checks preserve snapshot identity and do not notify unchanged consumers', async () => {
  let notifications = 0;
  const readiness = new CredentialReadiness({read: async () => ({token: 'synthetic', userId: 'account', refreshedAt: 1000}), refresh: async () => {assert.fail('Current credentials must not refresh');}, changed() {}, now: () => 1000000});
  readiness.subscribe(() => {notifications++;});
  try {
    await readiness.ensure();
    const snapshot = readiness.getSnapshot();
    for (let i = 0; i < 10; i++) await readiness.ensure();
    assert.equal(readiness.getSnapshot(), snapshot);
    assert.equal(notifications, 1);
  } finally {readiness.pause();}
});
