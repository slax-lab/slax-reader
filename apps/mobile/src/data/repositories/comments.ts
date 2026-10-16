import type {SqlDatabase, SqlSyncStreamSubscription} from './sql.ts';
import type {CommentWatchOptions, MarkRecord} from './types.ts';

export class CommentSubscriptions {
  private readonly database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.database = database;
  }

  watchComments(
    bookmarkId: string,
    onRows: (rows: MarkRecord[]) => void,
    onError?: (error: Error) => void,
    options: CommentWatchOptions = {},
  ): () => void {
    const controller = new AbortController();
    const accountSignal = this.database.accountSignal;
    let subscription: SqlSyncStreamSubscription | undefined;
    const isActive = () => !controller.signal.aborted && !accountSignal?.aborted;
    const reportError = (error: unknown) => {
      if (isActive()) onError?.(error instanceof Error ? error : new Error(String(error)));
    };
    const unsubscribe = (handle: SqlSyncStreamSubscription) => {
      try {
        void Promise.resolve(handle.unsubscribe()).catch(() => {});
      } catch {}
    };
    const cleanup = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      accountSignal?.removeEventListener('abort', cleanup);
      if (subscription) {
        const handle = subscription;
        subscription = undefined;
        unsubscribe(handle);
      }
    };
    if (!isActive()) return cleanup;
    if (options.enabled === false) {
      onRows([]);
      return cleanup;
    }
    const collection = options.collectionOwnerId !== undefined;
    if (collection && (typeof options.collectionOwnerId !== 'string' || !options.collectionOwnerId.trim())) {
      onRows([]);
      reportError(new Error('A collection owner is required for comment subscriptions'));
      return cleanup;
    }
    accountSignal?.addEventListener('abort', cleanup, {once: true});
    try {
      this.database.watch('SELECT * FROM sr_bookmark_comment WHERE user_bookmark_uuid = ?', [bookmarkId], {
        onResult: result => {
          if (isActive()) onRows((result.rows?._array ?? []) as unknown as MarkRecord[]);
        },
        onError: reportError,
      }, {signal: controller.signal});
    } catch (error) {
      try {
        reportError(error);
      } finally {
        cleanup();
      }
      return cleanup;
    }
    if (!isActive()) return cleanup;
    const subscribe = async () => {
      try {
        if (!this.database.syncStream) {
          throw new Error('PowerSync stream subscriptions are not supported by this database');
        }
        const parameters: Record<string, string> = {bookmark_uuid: bookmarkId};
        if (collection) parameters.owner_id = options.collectionOwnerId!;
        const handle = await this.database.syncStream(
          collection ? 'collection_bookmark_comment' : 'bookmark_comment', parameters,
        ).subscribe({ttl: 5 * 24 * 60 * 60});
        if (typeof handle?.unsubscribe !== 'function') {
          throw new Error('PowerSync did not return a comment subscription handle');
        }
        if (isActive()) subscription = handle;
        else unsubscribe(handle);
      } catch (error) {
        reportError(error);
      }
    };
    void subscribe().catch(() => {});
    return cleanup;
  }
}
