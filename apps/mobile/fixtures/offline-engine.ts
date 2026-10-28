import type {PdfDescriptor} from '@slax-reader/contracts/pdf';
import type {OfflineEngine, OfflineScope, OfflineStatusEvent, OfflineStatusItem, OfflineTask} from '../src/data/offline-engine';

const BLOCK = 256 * 1024, WINDOW = 1024 * 1024;
type Pdf = {descriptor: PdfDescriptor; bytes: Uint8Array; blocks: Set<number>};
const coded = (code: string, message = code) => Object.assign(new Error(message), {code});
/**
 * Development-only stand-in for the native `SlaxOfflineEngine`, so fixtures drive the production OfflineCoordinator.
 * It keeps acquired copies in memory, never opens the database and never computes content hashes.
 */
/** Test inspection of acquired bytes; the app itself never reads PDF bytes through JavaScript. */
type FixturePdfInspection = {readPdfRange(owner: string, request: {key: string; id: string; documentId: string; size: number; begin: number; end: number; requestId: string}): Promise<Uint8Array>};
export function createFixtureOfflineEngine(options: {fetch: typeof globalThis.fetch; articles?: (key: string) => Promise<string | null>}): OfflineEngine & FixturePdfInspection & {settled(): Promise<void>} {
  let scope: OfflineScope | null = null, token: string | null = null, online = true, suspended = false, closed = false, worker: Promise<void> = Promise.resolve();
  const status = new Set<(event: OfflineStatusEvent) => void>(), rejected = new Set<(event: {owner: string; generation: number}) => void>();
  const tasks = new Map<string, OfflineTask>(), pdfs = new Map<string, Pdf>(), articles = new Map<string, string>(), requests = new Map<string, AbortController>();
  let generation = 0, background = new AbortController();
  const emit = (items: OfflineStatusItem[]) => {if (scope && !closed) for (const listener of status) listener({owner: scope.owner, items});};
  const current = (owner: string) => {if (closed || !scope || owner !== scope.owner) throw coded('CANCELLED');};
  const request = async (path: string, init: RequestInit, signal: AbortSignal) => {
    if (!scope || !token) throw coded('HTTP_401');
    if (!online) throw coded('NETWORK');
    let response: Response;
    try {response = await options.fetch(`${scope.origin}${path}`, {...init, signal, redirect: 'error', headers: {...init.headers as Record<string, string>, Authorization: `Bearer ${token}`, 'X-CLIENT-TYPE': scope.clientType, 'X-CLIENT-VERSION': scope.clientVersion}});}
    catch (error) {if (signal.aborted) throw coded('CANCELLED'); throw coded('NETWORK', error instanceof Error ? error.message : 'network');}
    if (response.status === 401) for (const listener of rejected) listener({owner: scope.owner, generation});
    if (response.status !== 200 && response.status !== 206) {await response.body?.cancel().catch(() => undefined); throw coded(`HTTP_${response.status}`);}
    return response;
  };
  const metadata = async (id: string, key: string, signal: AbortSignal, allowNetwork: boolean) => {
    const cached = pdfs.get(key);
    if (!allowNetwork || !online) {if (cached) return cached.descriptor; throw coded('NETWORK');}
    try {
      const response = await request(`/v1/bookmark/metadata?bookmark_uid=${encodeURIComponent(id)}`, {method: 'GET', headers: {Accept: 'application/json'}}, signal);
      const descriptor = ((await response.json()) as {data?: {pdf?: PdfDescriptor}}).data?.pdf;
      if (!descriptor || !Number.isSafeInteger(descriptor.size) || descriptor.size < 1) throw coded('PDF_METADATA_INVALID');
      if (!cached || cached.descriptor.document_id !== descriptor.document_id || cached.descriptor.size !== descriptor.size) {
        if (cached) emit([{key, state: 'invalidated', manual: tasks.get(key)?.manual ?? false}]);
        pdfs.set(key, {descriptor, bytes: new Uint8Array(descriptor.size), blocks: new Set()});
      } else cached.descriptor = descriptor;
      return descriptor;
    } catch (error) {
      const code = (error as {code?: string}).code;
      if (/^HTTP_(401|403|404|412)$/.test(code ?? '')) {if (cached) {pdfs.delete(key); emit([{key, state: 'invalidated', manual: tasks.get(key)?.manual ?? false}]);} throw error;}
      if (code === 'NETWORK' && cached) return cached.descriptor;
      throw error;
    }
  };
  const fill = async (id: string, key: string, pdf: Pdf, begin: number, end: number, signal: AbortSignal) => {
    const blocks: number[] = [];
    for (let block = Math.floor(begin / BLOCK) * BLOCK; block < end; block += BLOCK) if (!pdf.blocks.has(block)) blocks.push(block);
    const one = async (block: number) => {
      const stop = Math.min(block + BLOCK, pdf.descriptor.size);
      const response = await request(`/v1/bookmark/pdf?bookmark_uid=${encodeURIComponent(id)}`, {method: 'GET', headers: {Accept: 'application/pdf', Range: `bytes=${block}-${stop - 1}`}}, signal);
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
      if (response.status !== 206 || !range || Number(range[1]) !== block || Number(range[2]) !== stop - 1 || Number(range[3]) !== pdf.descriptor.size) throw coded('PDF_RANGE_INVALID');
      const bytes = await read(response, stop - block, signal);
      if (signal.aborted) throw coded('CANCELLED');
      if (bytes.byteLength !== stop - block) throw coded('PDF_LENGTH_INVALID');
      if (pdfs.get(key) !== pdf) throw coded('CANCELLED');
      pdf.bytes.set(bytes, block); pdf.blocks.add(block);
    };
    // The leading block commits first, then the rest of the window transfers in parallel.
    if (blocks.length) await one(blocks.shift()!);
    await Promise.all(blocks.map(one));
  };
  const read = async (response: Response, limit: number, signal: AbortSignal) => {
    const reader = response.body?.getReader(); if (!reader) throw coded('PDF_STREAM_UNAVAILABLE');
    const result = new Uint8Array(limit); let offset = 0;
    try {
      for (;;) {
        if (signal.aborted) throw coded('CANCELLED');
        const {done, value} = await reader.read();
        if (done) break;
        if (offset + value.byteLength > limit) throw coded('PDF_LENGTH_INVALID');
        result.set(value, offset); offset += value.byteLength;
      }
    } catch (error) {if (signal.aborted) throw coded('CANCELLED'); throw (error as {code?: string}).code ? error : coded('NETWORK');}
    finally {await reader.cancel().catch(() => undefined);}
    return offset === limit ? result : result.subarray(0, offset);
  };
  const complete = (pdf?: Pdf) => !!pdf && pdf.blocks.size === Math.ceil(pdf.descriptor.size / BLOCK);
  const acquire = (task: OfflineTask) => {
    worker = worker.then(async () => {
      if (closed || suspended || tasks.get(task.key) !== task) return;
      const signal = background.signal;
      try {
        if (task.kind === 'pdf') {
          if (complete(pdfs.get(task.key))) {emit([{key: task.key, state: 'complete', manual: task.manual}]); return;}
          emit([{key: task.key, state: 'downloading', manual: task.manual}]);
          await metadata(task.id, task.key, signal, true);
          const pdf = pdfs.get(task.key)!;
          for (let begin = 0; begin < pdf.descriptor.size; begin += WINDOW) await fill(task.id, task.key, pdf, begin, Math.min(begin + WINDOW, pdf.descriptor.size), signal);
        } else if (!articles.has(task.key)) {
          emit([{key: task.key, state: 'downloading', manual: task.manual}]);
          const response = await request('/v1/bookmark/content', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: '*/*'}, body: JSON.stringify({bookmark_uid: task.id})}, signal);
          articles.set(task.key, await response.text());
        }
        if (tasks.get(task.key) === task) emit([{key: task.key, state: 'complete', manual: task.manual}]);
      } catch (error) {
        const code = (error as {code?: string}).code ?? 'unknown';
        if (code === 'CANCELLED' || signal.aborted || closed) return;
        emit([{key: task.key, state: /^HTTP_4/.test(code) ? 'denied' : 'failed', manual: task.manual, code}]);
      }
    });
  };
  const cancellable = <T>(requestId: string, work: (signal: AbortSignal) => Promise<T>) => {
    const controller = new AbortController(); requests.set(requestId, controller);
    return work(controller.signal).finally(() => requests.delete(requestId));
  };
  return {
    async open(value) {scope = value; closed = false; return {adopted: [], dropped: [], migrationPending: false};},
    async commitMigration() {},
    async suspend(owner) {current(owner); suspended = true; background.abort(); background = new AbortController(); await worker;},
    resume(owner) {current(owner); suspended = false; for (const task of tasks.values()) acquire(task);},
    async close() {closed = true; background.abort(); requests.forEach(controller => controller.abort()); tasks.clear(); await worker;},
    setCredential(owner, credential) {current(owner); token = credential?.token ?? null; generation = credential?.generation ?? generation;},
    setConditions(owner, conditions) {current(owner); const resumed = !online && conditions.online; online = conditions.online; if (resumed) for (const task of tasks.values()) acquire(task);},
    applyPlan(owner, plan) {
      current(owner);
      for (const key of plan.remove) tasks.delete(key);
      for (const task of plan.upsert) {tasks.set(task.key, task); acquire(task);}
    },
    async evict(owner, keys) {current(owner); const removed = keys.filter(key => !tasks.has(key) && (articles.delete(key) || pdfs.delete(key))); return removed;},
    protect(_owner, key) {return key;}, release() {},
    async readArticle(owner, key) {current(owner); return articles.get(key) ?? await options.articles?.(key) ?? null;},
    fetchArticle(owner, value) {
      current(owner);
      return cancellable(value.requestId, async signal => {
        if (!value.force && articles.has(value.key)) return articles.get(value.key)!;
        const response = await request('/v1/bookmark/content', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: '*/*'}, body: JSON.stringify({bookmark_uid: value.id})}, signal);
        const html = await response.text(); articles.set(value.key, html); return html;
      });
    },
    pdfMetadata(owner, value) {current(owner); return cancellable(value.requestId, signal => metadata(value.id, value.key, signal, value.allowNetwork));},
    readPdfRange(owner, value) {
      current(owner);
      return cancellable(value.requestId, async signal => {
        const pdf = pdfs.get(value.key);
        if (!pdf || pdf.descriptor.document_id !== value.documentId || pdf.descriptor.size !== value.size) throw coded('HTTP_412');
        await fill(value.id, value.key, pdf, value.begin, value.end, signal);
        return pdf.bytes.slice(value.begin, value.end);
      });
    },
    async pdfStatus(owner, key) {
      current(owner); const pdf = pdfs.get(key);
      return pdf ? {downloadedBytes: [...pdf.blocks].reduce((total, block) => total + Math.min(BLOCK, pdf.descriptor.size - block), 0), totalBytes: pdf.descriptor.size, complete: complete(pdf)} : {downloadedBytes: 0, totalBytes: 0, complete: false};
    },
    cancel(_owner, requestId) {requests.get(requestId)?.abort();},
    async usage(owner, keys) {current(owner); return {article: keys.reduce((total, key) => total + (articles.get(key)?.length ?? 0) + (pdfs.get(key)?.blocks.size ?? 0) * BLOCK, 0), images: 0};},
    async clear(owner, keys, categories) {current(owner); return categories.includes('article') ? keys.filter(key => articles.delete(key) || pdfs.delete(key)) : [];},
    addListener(event: 'onStatus' | 'onCredentialRejected', listener: never) {
      const set = (event === 'onStatus' ? status : rejected) as Set<unknown>;
      set.add(listener); return {remove() {set.delete(listener);}};
    },
    settled: () => worker,
  } as OfflineEngine & FixturePdfInspection & {settled(): Promise<void>};
}
