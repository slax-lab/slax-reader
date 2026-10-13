import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react'
import {AppState, Platform} from 'react-native'
import type {StyleProp, ViewStyle} from 'react-native'
import type {WebView} from 'react-native-webview'
import {readerNativeAdapter} from '../native/reader'
import type {WebViewMessageEvent, WebViewProps} from 'react-native-webview'
import {PDF_MAX_BYTES, validatePdfSources} from '@slax-reader/contracts/pdf'
import type {PdfDescriptor} from '@slax-reader/contracts/pdf'
import {composePdfDocument, PDF_BRIDGE_CHUNK_BYTES, PDF_ORIGIN} from './pdf-document.ts'
import type {PdfLabels} from './pdf-types.ts'
import {isReaderOperationCancelled, parseReaderMark, parseReaderSelection, readerOperationCancelled} from './bridge.ts'
import {ReaderPositionWriter} from './position.ts'
import type {PositionFlushReason} from './position.ts'
import type {ReaderEvent, ReaderMarkDetail, ReaderSelection} from './types.ts'
import {usePdfScrollHost} from './host/usePdfScrollHost.tsx'
import type {ReaderNativeContext} from './native.ts'
import {pdfFailure, pdfFailureError} from './pdf-errors.ts'
import {readerDocumentError, READER_PROCESS_GONE} from './recovery.ts'
import {getDataErrorDiagnostic} from '../data/transport-errors.ts'

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
  cacheKey: string
  resourceOwner?: string | null
  cacheDirectory?: string
  currentUserId: number
  marks?: ReaderMarkDetail
  readRange(begin: number, end: number, signal: AbortSignal): Promise<Uint8Array>
  initialPosition?: number | null
  labels?: Partial<PdfLabels>
  header?: React.ReactNode
  headerSafeAreaPoints?: number
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
const encode = (bytes: Uint8Array) => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}
export const PdfWebView = forwardRef<PdfReaderHandle, PdfWebViewProps>(function PdfWebView(props, ref) {
  const pageId = useMemo(() => `pdf-${++pageSequence}`, [props.cacheKey, props.cacheDirectory, props.resourceOwner, props.currentUserId, props.descriptor.document_id, props.descriptor.size])
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
  const nativeDocumentUrl = (url: string) => url === PDF_ORIGIN || url === PDF_ORIGIN.slice(0, -1) || Platform.OS === 'android' && url === 'about:blank'
  const active = useRef(AppState.currentState == null || AppState.currentState === 'active')
  const [foreground, setForeground] = useState(active.current)
  const [activation, setActivation] = useState(0)
  const lifecycleGeneration = useRef(0)
  const initializationScroll = useRef<Promise<void> | null>(null)
  const bufferedReady = useRef(false), bufferedHeight = useRef<number | null>(null)
  const sequence = useRef(0)
  const [ready, setReady] = useState(false)
  const pending = useRef(new Map<string, {operation: string; resolve(value: unknown): void; reject(reason: Error): void; timer?: ReturnType<typeof setTimeout>}>())
  const ranges = useRef(new Map<string, AbortController>())
  const acknowledgments = useRef(new Map<string, {offset: number; resolve(): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout>}>())
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
    return composePdfDocument({pageId: props.pageId, descriptor: props.descriptor, initialPosition: props.initialPosition,
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
    resourceOwner: props.resourceOwner, pdfMode: true, protectedHosts: ['slax.com'], imageProxyOrigins: [], suppressSelectionMenu: true, scrollsToTop: !props.commentPanelVisible}
  const scrollHost = usePdfScrollHost({context: nativeContext, ready, active: foreground, activation, header: props.header, headerSafeAreaPoints: props.headerSafeAreaPoints, style: props.style,
    onViewport: viewport => send({kind: 'viewport', ...viewport}), onInitialLayout: async () => {
      const generation = lifecycleGeneration.current
      initializationScroll.current = null
      await request('restore', props.initialPosition ?? 1)
      await initializationScroll.current
      if (exited.current || !active.current || generation !== lifecycleGeneration.current) throw readerOperationCancelled()
    }, onScrollMetrics: props.onScrollMetrics, onError: report, onOperationError: reportOperation})
  useEffect(() => {
    if (!foreground || exited.current) return
    if (bufferedHeight.current !== null) {scrollHost.setDocumentHeight(bufferedHeight.current); bufferedHeight.current = null}
    if (bufferedReady.current) {bufferedReady.current = false; setReady(true); callbacks.current.onEvent?.({type: 'domReady'}, props.pageId)}
  }, [foreground, props.pageId])
  const cancelRange = useCallback((id: string) => {
    ranges.current.get(id)?.abort()
    ranges.current.delete(id)
    const ack = acknowledgments.current.get(id)
    if (ack) {clearTimeout(ack.timer); ack.reject(new Error('PDF range cancelled')); acknowledgments.current.delete(id)}
  }, [])
  const close = useCallback(() => {
    send({kind: 'command', id: `close-${++sequence.current}`, operation: 'teardown'})
    exited.current = true
    for (const id of ranges.current.keys()) cancelRange(id)
    for (const command of pending.current.values()) {clearTimeout(command.timer); command.reject(readerOperationCancelled('PDF document is closed'))}
    pending.current.clear()
    view.current?.stopLoading()
  }, [cancelRange, send])
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
        for (const id of ranges.current.keys()) cancelRange(id)
        for (const command of pending.current.values()) {clearTimeout(command.timer); command.reject(readerOperationCancelled('PDF document is inactive'))}
        pending.current.clear()
        void writer.current?.flush('background').catch(reportOperation)
      } else if (callbacks.current.marks) void request('drawMarks', callbacks.current.marks).catch(reportOperation)
    })
    return () => {subscription.remove(); close(); void writer.current?.dispose(callbacks.current.isRouteRemoved?.() ? 'exit' : 'document-change').catch(reportOperation)}
  }, [props.pageId, reportOperation, close, send, cancelRange, request])
  useEffect(() => {if (ready && active.current && props.marks) void request('drawMarks', props.marks).catch(reportOperation)}, [ready, props.marks, request, reportOperation])
  const readRange = async (id: string, begin: number, end: number) => {
    if (!active.current) {send({kind: 'lifecycle', active: false}); return}
    if (ranges.current.has(id)) return
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > props.descriptor.size || ranges.current.size >= 128) {
      send({kind: 'rangeError', id}); return
    }
    const controller = new AbortController()
    ranges.current.set(id, controller)
    try {
      for (let offset = begin; offset < end; offset += PDF_BRIDGE_CHUNK_BYTES) {
        const limit = Math.min(end, offset + PDF_BRIDGE_CHUNK_BYTES)
        const bytes = await callbacks.current.readRange(offset, limit, controller.signal)
        if (controller.signal.aborted || exited.current) return
        if (!(bytes instanceof Uint8Array) || bytes.length !== limit - offset) throw new Error('Invalid PDF byte response')
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {acknowledgments.current.delete(id); reject(new Error('PDF bridge chunk timed out'))}, 10_000)
          acknowledgments.current.set(id, {offset: limit, resolve, reject, timer})
          send({kind: 'rangeChunk', id, offset, data: encode(bytes)})
        })
      }
    } catch (reason) {
      if (!controller.signal.aborted && !exited.current) {
        const diagnostic = getDataErrorDiagnostic(reason)
        report(diagnostic.kind !== 'unknown' ? reason : pdfFailureError(reason, 'range'))
        send({kind: 'rangeError', id, failure: pdfFailure(diagnostic.kind !== 'unknown' ? diagnostic : reason, 'range')})
      }
    } finally {cancelRange(id)}
  }
  const receive = (incoming: WebViewMessageEvent) => {
    if (exited.current || !staticDocument.current || !nativeDocumentUrl(incoming.nativeEvent.url) || typeof incoming.nativeEvent.data !== 'string' || incoming.nativeEvent.data.length > 4 * 1024 * 1024) return
    let message: Record<string, unknown>
    try {message = JSON.parse(incoming.nativeEvent.data)} catch {return}
    if (!object(message) || message.channel !== 'slax-pdf' || message.pageId !== props.pageId) return
    if (message.kind === 'range' && typeof message.id === 'string' && message.id.length > 0 && message.id.length < 80 && typeof message.begin === 'number' && typeof message.end === 'number') {
      void readRange(message.id, message.begin, message.end); return
    }
    if (message.kind === 'cancelRange' && typeof message.id === 'string') {cancelRange(message.id); return}
    if (!active.current) {
      if (message.kind === 'documentHeight' && finite(message.height) && message.height > 0) bufferedHeight.current = message.height
      if (message.kind === 'event' && object(message.event) && message.event.type === 'domReady') bufferedReady.current = true
      send({kind: 'lifecycle', active: false}); return
    }
    if (message.kind === 'rangeAck' && typeof message.id === 'string') {
      const ack = acknowledgments.current.get(message.id)
      if (ack && ack.offset === message.offset) {clearTimeout(ack.timer); acknowledgments.current.delete(message.id); ack.resolve()}
      return
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
      return
    }
    if (message.kind === 'documentHeight' && finite(message.height) && message.height > 0) {scrollHost.setDocumentHeight(message.height); return}
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
  return scrollHost.wrap(<Host ref={view} source={{html, baseUrl: PDF_ORIGIN}} style={scrollHost.documentStyle} containerStyle={scrollHost.documentStyle}
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
    startInLoadingState={Boolean(props.renderLoading)} renderLoading={props.renderLoading} renderError={props.renderError} testID="pdf-document" />)
})
