import type {RowWatch, SqlDatabase} from './sql.ts';

export class AccountRepository {
  private readonly database: SqlDatabase;
  private readonly rows: RowWatch;

  constructor(database: SqlDatabase, rows: RowWatch) {
    this.database = database;
    this.rows = rows;
  }

  watchUser(onRows: (rows: Record<string, unknown>[]) => void, onError?: (error: Error) => void) {
    return this.rows.watchRows('SELECT * FROM sr_user', [], onRows, onError);
  }

  watchSubscription(onRows: (rows: Record<string, unknown>[]) => void, onError?: (error: Error) => void) {
    return this.rows.watchRows('SELECT * FROM sr_user_subscription', [], onRows, onError);
  }

  watchNotifications(onRows: (rows: Record<string, unknown>[]) => void, onError?: (error: Error) => void) {
    return this.rows.watchRows('SELECT * FROM sr_user_notification ORDER BY created_at DESC', [], onRows, onError);
  }

  async markNotificationRead(id: string) {
    await this.database.writeTransaction(async tx => {
      await tx.execute('UPDATE sr_user_notification SET is_read = 1 WHERE id = ?', [id]);
    });
  }
}
