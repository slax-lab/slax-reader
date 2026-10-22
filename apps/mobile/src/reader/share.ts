import {Image as NativeImage} from 'react-native';
import {mobileAssets} from '../../assets';
import {normalizeImageUrl, type ArticleFileCache} from '../data/cache.ts';
import {selectShareImage} from './share-model.ts';
function dimensions(uri: string): Promise<{width: number; height: number} | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 10_000);
    void NativeImage.getSize(uri).then(size => {clearTimeout(timer); resolve(size);}, () => {clearTimeout(timer); resolve(null);});
  });
}
async function logo(cache: ArticleFileCache | null, cacheKey: string, allowNetwork = true): Promise<string | null> {
  const uri = NativeImage.resolveAssetSource(mobileAssets.share_logo)?.uri;
  if (!uri) return null;
  if (uri.startsWith('file://')) return uri;
  if (/^https?:\/\//i.test(uri) && cache) return allowNetwork ? cache.ensureImage(cacheKey, uri) : cache.getResourceUri(cacheKey, uri);
  return null;
}
export interface ReaderShareImageOptions {allowNetwork?: boolean; isActive?: () => boolean}
export function readerShareImage(platform: 'ios' | 'android', imageUrls: string[], cache: ArticleFileCache | null, cacheKey: string, options: ReaderShareImageOptions = {}): Promise<string | null> {
  return selectShareImage(platform, imageUrls, {
    ensureCached: async candidate => {
      if (!cache) return null;
      const url = normalizeImageUrl(candidate);
      if (!/^https?:\/\//i.test(url)) return null;
      return options.allowNetwork === false ? cache.getResourceUri(cacheKey, url) : cache.ensureImage(cacheKey, url);
    }, dimensions, fallback: () => logo(cache, cacheKey, options.allowNetwork !== false), isActive: options.isActive,
  });
}
