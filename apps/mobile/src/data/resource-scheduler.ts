import {throwIfAborted} from '../utils/abort.ts';
import {DataTransportError} from './transport-errors.ts';

export type ResourceIdentity = {kind: 'article' | 'image' | 'pdf'; context: string; resource: string; version?: string; policy?: string};
export type ResourcePriority = 'foreground' | 'background';
export type ResourceRequest<T> = {
  identity: ResourceIdentity;
  host: string;
  domain: 'personal' | 'collection';
  lane: 'body' | 'image';
  run(signal: AbortSignal): Promise<T>;
};
export type ResourceLimits = {
  active: number; host: number; domain: number;
  background: number; backgroundHost: number; backgroundDomain: number;
  images: number; backgroundImages: number; backgroundDomainImages: number; backgroundHostImages: number;
  queued: number; foregroundBurst: number; agingMs: number;
};
export const RESOURCE_LIMITS: Readonly<ResourceLimits> = {
  active: 6, host: 3, domain: 3,
  background: 5, backgroundHost: 2, backgroundDomain: 2,
  images: 3, backgroundImages: 2, backgroundDomainImages: 1, backgroundHostImages: 1,
  queued: 256, foregroundBurst: 4, agingMs: 30_000,
};
const aborted = () => Object.assign(new Error('Resource request cancelled'), {name: 'AbortError'});
export class ResourceQueueFullError extends Error {
  constructor() {super('Resource request queue is full'); this.name = 'ResourceQueueFullError';}
}
type Consumer = {priority: ResourcePriority; finish(error: unknown, value?: unknown): void};
type Job = ResourceRequest<unknown> & {
  key: string; sequence: number; createdAt: number; controller: AbortController;
  consumers: Set<Consumer>; state: 'queued' | 'running' | 'settled'; completion: Promise<void>;
};

export class ResourceScheduler {
  private readonly scope: string;
  private readonly assertActive: () => void;
  private readonly limits: ResourceLimits;
  private readonly now: () => number;
  private jobs = new Map<string, Job>();
  private running = new Set<Job>();
  private sequence = 0;
  private foregroundStreak = 0;
  private pumping = false;
  private scheduled = false;
  private paused = false;
  private closed = false;
  private online = true;

  constructor(scope: string, assertActive: () => void, limits: Partial<ResourceLimits> = {}, now = Date.now) {
    this.scope = scope; this.assertActive = assertActive; this.limits = {...RESOURCE_LIMITS, ...limits}; this.now = now;
    for (const [name, limit] of Object.entries(this.limits)) if (!Number.isFinite(limit) || limit < 0 || !Number.isInteger(limit)) throw new Error(`Invalid resource limit: ${name}`);
    if (!this.limits.active || !this.limits.host || !this.limits.domain || !this.limits.queued) throw new Error('Resource capacity must be positive');
  }

  private key(identity: ResourceIdentity) {return JSON.stringify([this.scope, identity.kind, identity.context, identity.resource, identity.version ?? '', identity.policy ?? '']);}
  private priority(job: Job): ResourcePriority {return [...job.consumers].some(consumer => consumer.priority === 'foreground') ? 'foreground' : 'background';}
  private check() {if (this.closed || this.paused) throw aborted(); this.assertActive(); if (!this.online) throw new DataTransportError('network', 'api');}

  setOnline(online: boolean): Promise<void> {
    if (this.online === online) return Promise.resolve();
    this.online = online;
    if (!online) return this.cancelWhere(() => true, new DataTransportError('network', 'api'));
    this.schedule(); return Promise.resolve();
  }

