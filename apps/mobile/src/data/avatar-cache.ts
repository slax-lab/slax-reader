import {throwIfAborted} from '../utils/abort.ts';
export interface AvatarResources {resolve(slot: string, url: string, publish: (uri: string) => void): Promise<void>; subscribe?(listener: () => void): () => void}
export interface AvatarStorage {
  read(): Promise<string | null>; write(value: string): Promise<void>;
  exists(path: string): Promise<boolean>; uri(path: string): string | null;
  image(path: string, bytes: Uint8Array, signal: AbortSignal): Promise<string>; remove(path: string): Promise<void>;
}
interface Entry {url: string; path: string; bytes: number; refreshed: number; used: number}
export class AvatarCache implements AvatarResources {
  private invalidations = new Set<() => void>();
  private desired = new Map<string, string>();
  private downloadTail: Promise<unknown> = Promise.resolve();
  subscribe = (listener: () => void) => {this.invalidations.add(listener); return () => {this.invalidations.delete(listener);};};
  private entries: Record<string, Entry> = {}; private loaded?: Promise<void>;
  private requests = new Map<string, Promise<void>>(); private controller = new AbortController();
  private tail: Promise<unknown> = Promise.resolve(); private epoch = 0;
  private storage: AvatarStorage;
  private hash: (value: string) => string;
  private load: (url: string, signal: AbortSignal) => Promise<Uint8Array>;
  private now: () => number;
  constructor(storage: AvatarStorage, hash: (value: string) => string, load: (url: string, signal: AbortSignal) => Promise<Uint8Array>, now = Date.now) {this.storage = storage; this.hash = hash; this.load = load; this.now = now;}
  private async ready() {
    if (!this.loaded) this.loaded = this.storage.read().then(value => {
      if (value) {try {
        const parsed: unknown = JSON.parse(value);
        if (parsed && typeof parsed === 'object') for (const [key, raw] of Object.entries(parsed)) {
          const item = raw as Entry;
          if (/^[a-f0-9]+$/.test(key) && typeof item?.url === 'string' && /^[a-f0-9]+\.image$/.test(item.path) && Number.isFinite(item.refreshed) && Number.isFinite(item.used) && item.bytes > 0 && item.bytes <= 1024 * 1024) this.entries[key] = item;
        }
      } catch {}}
    });
    await this.loaded; throwIfAborted(this.controller.signal);
  }
  async resolve(slot: string, url: string, publish: (uri: string) => void) {
    const generation = this.epoch; await this.ready();
    const key = this.hash(slot), entry = this.entries[key]; this.desired.set(key, url);
    if (entry && await this.storage.exists(entry.path)) {
      throwIfAborted(this.controller.signal); if (generation !== this.epoch) return;
      const uri = this.storage.uri(entry.path); if (uri) publish(uri);
      entry.used = this.now();
      if (entry.url === url && this.now() - entry.refreshed < 24 * 60 * 60 * 1000) return;
    }
    let parsed: URL; try {parsed = new URL(url);} catch {return;}
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return;
    const identity = `${key}:${url}`;
    let request = this.requests.get(identity);
    if (!request) {
      request = (async () => {
        const download = this.downloadTail.then(() => {throwIfAborted(this.controller.signal); return this.load(url, this.controller.signal);});
        this.downloadTail = download.catch(() => {});
        const bytes = await download; throwIfAborted(this.controller.signal);
        if (generation !== this.epoch || this.desired.get(key) !== url || !bytes.length || bytes.length > 1024 * 1024) return;
        const path = `${this.hash(`${identity}:${this.now()}`)}.image`;
        await this.storage.image(path, bytes, this.controller.signal); throwIfAborted(this.controller.signal);
        const commit = this.tail.then(async () => {
          if (generation !== this.epoch || this.desired.get(key) !== url) return;
          const old = this.entries[key]; this.entries[key] = {url, path, bytes: bytes.length, refreshed: this.now(), used: this.now()};
          let size = Object.values(this.entries).reduce((sum, row) => sum + row.bytes, 0);
          for (const [evicted, row] of Object.entries(this.entries).sort((a, b) => a[1].used - b[1].used)) {
            if (size <= 20 * 1024 * 1024) break;
            if (evicted === key) continue;
            delete this.entries[evicted]; size -= row.bytes; await this.storage.remove(row.path);
          }
          await this.storage.write(JSON.stringify(this.entries));
          if (old && old.path !== path) await this.storage.remove(old.path);
        });
        this.tail = commit.catch(() => {}); await commit;
      })().finally(() => this.requests.delete(identity));
      this.requests.set(identity, request);
    }
    try {await request;} catch {return;}
    throwIfAborted(this.controller.signal);
    if (generation === this.epoch && this.entries[key]?.url === url) {const uri = this.storage.uri(this.entries[key]!.path); if (uri) publish(uri);}
  }
  async bytes() {await this.ready(); return Object.values(this.entries).reduce((sum, row) => sum + row.bytes, 0);}
  async clear() {
    this.epoch++; this.desired.clear(); for (const listener of this.invalidations) listener(); await this.ready(); await Promise.allSettled(this.requests.values()); await this.tail;
    for (const row of Object.values(this.entries)) await this.storage.remove(row.path);
    this.entries = {}; await this.storage.write('{}');
  }
  dispose() {this.epoch++; this.controller.abort(); this.desired.clear(); for (const listener of this.invalidations) listener(); this.invalidations.clear();}
}
