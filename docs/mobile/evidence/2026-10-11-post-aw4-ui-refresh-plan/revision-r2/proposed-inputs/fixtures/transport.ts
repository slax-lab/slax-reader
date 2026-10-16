/** Deterministic test transport. It never falls through to a network implementation. */
export interface FixtureRoute {
  method: string; path: string; query: Record<string, string>; status: number; delayMs: number;
  requestBody?: unknown; json?: unknown; text?: string; contentType?: string;
  chunks?: {text: string; delayMs: number}[];
}
export interface FixtureTransportPayload {api: FixtureRoute[]; network: {isInternetReachable: boolean}; unmatchedRequest?: string}
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
export function createFixtureFetch(payload: FixtureTransportPayload, origin = 'https://fixture-api.test'): typeof globalThis.fetch {
  const allowed = new URL(origin);
  if (allowed.protocol !== 'https:' || !allowed.hostname.endsWith('.test') || allowed.username || allowed.password) throw new Error('Fixture transport requires a synthetic HTTPS .test origin');
  return async (input, init) => {
    const request = typeof input === 'object' && 'url' in input ? input as Request : null;
    const url = new URL(request?.url ?? String(input));
    if (url.origin !== allowed.origin) throw new Error('Fixture transport rejected an external origin');
    const signal = init?.signal ?? request?.signal;
    throwIfAborted(signal);
    if (!payload.network.isInternetReachable || payload.unmatchedRequest === 'offline-error') throw new Error('Fixture network is offline');
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
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
