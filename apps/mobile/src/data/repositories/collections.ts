import {collection} from './records.ts';
import type {RowWatch, SqlDatabase} from './sql.ts';
import type {CollectionRecord, CollectionSettings} from './types.ts';

export class CollectionRepository {
  private readonly database: SqlDatabase;
  private readonly rows: RowWatch;
  private readonly now: () => string;

  constructor(database: SqlDatabase, rows: RowWatch, now: () => string) {
    this.database = database;
    this.rows = rows;
    this.now = now;
  }

  watchCollections(onRows: (rows: CollectionRecord[]) => void, onError?: (error: Error) => void) {
    return this.rows.watchRows(
      `SELECT c.*, s.subscription_end_time, s.created_at AS subscribed_at, s.is_cancelled, s.last_read_at, coalesce(latest.latest_article_at, '') AS latest_article_at FROM sr_user_collection_subscriber s INNER JOIN sr_user_collection c ON c.id = s.collection_id LEFT JOIN (SELECT owner_id, max(coalesce(nullif(starred_at, ''), created_at)) AS latest_article_at FROM sr_collection_bookmark GROUP BY owner_id) latest ON latest.owner_id = c.owner_id ORDER BY s.created_at ASC, c.id ASC`,
      [], onRows, onError, collection,
    );
  }

  watchCollectionSettings(
    ownerId: string,
    onRows: (rows: CollectionSettings[]) => void,
    onError?: (error: Error) => void,
  ) {
    return this.rows.watchRows(
      'SELECT * FROM sr_sharer_setting WHERE id = ? LIMIT 1', [ownerId], onRows, onError,
      row => ({
        allow_highlight: Number(row.allow_highlight) === 1,
        show_highlight: Number(row.show_highlight) === 1,
        allow_access: Number(row.allow_access) === 1,
      }),
    );
  }

  async markCollectionRead(collectionId: string) {
    await this.database.writeTransaction(async tx => {
      await tx.execute(
        'UPDATE sr_user_collection_subscriber SET last_read_at = ? WHERE collection_id = ?',
        [this.now(), collectionId],
      );
    });
  }
}
