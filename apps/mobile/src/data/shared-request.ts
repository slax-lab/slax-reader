import {throwIfAborted} from '../utils/abort.ts';

type Flight<T> = {controller: AbortController; consumers: Set<object>; current(): void; promise: Promise<T>};

export class SharedRequestCache<T> {
  private flight?: Flight<T>;
  private cached?: {value: T; expiresAt: number; current(): void};
  private readonly now: () => number;
  private readonly lifetime: number;

  constructor(lifetime = 60_000, now = Date.now) {this.lifetime = lifetime; this.now = now;}

  invalidate(): void {
    this.cached = undefined;
    const previous = this.flight;
    this.flight = undefined;
    previous?.controller.abort();
  }

  read(load: (signal: AbortSignal) => Promise<T>, current: () => void, signal?: AbortSignal): Promise<T> {
    try {throwIfAborted(signal); current();} catch (error) {return Promise.reject(error);}
    const cached = this.cached;
    if (cached) {
      try {
        cached.current();
        if (cached.expiresAt > this.now()) return Promise.resolve(cached.value);
      } catch {}
      this.cached = undefined;
    }
    if (this.flight) {
      try {this.flight.current();} catch {this.invalidate();}
    }
    let flight = this.flight;
    if (!flight || flight.controller.signal.aborted) {
      const controller = new AbortController();
      flight = {controller, consumers: new Set(), current, promise: Promise.resolve(undefined as T)};
      const owned = flight;
      const check = () => {throwIfAborted(controller.signal); current();};
      owned.promise = Promise.resolve().then(() => {check(); return load(controller.signal);}).then(value => {
        check();
        if (this.flight === owned) this.cached = {value, expiresAt: this.now() + this.lifetime, current};
        return value;
      }).finally(() => {if (this.flight === owned) this.flight = undefined;});
      this.flight = owned;
    }
    const owned = flight, consumer = {};
    owned.consumers.add(consumer);
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const release = () => {
        signal?.removeEventListener('abort', abort);
        owned.controller.signal.removeEventListener('abort', cancelled);
        owned.consumers.delete(consumer);
        if (!owned.consumers.size && this.flight === owned) {this.flight = undefined; owned.controller.abort();}
      };
      const finish = (work: () => void) => {
        if (settled) return;
        settled = true;
        release();
        work();
      };
      const abort = () => finish(() => {try {throwIfAborted(signal);} catch (error) {reject(error);}});
      const cancelled = () => finish(() => {try {throwIfAborted(owned.controller.signal);} catch (error) {reject(error);}});
      signal?.addEventListener('abort', abort, {once: true});
      owned.controller.signal.addEventListener('abort', cancelled, {once: true});
      owned.promise.then(value => finish(() => {
        try {throwIfAborted(signal); current(); resolve(value);} catch (error) {reject(error);}
      }), error => finish(() => reject(error)));
      if (signal?.aborted) abort();
      else if (owned.controller.signal.aborted) cancelled();
    });
  }
}
