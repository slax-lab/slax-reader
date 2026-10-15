import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {ImageStyle, StyleProp} from 'react-native';
import {Image as ExpoImage, type ImageContentFit, type ImageRef, type ImageSource} from 'expo-image';
import {mobileAssets, type MobileAssetName} from '../../assets';
import {useReducedMotion} from '../motion/useReducedMotion';
import {decodeImage} from './image-decode';

export type AppImageProps = {
  source?: string | ImageSource | number | null;
  fallback?: MobileAssetName;
  identity?: string;
  fit?: ImageContentFit;
  style?: StyleProp<ImageStyle>;
  label?: string;
  maxPixels?: number;
  active?: boolean;
  transition?: number;
  testID?: string;
  onLoad?: (event: {width: number; height: number}) => void;
  onError?: () => void;
};

export function appImageSource(source: AppImageProps['source'], fallback?: MobileAssetName): ImageSource | number | undefined {
  if (typeof source === 'number') return source;
  const value = typeof source === 'string' ? {uri: source} : source;
  if (value?.uri) {
    try {
      const url = new URL(value.uri);
      if (['file:', 'https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return value;
    } catch {}
  }
  return fallback ? mobileAssets[fallback] as number : undefined;
}

export function AppImage({source, fallback, identity = '', fit = 'contain', style, label, maxPixels = 1024 * 1024, active = true, transition = 120, testID, onLoad, onError}: AppImageProps) {
  const encoded = JSON.stringify(source ?? null);
  const limit = Math.max(1, Math.floor(Math.sqrt(Number.isFinite(maxPixels) ? Math.min(4 * 1024 * 1024, Math.max(1, maxPixels)) : 1024 * 1024)));
  const request = useMemo(() => ({source: appImageSource(source), identity, limit}), [encoded, identity, limit]);
  const [decoded, setDecoded] = useState<{request: typeof request; image: ImageRef; lease: {active: boolean}} | null>(null);
  const callbacks = useRef({onLoad, onError}); callbacks.current = {onLoad, onError};
  const current = useRef(request); current.current = request;
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const lease = {active: true}, controller = new AbortController(), source = request.source;
    let image: ImageRef | undefined;
    setDecoded(null);
    if (source === undefined) {callbacks.current.onError?.(); return;}
    void decodeImage(() => ExpoImage.loadAsync(source, {maxWidth: limit, maxHeight: limit}), controller.signal).then(value => {
      if (!lease.active || current.current !== request) {value.release(); return;}
      image = value; setDecoded({request, image: value, lease});
      callbacks.current.onLoad?.({width: value.width, height: value.height});
    }, () => {if (lease.active && current.current === request) callbacks.current.onError?.();});
    return () => {lease.active = false; controller.abort(); image?.release();};
  }, [request, limit]);
  const image = decoded?.request === request && decoded.lease.active ? decoded.image : null;
  return <ExpoImage key={`${identity}:${encoded}`} source={image ?? (fallback ? mobileAssets[fallback] as number : null)}
    recyclingKey={`${identity}:${encoded}`} contentFit={fit} placeholderContentFit={fit} style={style}
    accessibilityLabel={label} accessible={Boolean(label)} testID={testID} cachePolicy="none"
    autoplay={active && !reducedMotion} transition={reducedMotion ? 0 : transition} allowDownscaling enforceEarlyResizing />;
}
