import type {SqlDatabase} from './repositories.ts';
import {bookmarkCacheKey, LocalBookmarkRepository} from './repositories.ts';
import type {PreferenceStore, PreferenceValues} from './preferences.ts';
import type {ArticleFileCache} from './cache.ts';
import {normalizeImageUrl} from './cache-paths.ts';
import {rewriteReaderImageTransports} from '../reader/image-transports.ts';
import {throwIfAborted} from '../utils/abort.ts';
import {DataTransportError, isNetworkTransportError} from './transport-errors.ts';
import {isOfflineCredentialError} from '../domain/credential-readiness.ts';

import type {PdfDescriptor} from '@slax-reader/contracts/pdf';
import type {PdfBlockCache} from './pdf-cache.ts';
import type {PdfAcquisitionResult, PdfCompleteConsumer} from './pdf-acquisition.ts';

import {CacheStateRepository, type CacheCandidate, type CacheLocalState, type CacheTask as Task} from './repositories/cache-state.ts';
import {AutomaticCachePlan} from './cache-plan.ts';
import {ResourceScheduler} from './resource-scheduler.ts';
import {OfflineManifestRepository} from './repositories/offline-manifests.ts';
import {OfflineImages} from './offline-images.ts';
import {OfflineTaskRepository, type OfflineTaskState} from './repositories/offline-tasks.ts';
import {OfflineTaskRetries} from './offline-tasks.ts';
import {CacheEvictionRepository} from './repositories/cache-evictions.ts';
import {CacheEvictions} from './cache-eviction.ts';
import type {CacheRemovalFiles} from './cache-removal.ts';
export {PERSONAL_CACHE_SQL, COLLECTION_CACHE_SQL, LOCAL_CACHE_SQL} from './repositories/cache-state.ts';
type PdfIntent = {task: Task; manual: boolean; completion?: Promise<void>};
type LegacyEviction = {completion: Promise<void>; release: () => void};
const PDF_BLOCK_BYTES = 256 * 1024;
const COLLECTION_CONTEXT_PREFIX = 'collection:';
const articleContext = (owner?: string) => owner ? `${COLLECTION_CONTEXT_PREFIX}${owner}` : 'personal';
const articleContextOwner = (context: string) => context.startsWith(COLLECTION_CONTEXT_PREFIX) ? context.slice(COLLECTION_CONTEXT_PREFIX.length) : undefined;
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
  cache: Pick<ArticleFileCache, 'writeArticle' | 'removeArticle' | 'ensureImage'> & Partial<Pick<ArticleFileCache, 'contentFingerprint' | 'articleFingerprint'>>;
  removal?: CacheRemovalFiles;
  resourceScope?: string;
  cacheScope?: string;
  identifier?: () => string;
  now?: () => number;
  random?: () => number;
  apiOrigin?: string;
  content(id: string, owner: string | undefined, signal: AbortSignal): Promise<string>;
  image(url: string, signal: AbortSignal): Promise<Uint8Array>;
  assertActive(): void;
  assertCachedAccess?(): void;
  pdf?: {
    cache: Pick<PdfBlockCache, 'metadata' | 'setMetadata' | 'read' | 'writeBlock' | 'status' | 'verify' | 'remove' | 'invalidate'> & Partial<Pick<PdfBlockCache, 'writeComplete'>>;
    metadata(id: string, signal: AbortSignal): Promise<PdfDescriptor>;
    range(id: string, documentId: string, begin: number, end: number, signal: AbortSignal, expectedSize?: number): Promise<Uint8Array>;
    acquire?(id: string, descriptor: PdfDescriptor, begin: number, end: number, complete: PdfCompleteConsumer, signal: AbortSignal): Promise<PdfAcquisitionResult>;
  };
}

