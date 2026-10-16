import {bookmark, bookmarkCacheKey} from './records.ts';
import type {RowWatch, SqlDatabase} from './sql.ts';
import type {BookmarkChanges, BookmarkRecord, TagRecord} from './types.ts';

const bookmarkFields = `b.id, b.alias_title, b.created_at, b.updated_at, b.metadata, json_extract(b.metadata, '$.bookmark.title') AS metadata_title, json_extract(b.metadata, '$.bookmark.target_url') AS metadata_url, json_extract(b.metadata, '$.bookmark.status') AS metadata_status, coalesce(json_extract(l.data, '$.is_downloaded'), 0) AS download_status, json_extract(l.data, '$.is_auto_cached') AS is_auto_cached`;
const bookmarkColumns = `${bookmarkFields}, b.type AS content_type, b.user_id, b.archive_status, b.is_starred, b.is_read`;
const collectionBookmarkColumns = `${bookmarkFields}, json_extract(b.metadata, '$.bookmark.type') AS content_type, b.owner_id, 1 AS is_starred`;

export class BookmarkRepository {
  private readonly database: SqlDatabase;
  private readonly rows: RowWatch;
  private readonly uuid: () => string;
  private readonly now: () => string;

  constructor(database: SqlDatabase, rows: RowWatch, uuid: () => string, now: () => string) {
    this.database = database;
    this.rows = rows;
    this.uuid = uuid;
    this.now = now;
  }

  watchBookmarks(
    sort: 'inbox' | 'starred' | 'archived',
    onRows: (rows: BookmarkRecord[]) => void,
    onError?: (error: Error) => void,
  ) {
    const filters = {
      inbox: ['b.archive_status = 0', 'b.created_at'],
      starred: ['b.is_starred = 1', 'b.starred_at'],
      archived: ['b.archive_status = 1', 'b.archived_at'],
    } as const;
    const [where, column] = filters[sort];
    return this.rows.watchRows(
      `SELECT ${bookmarkColumns} FROM sr_user_bookmark b LEFT JOIN ps_data_local__local_bookmark_info l ON l.id = b.id WHERE ${where} AND b.deleted_at IS NULL ORDER BY coalesce(nullif(${column}, ''), b.updated_at) DESC`,
      [], onRows, onError, bookmark,
    );
  }

  async getBookmark(id: string, ownerId?: string): Promise<BookmarkRecord | null> {
    const cacheId = bookmarkCacheKey(id, ownerId);
    const row = await this.database.getOptional<Record<string, unknown>>(
      `SELECT ${ownerId ? collectionBookmarkColumns : bookmarkColumns} FROM ${ownerId ? 'sr_collection_bookmark' : 'sr_user_bookmark'} b LEFT JOIN ps_data_local__local_bookmark_info l ON l.id = ? WHERE b.id = ? ${ownerId ? 'AND b.owner_id = ?' : ''}`,
      [cacheId, id, ...(ownerId ? [ownerId] : [])],
    );
    return row ? bookmark({...row, ...(ownerId ? {is_read: 0, archive_status: 0, is_starred: 1} : {})}) : null;
  }

  watchTags(onRows: (rows: TagRecord[]) => void, onError?: (error: Error) => void) {
    return this.rows.watchRows(
      'SELECT * FROM sr_user_tag', [], onRows, onError,
      row => ({...row, source: row.source ?? 'auto'}) as unknown as TagRecord,
    );
  }

  watchCollectionBookmarks(
    ownerId: string,
    onRows: (rows: BookmarkRecord[]) => void,
    onError?: (error: Error) => void,
  ) {
    return this.rows.watchRows(
      `SELECT ${collectionBookmarkColumns} FROM sr_collection_bookmark b LEFT JOIN ps_data_local__local_bookmark_info l ON l.id = 'collection-' || b.owner_id || '-' || b.id WHERE b.owner_id = ? ORDER BY coalesce(nullif(b.starred_at, ''), b.created_at) DESC`,
      [ownerId], onRows, onError, bookmark,
    );
  }

  async updateBookmark(id: string, changes: BookmarkChanges) {
    const columns = {
      aliasTitle: 'alias_title',
      isStarred: 'is_starred',
      archiveStatus: 'archive_status',
      isRead: 'is_read',
    } as const;
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
    if (!entries.length) return;
    await this.database.writeTransaction(async tx => {
      await tx.execute(
        `UPDATE sr_user_bookmark SET ${entries.map(([key]) => `${columns[key as keyof typeof columns]} = ?`).join(', ')} WHERE id = ?`,
        [...entries.map(([, value]) => value), id],
      );
    });
  }

  async deleteBookmark(id: string) {
    await this.database.writeTransaction(async tx => {
      await tx.execute('UPDATE sr_user_bookmark SET deleted_at = ? WHERE id = ?', [this.now(), id]);
    });
  }

  async updateTags(id: string, tagIds: string[]) {
    await this.database.writeTransaction(async tx => {
      await tx.execute(
        "UPDATE sr_user_bookmark SET metadata = json_set(coalesce(metadata, '{}'), '$.tags', json(?)) WHERE id = ?",
        [JSON.stringify(tagIds), id],
      );
    });
  }

  async createBookmark(url: string): Promise<string> {
    const id = this.uuid();
    const now = this.now();
    const metadata = {
      tags: [],
      bookmark: {
        uuid: id,
        title: url,
        byline: '',
        status: 'pending',
        host_url: url,
        site_name: '',
        target_url: url,
        description: '',
        content_icon: '',
        published_at: now,
        content_cover: '',
        content_word_count: 0,
      },
    };
    await this.database.writeTransaction(async tx => {
      await tx.execute(
        'INSERT INTO sr_user_bookmark (id, is_read, archive_status, is_starred, created_at, updated_at, alias_title, type, deleted_at, metadata) VALUES (?, 0, 0, 0, ?, ?, ?, 0, NULL, ?)',
        [id, now, now, '', JSON.stringify(metadata)],
      );
    });
    return id;
  }

  async createTag(tagName: string): Promise<TagRecord> {
    const record: TagRecord = {
      id: this.uuid(),
      tag_name: tagName,
      display: '1',
      source: 'mine',
      created_at: this.now(),
    };
    await this.database.writeTransaction(async tx => {
      await tx.execute(
        'INSERT INTO sr_user_tag (id, tag_name, display, source, created_at) VALUES (?, ?, ?, ?, ?)',
        [record.id, record.tag_name, record.display, record.source, record.created_at],
      );
    });
    return record;
  }
}
