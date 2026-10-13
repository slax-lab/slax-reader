import type { ApiResponse, RssSubscriptionsResponse, RssSubscription, RssRefreshResponse, RssEntriesResponse, RssEntryDetail, RssSaveResponse, AddRssSubscriptionRequest, UpdateRssSubscriptionRequest, AddUrlBookmarkRequest, JsonValue } from '@slax-reader/contracts';
import type { SessionAuthority } from '../domain/session.ts';
import {throwIfAborted} from '../utils/abort.ts';
import {PDF_MAX_BYTES, type PdfDescriptor} from '@slax-reader/contracts/pdf';
import {DataTransportError, isNetworkTransportError, httpErrorCode, PDF_REQUEST_TIMEOUT_MS, PDF_REQUEST_MAX_ATTEMPTS, PDF_RETRY_DELAYS_MS, type DataErrorStage, type DataErrorCode} from './transport-errors.ts';
export {DataTransportError, isNetworkTransportError, getDataErrorDiagnostic, PDF_REQUEST_TIMEOUT_MS, PDF_REQUEST_MAX_ATTEMPTS} from './transport-errors.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly data?: unknown;
  readonly stage: DataErrorStage;
  readonly kind: 'http' | 'protocol';
  readonly code: DataErrorCode;
  constructor(status: number, message: string, data?: unknown, diagnostic?: {stage: DataErrorStage; code?: DataErrorCode}) {
    super(message); this.name = 'ApiError'; this.status = status; this.data = data;
    this.stage = diagnostic?.stage ?? 'api'; this.kind = diagnostic?.code ? 'protocol' : 'http'; this.code = diagnostic?.code ?? httpErrorCode(status);
  }
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {signal.removeEventListener('abort', abort); try {throwIfAborted(signal);} catch (error) {reject(error);}};
    signal.addEventListener('abort', abort, {once: true});
    work.then(value => {signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(value);}, error => {signal.removeEventListener('abort', abort); reject(error);});
    if (signal.aborted) abort();
  });
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
    const identity = this.options.sessions.captureIdentity?.(), origin = this.origin, publicLogin = path === '/v1/user/login';
    if (tokenOverride === undefined && !publicLogin) {
      const preparation = this.options.sessions.prepareRequest?.() ?? Promise.resolve();
      await (signal ? abortable(preparation, signal) : preparation);
    }
    identity?.(); if (origin !== this.origin) throw new Error('API environment changed');
    throwIfAborted(signal);
    const scope = this.options.sessions.captureRequestScope?.();
    const session = publicLogin ? null : await (scope ? scope.getSession() : this.options.sessions.getSession());
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
        if (response.status === 401 && requestToken && new URL(url).origin === this.origin) await this.options.sessions.rejectIfMatches?.(requestToken, scope);
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
  async getPdfMetadata(bookmarkId: string, signal?: AbortSignal): Promise<PdfDescriptor> {
    return this.pdfRequest('/v1/bookmark/metadata', {bookmark_uid: bookmarkId}, signal, {Accept: 'application/json'}, async (response, signal) => {
      if (response.status !== 200) throw new ApiError(502, 'Invalid PDF metadata', undefined, {stage: 'pdf-metadata', code: 'pdf_metadata_invalid'});
      const envelope = await this.pdfJson<{pdf?: PdfDescriptor}>(response, signal, 'pdf-metadata');
      if (envelope.code !== 200) throw new ApiError(envelope.code, 'PDF metadata request failed', undefined, {stage: 'pdf-metadata'});
      const pdf = envelope.data?.pdf;
      if (!pdf || !/^[a-f0-9]{64}$/.test(pdf.document_id) || !Number.isSafeInteger(pdf.size) || pdf.size < 1 || pdf.size > PDF_MAX_BYTES ||
        typeof pdf.filename !== 'string' || !['url', 'upload'].includes(pdf.source) || !['pending', 'ready', 'empty', 'failed'].includes(pdf.text_status) ||
        (pdf.pages !== undefined && (!Number.isSafeInteger(pdf.pages) || pdf.pages < 1))) throw new ApiError(502, 'Invalid PDF metadata', undefined, {stage: 'pdf-metadata', code: 'pdf_metadata_invalid'});
      return {...pdf, url: `/v1/bookmark/pdf?bookmark_uid=${encodeURIComponent(bookmarkId)}`};
    });
  }
  private async pdfJson<T>(response: Response, signal: AbortSignal, stage: DataErrorStage): Promise<ApiResponse<T>> {
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError(502, 'PDF response body unavailable', undefined, {stage, code: 'pdf_body_invalid'});
    const decoder = new TextDecoder(), parts: string[] = []; let size = 0;
    const cancel = () => {void reader.cancel().catch(() => undefined);};
    signal.addEventListener('abort', cancel, {once: true});
    try {
      for (;;) {
        throwIfAborted(signal);
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {chunk = await abortable(reader.read(), signal);} catch (error) {throwIfAborted(signal); throw new DataTransportError('network', stage);}
        throwIfAborted(signal);
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1024 * 1024) throw new ApiError(502, 'PDF response body exceeds limit', undefined, {stage, code: 'pdf_body_invalid'});
        parts.push(decoder.decode(chunk.value, {stream: true}));
      }
      let value: unknown;
      try {value = JSON.parse(parts.join('') + decoder.decode());} catch {throw new ApiError(502, 'Invalid PDF response body', undefined, {stage, code: 'pdf_body_invalid'});}
      if (!value || typeof value !== 'object' || !('code' in value) || !Number.isInteger(value.code)) throw new ApiError(502, 'Invalid PDF response body', undefined, {stage, code: 'pdf_body_invalid'});
      return value as ApiResponse<T>;
    } finally {signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => undefined); reader.releaseLock();}
  }
  private async pdfRequest<T>(path: string, query: Record<string, string>, signal: AbortSignal | undefined, headers: Record<string, string>, consume: (response: Response, signal: AbortSignal) => Promise<T>, body?: Blob): Promise<T> {
    throwIfAborted(signal);
    const identity = this.options.sessions.captureIdentity?.(), origin = this.origin;
    const preparation = this.options.sessions.prepareRequest?.() ?? Promise.resolve();
    await (signal ? abortable(preparation, signal) : preparation);
    identity?.(); if (origin !== this.origin) throw new Error('API environment changed'); throwIfAborted(signal);
    const stage: DataErrorStage = body ? 'pdf-upload' : path.endsWith('/metadata') ? 'pdf-metadata' : 'pdf-range';
    const scope = this.options.sessions.captureRequestScope?.(), controller = new AbortController();
    const timeoutError = new DataTransportError('timeout', stage);
    let timedOut = false;
    const aborted = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', aborted, {once: true});
    if (signal?.aborted) aborted();
    const timer = setTimeout(() => {timedOut = true; controller.abort(timeoutError);}, PDF_REQUEST_TIMEOUT_MS);
    const check = () => {throwIfAborted(signal); scope?.assertCurrent(); if (timedOut) throw timeoutError; throwIfAborted(controller.signal);};
    try {
      const session = await abortable(scope ? scope.getSession() : this.options.sessions.getSession(), controller.signal);
      check();
      if (!session) throw new ApiError(401, 'Authentication required', undefined, {stage});
      const url = this.url(path, query), request: RequestInit = {method: body ? 'POST' : 'GET', body, redirect: 'error', signal: controller.signal,
        headers: {...headers, Authorization: `Bearer ${session.token}`, 'X-CLIENT-TYPE': this.options.platform, 'X-CLIENT-VERSION': this.options.version}};
      for (let attempt = 0; ; attempt++) {
        check(); let response: Response | undefined, retryHttp = false;
        try {
          let pending: Promise<Response>;
          try {pending = this.transport(url, request);} catch (error) {check(); throw new DataTransportError('network', stage);}
          void pending.then(value => {if (controller.signal.aborted) void value.body?.cancel().catch(() => undefined);}).catch(() => undefined);
          try {response = await abortable(pending, controller.signal);} catch (error) {check(); throw new DataTransportError('network', stage);}
          check();
          if (response.status === 401 && origin === this.origin) void this.options.sessions.rejectIfMatches?.(session.token, scope).catch(() => undefined);
          if (response.status !== 200 && response.status !== 206) {
            retryHttp = response.status >= 500 && response.status <= 599;
            throw new ApiError(response.status, `PDF request failed (${response.status})`, undefined, {stage});
          }
          const value = await abortable(consume(response, controller.signal), controller.signal); check(); return value;
        } catch (error) {
          check();
          if (body || attempt + 1 >= PDF_REQUEST_MAX_ATTEMPTS || !(retryHttp || isNetworkTransportError(error))) throw error;
        } finally {if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);}
        check();
        if (this.options.sleep) await abortable(this.options.sleep(PDF_RETRY_DELAYS_MS[attempt]), controller.signal);
        else await new Promise<void>((resolve, reject) => {
          const abort = () => {clearTimeout(wait); controller.signal.removeEventListener('abort', abort); try {check();} catch (error) {reject(error);}};
          const wait = setTimeout(() => {controller.signal.removeEventListener('abort', abort); resolve();}, PDF_RETRY_DELAYS_MS[attempt]);
          controller.signal.addEventListener('abort', abort, {once: true}); if (controller.signal.aborted) abort();
        });
        check();
      }
    } catch (error) {check(); throw error;}
    finally {clearTimeout(timer); signal?.removeEventListener('abort', aborted);}
  }
  async getPdfRange(bookmarkId: string, documentId: string, begin: number, end: number, signal?: AbortSignal, expectedSize?: number): Promise<Uint8Array> {
    if (!/^[a-f0-9]{64}$/.test(documentId) || !Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > PDF_MAX_BYTES || end - begin > 1024 * 1024 ||
      (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < end || expectedSize > PDF_MAX_BYTES))) throw new Error('Invalid PDF byte range');
    return this.pdfRequest('/v1/bookmark/pdf', {bookmark_uid: bookmarkId}, signal,
      {Accept: 'application/pdf', Range: `bytes=${begin}-${end - 1}`}, async (response, signal) => {
        const invalid = (status: number, message: string, code: DataErrorCode) => new ApiError(status, message, undefined, {stage: 'pdf-range', code});
        if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') throw invalid(502, 'Invalid PDF response content type', 'pdf_body_invalid');
        const etag = response.headers.get('ETag');
        if (etag && /^"[a-f0-9]{64}"$/.test(etag) && etag !== `"${documentId}"`) throw invalid(412, 'PDF identity changed', 'pdf_identity_mismatch');
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
        const full = response.status === 200;
        if (full && response.headers.has('Content-Range')) throw invalid(502, 'Partial PDF body returned as a full response', 'pdf_range_invalid');
        if (!full && (!match || Number(match[1]) !== begin || Number(match[2]) !== end - 1 || Number(match[3]) < end || Number(match[3]) > PDF_MAX_BYTES ||
          (expectedSize !== undefined && Number(match[3]) !== expectedSize))) throw invalid(502, 'Invalid PDF range response', 'pdf_range_invalid');
        const advertised = Number(response.headers.get('Content-Length'));
        const expected = full ? advertised : end - begin;
        if (!Number.isSafeInteger(expected) || expected <= 0 || expected > PDF_MAX_BYTES || (full && (expected < end || (expectedSize !== undefined && expected !== expectedSize))) ||
          (response.headers.has('Content-Length') && advertised !== expected)) throw invalid(502, 'Invalid PDF response length', 'pdf_length_invalid');
        const reader = response.body?.getReader();
        if (!reader) throw invalid(502, 'PDF streaming unavailable', 'pdf_stream_unavailable');
        const result = new Uint8Array(end - begin);
        const cancel = () => {void reader.cancel().catch(() => undefined);};
        signal.addEventListener('abort', cancel, {once: true});
        if (signal.aborted) cancel();
        let received = 0;
        try {
          for (;;) {
            throwIfAborted(signal);
            let chunk: ReadableStreamReadResult<Uint8Array>;
            try {chunk = await abortable(reader.read(), signal);} catch (error) {throwIfAborted(signal); throw new DataTransportError('network', 'pdf-range');}
            throwIfAborted(signal);
            const {value, done} = chunk;
            if (done) break;
            const start = full ? received : begin + received;
            received += value.byteLength;
            if (received > expected) throw invalid(502, 'PDF response exceeds its length', 'pdf_length_invalid');
            const left = Math.max(begin, start), right = Math.min(end, start + value.byteLength);
            if (right > left) result.set(value.subarray(left - start, right - start), left - begin);
          }
          if (received !== expected) throw invalid(502, 'Incomplete PDF response', 'pdf_length_invalid');
          return result;
        } finally {signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => undefined); reader.releaseLock();}
      });
  }
  async uploadPdf(body: Blob, filename: string, signal?: AbortSignal): Promise<{bookmark_uid: string; bookmark_id: number | string}> {
    if (body.size <= 0 || body.size > PDF_MAX_BYTES) throw new Error('Invalid PDF upload size');
    return this.pdfRequest('/v1/bookmark/upload_pdf', {filename}, signal, {'Content-Type': 'application/pdf', Accept: 'application/json'}, async (response, signal) => {
      const value = await this.pdfJson<{bookmark_uid: string; bookmark_id: number | string}>(response, signal, 'pdf-upload');
      if (value.code !== 200 || !value.data?.bookmark_uid) throw new ApiError(value.code, value.message ?? 'PDF upload failed', undefined, {stage: 'pdf-upload'});
      return value.data;
    }, body);
  }
  setLab = (key: string, enabled: boolean, signal?: AbortSignal) => this.request<JsonValue>(`/v1/user/setting/${enabled ? 'enable' : 'disable'}`, 'POST', {key: `lab:${key}`}, undefined, signal);
  login = (params: LoginRequest, signal?: AbortSignal) => this.request<LoginResponse>('/v1/user/login', 'POST', params, undefined, signal);
  refresh = async (token: string, signal?: AbortSignal): Promise<string> => {
    throwIfAborted(signal);
    const scope = this.options.sessions.captureRequestScope?.(), origin = this.origin;
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort();
    let timedOut = false;
    const timeout = new DataTransportError('timeout', 'api');
    const timer = setTimeout(() => {timedOut = true; controller.abort(timeout);}, 15000);
    const check = () => {throwIfAborted(signal); scope?.assertCurrent(); if (this.origin !== origin) throw new Error('API environment changed'); if (timedOut) throw timeout; throwIfAborted(controller.signal);};
    let response: Response | undefined;
    try {
      check();
      try {response = await abortable(this.transport(this.url('/v1/user/refresh'), {method: 'POST', redirect: 'error', signal: controller.signal, headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}`}}), controller.signal);}
      catch {check(); throw new DataTransportError('network', 'api');}
      check();
      if (response.status !== 200) throw new ApiError(response.status, `Session refresh failed (${response.status})`);
      const value = await abortable(this.pdfJson<{token: string}>(response, controller.signal, 'api'), controller.signal); check();
      if (value.code !== 200) throw new ApiError(value.code, 'Session refresh failed');
      if (typeof value.data?.token !== 'string' || !value.data.token) throw new ApiError(502, 'Invalid session refresh response');
      return value.data.token;
    } catch (error) {check(); throw error;}
    finally {clearTimeout(timer); signal?.removeEventListener('abort', abort); if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);}
  };
  getSyncToken = (signal?: AbortSignal) => this.request<SyncCredentials>('/v1/sync/token', 'POST', undefined, undefined, signal);
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
