import type { MarkPathItem, MarkPathApprox } from '@slax-reader/contracts/interface';

export interface SqlTransaction {
  execute(sql: string, parameters?: unknown[]): Promise<unknown>;
  getOptional<T>(sql: string, parameters?: unknown[]): Promise<T | null>;
}
export interface SqlDatabase extends SqlTransaction {
  getAll<T>(sql: string, parameters?: unknown[]): Promise<T[]>;
  writeTransaction<T>(work: (transaction: SqlTransaction) => Promise<T>): Promise<T>;
  watch(sql: string, parameters: unknown[], handler: {onResult: (result: {rows?: {_array: Record<string, unknown>[]}}) => void; onError?: (error: Error) => void}, options: {signal: AbortSignal}): void;
}
export interface BookmarkRecord {
  id: string; userId: string; ownerId?: string; aliasTitle: string; title: string; url: string; status: string;
  createdAt: string; updatedAt: string; archiveStatus: number; isStarred: number; isRead: number;
  metadata: string | null; downloadStatus: number; isAutoCached: boolean;
}
export interface TagRecord { id: string; tag_name: string; display: string; source: string; created_at: string; last_used_at?: string | null }
export interface CollectionRecord {
  id: string; code: string; name: string; avatar: string; description: string; ownerId: string;
  type: number; status: number; subscriptionEndTime: string; subscribedAt: string; isCancelled: boolean;
  lastReadAt: string; latestArticleAt: string; hasNew: boolean;
}
export interface MarkRecord {
  id: string; user_bookmark_uuid: string; type: number; source: string; comment: string; approx_source: string;
  content: string; is_deleted: number; created_at: string; metadata: string;
}
export interface CollectionMarkPolicy { isCollection: boolean; showMarks: boolean; allowLine: boolean; allowComment: boolean; showProfile: boolean }
export const PERSONAL_MARK_POLICY: CollectionMarkPolicy = {isCollection: false, showMarks: true, allowLine: true, allowComment: true, showProfile: true};
export const PENDING_COLLECTION_MARK_POLICY: CollectionMarkPolicy = {isCollection: true, showMarks: false, allowLine: false, allowComment: false, showProfile: false};
export function collectionMarkPolicy(share: Record<string, unknown> | null, settings: {allow_highlight: boolean; show_highlight: boolean; allow_access: boolean} = {allow_highlight: false, show_highlight: true, allow_access: true}): CollectionMarkPolicy {
  const enabled = Boolean(share?.is_enable ?? settings.allow_access);
  return {isCollection: true, showMarks: enabled && Boolean(share?.show_line ?? settings.show_highlight) && Boolean(share?.show_comment ?? settings.show_highlight), allowLine: enabled && Boolean(share?.allow_line ?? settings.allow_highlight), allowComment: enabled && Boolean(share?.allow_comment ?? settings.allow_highlight), showProfile: enabled && Boolean(share?.show_userinfo ?? true)};
}
export interface SelectionContent { type: string; text: string; src: string }
export interface CreateMarkInput {
  bookmarkId: string; userId: string; type: number; source?: MarkPathItem[]; approxSource?: MarkPathApprox | null;
  selectContent?: SelectionContent[]; comment?: string; rootId?: string | null; parentId?: string | null; markPolicy: CollectionMarkPolicy;
}
const text = (value: unknown) => typeof value === 'string' ? value : '';
function bookmark(row: Record<string, unknown>): BookmarkRecord {
  return {id: text(row.id), userId: text(row.user_id), ...(row.owner_id ? {ownerId: text(row.owner_id)} : {}), aliasTitle: text(row.alias_title), title: text(row.metadata_title), url: text(row.metadata_url), status: text(row.metadata_status), createdAt: text(row.created_at), updatedAt: text(row.updated_at), archiveStatus: Number(row.archive_status ?? 0), isStarred: Number(row.is_starred ?? 0), isRead: Number(row.is_read ?? 0), metadata: typeof row.metadata === 'string' ? row.metadata : null, downloadStatus: Number(row.download_status ?? 0), isAutoCached: Number(row.is_auto_cached ?? 1) === 1};
}
export function bookmarkDisplayTitle(record: BookmarkRecord) { return (record.aliasTitle.trim() || record.title.trim() || record.url || record.id.slice(0, 5)).replace(/\s+/g, ' ').trim(); }
const bookmarkColumns = `b.*, json_extract(b.metadata, '$.bookmark.title') AS metadata_title, json_extract(b.metadata, '$.bookmark.target_url') AS metadata_url, json_extract(b.metadata, '$.bookmark.status') AS metadata_status, coalesce(json_extract(l.data, '$.is_downloaded'), 0) AS download_status, json_extract(l.data, '$.is_auto_cached') AS is_auto_cached`;
export class MobileRepositories {
  readonly database: SqlDatabase;
  readonly local: LocalBookmarkRepository;
  private uuid: () => string;
  private now: () => string;
  constructor(database: SqlDatabase, uuid: () => string, now = () => new Date().toISOString()) { this.database = database; this.uuid = uuid; this.now = now; this.local = new LocalBookmarkRepository(database); }
  watchRows<T>(sql: string, parameters: unknown[], onRows: (rows: T[]) => void, onError?: (error: Error) => void, mapper?: (row: Record<string, unknown>) => T): () => void {
    const controller = new AbortController();
    this.database.watch(sql, parameters, {onResult: result => onRows((result.rows?._array ?? []).map(row => mapper ? mapper(row) : row as T)), onError}, {signal: controller.signal});
    return () => controller.abort();
  }
  watchBookmarks(sort: 'inbox' | 'starred' | 'archived', onRows: (rows: BookmarkRecord[]) => void, onError?: (error: Error) => void) {
    const filters = {inbox: ['b.archive_status = 0', 'b.created_at'], starred: ['b.is_starred = 1', 'b.starred_at'], archived: ['b.archive_status = 1', 'b.archived_at']} as const;
    const [where, column] = filters[sort];
    return this.watchRows(`SELECT ${bookmarkColumns} FROM sr_user_bookmark b LEFT JOIN ps_data_local__local_bookmark_info l ON l.id = b.id WHERE ${where} AND b.deleted_at IS NULL ORDER BY coalesce(nullif(${column}, ''), b.updated_at) DESC`, [], onRows, onError, bookmark);
  }
  async getBookmark(id: string, ownerId?: string): Promise<BookmarkRecord | null> {
    const cacheId = bookmarkCacheKey(id, ownerId);
    const row = await this.database.getOptional<Record<string, unknown>>(`SELECT ${bookmarkColumns} FROM ${ownerId ? 'sr_collection_bookmark' : 'sr_user_bookmark'} b LEFT JOIN ps_data_local__local_bookmark_info l ON l.id = ? WHERE b.id = ? ${ownerId ? 'AND b.owner_id = ?' : ''}`, [cacheId, id, ...(ownerId ? [ownerId] : [])]);
    return row ? bookmark({...row, ...(ownerId ? {is_read: 0, archive_status: 0, is_starred: 1} : {})}) : null;
  }
  watchTags(onRows: (rows: TagRecord[]) => void, onError?: (error: Error) => void) { return this.watchRows('SELECT * FROM sr_user_tag', [], onRows, onError, row => ({...row, source: row.source ?? 'auto'}) as unknown as TagRecord); }
  watchCollections(onRows: (rows: CollectionRecord[]) => void, onError?: (error: Error) => void) {
    return this.watchRows(`SELECT c.*, s.subscription_end_time, s.created_at AS subscribed_at, s.is_cancelled, s.last_read_at, coalesce(latest.latest_article_at, '') AS latest_article_at FROM sr_user_collection_subscriber s INNER JOIN sr_user_collection c ON c.id = s.collection_id LEFT JOIN (SELECT owner_id, max(coalesce(nullif(starred_at, ''), created_at)) AS latest_article_at FROM sr_collection_bookmark GROUP BY owner_id) latest ON latest.owner_id = c.owner_id ORDER BY s.created_at ASC, c.id ASC`, [], onRows, onError, row => {
      const latestArticleAt = text(row.latest_article_at), lastReadAt = text(row.last_read_at);
      return {id: text(row.id), code: text(row.collection_code), name: text(row.display_name), avatar: text(row.avatar), description: text(row.description), ownerId: text(row.owner_id), type: Number(row.type ?? 1), status: Number(row.status ?? 0), subscriptionEndTime: text(row.subscription_end_time), subscribedAt: text(row.subscribed_at), isCancelled: Number(row.is_cancelled) === 1, lastReadAt, latestArticleAt, hasNew: Number.isFinite(Date.parse(latestArticleAt)) && (!Number.isFinite(Date.parse(lastReadAt)) || Date.parse(latestArticleAt) > Date.parse(lastReadAt))};
    });
  }
  watchCollectionBookmarks(ownerId: string, onRows: (rows: BookmarkRecord[]) => void, onError?: (error: Error) => void) {
    return this.watchRows(`SELECT ${bookmarkColumns}, 1 AS is_starred FROM sr_collection_bookmark b LEFT JOIN ps_data_local__local_bookmark_info l ON l.id = 'collection-' || b.owner_id || '-' || b.id WHERE b.owner_id = ? ORDER BY coalesce(nullif(b.starred_at, ''), b.created_at) DESC`, [ownerId], onRows, onError, bookmark);
  }
  watchCollectionSettings(ownerId: string, onRows: (rows: {allow_highlight: boolean; show_highlight: boolean; allow_access: boolean}[]) => void, onError?: (error: Error) => void) { return this.watchRows('SELECT * FROM sr_sharer_setting WHERE id = ? LIMIT 1', [ownerId], onRows, onError, row => ({allow_highlight: Number(row.allow_highlight) === 1, show_highlight: Number(row.show_highlight) === 1, allow_access: Number(row.allow_access) === 1})); }
  watchUser(onRows: (rows: Record<string, unknown>[]) => void, onError?: (error: Error) => void) { return this.watchRows('SELECT * FROM sr_user', [], onRows, onError); }
  watchSubscription(onRows: (rows: Record<string, unknown>[]) => void, onError?: (error: Error) => void) { return this.watchRows('SELECT * FROM sr_user_subscription', [], onRows, onError); }
  watchNotifications(onRows: (rows: Record<string, unknown>[]) => void, onError?: (error: Error) => void) { return this.watchRows('SELECT * FROM sr_user_notification ORDER BY created_at DESC', [], onRows, onError); }
  watchComments(bookmarkId: string, onRows: (rows: MarkRecord[]) => void, onError?: (error: Error) => void) { return this.watchRows('SELECT * FROM sr_bookmark_comment WHERE user_bookmark_uuid = ?', [bookmarkId], onRows, onError); }
  async updateBookmark(id: string, changes: {aliasTitle?: string; isStarred?: number; archiveStatus?: number; isRead?: number}) {
    const columns = {aliasTitle: 'alias_title', isStarred: 'is_starred', archiveStatus: 'archive_status', isRead: 'is_read'} as const;
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
    if (!entries.length) return;
    await this.database.writeTransaction(async tx => { await tx.execute(`UPDATE sr_user_bookmark SET ${entries.map(([key]) => `${columns[key as keyof typeof columns]} = ?`).join(', ')} WHERE id = ?`, [...entries.map(([, value]) => value), id]); });
  }
  async deleteBookmark(id: string) { await this.database.writeTransaction(async tx => { await tx.execute('UPDATE sr_user_bookmark SET deleted_at = ? WHERE id = ?', [this.now(), id]); }); }
  async updateTags(id: string, tagIds: string[]) { await this.database.writeTransaction(async tx => { await tx.execute("UPDATE sr_user_bookmark SET metadata = json_set(coalesce(metadata, '{}'), '$.tags', json(?)) WHERE id = ?", [JSON.stringify(tagIds), id]); }); }
  async createBookmark(url: string): Promise<string> {
    const id = this.uuid(), now = this.now();
    const metadata = {tags: [], bookmark: {uuid: id, title: url, byline: '', status: 'pending', host_url: url, site_name: '', target_url: url, description: '', content_icon: '', published_at: now, content_cover: '', content_word_count: 0}};
    await this.database.writeTransaction(async tx => { await tx.execute('INSERT INTO sr_user_bookmark (id, is_read, archive_status, is_starred, created_at, updated_at, alias_title, type, deleted_at, metadata) VALUES (?, 0, 0, 0, ?, ?, ?, 0, NULL, ?)', [id, now, now, '', JSON.stringify(metadata)]); });
    return id;
  }
  async createTag(tagName: string): Promise<TagRecord> {
    const record: TagRecord = {id: this.uuid(), tag_name: tagName, display: '1', source: 'mine', created_at: this.now()};
    await this.database.writeTransaction(async tx => { await tx.execute('INSERT INTO sr_user_tag (id, tag_name, display, source, created_at) VALUES (?, ?, ?, ?, ?)', [record.id, record.tag_name, record.display, record.source, record.created_at]); });
    return record;
  }
  async addMark(input: CreateMarkInput): Promise<string> {
    const {markPolicy: policy, type} = input;
    if (policy.isCollection && !(type === 1 ? policy.allowLine : (type === 2 || type === 3) && policy.allowComment)) throw new Error('Mark creation is not allowed');
    const id = this.uuid();
    const metadata = {root_id: input.rootId ?? null, user_id: input.userId, parent_id: input.parentId ?? null, source_type: policy.isCollection ? 'collection' : null, source_id: policy.isCollection ? input.bookmarkId : null, bookmark_id: input.bookmarkId};
    await this.database.writeTransaction(async tx => { await tx.execute('INSERT INTO sr_bookmark_comment (id, type, source, user_bookmark_uuid, comment, approx_source, content, is_deleted, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)', [id, type, input.source?.length ? JSON.stringify(input.source) : '', input.bookmarkId, input.comment ?? '', input.approxSource ? JSON.stringify(input.approxSource) : '', JSON.stringify(input.selectContent ?? []), this.now(), JSON.stringify(metadata)]); });
    return id;
  }
  async deleteMark(id: string, policy: CollectionMarkPolicy, userId: string): Promise<void> {
    await this.database.writeTransaction(async tx => {
      const mark = await tx.getOptional<{metadata: string}>('SELECT metadata FROM sr_bookmark_comment WHERE id = ?', [id]);
      if (!mark) return;
      let owner: string | undefined;
      try { owner = (JSON.parse(mark.metadata) as {user_id?: string}).user_id; } catch { /* A malformed owner cannot authorize deletion of a collection mark. */ }
      if (!userId || (policy.isCollection && owner !== userId)) throw new Error('Mark deletion is not allowed');
      await tx.execute('UPDATE sr_bookmark_comment SET is_deleted = 1 WHERE id = ?', [id]);
    });
  }
  async markCollectionRead(collectionId: string) { await this.database.writeTransaction(async tx => { await tx.execute('UPDATE sr_user_collection_subscriber SET last_read_at = ? WHERE collection_id = ?', [this.now(), collectionId]); }); }
  async markNotificationRead(id: string) { await this.database.writeTransaction(async tx => { await tx.execute('UPDATE sr_user_notification SET is_read = 1 WHERE id = ?', [id]); }); }
}
export function bookmarkCacheKey(bookmarkId: string, ownerId?: string | null) { return ownerId ? `collection-${ownerId}-${bookmarkId}` : bookmarkId; }
/** Preserve every key in the local JSON row, including fields absent from the declared schema. */
export class LocalBookmarkRepository {
  private database: SqlDatabase;
  constructor(database: SqlDatabase) { this.database = database; }
  async read(key: string): Promise<Record<string, unknown>> {
    const row = await this.database.getOptional<{data: string}>('SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?', [key]);
    return row ? JSON.parse(row.data) as Record<string, unknown> : {};
  }
  async update(key: string, fields: Record<string, unknown>): Promise<void> {
    await this.database.writeTransaction(async tx => {
      const row = await tx.getOptional<{data: string}>('SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?', [key]);
      const existing = row ? JSON.parse(row.data) as Record<string, unknown> : {};
      const merged = {...existing, ...fields};
      await tx.execute('INSERT INTO ps_data_local__local_bookmark_info (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', [key, JSON.stringify(merged)]);
    });
  }
  async setAutoDownloadStatus(key: string, status: number): Promise<void> {
    await this.database.writeTransaction(async tx => {
      const row = await tx.getOptional<{data: string}>('SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?', [key]);
      const existing = row ? JSON.parse(row.data) as Record<string, unknown> : {};
      const manual = existing.is_auto_cached === 0 || existing.is_auto_cached === false;
      if (manual && status !== 2) return;
      const merged = {...existing, is_downloaded: status, is_auto_cached: manual ? 0 : 1};
      await tx.execute('INSERT INTO ps_data_local__local_bookmark_info (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', [key, JSON.stringify(merged)]);
    });
  }
}
