import type {SqlDatabase, SqlTransaction} from './sql.ts';

const FIELD = '$._slax_eviction';
export type CacheEvictionIntent = {
  version: 1; scope: string; generation: string; state: 'prepared' | 'committed'; discardRow: boolean; manifestGeneration: string | null;
};
function decode(value: unknown, scope: string): CacheEvictionIntent {
  if (typeof value !== 'string') throw new Error('Cache eviction intent is incompatible');
  const intent: unknown = JSON.parse(value);
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) throw new Error('Cache eviction intent is incompatible');
  const item = intent as CacheEvictionIntent;
  if (item.version !== 1 || item.scope !== scope || typeof item.generation !== 'string' || !/^[\w-]{1,100}$/.test(item.generation) || !['prepared', 'committed'].includes(item.state) ||
    typeof item.discardRow !== 'boolean' || item.manifestGeneration !== null && (typeof item.manifestGeneration !== 'string' || !/^[\w-]+$/.test(item.manifestGeneration))) throw new Error('Cache eviction intent is incompatible');
  return item;
}
export class CacheEvictionRepository {
  private readonly database: SqlDatabase;
  private readonly scope: string;
  private readonly identifier: () => string;
  private readonly guard: () => void;
  constructor(database: SqlDatabase, scope: string, identifier: () => string, guard: () => void) {this.database = database; this.scope = scope; this.identifier = identifier; this.guard = guard;}
  private async read(tx: Pick<SqlTransaction, 'getOptional'>, key: string): Promise<CacheEvictionIntent | null> {
    this.guard();
    const row = await tx.getOptional<{intent: unknown}>(`SELECT json_extract(data, ?) AS intent FROM ps_data_local__local_bookmark_info WHERE id = ?`, [FIELD, key]);
    this.guard(); return row?.intent == null ? null : decode(row.intent, this.scope);
  }
  current(key: string) {return this.read(this.database, key);}
  async pending(): Promise<{key: string; intent: CacheEvictionIntent}[]> {
    this.guard();
    const rows = await this.database.getAll<{id: string; intent: unknown}>(`SELECT id, json_extract(data, ?) AS intent FROM ps_data_local__local_bookmark_info
      WHERE CASE WHEN json_valid(data) THEN json_type(data, ?) IS NOT NULL ELSE 0 END`, [FIELD, FIELD]);
    this.guard(); const pending: {key: string; intent: CacheEvictionIntent}[] = [];
    for (const row of rows) {
      if (!/^[\w-]+$/.test(row.id)) continue;
      try {pending.push({key: row.id, intent: decode(row.intent, this.scope)});} catch {}
    }
    return pending;
  }
  begin(key: string, discardRow: boolean, check: () => void): Promise<CacheEvictionIntent | null> {
    return this.database.writeTransaction(async tx => {
      this.guard(); check();
      const existing = await this.read(tx, key);
      if (existing) throw new Error('Cache eviction requires recovery');
      const row = await tx.getOptional<{generation: string | null}>(`SELECT json_extract(data, '$._slax_offline.generation') AS generation
        FROM ps_data_local__local_bookmark_info WHERE id = ? AND json_extract(data, '$.is_downloaded') IN (2, '2')
        AND NOT coalesce(json_type(data, '$.is_auto_cached') IN ('integer', 'real', 'false') AND json_extract(data, '$.is_auto_cached') = 0, 0)`, [key]);
      this.guard(); check(); if (!row) return null;
      const intent: CacheEvictionIntent = {version: 1, scope: this.scope, generation: this.identifier(), state: 'prepared', discardRow, manifestGeneration: row.generation};
      const encoded = JSON.stringify(intent); decode(encoded, this.scope);
      await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_set(data, ?, json(?)) WHERE id = ?`, [FIELD, encoded, key]);
      this.guard(); check(); return intent;
    });
  }
  commit(key: string, intent: CacheEvictionIntent, check: () => void): Promise<boolean> {
    return this.database.writeTransaction(async tx => {
      this.guard(); check(); const current = await this.read(tx, key); this.guard(); check();
      if (current?.generation !== intent.generation || current.state !== 'prepared') return false;
      await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_remove(json_set(data, '$._slax_eviction.state', 'committed',
        '$.is_downloaded', 0, '$.is_auto_cached', 1), '$._slax_offline', '$._slax_offline_retry')
        WHERE id = ? AND json_extract(data, '$._slax_offline.generation') IS ? AND json_extract(data, '$.is_downloaded') IN (2, '2')
        AND NOT coalesce(json_type(data, '$.is_auto_cached') IN ('integer', 'real', 'false') AND json_extract(data, '$.is_auto_cached') = 0, 0)`, [key, intent.manifestGeneration]);
      this.guard(); check(); return (await this.read(tx, key))?.state === 'committed';
    });
  }
  finish(key: string, intent: CacheEvictionIntent): Promise<void> {
    return this.database.writeTransaction(async tx => {
      const current = await this.read(tx, key); this.guard(); if (current?.generation !== intent.generation) return;
      if (current.state === 'committed' && current.discardRow) {
        await tx.execute(`DELETE FROM ps_data_local__local_bookmark_info WHERE id = ? AND json_extract(data, '$.is_downloaded') IN (0, '0')
          AND NOT coalesce(json_type(data, '$.is_auto_cached') IN ('integer', 'real', 'false') AND json_extract(data, '$.is_auto_cached') = 0, 0)
          AND NOT EXISTS (SELECT 1 FROM json_each(data) WHERE key NOT IN ('id', 'is_downloaded', 'is_auto_cached', '_slax_eviction'))`, [key]);
        this.guard();
      }
      await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_remove(data, ?) WHERE id = ?`, [FIELD, key]); this.guard();
    });
  }
}
