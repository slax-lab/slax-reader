import {SearchRepository} from './repositories/search.ts';
import {LibraryRepository, AccountSnapshot} from './repositories/library.ts';
import {AccountRepository} from './repositories/account.ts';
import {BookmarkRepository} from './repositories/bookmarks.ts';
import {CollectionRepository} from './repositories/collections.ts';
import {CommentSubscriptions} from './repositories/comments.ts';
import {LocalBookmarkRepository} from './repositories/local-metadata.ts';
import {MarkRepository} from './repositories/marks.ts';
import {RowWatcher} from './repositories/watch-rows.ts';
import {RssRepository} from './repositories/rss.ts';
import type {SqlDatabase} from './repositories/sql.ts';
import type {
  LibraryBookmark,
  LibraryCollection,
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
} from './repositories/types.ts';

export type {SqlDatabase, SqlSyncStream, SqlSyncStreamSubscription, SqlTransaction} from './repositories/sql.ts';
export type {
  LibraryBookmark,
  LibraryCollection,
  BookmarkChanges,
  BookmarkRecord,
  SystemCatalogBookmark,
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
  readonly rss: RssRepository;
  readonly library: LibraryRepository;
  readonly search: SearchRepository;
  private readonly libraryUser: AccountSnapshot<Record<string, unknown>[]>;
  private readonly libraryCollections: AccountSnapshot<LibraryCollection[]>;
  private readonly rows: RowWatcher;
  private readonly bookmarks: BookmarkRepository;
  private readonly collections: CollectionRepository;
  private readonly account: AccountRepository;
  private readonly comments: CommentSubscriptions;
  private readonly marks: MarkRepository;
  private readonly remoteBookmark?: (id: string, signal?: AbortSignal) => Promise<BookmarkRecord | null>;

  constructor(database: SqlDatabase, uuid: () => string, now = () => new Date().toISOString(), remoteBookmark?: (id: string, signal?: AbortSignal) => Promise<BookmarkRecord | null>) {
    this.database = database;
    this.remoteBookmark = remoteBookmark;
    this.local = new LocalBookmarkRepository(database);
    this.rss = new RssRepository(database);
    this.library = new LibraryRepository(database);
    this.search = new SearchRepository(database);
    this.rows = new RowWatcher(database);
    this.bookmarks = new BookmarkRepository(database, this.rows, uuid, now);
    this.collections = new CollectionRepository(database, this.rows, now);
    this.account = new AccountRepository(database, this.rows);
    this.libraryUser = new AccountSnapshot((next, error) => this.rows.watchRows('SELECT id, name, picture FROM sr_user', [], next, error), database.accountSignal);
    this.libraryCollections = new AccountSnapshot((next, error) => this.collections.watchLibrarySources(next, error), database.accountSignal);
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

  async getBookmark(id: string, ownerId?: string): Promise<BookmarkRecord | null> {
    const record = await this.bookmarks.getBookmark(id, ownerId);
    if (record || ownerId || !this.remoteBookmark) return record;
    const remote = await this.remoteBookmark(id, this.database.accountSignal);
    if (this.database.accountSignal?.aborted) throw new Error('Account changed');
    return remote;
  }

  getSystemBookmark(id: string): Promise<SystemCatalogBookmark | null> {return this.bookmarks.getSystemBookmark(id);}

  watchSystemCatalog(onRows: (rows: SystemCatalogBookmark[]) => void, onError?: (error: Error) => void) {
    return this.bookmarks.watchSystemCatalog(onRows, onError);
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

  watchLibraryUser(onRows: (rows: Record<string, unknown>[]) => void, onError?: (error: Error) => void) {return this.libraryUser.subscribe(onRows, onError);}

  watchLibraryCollections(onRows: (rows: LibraryCollection[]) => void, onError?: (error: Error) => void) {return this.libraryCollections.subscribe(onRows, onError);}

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
