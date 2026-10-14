import type {SqlDatabase} from './sql.ts';

/** Preserve every key in the local JSON row, including fields absent from the declared schema. */
export class LocalBookmarkRepository {
  private readonly database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.database = database;
  }

  async read(key: string): Promise<Record<string, unknown>> {
    const row = await this.database.getOptional<{data: string}>(
      'SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?',
      [key],
    );
    return row ? JSON.parse(row.data) as Record<string, unknown> : {};
  }

  async update(key: string, fields: Record<string, unknown>): Promise<void> {
    await this.database.writeTransaction(async tx => {
      const row = await tx.getOptional<{data: string}>(
        'SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?',
        [key],
      );
      const existing = row ? JSON.parse(row.data) as Record<string, unknown> : {};
      const merged = {...existing, ...fields};
      await tx.execute(
        'INSERT INTO ps_data_local__local_bookmark_info (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
        [key, JSON.stringify(merged)],
      );
    });
  }

  async setAutoDownloadStatus(key: string, status: number): Promise<void> {
    await this.database.writeTransaction(async tx => {
      const row = await tx.getOptional<{data: string}>(
        'SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?',
        [key],
      );
      const existing = row ? JSON.parse(row.data) as Record<string, unknown> : {};
      const manual = existing.is_auto_cached === 0 || existing.is_auto_cached === false;
      if (manual && status !== 2) return;
      const merged = {...existing, is_downloaded: status, is_auto_cached: manual ? 0 : 1};
      await tx.execute(
        'INSERT INTO ps_data_local__local_bookmark_info (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
        [key, JSON.stringify(merged)],
      );
    });
  }
}
