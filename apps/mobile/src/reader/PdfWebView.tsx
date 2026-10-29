import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react'
import {AppState, Platform, StyleSheet, View} from 'react-native'
import type {StyleProp, ViewStyle} from 'react-native'
import type {WebView} from 'react-native-webview'
import {readerNativeAdapter} from '../native/reader'
import type {WebViewMessageEvent, WebViewProps} from 'react-native-webview'
import {PDF_MAX_BYTES, validatePdfSources} from '@slax-reader/contracts/pdf'
import type {PdfDescriptor} from '@slax-reader/contracts/pdf'
import {composePdfDocument, pdfOrigin, pdfSourcePath} from './pdf-document.ts'
import type {PdfLabels} from './pdf-types.ts'
import {isReaderOperationCancelled, parseReaderMark, parseReaderSelection, readerOperationCancelled} from './bridge.ts'
import {ReaderPositionWriter} from './position.ts'
import type {PositionFlushReason} from './position.ts'
import type {ReaderEvent, ReaderMarkDetail, ReaderSelection} from './types.ts'
import {usePdfScrollHost} from './host/usePdfScrollHost.tsx'
import type {ReaderHostViewport} from './host/geometry.ts'
import type {ReaderNativeContext} from './native.ts'
import {pdfFailureError} from './pdf-errors.ts'
import {readerDocumentError, READER_PROCESS_GONE} from './recovery.ts'
import {choosePdfLayout} from './pdf/adaptive/policy.ts'

