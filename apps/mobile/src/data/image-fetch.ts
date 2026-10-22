import {throwIfAborted} from '../utils/abort.ts';
import {retryAfterMs} from './transport-errors.ts';

type ImageFetch = (url: string, options: {signal: AbortSignal}) => Promise<Pick<Response, 'ok' | 'headers' | 'arrayBuffer'> & Partial<Pick<Response, 'status'>>>;
export async function fetchCacheImage(fetch: ImageFetch, url: string, signal: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal);
  const request = new AbortController(), abort = () => request.abort(signal.reason);
  signal.addEventListener('abort', abort, {once: true});
  const timeout = setTimeout(() => request.abort(), 30_000);
  try {
    const response = await fetch(url, {signal: request.signal});
    throwIfAborted(request.signal);
    const contentType = response.headers.get('content-type');
    if (!response.ok) throw Object.assign(new Error('Automatic image cache request failed'), {status: response.status, retryAfterMs: retryAfterMs(response.headers.get('retry-after'))});
    if (contentType !== null && !contentType.toLowerCase().startsWith('image/')) throw Object.assign(new Error('Automatic image cache response type is invalid'), {status: 415});
    const bytes = new Uint8Array(await response.arrayBuffer());
    throwIfAborted(request.signal);
    return bytes;
  } finally {clearTimeout(timeout); signal.removeEventListener('abort', abort);}
}
