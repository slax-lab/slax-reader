import type {ArticleFileCache} from '../data/cache.ts';
import {normalizeImageUrl} from '../data/cache-paths.ts';
import {AccountInactiveError} from '../data/account-lease.ts';
import {linkedAbortTimeout, throwIfAborted} from '../utils/abort.ts';

export const isCustomGalleryImage = (uri: string) => /^slaxstatics?:\/\//i.test(uri);

/** Original SlaxStaticFetcher caches only custom-scheme gallery requests. */
export async function resolveGalleryImage(cache: ArticleFileCache | null, cacheKey: string, uri: string, options: {
  fetch: typeof globalThis.fetch;
  allowNetwork: boolean;
  isActive(): boolean;
  signal?: AbortSignal;
}): Promise<string | null> {
  const assertCurrent = () => {
    throwIfAborted(options.signal);
    if (!options.isActive()) throw new AccountInactiveError();
  };
  assertCurrent();
  if (!cache) return null;
  if (!isCustomGalleryImage(uri) || !options.allowNetwork) {
    const local = await cache.getResourceUri(cacheKey, uri);
    assertCurrent(); return local;
  }
  const url = normalizeImageUrl(uri);
  if (!/^https?:\/\//.test(url)) return null;
  const local = await cache.ensureImage(cacheKey, uri, async () => {
    assertCurrent();
    const request = linkedAbortTimeout(30_000, options.signal);
    try {
      const response = await options.fetch(url, {signal: request.signal});
      throwIfAborted(request.signal); assertCurrent();
      const type = response.headers.get('content-type');
      if (!response.ok || type !== null && !/^image\//i.test(type.trim())) throw new Error('Image request failed');
      const bytes = new Uint8Array(await response.arrayBuffer());
      throwIfAborted(request.signal); assertCurrent();
      return bytes;
    } finally {request.cleanup();}
  }, options.signal);
  assertCurrent(); return local;
}
