import type {LibraryBookmark} from './types.ts';
import type {SqlDatabase} from './sql.ts';
import {RowWatcher} from './watch-rows.ts';

type Listener<T> = {next(value: T): void; error?(error: Error): void};
/** A verified account owns the last value and watcher, independently of route focus. */
export class AccountSnapshot<T> {
  private listeners = new Set<Listener<T>>();
  private value?: T;
  private hasValue = false;
  private stopped = false;
  private stop?: () => void;
  private start: (next: (value: T) => void, error: (error: Error) => void) => () => void;
  constructor(start: (next: (value: T) => void, error: (error: Error) => void) => () => void, signal?: AbortSignal) {
    this.start = start;
    signal?.addEventListener('abort', this.dispose, {once: true});
    if (signal?.aborted) this.dispose();
  }
  subscribe(next: (value: T) => void, error?: (error: Error) => void) {
    if (this.stopped) return () => {};
    const listener = {next, error}; this.listeners.add(listener);
    if (this.hasValue) next(this.value!);
    if (!this.stop) this.stop = this.start(value => {
      if (this.stopped) return;
      this.hasValue = true; this.value = value;
      for (const listener of this.listeners) listener.next(value);
    }, reason => {if (!this.stopped) for (const listener of this.listeners) listener.error?.(reason);});
    return () => {this.listeners.delete(listener);};
  }
  dispose = () => {this.stopped = true; this.stop?.(); this.stop = undefined; this.listeners.clear(); this.value = undefined; this.hasValue = false;};
}

const fields = `b.id, b.alias_title, json_extract(b.metadata, '$.bookmark.title') AS title,
 json_extract(b.metadata, '$.bookmark.target_url') AS url, json_extract(b.metadata, '$.bookmark.status') AS status`;
export function libraryQuery(sort: 'inbox' | 'starred' | 'archived', owner?: string) {
  const filter = {inbox: 'b.archive_status = 0', starred: 'b.is_starred = 1', archived: 'b.archive_status = 1'}[sort];
  const order = {inbox: 'b.created_at', starred: 'b.starred_at', archived: 'b.archived_at'}[sort];
  return owner ? {
    table: 'sr_collection_bookmark', where: 'b.owner_id = ?', parameters: [owner],
    sql: `SELECT ${fields}, 1 AS is_starred, 0 AS archive_status FROM sr_collection_bookmark b WHERE b.owner_id = ? ORDER BY coalesce(nullif(b.starred_at, ''), b.created_at) DESC, b.id DESC`,
  } : {
    table: 'sr_user_bookmark', where: `${filter} AND b.deleted_at IS NULL`, parameters: [],
    sql: `SELECT ${fields}, b.is_starred, b.archive_status FROM sr_user_bookmark b WHERE ${filter} AND b.deleted_at IS NULL ORDER BY coalesce(nullif(${order}, ''), b.updated_at) DESC, b.id DESC`,
  };
}
export class LibraryRepository {
  private rows: RowWatcher;
  private feeds = new Map<string, AccountSnapshot<LibraryBookmark[]>>();
  private database: SqlDatabase;
  constructor(database: SqlDatabase) {this.database = database; this.rows = new RowWatcher(database);}
  watch(sort: 'inbox' | 'starred' | 'archived', owner: string | undefined, next: (rows: LibraryBookmark[]) => void, error?: (error: Error) => void) {
    const key = JSON.stringify([sort, owner]);
    let snapshot = this.feeds.get(key);
    if (!snapshot) {
      snapshot = new AccountSnapshot<LibraryBookmark[]>((publish, fail) => {
        const query = libraryQuery(sort, owner);
        let base: Omit<LibraryBookmark, 'downloadStatus'>[] = [], previous: LibraryBookmark[] = [];
        let statuses = new Map<string, number>(), ready = false;
        const update = () => {
          if (!ready) return;
          const byId = new Map(previous.map(row => [row.id, row]));
          const values = base.map(row => {
            const old = byId.get(row.id), downloadStatus = statuses.get(row.id) ?? 0;
            return old && old.downloadStatus === downloadStatus && old.aliasTitle === row.aliasTitle && old.title === row.title && old.url === row.url && old.status === row.status && old.isStarred === row.isStarred && old.archiveStatus === row.archiveStatus ? old : {...row, downloadStatus};
          });
          if (values.length === previous.length && values.every((row, index) => row === previous[index])) return;
          previous = values; publish(values);
        };
        const stopBase = this.rows.watchRows(query.sql, query.parameters, (values: typeof base) => {base = values; ready = true; if (!values.length && !previous.length) publish([]); else update();}, fail,
          row => ({id: String(row.id), aliasTitle: String(row.alias_title ?? ''), title: String(row.title ?? ''), url: String(row.url ?? ''), status: String(row.status ?? ''), isStarred: Number(row.is_starred ?? 0), archiveStatus: Number(row.archive_status ?? 0)}));
        const cacheKey = owner ? "'collection-' || b.owner_id || '-' || b.id" : 'b.id';
        const stopStatus = this.rows.watchRows(`SELECT b.id, coalesce(json_extract(l.data, '$.is_downloaded'), 0) AS status FROM ${query.table} b LEFT JOIN ps_data_local__local_bookmark_info l ON l.id = ${cacheKey} WHERE ${query.where}`, query.parameters,
          (values: {id: string; status: number}[]) => {statuses = new Map(values.map(row => [row.id, row.status])); update();}, fail, row => ({id: String(row.id), status: Number(row.status ?? 0)}));
        return () => {stopBase(); stopStatus();};
      }, this.database.accountSignal);
      this.feeds.set(key, snapshot);
    }
    return snapshot.subscribe(next, error);
  }
}
