/** Deterministic test transport. It never falls through to a network implementation. */
export interface FixtureRoute {
  method: string; path: string; query: Record<string, string>; status: number; delayMs: number;
  requestBody?: unknown; json?: unknown; text?: string; contentType?: string;
  chunks?: {text: string; delayMs: number}[];
}
import type {FixturePdf, FixturePdfCounts} from './pdf.ts';
export interface FixtureTransportPayload {api: FixtureRoute[]; network: {isInternetReachable: boolean; isConnected?: boolean}; unmatchedRequest?: string}
export interface FixturePdfTransport {documents: Map<string, FixturePdf>; counts: FixturePdfCounts; record(): void; slowRange?: boolean; rangeEvent?(event: {begin: number; end: number; state: 'requested' | 'completed' | 'aborted'}): void; importPdf?: {accept(body: unknown, signal?: AbortSignal | null): Promise<{bookmark_uid: string; bookmark_id: string}>}}
function subset(expected: unknown, actual: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return expected === actual;
  if (actual === null || typeof actual !== 'object') return false;
  return Object.entries(expected).every(([key, value]) => subset(value, (actual as Record<string, unknown>)[key]));
}
async function waitForResponse(delayMs: number, signal?: AbortSignal | null) {
  throwIfAborted(signal);
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const aborted = () => {clearTimeout(timer); reject(signal?.reason ?? new Error('Fixture request aborted'));};
    const timer = setTimeout(() => {signal?.removeEventListener('abort', aborted); resolve();}, delayMs);
    signal?.addEventListener('abort', aborted, {once: true});
  });
  throwIfAborted(signal);
}
/** RN's installed Response polyfill does not accept a ReadableStream constructor body. */
function streamedResponse(body: ReadableStream<Uint8Array>, init: ResponseInit): Response {
  const response = new Response(null, init);
  let consumed = false;
  const text = async () => {
    if (consumed || body.locked) throw new TypeError('Fixture response body is already consumed');
    consumed = true;
    const reader = body.getReader(), decoder = new TextDecoder();
    let result = '';
    try {
      while (true) {
        const {value, done} = await reader.read();
        result += decoder.decode(value, {stream: !done});
        if (done) return result;
      }
    } finally {reader.releaseLock();}
  };
  Object.defineProperties(response, {
    body: {value: body},
    bodyUsed: {get: () => consumed || body.locked},
    text: {value: text},
    json: {value: async () => JSON.parse(await text())},
    // No application consumer clones a stream. Refuse an unsupported operation explicitly.
    clone: {value: () => {throw new TypeError('Prepared fixture streams cannot be cloned');}},
  });
  return response;
}
function pdfJsonResponse(value: unknown, signal?: AbortSignal | null): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({pull(controller) {
    try {
      throwIfAborted(signal);
      if (offset === bytes.length) {controller.close(); return;}
      const end = Math.min(offset + 16384, bytes.length);
      controller.enqueue(bytes.slice(offset, end)); offset = end;
    } catch (error) {controller.error(error);}
  }}, {highWaterMark: 0});
  return streamedResponse(body, {headers: {'Content-Type': 'application/json', 'Content-Length': String(bytes.length), 'Cache-Control': 'no-store'}});
}
export function createFixtureFetch(payload: FixtureTransportPayload, origin = 'https://fixture-api.test', pdf?: FixturePdfTransport): typeof globalThis.fetch {
  const allowed = new URL(origin);
  if (allowed.protocol !== 'https:' || !allowed.hostname.endsWith('.test') || allowed.username || allowed.password) throw new Error('Fixture transport requires a synthetic HTTPS .test origin');
  return async (input, init) => {
    const request = typeof input === 'object' && 'url' in input ? input as Request : null;
    const url = new URL(request?.url ?? String(input));
    if (url.origin !== allowed.origin) throw new Error('Fixture transport rejected an external origin');
    const signal = init?.signal ?? request?.signal;
    throwIfAborted(signal);
    const pdfRequest = url.pathname === '/v1/bookmark/pdf' || url.pathname === '/v1/bookmark/metadata';
    if (!payload.network.isInternetReachable || payload.network.isConnected === false || payload.unmatchedRequest === 'offline-error') {
      if (pdfRequest && pdf) {pdf.counts.offlineRequests++; pdf.record();}
      throw new TypeError('Fixture network is offline');
    }
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (url.pathname === '/v1/bookmark/upload_pdf') {
      if (!pdf?.importPdf || method !== 'POST') throw new Error('Native PDF import is not enabled for this fixture');
      if (new Headers(init?.headers ?? request?.headers).get('Content-Type') !== 'application/pdf') throw new Error('Fixture PDF upload requires a raw PDF body');
      const data = await pdf.importPdf.accept(init?.body, signal);
      throwIfAborted(signal);
      return pdfJsonResponse({code: 200, message: 'Synthetic upload accepted', data}, signal);
    }
    if (pdfRequest && pdf) {
      const document = pdf.documents.get(url.searchParams.get('bookmark_uid') ?? '');
      if (!document || method !== 'GET') {pdf.counts.rejectedRequests++; pdf.record(); return new Response(null, {status: 404});}
      if (url.pathname.endsWith('metadata')) {
        pdf.counts.metadataRequests++; pdf.record();
        return pdfJsonResponse({code: 200, message: 'Fixture response', data: {pdf: document.descriptor}}, signal);
      }
      const headers = new Headers(init?.headers ?? request?.headers);
      const match = /^bytes=(\d+)-(\d+)$/.exec(headers.get('Range') ?? '');
      const begin = Number(match?.[1]), end = Number(match?.[2]) + 1;
      const status = !match || !Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > document.bytes.length ? 416 : 206;
      if (status !== 206) {pdf.counts.rejectedRequests++; pdf.record(); return new Response(null, {status, headers: {'Content-Range': `bytes */${document.bytes.length}`}});}
      pdf.counts.rangeRequests++; pdf.record(); pdf.rangeEvent?.({begin, end, state: 'requested'});
      try {if (pdf.slowRange) await waitForResponse(begin === 0 ? 500 : 5000, signal);}
      catch (error) {pdf.rangeEvent?.({begin, end, state: 'aborted'}); throw error;}
      let position = begin, finished = false;
      const finish = (state: 'completed' | 'aborted') => {if (!finished) {finished = true; pdf.rangeEvent?.({begin, end, state});}};
      const body = new ReadableStream<Uint8Array>({pull(controller) {
        try {
          throwIfAborted(signal);
          if (position === end) {finish('completed'); controller.close(); return;}
          const stop = Math.min(position + 16384, end), bytes = document.bytes.slice(position, stop);
          position = stop; pdf.counts.bytesServed += bytes.length; pdf.record(); controller.enqueue(bytes);
        } catch (error) {finish('aborted'); controller.error(error);}
      }, cancel() {finish('aborted');}});
      return streamedResponse(body, {status: 206, headers: {'Content-Type': 'application/pdf', 'Content-Range': `bytes ${begin}-${end - 1}/${document.bytes.length}`, 'Content-Length': String(end - begin), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store'}});
    }
    const rawBody = init?.body ?? (request ? await request.text() : null);
    let body: unknown = null;
    if (rawBody) {if (typeof rawBody !== 'string') throw new Error('Fixture transport only accepts the application JSON request body'); body = JSON.parse(rawBody);}
    const matches = payload.api.filter(route => route.method === method && route.path === url.pathname && Object.entries(route.query).every(([key, value]) => url.searchParams.get(key) === value) && (route.requestBody === undefined || subset(route.requestBody, body)));
    matches.sort((a, b) => (Object.keys(b.query).length + Number(b.requestBody !== undefined)) - (Object.keys(a.query).length + Number(a.requestBody !== undefined)));
    const route = matches[0];
    if (!route) throw new Error(`No prepared fixture response for ${method} ${url.pathname}`);
    await waitForResponse(route.delayMs, signal);
    const responseInit = {status: route.status, headers: {'Content-Type': route.contentType ?? 'application/json', 'Cache-Control': 'no-store'}};
    if (route.chunks) {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          void (async () => {
            try {
              for (const chunk of route.chunks!) {
                await waitForResponse(chunk.delayMs, signal);
                if (cancelled) return;
                controller.enqueue(new TextEncoder().encode(chunk.text));
              }
              if (!cancelled) controller.close();
            } catch (error) {if (!cancelled) controller.error(error);}
          })();
        },
        cancel() {cancelled = true;},
      });
      return streamedResponse(stream, responseInit);
    }
    return new Response(route.text ?? JSON.stringify(route.json), responseInit);
  };
}
import {throwIfAborted} from '../src/utils/abort';
