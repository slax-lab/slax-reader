import type {SqlDatabase, SqlTransaction} from './sql.ts';
import {RowWatcher} from './watch-rows.ts';
import type {OfflineRetryState} from '../offline-retry.ts';

const FIELD = '$._slax_offline_retry';
export const OFFLINE_TASK_SQL = `SELECT id, json_extract(data, '$._slax_offline_retry') AS retry FROM ps_data_local__local_bookmark_info
  WHERE CASE WHEN json_valid(data) THEN json_type(data, '$._slax_offline_retry') IS NOT NULL ELSE 0 END`;
export type OfflineTaskState = {
  version: 1; scope: string; kind: 'article' | 'pdf'; generation: string;
  state: 'running' | 'failed' | 'denied'; attempts: number; retryAt: number;
};
export type OfflineTaskObservation = {id: string; task: OfflineTaskState | null};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function decodeOfflineTask(encoded: unknown, scope: string): OfflineTaskState {
  if (typeof encoded !== 'string') throw new Error('Offline task state is incompatible');
  const value: unknown = JSON.parse(encoded);
  if (!record(value) || value.version !== 1 || value.scope !== scope || !['article', 'pdf'].includes(String(value.kind)) ||
    typeof value.generation !== 'string' || !/^[\w-]+$/.test(value.generation) || !['running', 'failed', 'denied'].includes(String(value.state)) ||
    !Number.isSafeInteger(value.attempts) || Number(value.attempts) < 0 || !Number.isSafeInteger(value.retryAt) || Number(value.retryAt) < 0) throw new Error('Offline task state is incompatible');
  return value as OfflineTaskState;
}

export class OfflineTaskRepository {
  private readonly database: SqlDatabase;
  private readonly scope: string;
  private readonly identifier: () => string;
  private readonly guard: () => void;
  constructor(database: SqlDatabase, scope: string, identifier: () => string, guard: () => void) {this.database = database; this.scope = scope; this.identifier = identifier; this.guard = guard;}

  private async read(database: Pick<SqlTransaction, 'getOptional'>, key: string): Promise<OfflineTaskState | null> {
    this.guard(); const row = await database.getOptional<{retry: unknown}>(`SELECT json_extract(data, ?) AS retry FROM ps_data_local__local_bookmark_info WHERE id = ?`, [FIELD, key]); this.guard();
    return row?.retry == null ? null : decodeOfflineTask(row.retry, this.scope);
  }

  begin(key: string, kind: OfflineTaskState['kind'], now: number, explicit = false): Promise<OfflineTaskState | null> {
    return this.database.writeTransaction(async tx => {
      const previous = await this.read(tx, key);
      if (!explicit && previous && (previous.state === 'denied' || previous.retryAt > now)) return null;
      const next: OfflineTaskState = {...previous, version: 1, scope: this.scope, kind, generation: this.identifier(), state: 'running', attempts: previous?.attempts ?? 0, retryAt: 0};
      const encoded = JSON.stringify(next); decodeOfflineTask(encoded, this.scope); this.guard();
      await tx.execute(`INSERT INTO ps_data_local__local_bookmark_info(id, data) VALUES (?, json_object('_slax_offline_retry', json(?)))
        ON CONFLICT(id) DO UPDATE SET data = json_set(data, ?, json(?))`, [key, encoded, FIELD, encoded]); this.guard();
      return next;
    });
  }

  fail(key: string, ticket: OfflineTaskState, state: OfflineRetryState): Promise<void> {
    return this.database.writeTransaction(async tx => {
      this.guard();
      await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_set(data, '$._slax_offline_retry.state', ?,
        '$._slax_offline_retry.attempts', ?, '$._slax_offline_retry.retryAt', ?)
        WHERE id = ? AND json_extract(data, '$._slax_offline_retry.version') = 1 AND json_extract(data, '$._slax_offline_retry.scope') = ?
        AND json_extract(data, '$._slax_offline_retry.generation') = ?`, [state.state, state.attempts, state.retryAt, key, this.scope, ticket.generation]); this.guard();
    });
  }

  complete(key: string, ticket: OfflineTaskState): Promise<void> {
    return this.database.writeTransaction(async tx => {
      this.guard();
      await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_remove(data, ?)
        WHERE id = ? AND json_extract(data, '$._slax_offline_retry.version') = 1 AND json_extract(data, '$._slax_offline_retry.scope') = ?
        AND json_extract(data, '$._slax_offline_retry.generation') = ?`, [FIELD, key, this.scope, ticket.generation]); this.guard();
    });
  }

  watch(onRows: (rows: OfflineTaskObservation[]) => void): () => void {
    return new RowWatcher(this.database).watchRows(OFFLINE_TASK_SQL, [], onRows, undefined, row => {
      let task: OfflineTaskState | null = null;
      try {task = decodeOfflineTask(row.retry, this.scope);} catch {}
      return {id: String(row.id), task};
    });
  }
}
