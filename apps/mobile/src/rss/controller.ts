import { ApiError, type SlaxApi } from '../data/api';
import type { RssEntry, RssEntriesResponse, RssSubscription } from '@slax-reader/contracts';
import type {SessionRequestScope} from '../domain/session.ts';
import {throwIfAborted} from '../utils/abort.ts';

export interface RssState {
  ready: boolean; enabled: boolean; busy: boolean; subscriptions: RssSubscription[]; selected: string | null;
  entries: RssEntry[]; cursor: string | null; hasMore: boolean; historyStatus: RssEntriesResponse['history_status']; retryAt: string | null; error: string | null;
}
interface CachedList {items: RssEntry[]; cursor: string | null; pages: number; versions: string; savedAt: number; hasMore: boolean; historyStatus: RssState['historyStatus']; retryAt: string | null}
interface RssRun {signal: AbortSignal; generation: number; scope?: SessionRequestScope}
/** REST rows re-walked from `before=anchor` (null: the top) through `pages` pages; `next_cursor` is the walk's deepest cursor. */
interface HistoryWalk extends RssEntriesResponse {anchor: string | null; pages: number}
const emptyState = (): RssState => ({ready: false, enabled: false, busy: false, subscriptions: [], selected: null, entries: [], cursor: null, hasMore: false, historyStatus: 'exhausted', retryAt: null, error: null});
const errorCodes = new Set(['lab_disabled', 'invalid_feed', 'invalid_remark', 'unsafe_url', 'limit_reached', 'refresh_limited', 'source_unavailable', 'not_found', 'article_url_missing']);
export function rssDisplayName(source: RssSubscription) { return source.remark?.trim() || source.title; }
export function rssErrorCode(error: unknown): string {
  const code = error instanceof ApiError && typeof error.data === 'object' && error.data !== null ? (error.data as {error?: unknown}).error : error instanceof Error ? error.message : null;
  return typeof code === 'string' && errorCodes.has(code) ? code : 'source_unavailable';
}
const remarkOf = (value: string | null | undefined) => value?.trim() || null;
const timelineTime = (entry: RssEntry) => {const time = Date.parse(entry.sort_at ?? entry.published_at ?? entry.first_seen_at ?? ''); return Number.isFinite(time) ? time : 0;};
/** Server list order: sort_at DESC, id DESC. */
const timeline = (left: RssEntry, right: RssEntry) => timelineTime(right) - timelineTime(left) || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0);
const saves = new Set<(entryId: string, bookmarkId: string, articleUrl?: string | null) => void>();
/** Notify live feed caches after saving from the reader as well as from a row. */
export function reportRssSaved(entryId: string, bookmarkId: string, articleUrl?: string | null) { saves.forEach(listener => listener(entryId, bookmarkId, articleUrl)); }

