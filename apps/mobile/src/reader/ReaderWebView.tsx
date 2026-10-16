import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { AppState, PixelRatio, Platform, ScrollView, StyleSheet, View } from 'react-native'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native'
import { WebView } from 'react-native-webview'
import type { WebViewMessageEvent, WebViewProps } from 'react-native-webview'
import { isReaderOperationCancelled, parseReaderSelection, ReaderBridgeSession } from './bridge.ts'
import type {ReaderEvaluationHandle} from './bridge.ts'
import { anchorToScrollPoints, legacyPositionToScrollPoints, scrollPointsToLegacyPosition, selectionScreenYToContainerPoints, readerNearBottom } from './coordinates.ts'
import type { ReaderGeometry } from './coordinates.ts'
import {readerHostGeometry} from './host/geometry.ts'
import { composeReaderDocument } from './document.ts'
import {mobileConfig} from '../config'
import {READER_ORIGIN, readerProtectedHosts, readerAllowsUrl, readerAllowsImage, readerImageProxyOrigins} from './security.ts'

// The header lives inside the Android outer scroller, so article JS only needs sampled metrics while
// moving plus the exact drag/fling end offset. The PDF host keeps per-frame metrics for virtualization.
const ANDROID_ARTICLE_SCROLL_SAMPLE_MS = 48
const protectedHosts = readerProtectedHosts(mobileConfig)
const imageProxyOrigins = readerImageProxyOrigins(mobileConfig)
import type { ReaderNativeAdapter, ReaderNativeContext } from './native.ts'
import {ReaderNativeAttachment} from './native-attachment.ts'
import {readerDocumentError, READER_PROCESS_GONE} from './recovery.ts'
import { ReaderPositionWriter } from './position.ts'
import type { PositionFlushReason } from './position.ts'
import type { ReaderEvent, ReaderFixtureCommand, ReaderMarkDetail, ReaderSelection } from './types.ts'
import {readerInputEventCode} from './input.ts'
import type {ReaderInputObservation} from './input.ts'

let pageSequence = 0

export interface ReaderFixturePosition {
  requestedPixels: number | null
  consumed: boolean
  observed: {scrollPoints: number; contentHeightPoints: number; viewportHeightPoints: number; positionPixels: number} | null
  geometry: ReaderGeometry
  /** Native ScrollView measurements; a DOM height alone does not prove committed Android layout. */
  scrollContainer: {contentHeightPoints: number; viewportHeightPoints: number} | null
  bridge: {pageId: string; ready: boolean; documentLoaded: boolean; documentHeightPoints: number; nativeTag: number | null; loadStarts: number; loadEnds: number; messages: number; rejectedMessages: number}
  scrollTrace: {scrollPoints: number; contentHeightPoints: number; viewportHeightPoints: number; insetPoints: number; restoreConsumed: boolean}[]
}

/** Controlled observations of real lifecycle work; these never synthesize navigation or native input. */
export interface ReaderFixtureLifecycle {
  kind: 'mount' | 'unmount' | 'dispose-requested' | 'position-flush-completed' | 'position-flush-failed' | 'native-detach-completed' | 'native-detach-failed'
  pageId: string
  reason?: 'exit' | 'document-change'
  nativeTag: number | null
  ready: boolean
  restoreConsumed: boolean
  positionPixels: number | null
}

export type ReaderObservation = {type: 'lifecycle'; event: ReaderFixtureLifecycle}
  | {type: 'native-scroll' | 'ready' | 'restore'; event: ReaderFixturePosition}
  | {type: 'input'; event: ReaderInputObservation}

export interface ReaderHandle {
  clearSelection(): Promise<void>
  captureSelection(): Promise<ReaderSelection | null>
  drawMarks(marks: ReaderMarkDetail): Promise<void>
  scrollToAnchor(anchor: string): Promise<boolean>
  seekYoutube(seconds: number): Promise<void>
  queryYoutubeTime(): Promise<number>
  queryImageUrls(): Promise<string[]>
  /** Controlled frame preparation; this does not validate native input gestures. */
  prepareFixture(command: ReaderFixtureCommand): Promise<unknown>
  /** Native scroll callbacks, rather than a DOM command or expected fixture value. */
  inspectFixturePosition(): ReaderFixturePosition
  flushPosition(reason?: PositionFlushReason): Promise<void>
  /** Call only after a route exit commits; a cancelled interactive pop must not call this. */
  commitExit(): Promise<void>
}

