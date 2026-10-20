import type {RssEntry, RssSubscription} from '@slax-reader/contracts';
import type {SqlDatabase} from './sql.ts';
import {RowWatcher} from './watch-rows.ts';
import {parseSourceTimestamp} from '../../utils/source-time.ts';

export interface RssLocalSource {
  hasCachedData?(): Promise<boolean>;
  connect(onReady: () => void, onError: (error: Error) => void): () => void;
  watchSubscriptions(onRows: (rows: RssSubscription[]) => void, onError?: (error: Error) => void): () => void;
  watchEntries(subscriptionId: string | null, onRows: (rows: RssEntry[]) => void, onError?: (error: Error) => void): () => void;
  /** Live bookmark ids for article URLs of rows that did not come from the local window. */
  watchSaved(urls: string[], onRows: (saved: Map<string, string>) => void, onError?: (error: Error) => void): () => void;
}

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const source = String(value), time = parseSourceTimestamp(source), date = Number.isFinite(time) ? new Date(time) : new Date(source);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const requiredIso = (value: unknown): string => iso(value) ?? new Date(0).toISOString();

export class RssRepository implements RssLocalSource {
  private readonly rows: RowWatcher;
  private readonly database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.database = database;
    this.rows = new RowWatcher(database);
  }

  async hasCachedData(): Promise<boolean> {
    return !!await this.database.getOptional<{present: number}>('SELECT 1 AS present FROM sr_rss_subscription LIMIT 1');
  }

  connect(onReady: () => void, onError: (error: Error) => void): () => void {
    const controller = new AbortController();
    let subscription: import('./sql.ts').SqlSyncStreamSubscription | undefined;
    const release = () => {
      controller.abort();
      this.database.accountSignal?.removeEventListener('abort', release);
      try {void Promise.resolve(subscription?.unsubscribe()).catch(() => {});} catch {}
      subscription = undefined;
    };
    this.database.accountSignal?.addEventListener('abort', release, {once: true});
    if (this.database.accountSignal?.aborted) {release(); return release;}
    void (async () => {
      const stream = this.database.syncStream?.('rss_v1');
      if (!stream) throw new Error('PowerSync stream subscriptions are not supported by this database');
      const handle = await stream.subscribe({ttl: 7 * 24 * 60 * 60});
      subscription = handle;
      if (controller.signal.aborted) {release(); return;}
      if (!handle.waitForFirstSync) throw new Error('PowerSync stream first-sync status is unavailable');
      await handle.waitForFirstSync(controller.signal);
      if (!controller.signal.aborted) onReady();
    })().catch(error => {
      if (!controller.signal.aborted) {release(); onError(error instanceof Error ? error : new Error(String(error)));}
    });
    return release;
  }

  watchSubscriptions(onRows: (rows: RssSubscription[]) => void, onError?: (error: Error) => void): () => void {
    let rows: (RssSubscription & {refreshingUntil: number})[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const publish = () => {
      if (stopped || this.database.accountSignal?.aborted) return;
      clearTimeout(timer);
      const now = Date.now();
      onRows(rows.map(({refreshingUntil, ...row}) => ({...row, refreshing: refreshingUntil > now})));
      const next = Math.min(...rows.map(row => row.refreshingUntil).filter(time => time > now));
      if (Number.isFinite(next)) timer = setTimeout(publish, Math.min(next - now + 1, 2147483647));
    };
    const stopWatch = this.rows.watchRows(`
      SELECT s.id, f.feed_url, f.title, s.remark, f.site_url, f.icon_url, f.refreshing_until,
        f.last_checked_at, f.last_success_at, f.next_fetch_at, f.next_allowed_at, f.error
      FROM sr_rss_subscription s
      JOIN sr_rss_feed f ON f.id = s.feed_id
      ORDER BY s.created_at ASC, s.id ASC
    `, [], (values: RssSubscription[]) => {rows = values as (RssSubscription & {refreshingUntil: number})[]; publish();}, onError, row => ({
      id: String(row.id), feed_url: String(row.feed_url ?? ''), title: String(row.title ?? ''),
      remark: row.remark === null || row.remark === undefined ? null : String(row.remark),
      site_url: row.site_url === null || row.site_url === undefined ? null : String(row.site_url),
      icon_url: row.icon_url === null || row.icon_url === undefined ? null : String(row.icon_url),
      refreshing: false, refreshingUntil: Date.parse(iso(row.refreshing_until) ?? ''),
      last_checked_at: iso(row.last_checked_at), last_success_at: iso(row.last_success_at),
      next_fetch_at: requiredIso(row.next_fetch_at), next_allowed_at: requiredIso(row.next_allowed_at),
      error: row.error === null || row.error === undefined || row.error === '' ? null : String(row.error) as RssSubscription['error'],
    }));
    const stop = () => {
      stopped = true; clearTimeout(timer); stopWatch();
      this.database.accountSignal?.removeEventListener('abort', stop);
    };
    this.database.accountSignal?.addEventListener('abort', stop, {once: true});
    if (this.database.accountSignal?.aborted) stop();
    return stop;
  }

  watchEntries(subscriptionId: string | null, onRows: (rows: RssEntry[]) => void, onError?: (error: Error) => void): () => void {
    return this.rows.watchRows(`
      WITH saved AS (
        -- Give the computed join key TEXT affinity so SQLite can index the materialized result.
        SELECT CAST(json_extract(metadata, '$.bookmark.target_url') AS TEXT) AS url, min(id) AS id
        FROM sr_user_bookmark
        WHERE deleted_at IS NULL AND json_extract(metadata, '$.bookmark.target_url') IS NOT NULL
        GROUP BY 1
      )
      SELECT e.id, s.id AS subscription_id,
        COALESCE(NULLIF(s.remark, ''), f.title) AS source_title,
        e.title, e.author, e.summary, e.article_url, e.image_url, e.published_at,
        e.first_seen_at, e.sort_at, saved.id AS bookmark_user_uuid
      FROM sr_rss_entry e
      JOIN sr_rss_subscription s ON s.feed_id = e.feed_id
      JOIN sr_rss_feed f ON f.id = e.feed_id
      LEFT JOIN saved ON saved.url = e.article_url
      WHERE (? IS NULL OR s.id = ?)
      ORDER BY e.sort_at DESC, e.id DESC
    `, [subscriptionId, subscriptionId], onRows, onError, row => {
      const published = iso(row.published_at), firstSeen = requiredIso(row.first_seen_at);
      return {
        id: String(row.id), subscription_id: String(row.subscription_id), source_title: String(row.source_title ?? ''),
        title: String(row.title ?? ''), author: row.author === null || row.author === undefined ? null : String(row.author),
        summary: String(row.summary ?? ''), article_url: row.article_url === null || row.article_url === undefined ? null : String(row.article_url),
        image_url: row.image_url === null || row.image_url === undefined ? null : String(row.image_url),
        published_at: published, first_seen_at: firstSeen, sort_at: iso(row.sort_at) ?? published ?? firstSeen,
        bookmark_user_uuid: row.bookmark_user_uuid === null || row.bookmark_user_uuid === undefined ? null : String(row.bookmark_user_uuid),
      };
    });
  }

  watchSaved(urls: string[], onRows: (saved: Map<string, string>) => void, onError?: (error: Error) => void): () => void {
    return this.rows.watchRows(`
      SELECT json_extract(metadata, '$.bookmark.target_url') AS id, min(id) AS bookmark_id
      FROM sr_user_bookmark
      WHERE deleted_at IS NULL AND json_extract(metadata, '$.bookmark.target_url') IN (SELECT value FROM json_each(?))
      GROUP BY 1
    `, [JSON.stringify(urls)], (rows: {id: string; bookmark_id: string}[]) => onRows(new Map(rows.map(row => [row.id, row.bookmark_id]))), onError,
    row => ({id: String(row.id), bookmark_id: String(row.bookmark_id)}));
  }
}
