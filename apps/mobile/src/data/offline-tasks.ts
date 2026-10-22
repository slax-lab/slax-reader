import {OfflineTaskRepository, type OfflineTaskState} from './repositories/offline-tasks.ts';
import {offlineFailure} from './offline-retry.ts';

interface Options {
  repository: OfflineTaskRepository;
  changed(keys: ReadonlySet<string>): void;
  now?: () => number;
  random?: () => number;
}
export class OfflineTaskRetries {
  private readonly options: Options;
  private states = new Map<string, OfflineTaskState | null>();
  private eligible = new Set<string>();
  private notified = new Set<string>();
  private explicit = new Set<string>();
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private enabled = true;

  constructor(options: Options) {this.options = options;}
  private now() {return (this.options.now ?? Date.now)();}
  start() {
    this.unsubscribe?.();
    this.unsubscribe = this.options.repository.watch(rows => {
      const next = new Map(rows.map(row => [row.id, row.task]));
      const changed = new Set<string>();
      for (const key of new Set([...this.states.keys(), ...next.keys()])) if (this.states.get(key) !== next.get(key) || this.states.has(key) !== next.has(key)) {changed.add(key); this.notified.delete(key);}
      this.states = next; this.options.changed(changed); this.schedule();
    });
  }

  allowed(key: string): boolean {
    const state = this.states.get(key);
    if (!this.states.has(key)) return true;
    return !!state && state.state !== 'denied' && (this.explicit.has(key) || state.retryAt <= this.now());
  }

  requestRetry(key: string) {
    const state = this.states.get(key);
    if (state?.state !== 'failed') return;
    this.explicit.add(key); this.options.changed(new Set([key])); this.schedule();
  }

  async begin(key: string, kind: OfflineTaskState['kind'], explicit = false): Promise<OfflineTaskState | null> {
    const retry = this.explicit.delete(key) || explicit;
    const ticket = await this.options.repository.begin(key, kind, this.now(), retry);
    if (ticket) this.states.set(key, ticket);
    return ticket;
  }

  async fail(key: string, ticket: OfflineTaskState, error: unknown) {
    const current = this.states.get(key);
    if (this.states.has(key) && current?.generation !== ticket.generation) return;
    const failure = offlineFailure(ticket.attempts, error, this.now(), this.options.random);
    this.states.set(key, {...ticket, ...failure}); this.notified.delete(key);
    await this.options.repository.fail(key, ticket, failure); this.schedule();
  }
  complete(key: string, ticket: OfflineTaskState) {return this.options.repository.complete(key, ticket);}

  update(keys: Iterable<string>, enabled: boolean) {this.eligible = new Set(keys); this.enabled = enabled; this.schedule();}
  private clearTimer() {if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined;}
  private schedule() {
    this.clearTimer();
    if (!this.enabled || !this.unsubscribe) return;
    let deadline = Infinity;
    const due = new Set<string>();
    for (const key of this.eligible) {
      const state = this.states.get(key);
      if (state?.state !== 'failed' || this.notified.has(key)) continue;
      if (state.retryAt <= this.now() || this.explicit.has(key)) {due.add(key); this.notified.add(key);}
      else deadline = Math.min(deadline, state.retryAt);
    }
    if (due.size) this.options.changed(due);
    if (Number.isFinite(deadline)) this.timer = setTimeout(() => {this.timer = undefined; this.schedule();}, Math.max(1, Math.min(2_147_483_647, deadline - this.now())));
  }

  stop() {this.clearTimer(); this.unsubscribe?.(); this.unsubscribe = undefined; this.notified.clear(); this.explicit.clear();}
}