  acquire<T>(request: ResourceRequest<T>, priority: ResourcePriority = 'background', signal?: AbortSignal): Promise<T> {
    try {this.check(); throwIfAborted(signal);} catch (error) {return Promise.reject(error);}
    const key = this.key(request.identity);
    let job = this.jobs.get(key);
    if (job && (job.host !== request.host || job.domain !== request.domain || job.lane !== request.lane)) return Promise.reject(new Error('Incompatible resource request'));
    if (!job) {
      if ([...this.jobs.values()].filter(value => value.state === 'queued').length >= this.limits.queued) return Promise.reject(new ResourceQueueFullError());
      job = {...request, identity: {...request.identity}, key, sequence: this.sequence++, createdAt: this.now(), controller: new AbortController(), consumers: new Set(), state: 'queued', completion: Promise.resolve()};
      this.jobs.set(key, job);
    }
    const owned = job;
    const promise = new Promise<T>((resolve, reject) => {
      let settled = false;
      const abort = () => consumer.finish(aborted());
      const consumer: Consumer = {priority, finish: (error, value) => {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort', abort); owned.consumers.delete(consumer);
        if (!owned.consumers.size && owned.state !== 'settled') this.cancelJob(owned, aborted());
        if (error !== undefined) reject(error);
        else {try {this.check(); throwIfAborted(signal); resolve(value as T);} catch (reason) {reject(reason);}}
      }};
      owned.consumers.add(consumer); signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) abort();
    });
    this.schedule();
    return promise;
  }

  private cancelJob(job: Job, error: unknown) {
    if (job.state === 'settled') return;
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    const queued = job.state === 'queued';
    job.state = 'settled'; job.controller.abort();
    for (const consumer of [...job.consumers]) consumer.finish(error);
    if (queued) this.schedule();
  }

  cancelWhere(predicate: (identity: Readonly<ResourceIdentity>) => boolean, error: unknown = aborted()): Promise<void> {
    const jobs = new Set([...this.jobs.values(), ...this.running]);
    const cancelled = [...jobs].filter(job => predicate(job.identity));
    for (const job of cancelled) this.cancelJob(job, error);
    return Promise.all(cancelled.map(job => job.completion)).then(() => undefined);
  }

  cancelQueued(predicate: (identity: Readonly<ResourceIdentity>) => boolean) {
    for (const job of this.jobs.values()) if (job.state === 'queued' && this.priority(job) === 'background' && predicate(job.identity)) this.cancelJob(job, aborted());
  }

  pause(): Promise<void> {this.paused = true; return this.cancelWhere(() => true);}
  resume() {if (this.closed) return; this.paused = false; this.schedule();}
  close(): Promise<void> {this.closed = true; return this.pause();}

  private eligible(job: Job) {
    const active = [...this.running], limits = this.limits, background = this.priority(job) === 'background';
    if (active.length >= limits.active || active.filter(value => value.host === job.host).length >= limits.host || active.filter(value => value.domain === job.domain).length >= limits.domain) return false;
    if (job.lane === 'image' && active.filter(value => value.lane === 'image').length >= limits.images) return false;
    if (!background) return true;
    const automatic = active.filter(value => this.priority(value) === 'background');
    if (automatic.length >= limits.background || automatic.filter(value => value.host === job.host).length >= limits.backgroundHost || automatic.filter(value => value.domain === job.domain).length >= limits.backgroundDomain) return false;
    if (job.lane !== 'image') return true;
    const images = automatic.filter(value => value.lane === 'image');
    return images.length < limits.backgroundImages && images.filter(value => value.domain === job.domain).length < limits.backgroundDomainImages && images.filter(value => value.host === job.host).length < limits.backgroundHostImages;
  }

  private select(): Job | undefined {
    const available = [...this.jobs.values()].filter(job => job.state === 'queued' && job.consumers.size && this.eligible(job));
    const bySequence = (a: Job, b: Job) => a.sequence - b.sequence;
    const background = available.filter(job => this.priority(job) === 'background').sort(bySequence)[0];
    const foreground = available.filter(job => this.priority(job) === 'foreground').sort(bySequence)[0];
    if (background && (!foreground || this.foregroundStreak >= this.limits.foregroundBurst || this.now() - background.createdAt >= this.limits.agingMs)) return background;
    return foreground ?? background;
  }

  private schedule() {
    if (this.scheduled || this.closed || this.paused) return;
    this.scheduled = true;
    void Promise.resolve().then(() => {this.scheduled = false; this.pump();});
  }

  private pump() {
    if (this.pumping || this.closed || this.paused) return;
    this.pumping = true;
    try {
      this.check();
      let job: Job | undefined;
      while ((job = this.select())) {
        const current = job;
        current.state = 'running'; this.running.add(current);
        this.foregroundStreak = this.priority(current) === 'foreground' ? this.foregroundStreak + 1 : 0;
        current.completion = Promise.resolve().then(() => {this.check(); throwIfAborted(current.controller.signal); return current.run(current.controller.signal);}).then(value => {
          this.check(); throwIfAborted(current.controller.signal); this.finish(current, undefined, value);
        }).catch(error => this.finish(current, error === undefined ? new Error('Resource request failed') : error)).finally(() => {this.running.delete(current); this.schedule();});
      }
    } catch (error) {void this.cancelWhere(() => true, error);}
    finally {this.pumping = false;}
  }

  private finish(job: Job, error: unknown, value?: unknown) {
    if (job.state === 'settled') return;
    job.state = 'settled';
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    for (const consumer of [...job.consumers]) consumer.finish(error, value);
  }

  async settled(): Promise<void> {
    await Promise.resolve();
    while (this.running.size || (this.jobs.size && !this.paused && !this.closed)) {
      this.pump();
      if (!this.running.size) return;
      await Promise.all([...this.running].map(job => job.completion));
    }
  }
}
