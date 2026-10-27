import type {PdfDescriptor} from '@slax-reader/contracts/pdf';
import type {SqlDatabase, SqlTransaction} from './repositories/sql.ts';
import type {PreferenceStore, PreferenceValues} from './preferences.ts';
import {bookmarkCacheKey} from './repositories/records.ts';
import {CacheStateRepository, type CacheCandidate, type CacheLocalState} from './repositories/cache-state.ts';
import {AutomaticCachePlan} from './cache-plan.ts';
import {throwIfAborted} from '../utils/abort.ts';
import {offlineEngineError, offlinePdfDescriptor, type OfflineEngine, type OfflineScope, type OfflineStatusEvent, type OfflineStatusItem, type OfflineTask, type OfflineUsageCategory} from './offline-engine.ts';

export interface OfflineCredential {token: string; reject(): Promise<unknown>}
/** The JavaScript credential owner: `current()` is non-null only while credential readiness is `ready`. */
export interface OfflineCredentialSource {current(): OfflineCredential | null; subscribe(listener: () => void): () => void}
export interface OfflineCoordinatorOptions {
  engine: OfflineEngine;
  database: SqlDatabase;
  preferences: Pick<PreferenceStore, 'read' | 'subscribe'>;
  scope: OfflineScope;
  credentials: OfflineCredentialSource;
  /** Throws once the account, origin or runtime generation is revoked. */
  assertActive(): void;
  /** Additional gate for cached foreground access (credential and foreground state). */
  assertCachedAccess?(): void;
  online?: boolean;
  identifier?: () => string;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  /** Status persistence coalescing window while idle. */
  flushDelayMs?: number;
  /** Upper bound on deferring status persistence while the UI reports an interaction. */
  maxDeferMs?: number;
  /** First background retry delay after a failed `open`; doubles up to `maxOpenRetryMs`. */
  openRetryMs?: number;
  maxOpenRetryMs?: number;
}
type Waiter = {resolve(): void; reject(error: unknown): void};
const STATUS: Record<OfflineStatusItem['state'], number> = {downloading: 1, complete: 2, failed: 3, denied: 3, invalidated: 0, evicted: 0};
const MANUAL = `coalesce(json_type(data, '$.is_auto_cached') IN ('integer', 'real', 'false') AND json_extract(data, '$.is_auto_cached') = 0, 0)`;
const KNOWN_FIELDS = `('id', 'is_downloaded', 'is_auto_cached', '_slax_offline', '_slax_offline_retry', '_slax_eviction')`;
const OBSOLETE_FIELDS = `'$._slax_offline', '$._slax_offline_retry', '$._slax_eviction'`;
const validId = (value: string | undefined) => value === undefined || /^[\w-]+$/.test(value);
const cancelled = () => Object.assign(new Error('Offline request cancelled'), {name: 'AbortError'});
const sameTask = (left: OfflineTask, right: OfflineTask) => left.id === right.id && left.collectionOwner === right.collectionOwner && left.kind === right.kind && left.manual === right.manual && left.version === right.version;

