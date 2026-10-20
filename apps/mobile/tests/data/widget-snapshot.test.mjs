import test from 'node:test';
import assert from 'node:assert/strict';
import {BookmarkRepository} from '../../src/data/repositories/bookmarks.ts';
import {RowWatcher} from '../../src/data/repositories/watch-rows.ts';

test('widget projection watches one bounded redacted unread snapshot and maps only count/title/id/time', () => {
  let query, handler;
  const database = {watch(sql, _parameters, next) {query = sql; handler = next;}};
  const snapshots = [];
  const repository = new BookmarkRepository(database, new RowWatcher(database), () => 'id', () => 'now');
  const stop = repository.watchWidgetSnapshot(value => snapshots.push(value));
  assert.match(query, /is_read = 0 AND archive_status = 0 AND deleted_at IS NULL/);
  assert.match(query, /LIMIT 4/);
  assert.doesNotMatch(query, /target_url|description|content|comment|highlight/i);
  handler.onResult({rows: {_array: [
    {kind: 'count', unread_count: 8},
    {kind: 'item', id: 'one', title: 'First', saved_at: '2026-10-01T00:00:00.000Z'},
    {kind: 'item', id: 'two', title: 'Second', saved_at: '2026-10-02T00:00:00.000Z'},
  ]}});
  assert.deepEqual(snapshots, [{unreadCount: 8, suggestions: [
    {id: 'one', title: 'First', savedAt: Date.parse('2026-10-01T00:00:00.000Z')},
    {id: 'two', title: 'Second', savedAt: Date.parse('2026-10-02T00:00:00.000Z')},
  ]}]);
  stop();
});
