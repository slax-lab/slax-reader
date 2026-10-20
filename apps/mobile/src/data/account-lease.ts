import type {SqlDatabase, SqlSyncStream, SqlSyncStreamSubscription, SqlTransaction} from './repositories.ts';

export class AccountInactiveError extends Error {
  constructor() {super('The account data scope is no longer active'); this.name = 'AccountInactiveError';}
}

/** A revoked account object stays revoked even when another account opens the same database. */
export class AccountDatabaseLease implements SqlDatabase {
  private active = true;
  private accountController = new AbortController();
  readonly accountSignal = this.accountController.signal;
  private watches = new Set<AbortController>();
  private subscriptions = new Set<SqlSyncStreamSubscription>();
  private database: SqlDatabase;
  private writes = new Set<Promise<unknown>>();
  private protect: <T>(work: (check: () => void) => Promise<T>) => Promise<T>;
  constructor(database: SqlDatabase, protect: <T>(work: (check: () => void) => Promise<T>) => Promise<T> = work => work(() => {})) {this.database = database; this.protect = protect;}
  private writing<T>(work: (check: () => void) => Promise<T>): Promise<T> {
    const result = this.protect(work);
    this.writes.add(result);
    void result.finally(() => this.writes.delete(result)).catch(() => undefined);
    return result;
  }
  async drainWrites(): Promise<void> {while (this.writes.size) await Promise.allSettled([...this.writes]);}
  assertActive(): void {if (!this.active) throw new AccountInactiveError();}
  invalidate(): void {
    if (!this.active) return;
    this.active = false;
    this.accountController.abort();
    this.watches.forEach(controller => controller.abort()); this.watches.clear();
    this.subscriptions.forEach(subscription => subscription.unsubscribe()); this.subscriptions.clear();
  }
  syncStream(name: string, parameters?: Record<string, string>): SqlSyncStream {
    this.assertActive();
    if (!this.database.syncStream) throw new Error('PowerSync stream subscriptions are not supported by this database');
    const stream = this.database.syncStream(name, parameters);
    if (typeof stream?.subscribe !== 'function') throw new Error('PowerSync stream subscriptions are not supported by this database');
    return {subscribe: async options => {
      this.assertActive();
      const subscription = await stream.subscribe(options);
      if (typeof subscription?.unsubscribe !== 'function') throw new Error('PowerSync did not return a comment subscription handle');
      let released = false;
      const scoped: SqlSyncStreamSubscription = {waitForFirstSync: subscription.waitForFirstSync ? async signal => {
        this.assertActive();
        await subscription.waitForFirstSync!(signal);
        this.assertActive();
      } : undefined, unsubscribe: () => {
        if (released) return;
        released = true; this.subscriptions.delete(scoped);
        try {void Promise.resolve(subscription.unsubscribe()).catch(() => {});} catch {}
      }};
      if (!this.active) {scoped.unsubscribe(); throw new AccountInactiveError();}
      this.subscriptions.add(scoped);
      return scoped;
    }};
  }
  async execute(sql: string, parameters?: unknown[]): Promise<unknown> {
    return this.writeTransaction(transaction => transaction.execute(sql, parameters));
  }
  async getOptional<T>(sql: string, parameters?: unknown[]): Promise<T | null> {
    this.assertActive(); const result = await this.database.getOptional<T>(sql, parameters); this.assertActive(); return result;
  }
  async getAll<T>(sql: string, parameters?: unknown[]): Promise<T[]> {
    this.assertActive(); const result = await this.database.getAll<T>(sql, parameters); this.assertActive(); return result;
  }
  async writeTransaction<T>(work: (transaction: SqlTransaction) => Promise<T>): Promise<T> {
    this.assertActive();
    return this.writing(check => this.database.writeTransaction(async transaction => {
      const active = () => {this.assertActive(); check();};
      active();
      const scoped: SqlTransaction = {
        execute: async (sql, parameters) => {active(); const result = await transaction.execute(sql, parameters); active(); return result;},
        getOptional: async <R>(sql: string, parameters?: unknown[]) => {active(); const result = await transaction.getOptional<R>(sql, parameters); active(); return result;},
      };
      const result = await work(scoped); active(); return result;
    }));
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
