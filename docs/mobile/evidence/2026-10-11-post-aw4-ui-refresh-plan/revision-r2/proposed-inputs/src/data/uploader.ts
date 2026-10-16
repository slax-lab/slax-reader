import { ApiError } from './api.ts';
import type { SyncChange } from './api.ts';

export type SqlRow = Record<string, string | number | null>;
export interface CrudOperation { table: string; id: string; op: string; opData?: SqlRow | null; previousValues?: SqlRow | null }
export interface PendingTransaction { crud: CrudOperation[]; transactionId?: number | string; complete(): Promise<void> }
export interface CrudQueue { getCrudTransactions(): AsyncIterable<PendingTransaction> }
export interface UploadResult { uploaded: number; rejected: number }
function rowStrings(row: SqlRow): Record<string, string | null> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null ? null : String(value)]));
}
interface Metadata { tags: string[]; share: Record<string, unknown> | null; bookmark: Record<string, unknown> }
function parseMetadata(value: string | null): Metadata {
  const metadata = JSON.parse(value ?? '') as Metadata;
  if (!Array.isArray(metadata.tags) || metadata.tags.some(tag => typeof tag !== 'string') || !metadata.bookmark) throw new Error('Invalid bookmark metadata');
  for (const key of ['uuid', 'title', 'byline', 'status', 'host_url', 'site_name', 'target_url', 'description', 'content_icon', 'published_at', 'content_cover']) {
    if (typeof metadata.bookmark[key] !== 'string') throw new Error('Invalid bookmark metadata');
  }
  if (typeof metadata.bookmark.content_word_count !== 'number') throw new Error('Invalid bookmark metadata');
  const share = metadata.share ?? null;
  if (share) {
    for (const key of ['uuid', 'created_at', 'share_code']) if (typeof share[key] !== 'string') throw new Error('Invalid share settings');
    for (const key of ['is_enable', 'show_line', 'show_comment', 'show_userinfo']) if (typeof share[key] !== 'boolean') throw new Error('Invalid share settings');
  }
  return {...metadata, share};
}
function encodedShare(share: Metadata['share']) {
  if (!share) return 'null';
  const result: Record<string, unknown> = {};
  // Match Kotlin serialization order and default omission when a share is added/removed.
  for (const key of ['uuid', 'is_enable', 'show_line', 'allow_line', 'created_at', 'share_code', 'show_comment', 'allow_comment', 'show_userinfo']) {
    if ((key === 'allow_line' || key === 'allow_comment') && !share[key]) continue;
    result[key] = share[key];
  }
  return JSON.stringify(result);
}
export function diffChanges(data?: SqlRow | null, previous?: SqlRow | null): Pick<SyncChange, 'data' | 'preData'> {
  if (!data) return {data: null, preData: null};
  const next = rowStrings(data);
  if (!previous) return {data: next, preData: null};
  const prior = rowStrings(previous);
  const changes: Record<string, string | null> = {};
  const before: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(next)) {
    const old = prior[key] ?? null;
    if (value === old) continue;
    if (key !== 'metadata') { changes[key] = value; before[key] = old; continue; }
    try {
      const a = parseMetadata(value), b = parseMetadata(old);
      if (JSON.stringify(a.tags) !== JSON.stringify(b.tags)) { changes['metadata.tags'] = JSON.stringify(a.tags); before['metadata.tags'] = JSON.stringify(b.tags); }
      if (a.share && b.share) {
        for (const field of ['is_enable', 'show_line', 'show_comment', 'show_userinfo', 'share_code', 'created_at']) {
          if (a.share[field] !== b.share[field]) { changes[`metadata.share.${field}`] = String(a.share[field]); before[`metadata.share.${field}`] = String(b.share[field]); }
        }
      } else if (a.share !== b.share) { changes['metadata.share'] = encodedShare(a.share); before['metadata.share'] = encodedShare(b.share); }
    } catch { changes.metadata = value; before.metadata = old; }
  }
  return {data: Object.keys(changes).length ? changes : null, preData: Object.keys(before).length ? before : null};
}
export function transactionChanges(transactions: PendingTransaction[]): SyncChange[] {
  return transactions.flatMap(transaction => transaction.crud.map(entry => ({table: entry.table, id: entry.id, op: entry.op, ...diffChanges(entry.opData, entry.previousValues)})));
}
/** Completes only in queue order. A non-400 failure retains the failed and following transactions. */
export async function uploadPendingTransactions(queue: CrudQueue, upload: (changes: SyncChange[]) => Promise<unknown>, sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): Promise<UploadResult> {
  const transactions: PendingTransaction[] = [];
  for await (const transaction of queue.getCrudTransactions()) { transactions.push(transaction); if (transactions.length >= 100) break; }
  const result = {uploaded: 0, rejected: 0};
  const batches: PendingTransaction[][] = [];
  let current: PendingTransaction[] = [], count = 0;
  for (const transaction of transactions) {
    if (count > 0 && count + transaction.crud.length > 20) { batches.push(current); current = []; count = 0; }
    current.push(transaction); count += transaction.crud.length;
  }
  if (current.length) batches.push(current);
  for (let index = 0; index < batches.length; index++) {
    if (index) await sleep(200);
    const batch = batches[index]!;
    try { await upload(transactionChanges(batch)); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 400) throw error;
      for (const transaction of batch) {
        try { await upload(transactionChanges([transaction])); result.uploaded++; }
        catch (isolated) { if (!(isolated instanceof ApiError) || isolated.status !== 400) throw isolated; result.rejected++; }
        await transaction.complete();
      }
      continue;
    }
    for (const transaction of batch) { await transaction.complete(); result.uploaded++; }
  }
  return result;
}
