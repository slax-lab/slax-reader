import {File} from 'expo-file-system';
import {requireNativeModule} from 'expo';
import {imageCachePath, imageCacheReadPaths} from './cache-paths.ts';
import {throwIfAborted} from '../utils/abort.ts';
import {NativeFileStore} from './native-file-store.ts';
import type {ImageResourceResolver} from './image-resource.ts';
import type {OfflineUsageCategory} from './offline-engine.ts';
export {imageCachePath, normalizeImageUrl} from './cache-paths.ts';
function safeKey(key: string) { if (!key || /[^\w-]/.test(key)) throw new Error('Invalid article cache key'); return key; }
/** The native offline engine owns committed article/PDF copies for an account. */
export interface ArticleOfflineStore {
  readArticle(key: string): Promise<string | null>;
  usage(keys: string[]): Promise<{article: number; images: number}>;
  clear(keys: string[], categories: OfflineUsageCategory[]): Promise<string[]>;
}
export class ArticleFileCache {
  readonly dataDirectory: string;
  private md5: (url: string) => string;
  private guard: () => void;
  private offline?: ArticleOfflineStore;
  private files: NativeFileStore;
  private readonly owner: string | null;
  private readonly resolveImage?: ImageResourceResolver;
  private avatars?: {clear(): Promise<void>; bytes(): Promise<number>};
  setAvatarCache(avatars: {clear(): Promise<void>; bytes(): Promise<number>}) {this.avatars = avatars;}
  clearAvatarCache() {return this.avatars?.clear();}
  avatarBytes() {return this.avatars?.bytes() ?? Promise.resolve(0);}
  constructor(dataDirectory: string, md5: (url: string) => string, assertActive: () => void = () => {}, offline?: ArticleOfflineStore, owner: string | null = null, resolveImage?: ImageResourceResolver) {
    this.dataDirectory = dataDirectory; this.md5 = md5; this.guard = assertActive; this.offline = offline; this.owner = owner; this.resolveImage = resolveImage;
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
  async readArticle(key: string): Promise<string | null> {
    this.guard(); safeKey(key);
    if (this.offline) {const html = await this.offline.readArticle(key); this.guard(); return html;}
    return this.files.readText(`bookmark/${key}/content.html`);
  }
  /** Seeds an article outside the engine (fixtures and controlled hosts only). */
  async writeArticle(key: string, html: string): Promise<void> {this.guard(); await this.files.writeText(`bookmark/${safeKey(key)}/content.html`, html);}
  async articleBytes(key: string): Promise<number> {
    if (this.offline) {const usage = await this.offline.usage([safeKey(key)]); this.guard(); return usage.article;}
    const html = await this.files.size(`bookmark/${safeKey(key)}/content.html`); this.guard(); return html ?? 0;
  }
  async imageBytes(key: string): Promise<number> {
    if (this.offline) {const usage = await this.offline.usage([safeKey(key)]); this.guard(); return usage.images;}
    return this.files.measure(`bookmark/${safeKey(key)}/images`);
  }
  async removeArticleContent(key: string): Promise<boolean> {
    if (this.offline) {const removed = await this.offline.clear([safeKey(key)], ['article']); this.guard(); return removed.includes(key);}
    const path = `bookmark/${safeKey(key)}/content.html`, size = await this.files.size(path);
    await this.files.remove(path); this.guard(); return size !== null;
  }
  async removeImages(key: string): Promise<void> {
    if (this.offline) {await this.offline.clear([safeKey(key)], ['images']); this.guard(); return;}
    await this.files.remove(`bookmark/${safeKey(key)}/images`);
  }
  /** Account cleanup after revocation: removes every article, image and PDF copy under this data directory. */
  async clearArticles(): Promise<void> {await this.files.remove('bookmark'); await this.files.remove('pdf'); this.guard();}
  private async nativeImage(key: string, url: string, allowNetwork: boolean, signal?: AbortSignal, strict = true): Promise<string | null> {
    this.guard(); throwIfAborted(signal);
    if (!this.owner || !this.resolveImage) throw new Error('Image resource owner unavailable');
    const resource = await this.resolveImage({directory: this.dataDirectory, key: safeKey(key), url, owner: this.owner, allowNetwork, strict}, signal);
    this.guard(); throwIfAborted(signal); return resource?.uri ?? null;
  }
  async getResourceUri(key: string, customUrl: string): Promise<string | null> {
    this.guard(); safeKey(key);
    return this.resolveImage ? this.nativeImage(key, customUrl, false) : (await this.cachedImage(key, customUrl))?.uri ?? null;
  }
  async ensureImage(key: string, url: string, load?: () => Promise<Uint8Array>, signal?: AbortSignal, strict = true): Promise<string | null> {
    throwIfAborted(signal); this.guard(); safeKey(key);
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