/** Source RssViewModel semantics, including expanded-window history reload and cancellation. */
export class RssController {
  private state = emptyState(); private listeners = new Set<() => void>(); private lists = new Map<string | null, CachedList>();
  private request: AbortController | null = null; private generation = 0; private lastPollAt = 0; private disposed = false;
  private labRequest: AbortController | null = null;
  private localReady = false; private localEpoch = 0; private stopLocal: (() => void) | null = null;
  private localSubscriptions: RssSubscription[] | null = null; private localEntries: RssEntry[] | null = null;
  private entryWatch: (() => void) | null = null; private entryEpoch = 0;
  private subscriptionOverlays = new Map<string, RssSubscription>();
  private remarkOverlays = new Map<string, {remark: string | null; synced: string | null | undefined}>();
  /** Removed ids, mapped to whether the synced row has been seen since the removal. */
  private removed = new Map<string, boolean>();
  private refreshOverlays = new Map<string, {next: string; previous: string | null}>();
  private saveOverlays = new Map<string, {bookmark: string; url?: string | null}>();
  private history = new Map<string | null, HistoryWalk>();
  private savedWatch: (() => void) | null = null; private savedKey = ''; private savedEpoch = 0; private savedRows = new Map<string, string>();
  private fallbackPending = false;
  constructor(private api: SlaxApi, private now = Date.now, private isAccountActive = () => true, private local?: import('../data/repositories/rss.ts').RssLocalSource) {}
  private startLocal(cached = false) {
    if (!this.local || this.stopLocal) return;
    const epoch = ++this.localEpoch;
    const active = () => epoch === this.localEpoch && !this.disposed && this.isAccountActive() && this.state.enabled;
    const failed = () => {if (active()) this.localFailed();};
    let stopStream: (() => void) | undefined, stopSubscriptions: (() => void) | undefined;
    this.stopLocal = () => {stopStream?.(); stopSubscriptions?.();};
    const readLocal = () => {
      if (!active() || this.localReady) return;
      try {
        this.localReady = true;
        stopSubscriptions = this.local!.watchSubscriptions(rows => {
          if (!active()) return;
          this.localSubscriptions = rows;
          this.retireSubscriptionOverlays(rows);
          this.publishLocal();
        }, failed);
        if (active()) {this.watchLocalEntries(); this.watchSaved();}
        else stopSubscriptions();
      } catch {failed();}
    };
    try {
      // An admitted cache is readable even when subscribing or the next checkpoint is still pending.
      if (cached) readLocal();
      if (!active()) return;
      stopStream = this.local.connect(readLocal, () => {
        // A stream transport failure does not invalidate admitted local rows or their watchers.
        if (active() && !this.localReady) this.localFailed();
      });
      if (!active()) stopStream();
    } catch {failed();}
  }
  private retireSubscriptionOverlays(rows: RssSubscription[]) {
    const synced = new Map(rows.map(row => [row.id, row]));
    for (const id of this.subscriptionOverlays.keys()) if (synced.has(id)) this.subscriptionOverlays.delete(id);
    for (const [id, overlay] of this.remarkOverlays) {
      const row = synced.get(id);
      if (!row) continue;
      const remark = remarkOf(row.remark);
      // Any other synced change after the rename means a later write elsewhere; let it win.
      if (remark === overlay.remark || (overlay.synced !== undefined && remark !== overlay.synced)) this.remarkOverlays.delete(id);
      else overlay.synced = remark;
    }
    for (const [id, seen] of this.removed) {
      if (synced.has(id)) this.removed.set(id, true);
      else if (seen) this.removed.delete(id);
    }
    for (const [id, overlay] of this.refreshOverlays) {
      const row = synced.get(id);
      if (!row || row.refreshing || Date.parse(row.next_allowed_at) >= Date.parse(overlay.next) || row.last_success_at !== overlay.previous) this.refreshOverlays.delete(id);
    }
  }
  private retireSaveOverlays() {
    if (!this.saveOverlays.size) return;
    const ids = new Map<string, string>(), urls = new Map<string, string>();
    for (const row of this.localEntries ?? []) if (row.bookmark_user_uuid) {
      ids.set(row.id, row.bookmark_user_uuid);
      if (row.article_url) urls.set(row.article_url, row.bookmark_user_uuid);
    }
    for (const [id, overlay] of this.saveOverlays) {
      const local = ids.get(id) === overlay.bookmark || (overlay.url && urls.get(overlay.url) === overlay.bookmark);
      if (local || (overlay.url && this.savedRows.get(overlay.url) === overlay.bookmark)) this.saveOverlays.delete(id);
    }
  }
  /** A local query failure falls back to REST; only a REST failure surfaces an error. */
  private localFailed() {
    const wasReady = this.localReady;
    this.clearLocal();
    if (!wasReady || !this.state.enabled) return;
    if (this.state.busy) {this.fallbackPending = true; return;}
    void this.run(run => this.reload(run, true, true));
  }
  private clearLocal() {
    this.labRequest?.abort(); this.labRequest = null;
    this.localEpoch++; this.entryEpoch++; this.savedEpoch++; this.stopLocal?.(); this.stopLocal = null;
    this.entryWatch?.(); this.entryWatch = null; this.savedWatch?.(); this.savedWatch = null; this.localReady = false;
    this.localSubscriptions = null; this.localEntries = null; this.history.clear(); this.savedKey = ''; this.savedRows = new Map();
    this.subscriptionOverlays.clear(); this.remarkOverlays.clear(); this.removed.clear(); this.refreshOverlays.clear(); this.saveOverlays.clear();
  }
  /** Saved state for REST-fetched rows comes from local bookmarks, never from the REST response. */
  private watchSaved() {
    if (!this.local || !this.localReady) return;
    const urls = [...new Set([
      ...[...this.history.values()].flatMap(page => page.items.flatMap(row => row.article_url ? [row.article_url] : [])),
      ...[...this.saveOverlays.values()].flatMap(overlay => overlay.url ? [overlay.url] : []),
    ])].sort();
    const key = JSON.stringify(urls);
    if (key === this.savedKey) return;
    this.savedWatch?.(); this.savedWatch = null; this.savedKey = key; this.savedRows = new Map();
    const epoch = ++this.savedEpoch;
    if (!urls.length) return;
    const current = () => epoch === this.savedEpoch && !this.disposed && this.isAccountActive();
    this.savedWatch = this.local.watchSaved(urls, rows => {
      if (!current()) return;
      this.savedRows = rows; this.retireSaveOverlays(); this.publishLocal();
    }, () => {if (current()) this.localFailed();});
  }
  private watchLocalEntries() {
    this.entryWatch?.(); this.entryWatch = null; this.localEntries = null;
    if (!this.local || !this.stopLocal) return;
    const epoch = ++this.entryEpoch, selected = this.state.selected;
    this.entryWatch = this.local.watchEntries(selected, rows => {
      if (epoch !== this.entryEpoch || this.disposed || !this.isAccountActive()) return;
      this.localEntries = rows;
      this.retireSaveOverlays();
      this.publishLocal();
    }, () => {if (epoch === this.entryEpoch && !this.disposed && this.isAccountActive()) this.localFailed();});
  }
  private publishLocal() {
    if (!this.localReady || !this.localSubscriptions || !this.localEntries) return;
    const subscriptions = new Map(this.localSubscriptions.map(row => [row.id, row]));
    this.subscriptionOverlays.forEach((row, id) => {if (!subscriptions.has(id)) subscriptions.set(id, row);});
    this.removed.forEach((_seen, id) => subscriptions.delete(id));
    this.remarkOverlays.forEach((overlay, id) => {
      const row = subscriptions.get(id);
      if (row) subscriptions.set(id, {...row, remark: overlay.remark});
    });
    this.refreshOverlays.forEach((overlay, id) => {
      const row = subscriptions.get(id);
      if (row) subscriptions.set(id, {...row, refreshing: true, next_allowed_at: overlay.next});
    });
    this.update({subscriptions: [...subscriptions.values()], ready: true});
    if (this.state.selected !== null && !subscriptions.has(this.state.selected)) {
      this.update({selected: null}); this.watchLocalEntries(); return;
    }
    const page = this.history.get(this.state.selected);
    const merged = new Map<string, RssEntry>();
    for (const row of this.localEntries) if (subscriptions.has(row.subscription_id)) merged.set(row.id, row);
    for (const row of page?.items ?? []) {
      if (subscriptions.has(row.subscription_id) && !merged.has(row.id)) merged.set(row.id, {...row, bookmark_user_uuid: row.article_url ? this.savedRows.get(row.article_url) ?? null : null});
    }
    const savedUrls = new Map<string, string>();
    for (const overlay of this.saveOverlays.values()) if (overlay.url) savedUrls.set(overlay.url, overlay.bookmark);
    const entries = [...merged.values()].sort(timeline).map(row => {
      const bookmark = this.saveOverlays.get(row.id)?.bookmark ?? (row.article_url ? savedUrls.get(row.article_url) : undefined);
      return bookmark ? {...row, bookmark_user_uuid: bookmark} : row;
    });
    this.update({entries: this.named(entries), cursor: page?.next_cursor ?? null,
      hasMore: page?.has_more ?? subscriptions.size > 0, historyStatus: page?.history_status ?? 'available', retryAt: page?.retry_at ?? null});
  }
  activate() {this.disposed = false; saves.add(this.saved);}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => {this.listeners.delete(listener);}; };
  private update(change: Partial<RssState>) { this.state = {...this.state, ...change}; this.listeners.forEach(listener => listener()); }
  private versions(source: string | null) { return JSON.stringify(this.state.subscriptions.filter(item => source === null || item.id === source).map(item => [item.id, item.last_success_at]).sort()); }
  private named(items: RssEntry[]) {
    const names = new Map(this.state.subscriptions.map(row => [row.id, rssDisplayName(row)]));
    return items.map(entry => names.has(entry.subscription_id) ? {...entry, source_title: names.get(entry.subscription_id)!} : entry);
  }
  private assertCurrent(run: RssRun) {
    throwIfAborted(run.signal);
    if (this.disposed || run.generation !== this.generation || !this.isAccountActive()) throw new Error('RSS operation cancelled');
    run.scope?.assertCurrent();
  }
  private current(run: RssRun) {try {this.assertCurrent(run); return true;} catch {return false;}}
  private async checked<T>(work: () => Promise<T>, run: RssRun) {
    this.assertCurrent(run); const result = await work(); this.assertCurrent(run); return result;
  }
  private async run(work: (run: RssRun) => Promise<void>): Promise<boolean> {
    if (this.disposed || this.state.busy || !this.isAccountActive()) return false;
    const controller = new AbortController(), stamp = this.generation;
    const run = {signal: controller.signal, generation: stamp, scope: this.api.options?.sessions.captureRequestScope?.()};
    if (!this.current(run)) return false;
    this.request = controller; this.update({busy: true, error: null});
    try { await work(run); this.assertCurrent(run); return true; }
    catch (reason) {
      if (this.current(run)) {
        const code = rssErrorCode(reason);
        if (code === 'lab_disabled') {this.clearLocal(); this.lists.clear(); this.state = emptyState();}
        this.update({error: code});
      }
      return false;
    } finally {
      if (stamp === this.generation && !this.disposed && this.isAccountActive()) {
        this.request = null; this.update({busy: false, ...(this.current(run) ? {ready: true} : {})});
        if (this.fallbackPending) {this.fallbackPending = false; if (this.state.enabled && !this.localReady) void this.run(next => this.reload(next, true, true));}
      }
    }
  }
  private async pages(source: string | null, count: number, run: RssRun): Promise<CachedList> {
    let cursor: string | null = null, page: RssEntriesResponse | null = null, loaded = 0;
    const entries = new Map<string, RssEntry>();
    for (let index = 0; index < count; index++) {
      page = await this.checked(() => this.api.rssEntries(source ?? undefined, cursor ?? undefined, false, run.signal), run);
      this.assertCurrent(run);
      page.items.forEach(item => { if (!entries.has(item.id)) entries.set(item.id, item); }); loaded++; cursor = page.next_cursor;
      if (!cursor || !page.cached_more) break;
    }
    return {items: this.named([...entries.values()]), cursor, pages: loaded, versions: this.versions(source), savedAt: this.now(), hasMore: page?.has_more ?? false, historyStatus: page?.history_status ?? 'exhausted', retryAt: page?.retry_at ?? null};
  }
  /** Follows `next_cursor` from `before=anchor` (or `first`, that request's response) for up to `count` pages. */
  private async walk(source: string | null, anchor: string | null, count: number, run: RssRun, first?: RssEntriesResponse): Promise<HistoryWalk> {
    const entries = new Map<string, RssEntry>();
    let page = first ?? await this.checked(() => this.api.rssEntries(source ?? undefined, undefined, false, run.signal, anchor ?? undefined), run), loaded = 1;
    for (;;) {
      this.assertCurrent(run);
      page.items.forEach(item => { if (!entries.has(item.id)) entries.set(item.id, item); });
      const cursor = page.next_cursor;
      if (loaded >= count || !cursor || !page.cached_more) break;
      page = await this.checked(() => this.api.rssEntries(source ?? undefined, cursor, false, run.signal), run); loaded++;
    }
    return {...page, items: [...entries.values()], anchor, pages: loaded};
  }
  private oldestLocal(except?: string) {
    const local = new Set(this.localEntries?.map(row => row.id));
    let oldest: string | null = null;
    for (const row of this.state.entries) if (local.has(row.id) && row.id !== except) oldest = row.id;
    return oldest;
  }
  /** A pruned anchor is re-anchored to the current oldest local row, once. */
  private async anchored(anchor: string | null, run: RssRun, work: (anchor: string | null) => Promise<HistoryWalk>) {
    try { return await work(anchor); }
    catch (reason) {
      if (anchor === null || rssErrorCode(reason) !== 'not_found' || !this.current(run) || !this.localReady) throw reason;
      return work(this.oldestLocal(anchor));
    }
  }
  private show(list: CachedList) { this.update({entries: list.items, cursor: list.cursor, hasMore: list.hasMore, historyStatus: list.historyStatus, retryAt: list.retryAt}); }
  /** Validate the laboratory in the background without holding cached navigation behind network readiness. */
  private verifyCachedLab() {
    if (this.labRequest) return;
    const controller = new AbortController(), generation = this.generation, epoch = this.localEpoch;
    const scope = this.api.options?.sessions.captureRequestScope?.();
    const current = () => {
      try {scope?.assertCurrent();} catch {return false;}
      return !controller.signal.aborted && generation === this.generation && epoch === this.localEpoch && !this.disposed && this.isAccountActive();
    };
    const disable = () => {
      if (!current()) return;
      this.cancel(); this.clearLocal(); this.lists.clear(); this.update({...emptyState(), ready: true});
    };
    this.labRequest = controller;
    void (async () => {
      if (!current()) return;
      const result = await this.api.rssLabs(controller.signal);
      if (!result.features.some(item => item.key === 'rss' && item.enabled)) disable();
    })().catch(error => {
      // Transient failure preserves admitted data. A confirmed disabled response still revokes it.
      if (error instanceof ApiError && rssErrorCode(error) === 'lab_disabled') disable();
    }).finally(() => {if (this.labRequest === controller) this.labRequest = null;});
  }
  private async reload(run: RssRun, force = false, keep = false) {
    const subscriptions = (await this.checked(() => this.api.rssSubscriptions(run.signal), run)).items;
    this.assertCurrent(run);
    if (this.localReady) return;
    this.fallbackPending = false;
    for (const source of this.lists.keys()) if (source !== null && !subscriptions.some(item => item.id === source)) this.lists.delete(source);
    const selected = subscriptions.some(item => item.id === this.state.selected) ? this.state.selected : null;
    const switched = selected !== this.state.selected;
    this.update({subscriptions, selected});
    const existing = this.lists.get(selected);
    if (existing) { existing.items = this.named(existing.items); this.show(existing); }
    else if (!keep || switched) this.update({entries: [], cursor: null, hasMore: false, historyStatus: 'exhausted', retryAt: null});
    if (existing && !force && existing.versions === this.versions(selected) && this.now() - existing.savedAt < 60000) return;
    const loaded = await this.pages(selected, existing?.pages ?? 1, run); this.assertCurrent(run); this.lists.set(selected, loaded);
    if (!this.localReady) this.show(loaded);
  }
  load = () => this.run(async run => {
    if (!this.stopLocal && this.local?.hasCachedData) {
      const cached = await this.checked(() => this.local!.hasCachedData!(), run);
      if (cached) {this.update({enabled: true}); this.startLocal(true);}
    }
    if (this.localReady) {this.verifyCachedLab(); this.publishLocal(); return;}
    const enabled = (await this.checked(() => this.api.rssLabs(run.signal), run)).features.some(item => item.key === 'rss' && item.enabled);
    this.assertCurrent(run);
    if (!enabled) {this.clearLocal(); this.lists.clear(); this.update({...emptyState(), ready: true, busy: true}); return;}
    this.update({enabled}); this.startLocal();
    if (this.localReady) {this.publishLocal(); return;}
    await this.reload(run);
  });
  select = (id: string | null) => this.run(async run => {
    if (id !== null && !this.state.subscriptions.some(item => item.id === id)) return;
    if (this.localReady) this.update({selected: id, entries: id === null ? this.state.entries : this.state.entries.filter(row => row.subscription_id === id)});
    else this.update({selected: id});
    if (this.stopLocal) this.watchLocalEntries();
    if (this.localReady) return;
    const existing = this.lists.get(id);
    if (existing) this.show(existing); else this.update({entries: [], cursor: null, hasMore: false, historyStatus: 'exhausted', retryAt: null});
    if (existing && existing.versions === this.versions(id) && this.now() - existing.savedAt < 60000) return;
    const loaded = await this.pages(id, existing?.pages ?? 1, run); this.assertCurrent(run); this.lists.set(id, loaded);
    if (!this.localReady) this.show(loaded);
  });
  more = () => this.run(async run => {
    if (!this.state.hasMore || (this.state.retryAt && Date.parse(this.state.retryAt) > this.now())) return;
    const selected = this.state.selected;
    if (this.localReady) {
      // History fetched from the deepest cursor can land anywhere, including above it, so re-walk the expanded window.
      const previous = this.history.get(selected);
      let walked: HistoryWalk;
      if (previous) {
        await this.checked(() => this.api.rssEntries(selected ?? undefined, previous.next_cursor ?? undefined, true, run.signal), run);
        if (!this.localReady) return;
        walked = await this.anchored(previous.anchor, run, anchor => this.walk(selected, anchor, previous.pages + 1, run));
      } else {
        walked = await this.anchored(this.oldestLocal(), run, async anchor =>
          this.walk(selected, anchor, 1, run, await this.checked(() => this.api.rssEntries(selected ?? undefined, undefined, true, run.signal, anchor ?? undefined), run)));
      }
      this.assertCurrent(run);
      if (!this.localReady) return;
      this.history.set(selected, walked);
      this.watchSaved(); this.publishLocal(); return;
    }
    await this.checked(() => this.api.rssEntries(selected ?? undefined, this.state.cursor ?? undefined, true, run.signal), run);
    this.assertCurrent(run);
    const loaded = await this.pages(selected, (this.lists.get(selected)?.pages ?? 1) + 1, run); this.assertCurrent(run); this.lists.set(selected, loaded); this.show(loaded);
  });
  add = (url: string, remark: string) => this.run(async run => {
    const added = await this.checked(() => this.api.rssAdd(url.trim(), remark.trim() || null, run.signal), run); this.assertCurrent(run); this.lists.delete(null);
    if (this.stopLocal) {
      this.subscriptionOverlays.set(added.id, added); this.removed.delete(added.id);
      if (this.localSubscriptions) this.retireSubscriptionOverlays(this.localSubscriptions);
    }
    if (this.localReady) {
      this.update({subscriptions: [...this.state.subscriptions.filter(row => row.id !== added.id), added], selected: added.id, entries: [], cursor: null, hasMore: true});
      this.watchLocalEntries();
      const first = await this.checked(() => this.api.rssEntries(added.id, undefined, false, run.signal), run).catch(() => null);
      this.assertCurrent(run);
      if (this.localReady) {if (first) this.history.set(added.id, {...first, anchor: null, pages: 1}); this.watchSaved(); this.publishLocal(); return;}
    }
    this.update({selected: added.id, entries: [], cursor: null, hasMore: false, historyStatus: 'exhausted', retryAt: null}); await this.reload(run, true);
  });
  edit = (id: string, remark: string) => this.run(async run => {
    const previous = this.localSubscriptions?.find(row => row.id === id)?.remark;
    const updated = await this.checked(() => this.api.rssUpdate(id, remark.trim() || null, run.signal), run); this.assertCurrent(run);
    if (this.stopLocal) {
      this.remarkOverlays.set(id, {remark: remarkOf(updated.remark), synced: previous === undefined ? undefined : remarkOf(previous)});
      const added = this.subscriptionOverlays.get(id);
      if (added) this.subscriptionOverlays.set(id, {...added, remark: updated.remark});
      if (this.localSubscriptions) this.retireSubscriptionOverlays(this.localSubscriptions);
    }
    if (this.localReady) {this.publishLocal(); return;}
    this.update({subscriptions: this.state.subscriptions.map(sub => sub.id === id ? updated : sub)});
    for (const list of this.lists.values()) list.items = this.named(list.items);
    this.update({entries: this.named(this.state.entries)});
  });
  remove = (id: string) => this.run(async run => {
    await this.checked(() => this.api.rssRemove(id, run.signal), run); this.assertCurrent(run); this.lists.delete(id); this.lists.delete(null);
    if (this.stopLocal) {
      this.removed.set(id, this.localSubscriptions?.some(row => row.id === id) ?? false);
      this.subscriptionOverlays.delete(id); this.remarkOverlays.delete(id); this.refreshOverlays.delete(id); this.history.delete(id); this.watchSaved();
    }
    if (this.localReady) {
      this.update({subscriptions: this.state.subscriptions.filter(row => row.id !== id), entries: this.state.entries.filter(row => row.subscription_id !== id)});
      if (this.state.selected === id) {this.update({selected: null}); this.watchLocalEntries();}
      this.publishLocal(); return;
    }
    await this.reload(run, true);
  });
  refresh = (id: string) => this.run(async run => {
    const source = this.state.subscriptions.find(item => item.id === id);
    if (!source || source.refreshing || !(Date.parse(source.next_allowed_at) <= this.now())) return;
    const result = await this.checked(() => this.api.rssRefresh(id, run.signal), run); this.assertCurrent(run);
    const synced = this.localSubscriptions?.find(item => item.id === id);
    if (this.localReady && synced && Date.parse(synced.next_allowed_at) >= Date.parse(result.next_allowed_at)) {this.publishLocal(); return;}
    if (this.stopLocal) this.refreshOverlays.set(id, {next: result.next_allowed_at, previous: source.last_success_at});
    if (this.localReady) {
      this.update({subscriptions: this.state.subscriptions.map(row => row.id === id ? {...row, refreshing: true, next_allowed_at: result.next_allowed_at} : row)});
      return;
    }
    await this.reload(run, true);
  });
  poll = () => {
    if (this.localReady) return;
    const interval = this.state.subscriptions.some(item => item.refreshing) ? 5000 : 60000;
    if (!this.state.enabled || this.state.busy || this.now() - this.lastPollAt < interval) return;
    this.lastPollAt = this.now(); void this.run(run => this.reload(run));
  };
  save = (entry: RssEntry) => this.run(async run => {
    if (entry.bookmark_user_uuid || !entry.article_url) return;
    const result = await this.checked(() => this.api.rssSave(entry.id, run.signal), run); this.assertCurrent(run);
    if (!saves.has(this.saved)) this.saved(entry.id, result.bookmark_user_uuid, entry.article_url);
    reportRssSaved(entry.id, result.bookmark_user_uuid, entry.article_url);
  });
  private saved = (entryId: string, bookmarkId: string, articleUrl?: string | null) => {
    if (this.disposed || !this.isAccountActive()) return;
    if (this.stopLocal) {
      this.saveOverlays.set(entryId, {bookmark: bookmarkId, url: articleUrl});
      // Sync may have applied this save before the REST response or reader notification arrived.
      this.retireSaveOverlays();
      this.watchSaved();
    }
    const transform = (entry: RssEntry) => entry.id === entryId || (articleUrl && entry.article_url === articleUrl) ? {...entry, bookmark_user_uuid: bookmarkId} : entry;
    for (const list of this.lists.values()) list.items = list.items.map(transform);
    if (this.localReady) this.publishLocal(); else this.update({entries: this.state.entries.map(transform)});
  };
  cancel() { this.fallbackPending = false; this.generation++; this.request?.abort(); this.request = null; this.labRequest?.abort(); this.labRequest = null; this.update({busy: false}); }
  dispose() { this.cancel(); this.disposed = true; this.fallbackPending = false; this.clearLocal(); saves.delete(this.saved); this.listeners.clear(); this.lists.clear(); }
}
