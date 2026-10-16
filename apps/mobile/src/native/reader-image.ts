import {requireNativeModule} from 'expo-modules-core';
import {mobileConfig} from '../config';
import {readerProtectedHosts, readerImageProxyOrigins, readerAllowsImage} from '../reader/security.ts';
import {throwIfAborted} from '../utils/abort.ts';

interface ImageModule {
  readerResourceOwner(): Promise<string | null>;
  loadReaderImage(id: string, url: string, owner: string, hosts: string[], proxies: string[]): Promise<string>;
  cancelReaderImage(id: string): Promise<void>;
}
let sequence = 0;
export async function loadReaderImage(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal);
  const native = requireNativeModule<ImageModule>('SlaxPlatform');
  const owner = await native.readerResourceOwner();
  throwIfAborted(signal);
  const hosts = readerProtectedHosts(mobileConfig), proxies = readerImageProxyOrigins(mobileConfig);
  if (!owner || !readerAllowsImage(url, hosts, proxies)) throw new Error('Reader image unavailable');
  const id = `image-${++sequence}`;
  const cancel = () => {void native.cancelReaderImage(id).catch(() => {});};
  signal?.addEventListener('abort', cancel, {once: true});
  const timer = setTimeout(cancel, 30_000);
  try {
    const base64 = await native.loadReaderImage(id, url, owner, hosts, proxies);
    throwIfAborted(signal);
    if (await native.readerResourceOwner() !== owner || base64.length > 28 * 1024 * 1024) throw new Error('Reader image released');
    throwIfAborted(signal);
    return Uint8Array.from(atob(base64), value => value.charCodeAt(0));
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', cancel);}
}