export interface ReaderWebViewProps {
  cacheKey: string
  resourceOwner?: string | null
  /** Controlled debug fixture root; native code must validate its marker and path before use. */
  cacheDirectory?: string
  html: string
  currentUserId: number
  /** Retained for caller compatibility; Reader always uses its isolated unauthenticated origin. */
  baseUrl?: string
  marks?: ReaderMarkDetail
  initialPosition?: number | null
  infoPack?: Record<string, unknown>
  header?: React.ReactNode
  /** Source header measurement excludes status padding, while native inset includes it. */
  headerSafeAreaPoints?: number
  footer?: React.ReactNode
  footerOnlyForLongDocument?: boolean
  /** Retained caller flag; all document images now use the credentialless native transport. */
  rewriteImageTransports?: boolean
  commentPanelVisible?: boolean
  platformGeometry?: Partial<ReaderGeometry>
  nativeAdapter?: ReaderNativeAdapter
  onEvent?: (event: ReaderEvent, pageId: string) => void
  onPositionChange?: (positionPixels: number, nearBottom: boolean) => void
  onPositionFlush?: (positionPixels: number, reason: PositionFlushReason, pageId: string) => Promise<void> | void
  onExternalUrl?: (url: string) => void
  onError?: (error: Error) => void
  /** Detect committed route removal when React unmounts before the state event. */
  isRouteRemoved?: () => boolean
  /** Invoked only in a controlled debug fixture; normal application renders omit it. */
  onFixtureLifecycle?: (event: ReaderFixtureLifecycle) => void
  /** Optional read-only observer for a separately gated original-installation harness. */
  onObservation?: (event: ReaderObservation) => void
  style?: StyleProp<ViewStyle>
  /** Shell-owned loading/error views keep source localization and layout. */
  renderLoading?: WebViewProps['renderLoading']
  renderError?: WebViewProps['renderError']
}

interface ReaderPageProps extends ReaderWebViewProps { pageId: string }

/** Replacing article contents creates a new isolated document/bridge generation. */
// Shallow-equal props skip the whole document host; ReaderScreen keeps callbacks/elements identity-stable.
export const ReaderWebView = memo(forwardRef<ReaderHandle, ReaderWebViewProps>(function ReaderWebView(props, ref) {
  const pageId = useMemo(() => `reader-${++pageSequence}`, [props.cacheKey, props.html, props.rewriteImageTransports, props.resourceOwner, props.currentUserId, props.baseUrl])
  return <ReaderPage key={pageId} {...props} pageId={pageId} ref={ref} />
}))

