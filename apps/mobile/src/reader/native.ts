import type { ComponentType, ForwardRefExoticComponent, RefAttributes } from 'react'
import type {ViewProps} from 'react-native'
import type { WebView, WebViewProps } from 'react-native-webview'

export interface ReaderNativeOverlayProps extends ViewProps {
  pageId: string
  overlayKind: 'header' | 'footer'
  topInsetPoints: number
  headerHeightPoints: number
}

export interface ReaderPdfSource {id: string; collectionOwner?: string; documentId: string; size: number}

export interface ReaderNativeContext {
  cacheKey: string
  pageId: string
  protectedHosts: string[]
  imageProxyOrigins: string[]
  /** Immutable account lifetime; native resource access must match the active owner. */
  resourceOwner?: string | null
  /** Development fixture roots are accepted only after native marker and cache-path validation. */
  cacheDirectory?: string
  pdfMode?: boolean
  /** PDF hosts only: the one document whose byte ranges the native host serves to this page (`/pdf/<cacheKey>/<documentId>/<size>`). */
  pdfSource?: ReaderPdfSource
  suppressSelectionMenu: true
  scrollsToTop: boolean
}

/** Android natively sized hosts accept the bridge-reported document height until the first native measurement arrives. */
export interface ReaderDocumentHeightHandle { applyDocumentHeight(heightPoints: number): void }

/** Implemented by application-owned native WebView extensions, not package patches. */
export interface ReaderNativeAdapter {
  /** Expo host preserves the public WebView imperative/event contract in the new architecture. */
  HostComponent?: ForwardRefExoticComponent<WebViewProps & RefAttributes<WebView<unknown>>>
  OverlayComponent?: ComponentType<ReaderNativeOverlayProps>
  /** Android: the host measures document height natively and sizes its own container on the UI thread. */
  appliesContentHeight?: boolean
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
