import {CacheEvictionRepository, type CacheEvictionIntent} from './repositories/cache-evictions.ts';
import type {CacheRemovalFiles} from './cache-removal.ts';
import {throwIfAborted} from '../utils/abort.ts';

interface Options {
  repository: CacheEvictionRepository;
  files: CacheRemovalFiles;
  active(): void;
  accountActive(): void;
  protected(key: string): boolean;
  hold(key: string): Promise<() => void>;
  beforeStage?(key: string): Promise<void>;
}
export class CacheEvictions {
  private readonly options: Options;
  private readonly jobs = new Map<string, {controller: AbortController; promise: Promise<void>}>();
  private recovery?: Promise<void>;
  private failures = new Map<string, unknown>();
  constructor(options: Options) {this.options = options;}
  reset() {this.recovery = undefined; this.failures.clear();}
  has(key: string) {return this.jobs.has(key) || this.failures.has(key);}
  cancel(key: string) {this.jobs.get(key)?.controller.abort();}
  cancelAll() {for (const job of this.jobs.values()) job.controller.abort();}
  async wait(key: string) {
    this.cancel(key); await this.recover();
    await this.jobs.get(key)?.promise.catch(() => undefined); this.options.accountActive();
    if (this.failures.has(key)) {
      const intent = await this.options.repository.current(key);
      if (intent) await this.run(key, () => this.restore(key, intent));
      else this.failures.delete(key);
    }
    this.options.accountActive();
  }
  private async restore(key: string, intent: CacheEvictionIntent) {
    this.options.accountActive();
    if (intent.state === 'committed') await this.options.files.purge(key, intent.generation);
    else await this.options.files.restore(key, intent.generation);
    this.options.accountActive(); await this.options.repository.finish(key, intent);
  }
  recover(): Promise<void> {
    if (this.recovery) return this.recovery;
    const work = (async () => {
      const pending = await this.options.repository.pending(); this.options.accountActive();
      for (const {key, intent} of pending) {
        await this.run(key, async () => this.restore(key, intent)).catch(() => undefined);
      }
    })();
    this.recovery = work;
    void work.catch(() => {if (this.recovery === work) this.recovery = undefined;});
    return work;
  }
  private run(key: string, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const previous = this.jobs.get(key); if (previous) return previous.promise;
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => work(controller.signal)).then(() => {this.failures.delete(key);}).catch(error => {
      this.failures.set(key, error);
      throw error;
    }).finally(() => {if (this.jobs.get(key)?.controller === controller) this.jobs.delete(key);});
    this.jobs.set(key, {controller, promise}); return promise;
  }
  evict(key: string, discardRow: boolean, current: () => boolean): Promise<void> {
    return this.run(key, async signal => {
      const check = () => {this.options.active(); throwIfAborted(signal); if (!current() || this.options.protected(key)) throw Object.assign(new Error('Cache retention changed'), {name: 'AbortError'});};
      let release: (() => void) | undefined, intent: CacheEvictionIntent | null = null, beginning = false;
      try {
        check(); release = await this.options.hold(key); check();
        await this.options.beforeStage?.(key); check();
        beginning = true;
        intent = await this.options.repository.begin(key, discardRow, check); check(); if (!intent) return;
        await this.options.files.stage(key, intent.generation, signal); check();
        if (!await this.options.repository.commit(key, intent, check)) {
          await this.restore(key, intent); intent = null; return;
        }
        intent = {...intent, state: 'committed'};
        await this.restore(key, intent); intent = null;
      } catch (error) {
        if (beginning) {
          this.options.accountActive();
          const persisted = await this.options.repository.current(key);
          if (persisted && (!intent || persisted.generation === intent.generation)) await this.restore(key, persisted);
          else if (persisted) throw error;
        }
        if (!(error instanceof Error && error.name === 'AbortError')) throw error;
      } finally {release?.();}
    });
  }
  async settled() {
    await this.recovery?.catch(() => undefined);
    while (this.jobs.size) await Promise.allSettled([...this.jobs.values()].map(job => job.promise));
  }
}
