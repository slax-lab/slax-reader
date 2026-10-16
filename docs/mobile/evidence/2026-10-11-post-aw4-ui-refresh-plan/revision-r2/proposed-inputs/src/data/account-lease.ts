import type {SqlDatabase, SqlTransaction} from './repositories.ts';

export class AccountInactiveError extends Error {
  constructor() {super('The account data scope is no longer active'); this.name = 'AccountInactiveError';}
}

/** A revoked account object stays revoked even when another account opens the same database. */
export class AccountDatabaseLease implements SqlDatabase {
  private active = true;
  private watches = new Set<AbortController>();
  private database: SqlDatabase;
  constructor(database: SqlDatabase) {this.database = database;}
  assertActive(): void {if (!this.active) throw new AccountInactiveError();}
  invalidate(): void {this.active = false; this.watches.forEach(controller => controller.abort()); this.watches.clear();}
  async execute(sql: string, parameters?: unknown[]): Promise<unknown> {
    this.assertActive(); const result = await this.database.execute(sql, parameters); this.assertActive(); return result;
  }
  async getOptional<T>(sql: string, parameters?: unknown[]): Promise<T | null> {
    this.assertActive(); const result = await this.database.getOptional<T>(sql, parameters); this.assertActive(); return result;
  }
  async getAll<T>(sql: string, parameters?: unknown[]): Promise<T[]> {
    this.assertActive(); const result = await this.database.getAll<T>(sql, parameters); this.assertActive(); return result;
  }
  async writeTransaction<T>(work: (transaction: SqlTransaction) => Promise<T>): Promise<T> {
    this.assertActive();
    return this.database.writeTransaction(async transaction => {
      // SDK transactions may be queued until after the old account has already left.
      this.assertActive();
      const scoped: SqlTransaction = {
        execute: async (sql, parameters) => {this.assertActive(); const result = await transaction.execute(sql, parameters); this.assertActive(); return result;},
        getOptional: async <R>(sql: string, parameters?: unknown[]) => {this.assertActive(); const result = await transaction.getOptional<R>(sql, parameters); this.assertActive(); return result;},
      };
      const result = await work(scoped); this.assertActive(); return result;
    });
  }
  watch(sql: string, parameters: unknown[], handler: Parameters<SqlDatabase['watch']>[2], options: {signal: AbortSignal}): void {
    this.assertActive();
    const controller = new AbortController();
    const abort = () => controller.abort();
    this.watches.add(controller);
    controller.signal.addEventListener('abort', () => {this.watches.delete(controller); options.signal.removeEventListener('abort', abort);}, {once: true});
    options.signal.addEventListener('abort', abort, {once: true});
    if (options.signal.aborted) controller.abort();
    try {
      this.database.watch(sql, parameters, {
        onResult: result => {if (this.active && !controller.signal.aborted) handler.onResult(result);},
        onError: error => {if (this.active && !controller.signal.aborted) handler.onError?.(error);},
      }, {signal: controller.signal});
    } catch (error) {controller.abort(); throw error;}
  }
}
