import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {RefObject} from 'react'
import {getNetworkStateAsync} from 'expo-network'
import type {RssEntryDetail} from '@slax-reader/contracts'
import type {PdfDescriptor} from '@slax-reader/contracts/pdf'
import type {BookmarkRecord, MarkCommentProfile} from '../../data'
import {getDataErrorDiagnostic} from '../../data/transport-errors'
import {reportRssSaved} from '../../rss/controller'
import {composeReaderError} from '../index'
import {jsonArray, jsonObject} from '../model'
import type {ReaderHandle} from '../ReaderWebView'
import {ReaderCrashRecovery} from '../recovery'
import {pdfFailureMessage, pdfMustInvalidate, rssReaderErrorCode} from './document-errors'
import type {MobileContext, ReaderDocumentTransitions, ReaderScope} from './types'

interface DocumentPorts {
  runtime: Pick<MobileContext['runtime'], 'beginArticleAccess' | 'getArticleContent' | 'getPdfMetadata' | 'readPdfRange'>
  api: Pick<MobileContext['api'], 'rssDetail' | 'rssSave'>
  repositories: Pick<NonNullable<MobileContext['repositories']>, 'getBookmark' | 'local'> | null
  cache: MobileContext['cache']
  fixtureOnly: MobileContext['fixtureOnly']
  resourceOwnerAtMount: MobileContext['nativeResourceOwner']
  nativeResourceOwner: MobileContext['nativeResourceOwner']
  stableUserId: number
  record: BookmarkRecord | null
  transitions: RefObject<ReaderDocumentTransitions | null>
}
/** Starts a read now; its rejection is observed when the result is awaited, and dropped when it is not needed. */
function speculative<T>(work: () => Promise<T>): Promise<T> {const value = Promise.resolve().then(work); void value.catch(() => undefined); return value}
export function useReaderDocument(scope: ReaderScope, ports: DocumentPorts) {
  const {cacheKey, bookmarkId, collectionOwnerId, rssEntryId, currentUserId, isCollection, isPreview, isAccountActive, mounted, foreground, appActive, reader, fail, t} = scope
  const {runtime, api, repositories, cache, fixtureOnly, resourceOwnerAtMount, nativeResourceOwner, stableUserId, record, transitions} = ports
  const fixtureDirectory = fixtureOnly?.dataDirectory
  const contentRequest = useRef<AbortController | null>(null), pdfMetadataRequest = useRef<AbortController | null>(null)
  const waitingForRecord = useRef(false), hydrationRevision = useRef(0)
  const [rss, setRss] = useState<RssEntryDetail | null>(null), [rssError, setRssError] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null), [pdf, setPdf] = useState<PdfDescriptor | null>(null)
  const pdfSnapshot = useRef(pdf), contentSnapshot = useRef(html), knownType = useRef(record?.contentType)
  knownType.current = record?.contentType
  pdfSnapshot.current = pdf; contentSnapshot.current = html
  const [pdfPollGeneration, setPdfPollGeneration] = useState(0)
  const [initialPosition, setInitialPosition] = useState<number | null>(null)
  const pdfPosition = useRef(1), scrollInfo = useRef({position: 0, nearBottom: false})
  const [loading, setLoading] = useState(true), [documentReady, setDocumentReady] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null), [nativeFailure, setNativeFailure] = useState<string | null>(null)
  const contentErrorSnapshot = useRef(contentError); contentErrorSnapshot.current = contentError
  const [readerGeneration, setReaderGeneration] = useState(0), readerGenerationSequence = useRef(0)
  const pdfHostLease = useMemo(() => ({attached: false, retired: false}), [cacheKey, pdf?.document_id, pdf?.size, readerGeneration, resourceOwnerAtMount, stableUserId, fixtureDirectory, fixtureOnly?.pdfNativeOwner])
  const activePdfHost = useRef<typeof pdfHostLease | null>(null)
  const attachPdfHost = useCallback((handle: ReaderHandle | null) => {
    if (handle) {
      if (activePdfHost.current && activePdfHost.current !== pdfHostLease) activePdfHost.current.retired = true
      activePdfHost.current = pdfHostLease; pdfHostLease.attached = true; reader.current = handle
    } else if (activePdfHost.current === pdfHostLease) {pdfHostLease.attached = false; reader.current = null}
  }, [pdfHostLease])
  const isPdfHostCurrent = useCallback((allowDetached = false) => activePdfHost.current === pdfHostLease && !pdfHostLease.retired && (allowDetached || pdfHostLease.attached && mounted.current) && pdfSnapshot.current?.document_id === pdf?.document_id && isAccountActive(), [pdfHostLease, pdf?.document_id, isAccountActive])
  const advanceReaderGeneration = useCallback(() => {
    if (activePdfHost.current) activePdfHost.current.retired = true
    setReaderGeneration(++readerGenerationSequence.current)
  }, [])
  const recovery = useMemo(() => new ReaderCrashRecovery(), [cacheKey])
  const abort = useCallback(() => {contentRequest.current?.abort(); pdfMetadataRequest.current?.abort(); recovery.dispose()}, [recovery])
  useEffect(() => () => abort(), [abort])
  useLayoutEffect(() => {
    setRss(null); setRssError(null); setHtml(null); setInitialPosition(null)
    setPdf(null); pdfSnapshot.current = null; pdfPosition.current = 1; setPdfPollGeneration(0)
    setLoading(true); setDocumentReady(false); setContentError(null); setNativeFailure(null); advanceReaderGeneration()
    scrollInfo.current = {position: 0, nearBottom: false}
  }, [cacheKey])
  const isPdf = !isPreview && (record?.contentType === 'pdf' || pdf !== null)
  const pdfTextState = isPdf ? pdf?.text_status ?? 'pending' : null
  const pdfTextMessage = pdfTextState && pdfTextState !== 'ready' ? t(`pdf_text_${pdfTextState}`) : null
  const revokePdfAccess = useCallback(() => {
    pdfMetadataRequest.current?.abort()
    pdfSnapshot.current = null; setPdf(null); setDocumentReady(false)
    transitions.current?.revokeAccess()
  }, [])
  useLayoutEffect(() => {if (isPdf && !isAccountActive()) revokePdfAccess()}, [isPdf, isAccountActive, nativeResourceOwner, currentUserId, appActive, revokePdfAccess])
  const pendingCacheWrite = useMemo(() => ({current: null as (() => Promise<void>) | null}), [cacheKey, isAccountActive])
  useEffect(() => {if (documentReady || !appActive) void pendingCacheWrite.current?.()}, [documentReady, appActive, html, loading, pendingCacheWrite])
  useEffect(() => () => {void pendingCacheWrite.current?.()}, [pendingCacheWrite])
  const load = useCallback(async (force = false) => {
    if (!isAccountActive()) return
    const releaseArticleAccess = runtime.beginArticleAccess(cacheKey)
    contentRequest.current?.abort()
    const controller = new AbortController(); contentRequest.current = controller
    if (pdfSnapshot.current) setInitialPosition(pdfPosition.current)
    setLoading(true); setContentError(null); setRssError(null)
    let remoteAttempted = false, cacheOwnsAccess = false
    let contentKind: 'pdf' | 'html' | null = null
    let downloadStarted: Promise<unknown> = Promise.resolve()
    const publish = (content: string, position: number) => {
      if (content !== contentSnapshot.current) {setDocumentReady(false); setInitialPosition(position); setHtml(content)}
      setLoading(false)
    }
    try {
      await pendingCacheWrite.current?.()
      if (controller.signal.aborted || !isAccountActive()) return
      if (force) await reader.current?.flushPosition('document-change')
      if (rssEntryId) {
        const entry = await api.rssDetail(rssEntryId, controller.signal)
        if (controller.signal.aborted || !isAccountActive()) return
        setRss(entry)
        const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        publish(entry.content_html || `<p>${escape(entry.summary || '')}</p>`, 0); return
      }
      if (!repositories || !cache || !bookmarkId || isCollection && !collectionOwnerId) throw new Error(t('load_bookmark_content_error'))
      // The committed body and local state are read alongside the record; a PDF record ignores the speculative article read.
      const localRead = speculative(() => repositories.local.read(cacheKey))
      const articleRead = knownType.current === 'pdf' ? null : speculative(() => cache.readArticle(cacheKey))
      const bookmark = await repositories.getBookmark(bookmarkId, collectionOwnerId)
      if (controller.signal.aborted || !isAccountActive()) return
      if (!bookmark) {waitingForRecord.current = true; setContentError(t('load_bookmark_content_error')); return}
      waitingForRecord.current = false; transitions.current?.acceptRecord(bookmark)
      const pdfDocument = bookmark.contentType === 'pdf'; contentKind = pdfDocument ? 'pdf' : 'html'
      const [local, cached] = await Promise.all([localRead, pdfDocument ? null : articleRead ?? cache.readArticle(cacheKey)])
      if (controller.signal.aborted || !isAccountActive()) return
      transitions.current?.hydrateAi({revision: ++hydrationRevision.current, values: local})
      transitions.current?.hydrateProfiles(jsonArray<MarkCommentProfile>(local.mark_users))
      if (pdfDocument) {
        const descriptor = await runtime.getPdfMetadata(bookmarkId, collectionOwnerId, controller.signal)
        if (controller.signal.aborted || !isAccountActive()) return
        const previous = pdfSnapshot.current
        if (previous?.document_id !== descriptor.document_id) {
          const saved = jsonObject(local.pdf_read_position)
          const position = saved.document_id === descriptor.document_id && typeof saved.position === 'number' && Number.isFinite(saved.position) && saved.position >= 1 ? saved.position : 1
          if (previous) await reader.current?.flushPosition('document-change')
          if (controller.signal.aborted || !isAccountActive()) return
          setInitialPosition(position); pdfPosition.current = position; scrollInfo.current = {position: 0, nearBottom: false}; setDocumentReady(false)
          transitions.current?.documentChanged()
        }
        pdfSnapshot.current = descriptor; setPdf(descriptor); setHtml(null); setNativeFailure(null); setPdfPollGeneration(value => value + 1)
        return
      }
      setPdf(null); pdfSnapshot.current = null
      const position = contentSnapshot.current === null ? Number(local.read_position ?? 0) : scrollInfo.current.position
      if (contentSnapshot.current === null) {setInitialPosition(position); scrollInfo.current.position = position}
      if (cached && contentSnapshot.current === null) publish(cached, position)
      if (cached && !force) return
      const network = fixtureOnly?.network ?? await getNetworkStateAsync()
      if (controller.signal.aborted || !isAccountActive()) return
      if (!network.isConnected || network.isInternetReachable === false) {if (!cached) throw new Error('No network connection'); return}
      remoteAttempted = true
      downloadStarted = repositories.local.update(cacheKey, {is_downloaded: 1, is_auto_cached: 0}).catch(() => undefined)
      // The offline engine serves or fetches the body at foreground priority and commits it before resolving.
      const content = await runtime.getArticleContent(bookmarkId, collectionOwnerId, controller.signal, force)
      if (controller.signal.aborted || !isAccountActive()) return
      publish(content, scrollInfo.current.position)
      let writing: Promise<void> | null = null
      const persist = (): Promise<void> => writing ??= (async () => {
        try {
          await downloadStarted
          if (isAccountActive()) await repositories.local.update(cacheKey, {is_downloaded: 2, is_auto_cached: 0})
        } catch {if (isAccountActive()) await repositories.local.update(cacheKey, {is_downloaded: 3, is_auto_cached: 0}).catch(() => undefined)}
        finally {releaseArticleAccess(); if (pendingCacheWrite.current === persist) pendingCacheWrite.current = null}
      })()
      pendingCacheWrite.current = persist; cacheOwnsAccess = true
    } catch (error) {
      if (!controller.signal.aborted && isAccountActive()) {
        if (rssEntryId) {setRssError(rssReaderErrorCode(error)); setHtml(null); return}
        if (remoteAttempted) void downloadStarted.then(() => isAccountActive() ? repositories?.local.update(cacheKey, {is_downloaded: 3, is_auto_cached: 0}) : undefined).catch(() => undefined)
        if (contentKind === 'pdf') {
          if (getDataErrorDiagnostic(error).kind === 'cancelled' || error instanceof Error && error.name === 'ReaderOperationCancelled') return
          const message = pdfFailureMessage(error, t, 'pdf-metadata')
          if (pdfMustInvalidate(error)) {setContentError(previous => previous || message); revokePdfAccess()}
          else if (pdfSnapshot.current) fail(new Error(message))
          else {setContentError(previous => previous || message); setDocumentReady(false)}
        } else {
          const message = error instanceof Error ? error.message : t('load_bookmark_content_error'); setContentError(message)
          if (contentKind === 'html') setHtml(previous => previous ?? composeReaderError('Failed to load content', message === 'No network connection' ? message : 'Network error', message === 'No network connection' ? 'This article is not cached on this device' : message))
          else {setHtml(null); setPdf(null); pdfSnapshot.current = null; setDocumentReady(false)}
        }
      }
    } finally {
      if (!cacheOwnsAccess) releaseArticleAccess()
      if (!controller.signal.aborted && isAccountActive()) setLoading(false)
      if (contentRequest.current === controller) contentRequest.current = null
    }
  }, [runtime, api, cache, repositories, bookmarkId, cacheKey, rssEntryId, isCollection, collectionOwnerId, fixtureOnly?.network, isAccountActive, pendingCacheWrite])
  useEffect(() => {void load(); return () => contentRequest.current?.abort()}, [load])
  useEffect(() => {if (record && waitingForRecord.current && !loading) {waitingForRecord.current = false; void load()}}, [record, loading, load])
  useEffect(() => {
    if (!pdf || pdf.text_status !== 'pending' || !appActive || scope.routeVisible === false || !isAccountActive()) return
    const controller = new AbortController(); pdfMetadataRequest.current = controller
    let timer: ReturnType<typeof setTimeout> | undefined, attempts = 0
    const poll = async () => {
      if (controller.signal.aborted || !mounted.current || !isAccountActive()) return
      try {
        const descriptor = await runtime.getPdfMetadata(bookmarkId, collectionOwnerId, controller.signal)
        if (controller.signal.aborted || !mounted.current || !isAccountActive()) return
        if (descriptor.document_id !== pdf.document_id) {void load(true); return}
        pdfSnapshot.current = descriptor; setPdf(descriptor)
        if (descriptor.text_status !== 'pending') return
      } catch (error) {
        if (controller.signal.aborted || !mounted.current || !isAccountActive()) return
        if (pdfMustInvalidate(error)) {setContentError(previous => previous || pdfFailureMessage(error, t, 'pdf-metadata')); revokePdfAccess(); return}
      }
      if (++attempts < 12) timer = setTimeout(() => void poll(), 5000)
    }
    timer = setTimeout(() => void poll(), 5000)
    return () => {controller.abort(); if (timer !== undefined) clearTimeout(timer)}
  }, [runtime, bookmarkId, collectionOwnerId, pdf?.document_id, pdf?.text_status, appActive, scope.routeVisible, pdfPollGeneration, isAccountActive, load])
  const readPdfRange = useCallback(async (begin: number, end: number, signal: AbortSignal) => {
    if (!pdf || !isPdfHostCurrent()) throw Object.assign(new Error('PDF reader is inactive'), {name: 'ReaderOperationCancelled'})
    try {return await runtime.readPdfRange(bookmarkId, pdf, begin, end, collectionOwnerId, signal)}
    catch (error) {
      if (!signal.aborted && isPdfHostCurrent() && pdfMustInvalidate(error)) {setContentError(previous => previous || pdfFailureMessage(error, t, 'pdf-range')); revokePdfAccess()}
      throw error
    }
  }, [runtime, bookmarkId, collectionOwnerId, pdf, isPdfHostCurrent, t, revokePdfAccess])
  const saveRss = async () => {
    if (!rssEntryId || loading || rss?.bookmark_user_uuid || !rss?.article_url || !isAccountActive()) return
    setLoading(true); setRssError(null)
    try {const saved = await api.rssSave(rssEntryId); if (!mounted.current || !isAccountActive()) return; reportRssSaved(rssEntryId, saved.bookmark_user_uuid, rss?.article_url); setRss(previous => previous ? {...previous, bookmark_user_uuid: saved.bookmark_user_uuid} : null); setLoading(false)}
    catch (error) {if (mounted.current && isAccountActive()) {setRssError(rssReaderErrorCode(error)); setLoading(false)}}
  }
  const retryNative = useCallback(async (automatic = false) => {
    const generation = readerGenerationSequence.current
    const isForeground = () => foreground.current && mounted.current && isAccountActive() && readerGenerationSequence.current === generation
    if (!isForeground()) return
    const flush = async () => {await reader.current?.flushPosition('document-change').catch(fail)}
    const latestPosition = () => pdfSnapshot.current ? pdfPosition.current : scrollInfo.current.position
    const next = await (automatic ? recovery.recoverForeground(flush, latestPosition, isForeground) : recovery.retry(flush, latestPosition, isForeground))
    if (next && isForeground()) {setInitialPosition(next.position); advanceReaderGeneration(); setDocumentReady(false); setNativeFailure(null)}
  }, [recovery, isAccountActive, fail, advanceReaderGeneration])
  useEffect(() => {if (appActive && nativeFailure) void retryNative(true).catch(fail)}, [appActive, nativeFailure, retryNative, fail])
  const handleNativeFailure = (reason: unknown, message: string) => {
    if (recovery.fail(reason)) {transitions.current?.clearSelection(); setNativeFailure(message); return true}
    return recovery.needsRecovery
  }
  const pdfError = (error: Error) => {
    if (!isPdfHostCurrent() || contentErrorSnapshot.current) return
    if (error.name === 'ReaderProcessGone') {fail(error); return}
    if (error.name === 'AbortError' || error.name === 'ReaderOperationCancelled' || error.name === 'SessionChangedError') return
    const message = pdfFailureMessage(error, t)
    contentErrorSnapshot.current = message; setContentError(message); setDocumentReady(false); transitions.current?.clearSelection()
  }
  const persistPdf = async (position: number, reason: string) => {
    if (!isPdfHostCurrent(reason === 'exit' || reason === 'document-change') || !repositories || !pdf || !Number.isFinite(position) || position < 1) return
    await repositories.local.update(cacheKey, {pdf_read_position: JSON.stringify({document_id: pdf.document_id, position})})
  }
  const persistHtml = async (position: number) => {if (!isPreview && isAccountActive() && repositories) await repositories.local.update(cacheKey, {read_position: String(position)})}
  return {html, pdf, pdfSnapshot, rss, rssError, isPdf, pdfTextState, pdfTextMessage, loading, documentReady, initialPosition, contentError, contentErrorSnapshot, nativeFailure, readerGeneration,
    scrollInfo, pdfPosition, attachPdfHost, isPdfHostCurrent, readPdfRange, load, saveRss, retryNative, handleNativeFailure, pdfError, persistPdf, persistHtml, abort,
    ready: () => setDocumentReady(true), persist: () => {void pendingCacheWrite.current?.()},
    retryPdf: () => {setInitialPosition(pdfPosition.current); advanceReaderGeneration(); void load(true)}}
}