/** Account-owned counterparts of source BackgroundDomain and CollectionBackgroundDomain. */
export class BackgroundArticleCache {
  private stopped = false;
  private paused = false;
  private online = true;
  private networkReady = true;
  private networkRevision = 0;
  private networkDrain: Promise<void> = Promise.resolve();
  private started = false;
  private watcher = new AbortController();
  private unsubscribePreferences: (() => void) | null = null;
  private personal: CacheCandidate[] = [];
  private collections: CacheCandidate[] = [];
  private locals = new Map<string, CacheLocalState>();
  private settings = {limit: 50, downloadImages: true};
  private ready = new Set<string>();
  private desired = new Map<string, Task>();
  private reconsider = new Set<string>();
  private plan: AutomaticCachePlan;
  private queued = new Set<string>();
  private queues = {personal: [] as Task[], collection: [] as Task[]};
  private pdfIntents = new Map<string, PdfIntent>();
  private deniedPdf = new Set<string>();
  private readonly removalEvictions?: CacheEvictions;
  private readonly legacyEvictions = new Map<string, LegacyEviction>();
  private manualRequests = new Set<string>();
  private pdfEpochs = new Map<string, number>();
  private pdfRangeSupport = new Map<string, boolean>();
  private pdfFullTransfers = new Map<string, {signal: AbortSignal; join(priority: boolean, signal?: AbortSignal): Promise<{begin: number; end: number}>}>();
  private running = {personal: 0, collection: 0};
  private pumping = false;
  private jobs = new Map<string, {request: AbortController; completion: Promise<void>}>();
  private articleBodies = new Map<string, {content?: string}>();
  private images: OfflineImages;
  private manifests: OfflineManifestRepository;
  private resources: ResourceScheduler;
  private retries: OfflineTaskRetries;
  private failedCollections = new Set<string>();
  private foreground = new Map<string, number>();
  private dirty = false;
  private reconciliation: Promise<void> | null = null;
  private recoveryReady = false;
  private evictionRecoveryReady = false;
  private recovered = new Set<string>();
  private local: LocalBookmarkRepository;
  private options: BackgroundCacheOptions;
  constructor(options: BackgroundCacheOptions) {
    this.options = options; this.local = new LocalBookmarkRepository(options.database); this.plan = new AutomaticCachePlan(!!options.pdf);
    this.resources = new ResourceScheduler(options.resourceScope ?? 'account-instance', () => this.active());
    const identifier = options.identifier ?? (() => `${Date.now()}-${Math.random().toString(36).slice(2)}`), scope = options.cacheScope ?? 'account-instance';
    this.manifests = new OfflineManifestRepository(options.database, scope, identifier, () => this.active());
    this.images = new OfflineImages({manifests: this.manifests, resources: this.resources, cache: options.cache, image: options.image, assertActive: () => this.active(),
      eligible: key => this.ready.size === 5 && this.evictionRecoveryReady && !this.hasEviction(key) && (this.plan.window.has(key) || !!this.locals.get(key)?.manual || this.foreground.has(key)), now: options.now, random: options.random});
    if (options.removal) {
      this.removalEvictions = new CacheEvictions({repository: new CacheEvictionRepository(options.database, scope, identifier, () => this.options.assertActive()), files: options.removal,
        active: () => this.active(), accountActive: () => this.options.assertActive(), protected: key => this.isProtected(key), hold: key => this.images.hold(key),
        beforeStage: key => this.forgetPdf(key)});
    }
    this.retries = new OfflineTaskRetries({repository: new OfflineTaskRepository(options.database, scope, identifier, () => this.active()), now: options.now, random: options.random,
      changed: keys => {
        for (const key of keys) {this.reconsider.add(key); if (this.retries.allowed(key)) this.failedCollections.delete(key);}
        this.ready.add('retries'); this.schedule();
      }});
  }
  private active() {if (this.stopped || this.paused) throw abortError(); this.options.assertActive();}
  private hasEviction(key: string) {return this.removalEvictions?.has(key) ?? this.legacyEvictions.has(key);}
  async waitForAccess(key: string, signal?: AbortSignal): Promise<void> {
    if (this.removalEvictions && !this.evictionRecoveryReady) {
      await waitFor(this.removalEvictions.recover().then(() => {this.evictionRecoveryReady = true;}), signal);
    }
    if (this.removalEvictions?.has(key)) await waitFor(this.removalEvictions.wait(key), signal);
    const legacy = this.legacyEvictions.get(key);
    if (legacy) await waitFor(legacy.completion, signal);
  }
  private waitForEviction(key: string, signal?: AbortSignal): Promise<void> {return this.waitForAccess(key, signal);}
  private isProtected(key: string) {
    return this.foreground.has(key) || this.manualRequests.has(key) || !!this.locals.get(key)?.manual || this.plan.window.has(key);
  }
  async setOnline(online: boolean): Promise<void> {
    if (this.stopped || this.online === online) return;
    this.online = online; this.networkReady = false; const revision = ++this.networkRevision;
    this.images.configure(this.settings.downloadImages, false); this.retries.update(this.plan.tasks.keys(), false);
    if (!online) {
      const work = [...this.jobs.values()].map(job => job.completion);
      const pdf = [...this.pdfIntents.values()].flatMap(intent => intent.completion ? [intent.completion] : []);
      this.networkDrain = Promise.allSettled([this.resources.setOnline(false), ...work, ...pdf]).then(() => undefined);
      await this.networkDrain; return;
    }
    await this.networkDrain;
    if (this.stopped || revision !== this.networkRevision || !this.online) return;
    await this.resources.setOnline(true);
    if (this.stopped || revision !== this.networkRevision || !this.online) return;
    this.networkReady = true; this.images.configure(this.settings.downloadImages, true);
    for (const key of this.plan.tasks.keys()) this.reconsider.add(key);
    if (!this.paused) {
      for (const intent of this.pdfIntents.values()) if (intent.manual && !this.deniedPdf.has(intent.task.key)) void this.fillPdf(intent).catch(() => undefined);
      this.schedule(); this.pump();
    }
  }
  start() {
    if (this.started || this.paused) return;
    this.active(); this.started = true;
    const watcher = this.watcher, repository = new CacheStateRepository(this.options.database);
    const own = (cleanup: () => void) => {if (watcher.signal.aborted) cleanup(); else watcher.signal.addEventListener('abort', cleanup, {once: true});};
    const update = <T>(name: string, apply: (rows: T[]) => void) => (rows: T[]) => {
      if (this.stopped || watcher.signal.aborted) return;
      apply(rows); this.ready.add(name); this.schedule();
    };
    own(repository.watchPersonal(update('personal', rows => {this.personal = rows; this.plan.setCandidates('personal', rows);})));
    own(repository.watchCollections(update('collection', rows => {this.collections = rows; this.plan.setCandidates('collection', rows);})));
    own(repository.watchLocal(update('local', rows => {this.locals = new Map(rows.map(row => [row.id, row])); this.plan.setLocal(rows);})));
    const settings = (values: PreferenceValues) => {
      if (this.stopped || watcher.signal.aborted) return;
      const configured = typeof values.cache_count === 'number' ? values.cache_count : 50;
      const next = {limit: configured === -1 ? Infinity : Math.max(0, configured), downloadImages: (values.download_images ?? 1) === 1};
      if (this.ready.has('settings') && Object.is(next.limit, this.settings.limit) && next.downloadImages === this.settings.downloadImages) return;
      this.settings = next; this.images.configure(next.downloadImages);
      this.plan.setLimit(next.limit); this.ready.add('settings'); this.schedule();
    };
    let observed = false;
    this.unsubscribePreferences = this.options.preferences.subscribe(values => {observed = true; settings(values);});
    void this.options.preferences.read().then(values => {if (!observed) settings(values);}).catch(() => undefined);
    this.retries.start(); this.images.start();
  }
  async pause() {
    this.paused = true; this.watcher.abort(); this.unsubscribePreferences?.(); this.unsubscribePreferences = null; this.retries.stop();
    this.jobs.forEach(job => job.request.abort()); this.removalEvictions?.cancelAll();
    const drained = Promise.all([this.images.pause(), this.resources.pause()]);
    this.desired.clear(); this.queues.personal = []; this.queues.collection = []; this.dirty = false;
    await this.reconciliation;
    await Promise.allSettled([...this.jobs.values()].map(job => job.completion));
    await Promise.allSettled([...this.pdfIntents.values()].flatMap(intent => intent.completion ? [intent.completion] : []));
    await Promise.allSettled([this.removalEvictions?.settled()]);
    await drained; this.queued.clear();
  }
  resume() {
    if (this.stopped || !this.paused) return;
    this.paused = false; this.started = false; this.watcher = new AbortController(); this.ready.clear(); this.recoveryReady = false; this.evictionRecoveryReady = false; this.recovered.clear();
    this.removalEvictions?.reset(); this.resources.resume();
    this.plan = new AutomaticCachePlan(!!this.options.pdf); this.failedCollections.clear(); this.start();
    for (const [key, intent] of this.pdfIntents) {
      if (intent.manual) {if (this.networkReady) void this.fillPdf(intent).catch(() => undefined);}
      else this.pdfIntents.delete(key);
    }
  }
  /** Mounted Readers reserve their cache before an eviction/download can start. */
  beginForeground(key: string): () => void {
    if (this.stopped) throw new Error('Automatic article cache stopped');
    this.options.assertActive(); this.foreground.set(key, (this.foreground.get(key) ?? 0) + 1);
    this.removalEvictions?.cancel(key);
    this.retries.requestRetry(key); this.failedCollections.delete(key);
    let released = false;
    return () => {
      if (released) return; released = true;
      const count = (this.foreground.get(key) ?? 1) - 1;
      if (count > 0) this.foreground.set(key, count); else this.foreground.delete(key);
      this.reconsider.add(key);
      if (!this.stopped) this.schedule();
    };
  }
  private pdfOptions() {if (!this.options.pdf) throw new Error('PDF cache unavailable'); return this.options.pdf;}
  private pdfTask(id: string, owner?: string): Task {
    if (!id || !/^[\w-]+$/.test(id) || (owner !== undefined && !/^[\w-]+$/.test(owner))) throw new Error('Invalid PDF access context');
    return {id, key: bookmarkCacheKey(id, owner), owner, domain: owner ? 'collection' : 'personal', pdf: true};
  }
  private enqueuePdf<T>(task: Task, suffix: string, priority: boolean, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.active(); throwIfAborted(signal);
    if (this.hasEviction(task.key)) return this.waitForEviction(task.key, signal).then(() => this.enqueuePdf(task, suffix, priority, run, signal));
    return this.resources.acquire({identity: {kind: 'pdf', context: task.key, resource: suffix, version: String(this.pdfEpochs.get(task.key) ?? 0)},
      host: this.options.apiOrigin ?? 'api', domain: task.domain, lane: 'body', run,
    }, priority ? 'foreground' : 'background', signal);
  }
  private async invalidatePdf(task: Task, error: unknown) {
    if (!denied(error)) return;
    this.options.assertActive(); this.deniedPdf.add(task.key); this.failedCollections.add(task.key);
    this.pdfIntents.delete(task.key);
    try {
      await this.pdfOptions().cache.invalidate(task.key);
      this.options.assertActive(); await this.local.update(task.key, {is_downloaded: 0});
    } finally {void this.resources.cancelWhere(identity => identity.kind === 'pdf' && identity.context === task.key, error);}
  }
  async getPdfMetadata(id: string, owner?: string, signal?: AbortSignal, priority = true): Promise<PdfDescriptor> {
    this.active(); throwIfAborted(signal);
    const task = this.pdfTask(id, owner), pdf = this.pdfOptions();
    await this.waitForEviction(task.key, signal);
    if (!this.online) {
      const epoch = this.pdfEpochs.get(task.key) ?? 0;
      const check = () => {this.active(); throwIfAborted(signal); this.options.assertCachedAccess?.(); if (this.deniedPdf.has(task.key) || epoch !== (this.pdfEpochs.get(task.key) ?? 0)) throw new Error('PDF access revoked');};
      check(); const cached = await pdf.cache.metadata(task.key); check();
      if (cached) return {...cached, url: `/v1/bookmark/pdf?bookmark_uid=${encodeURIComponent(id)}`};
      throw new DataTransportError('network', 'pdf-metadata');
    }
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
    }, signal), signal);
  }
  async readPdfRange(id: string, descriptor: PdfDescriptor, begin: number, end: number, owner?: string, signal?: AbortSignal, priority = true): Promise<Uint8Array> {
    this.active(); throwIfAborted(signal);
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > descriptor.size || end - begin > 1024 * 1024) throw new Error('Invalid PDF byte range');
    const task = this.pdfTask(id, owner), pdf = this.pdfOptions();
    await this.waitForEviction(task.key, signal);
    const epoch = this.pdfEpochs.get(task.key) ?? 0;
    const check = () => {this.active(); throwIfAborted(signal); this.options.assertCachedAccess?.(); if ((this.pdfEpochs.get(task.key) ?? 0) !== epoch) throw abortError(); if (this.deniedPdf.has(task.key)) throw new Error('PDF access revoked');};
    check();
    const cached = await pdf.cache.read(task.key, descriptor, begin, end); check();
    if (cached) return cached;
    const requests: Promise<unknown>[] = [];
    const identity = JSON.stringify([task.key, descriptor.document_id, descriptor.size, epoch]);
    const acquisition = !!(pdf.acquire && pdf.cache.writeComplete);
    const rangeSupport = (supported: boolean) => {
      this.pdfRangeSupport.delete(identity); this.pdfRangeSupport.set(identity, supported);
      if (this.pdfRangeSupport.size > 256) this.pdfRangeSupport.delete(this.pdfRangeSupport.keys().next().value!);
    };
    for (let start = Math.floor(begin / PDF_BLOCK_BYTES) * PDF_BLOCK_BYTES; start < end; start += PDF_BLOCK_BYTES) {
      const block = start, stop = Math.min(start + PDF_BLOCK_BYTES, descriptor.size);
      const acquire = async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          check();
          if (await pdf.cache.read(task.key, descriptor, block, stop)) {check(); return;}
          check();
          const suffix = `${descriptor.document_id}:${descriptor.size}:${acquisition && !this.pdfRangeSupport.get(identity) ? 'acquisition' : block}`;
          const run = async (request: AbortSignal): Promise<{begin: number; end: number}> => {
            const assertRequest = () => {
              this.active(); throwIfAborted(request);
              if (this.deniedPdf.has(task.key) || (this.pdfEpochs.get(task.key) ?? 0) !== epoch) throw new Error('PDF access revoked');
            };
            assertRequest();
            if (await pdf.cache.read(task.key, descriptor, block, stop)) {assertRequest(); return {begin: block, end: stop};}
            assertRequest();
            const pending = this.pdfFullTransfers.get(identity);
            if (pending && !pending.signal.aborted) return pending.join(priority, request);
            try {
              if (acquisition) {
                const result = await pdf.acquire!(id, descriptor, block, stop, async (chunks, streamSignal, discard) => {
                  assertRequest(); rangeSupport(false);
                  const existing = this.pdfFullTransfers.get(identity);
                  if (existing && existing.signal !== request && !existing.signal.aborted) {
                    discard(); await existing.join(priority, request); assertRequest(); return false;
                  }
                  this.pdfFullTransfers.set(identity, {signal: request, join: (priority, signal) => this.enqueuePdf(task, suffix, priority, run, signal)});
                  const complete = await pdf.cache.verify(task.key, descriptor); assertRequest();
                  if (complete) {discard(); return false;}
                  await pdf.cache.writeComplete!(task.key, descriptor, chunks, streamSignal);
                }, request);
                assertRequest();
                if (result.kind === 'complete') {
                  if (result.size !== descriptor.size) throw new Error('Invalid acquired PDF size');
                  rangeSupport(false); return {begin: 0, end: descriptor.size};
                }
                if (result.begin !== block || result.bytes.byteLength !== stop - block) throw new Error('Invalid acquired PDF range');
                await pdf.cache.writeBlock(task.key, descriptor, block, result.bytes, request); assertRequest(); rangeSupport(true);
              } else {
                const bytes = await pdf.range(id, descriptor.document_id, block, stop, request, descriptor.size);
                assertRequest(); await pdf.cache.writeBlock(task.key, descriptor, block, bytes, request);
              }
              assertRequest(); return {begin: block, end: stop};
            } catch (error) {if (denied(error)) await this.invalidatePdf(task, error); else assertRequest(); throw error;}
            finally {if (this.pdfFullTransfers.get(identity)?.signal === request) this.pdfFullTransfers.delete(identity);}
          };
          const pending = this.pdfFullTransfers.get(identity);
          const covered = await (pending && !pending.signal.aborted ? pending.join(priority, signal) : this.enqueuePdf(task, suffix, priority, run, signal));
          check(); const ready = await pdf.cache.read(task.key, descriptor, block, stop); check();
          if (ready) return;
          if (covered.begin <= block && covered.end >= stop) throw new Error('Acquired PDF range was not committed');
        }
        throw new Error('PDF acquisition made no progress');
      };
      requests.push(acquire());
    }
    await waitFor(Promise.all(requests), signal); check();
    const value = await pdf.cache.read(task.key, descriptor, begin, end); check();
    if (!value) throw new Error('PDF range unavailable');
    return value;
  }
  async pdfCacheStatus(id: string, owner?: string) {
    this.active(); const key = this.pdfTask(id, owner).key;
    await this.waitForAccess(key); this.active();
    const result = await this.pdfOptions().cache.status(key); this.active(); return result;
  }
  async cachePdf(id: string, owner?: string): Promise<void> {
    this.active();
    const task = this.pdfTask(id, owner);
    this.manualRequests.add(task.key);
    try {
      await this.waitForEviction(task.key); this.active();
      await this.local.update(task.key, {is_auto_cached: 0, is_downloaded: 1, pdf_cache: {id, owner: owner ?? null}});
      this.active();
    } finally {this.manualRequests.delete(task.key);}
    let intent = this.pdfIntents.get(task.key);
    if (intent) intent.manual = true; else {intent = {task, manual: true}; this.pdfIntents.set(task.key, intent);}
    return this.fillPdf(intent, true);
  }
  private fillPdf(intent: PdfIntent, explicit = false): Promise<void> {
    if (intent.completion) return intent.completion;
    const {task} = intent, pdf = this.pdfOptions();
    const check = () => {this.active(); if (this.pdfIntents.get(task.key) !== intent) throw abortError();};
    let ticket: OfflineTaskState | null = null;
    this.queued.add(task.key);
    const completion = (async () => {
      ticket = await this.retries.begin(task.key, 'pdf', explicit); check();
      if (!ticket) return;
      const descriptor = await this.getPdfMetadata(task.id, task.owner, undefined, false);
      check();
      if (!intent.manual) await this.local.setAutoDownloadStatus(task.key, 1);
      for (let begin = 0; begin < descriptor.size; begin += PDF_BLOCK_BYTES) {
        check();
        await this.readPdfRange(task.id, descriptor, begin, Math.min(begin + PDF_BLOCK_BYTES, descriptor.size), task.owner, undefined, false);
      }
      check();
      if (!await pdf.cache.verify(task.key, descriptor)) {
        check(); await pdf.cache.remove(task.key); throw Object.assign(new Error('PDF checksum verification failed'), {code: 'offline_integrity_invalid'});
      }
      check();
      if (intent.manual) await this.local.update(task.key, {is_downloaded: 2}); else await this.local.setAutoDownloadStatus(task.key, 2);
      await this.retries.complete(task.key, ticket); check();
      this.failedCollections.delete(task.key); this.pdfIntents.delete(task.key);
    })().catch(async error => {
      if (!this.stopped && !this.paused && this.networkReady && ticket && !(error instanceof Error && error.name === 'AbortError')) {
        await this.retries.fail(task.key, ticket, error);
        if (this.pdfIntents.get(task.key) === intent) {
          this.failedCollections.add(task.key);
          if (intent.manual) await this.local.update(task.key, {is_downloaded: 3}); else await this.local.setAutoDownloadStatus(task.key, 3);
        }
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
    this.failedCollections.delete(key); this.pdfIntents.delete(key);
    if (this.desired.get(key)?.pdf) this.desired.delete(key);
    this.queues.personal = this.queues.personal.filter(task => !task.pdf || task.key !== key);
    this.queues.collection = this.queues.collection.filter(task => !task.pdf || task.key !== key);
    await Promise.allSettled([this.resources.cancelWhere(identity => identity.kind === 'pdf' && identity.context === key), intent?.completion]);
    this.active(); if (!this.jobs.has(key)) this.queued.delete(key);
  }
  private schedule() {
    if (this.stopped || this.paused || this.ready.size < 5) return;
    this.dirty = true;
    if (this.reconciliation) return;
    this.reconciliation = Promise.resolve().then(async () => {
      while (this.dirty && !this.stopped) {this.dirty = false; await this.reconcile();}
    }).catch(() => undefined).finally(() => {this.reconciliation = null; if (this.dirty && !this.stopped) this.schedule();});
  }
  private async recoverArticle(key: string, signal?: AbortSignal): Promise<boolean> {
    const check = () => {this.active(); throwIfAborted(signal);};
    check();
    if (!this.options.cache.articleFingerprint) return false;
    const manifest = await this.manifests.read(key); check();
    if (!manifest?.fingerprint) return false;
    const actual = await this.options.cache.articleFingerprint(key); check();
    if (!actual || actual.size !== manifest.fingerprint.size || actual.sha256 !== manifest.fingerprint.sha256) return false;
    const recovered = await this.manifests.recover(key, manifest.generation, actual); check();
    return recovered;
  }
  private async reconcile() {
    this.active();
    if (!this.evictionRecoveryReady) {
      if (this.removalEvictions) await this.removalEvictions.recover();
      this.active(); this.evictionRecoveryReady = true;
    }
    const changed = this.plan.refresh(), window = this.plan.window;
    if (!this.recoveryReady) {
      if (this.options.cache.articleFingerprint) {
        const pending = await this.manifests.interrupted(); this.active();
        for (const key of pending) {
          try {if (await this.recoverArticle(key)) this.recovered.add(key);}
          catch {this.active();}
        }
      }
      this.recoveryReady = true;
      for (const key of this.plan.refresh()) changed.add(key);
    }
    for (const key of this.recovered) if (this.locals.get(key)?.downloaded) this.recovered.delete(key);
    this.retries.update(this.plan.tasks.keys(), this.networkReady);
    this.resources.cancelQueued(identity => identity.kind === 'article' && !this.plan.tasks.has(bookmarkCacheKey(identity.resource, articleContextOwner(identity.context))));
    for (const key of this.reconsider) changed.add(key);
    this.reconsider.clear();
    for (const domain of ['personal', 'collection'] as const) {
      this.queues[domain] = this.queues[domain].flatMap(task => {
        const current = this.plan.tasks.get(task.key);
        if (current) return [current];
        this.queued.delete(task.key); return [];
      });
    }
    for (const key of changed) {
      const task = this.plan.tasks.get(key);
      if (!task || this.recovered.has(key) || this.queued.has(key) || this.foreground.has(key) || !this.retries.allowed(key) || this.failedCollections.has(key)) this.desired.delete(key);
      else this.desired.set(key, task);
    }
    const personalActive = new Set(this.personal.map(item => item.id));
    const settings = this.settings, personal = this.personal, collections = this.collections;
    for (const [key, data] of this.locals) {
      if (data.manual || !data.downloaded || window.has(key) || this.queued.has(key) || this.foreground.has(key) || this.manualRequests.has(key) || this.hasEviction(key)) continue;
      if (this.removalEvictions) {
        const discardRow = !data.pdfCachePresent && (key.startsWith('collection-') || !personalActive.has(key));
        const current = () => {
          const latest = this.locals.get(key);
          return !!latest && latest.downloaded && !latest.manual && !this.plan.window.has(key) && !this.queued.has(key) &&
            !this.foreground.has(key) && !this.manualRequests.has(key) && settings === this.settings && personal === this.personal && collections === this.collections;
        };
        await this.removalEvictions.evict(key, discardRow, current).catch(() => undefined);
        this.active();
        continue;
      }
      let release!: () => void;
      const completion = new Promise<void>(resolve => {release = resolve;});
      this.legacyEvictions.set(key, {completion, release});
      let retained = false, releaseImages: (() => void) | undefined;
      const check = () => {
        this.active();
        if (this.foreground.has(key) || this.manualRequests.has(key) || this.locals.get(key)?.manual || settings !== this.settings || personal !== this.personal || collections !== this.collections) {retained = true; throw abortError();}
      };
      try {
        releaseImages = await this.images.hold(key); check();
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
          else {
            const {_slax_offline: _discarded, ...retained} = current;
            await tx.execute('UPDATE ps_data_local__local_bookmark_info SET data = ? WHERE id = ?', [JSON.stringify({...retained, is_downloaded: 0, is_auto_cached: 1}), key]);
          }
        });
      } catch (error) {if (!retained) throw error;}
      finally {this.legacyEvictions.delete(key); releaseImages?.(); release();}
    }
    this.pump();
  }
  private pump() {
    if (this.stopped || this.paused || !this.networkReady || !this.recoveryReady || this.pumping) return;
    this.pumping = true;
    try {for (const domain of ['personal', 'collection'] as const) {
      for (const [key, task] of this.desired) {
        if (task.domain !== domain || this.queues[domain].length >= 100) continue;
        this.desired.delete(key); this.queued.add(key); this.queues[domain].push(task);
      }
      while (this.running[domain] < 3 && this.queues[domain].length) {
        const task = this.queues[domain].shift()!;
        if (this.foreground.has(task.key)) {this.queued.delete(task.key); continue;}
        const request = new AbortController(); this.running[domain]++;
        let work: Promise<void>;
        if (task.pdf) {
          let intent = this.pdfIntents.get(task.key);
          if (!intent) {intent = {task, manual: this.locals.get(task.key)?.manual ?? false}; this.pdfIntents.set(task.key, intent);}
          work = this.fillPdf(intent);
        } else work = this.download(task, request.signal);
        const completion = work.catch(() => undefined).finally(() => {
          this.running[domain]--; this.queued.delete(task.key);
          if (this.jobs.get(task.key)?.request === request) this.jobs.delete(task.key);
          this.pump(); this.schedule();
        });
        this.jobs.set(task.key, {request, completion});
      }
    }} finally {this.pumping = false;}
    this.images.update();
  }
  getArticleContent(id: string, owner?: string, signal?: AbortSignal, priority = true): Promise<string> {
    this.active(); throwIfAborted(signal);
    const key = bookmarkCacheKey(id, owner), body = this.articleBodies.get(key);
    if (body?.content !== undefined) return Promise.resolve().then(() => {this.active(); throwIfAborted(signal); return body.content!;});
    return this.resources.acquire({identity: {kind: 'article', context: articleContext(owner), resource: id},
      host: this.options.apiOrigin ?? 'api', domain: owner ? 'collection' : 'personal', lane: 'body', run: async request => {
        const content = await this.options.content(id, owner, request); this.active(); throwIfAborted(request);
        const pending = this.articleBodies.get(key); if (pending) pending.content = content;
        return content;
      },
    }, priority ? 'foreground' : 'background', signal);
  }
  private async download(task: Task, signal: AbortSignal) {
    const active = () => {this.active(); throwIfAborted(signal);}, body: {content?: string} = {};
    this.articleBodies.set(task.key, body);
    let releaseImages: (() => void) | undefined, ticket: OfflineTaskState | null = null;
    try {
      active();
      if (await this.recoverArticle(task.key, signal)) {this.failedCollections.delete(task.key); return;}
      ticket = await this.retries.begin(task.key, 'article'); active(); if (!ticket) return;
      await this.local.setAutoDownloadStatus(task.key, 1); active();
      const content = prepareAutomaticCacheContent(await this.getArticleContent(task.id, task.owner, signal, false)); active();
      const fingerprint = await this.options.cache.contentFingerprint?.(content.html); active();
      releaseImages = await this.images.hold(task.key); active();
      const manifest = await this.manifests.prepare(task.id, task.owner, content.imageUrls, fingerprint); active();
      await this.options.cache.writeArticle(task.key, content.html, signal); active();
      await this.manifests.ready(task.key, manifest.generation); active();
      await this.retries.complete(task.key, ticket); active(); this.failedCollections.delete(task.key);
    } catch (error) {
      if (this.stopped || this.paused || !this.networkReady || signal.aborted || error instanceof Error && error.name === 'AbortError') return;
      try {
        this.active(); this.failedCollections.add(task.key);
        if (ticket) await this.retries.fail(task.key, ticket, error);
        await this.local.setAutoDownloadStatus(task.key, 3);
      } catch { /* Revoked scopes cannot persist a late failure. */ }
    } finally {releaseImages?.(); if (this.articleBodies.get(task.key) === body) this.articleBodies.delete(task.key);}
  }
  cancel() {
    if (this.stopped) return;
    this.stopped = true; this.watcher.abort(); this.unsubscribePreferences?.(); this.unsubscribePreferences = null;
    this.jobs.forEach(job => job.request.abort()); this.removalEvictions?.cancelAll(); this.images.cancel(); this.retries.stop();
    void this.resources.close();
    this.desired.clear(); this.queues.personal = []; this.queues.collection = [];
  }
  async stop() {
    this.cancel(); await this.reconciliation; await Promise.allSettled([this.removalEvictions?.settled()]);
    await Promise.allSettled([...this.jobs.values()].map(job => job.completion));
    await Promise.allSettled([...this.pdfIntents.values()].flatMap(intent => intent.completion ? [intent.completion] : [])); this.pdfIntents.clear();
    await this.images.stop(); await this.resources.close();
  }
  /** Verification checkpoint; does not enable caching or replace any native acceptance evidence. */
  async settled() {
    await Promise.resolve(); await this.reconciliation;
    await Promise.allSettled([...this.jobs.values()].map(job => job.completion));
    await Promise.allSettled([...this.pdfIntents.values()].flatMap(intent => intent.completion ? [intent.completion] : []));
    await this.removalEvictions?.settled(); await this.images.settled(); await this.resources.settled();
    if (this.jobs.size || this.reconciliation) await this.settled();
  }
}
