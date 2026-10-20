import {AccountRepository} from './repositories/account.ts';
import {BookmarkRepository} from './repositories/bookmarks.ts';
import {CollectionRepository} from './repositories/collections.ts';
import {CommentSubscriptions} from './repositories/comments.ts';
import {LocalBookmarkRepository} from './repositories/local-metadata.ts';
import {MarkRepository} from './repositories/marks.ts';
import {RowWatcher} from './repositories/watch-rows.ts';
import type {SqlDatabase} from './repositories/sql.ts';
import type {
  BookmarkChanges,
  BookmarkRecord,
  SystemCatalogBookmark,
  CollectionMarkPolicy,
  CollectionRecord,
  CollectionSettings,
  CommentWatchOptions,
  CreateMarkInput,
  MarkRecord,
  TagRecord,
  WidgetLibrarySnapshot,
} from './repositories/types.ts';

export type {SqlDatabase, SqlSyncStream, SqlSyncStreamSubscription, SqlTransaction} from './repositories/sql.ts';
export type {
  BookmarkChanges,
  BookmarkRecord,
  SystemCatalogBookmark,
  WidgetLibrarySnapshot,
  CollectionMarkPolicy,
  CollectionRecord,
  CollectionSettings,
  CommentWatchOptions,
  CreateMarkInput,
  MarkRecord,
  SelectionContent,
  TagRecord,
} from './repositories/types.ts';
export {LocalBookmarkRepository} from './repositories/local-metadata.ts';
export {bookmarkCacheKey, bookmarkDisplayTitle} from './repositories/records.ts';
export {collectionMarkPolicy, PERSONAL_MARK_POLICY, PENDING_COLLECTION_MARK_POLICY} from './repositories/mark-policy.ts';

export class MobileRepositories {
  readonly database: SqlDatabase;
  readonly local: LocalBookmarkRepository;
  private readonly rows: RowWatcher;
  private readonly bookmarks: BookmarkRepository;
  private readonly collections: CollectionRepository;
  private readonly account: AccountRepository;
  private readonly comments: CommentSubscriptions;
  private readonly marks: MarkRepository;

  constructor(database: SqlDatabase, uuid: () => string, now = () => new Date().toISOString()) {
    this.database = database;
    this.local = new LocalBookmarkRepository(database);
    this.rows = new RowWatcher(database);
    this.bookmarks = new BookmarkRepository(database, this.rows, uuid, now);
    this.collections = new CollectionRepository(database, this.rows, now);
    this.account = new AccountRepository(database, this.rows);
    this.comments = new CommentSubscriptions(database);
    this.marks = new MarkRepository(database, uuid, now);
  }

  watchRows<T>(
    sql: string,
    parameters: unknown[],
    onRows: (rows: T[]) => void,
    onError?: (error: Error) => void,
    mapper?: (row: Record<string, unknown>) => T,
  ): () => void {
    return this.rows.watchRows(sql, parameters, onRows, onError, mapper);
  }

  watchBookmarks(
    sort: 'inbox' | 'starred' | 'archived',
    onRows: (rows: BookmarkRecord[]) => void,
    onError?: (error: Error) => void,
  ) {
    return this.bookmarks.watchBookmarks(sort, onRows, onError);
  }

  getBookmark(id: string, ownerId?: string): Promise<BookmarkRecord | null> {
    return this.bookmarks.getBookmark(id, ownerId);
  }

  getSystemBookmark(id: string): Promise<SystemCatalogBookmark | null> {return this.bookmarks.getSystemBookmark(id);}

  watchSystemCatalog(onRows: (rows: SystemCatalogBookmark[]) => void, onError?: (error: Error) => void) {
    return this.bookmarks.watchSystemCatalog(onRows, onError);
  }

  watchWidgetSnapshot(onSnapshot: (snapshot: WidgetLibrarySnapshot) => void, onError?: (error: Error) => void) {
    return this.bookmarks.watchWidgetSnapshot(onSnapshot, onError);
  }

  watchTags(onRows: (rows: TagRecord[]) => void, onError?: (error: Error) => void) {
    return this.bookmarks.watchTags(onRows, onError);
  }

  watchCollections(onRows: (rows: CollectionRecord[]) => void, onError?: (error: Error) => void) {
    return this.collections.watchCollections(onRows, onError);
  }

  watchCollectionBookmarks(
    ownerId: string,
    onRows: (rows: BookmarkRecord[]) => void,
    onError?: (error: Error) => void,
  ) {
    return this.bookmarks.watchCollectionBookmarks(ownerId, onRows, onError);
  }

  watchCollectionSettings(
    ownerId: string,
    onRows: (rows: CollectionSettings[]) => void,
    onError?: (error: Error) => void,
  ) {
    return this.collections.watchCollectionSettings(ownerId, onRows, onError);
  }

  watchUser(onRows: (rows: Record<string, unknown>[]) => void, onError?: (error: Error) => void) {
    return this.account.watchUser(onRows, onError);
  }

  watchSubscription(onRows: (rows: Record<string, unknown>[]) => void, onError?: (error: Error) => void) {
    return this.account.watchSubscription(onRows, onError);
  }

  watchNotifications(onRows: (rows: Record<string, unknown>[]) => void, onError?: (error: Error) => void) {
    return this.account.watchNotifications(onRows, onError);
  }

  watchComments(
    bookmarkId: string,
    onRows: (rows: MarkRecord[]) => void,
    onError?: (error: Error) => void,
    options: CommentWatchOptions = {},
  ): () => void {
    return this.comments.watchComments(bookmarkId, onRows, onError, options);
  }

  updateBookmark(id: string, changes: BookmarkChanges) {
    return this.bookmarks.updateBookmark(id, changes);
  }

  deleteBookmark(id: string) {
    return this.bookmarks.deleteBookmark(id);
  }

  updateTags(id: string, tagIds: string[]) {
    return this.bookmarks.updateTags(id, tagIds);
  }

  createBookmark(url: string): Promise<string> {
    return this.bookmarks.createBookmark(url);
  }

  createTag(tagName: string): Promise<TagRecord> {
    return this.bookmarks.createTag(tagName);
  }

  addMark(input: CreateMarkInput): Promise<string> {
    return this.marks.addMark(input);
  }

  deleteMark(id: string, policy: CollectionMarkPolicy, userId: string): Promise<void> {
    return this.marks.deleteMark(id, policy, userId);
  }

  markCollectionRead(collectionId: string) {
    return this.collections.markCollectionRead(collectionId);
  }

  markNotificationRead(id: string) {
    return this.account.markNotificationRead(id);
  }
}
