import type {BookmarkSearchHit} from '@slax-reader/contracts';
import type {SearchArticle, SearchLocalPort, SearchQuery} from './types.ts';
import {plainSnippet} from './types.ts';
interface SearchApi {
  searchBookmarks(query: {keyword: string; tag_uuids: string[]}, signal: AbortSignal): Promise<BookmarkSearchHit[]>;
  getSearchBookmark(id: string | number, signal: AbortSignal): Promise<{bookmark_user_uuid?: string; uuid?: string; title?: string}>;
}
export interface SearchState {query: SearchQuery; local: SearchArticle[]; remote: SearchArticle[]; items: SearchArticle[]; busy: boolean; localBusy: boolean; hasMore: boolean; error: boolean; localError: boolean}
export class SearchController {
  private state: SearchState = {query: {text: '', tagUuids: []}, local: [], remote: [], items: [], busy: false, localBusy: false, hasMore: false, error: false, localError: false};
  private listeners = new Set<() => void>();
  private generation = 0; private stop?: () => void; private request?: AbortController; private timer?: ReturnType<typeof setTimeout>;
  private limit = 50; private disposed = false;
  private local: SearchLocalPort;
  private api: SearchApi;
  private active: () => boolean;
  private rssEnabled: () => boolean;
  constructor(local: SearchLocalPort, api: SearchApi, active: () => boolean, rssEnabled: () => boolean) {this.local = local; this.api = api; this.active = active; this.rssEnabled = rssEnabled;}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private publish(changes: Partial<SearchState>) {
    if (this.disposed || !this.active()) return;
    this.state = {...this.state, ...changes};
    const own = new Set(this.state.local.filter(row => row.kind === 'own').map(row => row.id));
    const canonical = new Set([...own, ...this.state.remote.map(row => row.id)]);
    const cloud = new Map(this.state.remote.map(row => [row.id, row]));
    this.state.items = this.state.local.filter(row => (row.kind !== 'rss' || this.rssEnabled()) && (row.kind === 'own' || !row.savedId || !canonical.has(row.savedId))).map(row => row.kind === 'own' && cloud.has(row.id) ? {...row, snippet: cloud.get(row.id)!.snippet, url: row.url || cloud.get(row.id)!.url, time: row.time || cloud.get(row.id)!.time} : row)
      .concat(this.state.remote.filter(row => !own.has(row.id)));
    for (const listener of this.listeners) listener();
  }
  setQuery(query: SearchQuery, immediate = false) {
    const current = this.state.query;
    const same = query.text === current.text && query.tagUuids.length === current.tagUuids.length
      && query.tagUuids.every(id => current.tagUuids.includes(id))
      && query.source?.kind === current.source?.kind && query.source?.id === current.source?.id
      && query.source?.ownerId === current.source?.ownerId && query.source?.label === current.source?.label;
    if (immediate && same) {
      clearTimeout(this.timer);
      if (this.state.localBusy || this.state.localError) this.watch();
      return;
    }
    this.generation++; this.request?.abort(); this.stop?.(); clearTimeout(this.timer); this.limit = 50;
    this.publish({query, local: [], remote: [], busy: false, localBusy: Boolean(query.text.trim() || query.tagUuids.length || query.source), hasMore: false, error: false, localError: false});
    if (immediate) this.watch(); else this.timer = setTimeout(() => this.watch(), 120);
  }
  private watch() {
    if (this.disposed || !this.active()) return;
    const generation = this.generation; this.stop?.();
    this.stop = this.local.watch(this.state.query, this.limit, page => {
      if (generation !== this.generation) return;
      this.publish({local: page.items, localBusy: false, hasMore: page.hasMore});
      if (this.state.remote.length) void this.admit(this.state.remote, generation).catch(() => {if (generation === this.generation) this.publish({error: true});});
    }, error => {if (generation === this.generation) {if (__DEV__) console.error('[mobile] local search failed', error); this.publish({error: true, localError: true, localBusy: false});}});
  }
  retryLocal() {this.publish({error: false, localError: false}); this.watch();}
  more() {if (this.state.hasMore) {this.limit += 50; this.publish({localBusy: true}); this.watch();}}
  private async admit(remote: SearchArticle[], generation: number) {
    const known = await this.local.admitRemote(remote.map(row => row.id), this.state.query.tagUuids);
    if (generation === this.generation && this.active()) this.publish({remote: remote.filter(row => known.get(row.id) !== false)});
  }
  async submit() {
    if (this.disposed || !this.active() || this.state.busy) return;
    if (this.state.query.source) {clearTimeout(this.timer); this.watch(); return;}
    if (!this.state.query.text.trim()) return;
    clearTimeout(this.timer); this.watch();
    const generation = this.generation, query = this.state.query, request = new AbortController();
    this.request?.abort(); this.request = request; this.publish({busy: true, error: false, localError: false});
    try {
      const hits = await this.api.searchBookmarks({keyword: query.text, tag_uuids: query.tagUuids}, request.signal);
      const remote: SearchArticle[] = [];
      // Bound compatibility lookups; modern responses already carry their saved UUID.
      for (const hit of hits) {
        if (request.signal.aborted || generation !== this.generation || !this.active()) return;
        let id = hit.bookmark_user_uuid;
        if (!id) {const detail = await this.api.getSearchBookmark(hit.bookmark_id, request.signal); id = detail.bookmark_user_uuid ?? detail.uuid;}
        if (!id || remote.some(row => row.id === id)) continue;
        remote.push({key: `own:${id}`, kind: 'own', id, title: plainSnippet(hit.highlight_title), description: '', snippet: plainSnippet(hit.highlight_content), url: hit.target_url ?? '', source: '', time: hit.created_at ?? ''});
      }
      if (!request.signal.aborted && generation === this.generation) await this.admit(remote, generation);
    } catch (error) {if (!request.signal.aborted && generation === this.generation) {if (__DEV__) console.error('[mobile] cloud search failed', error); this.publish({error: true});}}
    finally {if (this.request === request && generation === this.generation) this.publish({busy: false});}
  }
  activate() {this.disposed = false;}
  availabilityChanged() {this.publish({});}
  dispose() {this.disposed = true; this.generation++; this.request?.abort(); clearTimeout(this.timer); this.stop?.(); this.listeners.clear();}
}
