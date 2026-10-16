import {Directory, File} from 'expo-file-system';
import {requireNativeModule} from 'expo-modules-core';
import {imageCachePath, imageCacheReadPaths} from './cache-paths.ts';
import {throwIfAborted} from '../utils/abort.ts';
export {imageCachePath, normalizeImageUrl} from './cache-paths.ts';
function fileUri(path: string) { return path.startsWith('file://') ? path : `file://${path}`; }
function safeKey(key: string) { if (!key || /[^\w-]/.test(key)) throw new Error('Invalid article cache key'); return key; }
export class ArticleFileCache {
  readonly dataDirectory: string;
  private md5: (url: string) => string;
  private guard: () => void;
  private pdf?: {bytes(key: string): Promise<number>; remove(key: string, check?: () => void): Promise<void>; clear(): void};
  constructor(dataDirectory: string, md5: (url: string) => string, assertActive: () => void = () => {}, pdf?: {bytes(key: string): Promise<number>; remove(key: string, check?: () => void): Promise<void>; clear(): void}) { this.dataDirectory = dataDirectory; this.md5 = md5; this.guard = assertActive; this.pdf = pdf; }
  articleFile(key: string) { this.guard(); return new File(fileUri(`${this.dataDirectory}/bookmark/${safeKey(key)}/content.html`)); }
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
  private cachedImage(key: string, url: string): File | null {
    this.guard();
    for (const path of imageCacheReadPaths(safeKey(key), url, this.md5)) {
      const file = this.imageAt(key, path);
      if (file?.exists && file.size > 0) {this.guard(); return file;}
    }
    return null;
  }
  async readArticle(key: string): Promise<string | null> { const file = this.articleFile(key); const value = file.exists ? await file.text() : null; this.guard(); return value; }
  writeArticle(key: string, html: string) { const file = this.articleFile(key); file.parentDirectory.create({intermediates: true, idempotent: true}); file.write(html); }
  articleBytes(key: string): number | Promise<number> {
    const file = this.articleFile(key), html = file.exists ? file.size : 0;
    return this.pdf ? this.pdf.bytes(safeKey(key)).then(bytes => {this.guard(); return html + bytes;}) : html;
  }
  imageBytes(key: string): number {
    this.guard();
    const directory = new Directory(fileUri(`${this.dataDirectory}/bookmark/${safeKey(key)}/images`));
    const measure = (value: Directory): number => value.exists ? value.list().reduce((total, item) => total + (item instanceof Directory ? measure(item) : item.size), 0) : 0;
    return measure(directory);
  }
  removeArticleContent(key: string): boolean | Promise<boolean> {
    const file = this.articleFile(key), removed = file.exists; if (removed) file.delete();
    return this.pdf ? this.pdf.remove(safeKey(key)).then(() => {this.guard(); return true;}) : removed;
  }
  removeImages(key: string): void { this.guard(); const directory = new Directory(fileUri(`${this.dataDirectory}/bookmark/${safeKey(key)}/images`)); if (directory.exists) directory.delete(); }
  removeArticle(key: string, check: () => void = () => {}): void | Promise<void> { this.guard(); check(); const directory = new Directory(fileUri(`${this.dataDirectory}/bookmark/${safeKey(key)}`)); if (directory.exists) directory.delete(); return this.pdf?.remove(key, check); }
  clearArticles() { this.guard(); const directory = new Directory(fileUri(`${this.dataDirectory}/bookmark`)); if (directory.exists) directory.delete(); this.pdf?.clear(); }
  async getResourceUri(key: string, customUrl: string): Promise<string | null> { return this.cachedImage(key, customUrl)?.uri ?? null; }
  /** Fetch into memory or non-account staging; commit only while the captured account lease is live. */
  async ensureImage(key: string, url: string, load: () => Promise<Uint8Array>, signal?: AbortSignal): Promise<string | null> {
    throwIfAborted(signal);
    const cached = this.cachedImage(key, url);
    if (cached) return cached.uri;
    const bytes = await load(); throwIfAborted(signal); this.guard();
    if (!bytes.byteLength) return null;
    const file = this.imageFile(key, url);
    file.parentDirectory.create({intermediates: true, idempotent: true}); this.imageFile(key, url).write(bytes);
    return file.uri;
  }
}
