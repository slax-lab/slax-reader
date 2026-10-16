import type { ForwardRefExoticComponent, RefAttributes } from 'react'
import type { WebView, WebViewProps } from 'react-native-webview'

export interface ReaderNativeContext {
  cacheKey: string
  pageId: string
  /** Immutable account lifetime; native resource access must match the active owner. */
  resourceOwner?: string | null
  /** Development fixture roots are accepted only after native marker and cache-path validation. */
  cacheDirectory?: string
  suppressSelectionMenu: true
  scrollsToTop: boolean
}

/** Implemented by application-owned native WebView extensions, not package patches. */
export interface ReaderNativeAdapter {
  /** Expo host preserves the public WebView imperative/event contract in the new architecture. */
  HostComponent?: ForwardRefExoticComponent<WebViewProps & RefAttributes<WebView>>
  /** Scheme handlers/interception and selection subclassing must exist before view creation. */
  nativeConfig(context: ReaderNativeContext): WebViewProps['nativeConfig']
  attach(reactTag: number, context: ReaderNativeContext): void | Promise<void>
  /** Values are logical screen points on both platforms; Android raw pixels must be divided natively. */
  subscribeTouch(reactTag: number, callback: (screenYPoints: number) => void): () => void
  setScrollsToTop(reactTag: number, enabled: boolean): void | Promise<void>
  /** iOS supports negative offsets introduced by contentInset. */
  scrollTo(reactTag: number, rawOffsetPoints: number, animated: boolean): void | Promise<void>
  /** Preserve adjusted contentOffset when a measured article header changes. */
  updateInsets(reactTag: number, topPoints: number, bottomPoints: number): void | Promise<void>
  /** Cancel in-flight scheme/network streams, clear callbacks, and release the page owner. */
  detach(reactTag: number): void | Promise<void>
}
