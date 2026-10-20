import type {SyncStreamSubscribeOptions, SyncStreamSubscription} from '@powersync/common';

export type SqlSyncStreamSubscription = Pick<SyncStreamSubscription, 'unsubscribe'> & Partial<Pick<SyncStreamSubscription, 'waitForFirstSync'>>;

export interface SqlSyncStream {
  subscribe(options?: SyncStreamSubscribeOptions): Promise<SqlSyncStreamSubscription>;
}

export interface SqlTransaction {
  execute(sql: string, parameters?: unknown[]): Promise<unknown>;
  getOptional<T>(sql: string, parameters?: unknown[]): Promise<T | null>;
}

export interface SqlDatabase extends SqlTransaction {
  readonly accountSignal?: AbortSignal;
  syncStream?(name: string, parameters?: Record<string, string>): SqlSyncStream;
  getAll<T>(sql: string, parameters?: unknown[]): Promise<T[]>;
  writeTransaction<T>(work: (transaction: SqlTransaction) => Promise<T>): Promise<T>;
  watch(
    sql: string,
    parameters: unknown[],
    handler: {
      onResult: (result: {rows?: {_array: Record<string, unknown>[]}}) => void;
      onError?: (error: Error) => void;
    },
    options: {signal: AbortSignal},
  ): void;
}

export interface RowWatch {
  watchRows<T>(
    sql: string,
    parameters: unknown[],
    onRows: (rows: T[]) => void,
    onError?: (error: Error) => void,
    mapper?: (row: Record<string, unknown>) => T,
  ): () => void;
}
