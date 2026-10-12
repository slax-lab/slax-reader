import type { ApiResponse, RssSubscriptionsResponse, RssSubscription, RssRefreshResponse, RssEntriesResponse, RssEntryDetail, RssSaveResponse, AddRssSubscriptionRequest, UpdateRssSubscriptionRequest, AddUrlBookmarkRequest, JsonValue } from '@slax-reader/contracts';
import type { SessionAuthority } from '../domain/session.ts';
import {throwIfAborted} from '../utils/abort.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly data?: unknown;
  constructor(status: number, message: string, data?: unknown) { super(message); this.name = 'ApiError'; this.status = status; this.data = data; }
}
export interface LoginRequest { code: string; redirect_uri: string; platform: string; type: 'google' | 'apple'; id_token?: string }
export interface LoginResponse { token: string; user_id: string }
export interface SyncCredentials { endpoint: string; token: string }
export interface MarkCommentProfile { uuid: string; nick_name: string; avatar: string }
export type DeleteAccountReason = 'active_subscription' | 'stripe_connect_exists' | 'collection_has_subscribers' | 'active_collection_subscription' | 'has_free_subscription_history';
export interface SyncChange { table: string; id: string; op: string; data: Record<string, string | null> | null; preData: Record<string, string | null> | null }
export interface CheckPurchase { jws_representation: string; order_id: string; product_id: string; platform: string }
export interface FeedbackRequest { bookmark_uuid: string | null; entry_point: string; type: string; content: string; platform: string; environment: string; version: string; allow_follow_up: boolean; target_url: string | null }
export interface AiEvent { type: string; data?: { overview?: string; outline?: string; tags?: {id: number; name: string}[]; tag?: {id: number; name: string}; key_takeaways?: string[]; done?: boolean }; message?: string }
export interface MobileApiOptions { baseUrl: string; platform: 'android' | 'ios'; version: string; sessions: SessionAuthority; fetch?: typeof globalThis.fetch; sleep?: (ms: number) => Promise<void> }

