import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {Animated, Easing} from 'react-native'
import {usePreventRemove} from '@react-navigation/native'
import {fetch as expoFetch} from 'expo/fetch'
import {PREFERENCE_KEYS} from '../../data'
import {openInAppBrowser} from '../../native/platform'
import {resolveGalleryImage} from '../gallery-resource'
import {rssImageUrl, youtubeCues} from '../model'
import {toolbarVisible} from '../index'
import {useReducedMotion} from '../../motion/useReducedMotion'
import type {ReaderEvent} from '../types'
import {useImageActions, type ImageActionPort} from './useImageActions'
import type {useReaderAi} from './useReaderAi'
import type {useReaderAnnotations} from './useReaderAnnotations'
import type {useReaderBookmark} from './useReaderBookmark'
import type {useReaderDocument} from './useReaderDocument'
import type {MobileContext, ReaderOverlay, ReaderPresentationIdentity, ReaderScope, ReaderTelemetry, WriteReaderPreferences} from './types'

interface PendingExternal {dialogId: number; url: string; dismissed: boolean; result: {ok: true} | {ok: false; error: unknown} | null; isActive(): boolean}
interface InteractionPorts {
  isIos: boolean; nativeResourceOwner: MobileContext['nativeResourceOwner']; fixtureOnly: boolean
  settings: MobileContext['settings']; writePreferences: WriteReaderPreferences; cache: MobileContext['cache']
  telemetry: ReaderTelemetry; api: Pick<MobileContext['api'], 'sendMetrics'>
  document: ReturnType<typeof useReaderDocument>; annotations: ReturnType<typeof useReaderAnnotations>; bookmark: ReturnType<typeof useReaderBookmark>; ai: ReturnType<typeof useReaderAi>
  presentation: ReaderPresentationIdentity
  operationError: string | null; clearError(): void
  feedback(entryPoint: 'detail_error' | 'bookmark_detail'): void
  imageActions?: ImageActionPort
}
export function useReaderInteractions(scope: ReaderScope, ports: InteractionPorts) {
  const {cacheKey, currentUserId, isPreview, isAccountActive, mounted, foreground, reader, fail} = scope
  const {isIos, nativeResourceOwner, fixtureOnly, settings, writePreferences, cache, telemetry, api, document, annotations, bookmark, ai, presentation, operationError, clearError} = ports
  const {title, isPdf} = presentation
  const {panel, selection, discard, deletingComment, commentMenu, pdfNotesVisible, clearSelection} = annotations
  const run = (work: Promise<unknown> | undefined) => {void work?.catch(fail)}
  const [overlay, setOverlay] = useState<ReaderOverlay>(null)
  const [toolbarId, setToolbarId] = useState(0), toolbarSequence = useRef(0)
  const pendingToolbar = useRef<{id: number; run(): void; isActive(): boolean} | null>(null)
  const dismissToolbar = useCallback(() => {if (toolbarId !== toolbarSequence.current) return; toolbarSequence.current++; pendingToolbar.current = null; setOverlay(null)}, [toolbarId])
  useLayoutEffect(() => () => {toolbarSequence.current++; pendingToolbar.current = null}, [cacheKey, currentUserId, nativeResourceOwner, isAccountActive])
  const [externalUrl, setExternalUrl] = useState<string | null>(null), [externalDialogId, setExternalDialogId] = useState(0)
  const externalDialogSequence = useRef(0), pendingExternal = useRef<PendingExternal | null>(null)
  const cancelExternal = useCallback(() => {pendingExternal.current = null; setExternalUrl(null)}, [])
  useLayoutEffect(() => () => {pendingExternal.current = null}, [cacheKey, currentUserId, nativeResourceOwner, isAccountActive])
  const [doNotAlert, setDoNotAlert] = useState(false), [toolbarIsVisible, setToolbarIsVisible] = useState(true)
  const headerMoreOffset = useRef(new Animated.Value(0)).current, reducedMotion = useReducedMotion()
  useEffect(() => {
    const animation = Animated.timing(headerMoreOffset, {toValue: toolbarIsVisible ? 0 : -100, duration: reducedMotion ? 0 : 300, easing: Easing.bezier(.4, 0, .2, 1), useNativeDriver: true})
    animation.start(); return () => animation.stop()
  }, [headerMoreOffset, toolbarIsVisible, reducedMotion])
  const [gallery, setGallery] = useState<{images: string[]; index: number} | null>(null)
  const resolveGalleryUri = useCallback((uri: string, signal?: AbortSignal) => resolveGalleryImage(cache, cacheKey, uri, {fetch: expoFetch, allowNetwork: !fixtureOnly, isActive: isAccountActive, signal}), [cache, cacheKey, fixtureOnly, isAccountActive])
  const imageActions = useImageActions({port: ports.imageActions, resolveUri: resolveGalleryUri, isActive: isAccountActive})
  const [transcriptVisible, setTranscriptVisible] = useState(false), [youtubeTime, setYoutubeTime] = useState(-1)
  const cues = useCues(document.html)
  useLayoutEffect(() => {setOverlay(null); setExternalUrl(null); setGallery(null); setTranscriptVisible(false); setYoutubeTime(-1); setToolbarIsVisible(true); clearError()}, [cacheKey])
  useEffect(() => {
    if (!transcriptVisible) return
    let active = true
    void reader.current?.queryYoutubeTime().then(time => {if (active && isAccountActive()) setYoutubeTime(time)}).catch(fail)
    return () => {active = false; setYoutubeTime(-1)}
  }, [transcriptVisible, isAccountActive])
  usePreventRemove(Boolean(panel || selection || gallery || overlay || pdfNotesVisible || transcriptVisible || ai.outlineStatus === 'expanded' || discard || deletingComment || externalUrl || operationError), () => {
    if (operationError) clearError()
    else if (pdfNotesVisible) annotations.closeNotes()
    else if (deletingComment) annotations.cancelDelete()
    else if (commentMenu) annotations.setCommentMenu(null)
    else if (discard) annotations.cancelDiscard()
    else if (externalUrl) cancelExternal()
    else if (gallery) setGallery(null)
    else if (overlay === 'toolbar') dismissToolbar()
    else if (overlay) setOverlay(null)
    else if (transcriptVisible) setTranscriptVisible(false)
    else if (ai.outlineStatus === 'expanded') ai.close('collapsed')
    else if (panel) annotations.dismissPanel()
    else if (selection) void clearSelection()
  })
  const external = (url: string) => {
    if (!foreground.current || !/^https?:\/\//i.test(url) || !isAccountActive()) return
    if (fixtureOnly) {fail(new Error('External navigation is unavailable in controlled UI fixtures')); return}
    pendingExternal.current = null
    if (settings[PREFERENCE_KEYS.detailDoNotAlert] === 'true') run(openInAppBrowser(url))
    else {setExternalDialogId(++externalDialogSequence.current); setDoNotAlert(false); setExternalUrl(url)}
  }
  const completeExternal = async (pending: PendingExternal) => {
    if (pendingExternal.current !== pending) return
    if (!foreground.current || !mounted.current || !pending.isActive()) {pendingExternal.current = null; return}
    if (!pending.dismissed || !pending.result) return
    pendingExternal.current = null
    if (!pending.result.ok) {fail(pending.result.error); return}
    await openInAppBrowser(pending.url)
  }
  const externalDidDismiss = () => {
    const pending = pendingExternal.current
    if (!pending || pending.dialogId !== externalDialogId) return
    pending.dismissed = true; run(completeExternal(pending))
  }
  const confirmExternal = async () => {
    const url = externalUrl
    if (!url || !mounted.current || !isAccountActive() || pendingExternal.current) return
    if (fixtureOnly) throw new Error('External navigation is unavailable in controlled UI fixtures')
    const pending: PendingExternal = {dialogId: externalDialogId, url, dismissed: !isIos, result: null, isActive: isAccountActive}
    pendingExternal.current = pending; setExternalUrl(null)
    try {if (doNotAlert) await writePreferences(next => {next[PREFERENCE_KEYS.detailDoNotAlert] = 'true'}); pending.result = {ok: true}}
    catch (error) {pending.result = {ok: false, error}}
    await completeExternal(pending)
  }
  const showToolbar = useCallback(() => {
    if (isPreview || !isAccountActive()) return
    pendingToolbar.current = null; setToolbarId(++toolbarSequence.current); void clearSelection()
    telemetry.element('detail_toolbar_open', 'detail'); telemetry.firebase('bookmark', 'use_toolbar_menu'); setOverlay('toolbar')
  }, [isPreview, isAccountActive, clearSelection, telemetry])
  const performToolbarAction = (id: string) => {
    if (!mounted.current || !isAccountActive()) return
    if (id === 'star') bookmark.toggle('isStarred')
    else if (id === 'archive') bookmark.toggle('archiveStatus')
    else if (id === 'outline') ai.open()
    else if (id === 'transcript') setTranscriptVisible(true)
    else if (id === 'pdf-notes') annotations.openNotes()
    else if (id === 'edit') {telemetry.element('bookmark_edit_title_button', 'detail'); bookmark.setDraftTitle(title.replace(/\s+/g, ' ').trim()); setOverlay('edit')}
    else if (id === 'delete') {telemetry.element('bookmark_delete_button', 'detail'); setOverlay('delete')}
    else if (id === 'feedback') {telemetry.element('detail_feedback_button', 'detail'); ports.feedback('bookmark_detail')}
    else if (id === 'share') {telemetry.element('detail_share_button', 'detail'); run(bookmark.share({title, isPdf}))}
  }
  const toolbarDidDismiss = () => {
    const pending = pendingToolbar.current
    if (!pending || pending.id !== toolbarId || toolbarId !== toolbarSequence.current) return
    toolbarSequence.current++; pendingToolbar.current = null
    if (foreground.current && mounted.current && pending.isActive()) {try {pending.run()} catch (error) {fail(error)}}
  }
  const action = (id: string) => {
    if (overlay !== 'toolbar' || toolbarId !== toolbarSequence.current || pendingToolbar.current || !mounted.current || !isAccountActive()) return
    if (id === 'star' || id === 'archive') {
      toolbarSequence.current++; setOverlay(null); performToolbarAction(id); return
    }
    pendingToolbar.current = {id: toolbarId, run: () => performToolbarAction(id), isActive: isAccountActive}
    setOverlay(null); if (!isIos) toolbarDidDismiss()
  }
  const showOverview = () => {if (!isAccountActive()) return; telemetry.firebase('bookmark', 'overview_interact', {}, 'open'); setOverlay('overview'); void api.sendMetrics('ai_overview'); void ai.load('overview')}
  const closeOverview = () => {if (!isAccountActive()) return; telemetry.firebase('bookmark', 'overview_interact', {}, 'close'); setOverlay(null)}
  const handleEvent = (event: ReaderEvent) => {
    if (!isAccountActive()) return
    if (event.type === 'domReady') {document.ready(); return}
    if (!foreground.current && event.type !== 'markItemInfosChanged' && event.type !== 'textDeselected') return
    if (isPreview && ['textSelected', 'textDeselected', 'markClicked', 'markItemInfosChanged', 'selectionError'].includes(event.type)) return
    annotations.handleEvent(event)
    if (event.type === 'imageClick') {
      if (isPreview && !rssImageUrl(event.src)) return
      const images = (event.allImages.length ? event.allImages : [event.src]).filter(url => !isPreview || rssImageUrl(url))
      void clearSelection(); setGallery({images, index: Math.max(0, images.indexOf(event.src))})
    } else if (event.type === 'imageLongPress') {
      if (isPreview && !rssImageUrl(event.src)) return
      void clearSelection(); imageActions.open(event.src, 'document')
    } else if (event.type === 'tap' && !document.scrollInfo.current.nearBottom && document.scrollInfo.current.position > 10) setToolbarIsVisible(value => !value)
    else if (event.type === 'refreshContent') void document.load(true)
    else if (event.type === 'feedback') ports.feedback('detail_error')
  }
  const cancelPending = () => {pendingExternal.current = null; pendingToolbar.current = null}
  const scroll = (position: number, nearBottom: boolean) => {if (isAccountActive()) {document.scrollInfo.current = {position, nearBottom}; setToolbarIsVisible(toolbarVisible(position, nearBottom))}}
  return {overlay, toolbarId, toolbarIsVisible, headerMoreOffset, externalUrl, externalDialogId, doNotAlert, gallery, transcriptVisible, youtubeTime, cues,
    showToolbar, dismissToolbar, toolbarDidDismiss, action, external, confirmExternal, externalDidDismiss, cancelExternal, showOverview, closeOverview, handleEvent, resolveGalleryUri, cancelPending, scroll, imageActions,
    openGalleryImageAction: (source: string) => imageActions.open(source, 'gallery'),
    closeOverlay: () => setOverlay(null), showSubscription: () => setOverlay('subscription'), revoke: () => {setOverlay(null); clearError()},
    showTags: () => {telemetry.firebase('bookmark', 'use_tag'); setOverlay('tags')}, toggleAlert: () => setDoNotAlert(value => !value),
    closeGallery: () => {if (imageActions.request?.surface === 'gallery') imageActions.reset(); setGallery(null)}, showTranscript: () => setTranscriptVisible(true), closeTranscript: () => setTranscriptVisible(false),
    seek: (seconds: number) => {setTranscriptVisible(false); run(reader.current?.seekYoutube(seconds))}}
}

function useCues(html: string | null) {
  return useMemo(() => youtubeCues(html ?? ''), [html])
}
