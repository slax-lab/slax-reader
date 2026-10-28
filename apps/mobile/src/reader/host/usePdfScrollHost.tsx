import type {ViewInstance, ScrollViewInstance} from 'react-native'
import React, {useCallback, useEffect, useRef, useState} from 'react'
import {PixelRatio, Platform, ScrollView, StyleSheet, View} from 'react-native'
import type {StyleProp, ViewStyle, NativeSyntheticEvent, NativeScrollEvent} from 'react-native'
import type {WebViewProps} from 'react-native-webview'
import {ReaderLoadingCover} from '../ReaderLoadingCover.tsx'
import {readerNativeAdapter} from '../../native/reader'
import {ReaderNativeAttachment} from '../native-attachment.ts'
import {readerNearBottom, scrollPointsToLegacyPosition, selectionScreenYToContainerPoints} from '../coordinates.ts'
import {documentScrollToHost, readerHostGeometry, readerHostLayoutReady, readerHostViewport} from './geometry.ts'
import type {ReaderHostViewport} from './geometry.ts'
import type {ReaderNativeContext} from '../native.ts'
import {isReaderOperationCancelled, readerOperationCancelled} from '../bridge.ts'

export function usePdfScrollHost(options: {
  context: ReaderNativeContext; ready: boolean; active?: boolean; activation?: number; header?: React.ReactNode; placeholder?: React.ReactNode; covered?: boolean; headerSafeAreaPoints?: number; style?: StyleProp<ViewStyle>
  onViewport(viewport: ReaderHostViewport): void; onInitialLayout(): Promise<unknown> | void
  onScrollMetrics?(positionPixels: number, nearBottom: boolean): void; onError(error: unknown): void; onOperationError?(error: unknown): void
}) {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android'
  const callbacks = useRef(options); callbacks.current = options
  const container = useRef<ViewInstance>(null), outer = useRef<ScrollViewInstance>(null), fallbackHeader = useRef<ViewInstance>(null)
  const tag = useRef<number | null>(null), touch = useRef<number | null>(null)
  const attachment = useRef<ReaderNativeAttachment | null>(null), insetWork = useRef(Promise.resolve())
  const offset = useRef(0), measuredViewport = useRef(0), nativeContentHeight = useRef(0), frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const measuredWidth = useRef(0)
  const initialized = useRef(false), disposed = useRef(false)
  const lifetime = useRef(0), initialization = useRef<object | null>(null)
  const identity = useRef(options.context.pageId)
  const foreground = useRef(options.active !== false), activation = useRef(options.activation)
  const [attemptFinished, setAttemptFinished] = useState(0)
  const pendingScroll = useRef<{y: number; revealHeader: boolean; generation: number; issuing: boolean; resolve(): void; reject(error: unknown): void} | null>(null)
  if (identity.current !== options.context.pageId || foreground.current !== (options.active !== false) || activation.current !== options.activation) {
    lifetime.current++
    const cancelledScroll = pendingScroll.current
    pendingScroll.current = null
    cancelledScroll?.reject(readerOperationCancelled())
    if (identity.current !== options.context.pageId) initialized.current = false
    identity.current = options.context.pageId
    foreground.current = options.active !== false
    activation.current = options.activation
    initialization.current = null
  }
  const heightRef = useRef(1)
  const [documentHeight, setDocumentHeight] = useState(1), [headerHeight, setHeaderHeight] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0), [contentHeight, setContentHeight] = useState(0), [screenTop, setScreenTop] = useState(0)
  const [nativeTag, setNativeTag] = useState<number | null>(null)
  const geometry = useRef(readerHostGeometry(platform, {pixelRatio: PixelRatio.get(), headerHeight: 0, headerSafeArea: 0, screenTop: 0, viewportHeight: 0, scrollPoints: 0}))
  geometry.current = readerHostGeometry(platform, {pixelRatio: PixelRatio.get(), headerHeight, headerSafeArea: options.headerSafeAreaPoints ?? 0,
    screenTop, viewportHeight, scrollPoints: offset.current})
  const publish = useCallback(() => {
    if (disposed.current || !foreground.current || !callbacks.current.ready || measuredViewport.current <= 0) return
    callbacks.current.onViewport({...readerHostViewport(platform, offset.current, measuredViewport.current, geometry.current.topInsetPoints),
      width: measuredWidth.current})
  }, [platform])
  const scheduleViewport = useCallback(() => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {frame.current = null; publish()})
  }, [publish])
  const onScroll = useCallback((y: number, total: number, height: number) => {
    if (disposed.current) return
    offset.current = y; measuredViewport.current = height; nativeContentHeight.current = total
    if (platform === 'android') geometry.current.webViewScreenTopPoints = geometry.current.containerScreenTopPoints + geometry.current.topInsetPoints - y
    if (platform === 'ios' && !readerNativeAdapter.OverlayComponent) {
      const delta = Math.max(0, y + geometry.current.topInsetPoints)
      fallbackHeader.current?.setNativeProps({style: {transform: [{translateY: -delta}]}})
    }
    callbacks.current.onScrollMetrics?.(scrollPointsToLegacyPosition(platform, y, geometry.current), readerNearBottom(platform, y, total, height, geometry.current))
    scheduleViewport()
  }, [platform, scheduleViewport])
  const applyInsets = useCallback(() => {
    const target = tag.current, generation = lifetime.current
    if (target === null) return Promise.resolve()
    const work = insetWork.current.catch(() => {}).then(async () => {
      if (disposed.current || !foreground.current || generation !== lifetime.current || target !== tag.current) throw readerOperationCancelled()
      await readerNativeAdapter.updateInsets(target, platform === 'ios' ? geometry.current.topInsetPoints : 0, 0)
      if (disposed.current || !foreground.current || generation !== lifetime.current || target !== tag.current) throw readerOperationCancelled()
      if (!initialized.current && platform === 'ios') offset.current = -geometry.current.topInsetPoints
    })
    insetWork.current = work
    return work
  }, [platform])
  const drainPendingScroll = useCallback(async () => {
    const pending = pendingScroll.current
    if (!pending || pending.issuing) return
    const current = () => !disposed.current && foreground.current && pending.generation === lifetime.current && pendingScroll.current === pending
    pending.issuing = true
    try {
      if (!current()) throw readerOperationCancelled()
      await applyInsets()
      if (!current()) throw readerOperationCancelled()
      if (platform === 'android' && !readerHostLayoutReady(platform, heightRef.current, geometry.current.topInsetPoints, measuredViewport.current, nativeContentHeight.current, PixelRatio.get())) return
      const raw = documentScrollToHost(platform, pending.y, geometry.current.topInsetPoints, pending.revealHeader)
      if (platform === 'android') {
        if (!outer.current) throw readerOperationCancelled()
        outer.current.scrollTo({y: raw, animated: false})
      } else {
        const target = tag.current
        if (target === null) throw readerOperationCancelled()
        await readerNativeAdapter.scrollTo(target, raw, false)
        if (tag.current !== target) throw readerOperationCancelled()
      }
      if (!current()) throw readerOperationCancelled()
      pendingScroll.current = null
      pending.resolve()
    } catch (error) {
      if (pendingScroll.current === pending) pendingScroll.current = null
      pending.reject(error)
    } finally {pending.issuing = false}
  }, [platform, applyInsets])
  const scrollToDocument = useCallback((y: number, revealHeader = false): Promise<void> => {
    const previous = pendingScroll.current
    pendingScroll.current = null
    previous?.reject(readerOperationCancelled())
    if (disposed.current || !foreground.current) return Promise.reject(readerOperationCancelled())
    return new Promise<void>((resolve, reject) => {
      pendingScroll.current = {y, revealHeader, generation: lifetime.current, issuing: false, resolve, reject}
      void drainPendingScroll()
    })
  }, [drainPendingScroll])
  useEffect(() => {
    disposed.current = false
    attachment.current = new ReaderNativeAttachment(readerNativeAdapter, value => {touch.current = value}, value => {tag.current = value; setNativeTag(value)})
    return () => {
      disposed.current = true
      lifetime.current++; initialization.current = null
      const cancelledScroll = pendingScroll.current
      pendingScroll.current = null
      cancelledScroll?.reject(readerOperationCancelled())
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      void attachment.current?.dispose().catch(() => {})
      attachment.current = null
    }
  }, [options.context.pageId])
  useEffect(() => {
    if (nativeTag === null) return
    void Promise.resolve().then(() => {
      if (!disposed.current && tag.current === nativeTag) return readerNativeAdapter.setScrollsToTop(nativeTag, callbacks.current.context.scrollsToTop)
    }).catch(callbacks.current.onError)
  }, [nativeTag, options.context.scrollsToTop])
  useEffect(() => {
    if (!options.ready || !foreground.current || nativeTag === null || (options.header && !headerHeight)) return
    let cancelled = false
    const generation = lifetime.current
    const current = () => !disposed.current && foreground.current && generation === lifetime.current && tag.current === nativeTag
    void applyInsets().then(() => {
      if (cancelled || !current()) return
      publish()
      if (!readerHostLayoutReady(platform, documentHeight, headerHeight, viewportHeight, contentHeight, PixelRatio.get())) return
      if (!initialized.current && !initialization.current) {
        const attempt = {}; initialization.current = attempt
        void Promise.resolve().then(() => {
          if (!current() || initialization.current !== attempt) throw readerOperationCancelled()
          return callbacks.current.onInitialLayout()
        }).then(() => {
          if (current() && initialization.current === attempt) initialized.current = true
        }).catch(error => {
          if (current() && initialization.current === attempt && !isReaderOperationCancelled(error)) callbacks.current.onOperationError?.(error)
        }).finally(() => {
          if (initialization.current === attempt) initialization.current = null
          if (current() && initialized.current) setAttemptFinished(value => value + 1)
        })
      }
      void drainPendingScroll()
    }).catch(error => {if (!isReaderOperationCancelled(error) && current()) callbacks.current.onError(error)})
    return () => {cancelled = true}
  }, [options.ready, options.active, options.activation, options.context.pageId, nativeTag, headerHeight, viewportHeight, contentHeight, documentHeight, attemptFinished, applyInsets, publish, platform, drainPendingScroll])
  const nativeLoad: NonNullable<WebViewProps['onLoadStart']> = event => {
    const target = (event.nativeEvent as unknown as {target?: unknown}).target
    if (typeof target !== 'number' || !Number.isFinite(target)) {options.onError(new Error('Native reader view identity is unavailable')); return}
    void attachment.current?.attach(target, callbacks.current.context).catch(options.onError)
  }
  const nativeScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (platform === 'ios') onScroll(event.nativeEvent.contentOffset.y, event.nativeEvent.contentSize.height, event.nativeEvent.layoutMeasurement.height)
  }
  const selectionY = (clientY: number | null | undefined) => {
    const screenY = touch.current ?? (clientY == null ? null : geometry.current.webViewScreenTopPoints + clientY)
    return screenY === null ? undefined : selectionScreenYToContainerPoints(screenY, geometry.current)
  }
  const wrap = (document: React.ReactNode) => {
    const header = options.header ? <View onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>{options.header}</View> : null
    const Overlay = readerNativeAdapter.OverlayComponent
    const visible = headerHeight === 0 || offset.current + headerHeight < geometry.current.headerHeightPoints
    const host = <View ref={container} testID="pdf-reader-container" style={[styles.root, options.style]} onLayout={event => {
      const height = event.nativeEvent.layout.height
      measuredWidth.current = event.nativeEvent.layout.width
      measuredViewport.current = height; setViewportHeight(height)
      container.current?.measureInWindow((_x, y) => setScreenTop(y))
      scheduleViewport()
    }}>
      {platform === 'android' ? <ScrollView ref={outer} testID="pdf-reader-scroll" scrollsChildToFocus={false} scrollEventThrottle={16} showsVerticalScrollIndicator={false}
        onLayout={event => {measuredViewport.current = event.nativeEvent.layout.height; setViewportHeight(event.nativeEvent.layout.height); scheduleViewport()}}
        onContentSizeChange={(_width, height) => {nativeContentHeight.current = height; setContentHeight(height)}}
        onScroll={event => onScroll(event.nativeEvent.contentOffset.y, event.nativeEvent.contentSize.height, event.nativeEvent.layoutMeasurement.height)}>
        {header}{document}
      </ScrollView> : <>{document}{header ? Overlay ? <Overlay pageId={options.context.pageId} overlayKind="header" topInsetPoints={headerHeight}
        headerHeightPoints={geometry.current.headerHeightPoints} style={styles.header}>{header}</Overlay>
        : <View ref={fallbackHeader} pointerEvents={visible ? 'auto' : 'none'} style={[styles.header, {transform: [{translateY: -Math.max(0, offset.current + headerHeight)}]}]}>{header}</View> : null}</>}
    </View>
    // The cover sits beside the unchanged scroll host so showing or hiding it never remounts the document.
    return options.placeholder === undefined ? host : <View style={styles.layer}>{host}<ReaderLoadingCover testID="pdf-reader-placeholder" covered={options.covered !== false}>{options.placeholder}</ReaderLoadingCover></View>
  }
  return {platform, documentHeight, setDocumentHeight: (height: number) => {heightRef.current = height; setDocumentHeight(height)}, nativeLoad, nativeScroll, selectionY, scrollToDocument, publish,
    wrap, documentStyle: platform === 'android' ? {height: documentHeight, flex: 0, backgroundColor: 'transparent'} : styles.document,
    contentInset: platform === 'ios' ? {top: headerHeight, bottom: 0, left: 0, right: 0} : undefined}
}
const styles = StyleSheet.create({root: {flex: 1, backgroundColor: '#FCFCFC'}, document: {flex: 1, backgroundColor: 'transparent'}, header: {position: 'absolute', top: 0, left: 0, right: 0},
  layer: {flex: 1}})
