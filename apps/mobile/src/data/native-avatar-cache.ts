import {requireNativeModule} from 'expo';
import {AvatarCache} from './avatar-cache.ts';
import {NativeFileStore} from './native-file-store.ts';
export function createAvatarCache(directory: string, owner: string, scope: string, guard: () => void, hash: (value: string) => string, fetcher: typeof fetch) {
  const files = new NativeFileStore(directory, owner, guard), key = `avatar-${hash(scope)}`, root = `bookmark/${key}/images/`;
  return new AvatarCache({
    read: () => files.readText(`bookmark/${key}/manifest.json`), write: text => files.writeText(`bookmark/${key}/manifest.json`, text).then(() => {}),
    exists: async path => (await files.size(root + path) ?? 0) > 0,
    uri: path => {guard(); return requireNativeModule<{imageCacheFileUri(directory: string, key: string, path: string): string | null}>('SlaxCachePaths').imageCacheFileUri(directory, key, root + path);},
    image: (path, bytes, signal) => files.writeImage(root + path, bytes, signal), remove: path => files.remove(root + path),
  }, hash, async (url, signal) => {
    const request = new AbortController(), cancel = () => request.abort(); signal.addEventListener('abort', cancel, {once: true});
    const timeout = setTimeout(cancel, 15_000);
    try {
      if (signal.aborted) cancel();
      const response = await fetcher(url, {signal: request.signal, credentials: 'omit'});
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/') || Number(response.headers.get('content-length')) > 1024 * 1024) {await response.body?.cancel(); throw new Error('Invalid avatar response');}
      const reader = response.body?.getReader(); if (!reader) throw new Error('Avatar body unavailable');
      const chunks: Uint8Array[] = []; let size = 0;
      try {for (;;) {const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1024 * 1024) throw new Error('Avatar exceeds limit'); chunks.push(part.value);}}
      finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;} return bytes;
    } finally {clearTimeout(timeout); signal.removeEventListener('abort', cancel);}
  });
}