/** Plans automatic offline work in JavaScript and persists native engine progress; the native engine never touches the database. */
export class OfflineCoordinator {
  private readonly options: OfflineCoordinatorOptions;
  private readonly engine: OfflineEngine;
  private readonly owner: string;
  private readonly repository: CacheStateRepository;
  private readonly plan = new AutomaticCachePlan(true);
  private personal = new Map<string, CacheCandidate>();
  private collections = new Map<string, CacheCandidate>();
  private locals = new Map<string, CacheLocalState>();
  private ready = new Set<string>();
  private downloadImages = true;
  private online: boolean;
  private conditions = '';
  private applied = new Map<string, OfflineTask>();
  private requested = new Map<string, OfflineTask>();
  private revision = 0;
  private dirty = false;
  private reconciling = false;
  private pending = new Map<string, OfflineStatusItem>();
  private pendingEvictions = new Set<string>();
  private evicting = new Set<string>();
  private waiters = new Map<string, Waiter[]>();
  private foreground = new Map<string, {count: number; token?: string}>();
  private busy = new Set<string>();
  private pendingSince = 0;
  private timer: unknown;
  private timerDue = 0;
  private flushing: Promise<void> = Promise.resolve();
  private opening?: Promise<void>;
  /** Settles when the native owner of the current open attempt has started, before the JavaScript layout acknowledgement. */
  private nativeOpen?: Promise<unknown>;
  private openFailure?: {error: unknown; at: number; delay: number; foregroundRetried: boolean};
  private openRetryTimer: unknown;
  private openAttempted = false;
  private openStops: (() => void)[] = [];
  private opened = false;
  private started = false;
  private suspended = false;
  private closed = false;
  private credentialGeneration = 0;
  private credential: OfflineCredential | null = null;
  private stops: (() => void)[] = [];
  private requests = 0;
  constructor(options: OfflineCoordinatorOptions) {
    this.options = options; this.engine = options.engine; this.owner = options.scope.owner; this.online = options.online ?? true;
    this.repository = new CacheStateRepository(options.database);
  }
  private now() {return (this.options.now ?? Date.now)();}
  private active() {if (this.closed) throw cancelled(); this.options.assertActive();}
  private requestId() {return this.options.identifier?.() ?? `${this.owner}-${++this.requests}`;}

