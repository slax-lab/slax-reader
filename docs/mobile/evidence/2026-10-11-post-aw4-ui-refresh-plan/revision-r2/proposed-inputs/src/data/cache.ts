import {Directory, File} from 'expo-file-system';
import {imageCachePath} from './cache-paths.ts';
import {throwIfAborted} from '../utils/abort.ts';
export {imageCachePath, normalizeImageUrl} from './cache-paths.ts';
function fileUri(path: string) { return path.startsWith('file://') ? path : `file://${path}`; }
function safeKey(key: string) { if (!/^[\w-]+$/.test(key)) throw new Error('Invalid article cache key'); return key; }
export class ArticleFileCache {
  readonly dataDirectory: string;
  private md5: (url: string) => string;
  private guard: () => void;
  constructor(dataDirectory: string, md5: (url: string) => string, assertActive: () => void = () => {}) { this.dataDirectory = dataDirectory; this.md5 = md5; this.guard = assertActive; }
  articleFile(key: string) { this.guard(); return new File(fileUri(`${this.dataDirectory}/bookmark/${safeKey(key)}/content.html`)); }
  imageFile(key: string, url: string) { this.guard(); return new File(fileUri(`${this.dataDirectory}/${imageCachePath(safeKey(key), url, this.md5)}`)); }
  async readArticle(key: string): Promise<string | null> { const file = this.articleFile(key); const value = file.exists ? await file.text() : null; this.guard(); return value; }
  writeArticle(key: string, html: string) { const file = this.articleFile(key); file.parentDirectory.create({intermediates: true, idempotent: true}); file.write(html); }
  articleBytes(key: string): number { const file = this.articleFile(key); return file.exists ? file.size : 0; }
  imageBytes(key: string): number {
    this.guard();
    const directory = new Directory(fileUri(`${this.dataDirectory}/bookmark/${safeKey(key)}/images`));
    const measure = (value: Directory): number => value.exists ? value.list().reduce((total, item) => total + (item instanceof Directory ? measure(item) : item.size), 0) : 0;
    return measure(directory);
  }
  removeArticleContent(key: string): boolean { const file = this.articleFile(key); if (!file.exists) return false; file.delete(); return true; }
  removeImages(key: string): void { this.guard(); const directory = new Directory(fileUri(`${this.dataDirectory}/bookmark/${safeKey(key)}/images`)); if (directory.exists) directory.delete(); }
  removeArticle(key: string) { this.guard(); const directory = new Directory(fileUri(`${this.dataDirectory}/bookmark/${safeKey(key)}`)); if (directory.exists) directory.delete(); }
  clearArticles() { this.guard(); const directory = new Directory(fileUri(`${this.dataDirectory}/bookmark`)); if (directory.exists) directory.delete(); }
  async getResourceUri(key: string, customUrl: string): Promise<string | null> { const file = this.imageFile(key, customUrl); return file.exists ? file.uri : null; }
  /** Fetch into memory or non-account staging; commit only while the captured account lease is live. */
  async ensureImage(key: string, url: string, load: () => Promise<Uint8Array>, signal?: AbortSignal): Promise<string | null> {
    throwIfAborted(signal);
    const file = this.imageFile(key, url);
    if (file.exists && file.size > 0) return file.uri;
    const bytes = await load(); throwIfAborted(signal); this.guard();
    if (!bytes.byteLength) return null;
    file.parentDirectory.create({intermediates: true, idempotent: true}); file.write(bytes);
    return file.uri;
  }
}
