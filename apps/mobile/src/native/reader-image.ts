import {requireNativeModule} from 'expo-modules-core';
import {mobileConfig} from '../config';
import {readerProtectedHosts, readerImageProxyOrigins, readerAllowsImage} from '../reader/security.ts';
import {throwIfAborted} from '../utils/abort.ts';
import {retryAfterMs} from '../data/transport-errors.ts';
import type {ImageResource, ImageResourceRequest} from '../data/image-resource.ts';

interface ImageModule {
  begin(owner: string): string;
  end(owner: string, id: string): void;
  resolve(owner: string, id: string, request: Omit<ImageResourceRequest, 'owner'> & {hosts: string[]; proxies: string[]}): Promise<ImageResource | null | {error: string; status?: number; retryAfter?: string; terminal?: boolean}>;
}
export async function loadReaderImage(request: ImageResourceRequest, signal?: AbortSignal): Promise<ImageResource | null> {
  throwIfAborted(signal);
  const platform = requireNativeModule<{readerResourceOwner(): Promise<string | null>}>('SlaxPlatform');
  const owner = await platform.readerResourceOwner();
  throwIfAborted(signal);
  const hosts = readerProtectedHosts(mobileConfig), proxies = readerImageProxyOrigins(mobileConfig);
  if (!owner || owner !== request.owner || !/^[\w-]+$/.test(request.key) || !readerAllowsImage(request.url, hosts, proxies)) throw new Error('Reader image unavailable');
  const native = requireNativeModule<ImageModule>('SlaxImageCache'), id = native.begin(owner);
  let timedOut = false;
  const cancel = () => native.end(owner, id);
  signal?.addEventListener('abort', cancel, {once: true});
  const timer = setTimeout(() => {timedOut = true; cancel();}, 30_000);
  try {
    throwIfAborted(signal);
    const {owner: _owner, ...options} = request;
    const result = await native.resolve(owner, id, {...options, hosts, proxies});
    throwIfAborted(signal);
    if (await platform.readerResourceOwner() !== owner) throw new Error('Reader image released');
    throwIfAborted(signal);
    if (timedOut) throw new Error('Reader image timed out');
    if (result === null) return null;
    if ('error' in result) {
      if (result.error === 'cancelled') throw Object.assign(new Error('Reader image released'), {name: 'AbortError'});
      throw Object.assign(new Error('Reader image unavailable'), {status: result.status, retryAfterMs: retryAfterMs(result.retryAfter ?? null), kind: result.terminal ? 'protocol' : 'network'});
    }
    const uri = new URL(result.uri), root = new URL(request.directory.startsWith('file:') ? request.directory : `file://${request.directory}`);
    const prefix = `${decodeURIComponent(root.pathname).replace(/\/$/, '')}/bookmark/${request.key}/images/`;
    const path = decodeURIComponent(uri.pathname);
    if (uri.protocol !== 'file:' || uri.host || uri.search || uri.hash || !path.startsWith(prefix) || /[\\\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => part === '..' || part === '.') ||
      !Number.isSafeInteger(result.size) || result.size < 1 || result.size > 20 * 1024 * 1024) throw new Error('Invalid Reader image resource');
    return {uri: uri.href, size: result.size, ...(result.mime ? {mime: result.mime} : {})};
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', cancel); cancel();}
}
