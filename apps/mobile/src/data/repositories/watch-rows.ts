import type {RowWatch, SqlDatabase} from './sql.ts';

function sameRow(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) {
    return false;
  }
  const before = left as Record<string, unknown>;
  const after = right as Record<string, unknown>;
  const keys = Object.keys(before);
  return keys.length === Object.keys(after).length && keys.every(key => (
    Object.prototype.hasOwnProperty.call(after, key) && Object.is(before[key], after[key])
  ));
}

export class RowWatcher implements RowWatch {
  private readonly database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.database = database;
  }

  watchRows<T>(
    sql: string,
    parameters: unknown[],
    onRows: (rows: T[]) => void,
    onError?: (error: Error) => void,
    mapper?: (row: Record<string, unknown>) => T,
  ): () => void {
    const controller = new AbortController();
    const accountSignal = this.database.accountSignal;
    let previous: T[] | undefined;
    let records = new Map<unknown, {row: Record<string, unknown>; value: T}[]>();
    const cleanup = () => {
      controller.abort();
      accountSignal?.removeEventListener('abort', cleanup);
      previous = undefined;
      records.clear();
    };
    if (accountSignal?.aborted) return cleanup;
    accountSignal?.addEventListener('abort', cleanup, {once: true});

    try {
      this.database.watch(sql, parameters, {
        onResult: result => {
          if (controller.signal.aborted) return;
          const nextRecords: typeof records = new Map();
          const offsets = new Map<unknown, number>();
          const next = (result.rows?._array ?? []).map(row => {
            const offset = offsets.get(row.id) ?? 0;
            const candidate = records.get(row.id)?.[offset];
            offsets.set(row.id, offset + 1);
            let entry = candidate;
            if (!candidate || !sameRow(candidate.row, row)) {
              const mapped = mapper ? mapper(row) : row as T;
              entry = {
                row,
                value: candidate && sameRow(candidate.value, mapped) ? candidate.value : mapped,
              };
            }
            const matches = nextRecords.get(row.id);
            if (matches) matches.push(entry!);
            else nextRecords.set(row.id, [entry!]);
            return entry!.value;
          });
          records = nextRecords;
          if (previous && previous.length === next.length && previous.every((row, index) => Object.is(row, next[index]))) {
            return;
          }
          previous = next;
          onRows(next);
        },
        onError: error => {
          if (!controller.signal.aborted) onError?.(error);
        },
      }, {signal: controller.signal});
    } catch (error) {
      cleanup();
      throw error;
    }
    return cleanup;
  }
}