  /**
   * Opens the native owner, completes the one-time layout transition and pushes credentials. Foreground reads await it.
   * A failed open is not cached: its listeners are removed and it is retried with bounded backoff (a foreground caller may retry once immediately).
   */
  open(foreground = true): Promise<void> {
    if (this.opening) return this.opening;
    try {this.active();} catch (error) {return Promise.reject(error);}
    const failure = this.openFailure, immediate = !!failure && this.now() < failure.at + failure.delay;
    if (failure && immediate && (!foreground || failure.foregroundRetried)) return Promise.reject(failure.error);
    this.clearOpenRetry(); this.openAttempted = true;
    const subscriptions = [this.engine.addListener('onStatus', event => this.receive(event)),
      this.engine.addListener('onCredentialRejected', event => {if (event.owner === this.owner) this.rejectCredential(event.generation);})];
    this.openStops = [...subscriptions.map(subscription => () => subscription.remove()), this.options.credentials.subscribe(() => this.syncCredential())];
    const native = (async () => this.engine.open(this.options.scope))();
    this.nativeOpen = native; void native.catch(() => undefined);
    const opening = (async () => {
      const result = await native; this.active();
      this.opened = true; this.syncCredential(); this.pushConditions();
      if (result.migrationPending) {await this.migrate(result.adopted, result.dropped); this.active(); await this.engine.commitMigration(this.owner); this.active();}
      for (const [key, entry] of this.foreground) if (entry.token === undefined) entry.token = this.engine.protect(this.owner, key);
      if (this.suspended) await this.engine.suspend(this.owner);
      this.openFailure = undefined; this.stops.push(...this.openStops.splice(0));
      this.schedule();
    })();
    this.opening = opening;
    void opening.catch(error => this.openFailed(opening, error, immediate));
    return opening;
  }
  /** At most one immediate foreground attempt per backoff window; each further failure doubles the window. */
  private openFailed(opening: Promise<void>, error: unknown, immediate: boolean) {
    if (this.opening !== opening) return;
    this.opening = undefined; this.nativeOpen = undefined; this.opened = false; this.credential = null; this.conditions = ''; this.applied = new Map();
    this.openStops.splice(0).forEach(stop => {try {stop();} catch {}});
    for (const entry of this.foreground.values()) entry.token = undefined;
    if (this.closed) return;
    const base = this.options.openRetryMs ?? 2000, delay = Math.min(this.options.maxOpenRetryMs ?? 60000, this.openFailure ? this.openFailure.delay * 2 : base);
    this.openFailure = {error, at: this.now(), delay, foregroundRetried: immediate};
    this.scheduleOpenRetry();
  }
  /** Started coordinators keep retrying in the background; each attempt that fails reschedules itself. */
  private scheduleOpenRetry() {
    const failure = this.openFailure;
    if (this.closed || !this.started || this.opening || this.openRetryTimer !== undefined || !failure) return;
    this.openRetryTimer = (this.options.setTimer ?? setTimeout)(() => {this.openRetryTimer = undefined; void this.open(false).catch(() => undefined);}, Math.max(0, failure.at + failure.delay - this.now()));
  }
  private clearOpenRetry() {
    if (this.openRetryTimer !== undefined) (this.options.clearTimer ?? clearTimeout)(this.openRetryTimer as ReturnType<typeof setTimeout>);
    this.openRetryTimer = undefined;
  }
  /** Clears obsolete JavaScript-pipeline fields and resets rows whose cached content did not survive the native layout transition, in one transaction. */
  private async migrate(adopted: string[], dropped: string[]) {
    const kept = new Set(adopted), reset = new Set(dropped);
    const pdf = await this.options.database.getAll<{id: string; owner_id: string | null}>(`SELECT id, NULL AS owner_id FROM sr_user_bookmark WHERE type = 2
      UNION ALL SELECT id, owner_id FROM sr_collection_bookmark WHERE json_extract(metadata, '$.bookmark.type') IN ('pdf', 2, '2')`);
    this.active();
    for (const row of pdf) reset.add(bookmarkCacheKey(String(row.id), row.owner_id ?? undefined));
    const rows = await this.options.database.getAll<{id: string; status: unknown}>(`SELECT id, json_extract(data, '$.is_downloaded') AS status FROM ps_data_local__local_bookmark_info
      WHERE CASE WHEN json_valid(data) THEN json_type(data) = 'object' ELSE 0 END`);
    this.active();
    for (const row of rows) {
      const status = Number(row.status);
      if (status === 1 || status === 2 && !kept.has(row.id)) reset.add(row.id);
    }
    await this.options.database.writeTransaction(async tx => {
      await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_remove(data, ${OBSOLETE_FIELDS})
        WHERE CASE WHEN json_valid(data) THEN json_type(data, '$._slax_offline') IS NOT NULL OR json_type(data, '$._slax_offline_retry') IS NOT NULL OR json_type(data, '$._slax_eviction') IS NOT NULL ELSE 0 END`);
      const keys = [...reset];
      for (let index = 0; index < keys.length; index += 200) {
        const chunk = keys.slice(index, index + 200);
        await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_set(data, '$.is_downloaded', 0)
          WHERE id IN (${chunk.map(() => '?').join(', ')}) AND CASE WHEN json_valid(data) THEN coalesce(json_extract(data, '$.is_downloaded'), 0) != 0 ELSE 0 END`, chunk);
      }
    });
  }
  private syncCredential() {
    if (this.closed || !this.opened) return;
    const next = this.options.credentials.current();
    if (next?.token === this.credential?.token && !!next === !!this.credential) {this.credential = next; return;}
    this.credential = next;
    if (next) this.engine.setCredential(this.owner, {generation: ++this.credentialGeneration, token: next.token});
    else this.engine.setCredential(this.owner, null);
  }
  /** Only the generation native actually used is rejected; a refreshed token is never revoked by a late 401. */
  private rejectCredential(generation: number) {
    const credential = this.credential;
    if (this.closed || !credential || generation !== this.credentialGeneration) return;
    this.credential = null; this.engine.setCredential(this.owner, null);
    void credential.reject().catch(() => undefined).finally(() => this.syncCredential());
  }
  setOnline(online: boolean) {this.online = online; this.pushConditions();}
  private pushConditions() {
    if (this.closed || !this.opened) return;
    const conditions = {online: this.online, downloadImages: this.downloadImages}, encoded = JSON.stringify(conditions);
    if (encoded === this.conditions) return;
    this.conditions = encoded; this.engine.setConditions(this.owner, conditions);
  }

  /** Starts the cache-state watches; planning begins once candidates, local rows and settings are all known. */
  start() {
    if (this.started || this.closed) return;
    this.active(); this.started = true; void this.open(false).catch(() => this.scheduleOpenRetry());
    const update = <T>(name: string, apply: (rows: T[]) => void) => (rows: T[]) => {if (!this.closed) {apply(rows); this.ready.add(name); this.schedule();}};
    const index = (rows: CacheCandidate[]) => new Map(rows.map(row => [row.key, row]));
    this.stops.push(this.repository.watchPersonal(update<CacheCandidate>('personal', rows => {this.personal = index(rows); this.plan.setCandidates('personal', rows);})));
    this.stops.push(this.repository.watchCollections(update<CacheCandidate>('collection', rows => {this.collections = index(rows); this.plan.setCandidates('collection', rows);})));
    this.stops.push(this.repository.watchLocal(update<CacheLocalState>('local', rows => {this.locals = new Map(rows.map(row => [row.id, row])); this.plan.setLocal(rows);})));
    let observed = false;
    const settings = (values: PreferenceValues) => {
      if (this.closed) return;
      const configured = typeof values.cache_count === 'number' ? values.cache_count : 50;
      const limit = configured === -1 ? Infinity : Math.max(0, configured), images = (values.download_images ?? 1) === 1;
      this.downloadImages = images; this.plan.setLimit(limit); this.pushConditions();
      this.ready.add('settings'); this.schedule();
    };
    this.stops.push(this.options.preferences.subscribe(values => {observed = true; settings(values);}));
    void this.options.preferences.read().then(values => {if (!observed) settings(values);}).catch(() => undefined);
  }
  private schedule() {
    if (this.closed) return;
    this.dirty = true;
    if (this.reconciling) return;
    this.reconciling = true;
    void Promise.resolve().then(() => {
      this.reconciling = false;
      if (!this.dirty || this.closed || this.suspended || !this.opened) return;
      this.dirty = false;
      try {this.reconcile();} catch {}
    });
  }
  private candidate(key: string) {return this.personal.get(key) ?? this.collections.get(key);}
  private retainedArticle(key: string) {
    const local = this.locals.get(key);
    return !!local?.manual && local.downloaded && !local.pdfCachePresent && !this.candidate(key)?.pdf;
  }
  private task(key: string, pdf: boolean, id: string, owner?: string): OfflineTask {
    const local = this.locals.get(key);
    return {key, id, ...(owner ? {collectionOwner: owner} : {}), kind: pdf ? 'pdf' : 'article', manual: !!local?.manual, version: this.candidate(key)?.version ?? ''};
  }
  /** Diffs the eligible plan against what native already holds, then decides evictions. Never runs while suspended. */
  private reconcile() {
    this.active();
    const desired = new Map<string, OfflineTask>();
    if (this.ready.size >= 4) {
      this.plan.refresh();
      for (const key of this.plan.window) {
        const planned = this.plan.tasks.get(key), candidate = this.candidate(key);
        if (planned) desired.set(key, this.task(key, planned.pdf, planned.id, planned.owner));
        else if (candidate) desired.set(key, this.task(key, candidate.pdf, candidate.id, candidate.owner));
      }
      for (const [key, planned] of this.plan.tasks) if (!desired.has(key)) desired.set(key, this.task(key, planned.pdf, planned.id, planned.owner));
      // Manually retained articles stay planned so native completes their pending images; their committed manifest needs no body refetch.
      if (this.downloadImages) for (const key of this.locals.keys()) {
        const candidate = this.candidate(key);
        if (candidate && !desired.has(key) && this.retainedArticle(key)) desired.set(key, this.task(key, false, candidate.id, candidate.owner));
      }
    } else for (const [key, task] of this.applied) desired.set(key, task);
    for (const [key, task] of this.requested) desired.set(key, task);
    const upsert: OfflineTask[] = [], remove: string[] = [];
    for (const [key, task] of desired) {const previous = this.applied.get(key); if (!previous || !sameTask(previous, task)) upsert.push(task);}
    for (const key of this.applied.keys()) if (!desired.has(key)) remove.push(key);
    if (upsert.length || remove.length) {
      this.applied = desired;
      this.engine.applyPlan(this.owner, {revision: ++this.revision, upsert, remove});
      for (const key of remove) {
        const pending = this.pending.get(key), local = this.locals.get(key);
        if (pending?.state === 'downloading') this.pending.delete(key);
        if (!local?.manual && local?.status === 1 && !this.foreground.has(key)) this.enqueue({key, state: 'invalidated', manual: false});
      }
    }
    if (this.ready.size >= 4) this.evict(desired);
  }
  /** Automatic copies outside the plan are evicted by native first; only keys it actually removed have their rows reset or discarded. */
  private evict(desired: Map<string, OfflineTask>) {
    const keys: string[] = [];
    for (const [key, local] of this.locals) {
      if (local.manual || !local.downloaded || desired.has(key) || this.foreground.has(key) || this.evicting.has(key) || this.pendingEvictions.has(key)) continue;
      keys.push(key);
    }
    if (!keys.length) return;
    keys.forEach(key => this.evicting.add(key));
    void this.engine.evict(this.owner, keys).then(removed => {
      if (this.closed) return;
      for (const key of removed) if (keys.includes(key)) this.pendingEvictions.add(key);
      this.scheduleFlush();
    }).catch(() => undefined).finally(() => {keys.forEach(key => this.evicting.delete(key));});
  }
  private receive(event: OfflineStatusEvent) {
    if (this.closed || event?.owner !== this.owner || !Array.isArray(event.items)) return;
    for (const item of event.items) {
      if (!item || typeof item.key !== 'string' || !/^[\w-]+$/.test(item.key) || !(item.state in STATUS)) continue;
      this.settleWaiter(item);
      // A stale start for work that left the plan must not leave a row stuck in progress.
      if (item.state === 'downloading' && !this.applied.has(item.key)) continue;
      // A mounted Reader owns the start of its foreground fetch; final states (including a PDF or a race-completed article) still persist.
      if (item.state === 'downloading' && this.foreground.has(item.key)) continue;
      // A retained manual article is planned only to fill its images; its refresh or removal never downgrades the row that already reads offline.
      if (item.state !== 'complete' && item.state !== 'evicted' && this.retainedArticle(item.key)) continue;
      this.enqueue(item);
    }
  }
  private enqueue(item: OfflineStatusItem) {
    if (!this.pending.size && !this.pendingEvictions.size) this.pendingSince = this.now();
    this.pending.set(item.key, item); this.scheduleFlush();
  }
  private settleWaiter(item: OfflineStatusItem) {
    const waiters = this.waiters.get(item.key);
    if (!waiters || item.state === 'downloading') return;
    this.waiters.delete(item.key); this.requested.delete(item.key);
    const failure = item.state === 'complete' ? null : Object.assign(new Error('PDF cache failed'), {code: item.code ?? item.state});
    for (const waiter of waiters) if (failure) waiter.reject(failure); else waiter.resolve();
  }
  /** UI interaction (scroll, route transition) defers status persistence; each source must clear its own flag. */
  setInteractionBusy(busy: boolean, source = 'interaction') {
    if (busy) this.busy.add(source); else this.busy.delete(source);
    this.scheduleFlush();
  }
  private scheduleFlush() {
    if (this.closed || this.suspended || !this.pending.size && !this.pendingEvictions.size) return;
    if (!this.pendingSince) this.pendingSince = this.now();
    const idle = this.options.flushDelayMs ?? 50, deadline = this.pendingSince + (this.options.maxDeferMs ?? 1500);
    const due = this.busy.size ? deadline : Math.min(this.now() + idle, deadline);
    if (this.timer !== undefined && this.timerDue <= due) return;
    if (this.timer !== undefined) (this.options.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>);
    this.timerDue = due;
    this.timer = (this.options.setTimer ?? setTimeout)(() => {this.timer = undefined; this.timerDue = 0; this.flush();}, Math.max(0, due - this.now()));
  }
  private clearFlushTimer() {
    if (this.timer !== undefined) (this.options.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>);
    this.timer = undefined; this.timerDue = 0;
  }
  /** One lease-checked transaction per batch: download starts/resolutions and eviction row resets. Per-image progress is never written. */
  private flush() {
    if (this.closed || this.suspended) return;
    const items = [...this.pending.values()].filter(item => this.changes(item)), evicted = [...this.pendingEvictions];
    this.pending.clear(); this.pendingEvictions.clear(); this.pendingSince = 0;
    if (!items.length && !evicted.length) return;
    const work = this.flushing.then(async () => {
      if (this.closed) return;
      this.active();
      await this.options.database.writeTransaction(async tx => {
        for (const item of items) await this.write(tx, item);
        for (const key of evicted) await this.writeEviction(tx, key);
      });
    }).catch(() => undefined);
    this.flushing = work;
  }
  private changes(item: OfflineStatusItem) {
    const status = STATUS[item.state], local = this.locals.get(item.key);
    return local?.status !== status && !(status === 0 && (!local || local.manual && !item.manual));
  }
  private async write(tx: SqlTransaction, item: OfflineStatusItem) {
    const status = STATUS[item.state], manual = item.manual ? 1 : 0;
    if (status === 0) {
      await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_set(data, '$.is_downloaded', 0, '$.is_auto_cached', CASE WHEN ${MANUAL} THEN 0 ELSE 1 END)
        WHERE id = ? AND CASE WHEN json_valid(data) THEN coalesce(json_extract(data, '$.is_downloaded'), 0) != 0 ELSE 0 END`, [item.key]);
      return;
    }
    await tx.execute(`INSERT INTO ps_data_local__local_bookmark_info (id, data) VALUES (?, json_object('is_downloaded', ?, 'is_auto_cached', ?))
      ON CONFLICT(id) DO UPDATE SET data = json_set(coalesce(data, '{}'), '$.is_downloaded', ?, '$.is_auto_cached', CASE WHEN ? = 1 OR ${MANUAL} THEN 0 ELSE 1 END)
      WHERE ? = 1 OR ? = 2 OR NOT ${MANUAL}`, [item.key, status, manual ? 0 : 1, status, manual, manual, status]);
  }
  /** Mirrors the former eviction policy: collection copies and bookmarks gone from the personal library drop their bare row; others keep it reset. */
  private async writeEviction(tx: SqlTransaction, key: string) {
    const discard = key.startsWith('collection-') || !this.personal.has(key);
    if (discard) {
      await tx.execute(`DELETE FROM ps_data_local__local_bookmark_info WHERE id = ? AND json_extract(data, '$.is_downloaded') IN (2, '2') AND NOT ${MANUAL}
        AND NOT EXISTS (SELECT 1 FROM json_each(data) WHERE key NOT IN ${KNOWN_FIELDS})`, [key]);
    }
    await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_remove(json_set(data, '$.is_downloaded', 0, '$.is_auto_cached', 1), ${OBSOLETE_FIELDS})
      WHERE id = ? AND json_extract(data, '$.is_downloaded') IN (2, '2') AND NOT ${MANUAL}`, [key]);
  }
  /** Settles once the pinned PDF reports a terminal state; acquisition itself runs natively. */
  async cachePdf(id: string, owner?: string): Promise<void> {
    this.active();
    if (!id || !validId(id) || !validId(owner)) throw new Error('Invalid PDF access context');
    const key = bookmarkCacheKey(id, owner);
    await this.options.database.writeTransaction(tx => tx.execute(`INSERT INTO ps_data_local__local_bookmark_info (id, data) VALUES (?, json_object('is_auto_cached', 0, 'is_downloaded', 1, 'pdf_cache', json(?)))
      ON CONFLICT(id) DO UPDATE SET data = json_set(coalesce(data, '{}'), '$.is_auto_cached', 0, '$.is_downloaded', 1, '$.pdf_cache', json(?))`, [key, JSON.stringify({id, owner: owner ?? null}), JSON.stringify({id, owner: owner ?? null})]));
    this.active();
    const completion = new Promise<void>((resolve, reject) => {const list = this.waiters.get(key) ?? []; list.push({resolve, reject}); this.waiters.set(key, list);});
    this.requested.set(key, {key, id, ...(owner ? {collectionOwner: owner} : {}), kind: 'pdf', manual: true, version: this.candidate(key)?.version ?? ''});
    this.schedule();
    return completion;
  }
  /** Mounted Readers protect their article from eviction and promote it to foreground priority. */
  beginForeground(key: string): () => void {
    this.active();
    const entry = this.foreground.get(key) ?? {count: 0};
    entry.count++; this.foreground.set(key, entry);
    if (entry.count === 1 && this.opened) entry.token = this.engine.protect(this.owner, key);
    let released = false;
    return () => {
      if (released) return; released = true;
      const current = this.foreground.get(key);
      if (!current || --current.count > 0) return;
      this.foreground.delete(key);
      if (current.token !== undefined && !this.closed) this.engine.release(this.owner, current.token);
      this.schedule();
    };
  }
  private async call<T>(stage: 'api' | 'pdf-metadata' | 'pdf-range', signal: AbortSignal | undefined, work: (requestId: string) => Promise<T>, cached = false): Promise<T> {
    this.active(); throwIfAborted(signal);
    await this.open(true); this.active(); throwIfAborted(signal);
    if (this.suspended) throw cancelled();
    if (cached) this.options.assertCachedAccess?.();
    const requestId = this.requestId(), abort = () => this.engine.cancel(this.owner, requestId);
    signal?.addEventListener('abort', abort, {once: true});
    try {
      const pending = work(requestId);
      const value = await (signal ? new Promise<T>((resolve, reject) => {
        const stop = () => reject(cancelled());
        signal.addEventListener('abort', stop, {once: true});
        pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
      }) : pending);
      this.active(); throwIfAborted(signal);
      if (cached) this.options.assertCachedAccess?.();
      return value;
    } catch (error) {this.active(); throwIfAborted(signal); throw offlineEngineError(error, stage);}
    finally {signal?.removeEventListener('abort', abort);}
  }
  /** Committed article body, or null when this device holds no complete copy. Reads wait only for the native owner, not the layout acknowledgement. */
  async readArticle(key: string): Promise<string | null> {
    this.active();
    try {const opening = this.open(); if (this.nativeOpen) void opening.catch(() => undefined); await (this.nativeOpen ?? opening);} catch {this.active(); return null;}
    this.active(); const html = await this.engine.readArticle(this.owner, key); this.active();
    return html;
  }
  /** Served from the committed copy or fetched natively at foreground priority (and committed atomically). */
  getArticleContent(id: string, owner?: string, signal?: AbortSignal, force = false): Promise<string> {
    if (!validId(id) || !validId(owner)) return Promise.reject(new Error('Invalid article access context'));
    const key = bookmarkCacheKey(id, owner);
    return this.call('api', signal, requestId => this.engine.fetchArticle(this.owner, {key, id, ...(owner ? {collectionOwner: owner} : {}), requestId, force}));
  }
  async getPdfMetadata(id: string, owner?: string, signal?: AbortSignal): Promise<PdfDescriptor> {
    if (!id || !validId(id) || !validId(owner)) throw new Error('Invalid PDF access context');
    const key = bookmarkCacheKey(id, owner);
    const value = await this.call('pdf-metadata', signal, requestId => this.engine.pdfMetadata(this.owner, {key, id, ...(owner ? {collectionOwner: owner} : {}), requestId, allowNetwork: this.online}), true);
    return offlinePdfDescriptor(id, value);
  }
  readPdfRange(id: string, descriptor: PdfDescriptor, begin: number, end: number, owner?: string, signal?: AbortSignal): Promise<Uint8Array> {
    if (!id || !validId(id) || !validId(owner)) return Promise.reject(new Error('Invalid PDF access context'));
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > descriptor.size || end - begin > 1024 * 1024) return Promise.reject(new Error('Invalid PDF byte range'));
    const key = bookmarkCacheKey(id, owner);
    return this.call('pdf-range', signal, async requestId => {
      const bytes = await this.engine.readPdfRange(this.owner, {key, id, ...(owner ? {collectionOwner: owner} : {}), documentId: descriptor.document_id, size: descriptor.size, begin, end, requestId});
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== end - begin) throw Object.assign(new Error('Invalid PDF range length'), {code: 'pdf_length_invalid'});
      return bytes;
    }, true);
  }
  async pdfCacheStatus(id: string, owner?: string) {
    if (!id || !validId(id) || !validId(owner)) throw new Error('Invalid PDF access context');
    this.active(); await this.open(); this.active();
    const status = await this.engine.pdfStatus(this.owner, bookmarkCacheKey(id, owner)); this.active();
    return status;
  }
  async usage(keys: string[]) {this.active(); await this.open(); this.active(); const value = await this.engine.usage(this.owner, keys); this.active(); return value;}
  async clear(keys: string[], categories: OfflineUsageCategory[]) {this.active(); await this.open(); this.active(); const value = await this.engine.clear(this.owner, keys, categories); this.active(); return value;}
  /** Background: native pauses acquisition; JavaScript keeps its plan and holds unwritten status until resume. */
  async suspend(): Promise<void> {
    if (this.closed || this.suspended) return;
    this.suspended = true; this.clearFlushTimer();
    const flushing = this.flushing;
    if (this.opened) await this.engine.suspend(this.owner).catch(() => undefined);
    await flushing;
  }
  /** Foreground: replays any plan diff accumulated while suspended without rebuilding the plan. */
  resume() {
    if (this.closed || !this.suspended) return;
    this.suspended = false;
    if (this.opened) this.engine.resume(this.owner);
    this.schedule(); this.scheduleFlush();
  }
  /** Synchronous cancellation for account revocation: no later status, plan or row write is published. */
  cancel() {
    if (this.closed) return;
    this.closed = true; this.clearFlushTimer(); this.clearOpenRetry();
    [...this.openStops.splice(0), ...this.stops.splice(0)].forEach(stop => {try {stop();} catch {}});
    this.pending.clear(); this.pendingEvictions.clear(); this.requested.clear(); this.foreground.clear();
    for (const waiters of this.waiters.values()) for (const waiter of waiters) waiter.reject(cancelled());
    this.waiters.clear();
  }
  /** Revocation and stop: the engine discards the owner's in-flight work. */
  async close(): Promise<void> {
    this.cancel();
    if (!this.openAttempted) return;
    await this.opening?.catch(() => undefined);
    await this.engine.close(this.owner).catch(() => undefined);
  }
  /** Verification checkpoint for tests: pending plan diff, evictions and one flush. */
  async settled(): Promise<void> {
    for (let pass = 0; pass < 5; pass++) {
      await this.opening?.catch(() => undefined);
      await Promise.resolve();
      if (this.timer !== undefined) {this.clearFlushTimer(); this.flush();}
      await this.flushing;
      if (!this.dirty && !this.evicting.size && this.timer === undefined && !this.pending.size && !this.pendingEvictions.size) return;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}
