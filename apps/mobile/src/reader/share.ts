import {Image} from 'react-native';
import {Directory, File, Paths} from 'expo-file-system';
import {loadReaderImage} from '../native/reader-image';
import {mobileAssets} from '../../assets';
import {normalizeImageUrl, type ArticleFileCache} from '../data/cache.ts';
import {selectShareImage} from './share-model.ts';

const downloads = new Map<string, Promise<string | null>>();
function download(url: string, file: File): Promise<string | null> {
  if (file.exists && file.size > 0) return Promise.resolve(file.uri);
  const pending = downloads.get(file.uri);
  if (pending) return pending;
  file.parentDirectory.create({intermediates: true, idempotent: true});
  const work = loadReaderImage(url).then(bytes => {file.write(bytes); return file.size > 0 ? file.uri : null;}).catch(() => null);
  downloads.set(file.uri, work);
  void work.finally(() => {if (downloads.get(file.uri) === work) downloads.delete(file.uri);});
  return work;
}
function dimensions(uri: string): Promise<{width: number; height: number} | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 10000);
    void Image.getSize(uri).then(size => {clearTimeout(timer); resolve(size);}, () => {clearTimeout(timer); resolve(null);});
  });
}
async function logo(allowNetwork = true): Promise<string | null> {
  const uri = Image.resolveAssetSource(mobileAssets.share_logo)?.uri;
  if (!uri) return null;
  if (uri.startsWith('file://')) return uri;
  if (/^https?:\/\//i.test(uri)) {
    const file = new File(new Directory(Paths.cache, 'share-assets'), 'share-logo.png');
    return file.exists && file.size > 0 ? file.uri : allowNetwork ? download(uri, file) : null;
  }
  // Android ignores article artwork in its text/subject chooser; resource URIs are not file URLs.
  return null;
}
export interface ReaderShareImageOptions {allowNetwork?: boolean; isActive?: () => boolean}
export function readerShareImage(platform: 'ios' | 'android', imageUrls: string[], cache: ArticleFileCache | null, cacheKey: string, options: ReaderShareImageOptions = {}): Promise<string | null> {
  return selectShareImage(platform, imageUrls, {
    ensureCached: async candidate => {
      if (!cache) return null;
      const url = normalizeImageUrl(candidate);
      if (!/^https?:\/\//i.test(url)) return null;
      if (options.allowNetwork === false) return cache.getResourceUri(cacheKey, url);
      return cache.ensureImage(cacheKey, url, async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          return await loadReaderImage(url, controller.signal);
        } finally {clearTimeout(timer);}
      });
    }, dimensions, fallback: () => logo(options.allowNetwork !== false), isActive: options.isActive,
  });
}
