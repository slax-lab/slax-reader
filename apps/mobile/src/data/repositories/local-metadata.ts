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

  private async write(sql: string, parameters: unknown[]): Promise<void> {
    try {await this.database.writeTransaction(async tx => {await tx.execute(sql, parameters);});}
    catch (error) {
      if (error instanceof Error && /malformed JSON/i.test(error.message)) throw new SyntaxError('Invalid local bookmark metadata', {cause: error});
      throw error;
    }
  }

  async update(key: string, fields: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(fields);
    const encoded = JSON.stringify(Object.fromEntries(entries));
    const patch = JSON.parse(encoded) as Record<string, unknown>;
    const set = Object.entries(patch).map(([field, value]) => ({path: `$.${JSON.stringify(field)}`, json: JSON.stringify(value)}));
    const remove = entries.filter(([field]) => !Object.hasOwn(patch, field)).map(([field]) => `$.${JSON.stringify(field)}`);
    let data = "json(coalesce(data, '{}'))";
    const parameters: unknown[] = [key, encoded];
    if (set.length) {
      data = `json_set(${data}, ${set.map(() => '?, json(?)').join(', ')})`;
      parameters.push(...set.flatMap(value => [value.path, value.json]));
    }
    if (remove.length) {
      data = `json_remove(${data}, ${remove.map(() => '?').join(', ')})`;
      parameters.push(...remove);
    }
    await this.write(
      `INSERT INTO ps_data_local__local_bookmark_info (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = ${data}`,
      parameters,
    );
  }

  async setAutoDownloadStatus(key: string, status: number): Promise<void> {
    await this.write(
      `INSERT INTO ps_data_local__local_bookmark_info (id, data) VALUES (?, json_object('is_downloaded', ?, 'is_auto_cached', 1))
       ON CONFLICT(id) DO UPDATE SET data = json_set(coalesce(data, '{}'), '$.is_downloaded', ?, '$.is_auto_cached',
         CASE WHEN json_type(data, '$.is_auto_cached') IN ('integer', 'real', 'false') AND json_extract(data, '$.is_auto_cached') = 0 THEN 0 ELSE 1 END)
       WHERE ? = 2 OR NOT coalesce(json_type(data, '$.is_auto_cached') IN ('integer', 'real', 'false') AND json_extract(data, '$.is_auto_cached') = 0, 0)`,
      [key, status, status, status],
    );
  }
}