export type {PdfSelection} from './pdf-types.ts'
export interface PdfReaderHandle {
  clearSelection(): Promise<void>
  captureSelection(): Promise<ReaderSelection | null>
  drawMarks(marks: ReaderMarkDetail): Promise<void>
  scrollToAnchor(anchor: string): Promise<boolean>
  flushPosition(reason?: PositionFlushReason): Promise<void>
  commitExit(): Promise<void>
}
export type PdfHandle = PdfReaderHandle
export interface PdfWebViewProps {
  descriptor: PdfDescriptor
  /** Bookmark key of the document; with `bookmarkId`/`collectionOwnerId` it scopes the native byte source of this host. */
  cacheKey: string
  bookmarkId: string
  collectionOwnerId?: string | null
  resourceOwner?: string | null
  cacheDirectory?: string
  currentUserId: number
  marks?: ReaderMarkDetail
  initialPosition?: number | null
  labels?: Partial<PdfLabels>
  header?: React.ReactNode
  /** Article header + skeleton that covers the host until the restored first visible page is painted, then fades out. */
  placeholder?: React.ReactNode
  headerSafeAreaPoints?: number
  /** Explicit prototype opt-in. Host width is measured; provided insets are removed before the fit decision. */
  adaptivePdf?: {enabled: boolean; safeAreaLeft?: number; safeAreaRight?: number}
  commentPanelVisible?: boolean
  isRouteRemoved?: () => boolean
  onScrollMetrics?: (positionPixels: number, nearBottom: boolean) => void
  onOperationError?: (error: Error) => void
  onEvent?: (event: ReaderEvent, pageId: string) => void
  onPositionChange?: (position: number, nearBottom: boolean) => void
  onPositionFlush?: (position: number, reason: PositionFlushReason, pageId: string) => Promise<void> | void
  onError?: (error: Error) => void
  style?: StyleProp<ViewStyle>
  renderLoading?: WebViewProps['renderLoading']
  renderError?: WebViewProps['renderError']
}
let pageSequence = 0
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
function pdfSelection(value: unknown, documentId: string): ReaderSelection | null {
  const selection = parseReaderSelection(value, documentId)
  if (selection && (!validatePdfSources(selection.source, documentId) || !selection.text.trim() ||
    (selection.approx_source.raw_text !== undefined && typeof selection.approx_source.raw_text !== 'string'))) throw new Error('Invalid PDF selection')
  return selection
}
function pdfMark(value: unknown, documentId: string) {
  const mark = parseReaderMark(value, documentId)
  if (!mark || !validatePdfSources(mark.source, documentId)) return null
  if (mark.approx && ((mark.approx.raw_text !== undefined && typeof mark.approx.raw_text !== 'string') ||
    (mark.approx.position_start !== undefined && (!Number.isSafeInteger(mark.approx.position_start) || mark.approx.position_start < 0)) ||
    (mark.approx.position_end !== undefined && (!Number.isSafeInteger(mark.approx.position_end) || mark.approx.position_end < (mark.approx.position_start ?? 0))))) return null
  return mark
}
export const PdfWebView = forwardRef<PdfReaderHandle, PdfWebViewProps>(function PdfWebView(props, ref) {
  const pageId = useMemo(() => `pdf-${++pageSequence}`, [props.cacheKey, props.bookmarkId, props.collectionOwnerId, props.cacheDirectory, props.resourceOwner, props.currentUserId, props.descriptor.document_id, props.descriptor.size])
  return <PdfPage {...props} pageId={pageId} ref={ref} key={pageId} />
})
const PdfPage = forwardRef<PdfReaderHandle, PdfWebViewProps & {pageId: string}>(function PdfPage(props, ref) {
  const view = useRef<WebView>(null)
  const callbacks = useRef(props)
  callbacks.current = props
  const exited = useRef(false)
  const staticDocument = useRef(true)
  const initialLoadFinished = useRef(false)
  const initialNavigationAccepted = useRef(false)
  const origin = pdfOrigin(Platform.OS === 'ios' ? 'ios' : 'android')
  const nativeDocumentUrl = (url: string) => url === origin || url === origin.slice(0, -1) || Platform.OS === 'android' && url === 'about:blank'
  const active = useRef(AppState.currentState == null || AppState.currentState === 'active')
  const [foreground, setForeground] = useState(active.current)
  const [activation, setActivation] = useState(0)
  const lifecycleGeneration = useRef(0)
  const initializationScroll = useRef<Promise<void> | null>(null)
  const bufferedReady = useRef(false), bufferedHeight = useRef<number | null>(null)
  const sequence = useRef(0)
  const [ready, setReady] = useState(false)
  // The cover lifts only once the restored position's page has painted, so the reader never shows empty page slots or a restore jump.
  const [presentable, setPresentable] = useState(false)
  const reveal = useRef({done: false, restored: false, visible: null as number | null, painted: new Set<number>()})
  const revealIfPainted = useCallback(() => {
    const state = reveal.current
    if (state.done || !state.restored) return
    const pages = callbacks.current.descriptor.pages
    const initial = Math.max(1, Math.floor(callbacks.current.initialPosition ?? 1))
    const target = state.visible ?? (pages ? Math.min(pages, initial) : initial)
    if (!state.painted.has(target)) return
    state.done = true; state.painted.clear()
    setPresentable(true)
  }, [])
  useEffect(() => {
    if (!ready || presentable) return
    // Safety net for a page that cannot report painting (inactive host, failed restore): never keep the cover indefinitely.
    const timer = setTimeout(() => {reveal.current.done = true; setPresentable(true)}, 2000)
    return () => clearTimeout(timer)
  }, [ready, presentable])
  const pending = useRef(new Map<string, {operation: string; resolve(value: unknown): void; reject(reason: Error): void; timer?: ReturnType<typeof setTimeout>}>())
  const writer = useRef<ReaderPositionWriter | null>(null)
  const fatalError = useRef<Error | null>(null)
  const report = useCallback((reason: unknown) => {
    if (exited.current || fatalError.current || isReaderOperationCancelled(reason)) return
    const error = reason instanceof Error ? reason : pdfFailureError(reason, 'document')
    fatalError.current = error
    callbacks.current.onError?.(error)
  }, [])
  const reportOperation = useCallback((reason: unknown) => {
    if (!exited.current && !isReaderOperationCancelled(reason)) callbacks.current.onOperationError?.(reason instanceof Error ? reason : pdfFailureError(reason, 'command'))
  }, [])
  const html = useMemo(() => {
    if (!Number.isSafeInteger(props.descriptor.size) || props.descriptor.size <= 0 || props.descriptor.size > PDF_MAX_BYTES || !/^[a-f0-9]{64}$/.test(props.descriptor.document_id)) throw new Error('Invalid PDF descriptor')
    return composePdfDocument({pageId: props.pageId, descriptor: props.descriptor, source: pdfSourcePath(props.cacheKey, props.descriptor), initialPosition: props.initialPosition,
      platform: Platform.OS === 'ios' ? 'ios' : 'android', hostViewport: true,
      currentUserId: props.currentUserId, marks: props.marks, labels: props.labels})
  }, [props.pageId])
  const send = useCallback((message: object) => {
    if (exited.current) return
    const json = JSON.stringify({channel: 'slax-pdf', pageId: props.pageId, ...message}).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    view.current?.injectJavaScript(`window.__slaxPdfReceive?.(${json});true;`)
  }, [props.pageId])
  const request = useCallback((operation: string, argument?: unknown): Promise<unknown> => {
    if (exited.current || !view.current) return Promise.reject(readerOperationCancelled('PDF document is closed'))
    if (!active.current) return Promise.reject(readerOperationCancelled('PDF document is inactive'))
    const id = `command-${++sequence.current}`
    return new Promise((resolve, reject) => {
      const timer = ['scrollToAnchor', 'restore'].includes(operation) ? undefined : setTimeout(() => {pending.current.delete(id); reject(pdfFailureError({code: 'PDF_COMMAND_FAILED'}, 'command'))}, 5000)
      pending.current.set(id, {operation, resolve, reject, timer})
      send({kind: 'command', id, operation, argument})
    })
  }, [send])
  const nativeContext: ReaderNativeContext = {pageId: props.pageId, cacheKey: props.cacheKey, cacheDirectory: props.cacheDirectory,
    resourceOwner: props.resourceOwner, pdfMode: true, protectedHosts: ['slax.com'], imageProxyOrigins: [], suppressSelectionMenu: true, scrollsToTop: !props.commentPanelVisible,
    pdfSource: {id: props.bookmarkId, ...(props.collectionOwnerId ? {collectionOwner: props.collectionOwnerId} : {}), documentId: props.descriptor.document_id, size: props.descriptor.size}}
  const latestViewport = useRef<ReaderHostViewport | null>(null)
  const applyLayout = useCallback((viewport: ReaderHostViewport) => {
    const versionParts = String(Platform.Version).split('.').map(Number)
    const supported = Platform.OS === 'ios' && (versionParts[0]! > 27 || versionParts[0] === 27 && (versionParts[1] ?? 0) >= 1)
    const decision = choosePdfLayout({enabled: props.adaptivePdf?.enabled === true, supported,
      windowWidth: Math.max(0, (viewport.width ?? 0) - 16), safeArea: {left: props.adaptivePdf?.safeAreaLeft ?? 0, right: props.adaptivePdf?.safeAreaRight ?? 0},
      minPaneWidth: 320, gutter: 24})
    send({kind: 'layout', mode: decision.mode, paneWidth: decision.paneWidth, gutter: 24})
  }, [props.adaptivePdf?.enabled, props.adaptivePdf?.safeAreaLeft, props.adaptivePdf?.safeAreaRight, send])
  const scrollHost = usePdfScrollHost({context: nativeContext, ready, active: foreground, activation, header: props.header, placeholder: props.placeholder, covered: !presentable, headerSafeAreaPoints: props.headerSafeAreaPoints, style: props.style,
    onViewport: viewport => {
      latestViewport.current = viewport
      send({kind: 'viewport', ...viewport})
      applyLayout(viewport)
    }, onInitialLayout: async () => {
      const generation = lifecycleGeneration.current
      initializationScroll.current = null
      await request('restore', props.initialPosition ?? 1)
      await initializationScroll.current
      if (exited.current || !active.current || generation !== lifecycleGeneration.current) throw readerOperationCancelled()
      reveal.current.restored = true
      revealIfPainted()
    }, onScrollMetrics: props.onScrollMetrics, onError: report, onOperationError: reportOperation})
  useEffect(() => {
    if (latestViewport.current) applyLayout(latestViewport.current)
  }, [applyLayout])
  useEffect(() => {
    if (!foreground || exited.current) return
    if (bufferedHeight.current !== null) {scrollHost.setDocumentHeight(bufferedHeight.current); bufferedHeight.current = null}
    if (bufferedReady.current) {bufferedReady.current = false; setReady(true); callbacks.current.onEvent?.({type: 'domReady'}, props.pageId)}
  }, [foreground, props.pageId])
  const close = useCallback(() => {
    send({kind: 'command', id: `close-${++sequence.current}`, operation: 'teardown'})
    exited.current = true
    for (const command of pending.current.values()) {clearTimeout(command.timer); command.reject(readerOperationCancelled('PDF document is closed'))}
    pending.current.clear()
    view.current?.stopLoading()
  }, [send])
  const flushPosition = useCallback(async (reason: PositionFlushReason = 'background') => {
    try {if (ready && !exited.current && active.current) await request('position')}
    finally {await writer.current?.flush(reason)}
  }, [ready, request])
  const commitExit = useCallback(async () => {
    if (exited.current) return
    try {await flushPosition('exit')} finally {close()}
  }, [close, flushPosition])
  useImperativeHandle(ref, () => ({
    clearSelection: async () => {await request('clearSelection')},
    captureSelection: async () => pdfSelection(await request('captureSelection'), props.descriptor.document_id),
    drawMarks: async marks => {await request('drawMarks', marks)},
    scrollToAnchor: async anchor => await request('scrollToAnchor', anchor) as boolean,
    flushPosition, commitExit,
  }), [request, props.descriptor.document_id, flushPosition, commitExit])
  useEffect(() => {
    exited.current = false
    writer.current = new ReaderPositionWriter((position, reason) => callbacks.current.onPositionFlush?.(position, reason, props.pageId), reportOperation)
    const subscription = AppState.addEventListener('change', state => {
      const next = state === 'active'
      if (active.current === next || exited.current) return
      active.current = next
      lifecycleGeneration.current++
      setActivation(value => value + 1)
      setForeground(next)
      send({kind: 'lifecycle', active: next})
      if (!next) {
        for (const command of pending.current.values()) {clearTimeout(command.timer); command.reject(readerOperationCancelled('PDF document is inactive'))}
        pending.current.clear()
        void writer.current?.flush('background').catch(reportOperation)
      } else if (callbacks.current.marks) void request('drawMarks', callbacks.current.marks).catch(reportOperation)
    })
    return () => {subscription.remove(); close(); void writer.current?.dispose(callbacks.current.isRouteRemoved?.() ? 'exit' : 'document-change').catch(reportOperation)}
  }, [props.pageId, reportOperation, close, send, request])
  useEffect(() => {if (ready && active.current && props.marks) void request('drawMarks', props.marks).catch(reportOperation)}, [ready, props.marks, request, reportOperation])
  const receive = (incoming: WebViewMessageEvent) => {
    if (exited.current || !staticDocument.current || !nativeDocumentUrl(incoming.nativeEvent.url) || typeof incoming.nativeEvent.data !== 'string' || incoming.nativeEvent.data.length > 4 * 1024 * 1024) return
    let message: Record<string, unknown>
    try {message = JSON.parse(incoming.nativeEvent.data)} catch {return}
    if (!object(message) || message.channel !== 'slax-pdf' || message.pageId !== props.pageId) return
    if (!active.current) {
      if (message.kind === 'documentHeight' && finite(message.height) && message.height > 0) bufferedHeight.current = message.height
      if (message.kind === 'event' && object(message.event) && message.event.type === 'domReady') bufferedReady.current = true
      send({kind: 'lifecycle', active: false}); return
    }
    if (message.kind === 'result' && typeof message.id === 'string') {
      const command = pending.current.get(message.id)
      if (!command) return
      clearTimeout(command.timer); pending.current.delete(message.id)
      try {
        if (message.error !== undefined) throw new Error('PDF command failed')
        let result = message.result
        if (command.operation === 'captureSelection') result = pdfSelection(result, props.descriptor.document_id)
        else if (command.operation === 'scrollToAnchor' ? typeof result !== 'boolean' : result !== null) throw new Error('Invalid PDF command result')
        command.resolve(result)
      } catch {command.reject(new Error('Invalid PDF command result'))}
      return
    }
    if (message.kind === 'position' && finite(message.position) && message.position >= 1 && message.position < (props.descriptor.pages ?? 100000) + 1 && typeof message.nearBottom === 'boolean') {
      writer.current?.update(message.position)
      callbacks.current.onPositionChange?.(message.position, message.nearBottom)
      // Only positions reported after the restore scroll settled describe the page the reader will actually reveal.
      if (!reveal.current.done && reveal.current.restored) {reveal.current.visible = Math.floor(message.position); revealIfPainted()}
      return
    }
    if (message.kind === 'painted') {
      if (!reveal.current.done && Number.isSafeInteger(message.page) && (message.page as number) >= 1) {reveal.current.painted.add(message.page as number); revealIfPainted()}
      return
    }
    if (message.kind === 'documentHeight' && finite(message.height) && message.height > 0) {
      scrollHost.setDocumentHeight(message.height); return
    }
    if (message.kind === 'scroll' && finite(message.y) && typeof message.revealHeader === 'boolean') {
      if (message.restoreId !== undefined && (typeof message.restoreId !== 'string' || pending.current.get(message.restoreId)?.operation !== 'restore')) return
      const work = scrollHost.scrollToDocument(message.y, message.revealHeader)
      if (message.restoreId !== undefined) initializationScroll.current = work
      void work.catch(reportOperation)
      return
    }
    if (message.kind === 'error') {report(pdfFailureError(message, 'render')); return}
    if (message.kind !== 'event' || !object(message.event)) return
    const payload = message.event
    let event: ReaderEvent
    try {
      switch (payload.type) {
        case 'domReady': case 'tap': case 'textDeselected': event = {type: payload.type}; break
        case 'selectionError': event = {type: 'selectionError', error: 'Invalid PDF selection'}; break
        case 'textSelected': {
          const mark = pdfMark(payload.mark, props.descriptor.document_id)
          const selection = pdfSelection(payload.selection, props.descriptor.document_id)
          const geometry = payload.selectionGeometry
          if (!mark || !selection || typeof payload.text !== 'string' || !payload.text.trim() || payload.text !== selection.text ||
            JSON.stringify(mark.source.map(path => path.type === 'pdf' ? [path.version, path.document_id, path.page, path.text, path.quads] : null)) !==
              JSON.stringify(selection.source.map(path => path.type === 'pdf' ? [path.version, path.document_id, path.page, path.text, path.quads] : null)) || !object(geometry) ||
            !['touchClientY', 'top', 'bottom'].every(key => geometry[key] === null || finite(geometry[key]))) return
          const selectionGeometry = {touchClientY: geometry.touchClientY as number | null, top: geometry.top as number | null, bottom: geometry.bottom as number | null}
          event = {type: 'textSelected', text: payload.text, mark, selectionGeometry, containerYPoints: scrollHost.selectionY(selectionGeometry.touchClientY ?? selectionGeometry.bottom)}; break
        }
        case 'markClicked': {
          const mark = pdfMark(payload.mark, props.descriptor.document_id)
          if (!mark || typeof payload.markId !== 'string' || !payload.markId || mark.id !== payload.markId || typeof payload.text !== 'string') return
          event = {type: 'markClicked', markId: payload.markId, text: payload.text, mark}; break
        }
        case 'markItemInfosChanged': {
          if (!Array.isArray(payload.marks)) return
          const marks = payload.marks.map(mark => pdfMark(mark, props.descriptor.document_id))
          if (!marks.every((mark): mark is NonNullable<typeof mark> => mark !== null)) return
          event = {type: 'markItemInfosChanged', marks}; break
        }
        default: return
      }
    } catch {return}
    if (event.type === 'domReady') setReady(true)
    callbacks.current.onEvent?.(event, props.pageId)
  }
  const Host = readerNativeAdapter.HostComponent!
  return <View style={styles.debugRoot}>{scrollHost.wrap(<Host ref={view} source={{html, baseUrl: origin}} style={scrollHost.documentStyle} containerStyle={scrollHost.documentStyle}
    nativeConfig={readerNativeAdapter.nativeConfig(nativeContext)} onScroll={scrollHost.nativeScroll}
    contentInset={scrollHost.contentInset}
    onMessage={receive} onError={event => report(pdfFailureError(readerDocumentError(event.nativeEvent.code, 'PDF native document failed'), 'native'))}
    onContentProcessDidTerminate={() => {report(pdfFailureError(readerDocumentError(READER_PROCESS_GONE), 'native')); close()}}
    onRenderProcessGone={() => {report(pdfFailureError(readerDocumentError(READER_PROCESS_GONE), 'native')); close()}}
    onShouldStartLoadWithRequest={navigation => {
      if (navigation.isTopFrame === false) return false
      if (staticDocument.current && !initialLoadFinished.current && !initialNavigationAccepted.current && nativeDocumentUrl(navigation.url) && navigation.navigationType === 'other') {
        initialNavigationAccepted.current = true
        return true
      }
      staticDocument.current = false
      close()
      return false
    }}
    onLoadStart={event => {
      if (!nativeDocumentUrl(event.nativeEvent.url) || initialLoadFinished.current) {staticDocument.current = false; close(); return}
      scrollHost.nativeLoad(event)
    }}
    onLoadEnd={event => {
      if (!nativeDocumentUrl(event.nativeEvent.url)) {staticDocument.current = false; close()}
      initialLoadFinished.current = true
    }}
    originWhitelist={['*']} javaScriptEnabled domStorageEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
    allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
    mixedContentMode="never" setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
    incognito cacheEnabled={false} textInteractionEnabled scrollEnabled={scrollHost.platform === 'ios'} nestedScrollEnabled={false}
    automaticallyAdjustContentInsets={false} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
    startInLoadingState={Boolean(props.renderLoading)} renderLoading={props.renderLoading} renderError={props.renderError} testID="pdf-document" />)}
  </View>
})
const styles = StyleSheet.create({debugRoot: {flex: 1}})
