import type {ArticleFileCache} from '../data/cache.ts';
import {normalizeImageUrl} from '../data/cache-paths.ts';
import {AccountInactiveError} from '../data/account-lease.ts';
import {throwIfAborted} from '../utils/abort.ts';

export const isCustomGalleryImage = (uri: string) => /^slaxstatics?:\/\//i.test(uri);

/** Every remote gallery image is staged through the native credentialless image client. */
export async function resolveGalleryImage(cache: ArticleFileCache | null, cacheKey: string, uri: string, options: {
  fetch?: typeof globalThis.fetch;
  loadImage?: (url: string, signal?: AbortSignal) => Promise<Uint8Array>;
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
  if (!options.allowNetwork) {
    const local = await cache.getResourceUri(cacheKey, uri);
    assertCurrent(); return local;
  }
  const url = normalizeImageUrl(uri);
  if (!/^https?:\/\//.test(url)) return null;
  const local = await cache.ensureImage(cacheKey, uri, async () => {
    assertCurrent();
    const load = options.loadImage ?? (await import('../native/reader-image')).loadReaderImage;
    assertCurrent();
    const bytes = await load(url, options.signal);
    assertCurrent();
    return bytes;
  }, options.signal);
  assertCurrent(); return local;
}