export class SlaxApi {
  private transport: typeof globalThis.fetch;
  private origin: string;
  readonly options: MobileApiOptions;
  constructor(options: MobileApiOptions) { this.options = {...options}; this.transport = options.fetch ?? globalThis.fetch; this.origin = ''; this.setBaseUrl(options.baseUrl); }
  /** Configure once during startup, before restoring a persisted account. */
  setBaseUrl(baseUrl: string) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('API base URL must be an HTTP(S) origin without credentials');
    this.origin = url.origin; this.options.baseUrl = url.origin;
  }
  private url(path: string, query?: Record<string, string | undefined>): string {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('API path must be relative to the configured origin');
    const url = new URL(path, this.options.baseUrl);
    if (url.origin !== this.origin) throw new Error('Refusing cross-origin API request');
    Object.entries(query ?? {}).forEach(([key, value]) => { if (value !== undefined) url.searchParams.set(key, value); });
    return url.toString();
  }
  private async response(path: string, method: 'GET' | 'POST', body?: unknown, query?: Record<string, string | undefined>, signal?: AbortSignal, timeout = 30000, tokenOverride?: string, accept = 'application/json', extraHeaders?: Record<string, string>): Promise<{response: Response; cleanup: () => void}> {
    throwIfAborted(signal);
    const scope = this.options.sessions.captureRequestScope?.();
    const session = await (scope ? scope.getSession() : this.options.sessions.getSession());
    scope?.assertCurrent();
    const requestToken = tokenOverride ?? session?.token;
    const url = this.url(path, query);
    for (let attempt = 0; ; attempt++) {
      scope?.assertCurrent();
      throwIfAborted(signal);
      const controller = new AbortController();
      const aborted = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
      const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeout);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); };
      try {
        const response = await this.transport(url, {
          method, headers: {
            'Content-Type': 'application/json', Accept: accept, 'User-Agent': `SlaxReader/${this.options.platform} ${this.options.version}`,
            ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}),
            ...extraHeaders,
          }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, redirect: 'error',
        });
        // Account cleanup may wait for this very uploader to finish. Do not await it from its HTTP response.
        if (response.status === 401 && requestToken && new URL(url).origin === this.origin) void this.options.sessions.clearIfMatches(requestToken, scope).catch(() => undefined);
        if (response.status >= 500 && attempt < 2) { await response.body?.cancel(); cleanup(); await this.delay(attempt, signal); continue; }
        if (response.status !== 200 && response.status !== 204) {
          const envelope = await response.json().catch(() => null) as {message?: string; data?: unknown} | null;
          throw new ApiError(response.status, envelope?.message ?? `Request failed (${response.status})`, envelope?.data);
        }
        return {response, cleanup};
      } catch (error) {
        cleanup();
        if (controller.signal.aborted) {throwIfAborted(signal); throwIfAborted(controller.signal);}
        if (error instanceof ApiError || attempt >= 2) throw error;
        await this.delay(attempt, signal);
      }
    }
  }
  private async delay(attempt: number, signal?: AbortSignal) {
    throwIfAborted(signal);
    await (this.options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(1000 * 2 ** attempt);
    throwIfAborted(signal);
  }
  async request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown, query?: Record<string, string | undefined>, signal?: AbortSignal, timeout?: number, tokenOverride?: string): Promise<T> {
    const {response, cleanup} = await this.response(path, method, body, query, signal, timeout, tokenOverride);
    try {
      if (response.status === 204) return undefined as T;
      const envelope = await response.json() as ApiResponse<T>;
      if (envelope.code !== 200) throw new ApiError(envelope.code, envelope.message, envelope.data);
      return envelope.data as T;
    } finally { cleanup(); }
  }
  login = (params: LoginRequest, signal?: AbortSignal) => this.request<LoginResponse>('/v1/user/login', 'POST', params, undefined, signal);
  refresh = async (token: string) => (await this.request<{token: string}>('/v1/user/refresh', 'POST', undefined, undefined, undefined, undefined, token)).token;
  getSyncToken = () => this.request<SyncCredentials>('/v1/sync/token', 'POST');
  uploadChanges = (changes: SyncChange[]) => this.request<{status: boolean}>('/v1/sync/changes', 'POST', changes);
  async getBookmarkRawContent(bookmarkId: string, signal?: AbortSignal): Promise<string> {
    const {response, cleanup} = await this.response('/v1/bookmark/content', 'POST', {bookmark_uid: bookmarkId}, undefined, signal, undefined, undefined, '*/*');
    try { return await response.text(); } finally { cleanup(); }
  }
  getCollectionBookmarkRawContent(bookmarkId: string, ownerId: string, signal?: AbortSignal): Promise<string> {
    if (!ownerId.trim()) return Promise.reject(new Error('Collection content requires its owner context'));
    // Source collection downloads use the same bookmark_uid endpoint; ownership scopes the local cache and row.
    return this.getBookmarkRawContent(bookmarkId, signal);
  }
  addBookmarkUrl = (url: string, title?: string, signal?: AbortSignal) => this.request<{bmId: string | number}>('/v1/bookmark/add_url', 'POST', {target_url: url, ...(title === undefined ? {} : {target_title: title})} satisfies Omit<AddUrlBookmarkRequest, 'tags'>, undefined, signal);
  getMarkUsers = (bookmarkId: string, signal?: AbortSignal) => this.request<MarkCommentProfile[]>('/v1/mark/users', 'GET', undefined, {bookmark_uid: bookmarkId}, signal);
  rssLabs = (signal?: AbortSignal) => this.request<{features: {key: string; enabled: boolean}[]}>('/v1/user/labs', 'GET', undefined, undefined, signal);
  rssEnable = (enabled: boolean, signal?: AbortSignal) => this.request<JsonValue>(`/v1/user/setting/${enabled ? 'enable' : 'disable'}`, 'POST', {key: 'lab:rss'}, undefined, signal);
  rssSubscriptions = (signal?: AbortSignal) => this.request<RssSubscriptionsResponse>('/v1/rss/subscriptions', 'GET', undefined, undefined, signal);
  rssAdd = (url: string, remark: string | null = null, signal?: AbortSignal) => this.request<RssSubscription>('/v1/rss/subscriptions', 'POST', {url, remark} satisfies AddRssSubscriptionRequest, undefined, signal, 120000);
  rssUpdate = (id: string, remark: string | null, signal?: AbortSignal) => this.request<RssSubscription>(`/v1/rss/subscriptions/${encodeURIComponent(id)}/update`, 'POST', {remark} satisfies UpdateRssSubscriptionRequest, undefined, signal);
  rssRemove = (id: string, signal?: AbortSignal) => this.request<JsonValue>(`/v1/rss/subscriptions/${encodeURIComponent(id)}/delete`, 'POST', undefined, undefined, signal);
  rssRefresh = (id: string, signal?: AbortSignal) => this.request<RssRefreshResponse>(`/v1/rss/subscriptions/${encodeURIComponent(id)}/refresh`, 'POST', undefined, undefined, signal);
  rssEntries = (subscriptionId?: string, cursor?: string, fetchHistory = false, signal?: AbortSignal) => this.request<RssEntriesResponse>('/v1/rss/entries', 'GET', undefined, {subscription_id: subscriptionId, cursor, limit: '20', fetch_history: fetchHistory ? '1' : undefined}, signal, fetchHistory ? 120000 : undefined);
  rssDetail = (id: string, signal?: AbortSignal) => this.request<RssEntryDetail>(`/v1/rss/entries/${encodeURIComponent(id)}`, 'GET', undefined, undefined, signal);
  rssSave = (id: string, signal?: AbortSignal) => this.request<RssSaveResponse>(`/v1/rss/entries/${encodeURIComponent(id)}/save`, 'POST', undefined, undefined, signal);
  getIAPProductIds = (signal?: AbortSignal) => this.request<{products: string[]}>('/v1/subscription/apple_inapp_products', 'GET', undefined, undefined, signal);
  checkIapResult = (params: CheckPurchase, signal?: AbortSignal) => this.request<{ok: boolean}>('/v1/subscription/check_inapp_purchase', 'POST', params, undefined, signal);
  deleteAccount = (signal?: AbortSignal) => this.request<{canDelete: boolean; reason?: DeleteAccountReason | null}>('/v1/user/delete_my_account', 'POST', undefined, undefined, signal);
  sendFeedback = (params: FeedbackRequest, signal?: AbortSignal) => this.request<string>('/v1/user/report', 'POST', params, undefined, signal);
  async sendClientEvents(deviceId: string, events: {event_name: string; occurred_at: string; properties: Record<string, string>}[]): Promise<void> {
    const {response, cleanup} = await this.response('/events', 'POST', {events}, undefined, undefined, undefined, undefined, '*/*', {'X-Device-ID': deviceId, 'X-CLIENT-TYPE': this.options.platform, 'X-CLIENT-VERSION': this.options.version});
    try { await response.body?.cancel(); } finally { cleanup(); }
  }
  async sendMetrics(type: 'heartbeat' | 'ai_overview' | 'ai_summary'): Promise<void> {
    try {
      const {response, cleanup} = await this.response('/m', 'GET', undefined, undefined, undefined, undefined, undefined, '*/*', {'X-CLIENT-TYPE': this.options.platform, 'X-ACTION-TYPE': type, 'X-CLIENT-VERSION': this.options.version});
      try { await response.body?.cancel(); } finally { cleanup(); }
    } catch { /* Source metrics are best effort and cannot interrupt reader behavior. */ }
  }
  async *streamAi(kind: 'overview' | 'outline', bookmarkId: string, signal?: AbortSignal): AsyncGenerator<AiEvent> {
    const {response, cleanup} = await this.response(`/v1/bookmark/${kind}`, 'POST', {bookmark_uid: bookmarkId, force: false}, undefined, signal, 120000, undefined, 'text/event-stream');
    if (!response.body) { cleanup(); throw new Error('Streaming transport is unavailable'); }
    const reader = response.body.getReader();
    const cancelled = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
    signal?.addEventListener('abort', cancelled, {once: true});
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        throwIfAborted(signal);
        const {done, value} = await reader.read();
        throwIfAborted(signal);
        buffer += decoder.decode(value, {stream: !done});
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        if (done && buffer) { lines.push(buffer); buffer = ''; }
        for (const line of lines) {
          const json = line.trim();
          if (json) yield JSON.parse(json) as AiEvent;
        }
        if (done) break;
      }
    } finally { signal?.removeEventListener('abort', cancelled); cleanup(); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
}
export function createMobileApi(options: MobileApiOptions): SlaxApi { return new SlaxApi(options); }
