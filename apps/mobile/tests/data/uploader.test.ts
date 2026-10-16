import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError} from '../../src/data/api.ts';
import {diffChanges, uploadPendingTransactions} from '../../src/data/uploader.ts';
import type {PendingTransaction} from '../../src/data/uploader.ts';

const bookmark = {uuid: 'b', title: 'title', byline: '', status: 'success', host_url: '', site_name: '', target_url: '', description: '', content_icon: '', published_at: '', content_cover: '', content_word_count: 0};
const share = {uuid: 's', is_enable: true, show_line: true, allow_line: false, created_at: 'now', share_code: 'code', show_comment: true, allow_comment: false, show_userinfo: true};
test('metadata diff matches source fields and falls back to complete raw malformed metadata', () => {
  const old = JSON.stringify({tags: ['a'], share, bookmark});
  const next = JSON.stringify({tags: ['a', 'b'], share: {...share, show_line: false, allow_line: true}, bookmark: {...bookmark, title: 'changed server detail'}});
  assert.deepEqual(diffChanges({metadata: next, is_starred: 1}, {metadata: old, is_starred: 0}), {data: {'metadata.tags': '["a","b"]', 'metadata.share.show_line': 'false', is_starred: '1'}, preData: {'metadata.tags': '["a"]', 'metadata.share.show_line': 'true', is_starred: '0'}});
  assert.deepEqual(diffChanges({metadata: '{invalid'}, {metadata: old}), {data: {metadata: '{invalid'}, preData: {metadata: old}});
  assert.deepEqual(diffChanges(null, {is_starred: 1}), {data: null, preData: null});
  assert.deepEqual(diffChanges({metadata: JSON.stringify({tags: [], bookmark})}, {metadata: JSON.stringify({tags: [], bookmark: {...bookmark, title: 'different'}})}), {data: null, preData: null});
});
function queue(counts: number[]) {
  const completed: number[] = [];
  const transactions: PendingTransaction[] = counts.map((count, i) => ({transactionId: i, crud: Array.from({length: count}, (_, n) => ({table: 'sr_user_bookmark', id: `${i}:${n}`, op: 'PATCH', opData: {is_starred: 1}})), complete: async () => {completed.push(i);}}));
  return {completed, async *getCrudTransactions() {yield* transactions;}};
}
test('batches count operations, keep large transactions whole, pace, and complete in order', async () => {
  const source = queue([12, 9, 25, 1]); const sizes: number[] = [], delays: number[] = [];
  assert.deepEqual(await uploadPendingTransactions(source, async changes => {sizes.push(changes.length);}, async ms => {delays.push(ms);}), {uploaded: 4, rejected: 0});
  assert.deepEqual(sizes, [12, 9, 25, 1]); assert.deepEqual(delays, [200, 200, 200]); assert.deepEqual(source.completed, [0, 1, 2, 3]);
});
test('repeated isolated 400 rejects only its transaction; retryable failure retains it and following transactions', async () => {
  const source = queue([1, 1, 1]); const attempts: string[][] = [];
  const result = await uploadPendingTransactions(source, async changes => {
    const ids = changes.map(change => change.id); attempts.push(ids);
    if (ids.includes('1:0')) throw new ApiError(400, 'invalid fixture');
  });
  assert.deepEqual(result, {uploaded: 2, rejected: 1}); assert.deepEqual(source.completed, [0, 1, 2]); assert.deepEqual(attempts, [['0:0', '1:0', '2:0'], ['0:0'], ['1:0'], ['2:0']]);
  const retry = queue([20, 1, 1]);
  await assert.rejects(uploadPendingTransactions(retry, async changes => {if (changes[0]?.id === '1:0') throw new ApiError(503, 'unavailable');}, async () => {}));
  assert.deepEqual(retry.completed, [0]);
});
test('one invocation consumes at most 100 transactions', async () => {
  const source = queue(Array(101).fill(1)); await uploadPendingTransactions(source, async () => {}, async () => {}); assert.equal(source.completed.length, 100);
});
