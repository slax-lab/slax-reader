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
const emptyState = (): RssState => ({ready: false, enabled: false, busy: false, subscriptions: [], selected: null, entries: [], cursor: null, hasMore: false, historyStatus: 'exhausted', retryAt: null, error: null});
const errorCodes = new Set(['lab_disabled', 'invalid_feed', 'invalid_remark', 'unsafe_url', 'limit_reached', 'refresh_limited', 'source_unavailable', 'not_found', 'article_url_missing']);
export function rssDisplayName(source: RssSubscription) { return source.remark?.trim() || source.title; }
export function rssErrorCode(error: unknown): string {
  const code = error instanceof ApiError && typeof error.data === 'object' && error.data !== null ? (error.data as {error?: unknown}).error : error instanceof Error ? error.message : null;
  return typeof code === 'string' && errorCodes.has(code) ? code : 'source_unavailable';
}
const saves = new Set<(entryId: string, bookmarkId: string, articleUrl?: string | null) => void>();
/** Notify live feed caches after saving from the reader as well as from a row. */
export function reportRssSaved(entryId: string, bookmarkId: string, articleUrl?: string | null) { saves.forEach(listener => listener(entryId, bookmarkId, articleUrl)); }

/** Source RssViewModel semantics, including expanded-window history reload and cancellation. */
export class RssController {
  private state = emptyState(); private listeners = new Set<() => void>(); private lists = new Map<string | null, CachedList>();
  private request: AbortController | null = null; private generation = 0; private lastPollAt = 0; private disposed = false;
  constructor(private api: SlaxApi, private now = Date.now, private isAccountActive = () => true) {}
  activate() {this.disposed = false; saves.add(this.saved);}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => {this.listeners.delete(listener);}; };
  private update(change: Partial<RssState>) { this.state = {...this.state, ...change}; this.listeners.forEach(listener => listener()); }
  private versions(source: string | null) { return JSON.stringify(this.state.subscriptions.filter(item => source === null || item.id === source).map(item => [item.id, item.last_success_at]).sort()); }
  private named(items: RssEntry[]) { return items.map(entry => { const sub = this.state.subscriptions.find(item => item.id === entry.subscription_id); return sub ? {...entry, source_title: rssDisplayName(sub)} : entry; }); }
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
        if (code === 'lab_disabled') {this.lists.clear(); this.state = emptyState();}
        this.update({error: code});
      }
      return false;
    } finally { if (stamp === this.generation && !this.disposed && this.isAccountActive()) {this.request = null; this.update({busy: false, ...(this.current(run) ? {ready: true} : {})});} }
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
  private show(list: CachedList) { this.update({entries: list.items, cursor: list.cursor, hasMore: list.hasMore, historyStatus: list.historyStatus, retryAt: list.retryAt}); }
  private async reload(run: RssRun, force = false) {
    const subscriptions = (await this.checked(() => this.api.rssSubscriptions(run.signal), run)).items;
    this.assertCurrent(run);
    for (const source of this.lists.keys()) if (source !== null && !subscriptions.some(item => item.id === source)) this.lists.delete(source);
    const selected = subscriptions.some(item => item.id === this.state.selected) ? this.state.selected : null;
    this.update({subscriptions, selected});
    const existing = this.lists.get(selected);
    if (existing) { existing.items = this.named(existing.items); this.show(existing); }
    else this.update({entries: [], cursor: null, hasMore: false, historyStatus: 'exhausted', retryAt: null});
    if (existing && !force && existing.versions === this.versions(selected) && this.now() - existing.savedAt < 60000) return;
    const loaded = await this.pages(selected, existing?.pages ?? 1, run); this.assertCurrent(run); this.lists.set(selected, loaded); this.show(loaded);
  }
  load = () => this.run(async run => {
    const enabled = (await this.checked(() => this.api.rssLabs(run.signal), run)).features.some(item => item.key === 'rss' && item.enabled);
    this.assertCurrent(run);
    if (!enabled) {this.lists.clear(); this.update({...emptyState(), ready: true, busy: true}); return;}
    this.update({enabled}); await this.reload(run);
  });
  select = (id: string | null) => this.run(async run => {
    if (id !== null && !this.state.subscriptions.some(item => item.id === id)) return;
    this.update({selected: id}); const existing = this.lists.get(id);
    if (existing) this.show(existing); else this.update({entries: [], cursor: null, hasMore: false, historyStatus: 'exhausted', retryAt: null});
    if (existing && existing.versions === this.versions(id) && this.now() - existing.savedAt < 60000) return;
    const loaded = await this.pages(id, existing?.pages ?? 1, run); this.assertCurrent(run); this.lists.set(id, loaded); this.show(loaded);
  });
  more = () => this.run(async run => {
    if (!this.state.hasMore || (this.state.retryAt && Date.parse(this.state.retryAt) > this.now())) return;
    const selected = this.state.selected;
    await this.checked(() => this.api.rssEntries(selected ?? undefined, this.state.cursor ?? undefined, true, run.signal), run);
    this.assertCurrent(run);
    const loaded = await this.pages(selected, (this.lists.get(selected)?.pages ?? 1) + 1, run); this.assertCurrent(run); this.lists.set(selected, loaded); this.show(loaded);
  });
  add = (url: string, remark: string) => this.run(async run => {
    const added = await this.checked(() => this.api.rssAdd(url.trim(), remark.trim() || null, run.signal), run); this.assertCurrent(run); this.lists.delete(null);
    this.update({selected: added.id, entries: [], cursor: null, hasMore: false, historyStatus: 'exhausted', retryAt: null}); await this.reload(run, true);
  });
  edit = (id: string, remark: string) => this.run(async run => {
    const updated = await this.checked(() => this.api.rssUpdate(id, remark.trim() || null, run.signal), run); this.assertCurrent(run);
    this.update({subscriptions: this.state.subscriptions.map(sub => sub.id === id ? updated : sub)});
    for (const list of this.lists.values()) list.items = this.named(list.items);
    this.update({entries: this.named(this.state.entries)});
  });
  remove = (id: string) => this.run(async run => { await this.checked(() => this.api.rssRemove(id, run.signal), run); this.assertCurrent(run); this.lists.delete(id); this.lists.delete(null); await this.reload(run, true); });
  refresh = (id: string) => this.run(async run => {
    const source = this.state.subscriptions.find(item => item.id === id);
    if (!source || source.refreshing || !(Date.parse(source.next_allowed_at) <= this.now())) return;
    await this.checked(() => this.api.rssRefresh(id, run.signal), run); this.assertCurrent(run); await this.reload(run, true);
  });
  poll = () => {
    const interval = this.state.subscriptions.some(item => item.refreshing) ? 5000 : 60000;
    if (!this.state.enabled || this.state.busy || this.now() - this.lastPollAt < interval) return;
    this.lastPollAt = this.now(); void this.run(run => this.reload(run));
  };
  save = (entry: RssEntry) => this.run(async run => {
    if (entry.bookmark_user_uuid || !entry.article_url) return;
    const result = await this.checked(() => this.api.rssSave(entry.id, run.signal), run); this.assertCurrent(run); reportRssSaved(entry.id, result.bookmark_user_uuid, entry.article_url);
  });
  private saved = (entryId: string, bookmarkId: string, articleUrl?: string | null) => {
    if (this.disposed || !this.isAccountActive()) return;
    const transform = (entry: RssEntry) => entry.id === entryId || (articleUrl && entry.article_url === articleUrl) ? {...entry, bookmark_user_uuid: bookmarkId} : entry;
    for (const list of this.lists.values()) list.items = list.items.map(transform);
    this.update({entries: this.state.entries.map(transform)});
  };
  cancel() { this.generation++; this.request?.abort(); this.request = null; this.update({busy: false}); }
  dispose() { this.cancel(); this.disposed = true; saves.delete(this.saved); this.listeners.clear(); this.lists.clear(); }
}
