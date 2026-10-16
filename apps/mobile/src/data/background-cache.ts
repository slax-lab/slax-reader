import type {SqlDatabase} from './repositories.ts';
import {bookmarkCacheKey, LocalBookmarkRepository} from './repositories.ts';
import type {PreferenceStore, PreferenceValues} from './preferences.ts';
import type {ArticleFileCache} from './cache.ts';
import {normalizeImageUrl} from './cache-paths.ts';
import {rewriteReaderImageTransports} from '../reader/image-transports.ts';
import {throwIfAborted} from '../utils/abort.ts';
import {isNetworkTransportError} from './transport-errors.ts';
import {isOfflineCredentialError} from '../domain/credential-readiness.ts';

import type {PdfDescriptor} from '@slax-reader/contracts/pdf';
import type {PdfBlockCache} from './pdf-cache.ts';

export const PERSONAL_CACHE_SQL = `SELECT id, type AS content_type, updated_at, json_extract(metadata, '$.bookmark.status') AS status FROM sr_user_bookmark WHERE archive_status = 0 AND deleted_at IS NULL ORDER BY created_at DESC`;
export const COLLECTION_CACHE_SQL = `SELECT DISTINCT cb.id, collection.owner_id, json_extract(cb.metadata, '$.bookmark.type') AS content_type, json_extract(cb.metadata, '$.bookmark.status') AS status FROM sr_user_collection_subscriber subscriber INNER JOIN sr_user_collection collection ON collection.id = subscriber.collection_id INNER JOIN sr_collection_bookmark cb ON cb.owner_id = collection.owner_id ORDER BY collection.owner_id, coalesce(nullif(cb.starred_at, ''), cb.created_at) DESC`;
export const LOCAL_CACHE_SQL = 'SELECT id, data FROM ps_data_local__local_bookmark_info';
type Candidate = {id: string; owner_id?: string; status: string; content_type?: number | string};
type Local = {id: string; data: string};
type Task = {id: string; key: string; owner?: string; domain: 'personal' | 'collection'; pdf?: boolean};
type PdfTask = Task & {jobId: string; priority: boolean; run(signal: AbortSignal): Promise<unknown>; resolve(value: unknown): void; reject(error: unknown): void; promise: Promise<unknown>};
type PdfIntent = {task: Task; manual: boolean; completion?: Promise<void>};
const PDF_BLOCK_BYTES = 256 * 1024;
const isPdf = (value: unknown) => value === 'pdf' || Number(value) === 2;
const abortError = () => Object.assign(new Error('PDF request cancelled'), {name: 'AbortError'});
const denied = (error: unknown) => !!error && typeof error === 'object' && 'status' in error && [401, 403, 404, 412].includes(Number(error.status));
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {signal.removeEventListener('abort', abort); reject(abortError());};
    signal.addEventListener('abort', abort, {once: true});
    promise.then(value => {signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(value);}, error => {signal.removeEventListener('abort', abort); reject(error);});
    if (signal.aborted) abort();
  });
}
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
  pdf?: {
    cache: Pick<PdfBlockCache, 'metadata' | 'setMetadata' | 'read' | 'writeBlock' | 'status' | 'verify' | 'remove' | 'invalidate'>;
    metadata(id: string, signal: AbortSignal): Promise<PdfDescriptor>;
    range(id: string, documentId: string, begin: number, end: number, signal: AbortSignal, expectedSize?: number): Promise<Uint8Array>;
  };
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
  private queues = {personal: [] as (Task | PdfTask)[], collection: [] as (Task | PdfTask)[]};
  private pdfTasks = new Map<string, PdfTask>();
  private pdfIntents = new Map<string, PdfIntent>();
  private deniedPdf = new Set<string>();
  private evictions = new Map<string, {completion: Promise<void>; release(): void}>();
  private manualRequests = new Set<string>();
  private pdfEpochs = new Map<string, number>();
  private running = {personal: 0, collection: 0};
  private pumping = false;
  private jobs = new Map<string, {request: AbortController; completion: Promise<void>}>();
  private images = new Map<string, {request: AbortController; completion: Promise<Uint8Array>}>();
  private failedCollections = new Set<string>();
  private foreground = new Map<string, number>();
  private dirty = false;
  private reconciliation: Promise<void> | null = null;
  private local: LocalBookmarkRepository;
  private options: BackgroundCacheOptions;
  constructor(options: BackgroundCacheOptions) {this.options = options; this.local = new LocalBookmarkRepository(options.database);}
  private active() {if (this.stopped || this.paused) throw abortError(); this.options.assertActive();}
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
    this.interruptPdf();
    this.desired.clear(); this.queues.personal = []; this.queues.collection = []; this.dirty = false;
    await this.reconciliation;
    await Promise.allSettled([...this.jobs.values()].map(job => job.completion));
    await Promise.allSettled([...this.pdfIntents.values()].flatMap(intent => intent.completion ? [intent.completion] : []));
    this.queued.clear();
  }
  resume() {
    if (this.stopped || !this.paused) return;
    this.paused = false; this.started = false; this.watcher = new AbortController(); this.ready.clear(); this.start();
    this.failedCollections.clear();
    for (const [key, intent] of this.pdfIntents) {
      if (intent.manual) void this.fillPdf(intent).catch(() => undefined);
      else this.pdfIntents.delete(key);
    }
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
  private pdfOptions() {if (!this.options.pdf) throw new Error('PDF cache unavailable'); return this.options.pdf;}
  private pdfTask(id: string, owner?: string): Task {
    if (!id || !/^[\w-]+$/.test(id) || (owner !== undefined && !/^[\w-]+$/.test(owner))) throw new Error('Invalid PDF access context');
    return {id, key: bookmarkCacheKey(id, owner), owner, domain: owner ? 'collection' : 'personal', pdf: true};
  }
  private enqueuePdf<T>(task: Task, suffix: string, priority: boolean, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.active();
    const eviction = this.evictions.get(task.key);
    if (eviction) return eviction.completion.then(() => this.enqueuePdf(task, suffix, priority, run));
    const jobId = `pdf:${task.key}:${suffix}`;
    const existing = this.pdfTasks.get(jobId);
    if (existing) {
      if (priority) {
        existing.priority = true;
        const queue = this.queues[task.domain], index = queue.indexOf(existing);
        if (index >= 0) {queue.splice(index, 1); queue.unshift(existing);}
      }
      return existing.promise as Promise<T>;
    }
    let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((yes, no) => {resolve = yes; reject = no;});
    const queued: PdfTask = {...task, jobId, priority, run, promise, resolve, reject};
    this.pdfTasks.set(jobId, queued);
    if (priority) this.queues[task.domain].unshift(queued); else this.queues[task.domain].push(queued);
    this.pump();
    return promise as Promise<T>;
  }
  private async invalidatePdf(task: Task, error: unknown) {
    if (!denied(error)) return;
    this.options.assertActive(); this.deniedPdf.add(task.key); this.failedCollections.add(task.key);
    const affected = [...this.pdfTasks.values()].filter(item => item.key === task.key);
    for (const item of affected) this.jobs.get(item.jobId)?.request.abort();
    this.pdfIntents.delete(task.key);
    try {
      await this.pdfOptions().cache.invalidate(task.key);
      this.options.assertActive(); await this.local.update(task.key, {is_downloaded: 0});
    } finally {
      this.queues.personal = this.queues.personal.filter(item => !('jobId' in item) || !affected.includes(item));
      this.queues.collection = this.queues.collection.filter(item => !('jobId' in item) || !affected.includes(item));
      for (const item of affected) {if (this.pdfTasks.get(item.jobId) === item) this.pdfTasks.delete(item.jobId); item.reject(error);}
    }
  }
  async getPdfMetadata(id: string, owner?: string, signal?: AbortSignal, priority = true): Promise<PdfDescriptor> {
    this.active(); throwIfAborted(signal);
    const task = this.pdfTask(id, owner), pdf = this.pdfOptions();
    return waitFor(this.enqueuePdf(task, 'metadata', priority, async request => {
      let descriptor: PdfDescriptor;
      try {descriptor = await pdf.metadata(id, request);}
      catch (error) {
        if (denied(error)) {await this.invalidatePdf(task, error); throw error;}
        this.active(); throwIfAborted(request);
        if ((isNetworkTransportError(error) || isOfflineCredentialError(error)) && !this.deniedPdf.has(task.key)) {
          const cached = await pdf.cache.metadata(task.key);
          this.active(); throwIfAborted(request); if (cached) return {...cached, url: `/v1/bookmark/pdf?bookmark_uid=${encodeURIComponent(id)}`};
        }
        throw error;
      }
      this.active(); throwIfAborted(request);
      const previous = await pdf.cache.metadata(task.key);
      this.active(); throwIfAborted(request);
      await pdf.cache.setMetadata(task.key, descriptor);
      this.active(); throwIfAborted(request);
      if (previous && (previous.document_id !== descriptor.document_id || previous.size !== descriptor.size)) await this.local.update(task.key, {is_downloaded: 0});
      this.active(); throwIfAborted(request); this.deniedPdf.delete(task.key);
      return descriptor;
    }), signal);
  }
  async readPdfRange(id: string, descriptor: PdfDescriptor, begin: number, end: number, owner?: string, signal?: AbortSignal, priority = true): Promise<Uint8Array> {
    this.active(); throwIfAborted(signal);
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > descriptor.size || end - begin > 1024 * 1024) throw new Error('Invalid PDF byte range');
    const task = this.pdfTask(id, owner), pdf = this.pdfOptions();
    const eviction = this.evictions.get(task.key);
    if (eviction) await waitFor(eviction.completion, signal);
    const epoch = this.pdfEpochs.get(task.key) ?? 0;
    const check = () => {this.active(); throwIfAborted(signal); if ((this.pdfEpochs.get(task.key) ?? 0) !== epoch) throw abortError(); if (this.deniedPdf.has(task.key)) throw new Error('PDF access revoked');};
    check();
    const cached = await pdf.cache.read(task.key, descriptor, begin, end); check();
    if (cached) return cached;
    const requests: Promise<unknown>[] = [];
    for (let start = Math.floor(begin / PDF_BLOCK_BYTES) * PDF_BLOCK_BYTES; start < end; start += PDF_BLOCK_BYTES) {
      const block = start, stop = Math.min(start + PDF_BLOCK_BYTES, descriptor.size);
      requests.push(this.enqueuePdf(task, `${descriptor.document_id}:${block}`, priority, async request => {
        this.active(); throwIfAborted(request);
        if (this.deniedPdf.has(task.key)) throw new Error('PDF access revoked');
        if (await pdf.cache.read(task.key, descriptor, block, stop)) return;
        this.active(); throwIfAborted(request);
        try {
          const bytes = await pdf.range(id, descriptor.document_id, block, stop, request, descriptor.size);
          this.active(); throwIfAborted(request);
          if (this.deniedPdf.has(task.key)) throw new Error('PDF access revoked');
          await pdf.cache.writeBlock(task.key, descriptor, block, bytes);
          this.active(); throwIfAborted(request);
        } catch (error) {if (denied(error)) await this.invalidatePdf(task, error); else {this.active(); throwIfAborted(request);} throw error;}
      }));
    }
    await waitFor(Promise.all(requests), signal); check();
    const value = await pdf.cache.read(task.key, descriptor, begin, end); check();
    if (!value) throw new Error('PDF range unavailable');
    return value;
  }
  async pdfCacheStatus(id: string, owner?: string) {
    this.active(); const result = await this.pdfOptions().cache.status(this.pdfTask(id, owner).key); this.active(); return result;
  }
  async cachePdf(id: string, owner?: string): Promise<void> {
    this.active();
    const task = this.pdfTask(id, owner);
    this.manualRequests.add(task.key);
    try {
      await this.evictions.get(task.key)?.completion; this.active();
      await this.local.update(task.key, {is_auto_cached: 0, is_downloaded: 1, pdf_cache: {id, owner: owner ?? null}});
      this.active();
    } finally {this.manualRequests.delete(task.key);}
    let intent = this.pdfIntents.get(task.key);
    if (intent) intent.manual = true; else {intent = {task, manual: true}; this.pdfIntents.set(task.key, intent);}
    return this.fillPdf(intent);
  }
  private fillPdf(intent: PdfIntent): Promise<void> {
    if (intent.completion) return intent.completion;
    const {task} = intent, pdf = this.pdfOptions();
    const check = () => {this.active(); if (this.pdfIntents.get(task.key) !== intent) throw abortError();};
    this.queued.add(task.key);
    const completion = (async () => {
      const descriptor = await this.getPdfMetadata(task.id, task.owner, undefined, false);
      check();
      if (!intent.manual) await this.local.setAutoDownloadStatus(task.key, 1);
      for (let begin = 0; begin < descriptor.size; begin += PDF_BLOCK_BYTES) {
        check();
        await this.readPdfRange(task.id, descriptor, begin, Math.min(begin + PDF_BLOCK_BYTES, descriptor.size), task.owner, undefined, false);
      }
      check();
      if (!await pdf.cache.verify(task.key, descriptor)) {
        check(); await pdf.cache.remove(task.key); throw new Error('PDF checksum verification failed');
      }
      check();
      if (intent.manual) await this.local.update(task.key, {is_downloaded: 2}); else await this.local.setAutoDownloadStatus(task.key, 2);
      this.failedCollections.delete(task.key); this.pdfIntents.delete(task.key);
    })().catch(async error => {
      if (!this.stopped && !this.paused && this.pdfIntents.get(task.key) === intent) {
        this.failedCollections.add(task.key);
        if (intent.manual) await this.local.update(task.key, {is_downloaded: 3}); else await this.local.setAutoDownloadStatus(task.key, 3);
      }
      throw error;
    }).finally(() => {if (intent.completion === completion) intent.completion = undefined; this.queued.delete(task.key);});
    intent.completion = completion;
    return completion;
  }
  async forgetPdf(key: string) {
    this.active();
    this.pdfEpochs.set(key, (this.pdfEpochs.get(key) ?? 0) + 1);
    const intent = this.pdfIntents.get(key);
    if (!intent && ![...this.pdfTasks.values()].some(task => task.key === key)) return;
    this.failedCollections.delete(key); this.pdfIntents.delete(key); this.desired.delete(key);
    const pending: Promise<void>[] = intent?.completion ? [intent.completion] : [];
    for (const task of this.pdfTasks.values()) if (task.key === key) {
      task.reject(abortError());
      const job = this.jobs.get(task.jobId); if (job) {job.request.abort(); pending.push(job.completion);}
      this.pdfTasks.delete(task.jobId);
    }
    this.queues.personal = this.queues.personal.filter(task => task.key !== key);
    this.queues.collection = this.queues.collection.filter(task => task.key !== key);
    await Promise.allSettled(pending); this.active(); this.queued.delete(key);
  }
  private interruptPdf() {
    for (const task of this.pdfTasks.values()) task.reject(abortError());
    this.pdfTasks.clear();
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
      const pdf = isPdf(candidate.content_type) && !!this.options.pdf;
      if (pdf && manual(local) && !local.pdf_cache && Number(local.is_downloaded) === 0) continue;
      const count = owner ? ownerCounts.get(owner) ?? 0 : personalCount;
      if (!(pdf && manual(local))) {
        if (count >= limit) continue;
        if (owner) ownerCounts.set(owner, count + 1); else personalCount++;
      }
      window.add(key);
      if (!downloaded(local) && !this.queued.has(key) && !this.foreground.has(key) && !((owner || pdf) && this.failedCollections.has(key))) desired.set(key, {id: candidate.id, key, owner, domain, pdf});
    }
    for (const [key, data] of this.locals) {
      const pin = data.pdf_cache as {id?: unknown; owner?: unknown} | undefined;
      if (!this.options.pdf || !manual(data) || downloaded(data) || this.queued.has(key) || this.failedCollections.has(key) || typeof pin?.id !== 'string') continue;
      const task = this.pdfTask(pin.id, typeof pin.owner === 'string' ? pin.owner : undefined);
      if (task.key === key) desired.set(key, task);
    }
    this.desired = desired;
    const personalActive = new Set(this.personal.map(item => item.id));
    const settings = this.settings, personal = this.personal, collections = this.collections;
    for (const [key, data] of this.locals) {
      if (manual(data) || !downloaded(data) || window.has(key) || this.queued.has(key) || this.foreground.has(key) || this.manualRequests.has(key)) continue;
      let release!: () => void;
      const completion = new Promise<void>(resolve => {release = resolve;});
      this.evictions.set(key, {completion, release});
      let retained = false;
      const check = () => {
        this.active();
        if (this.foreground.has(key) || this.manualRequests.has(key) || manual(this.locals.get(key) ?? {}) || settings !== this.settings || personal !== this.personal || collections !== this.collections) {retained = true; throw abortError();}
      };
      try {
        await this.forgetPdf(key); check();
        const pdf = await this.options.pdf?.cache.metadata(key); check();
        await this.options.database.writeTransaction(async tx => {
          check();
          const row = await tx.getOptional<{data: string}>('SELECT data FROM ps_data_local__local_bookmark_info WHERE id = ?', [key]);
          check();
          const current = row ? localData(row.data) : null;
          if (!current || manual(current) || !downloaded(current) || this.queued.has(key)) return;
          await this.options.cache.removeArticle(key, check); check();
          if (!pdf && (key.startsWith('collection-') || !personalActive.has(key))) await tx.execute('DELETE FROM ps_data_local__local_bookmark_info WHERE id = ?', [key]);
          else await tx.execute('UPDATE ps_data_local__local_bookmark_info SET data = ? WHERE id = ?', [JSON.stringify({...current, is_downloaded: 0, is_auto_cached: 1}), key]);
        });
      } catch (error) {if (!retained) throw error;}
      finally {this.evictions.delete(key); release();}
    }
    this.pump();
  }
  private pump() {
    if (this.stopped || this.paused || this.pumping) return;
    this.pumping = true;
    try {for (const domain of ['personal', 'collection'] as const) {
      for (const [key, task] of this.desired) {
        if (task.domain !== domain || this.queues[domain].length >= 100) continue;
        this.desired.delete(key); this.queued.add(key); this.queues[domain].push(task);
      }
      while (this.running[domain] < 3 && this.queues[domain].length) {
        const task = this.queues[domain].shift()!;
        if (!('jobId' in task) && this.foreground.has(task.key)) {this.queued.delete(task.key); continue;}
        if (!('jobId' in task) && task.pdf) {
          let intent = this.pdfIntents.get(task.key);
          if (!intent) {intent = {task, manual: manual(this.locals.get(task.key) ?? {})}; this.pdfIntents.set(task.key, intent);}
          void this.fillPdf(intent).catch(() => undefined);
          continue;
        }
        const request = new AbortController(); this.running[domain]++;
        const jobId = 'jobId' in task ? task.jobId : task.key;
        const finish = () => {if ('jobId' in task && this.pdfTasks.get(jobId) === task) this.pdfTasks.delete(jobId);};
        const work = 'jobId' in task ? task.run(request.signal).then(value => {finish(); throwIfAborted(request.signal); task.resolve(value);}, error => {finish(); task.reject(error);}) : this.download(task, request.signal);
        const completion = work.catch(error => {if ('jobId' in task) task.reject(error);}).finally(() => {
          this.running[domain]--;
          if ('jobId' in task) {if (this.pdfTasks.get(jobId) === task) this.pdfTasks.delete(jobId);}
          else this.queued.delete(task.key);
          if (this.jobs.get(jobId)?.request === request) this.jobs.delete(jobId); this.pump();
        });
        this.jobs.set(jobId, {request, completion});
      }
    }} finally {this.pumping = false;}
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
    this.interruptPdf();
    this.desired.clear(); this.queues.personal = []; this.queues.collection = [];
  }
  async stop() {
    this.cancel(); await this.reconciliation; await Promise.allSettled([...this.jobs.values()].map(job => job.completion));
    await Promise.allSettled([...this.pdfIntents.values()].flatMap(intent => intent.completion ? [intent.completion] : [])); this.pdfIntents.clear();
  }
  /** Verification checkpoint; does not enable caching or replace any native acceptance evidence. */
  async settled() {
    await Promise.resolve(); await this.reconciliation;
    await Promise.allSettled([...this.jobs.values()].map(job => job.completion));
    await Promise.allSettled([...this.pdfIntents.values()].flatMap(intent => intent.completion ? [intent.completion] : []));
    if (this.jobs.size || this.reconciliation) await this.settled();
  }
}
