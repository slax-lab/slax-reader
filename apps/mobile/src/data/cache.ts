import {File} from 'expo-file-system';
import {requireNativeModule} from 'expo-modules-core';
import {imageCachePath, imageCacheReadPaths} from './cache-paths.ts';
import {throwIfAborted} from '../utils/abort.ts';
import {NativeFileStore} from './native-file-store.ts';
import type {ImageResourceResolver} from './image-resource.ts';
export {imageCachePath, normalizeImageUrl} from './cache-paths.ts';
function safeKey(key: string) { if (!key || /[^\w-]/.test(key)) throw new Error('Invalid article cache key'); return key; }
export class ArticleFileCache {
  readonly dataDirectory: string;
  private md5: (url: string) => string;
  private guard: () => void;
  private pdf?: {bytes(key: string): Promise<number>; remove(key: string, check?: () => void): Promise<void>; clear(): void | Promise<void>};
  private files: NativeFileStore;
  private readonly owner: string | null;
  private readonly resolveImage?: ImageResourceResolver;
  private accessBarrier?: (key: string, signal?: AbortSignal) => Promise<void>;
  setAccessBarrier(barrier: (key: string, signal?: AbortSignal) => Promise<void>) {this.accessBarrier = barrier;}
  private async access(key: string, signal?: AbortSignal) {this.guard(); throwIfAborted(signal); await this.accessBarrier?.(safeKey(key), signal); this.guard(); throwIfAborted(signal);}
  stageRemoval(key: string, generation: string, signal: AbortSignal) {return this.files.stageRemoval(`bookmark/${safeKey(key)}`, generation, signal);}
  restoreRemoval(key: string, generation: string) {return this.files.restoreRemoval(`bookmark/${safeKey(key)}`, generation);}
  purgeRemoval(key: string, generation: string) {return this.files.purgeRemoval(`bookmark/${safeKey(key)}`, generation);}
  constructor(dataDirectory: string, md5: (url: string) => string, assertActive: () => void = () => {}, pdf?: {bytes(key: string): Promise<number>; remove(key: string, check?: () => void): Promise<void>; clear(): void | Promise<void>}, owner: string | null = null, resolveImage?: ImageResourceResolver) {
    this.dataDirectory = dataDirectory; this.md5 = md5; this.guard = assertActive; this.pdf = pdf; this.owner = owner; this.resolveImage = resolveImage;
    this.files = new NativeFileStore(dataDirectory, owner, assertActive);
  }
  private imageAt(key: string, path: string): File | null {
    this.guard();
    const uri = requireNativeModule<{imageCacheFileUri(directory: string, key: string, path: string): string | null}>('SlaxCachePaths').imageCacheFileUri(this.dataDirectory, safeKey(key), path);
    this.guard();
    return uri ? new File(uri) : null;
  }
  imageFile(key: string, url: string) {
    const file = this.imageAt(key, imageCachePath(safeKey(key), url, this.md5));
    if (!file) throw new Error('Unsafe article image cache path');
    return file;
  }
  private async cachedImage(key: string, url: string): Promise<File | null> {
    this.guard();
    for (const path of imageCacheReadPaths(safeKey(key), url, this.md5)) {
      const file = this.imageAt(key, path);
      if (file && (await this.files.size(path) ?? 0) > 0) {this.guard(); return file;}
    }
    return null;
  }
  async readArticle(key: string): Promise<string | null> {await this.access(key); return this.files.readText(`bookmark/${safeKey(key)}/content.html`);}
  async writeArticle(key: string, html: string, signal?: AbortSignal): Promise<void> {
    await this.access(key, signal); throwIfAborted(signal);
    const path = `bookmark/${safeKey(key)}/content.html`;
    if (signal) await this.files.writeArticle(path, html, signal); else await this.files.writeText(path, html);
  }
  articleFingerprint(key: string) {return this.files.fingerprint(`bookmark/${safeKey(key)}/content.html`);}
  contentFingerprint(html: string) {return this.files.textFingerprint(html);}
  async articleBytes(key: string): Promise<number> {
    const html = await this.files.size(`bookmark/${safeKey(key)}/content.html`), pdf = await this.pdf?.bytes(key) ?? 0;
    this.guard(); return (html ?? 0) + pdf;
  }
  async imageBytes(key: string): Promise<number> {return this.files.measure(`bookmark/${safeKey(key)}/images`);}
  async removeArticleContent(key: string): Promise<boolean> {
    const path = `bookmark/${safeKey(key)}/content.html`, size = await this.files.size(path);
    await this.files.remove(path); await this.pdf?.remove(key); this.guard(); return size !== null || !!this.pdf;
  }
  async removeImages(key: string): Promise<void> {await this.files.remove(`bookmark/${safeKey(key)}/images`);}
  async removeArticle(key: string, check: () => void = () => {}): Promise<void> {
    this.guard(); check(); await this.files.remove(`bookmark/${safeKey(key)}`); check(); await this.pdf?.remove(key, check); this.guard(); check();
  }
  async clearArticles(): Promise<void> {await this.files.remove('bookmark'); await this.pdf?.clear(); this.guard();}
  private async nativeImage(key: string, url: string, allowNetwork: boolean, signal?: AbortSignal, strict = true): Promise<string | null> {
    this.guard(); throwIfAborted(signal);
    if (!this.owner || !this.resolveImage) throw new Error('Image resource owner unavailable');
    const resource = await this.resolveImage({directory: this.dataDirectory, key: safeKey(key), url, owner: this.owner, allowNetwork, strict}, signal);
    this.guard(); throwIfAborted(signal); return resource?.uri ?? null;
  }
  async getResourceUri(key: string, customUrl: string): Promise<string | null> {
    await this.access(key);
    return this.resolveImage ? this.nativeImage(key, customUrl, false) : (await this.cachedImage(key, customUrl))?.uri ?? null;
  }
  async ensureImage(key: string, url: string, load?: () => Promise<Uint8Array>, signal?: AbortSignal, strict = true): Promise<string | null> {
    throwIfAborted(signal); await this.access(key, signal); throwIfAborted(signal);
    if (this.resolveImage) return this.nativeImage(key, url, true, signal, strict);
    const cached = await this.cachedImage(key, url); throwIfAborted(signal); this.guard();
    if (cached) return cached.uri;
    if (!load) return null;
    const bytes = await load(); throwIfAborted(signal); this.guard();
    if (!bytes.byteLength) return null;
    this.imageFile(key, url);
    return this.files.writeImage(imageCachePath(key, url, this.md5), bytes, signal);
  }
}