const ReaderPage = forwardRef<ReaderHandle, ReaderPageProps>(function ReaderPage(props, ref) {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android'
  const webView = useRef<WebView>(null)
  const outerScroll = useRef<ScrollView>(null)
  const container = useRef<View>(null)
  const callbacks = useRef(props)
  callbacks.current = props
  const session = useRef<ReaderBridgeSession | null>(null)
  const positionWriter = useRef<ReaderPositionWriter | null>(null)
  const tag = useRef<number | null>(null)
  const nativeAttachment = useRef<ReaderNativeAttachment | null>(null)
  const nativeTouchScreenY = useRef<number | null>(null)
  const exited = useRef(false)
  const processGone = useRef(false)
  const initialPositionConsumed = useRef(false)
  const initialPositionInFlight = useRef(false)
  const nativeInsetWork = useRef<Promise<void>>(Promise.resolve())
  const observedPosition = useRef<{scrollPoints: number; contentHeightPoints: number; viewportHeightPoints: number} | null>(null)
  const fixtureScrollTrace = useRef<ReaderFixturePosition['scrollTrace']>([])
  const [active, setActive] = useState(AppState.currentState == null || AppState.currentState === 'active')
  const [ready, setReady] = useState(false)
  const [documentLoaded, setDocumentLoaded] = useState(false)
  const [documentHeight, setDocumentHeight] = useState(1)
  const [headerHeight, setHeaderHeight] = useState(0)
  const [footerHeight, setFooterHeight] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [screenTop, setScreenTop] = useState(0)
  const scrollPoints = useRef(0)
  const fallbackHeader = useRef<View>(null)
  const fallbackFooter = useRef<View>(null)
  const [attachedNativeTag, setAttachedNativeTag] = useState<number | null>(null)
  const [androidContentHeight, setAndroidContentHeight] = useState(0)
  const [androidViewportHeight, setAndroidViewportHeight] = useState(0)
  const androidContent = useRef(0)
  const androidScrollLayout = useRef({contentHeightPoints: 0, viewportHeightPoints: 0})
  androidScrollLayout.current = {contentHeightPoints: androidContent.current, viewportHeightPoints: androidViewportHeight}
  const nativeEventCounts = useRef({loadStarts: 0, loadEnds: 0, messages: 0, rejectedMessages: 0})
  const documentState = useRef({ready, documentLoaded, documentHeightPoints: documentHeight})
  documentState.current = {ready, documentLoaded, documentHeightPoints: documentHeight}
  const geometry = readerHostGeometry(platform, {pixelRatio: PixelRatio.get(), headerHeight,
    headerSafeArea: props.headerSafeAreaPoints ?? 0, screenTop, viewportHeight, scrollPoints: scrollPoints.current}, props.platformGeometry)
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry
  const nativeContext: ReaderNativeContext = {
    cacheKey: props.cacheKey, pageId: props.pageId, resourceOwner: props.resourceOwner ?? null, suppressSelectionMenu: true,
    scrollsToTop: !props.commentPanelVisible, protectedHosts, imageProxyOrigins,
    ...(props.cacheDirectory ? {cacheDirectory: props.cacheDirectory} : {}),
  }
  const nativeContextRef = useRef(nativeContext)
  nativeContextRef.current = nativeContext
  const observesInput = __DEV__ && Boolean(props.onObservation)
  const document = useMemo(() => composeReaderDocument(props.html, { pageId: props.pageId, platform, imageProxyOrigins, rewriteImageTransports: props.rewriteImageTransports, controlledFixture: __DEV__ && Boolean(props.cacheDirectory), observeInput: observesInput }), [props.html, props.pageId, platform, props.rewriteImageTransports, props.cacheDirectory, observesInput])
  const footer = props.footerOnlyForLongDocument && headerHeight + documentHeight <= viewportHeight ? null : props.footer
  useEffect(() => {if (!footer) setFooterHeight(0)}, [Boolean(footer)])
  const reportError = useCallback((error: unknown) => {
    if (exited.current || isReaderOperationCancelled(error)) return
    if (error instanceof Error && error.name === 'ReaderProcessGone') {
      if (processGone.current) return
      processGone.current = true
      session.current?.invalidate()
      documentState.current.ready = false
      documentState.current.documentLoaded = false
      setReady(false)
      setDocumentLoaded(false)
    }
    callbacks.current.onError?.(error instanceof Error ? error : new Error('Reader operation failed'))
  }, [])

  const request = useCallback((...arguments_: Parameters<ReaderBridgeSession['request']>) => {
    return session.current?.request(...arguments_) ?? Promise.reject(new Error('Reader page is not ready'))
  }, [])
  const positionObservation = useCallback((): ReaderFixturePosition => {
    const observed = observedPosition.current, geometry = geometryRef.current
    return {requestedPixels: callbacks.current.initialPosition ?? null, consumed: initialPositionConsumed.current,
      observed: observed ? {...observed, positionPixels: scrollPointsToLegacyPosition(platform, observed.scrollPoints, geometry)} : null,
      geometry: {...geometry}, scrollContainer: platform === 'android' ? {...androidScrollLayout.current} : null,
      bridge: {pageId: props.pageId, ...documentState.current, nativeTag: tag.current, ...nativeEventCounts.current},
      scrollTrace: fixtureScrollTrace.current.map(value => ({...value}))}
  }, [platform, props.pageId])
  const observePosition = useCallback((type: 'native-scroll' | 'ready' | 'restore') => {
    if (!__DEV__ || !callbacks.current.onObservation) return
    try {callbacks.current.onObservation({type, event: positionObservation()})}
    catch { /* A read-only observation cannot alter the real Reader operation. */ }
  }, [positionObservation])
  const observeInput = useCallback((event: ReaderInputObservation) => {
    if (!__DEV__ || !callbacks.current.onObservation) return
    try {callbacks.current.onObservation({type: 'input', event})}
    catch { /* Passive diagnostics cannot change Reader message delivery. */ }
  }, [])
  const observeLifecycle = useCallback((event: Pick<ReaderFixtureLifecycle, 'kind' | 'reason'> & {nativeTag?: number | null}) => {
    if (!__DEV__) return
    const observed = observedPosition.current
    const snapshot: ReaderFixtureLifecycle = {pageId: props.pageId, nativeTag: tag.current,
      ready: documentState.current.ready, restoreConsumed: initialPositionConsumed.current,
      positionPixels: observed ? scrollPointsToLegacyPosition(platform, observed.scrollPoints, geometryRef.current) : null, ...event}
    try {callbacks.current.onObservation?.({type: 'lifecycle', event: {...snapshot}})}
    catch { /* A read-only observation cannot change application lifecycle work. */ }
    if (callbacks.current.cacheDirectory) {
      try {callbacks.current.onFixtureLifecycle?.({...snapshot})}
      catch { /* A missing fixture observation cannot change application lifecycle work. */ }
    }
  }, [props.pageId, platform])
  const scrollTo = useCallback(async (y: number, animated: boolean) => {
    if (platform === 'android') {
      outerScroll.current?.scrollTo({ y: Math.max(y, 0), animated })
    } else {
      // The original iOS reader scrolls through its document. A direct UIKit
      // offset can be overwritten by WK's following document/layout update.
      await request({ operation: 'scrollTo', argument: { y, animated } })
    }
  }, [platform, request])

  const cleanupNative = useCallback(async () => {
    const attachment = nativeAttachment.current
    const nativeTag = tag.current
    nativeAttachment.current = null
    if (!attachment) return
    try {await attachment.dispose(); observeLifecycle({kind: 'native-detach-completed', nativeTag})}
    catch (error) {observeLifecycle({kind: 'native-detach-failed', nativeTag}); throw error}
  }, [observeLifecycle])

  const commitExit = useCallback(async () => {
    if (exited.current) return
    exited.current = true
    observeLifecycle({kind: 'dispose-requested', reason: 'exit'})
    // Queue document teardown before native resource cancellation; do not await a dying WebView.
    void request({ operation: 'teardown' }).catch(() => {})
    session.current?.dispose()
    const flush = positionWriter.current?.dispose('exit')
    webView.current?.stopLoading()
    // A detach failure must not abandon the already queued persistence promise.
    const [detached, persisted] = await Promise.allSettled([
      cleanupNative().finally(() => session.current?.dispose()), flush,
    ])
    observeLifecycle({kind: persisted.status === 'fulfilled' ? 'position-flush-completed' : 'position-flush-failed', reason: 'exit'})
    if (detached.status === 'rejected') throw detached.reason
    if (persisted.status === 'rejected') throw persisted.reason
  }, [cleanupNative, observeLifecycle, request])

  useImperativeHandle(ref, () => ({
    clearSelection: async () => { await request({ operation: 'clearSelection' }) },
    captureSelection: async () => parseReaderSelection(await request({ operation: 'captureSelection' })),
    drawMarks: async marks => { await request({ operation: 'drawMarks', argument: marks }) },
    scrollToAnchor: async anchor => Boolean(await request({ operation: 'scrollToAnchor', argument: anchor })),
    seekYoutube: async seconds => {
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid YouTube seek position')
      await request({ operation: 'seekYoutube', argument: Math.floor(seconds) })
    },
    queryYoutubeTime: async () => {
      const value = await request({ operation: 'queryYoutubeTime' })
      return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : -1
    },
    queryImageUrls: async () => {
      const value = await request({operation: 'queryImageUrls'})
      return Array.isArray(value) ? value.filter((url): url is string => typeof url === 'string' && readerAllowsImage(url, protectedHosts, imageProxyOrigins)) : []
    },
    prepareFixture: async command => {
      if (!__DEV__ || !callbacks.current.cacheDirectory) throw new Error('Fixture document commands are disabled')
      return await request({operation: 'prepareFixture', argument: command})
    },
    inspectFixturePosition: () => {
      if (!__DEV__ || !callbacks.current.cacheDirectory) throw new Error('Fixture position inspection is disabled')
      return positionObservation()
    },
    flushPosition: reason => positionWriter.current?.flush(reason ?? 'background') ?? Promise.resolve(),
    commitExit,
  }), [commitExit, request, positionObservation])

  useEffect(() => {
    exited.current = false
    if (props.nativeAdapter) nativeAttachment.current = new ReaderNativeAttachment(props.nativeAdapter,
      screenY => {nativeTouchScreenY.current = screenY}, value => {tag.current = value; setAttachedNativeTag(value)})
    session.current = new ReaderBridgeSession(props.pageId, (script, pageId) => {
      const native = webView.current as unknown as ReaderEvaluationHandle | null
      if (!native?.evaluateJavaScript) return Promise.reject(new Error('Reader native evaluation is unavailable'))
      return native.evaluateJavaScript(script, pageId)
    })
    positionWriter.current = new ReaderPositionWriter((position, reason) => callbacks.current.onPositionFlush?.(position, reason, props.pageId), reportError)
    observeLifecycle({kind: 'mount'})
    session.current.setActive(AppState.currentState == null || AppState.currentState === 'active')
    const subscription = AppState.addEventListener('change', state => {
      session.current?.setActive(state === 'active')
      setActive(state === 'active')
      if (state !== 'active') void positionWriter.current?.flush('background').catch(reportError)
    })
    return () => {
      subscription.remove()
      observeLifecycle({kind: 'unmount'})
      if (!exited.current && callbacks.current.isRouteRemoved?.()) {
        void commitExit().catch(reportError)
      } else if (!exited.current) {
        exited.current = true
        observeLifecycle({kind: 'dispose-requested', reason: 'document-change'})
        void request({ operation: 'teardown' }).catch(() => {})
        void positionWriter.current?.dispose('document-change').then(() => observeLifecycle({kind: 'position-flush-completed', reason: 'document-change'}), error => {observeLifecycle({kind: 'position-flush-failed', reason: 'document-change'}); reportError(error)})
        void cleanupNative().catch(reportError)
      }
      session.current?.dispose()
    }
  }, [props.pageId, cleanupNative, observeLifecycle, reportError, request, commitExit])

  useEffect(() => {
    if (!ready || !active) return
    void request({ operation: 'initialize', argument: { currentUserId: props.currentUserId, infoPack: props.infoPack } }).catch(reportError)
  }, [props.currentUserId, props.infoPack, ready, active, request, reportError])

  useEffect(() => {
    if (ready && active && props.marks) void request({ operation: 'drawMarks', argument: props.marks }).catch(reportError)
  }, [props.marks, ready, active, request, reportError])

  useEffect(() => {observePosition('ready')}, [ready, documentLoaded, documentHeight, attachedNativeTag, observePosition])

  useEffect(() => {
    if (tag.current === null || !props.nativeAdapter) return
    void Promise.resolve(props.nativeAdapter.setScrollsToTop(tag.current, !props.commentPanelVisible)).catch(reportError)
  }, [props.commentPanelVisible, props.nativeAdapter, ready, reportError])

  const applyNativeInsets = useCallback(() => {
    const nativeTag = tag.current, adapter = callbacks.current.nativeAdapter
    if (nativeTag === null || !adapter) return Promise.resolve()
    const top = platform === 'ios' ? geometryRef.current.topInsetPoints : 0
    // Restore uses the same queue, so its negative iOS offset cannot run ahead
    // of native header insets or be consumed while the view is unattached.
    const work = nativeInsetWork.current.catch(() => {}).then(async () => {
      if (exited.current || tag.current !== nativeTag) return
      await adapter.updateInsets(nativeTag, top, footerHeight)
    })
    nativeInsetWork.current = work
    return work
  }, [footerHeight, platform])
  useEffect(() => {
    void applyNativeInsets().catch(reportError)
  }, [geometry.topInsetPoints, footerHeight, props.nativeAdapter, platform, ready, attachedNativeTag, applyNativeInsets, reportError])

  const updatePosition = (y: number, totalHeight: number, viewHeight: number) => {
    if (exited.current || processGone.current) return
    observedPosition.current = {scrollPoints: y, contentHeightPoints: totalHeight, viewportHeightPoints: viewHeight}
    if (__DEV__ && (callbacks.current.cacheDirectory || callbacks.current.onObservation)) {
      fixtureScrollTrace.current.push({scrollPoints: y, contentHeightPoints: totalHeight, viewportHeightPoints: viewHeight, insetPoints: geometryRef.current.topInsetPoints, restoreConsumed: initialPositionConsumed.current})
      if (fixtureScrollTrace.current.length > 16) fixtureScrollTrace.current.shift()
    }
    scrollPoints.current = y
    if (platform === 'android' && callbacks.current.platformGeometry?.webViewScreenTopPoints === undefined) {
      geometryRef.current.webViewScreenTopPoints = geometryRef.current.containerScreenTopPoints + headerHeight - y
    }
    if (platform === 'ios' && !callbacks.current.nativeAdapter?.OverlayComponent) {
      const offset = Math.max(y + geometryRef.current.topInsetPoints, 0)
      const visible = headerHeight === 0 || y + geometryRef.current.topInsetPoints < geometryRef.current.headerHeightPoints
      fallbackHeader.current?.setNativeProps({pointerEvents: visible ? 'auto' : 'none', accessibilityElementsHidden: !visible,
        style: {opacity: visible ? 1 : 0, transform: [{translateY: -offset}]}})
      fallbackFooter.current?.setNativeProps({style: {transform: [{translateY: totalHeight + geometryRef.current.topInsetPoints - offset}]}})
    }
    observePosition('native-scroll')
    if (!initialPositionConsumed.current) return
    const positionPixels = scrollPointsToLegacyPosition(platform, y, geometryRef.current)
    positionWriter.current?.update(positionPixels)
    callbacks.current.onPositionChange?.(positionPixels, readerNearBottom(platform, y, totalHeight, viewHeight, geometryRef.current))
  }

  const consumeInitialPosition = async () => {
    if (initialPositionConsumed.current || initialPositionInFlight.current || documentHeight <= 1 || (props.header && headerHeight === 0) || viewportHeight === 0) return
    // The JS document-height message can precede native ScrollView layout. A
    // command at that point is clamped against the old short content and lost.
    if (platform === 'android' && (androidViewportHeight <= 0 || androidContentHeight + 1 / geometry.pixelRatio < headerHeight + documentHeight + (footer ? footerHeight : 0))) return
    if (platform === 'ios' && callbacks.current.nativeAdapter && tag.current === null) return
    initialPositionInFlight.current = true
    const nativeTag = tag.current
    try {
      await applyNativeInsets()
      if (exited.current || tag.current !== nativeTag) return
      const initial = callbacks.current.initialPosition
      if (initial !== null && initial !== undefined && Number.isFinite(initial) && initial >= 0) {
        await scrollTo(legacyPositionToScrollPoints(platform, initial, geometryRef.current), false)
      }
      if (!exited.current) {initialPositionConsumed.current = true; observePosition('restore')}
    } finally {initialPositionInFlight.current = false}
  }

  useEffect(() => {
    if (ready && active && documentLoaded) void consumeInitialPosition().catch(reportError)
  }, [ready, active, documentLoaded, documentHeight, headerHeight, footerHeight, viewportHeight, attachedNativeTag, androidContentHeight, androidViewportHeight])

  const receive = (message: WebViewMessageEvent) => {
    nativeEventCounts.current.messages++
    const event = session.current?.receive(message.nativeEvent.data)
    if (!event) {nativeEventCounts.current.rejectedMessages++; observeInput({pageId: props.pageId, stage: 'received', eventCode: 0, parsed: false, markValid: false}); return}
    if (exited.current) return
    if (event.type === 'inputObservation') {observeInput({pageId: props.pageId, stage: 'dom', snapshot: event.snapshot}); return}
    if (event.type === 'imageLongPress' && !readerAllowsImage(event.src, protectedHosts, imageProxyOrigins)) return
    if (event.type === 'imageClick') {
      if (!readerAllowsImage(event.src, protectedHosts, imageProxyOrigins)) return
      event.allImages = event.allImages.filter(url => readerAllowsImage(url, protectedHosts, imageProxyOrigins))
      event.index = event.allImages.indexOf(event.src)
    }
    const inputCode = readerInputEventCode(event.type)
    if (inputCode) observeInput({pageId: props.pageId, stage: 'received', eventCode: inputCode, parsed: true, markValid: 'mark' in event && event.mark !== null})
    if (event.type === 'domReady') {
      setReady(true)
    } else if (event.type === 'contentHeight') {
      setDocumentHeight(event.height)
    } else if (event.type === 'scrollToPosition') {
      void scrollTo(anchorToScrollPoints(platform, documentHeight * event.percentage, geometryRef.current), true).catch(reportError)
    } else if (event.type === 'scrollToTop') {
      // Source iOS scrollToTop uses document zero, which differs from revealing
      // the inset-backed header after the document has already scrolled.
      void scrollTo(0, true).catch(reportError)
    } else if (event.type === 'textSelected') {
      const clientY = event.selectionGeometry?.touchClientY ?? event.selectionGeometry?.bottom
      const touchY = nativeTouchScreenY.current ?? (clientY == null ? null : geometryRef.current.webViewScreenTopPoints + clientY)
      if (touchY !== null) event.containerYPoints = selectionScreenYToContainerPoints(touchY, geometryRef.current)
    }
    callbacks.current.onEvent?.(event, props.pageId)
  }

  const allowNavigation: NonNullable<WebViewProps['onShouldStartLoadWithRequest']> = navigation => {
    const initial = navigation.url === READER_ORIGIN
    if (initial && navigation.navigationType !== 'click') return true
    if (!readerAllowsUrl(navigation.url, protectedHosts)) return false
    if (navigation.isTopFrame === false) return navigation.url.startsWith('https://')
    callbacks.current.onExternalUrl?.(navigation.url)
    return false
  }

  const onNativeLoad: NonNullable<WebViewProps['onLoadStart']> = navigation => {
    nativeEventCounts.current.loadStarts++
    // The native event carries the numeric view tag; React's synthetic target is a host element.
    const nativeTag = (navigation.nativeEvent as unknown as { target?: unknown }).target
    if (typeof nativeTag !== 'number' || !Number.isFinite(nativeTag)) {
      if (callbacks.current.nativeAdapter) reportError(new Error('Native reader view identity is unavailable'))
      return
    }
    if (exited.current) return
    void nativeAttachment.current?.attach(nativeTag, nativeContextRef.current).catch(reportError)
  }
  // Content growth (image loads) only gates the initial restore; afterwards it no longer rerenders the page.
  const contentSizeChanged = (height: number) => {
    androidContent.current = height; androidScrollLayout.current.contentHeightPoints = height
    if (!initialPositionConsumed.current) setAndroidContentHeight(height)
  }
  const nativeScrollMetrics = (event: NativeSyntheticEvent<NativeScrollEvent>) => updatePosition(event.nativeEvent.contentOffset.y, event.nativeEvent.contentSize.height, event.nativeEvent.layoutMeasurement.height)
  const onNativeScroll: NonNullable<WebViewProps['onScroll']> = event => {
    if (platform !== 'ios') return
    updatePosition(event.nativeEvent.contentOffset.y, event.nativeEvent.contentSize.height, event.nativeEvent.layoutMeasurement.height)
  }
  const onContainerLayout = (event: LayoutChangeEvent) => {
    setViewportHeight(event.nativeEvent.layout.height)
    container.current?.measureInWindow((_x, y) => setScreenTop(y))
  }
  const DocumentWebView = props.nativeAdapter?.HostComponent ?? WebView
  const documentSource = useMemo(() => ({html: document, baseUrl: READER_ORIGIN}), [document])
  const documentStyle = useMemo(() => platform === 'android' ? {height: documentHeight, backgroundColor: 'transparent'} : styles.document, [platform, documentHeight])
  const documentContainerStyle = useMemo(() => platform === 'android' ? {flex: 0, height: documentHeight} : styles.document, [platform, documentHeight])
  const articleView = <DocumentWebView
    ref={webView}
    source={documentSource}
    nativeConfig={props.nativeAdapter?.nativeConfig(nativeContext)}
    style={documentStyle}
    containerStyle={documentContainerStyle}
    onMessage={receive}
    onLoadStart={onNativeLoad}
    onLoadEnd={() => {nativeEventCounts.current.loadEnds++; setDocumentLoaded(true)}}
    onScroll={onNativeScroll}
    onShouldStartLoadWithRequest={allowNavigation}
    onError={event => reportError(readerDocumentError(event.nativeEvent.code, event.nativeEvent.description))}
    onContentProcessDidTerminate={() => reportError(readerDocumentError(READER_PROCESS_GONE, 'Reader document process was interrupted'))}
    onRenderProcessGone={() => reportError(readerDocumentError(READER_PROCESS_GONE, 'Reader document process was interrupted'))}
    originWhitelist={['*']}
    javaScriptEnabled
    domStorageEnabled
    allowsInlineMediaPlayback
    mediaPlaybackRequiresUserAction={false}
    allowFileAccess={false}
    allowFileAccessFromFileURLs={false}
    allowUniversalAccessFromFileURLs={false}
    mixedContentMode="never"
    setSupportMultipleWindows={false}
    scrollEnabled={platform === 'ios'}
    nestedScrollEnabled={false}
    showsVerticalScrollIndicator={false}
    showsHorizontalScrollIndicator={false}
    automaticallyAdjustContentInsets={false}
    contentInset={platform === 'ios' ? { top: geometry.topInsetPoints, bottom: footerHeight, left: 0, right: 0 } : undefined}
    bounces={platform === 'ios'}
    textInteractionEnabled
    startInLoadingState={Boolean(props.renderLoading)}
    renderLoading={props.renderLoading}
    renderError={props.renderError}
    testID="reader-document"
  />
  const measuredHeader = props.header ? <View onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>{props.header}</View> : null
  const headerVisible = headerHeight === 0 || scrollPoints.current + geometry.topInsetPoints < geometry.headerHeightPoints
  const overlayOffset = Math.max(scrollPoints.current + geometry.topInsetPoints, 0)
  const NativeOverlay = props.nativeAdapter?.OverlayComponent
  const overlayProps = {pageId: props.pageId, topInsetPoints: geometry.topInsetPoints, headerHeightPoints: geometry.headerHeightPoints}

  return <View ref={container} style={[styles.root, props.style]} onLayout={onContainerLayout} testID="reader-container">
    {platform === 'android' ? <ScrollView ref={outerScroll} showsVerticalScrollIndicator={false} scrollEventThrottle={ANDROID_ARTICLE_SCROLL_SAMPLE_MS}
      onLayout={event => setAndroidViewportHeight(event.nativeEvent.layout.height)}
      onContentSizeChange={(_width, height) => contentSizeChanged(height)}
      onScroll={nativeScrollMetrics} onScrollEndDrag={nativeScrollMetrics} onMomentumScrollEnd={nativeScrollMetrics}>
      {measuredHeader}{articleView}
      {footer ? <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}>{footer}</View> : null}
    </ScrollView> : <>
      {articleView}
      {props.header ? NativeOverlay
        ? <NativeOverlay {...overlayProps} overlayKind="header" style={styles.header}>{measuredHeader}</NativeOverlay>
        : <View ref={fallbackHeader} pointerEvents={headerVisible ? 'auto' : 'none'} accessibilityElementsHidden={!headerVisible}
          style={[styles.header, {opacity: headerVisible ? 1 : 0, transform: [{translateY: -overlayOffset}]}]}>{measuredHeader}</View> : null}
      {footer ? NativeOverlay
        ? <NativeOverlay {...overlayProps} overlayKind="footer" style={styles.header} onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}>{footer}</NativeOverlay>
        : <View ref={fallbackFooter} style={[styles.header, {transform: [{translateY: documentHeight + geometry.topInsetPoints - overlayOffset}]}]}
          onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}>{footer}</View> : null}
    </>}
  </View>
})

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FCFCFC' },
  document: { flex: 1, backgroundColor: 'transparent' },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
})
