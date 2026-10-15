import type {ArticleFileCache} from './cache.ts';
import {OfflineManifestRepository, type OfflineManifestHint} from './repositories/offline-manifests.ts';
import {ResourceScheduler} from './resource-scheduler.ts';
import {imageFailure} from './offline-retry.ts';
import {throwIfAborted} from '../utils/abort.ts';

interface Options {
  manifests: OfflineManifestRepository;
  resources: ResourceScheduler;
  cache: Pick<ArticleFileCache, 'ensureImage'>;
  image(url: string, signal: AbortSignal): Promise<Uint8Array>;
  eligible(key: string): boolean;
  assertActive(): void;
  now?: () => number;
  random?: () => number;
}

export class OfflineImages {
  private readonly options: Options;
  private readonly now: () => number;
  private hints = new Map<string, OfflineManifestHint>();
  private jobs = new Map<string, {controller: AbortController; completion: Promise<void>; hint: OfflineManifestHint}>();
  private failures = new Map<string, {hint: OfflineManifestHint; retryAt: number}>();
  private excluded = new Map<string, number>();
  private unsubscribe?: () => void;
  private enabled = true;
  private paused = true;
  private online = true;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(options: Options) {this.options = options; this.now = options.now ?? Date.now;}

  start() {
    if (this.stopped || !this.paused) return;
    this.paused = false;
    this.unsubscribe = this.options.manifests.watch(rows => {
      this.hints = new Map(rows.map(row => [row.id, row]));
      for (const [key, job] of this.jobs) if (this.hints.get(key)?.generation !== job.hint.generation) job.controller.abort();
      for (const key of this.failures.keys()) if (!this.hints.has(key)) this.failures.delete(key);
      this.pump();
    });
  }

  configure(enabled: boolean, online = this.online) {
    this.enabled = enabled; this.online = online;
    if (!enabled || !online) this.jobs.forEach(job => job.controller.abort());
    this.pump();
  }

  private clearTimer() {if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined;}
  private eligible(key: string) {return !this.stopped && !this.paused && this.enabled && this.online && !this.excluded.has(key) && this.options.eligible(key);}

  update() {
    for (const [key, job] of this.jobs) if (!this.eligible(key)) job.controller.abort();
    this.pump();
  }

  private pump() {
    this.clearTimer();
    if (this.stopped || this.paused || !this.enabled || !this.online) return;
    let deadline = Infinity;
    for (const domain of ['personal', 'collection'] as const) {
      if ([...this.jobs.values()].some(job => (job.hint.owner ? 'collection' : 'personal') === domain)) continue;
      let selected: OfflineManifestHint | undefined;
      for (const hint of this.hints.values()) {
        if ((hint.owner ? 'collection' : 'personal') !== domain || !this.eligible(hint.id)) continue;
        const failure = this.failures.get(hint.id);
        const retryAt = Math.max(hint.retryAt, failure?.hint === hint ? failure.retryAt : 0);
        if (retryAt <= this.now()) {selected = hint; break;}
        deadline = Math.min(deadline, retryAt);
      }
      if (selected) this.run(selected, domain);
    }
    if (Number.isFinite(deadline)) this.timer = setTimeout(() => {this.timer = undefined; this.pump();}, Math.max(1, Math.min(2_147_483_647, deadline - this.now())));
  }

  private run(hint: OfflineManifestHint, domain: 'personal' | 'collection') {
    const controller = new AbortController(), key = hint.id;
    const check = () => {
      this.options.assertActive(); throwIfAborted(controller.signal);
      if (!this.eligible(key) || this.hints.get(key)?.generation !== hint.generation) throw Object.assign(new Error('Offline images are inactive'), {name: 'AbortError'});
    };
    const completion = Promise.resolve().then(async () => {
      check();
      const manifest = await this.options.manifests.read(key); check();
      if (!manifest || manifest.generation !== hint.generation || manifest.body !== 'ready') return;
      for (const image of manifest.images) {
        check();
        if (!['pending', 'failed'].includes(image.state) || image.retryAt > this.now()) continue;
        const next = {...image, state: 'ready' as const, retryAt: 0};
        try {
          const uri = await this.options.resources.acquire({identity: {kind: 'image', context: key, resource: image.url, version: hint.generation, policy: 'credentialless'},
            host: new URL(image.url).origin, domain, lane: 'image', run: signal => this.options.cache.ensureImage(key, image.url, async () => {
              const bytes = await this.options.image(image.url, signal); check(); throwIfAborted(signal);
              if (!bytes.length) throw new Error('Empty offline image response');
              return bytes;
            }, signal, false),
          }, 'background', controller.signal);
          check();
          if (!uri) throw new Error('Offline image did not produce a committed resource');
        } catch (error) {
          check();
          const failure = imageFailure(image, error, this.now(), this.options.random);
          await this.options.manifests.image(key, hint.generation, failure); check();
          continue;
        }
        await this.options.manifests.image(key, hint.generation, next); check();
      }
    }).catch(error => {
      if (error instanceof Error && error.name === 'AbortError' || this.stopped || this.paused) return;
      const current = this.hints.get(key);
      if (current) this.failures.set(key, {hint: current, retryAt: this.now() + 30_000});
    }).finally(() => {if (this.jobs.get(key)?.controller === controller) this.jobs.delete(key); this.pump();});
    this.jobs.set(key, {controller, completion, hint});
  }

  async hold(key: string): Promise<() => void> {
    this.excluded.set(key, (this.excluded.get(key) ?? 0) + 1);
    const job = this.jobs.get(key); job?.controller.abort();
    await Promise.allSettled([job?.completion, this.options.resources.cancelWhere(identity => identity.kind === 'image' && identity.context === key)]);
    let released = false;
    return () => {
      if (released) return; released = true;
      const count = (this.excluded.get(key) ?? 1) - 1;
      if (count) this.excluded.set(key, count); else this.excluded.delete(key);
      this.pump();
    };
  }

  async pause() {
    this.paused = true; this.clearTimer(); this.unsubscribe?.(); this.unsubscribe = undefined;
    this.jobs.forEach(job => job.controller.abort());
    await Promise.allSettled([...this.jobs.values()].map(job => job.completion));
  }

  cancel() {this.stopped = true; this.paused = true; this.clearTimer(); this.unsubscribe?.(); this.unsubscribe = undefined; this.jobs.forEach(job => job.controller.abort());}
  async stop() {this.cancel(); await this.settled(); this.hints.clear(); this.failures.clear();}
  async settled() {while (this.jobs.size) await Promise.allSettled([...this.jobs.values()].map(job => job.completion));}
}
