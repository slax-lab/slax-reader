import type {SqlDatabase} from './repositories.ts';
import {bookmarkCacheKey, LocalBookmarkRepository} from './repositories.ts';
import type {PreferenceStore, PreferenceValues} from './preferences.ts';
import type {ArticleFileCache} from './cache.ts';
import {normalizeImageUrl} from './cache-paths.ts';
import {rewriteReaderImageTransports} from '../reader/image-transports.ts';
import {throwIfAborted} from '../utils/abort.ts';

export const PERSONAL_CACHE_SQL = `SELECT id, updated_at, json_extract(metadata, '$.bookmark.status') AS status FROM sr_user_bookmark WHERE archive_status = 0 AND deleted_at IS NULL ORDER BY created_at DESC`;
export const COLLECTION_CACHE_SQL = `SELECT DISTINCT cb.id, collection.owner_id, json_extract(cb.metadata, '$.bookmark.status') AS status FROM sr_user_collection_subscriber subscriber INNER JOIN sr_user_collection collection ON collection.id = subscriber.collection_id INNER JOIN sr_collection_bookmark cb ON cb.owner_id = collection.owner_id ORDER BY collection.owner_id, coalesce(nullif(cb.starred_at, ''), cb.created_at) DESC`;
export const LOCAL_CACHE_SQL = 'SELECT id, data FROM ps_data_local__local_bookmark_info';
type Candidate = {id: string; owner_id?: string; status: string};
type Local = {id: string; data: string};
type Task = {id: string; key: string; owner?: string; domain: 'personal' | 'collection'};
const manual = (value: Record<string, unknown>) => value.is_auto_cached === 0 || value.is_auto_cached === false;
const downloaded = (value: Record<string, unknown>) => Number(value.is_downloaded) === 2;
function localData(value: string): Record<string, unknown> | null {try {const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;} catch {return null;}}
function decodeImageAttribute(value: string) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = {'&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>'};
    const known = named[entity.toLowerCase()]; if (known !== undefined) return known;
    const code = /^&#x/i.test(entity) ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\uFFFD';
  });
}
export function prepareAutomaticCacheContent(html: string) {
  const imageUrls: string[] = [];
  const content = rewriteReaderImageTransports(html, value => {
    const url = normalizeImageUrl(decodeImageAttribute(value));
    if (/^https?:\/\//i.test(url) && !imageUrls.includes(url)) imageUrls.push(url);
  });
  return {html: content, imageUrls};
}
export interface BackgroundCacheOptions {
  database: SqlDatabase;
  preferences: PreferenceStore;
  cache: Pick<ArticleFileCache, 'writeArticle' | 'removeArticle' | 'ensureImage'>;
  content(id: string, owner: string | undefined, signal: AbortSignal): Promise<string>;
  image(url: string, signal: AbortSignal): Promise<Uint8Array>;
  assertActive(): void;
}

/** Account-owned counterparts of source BackgroundDomain and CollectionBackgroundDomain. */
export class BackgroundArticleCache {
  private stopped = false;
  private paused = false;
  private started = false;
  private watcher = new AbortController();
  private unsubscribePreferences: (() => void) | null = null;
  private personal: Candidate[] = [];
  private collections: Candidate[] = [];
  private locals = new Map<string, Record<string, unknown>>();
  private settings: PreferenceValues = {};
  private ready = new Set<string>();
  private desired = new Map<string, Task>();
  private queued = new Set<string>();
  private queues = {personal: [] as Task[], collection: [] as Task[]};
  private running = {personal: 0, collection: 0};
  private jobs = new Map<string, {request: AbortController; completion: Promise<void>}>();
  private images = new Map<string, {request: AbortController; completion: Promise<Uint8Array>}>();
  private failedCollections = new Set<string>();
  private foreground = new Map<string, number>();
  private dirty = false;
  private reconciliation: Promise<void> | null = null;
  private local: LocalBookmarkRepository;
  private options: BackgroundCacheOptions;
  constructor(options: BackgroundCacheOptions) {this.options = options; this.local = new LocalBookmarkRepository(options.database);}
  private active() {if (this.stopped || this.paused) throw new Error('Automatic article cache inactive'); this.options.assertActive();}
  start() {
    if (this.started || this.paused) return;
    this.active(); this.started = true;
    const watcher = this.watcher;
    const watch = <T>(sql: string, name: string, update: (rows: T[]) => void) => this.options.database.watch(sql, [], {onResult: result => {
      if (this.stopped || watcher.signal.aborted) return; update((result.rows?._array ?? []) as T[]); this.ready.add(name); this.schedule();
    }}, {signal: watcher.signal});
    watch<Candidate>(PERSONAL_CACHE_SQL, 'personal', rows => {this.personal = rows;});
    watch<Candidate>(COLLECTION_CACHE_SQL, 'collection', rows => {this.collections = rows;});
    watch<Local>(LOCAL_CACHE_SQL, 'local', rows => {
      this.locals = new Map(rows.flatMap(row => {const data = localData(row.data); return data ? [[row.id, data] as const] : [];}));
    });
    this.unsubscribePreferences = this.options.preferences.subscribe(values => {this.settings = values; this.ready.add('settings'); this.schedule();});
    void this.options.preferences.read().then(values => {if (!this.stopped && !watcher.signal.aborted) {this.settings = values; this.ready.add('settings'); this.schedule();}}).catch(() => undefined);
  }
  async pause() {
    this.paused = true; this.watcher.abort(); this.unsubscribePreferences?.(); this.unsubscribePreferences = null;
    this.jobs.forEach(job => job.request.abort()); this.images.forEach(image => image.request.abort());
    this.desired.clear(); this.queues.personal = []; this.queues.collection = []; this.dirty = false;
    await this.reconciliation;
    await Promise.allSettled([...this.jobs.values()].map(job => job.completion));
    this.queued.clear();
  }
  resume() {
    if (this.stopped || !this.paused) return;
    this.paused = false; this.started = false; this.watcher = new AbortController(); this.ready.clear(); this.start();
  }
  /** Collection foreground reads reserve their cache before an eviction/download can start. */
  beginForeground(key: string): () => void {
    if (this.stopped) throw new Error('Automatic article cache stopped');
    this.options.assertActive(); this.foreground.set(key, (this.foreground.get(key) ?? 0) + 1);
    this.failedCollections.delete(key);
    return () => {
      const count = (this.foreground.get(key) ?? 1) - 1;
      if (count > 0) this.foreground.set(key, count); else this.foreground.delete(key);
      if (!this.stopped) this.schedule();
    };
  }
  private schedule() {
    if (this.stopped || this.paused || this.ready.size < 4) return;
    this.dirty = true;
    if (this.reconciliation) return;
    this.reconciliation = Promise.resolve().then(async () => {
      while (this.dirty && !this.stopped) {this.dirty = false; await this.reconcile();}
    }).catch(() => undefined).finally(() => {this.reconciliation = null; if (this.dirty && !this.stopped) this.schedule();});
  }
  private async reconcile() {
    this.active();
    const configured = typeof this.settings.cache_count === 'number' ? this.settings.cache_count : 50;
    const limit = configured === -1 ? Infinity : Math.max(0, configured);
    const window = new Set<string>(), desired = new Map<string, Task>(), ownerCounts = new Map<string, number>();
    let personalCount = 0;
    const candidates = [...this.personal.map(candidate => ({candidate, domain: 'personal' as const})), ...this.collections.map(candidate => ({candidate, domain: 'collection' as const}))];
    for (const {candidate, domain} of candidates) {
      if (candidate.status !== 'success') continue;
      const owner = domain === 'collection' ? candidate.owner_id : undefined;
      if (domain === 'collection' && (!owner || !owner.trim())) continue;
      const key = bookmarkCacheKey(candidate.id, owner), local = this.locals.get(key) ?? {};
      if (manual(local) && downloaded(local)) continue;
      const count = owner ? ownerCounts.get(owner) ?? 0 : personalCount;
      if (count >= limit) continue;
      if (owner) ownerCounts.set(owner, count + 1); else personalCount++;
      window.add(key);
      if (!downloaded(local) && !this.queued.has(key) && !this.foreground.has(key) && !(owner && this.failedCollections.has(key))) desired.set(key, {id: candidate.id, key, owner, domain});
    }
    this.desired = desired;
    const personalActive = new Set(this.personal.map(item => item.id));
    for (const [key, data] of this.locals) {
      if (manual(data) || !downloaded(data) || window.has(key) || this.queued.has(key) || this.foreground.has(key)) continue;
      await this.options.database.writeTransaction(async tx => {
        this.active();
        const row = await tx.getOptional<{data: string}>('SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?', [key]);
        const current = row ? localData(row.data) : null;
        if (!current || manual(current) || !downloaded(current) || this.queued.has(key) || this.foreground.has(key)) return;
        this.active(); this.options.cache.removeArticle(key);
        if (key.startsWith('collection-') || !personalActive.has(key)) await tx.execute('DELETE FROM ps_data_local__local_bookmark_info WHERE id = ?', [key]);
        else await tx.execute('UPDATE ps_data_local__local_bookmark_info SET data = ? WHERE id = ?', [JSON.stringify({...current, is_downloaded: 0, is_auto_cached: 1}), key]);
      });
    }
    this.pump();
  }
  private pump() {
    if (this.stopped || this.paused) return;
    for (const domain of ['personal', 'collection'] as const) {
      for (const [key, task] of this.desired) {
        if (task.domain !== domain || this.queues[domain].length >= 100) continue;
        this.desired.delete(key); this.queued.add(key); this.queues[domain].push(task);
      }
      while (this.running[domain] < 3 && this.queues[domain].length) {
        const task = this.queues[domain].shift()!;
        if (this.foreground.has(task.key)) {this.queued.delete(task.key); continue;}
        const request = new AbortController(); this.running[domain]++;
        const completion = this.download(task, request.signal).catch(() => undefined).finally(() => {
          this.running[domain]--; this.queued.delete(task.key); this.jobs.delete(task.key); this.pump();
        });
        this.jobs.set(task.key, {request, completion});
      }
    }
  }
  private image(url: string) {
    let image = this.images.get(url);
    if (!image) {
      const request = new AbortController();
      const completion = this.options.image(url, request.signal).finally(() => {if (this.images.get(url)?.request === request) this.images.delete(url);});
      image = {request, completion}; this.images.set(url, image);
    }
    return image.completion;
  }
  private async download(task: Task, signal: AbortSignal) {
    const active = () => {this.active(); throwIfAborted(signal);};
    try {
      active(); await this.local.setAutoDownloadStatus(task.key, 1); active();
      const content = prepareAutomaticCacheContent(await this.options.content(task.id, task.owner, signal)); active();
      this.options.cache.writeArticle(task.key, content.html);
      const settings = await this.options.preferences.read(); active();
      if ((settings.download_images ?? 1) === 1) for (const url of content.imageUrls) {
        try {await this.options.cache.ensureImage(task.key, url, async () => {const bytes = await this.image(url); active(); return bytes;});}
        catch (error) {active(); /* An individual image failure does not discard the HTML cache. */}
      }
      active(); await this.local.setAutoDownloadStatus(task.key, 2); this.failedCollections.delete(task.key);
    } catch (error) {
      if (this.stopped || signal.aborted) return;
      try {this.active(); if (task.owner) this.failedCollections.add(task.key); await this.local.setAutoDownloadStatus(task.key, 3);} catch { /* Revoked scopes cannot persist a late failure. */ }
    }
  }
  cancel() {
    if (this.stopped) return;
    this.stopped = true; this.watcher.abort(); this.unsubscribePreferences?.(); this.unsubscribePreferences = null;
    this.jobs.forEach(job => job.request.abort()); this.images.forEach(image => image.request.abort());
    this.desired.clear(); this.queues.personal = []; this.queues.collection = [];
  }
  async stop() {this.cancel(); await this.reconciliation; await Promise.allSettled([...this.jobs.values()].map(job => job.completion));}
  /** Verification checkpoint; does not enable caching or replace any native acceptance evidence. */
  async settled() {await Promise.resolve(); await this.reconciliation; await Promise.allSettled([...this.jobs.values()].map(job => job.completion)); if (this.jobs.size || this.reconciliation) await this.settled();}
}
