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
  /** Gallery-owned reuse of decoded pages that left the current±1 window. */
  retention?: DecodedImageRetention;
};
export interface DecodedImageRetention {
  take(key: string): ImageRef | null;
  keep(key: string, image: ImageRef): void;
}
/** Thumbnails/avatars at or below this many pixels display through Expo's native memory cache and downscaling. */
export const NATIVE_DISPLAY_MAX_PIXELS = 512 * 512;

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

export function AppImage(props: AppImageProps) {
  const maxPixels = props.maxPixels ?? 1024 * 1024;
  return Number.isFinite(maxPixels) && maxPixels <= NATIVE_DISPLAY_MAX_PIXELS ? <DisplayImage {...props} /> : <DecodedImage {...props} />;
}

function DisplayImage({source, fallback, identity = '', fit = 'contain', style, label, active = true, transition = 120, testID, onLoad, onError}: AppImageProps) {
  const encoded = JSON.stringify(source ?? null);
  const resolved = useMemo(() => appImageSource(source), [encoded]);
  const callbacks = useRef({onLoad, onError}); callbacks.current = {onLoad, onError};
  const reducedMotion = useReducedMotion();
  useEffect(() => {if (resolved === undefined) callbacks.current.onError?.();}, [resolved]);
  const placeholder = fallback ? mobileAssets[fallback] as number : undefined;
  return <ExpoImage key={`${identity}:${encoded}`} source={resolved ?? placeholder ?? null} placeholder={resolved !== undefined ? placeholder : undefined}
    recyclingKey={`${identity}:${encoded}`} contentFit={fit} placeholderContentFit={fit} style={style}
    accessibilityLabel={label} accessible={Boolean(label)} testID={testID} cachePolicy="memory"
    autoplay={active && !reducedMotion} transition={reducedMotion ? 0 : transition} allowDownscaling
    onLoad={resolved === undefined ? undefined : event => callbacks.current.onLoad?.({width: event.source.width, height: event.source.height})}
    onError={resolved === undefined ? undefined : () => callbacks.current.onError?.()} />;
}

function DecodedImage({source, fallback, identity = '', fit = 'contain', style, label, maxPixels = 1024 * 1024, active = true, transition = 120, testID, onLoad, onError, retention}: AppImageProps) {
  const encoded = JSON.stringify(source ?? null);
  const limit = Math.max(1, Math.floor(Math.sqrt(Number.isFinite(maxPixels) ? Math.min(4 * 1024 * 1024, Math.max(1, maxPixels)) : 1024 * 1024)));
  const request = useMemo(() => ({source: appImageSource(source), identity, limit, key: `${limit}:${encoded}`}), [encoded, identity, limit]);
  const [decoded, setDecoded] = useState<{request: typeof request; image: ImageRef; lease: {active: boolean}} | null>(null);
  const callbacks = useRef({onLoad, onError}); callbacks.current = {onLoad, onError};
  const current = useRef(request); current.current = request;
  const urgent = useRef(active); urgent.current = active;
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const lease = {active: true}, controller = new AbortController(), source = request.source;
    let image: ImageRef | undefined;
    setDecoded(null);
    if (source === undefined) {callbacks.current.onError?.(); return;}
    const accept = (value: ImageRef) => {
      image = value; setDecoded({request, image: value, lease});
      callbacks.current.onLoad?.({width: value.width, height: value.height});
    };
    const retained = retention?.take(request.key);
    if (retained) accept(retained);
    else void decodeImage(() => ExpoImage.loadAsync(source, {maxWidth: limit, maxHeight: limit}), controller.signal, urgent.current).then(value => {
      if (!lease.active || current.current !== request) {value.release(); return;}
      accept(value);
    }, () => {if (lease.active && current.current === request) callbacks.current.onError?.();});
    return () => {
      lease.active = false; controller.abort();
      if (image && retention) retention.keep(request.key, image); else image?.release();
    };
  }, [request, limit, retention]);
  const image = decoded?.request === request && decoded.lease.active ? decoded.image : null;
  return <ExpoImage key={`${identity}:${encoded}`} source={image ?? (fallback ? mobileAssets[fallback] as number : null)}
    recyclingKey={`${identity}:${encoded}`} contentFit={fit} placeholderContentFit={fit} style={style}
    accessibilityLabel={label} accessible={Boolean(label)} testID={testID} cachePolicy="none"
    autoplay={active && !reducedMotion} transition={reducedMotion ? 0 : transition} allowDownscaling enforceEarlyResizing />;
}
