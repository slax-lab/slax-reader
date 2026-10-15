import {throwIfAborted} from '../utils/abort.ts';

export const ARTICLE_MAX_BYTES = 20 * 1024 * 1024;
const oversized = () => Object.assign(new Error('Article body exceeds the offline resource budget'), {kind: 'protocol', code: 'offline_integrity_invalid'});
export async function readArticleBody(response: Response, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const length = Number(response.headers.get('content-length'));
  if (length > ARTICLE_MAX_BYTES) {await response.body?.cancel().catch(() => undefined); throw oversized();}
  if (!response.body) {
    const text = await response.text(); throwIfAborted(signal);
    if (new TextEncoder().encode(text).byteLength > ARTICLE_MAX_BYTES) throw oversized();
    return text;
  }
  const reader = response.body.getReader(), decoder = new TextDecoder(), parts: string[] = [];
  let size = 0;
  const abort = () => {void reader.cancel().catch(() => undefined);};
  signal?.addEventListener('abort', abort, {once: true});
  try {
    while (true) {
      throwIfAborted(signal); const value = await reader.read(); throwIfAborted(signal);
      if (value.done) break;
      size += value.value.byteLength;
      if (size > ARTICLE_MAX_BYTES) throw oversized();
      parts.push(decoder.decode(value.value, {stream: true}));
    }
    parts.push(decoder.decode()); return parts.join('');
  } finally {signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock();}
}
