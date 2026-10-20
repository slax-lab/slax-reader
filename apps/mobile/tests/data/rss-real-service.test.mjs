import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {initialSeedSql, stopOwned, validateCheckpointInput, validateControlInput, validateRunId} from './rss-real-service.mjs';

test('real RSS service seed covers shared and owner-only feeds, excluded history, and a preserved bookmark', () => {
  const sql = initialSeedSql();
  for (const expected of [
    'rss-local-user-a', 'rss-local-user-b',
    'rss-local-feed-shared', 'rss-local-feed-b-only',
    'rss-local-sub-a', 'rss-local-sub-b', 'rss-local-sub-b-only',
    'rss-local-entry-live', 'rss-local-entry-history', 'rss-local-entry-b-only',
    'Owner A private remark', 'Owner B private remark', 'Owner B-only remark',
    'History must not sync', 'Preserved RSS bookmark',
  ]) assert(sql.includes(expected), `seed is missing ${expected}`);
  assert.match(sql, /'rss-local-entry-history'[\s\S]*?'History must not sync'[\s\S]*?,TRUE\)/);
  assert.match(sql, /INSERT INTO sr_user_bookmark/);
});

test('run IDs are bounded synthetic labels', () => {
  assert.equal(validateRunId('rss-localfirst-20261020'), 'rss-localfirst-20261020');
  for (const invalid of ['', '../other', 'a'.repeat(65), 'rss local']) assert.throws(() => validateRunId(invalid));
});

test('cleanup safely accepts an already-removed task-owned temp directory', () => {
  assert.doesNotThrow(() => stopOwned(path.join(tmpdir(), 'slax-rss-real-service-deadbeef')));
});

test('cleanup accepts the system-temp symlink spelling but still requires an owned marker', () => {
  const directory = path.join(tmpdir(), `slax-rss-real-service-${randomBytes(8).toString('hex')}`);
  mkdirSync(directory);
  try {
    writeFileSync(path.join(directory, 'service-owner.json'), JSON.stringify({kind: 'slax-controlled-rss-real-service', version: 1,
      runId: 'cleanup-test', prefix: 'slax-rss-cleanup-test', containers: [], volumes: [], networks: []}));
    const symlinkSpelling = existsSync('/private/var') && directory.startsWith('/var/') ? directory.replace(/^\/var\//, '/private/var/') : directory;
    stopOwned(symlinkSpelling);
    assert.equal(existsSync(directory), false);
  } finally {rmSync(directory, {recursive: true, force: true});}
});

test('checkpoint receipts accept only bounded observations for the authenticated owner', () => {
  const input = {name: 'owner-isolation', owner: 'a', firstSync: true, rssSubscriptions: 1, rssEntries: 1, bookmarks: 1, otherOwnerRows: 0, historyRows: 0, ownRemarkVisible: true, otherRemarkVisible: false, liveEntryVisible: true};
  assert.deepEqual(validateCheckpointInput(input, 'a'), input);
  assert.throws(() => validateCheckpointInput({...input, owner: 'b'}, 'a'));
  assert.throws(() => validateCheckpointInput({...input, rssEntries: 1000}, 'a'));
  assert.throws(() => validateCheckpointInput({...input, sql: 'select *'}, 'a'));
  const empty = {...input, name: 'fresh-empty', firstSync: false, rssSubscriptions: 0, rssEntries: 0, bookmarks: 0, otherOwnerRows: 0, historyRows: 0, ownRemarkVisible: false, otherRemarkVisible: false, liveEntryVisible: false};
  assert.deepEqual(validateCheckpointInput(empty, 'a'), empty);
  assert.throws(() => validateCheckpointInput({...empty, rssEntries: 1}, 'a'));
  assert.throws(() => validateCheckpointInput({...empty, firstSync: true}, 'a'));
  assert.throws(() => validateCheckpointInput(empty, 'b'));
});

test('local controls expose only bounded known operations and fields', () => {
  const runId = 'rss-localfirst-20261020';
  assert.equal(validateControlInput({runId, operation: 'set-labs', enabled: false}, 'a', runId), 'set-labs');
  assert.equal(validateControlInput({runId, operation: 'update-remark', remark: 'Updated'}, 'a', runId), 'update-remark');
  assert.equal(validateControlInput({runId, operation: 'update-entry', title: 'Updated', summary: 'Updated summary'}, 'a', runId), 'update-entry');
  assert.equal(validateControlInput({runId, operation: 'set-sync-available', available: true}, 'a', runId), 'set-sync-available');
  assert.equal(validateControlInput({runId, operation: 'set-api-available', available: false}, 'a', runId), 'set-api-available');
  assert.equal(validateControlInput({runId, operation: 'disconnect'}, 'a', runId), 'disconnect');
  assert.throws(() => validateControlInput({runId, operation: 'update-remark', remark: 'No'}, 'b', runId));
  assert.throws(() => validateControlInput({runId, operation: 'set-sync-available', available: true}, 'b', runId));
  assert.throws(() => validateControlInput({runId, operation: 'set-api-available', available: false}, 'b', runId));
  assert.throws(() => validateControlInput({runId, operation: 'sql', query: 'DELETE'}, 'a', runId));
  assert.throws(() => validateControlInput({runId, operation: 'set-labs', enabled: false, userId: 890002}, 'a', runId));
  assert.throws(() => validateControlInput({runId: 'another-run', operation: 'disconnect'}, 'a', runId));
});
