import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, AppState, Easing, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { getNetworkStateAsync } from 'expo-network'
import {File} from 'expo-file-system'
import { usePreventRemove } from '@react-navigation/native'
import {useSafeAreaInsets} from 'react-native-safe-area-context'
import type { RssEntryDetail } from '@slax-reader/contracts'
import { SourceDialog, SourceIcon, SourceText, TextAction } from '../components'
import { bookmarkCacheKey, bookmarkDisplayTitle, collectionMarkPolicy, PERSONAL_MARK_POLICY, PENDING_COLLECTION_MARK_POLICY, PREFERENCE_KEYS } from '../data'
import type { BookmarkRecord, MarkCommentProfile, MarkRecord, TagRecord, PreferenceValues } from '../data'
import type { MobileScreenProps } from '../navigation/types'
import { useMobile, useControlledUpgradeReaderObserver } from '../runtime'
import { reportRssSaved, rssErrorCode } from '../rss/controller'
import { mobileColors as C, mobileTypography as T } from '../theme'
import { readerNativeAdapter } from '../native/reader'
import {shareArticle} from '../native/platform'
import {useTelemetry} from '../telemetry'
import {readerShareImage} from '../reader/share'
import { ReaderWebView, composeReaderError, toolbarVisible, type ReaderEvent, type ReaderHandle, type ReaderMarkItem, type ReaderComment, type ReaderSelection, type ReaderFixtureLifecycle, type ReaderObservation, type ReaderInputObservation } from '../reader'
import {readerInputEventCode} from '../reader/input'
import { CommentPanel, FloatingActions, OutlineSheet, ReaderToolbar, SelectionMenu, TranscriptSheet } from '../reader/ReaderOverlays'
import { ImageGallery } from '../reader/ImageGallery'
import {OverviewDialog, OverviewExcerpt} from '../reader/OverviewViews'
import {ReaderSkeleton} from '../reader/ReaderSkeleton'
import { ReaderTagSheet } from '../reader/TagSheet'
import { buildReaderMarks, fixMarkdownLinks, jsonArray, jsonObject, selectionForMark, selectionPaths, sourceDisplayTime, sourceStableId, sourceStrokeToRemove, StreamMarkdownProcessor, subscriptionActive, youtubeCues, rssImageUrl } from '../reader/model'
import { ReaderPositionWriter } from '../reader/position'
import {ReaderCrashRecovery} from '../reader/recovery'
import {readerAccountActive, updateReaderPreferences} from '../reader/account'
import {fixtureActions} from '../components/fixture-actions'
import type {ReaderFixtureCommand} from '../reader/types'

type Overlay = 'toolbar' | 'overview' | 'tags' | 'edit' | 'delete' | 'subscription' | null
interface AiState { content: string; takeaways: string[]; busy: boolean; pending: boolean; error: string | null }
const emptyAi = (): AiState => ({content: '', takeaways: [], busy: false, pending: true, error: null})
const rssReaderErrorCodes = new Set(['lab_disabled', 'not_found', 'source_unavailable', 'article_url_missing'])
const rssReaderErrorCode = (error: unknown) => {
  const code = rssErrorCode(error)
  return rssReaderErrorCodes.has(code) ? code : 'source_unavailable'
}

export function ReaderScreen({navigation, route}: MobileScreenProps<'Reader'>) {
  const {runtime, api, repositories, cache, preferences, settings, session, sessions, t, config, fixtureOnly, nativeResourceOwner} = useMobile()
  const upgradeReaderObserver = useControlledUpgradeReaderObserver()
  const safeArea = useSafeAreaInsets()
  const isIos = Platform.OS === 'ios'
  const controlledFixture = Boolean(__DEV__ && fixtureOnly)
  const resourceOwnerAtMount = useRef(nativeResourceOwner).current
  const telemetry = useTelemetry()
  const {bookmarkId, collectionOwnerId, collectionId, rssEntryId} = route.params
  const cacheKey = rssEntryId ? `rss-${rssEntryId}` : bookmarkCacheKey(bookmarkId, collectionOwnerId)
  const currentUserId = session.status === 'authenticated' ? session.session.userId : ''
  const isAccountActive = useCallback(() => readerAccountActive(sessions.getSnapshot(), currentUserId, controlledFixture ? undefined : {owner: resourceOwnerAtMount, currentOwner: runtime.getNativeResourceOwner()}), [sessions, currentUserId, controlledFixture, resourceOwnerAtMount, runtime])
  const writePreferences = useCallback((edit: (values: PreferenceValues) => void) => updateReaderPreferences(preferences, currentUserId, sessions.getSnapshot, edit, isAccountActive), [preferences, sessions, currentUserId, isAccountActive])
  const stableUserId = sourceStableId(currentUserId)
  const reader = useRef<ReaderHandle>(null)
  const mounted = useRef(true)
  type FixtureLifecycle = ReaderFixtureLifecycle | {kind: 'native-transition-start' | 'native-transition-end' | 'native-gesture-cancel'; pageId: string; routeKey: string; closing?: boolean}
    | {kind: 'position-persisted'; pageId: string; reason: string; requestedPixels: number; persistedPixels: number | null}
  const fixtureLifecycle = useRef<(FixtureLifecycle & {observedAt: number})[]>([])
  const fixtureInput = useRef<(ReaderInputObservation & {observedAt: number})[]>([])
  const fixtureDirectory = fixtureOnly?.dataDirectory
  const observeReader = useCallback((observation: ReaderObservation) => {
    if (!__DEV__) return
    try {upgradeReaderObserver?.({...observation, cacheKey, routeKey: route.key, observedAt: Date.now()})}
    catch { /* A controlled reader observer cannot change application behavior. */ }
    if (observation.type !== 'input' || !controlledFixture || !fixtureDirectory?.includes('/slax-ui-fixtures/')) return
    try {
      const marker = JSON.parse(new File(fixtureDirectory, 'slax-fixture.json').textSync())
      if (marker.controlledFixture !== true || marker.fixtureVersion !== 1) return
      fixtureInput.current.push({...observation.event, observedAt: Date.now()})
      if (fixtureInput.current.length > 128) fixtureInput.current.shift()
      new File(fixtureDirectory, 'reader-input.json').write(JSON.stringify({controlledFixture: true, fixtureVersion: 1, cacheKey, events: fixtureInput.current}))
    } catch { /* Diagnostics do not replace or fail a production action. */ }
  }, [upgradeReaderObserver, cacheKey, route.key, controlledFixture, fixtureDirectory])
  const recordFixtureLifecycle = useCallback((event: FixtureLifecycle) => {
    if (!__DEV__ || !controlledFixture || !fixtureDirectory?.includes('/slax-ui-fixtures/')) return
    const marker = JSON.parse(new File(fixtureDirectory, 'slax-fixture.json').textSync())
    if (marker.controlledFixture !== true || marker.fixtureVersion !== 1) throw new Error('Fixture lifecycle scope is not controlled')
    fixtureLifecycle.current.push({...event, observedAt: Date.now()})
    if (fixtureLifecycle.current.length > 128) fixtureLifecycle.current.shift()
    new File(fixtureDirectory, 'reader-lifecycle.json').write(JSON.stringify({controlledFixture: true, fixtureVersion: 1, cacheKey, events: fixtureLifecycle.current}))
  }, [controlledFixture, fixtureDirectory, cacheKey])
  useEffect(() => {
    if (!controlledFixture) return
    const record = (kind: 'native-transition-start' | 'native-transition-end' | 'native-gesture-cancel', closing?: boolean) => {
      const pages = fixtureLifecycle.current.filter(event => event.kind === 'mount')
      const page = pages[pages.length - 1]
      if (page) recordFixtureLifecycle({kind, pageId: page.pageId, routeKey: route.key, ...(closing === undefined ? {} : {closing})})
    }
    const removeStart = navigation.addListener('transitionStart', event => record('native-transition-start', event.data.closing))
    const removeEnd = navigation.addListener('transitionEnd', event => record('native-transition-end', event.data.closing))
    const removeCancel = navigation.addListener('gestureCancel', () => record('native-gesture-cancel'))
    return () => {removeStart(); removeEnd(); removeCancel()}
  }, [controlledFixture, navigation, recordFixtureLifecycle, route.key])
  const scrollInfo = useRef({position: 0, nearBottom: false})
  const contentRequest = useRef<AbortController | null>(null)
  const aiRequests = useRef(new Map<'overview' | 'outline', AbortController>())
  const [record, setRecord] = useState<BookmarkRecord | null>(null)
  const [rss, setRss] = useState<RssEntryDetail | null>(null)
  const [rssError, setRssError] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [initialPosition, setInitialPosition] = useState<number | null>(null)
  const [outlinePosition, setOutlinePosition] = useState(0)
  const [loading, setLoading] = useState(true)
  const [transitionSettled, setTransitionSettled] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [nativeFailure, setNativeFailure] = useState<string | null>(null)
  const [readerGeneration, setReaderGeneration] = useState(0)
  const [marks, setMarks] = useState<MarkRecord[]>([])
  const [markProfiles, setMarkProfiles] = useState<MarkCommentProfile[]>([])
  const [user, setUser] = useState<Record<string, unknown>>({})
  const [subscribed, setSubscribed] = useState(false)
  const [tags, setTags] = useState<TagRecord[]>([])
  const [collectionSettings, setCollectionSettings] = useState<{allow_highlight: boolean; show_highlight: boolean; allow_access: boolean} | null>(null)
  const [overview, setOverview] = useState(emptyAi)
  const [outline, setOutline] = useState(emptyAi)
  const [outlineStatus, setOutlineStatus] = useState<'none' | 'hidden' | 'collapsed' | 'expanded'>('none')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [selection, setSelection] = useState<{mark: ReaderMarkItem; text: string; y: number} | null>(null)
  const [panel, setPanel] = useState<{mark: ReaderMarkItem; text: string; autoFocus: boolean; captured?: ReaderSelection} | null>(null)
  const [draft, setDraft] = useState('')
  const [reply, setReply] = useState<ReaderComment | null>(null)
  const [markBusy, setMarkBusy] = useState(false)
  const [discard, setDiscard] = useState<'panel' | null>(null)
  const [deletingComment, setDeletingComment] = useState<ReaderComment | null>(null)
  const [externalUrl, setExternalUrl] = useState<string | null>(null)
  const [doNotAlert, setDoNotAlert] = useState(false)
  const [toolbarIsVisible, setToolbarIsVisible] = useState(true)
  const headerMoreOffset = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const animation = Animated.timing(headerMoreOffset, {toValue: toolbarIsVisible ? 0 : -100, duration: 300, easing: Easing.bezier(.4, 0, .2, 1), useNativeDriver: true})
    animation.start()
    return () => animation.stop()
  }, [headerMoreOffset, toolbarIsVisible])
  const [containerHeight, setContainerHeight] = useState(1)
  const [gallery, setGallery] = useState<{images: string[]; index: number} | null>(null)
  const [transcriptVisible, setTranscriptVisible] = useState(false)
  const [youtubeTime, setYoutubeTime] = useState(-1)
  const [copied, setCopied] = useState(false)
  const aiStarted = useRef(false)
  useLayoutEffect(() => {
    setRecord(null); setRss(null); setRssError(null); setHtml(null); setInitialPosition(null); setOutlinePosition(0)
    setLoading(true); setContentError(null); setOperationError(null); setNativeFailure(null); setReaderGeneration(0)
    setMarks([]); setMarkProfiles([]); setCollectionSettings(null); setOverview(emptyAi()); setOutline(emptyAi()); setOutlineStatus('none')
    setOverlay(null); setSelection(null); setPanel(null); setDraft(''); setReply(null); setDiscard(null)
    setDeletingComment(null); setExternalUrl(null); setGallery(null); setTranscriptVisible(false); setYoutubeTime(-1); setToolbarIsVisible(true)
    scrollInfo.current = {position: 0, nearBottom: false}; aiStarted.current = false
    fixtureLifecycle.current = []
    fixtureInput.current = []
  }, [cacheKey])
  const metadata = useMemo(() => jsonObject(record?.metadata), [record?.metadata])
  const isCollection = Boolean(collectionOwnerId || collectionId)
  const isPreview = Boolean(rssEntryId)
  const title = record ? bookmarkDisplayTitle(record) : rss?.title || route.params.title || ''
  const originalUrl = record?.url || rss?.article_url || ''
  const policy = useMemo(() => isPreview ? {...PENDING_COLLECTION_MARK_POLICY, isCollection: false} : isCollection ? record ? collectionMarkPolicy(metadata.share ? jsonObject(metadata.share) : null, collectionSettings ?? undefined) : PENDING_COLLECTION_MARK_POLICY : PERSONAL_MARK_POLICY, [isPreview, isCollection, record, metadata, collectionSettings])
  const markDetail = useMemo(() => {
    try {return buildReaderMarks(marks, markProfiles, user, policy)}
    catch (error) {return {mark_list: [], user_list: {}, error: error instanceof Error ? error.message : 'Invalid legacy annotations'}}
  }, [marks, markProfiles, user, policy])
  const selectedTagIds = jsonArray<string>(metadata.tags)
  const selectedTags = tags.filter(tag => selectedTagIds.includes(tag.id))
  const cues = useMemo(() => youtubeCues(html ?? ''), [html])
  const infoPack = useMemo(() => ({metadataUrl: originalUrl, bookmarkId, platform: config.platform, version: config.version}), [originalUrl, bookmarkId, config.platform, config.version])
  const recovery = useMemo(() => new ReaderCrashRecovery(), [cacheKey])
  useEffect(() => () => recovery.dispose(), [recovery])
  const fail = useCallback((reason: unknown) => {if (mounted.current && isAccountActive()) {if (recovery.fail(reason)) {setSelection(null); setNativeFailure(reason instanceof Error ? reason.message : t('load_bookmark_content_error'))} else setOperationError(reason instanceof Error ? reason.message : t('load_bookmark_content_error'))}}, [t, recovery, isAccountActive])
  const run = (work: Promise<unknown> | undefined) => {void work?.catch(fail)}
  const clearSelection = useCallback(() => {setSelection(null); return reader.current?.clearSelection().catch(() => undefined)}, [])
  const outlineWriter = useMemo(() => new ReaderPositionWriter(position => isAccountActive() ? repositories?.local.update(cacheKey, {outline_read_position: String(Math.round(position))}) : undefined, fail), [repositories, cacheKey, isAccountActive])

  // An attempted native pop first dismisses the active transient state. With no
  // transient state, the native stack owns both committed and cancelled gestures.
  usePreventRemove(Boolean(panel || selection || gallery || overlay || transcriptVisible || outlineStatus === 'expanded' || discard || deletingComment || externalUrl || operationError), () => {
    if (operationError) setOperationError(null)
    else if (deletingComment) setDeletingComment(null)
    else if (discard) setDiscard(null)
    else if (externalUrl) setExternalUrl(null)
    else if (gallery) setGallery(null)
    else if (overlay) setOverlay(null)
    else if (transcriptVisible) setTranscriptVisible(false)
    else if (outlineStatus === 'expanded') {setOutlineStatus('collapsed'); run(outlineWriter.flush('background'))}
    else if (panel) {if (draft.trim()) setDiscard('panel'); else {setPanel(null); setReply(null); void clearSelection()}}
    else if (selection) void clearSelection()
  })
  useEffect(() => {setTransitionSettled(false); const timer = setTimeout(() => setTransitionSettled(true), 250); return () => clearTimeout(timer)}, [cacheKey])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      contentRequest.current?.abort()
      aiRequests.current.forEach(controller => controller.abort()); aiRequests.current.clear()
      void outlineWriter.dispose('exit').catch(() => undefined)
    }
  }, [cacheKey, outlineWriter])
  useEffect(() => {
    void writePreferences(next => {delete next[PREFERENCE_KEYS.continueReading]}).catch(fail)
    const subscription = AppState.addEventListener('change', state => {
      if (!isAccountActive()) return
      if (state === 'active') run(writePreferences(next => {delete next[PREFERENCE_KEYS.continueReading]}))
      else {
        run(outlineWriter.flush('background'))
        if (title && !isPreview) run(writePreferences(next => {next[PREFERENCE_KEYS.continueReading] = JSON.stringify({bookmarkId, title, collectionOwnerId: collectionOwnerId ?? null, collectionId: collectionId ?? null})}))
      }
    })
    return () => subscription.remove()
  }, [bookmarkId, title, collectionOwnerId, collectionId, isPreview, writePreferences, outlineWriter, isAccountActive])
  useEffect(() => {
    if (!repositories || isPreview || !isAccountActive()) return
    let active = true
    const updateRecord = () => {if (isCollection && !collectionOwnerId) return; void repositories.getBookmark(bookmarkId, collectionOwnerId).then(value => {if (active) setRecord(value)}).catch(fail)}
    updateRecord()
    const unsubscribers = [repositories.watchUser(rows => setUser(rows[0] ?? {}), fail), repositories.watchSubscription(rows => setSubscribed(subscriptionActive(rows)), fail), repositories.watchTags(setTags, fail)]
    if (bookmarkId && (!isCollection || collectionOwnerId)) {
      unsubscribers.push(repositories.watchComments(bookmarkId, setMarks, fail))
      unsubscribers.push(repositories.watchRows(`SELECT * FROM ${isCollection ? 'sr_collection_bookmark' : 'sr_user_bookmark'} WHERE id = ?${isCollection ? ' AND owner_id = ?' : ''}`, [bookmarkId, ...(collectionOwnerId ? [collectionOwnerId] : [])], updateRecord, fail))
      if (collectionId) run(repositories.markCollectionRead(collectionId))
    }
    if (collectionOwnerId) unsubscribers.push(repositories.watchCollectionSettings(collectionOwnerId, rows => setCollectionSettings(rows[0] ?? null), fail))
    return () => {active = false; unsubscribers.forEach(unsubscribe => unsubscribe())}
  }, [repositories, bookmarkId, collectionOwnerId, collectionId, isAccountActive])

  const loadContent = useCallback(async (force = false) => {
    if (!isAccountActive()) return
    const releaseArticleAccess = runtime.beginArticleAccess(cacheKey)
    contentRequest.current?.abort()
    const controller = new AbortController(); contentRequest.current = controller
    setLoading(true); setContentError(null); setRssError(null)
    let remoteAttempted = false
    try {
      if (force) await reader.current?.flushPosition('document-change')
      if (rssEntryId) {
        const entry = await api.rssDetail(rssEntryId, controller.signal)
        if (controller.signal.aborted || !isAccountActive()) return
        setRss(entry)
        const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        setInitialPosition(0); setHtml(entry.content_html || `<p>${escape(entry.summary || '')}</p>`); return
      }
      if (!repositories || !cache || !bookmarkId || isCollection && !collectionOwnerId) throw new Error(t('load_bookmark_content_error'))
      const local = await repositories.local.read(cacheKey)
      if (controller.signal.aborted || !isAccountActive()) return
      setInitialPosition(Number(local.read_position ?? 0)); setOutlinePosition(Number(local.outline_read_position ?? 0))
      setOverview({content: String(local.overview ?? ''), takeaways: jsonArray<string>(local.key_takeaways), busy: false, pending: false, error: null})
      setOutline({content: fixMarkdownLinks(String(local.outline ?? '')), takeaways: [], busy: false, pending: !local.outline, error: null})
      setMarkProfiles(jsonArray<MarkCommentProfile>(local.mark_users))
      const cached = await cache.readArticle(cacheKey)
      if (controller.signal.aborted || !isAccountActive()) return
      if (cached) setHtml(cached)
      if (cached && !force) return
      const network = fixtureOnly?.network ?? await getNetworkStateAsync()
      if (controller.signal.aborted || !isAccountActive()) return
      if (!network.isConnected || network.isInternetReachable === false) {
        if (!cached) throw new Error('No network connection')
        return
      }
      remoteAttempted = true
      await repositories.local.update(cacheKey, {is_downloaded: 1, is_auto_cached: 0})
      const content = await api.getBookmarkRawContent(bookmarkId, controller.signal)
      if (controller.signal.aborted || !isAccountActive()) return
      try {
        cache.writeArticle(cacheKey, content)
        await repositories.local.update(cacheKey, {is_downloaded: 2, is_auto_cached: 0})
      } catch {
        // The source still renders a successful download when its local cache write fails.
        await repositories.local.update(cacheKey, {is_downloaded: 3, is_auto_cached: 0}).catch(() => undefined)
      }
      if (!controller.signal.aborted && isAccountActive()) setHtml(content)
    } catch (error) {
      if (!controller.signal.aborted && isAccountActive()) {
        if (rssEntryId) {
          setRssError(rssReaderErrorCode(error)); setHtml(null)
          return
        }
        if (remoteAttempted) await repositories?.local.update(cacheKey, {is_downloaded: 3, is_auto_cached: 0}).catch(() => undefined)
        const message = error instanceof Error ? error.message : t('load_bookmark_content_error')
        setContentError(message)
        setHtml(previous => previous ?? composeReaderError('Failed to load content', message === 'No network connection' ? message : 'Network error', message === 'No network connection' ? 'This article is not cached on this device' : message))
      }
    } finally {
      releaseArticleAccess()
      if (!controller.signal.aborted && isAccountActive()) setLoading(false)
      if (contentRequest.current === controller) contentRequest.current = null
    }
  }, [runtime, api, cache, repositories, bookmarkId, cacheKey, rssEntryId, navigation, isCollection, collectionOwnerId, fixtureOnly?.network, isAccountActive])
  useEffect(() => {void loadContent(); return () => contentRequest.current?.abort()}, [loadContent])
  useEffect(() => {
    if (!bookmarkId || !policy.showMarks || !policy.showProfile || !repositories || !isAccountActive()) return
    const unknown = marks.some(mark => {const id = String(jsonObject(mark.metadata).user_id ?? ''); return id && id !== currentUserId && !markProfiles.some(profile => profile.uuid === id)})
    if (!unknown) return
    const controller = new AbortController()
    void api.getMarkUsers(bookmarkId, controller.signal).then(profiles => {if (!controller.signal.aborted && isAccountActive()) {setMarkProfiles(profiles); return repositories.local.update(cacheKey, {mark_users: JSON.stringify(profiles)})}}).catch(() => undefined)
    return () => controller.abort()
  }, [api, bookmarkId, cacheKey, marks, markProfiles, repositories, currentUserId, policy.showMarks, policy.showProfile, isAccountActive])
  useEffect(() => {if (!policy.showMarks) {setSelection(null); setPanel(null); setDraft(''); setReply(null)}}, [policy.showMarks])
  useEffect(() => {if ('error' in markDetail && markDetail.error) setOperationError(markDetail.error)}, [markDetail])

  const loadAi = useCallback(async (kind: 'overview' | 'outline', force = false) => {
    if (!bookmarkId || isPreview || !repositories || aiRequests.current.has(kind) || !isAccountActive()) return
    const update = kind === 'overview' ? setOverview : setOutline
    const state = kind === 'overview' ? overview : outline
    if (state.content && !force) return
    const controller = new AbortController(); aiRequests.current.set(kind, controller)
    let content = ''; let takeaways: string[] = []; const processor = new StreamMarkdownProcessor()
    update(previous => ({...previous, busy: true, pending: !previous.content, error: null}))
    try {
      const network = fixtureOnly?.network ?? await getNetworkStateAsync()
      if (controller.signal.aborted || !isAccountActive()) return
      if (!network.isConnected || network.isInternetReachable === false) throw new Error('No network connection')
      let completed = false
      for await (const event of api.streamAi(kind, bookmarkId, controller.signal)) {
        if (controller.signal.aborted || !isAccountActive()) return
        if (event.type === 'error') throw new Error(event.message ?? t('outline_error'))
        if (kind === 'overview' && typeof event.data?.overview === 'string') content += event.data.overview
        if (kind === 'outline' && typeof event.data?.outline === 'string') content = processor.process(event.data.outline)
        if (event.data?.key_takeaways) takeaways = event.data.key_takeaways
        if (event.type === 'done' || event.data?.done) {completed = true; if (kind === 'outline') content = processor.flush()}
        if (!controller.signal.aborted) update({content, takeaways, busy: !completed, pending: !content, error: null})
        if (completed) {
          if (content) await repositories.local.update(cacheKey, kind === 'overview' ? {overview: content, key_takeaways: takeaways.length ? JSON.stringify(takeaways) : null} : {outline: content})
          break
        }
      }
      if (!completed && !controller.signal.aborted) throw new Error(t('outline_error'))
    } catch (error) {if (!controller.signal.aborted && isAccountActive()) update(previous => ({...previous, busy: false, error: error instanceof Error ? error.message : t('outline_error')}))}
    finally {if (aiRequests.current.get(kind) === controller) aiRequests.current.delete(kind)}
  }, [api, bookmarkId, cacheKey, isPreview, repositories, overview, outline, fixtureOnly?.network, isAccountActive])
  useEffect(() => {
    if (!loading && html && !contentError && !isPreview && !aiStarted.current) {aiStarted.current = true; void loadAi('overview'); void loadAi('outline')}
  }, [loading, html, contentError, isPreview, loadAi])
  useEffect(() => {if (subscribed && !isPreview) setOutlineStatus(status => status === 'none' ? 'collapsed' : status)}, [subscribed, isPreview])
  useEffect(() => {
    if (!transcriptVisible) return
    let active = true
    void reader.current?.queryYoutubeTime().then(time => {if (active && isAccountActive()) setYoutubeTime(time)}).catch(fail)
    return () => {active = false; setYoutubeTime(-1)}
  }, [transcriptVisible, isAccountActive])
  useEffect(() => {if (!copied) return; const timer = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(timer)}, [copied])

  const external = (url: string) => {
    if (!/^https?:\/\//i.test(url) || !isAccountActive()) return
    if (fixtureOnly) {fail(new Error('External navigation is unavailable in controlled UI fixtures')); return}
    if (settings[PREFERENCE_KEYS.detailDoNotAlert] === 'true') run(Linking.openURL(url))
    else {setDoNotAlert(false); setExternalUrl(url)}
  }
  const confirmExternal = async () => {
    const url = externalUrl; setExternalUrl(null)
    if (!url || !isAccountActive()) return
    if (fixtureOnly) throw new Error('External navigation is unavailable in controlled UI fixtures')
    if (doNotAlert) await writePreferences(next => {next[PREFERENCE_KEYS.detailDoNotAlert] = 'true'})
    if (mounted.current && isAccountActive()) await Linking.openURL(url)
  }
  const dismissPanel = () => {
    if (draft.trim()) {setDiscard('panel'); return}
    setPanel(null); setReply(null); void clearSelection()
  }
  const copyText = async () => {
    if (!isAccountActive()) return
    const captured = !panel ? await reader.current?.captureSelection() : null
    if (!mounted.current || !isAccountActive()) return
    await Clipboard.setStringAsync(captured?.text || panel?.text || selection?.text || '')
    if (!mounted.current || !isAccountActive()) return
    setCopied(true)
    if (panel) {setPanel(null); setDraft(''); setReply(null)}
    await clearSelection()
  }
  const capturedSelection = async (): Promise<ReaderSelection | null> => panel ? panel.captured ?? selectionForMark(panel.mark, panel.text) : await reader.current?.captureSelection() ?? null
  const highlight = async () => {
    if (!repositories || markBusy || !currentUserId || !isAccountActive()) return
    const selected = panel?.mark ?? selection?.mark
    const removing = Boolean(selected?.stroke.length)
    if (!removing && !policy.allowLine) return
    setMarkBusy(true)
    try {
      if (removing) {
        const record = sourceStrokeToRemove(marks, selected, currentUserId)
        if (record) await repositories.deleteMark(record.id, policy, currentUserId)
      } else {
        const captured = await capturedSelection()
        if (captured?.source.length) await repositories.addMark({bookmarkId, userId: currentUserId, type: 1, source: selectionPaths(captured), approxSource: captured.approx_source, selectContent: captured.select_content, markPolicy: policy})
      }
      if (panel && mounted.current) {setPanel(null); setDraft(''); setReply(null)}
      await clearSelection()
    } finally {if (mounted.current) setMarkBusy(false)}
  }
  const startComment = async () => {
    if (!policy.allowComment || !selection || !isAccountActive()) return
    const captured = await reader.current?.captureSelection()
    if (!captured || !mounted.current || !isAccountActive()) return
    setPanel({mark: {...selection.mark, source: selectionPaths(captured), approx: captured.approx_source}, text: captured.text || selection.text, autoFocus: true, captured})
    setSelection(null)
  }
  const submitComment = async () => {
    if (!repositories || !panel || !draft.trim() || !policy.allowComment || markBusy || !currentUserId || !isAccountActive()) return
    const captured = panel.captured ?? selectionForMark(panel.mark, panel.text)
    const parent = reply ? marks.find(mark => sourceStableId(mark.id) === reply.markId) : null
    const rootId = parent ? String(jsonObject(parent.metadata).root_id || parent.id) : null
    setMarkBusy(true)
    try {
      await repositories.addMark({bookmarkId, userId: currentUserId, type: parent ? 3 : 2, source: selectionPaths(captured), approxSource: captured.approx_source, selectContent: captured.select_content, comment: draft.trim(), parentId: parent?.id, rootId, markPolicy: policy})
      if (mounted.current) {setDraft(''); setReply(null); await clearSelection()}
    } finally {if (mounted.current) setMarkBusy(false)}
  }
  const event = (event: ReaderEvent, pageId: string) => {
    const active = isAccountActive(), inputCode = readerInputEventCode(event.type)
    if (inputCode && (upgradeReaderObserver || controlledFixture)) observeReader({type: 'input', event: {pageId, stage: 'screen', eventCode: inputCode, markValid: 'mark' in event && event.mark !== null, accountActive: active}})
    if (!active) return
    // Source RSS has no BookmarkDetailViewModel or application annotation controls.
    if (isPreview && (event.type === 'textSelected' || event.type === 'textDeselected' || event.type === 'markClicked' || event.type === 'markItemInfosChanged' || event.type === 'selectionError')) return
    if (event.type === 'textSelected') {setSelection({mark: event.mark, text: event.text, y: event.containerYPoints ?? -1})}
    else if (event.type === 'textDeselected') setSelection(null)
    else if (event.type === 'markClicked' && event.mark) {setSelection(null); setPanel({mark: event.mark, text: event.text, autoFocus: false})}
    else if (event.type === 'markItemInfosChanged') {
      setPanel(previous => previous ? {...previous, mark: event.marks.find(mark => mark.id === previous.mark.id) ?? {...previous.mark, stroke: [], comments: []}} : null)
      setSelection(previous => previous ? {...previous, mark: event.marks.find(mark => mark.id === previous.mark.id) ?? previous.mark} : null)
    } else if (event.type === 'imageClick') {
      if (isPreview && !rssImageUrl(event.src)) return
      const images = (event.allImages.length ? event.allImages : [event.src]).filter(url => !isPreview || rssImageUrl(url))
      void clearSelection(); setGallery({images, index: Math.max(0, images.indexOf(event.src))})
    }
    else if (event.type === 'tap' && !scrollInfo.current.nearBottom && scrollInfo.current.position > 10) setToolbarIsVisible(value => !value)
    else if (event.type === 'refreshContent') void loadContent(true)
    else if (event.type === 'feedback') navigation.navigate('Feedback', {bookmarkId, title, targetUrl: originalUrl, entryPoint: 'detail_error', type: 'parse_error'})
    else if (event.type === 'selectionError') fail(new Error(event.error))
  }
  const toggleBookmark = (field: 'isStarred' | 'archiveStatus') => {
    if (!record || isCollection || !repositories || !isAccountActive()) return
    telemetry.element(field === 'isStarred' ? 'bookmark_star_button' : 'bookmark_archive_button', 'detail')
    telemetry.firebase('bookmark', field === 'isStarred' ? 'star' : 'archive', {source: 'detail', [field === 'isStarred' ? 'is_starred' : 'is_archived']: field === 'isStarred' ? record[field] ? 'unstar' : 'star' : record[field] ? 'unarchive' : 'archive'})
    void clearSelection(); run(repositories.updateBookmark(bookmarkId, {[field]: record[field] ? 0 : 1}))
  }
  const openOutline = () => {
    if (!isAccountActive()) return
    void clearSelection(); telemetry.element('detail_outline_button', 'detail'); telemetry.firebase('bookmark', 'use_outline', {is_subscribed: subscribed})
    if (!subscribed) {
      if (config.platform === 'ios') {telemetry.firebase('subscription', 'view', {source: 'dialog'}); navigation.navigate('Subscription')}
      else setOverlay('subscription')
      return
    }
    setOutlineStatus('expanded'); void api.sendMetrics('ai_summary'); void loadAi('outline')
  }
  const expandOutline = () => {if (!isAccountActive()) return; void clearSelection(); telemetry.firebase('outline', 'interact', {}, outlineStatus === 'collapsed' ? 'expand' : 'open'); setOutlineStatus('expanded')}
  const shareBookmark = async () => {
    if (!isAccountActive()) return
    if (fixtureOnly) throw new Error('Native sharing requires separate device acceptance outside controlled UI fixtures')
    const url = `${config.webUrl}/b/${encodeURIComponent(bookmarkId)}`
    const images = await reader.current?.queryImageUrls().catch(() => []) ?? []
    const image = await readerShareImage(config.platform, images, cache, cacheKey, {allowNetwork: !fixtureOnly, isActive: isAccountActive})
    if (!mounted.current || !isAccountActive()) return
    await shareArticle(image, title, title.trim() ? `${title}\n${url}` : url, url)
    if (mounted.current && isAccountActive()) telemetry.firebase('bookmark', 'share')
  }
  const showToolbar = useCallback(() => {if (isPreview || !isAccountActive()) return; void clearSelection(); telemetry.element('detail_toolbar_open', 'detail'); telemetry.firebase('bookmark', 'use_toolbar_menu'); setOverlay('toolbar')}, [isPreview, isAccountActive, clearSelection, telemetry])
  const headerMore = useCallback(() => <Animated.View pointerEvents={toolbarIsVisible ? 'auto' : 'none'} accessibilityElementsHidden={!toolbarIsVisible}
    importantForAccessibility={toolbarIsVisible ? 'auto' : 'no-hide-descendants'} style={{transform: [{translateY: headerMoreOffset}]}}>
    <Pressable testID="reader-header-more" accessibilityRole="button" accessibilityLabel={t('detail_toolbar_share')} onPress={showToolbar}
      style={({pressed}) => ({width: 48, height: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: pressed ? .5 : 1})}><SourceIcon name="ic_floating_panel_more" size={24} /></Pressable>
  </Animated.View>, [headerMoreOffset, toolbarIsVisible, showToolbar, t])
  useLayoutEffect(() => navigation.setOptions({title: '', headerShadowVisible: false, headerTransparent: true,
    headerStyle: {backgroundColor: 'transparent'},
    headerRight: isPreview ? undefined : headerMore,
    unstable_headerRightItems: isPreview ? undefined : () => [{type: 'custom', element: headerMore(), hidesSharedBackground: true}],
  }), [navigation, headerMore, isPreview])
  const openOriginal = () => {if (!isAccountActive()) return; if (!isPreview) telemetry.firebase('bookmark', 'view', {}, 'original'); external(originalUrl)}
  const closeOverview = () => {if (!isAccountActive()) return; telemetry.firebase('bookmark', 'overview_interact', {}, 'close'); setOverlay(null)}
  const showOverview = () => {if (!isAccountActive()) return; telemetry.firebase('bookmark', 'overview_interact', {}, 'open'); setOverlay('overview'); void api.sendMetrics('ai_overview'); void loadAi('overview')}
  const deleteBookmark = async () => {
    if (isCollection || !repositories || !isAccountActive()) return
    try {await repositories.deleteBookmark(bookmarkId); if (mounted.current && isAccountActive()) {telemetry.firebase('bookmark', 'delete'); navigation.goBack()}}
    catch (error) {if (isAccountActive()) telemetry.firebase('bookmark', 'delete_failed'); throw error}
  }
  const action = (id: string) => {
    if (!isAccountActive()) return
    setOverlay(null)
    if (id === 'star') toggleBookmark('isStarred')
    else if (id === 'archive') toggleBookmark('archiveStatus')
    else if (id === 'outline') openOutline()
    else if (id === 'transcript') setTranscriptVisible(true)
    else if (id === 'edit') {telemetry.element('bookmark_edit_title_button', 'detail'); setDraftTitle(title.replace(/\s+/g, ' ').trim()); setOverlay('edit')}
    else if (id === 'delete') {telemetry.element('bookmark_delete_button', 'detail'); setOverlay('delete')}
    else if (id === 'feedback') {telemetry.element('detail_feedback_button', 'detail'); navigation.navigate('Feedback', {bookmarkId, title, targetUrl: originalUrl, entryPoint: 'bookmark_detail', type: 'parse_error'})}
    else if (id === 'share') {
      telemetry.element('detail_share_button', 'detail'); run(shareBookmark())
    }
  }
  const saveRss = async () => {
    if (!rssEntryId || loading || rss?.bookmark_user_uuid || !rss?.article_url || !isAccountActive()) return
    setLoading(true); setRssError(null)
    try {const saved = await api.rssSave(rssEntryId); if (!mounted.current || !isAccountActive()) return; reportRssSaved(rssEntryId, saved.bookmark_user_uuid, rss?.article_url); setRss(previous => previous ? {...previous, bookmark_user_uuid: saved.bookmark_user_uuid} : null); setLoading(false)}
    catch (error) {if (mounted.current && isAccountActive()) {setRssError(rssReaderErrorCode(error)); setLoading(false)}}
  }
  const resolveGalleryUri = useCallback((uri: string) => cache?.getResourceUri(cacheKey, uri) ?? Promise.resolve(null), [cache, cacheKey])
  const retryNative = async () => {
    if (!isAccountActive()) return
    const next = await recovery.retry(async () => {await reader.current?.flushPosition('document-change').catch(fail)}, () => scrollInfo.current.position)
    if (next && mounted.current && isAccountActive()) {setInitialPosition(next.position); setReaderGeneration(next.generation); setNativeFailure(null)}
  }
  useEffect(() => {
    if (!__DEV__ || !fixtureOnly) return
    return fixtureActions.subscribe('reader', async action => {
      if (action.kind === 'selection') {
        if (!reader.current || !Array.isArray(action.source)) throw new Error('Fixture reader selection is not ready')
        await reader.current.prepareFixture({kind: 'selection', source: action.source as Extract<ReaderFixtureCommand, {kind: 'selection'}>['source'], ...(typeof action.selectedText === 'string' ? {selectedText: action.selectedText} : {})})
      } else if (action.kind === 'open-comment') {
        if (!reader.current || typeof action.markId !== 'string') throw new Error('Fixture reader mark is not ready')
        await reader.current.prepareFixture({kind: 'open-comment', markId: sourceStableId(action.markId)})
      } else if (action.kind === 'open-image') {
        if (!reader.current || typeof action.imageId !== 'string') throw new Error('Fixture reader image is not ready')
        await reader.current.prepareFixture({kind: 'open-image', imageId: action.imageId})
      } else if (action.kind === 'scroll') {
        if (!reader.current || typeof action.target !== 'string' || !action.target.startsWith('#') || !await reader.current.scrollToAnchor(action.target.slice(1))) throw new Error('Fixture reader anchor did not resolve')
      } else if (action.kind === 'open-overview') showOverview()
      else if (action.kind === 'open-outline') openOutline()
      else if (action.kind === 'generate-overview') await loadAi('overview', true)
      else if (action.kind === 'generate-outline') await loadAi('outline', true)
      else if (action.kind === 'open-transcript') setTranscriptVisible(true)
      else if (action.kind === 'tap-cue') {
        if (!reader.current || typeof action.seconds !== 'number' || await reader.current.queryYoutubeTime() < 0) throw new Error('A prepared YouTube player is required for fixture cue playback')
        setTranscriptVisible(false); await reader.current.seekYoutube(action.seconds)
      } else if (action.kind === 'save-rss') await saveRss()
      else if (action.kind === 'background-flush') {await reader.current?.flushPosition('background'); await outlineWriter.flush('background')}
      else if (action.kind === 'inspect-position') {
        if (!reader.current || !fixtureOnly.dataDirectory.includes('/slax-ui-fixtures/')) throw new Error('Fixture reader is not ready')
        const marker = JSON.parse(await new File(fixtureOnly.dataDirectory, 'slax-fixture.json').text())
        if (marker.controlledFixture !== true || marker.fixtureVersion !== 1) throw new Error('Fixture position scope is not controlled')
        new File(fixtureOnly.dataDirectory, 'reader-position.json').write(JSON.stringify({controlledFixture: true, fixtureVersion: 1, cacheKey, ...reader.current.inspectFixturePosition()}))
      } else if (action.kind === 'inspect-selection') {
        if (!reader.current || !fixtureOnly.dataDirectory.includes('/slax-ui-fixtures/')) throw new Error('Fixture reader is not ready')
        const marker = JSON.parse(await new File(fixtureOnly.dataDirectory, 'slax-fixture.json').text())
        if (marker.controlledFixture !== true || marker.fixtureVersion !== 1) throw new Error('Fixture selection scope is not controlled')
        const monitor = await reader.current.prepareFixture({kind: 'inspect-selection'})
        const captured = await reader.current.captureSelection()
        new File(fixtureOnly.dataDirectory, 'reader-selection.json').write(JSON.stringify({controlledFixture: true, fixtureVersion: 1, cacheKey,
          applicationSelection: selection ? {containerYPoints: selection.y, textLength: selection.text.length} : null,
          monitor,
          captured: captured ? {textLength: captured.text.length, paths: captured.source.length} : null,
          position: reader.current.inspectFixturePosition()}))
      }
      else return false
      return true
    })
  })
  const saveButton = <Pressable onPress={() => run(saveRss())} accessibilityRole="button" accessibilityState={{disabled: loading || Boolean(rss?.bookmark_user_uuid) || !rss?.article_url}} disabled={loading || Boolean(rss?.bookmark_user_uuid) || !rss?.article_url} testID="reader-rss-save" style={[styles.rssSave, {backgroundColor: loading || rss?.bookmark_user_uuid || !rss?.article_url ? '#F3EAE0' : C.rssAccent}]}>
    {loading ? <ActivityIndicator size="small" color={C.rssAccent} /> : <SourceIcon name={rss?.bookmark_user_uuid ? 'ic_xs_tick_gray_outline_icon' : 'ic_rss_save'} size={14} style={{tintColor: rss?.bookmark_user_uuid || !rss?.article_url ? C.rssAccent : '#FFFFFF'}} />}
    <SourceText style={{fontSize: 13, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1, color: loading || rss?.bookmark_user_uuid || !rss?.article_url ? C.rssAccent : '#FFFFFF'}}>{t(rss?.bookmark_user_uuid ? 'rss_saved' : 'rss_save')}</SourceText>
  </Pressable>
  const header = isPreview ? <View style={[styles.rssHeader, {paddingTop: safeArea.top + 52}]} testID="reader-rss-header">
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}><SourceIcon name="ic_rss" size={16} /><SourceText style={{fontSize: 12, lineHeight: undefined, color: '#777777'}}>{rss?.source_title}</SourceText></View>
    <SourceText style={{fontSize: 22, lineHeight: 32, fontWeight: '600'}}>{rss?.title}</SourceText>
    <SourceText style={{fontSize: 12, lineHeight: undefined, color: C.mutedText}}>{[rss?.author?.trim(), sourceDisplayTime(rss?.published_at ?? rss?.first_seen_at)].filter(Boolean).join(' · ')}</SourceText>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}><View style={{flex: 1}}>{saveButton}</View><Pressable onPress={() => external(originalUrl)} disabled={!originalUrl} style={styles.rssOriginal} accessibilityRole="button"><SourceText style={{fontSize: 13, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1, color: '#555555'}}>{t('rss_original')}</SourceText></Pressable></View>
    {rssError ? <SourceText testID="reader-rss-error" style={{fontSize: 12, lineHeight: undefined, color: '#B3261E'}}>{t(`rss_error_${rssError}`)}</SourceText> : null}
    {rss?.content_truncated ? <SourceText style={{fontSize: 12, lineHeight: undefined, color: C.mutedText}}>{t('rss_truncated')}</SourceText> : null}
  </View> : <View style={[styles.header, {paddingTop: safeArea.top + 44}]} testID="reader-article-header">
    <SourceText numberOfLines={3} style={T.detailTitle}>{title}</SourceText>
    <View style={styles.metadata}><SourceText style={[T.metadata, {color: C.mutedText}]}>{sourceDisplayTime(record?.createdAt)}</SourceText>
      <Pressable onPress={openOriginal} accessibilityRole="link"><SourceText style={[T.metadata, {color: C.link, marginLeft: 16}]}>{t('detail_view_original')}</SourceText></Pressable></View>
    {isPreview ? <View style={{marginTop: 12}}><SourceText style={[T.helper, {color: C.mutedText}]}>{t('rss_feed_content')}</SourceText>{rss?.content_truncated ? <SourceText style={[T.helper, {color: C.mutedText}]}>{t('rss_truncated')}</SourceText> : null}</View> : null}
    {!isCollection && !isPreview ? <View style={styles.tags}>{selectedTags.map(tag => <View testID="tag_item" style={styles.tag} key={tag.id}><SourceText style={{fontSize: 12, lineHeight: 18, color: '#A68F5B'}}>{tag.tag_name}</SourceText></View>)}
      <Pressable accessibilityRole="button" accessibilityLabel={t('tags_title')} onPress={() => {telemetry.firebase('bookmark', 'use_tag'); setOverlay('tags')}} style={[styles.tag, {width: 21, height: 21, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center'}]}><SourceIcon name="ic_xs_yellow_plus" size={8} /></Pressable></View> : null}
    {!isPreview ? <OverviewExcerpt content={overview.content} prefix={t('overview_prefix')} onPress={showOverview} /> : null}
  </View>

  return <View style={styles.root} testID="reader-screen" onLayout={event => setContainerHeight(event.nativeEvent.layout.height)}>
    {html !== null && transitionSettled ? <ReaderWebView key={`${cacheKey}:${readerGeneration}`} ref={reader} cacheKey={cacheKey} resourceOwner={resourceOwnerAtMount} cacheDirectory={fixtureOnly?.dataDirectory} html={html} baseUrl={config.webUrl} currentUserId={stableUserId} marks={markDetail} initialPosition={initialPosition} infoPack={infoPack} header={header} headerSafeAreaPoints={isIos ? safeArea.top : 0} rewriteImageTransports={!isPreview || Boolean(__DEV__ && fixtureOnly)} footerOnlyForLongDocument
      nativeAdapter={readerNativeAdapter} commentPanelVisible={Boolean(panel)} onEvent={event} onError={fail} onExternalUrl={external}
      footer={isPreview ? <View style={{paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 + safeArea.bottom}}><View style={{height: 0.5, backgroundColor: '#E9E5DF', marginBottom: 20}} />{saveButton}</View> : undefined}
      onPositionChange={(position, nearBottom) => {if (isAccountActive()) {scrollInfo.current = {position, nearBottom}; setToolbarIsVisible(toolbarVisible(position, nearBottom))}}}
      onFixtureLifecycle={controlledFixture ? recordFixtureLifecycle : undefined}
      onObservation={upgradeReaderObserver || controlledFixture ? observeReader : undefined}
      onPositionFlush={async (position, reason, pageId) => {
        if (isPreview || !isAccountActive() || !repositories) return
        await repositories.local.update(cacheKey, {read_position: String(position)})
        if (upgradeReaderObserver && isAccountActive()) {
          try {
            const row = await repositories.local.read(cacheKey)
            // Read the real committed value and page identity without enabling
            // fixture branches or changing the original installation's document.
            if (pageId && isAccountActive()) upgradeReaderObserver({type: 'position-persisted', pageId, reason, requestedPixels: position,
              persistedPixels: typeof row.read_position === 'string' && Number.isFinite(Number(row.read_position)) ? Number(row.read_position) : null,
              cacheKey, routeKey: route.key, observedAt: Date.now()})
          } catch { /* The committed write is independent of its observer. */ }
        }
        if (controlledFixture && isAccountActive()) {
          // Read back the committed real SQLite value; observations never alter the write.
          try {
            const row = await repositories.local.read(cacheKey)
            const pages = fixtureLifecycle.current.filter(event => event.kind === 'mount')
            const page = pages[pages.length - 1]
            if (page) recordFixtureLifecycle({kind: 'position-persisted', pageId: page.pageId, reason, requestedPixels: position,
              persistedPixels: typeof row.read_position === 'string' && Number.isFinite(Number(row.read_position)) ? Number(row.read_position) : null})
          } catch { /* A rejected fixture observation does not change the committed position. */ }
        }
      }}
    /> : isPreview ? <View testID="reader-rss-loading-or-error" style={styles.center}>{loading ? <ActivityIndicator color={C.rssAccent} /> : <><SourceText>{t(`rss_error_${rssError ?? 'source_unavailable'}`)}</SourceText><TextAction label={t('rss_retry')} onPress={() => void loadContent()} /></>}</View> : loading || !transitionSettled ? <ReaderSkeleton topSpacer={safeArea.top + 44} /> : <View style={styles.center}><SourceText>{t('load_bookmark_content_error')}</SourceText><TextAction label={t('rss_retry')} onPress={() => void loadContent()} /></View>}
    {contentError ? <View style={styles.errorBanner}><SourceText style={[T.helper, {flex: 1}]}>{contentError}</SourceText><TextAction label={t('rss_retry')} onPress={() => void loadContent(true)} /></View> : null}
    {nativeFailure ? <View testID="reader-native-retry" style={styles.errorBanner}><SourceText style={[T.helper, {flex: 1}]}>{nativeFailure}</SourceText><TextAction label={t('rss_retry')} onPress={() => run(retryNative())} /></View> : null}
    {!isPreview ? <FloatingActions visible={toolbarIsVisible && !panel} isCollection={isCollection} starred={Boolean(record?.isStarred)} archived={Boolean(record?.archiveStatus)} outlineCollapsed={outlineStatus === 'collapsed'} t={t} onStar={() => toggleBookmark('isStarred')} onArchive={() => toggleBookmark('archiveStatus')} onMore={showToolbar} onOutline={expandOutline} /> : null}
    {!isPreview && selection && !panel ? <SelectionMenu y={selection.y} height={containerHeight} minTop={isIos ? safeArea.top + 20 : 60} hasStroke={Boolean(selection.mark.stroke.length)} allowLine={policy.allowLine} allowComment={policy.allowComment} t={t} onCopy={() => run(copyText())} onHighlight={() => run(highlight())} onComment={() => run(startComment())} /> : null}
    <ReaderToolbar visible={!isPreview && overlay === 'toolbar'} collection={isCollection} youtube={Boolean(html?.includes('<youtube-player'))} starred={Boolean(record?.isStarred)} archived={Boolean(record?.archiveStatus)} t={t} onDismiss={() => setOverlay(null)} onAction={action} />
    <CommentPanel visible={Boolean(panel)} mark={panel?.mark ?? null} text={panel?.text ?? ''} draft={draft} reply={reply} currentUserAvatar={String(user.picture ?? '')} hideProfiles={!policy.showProfile} allowLine={policy.allowLine} allowComment={policy.allowComment} autoFocus={panel?.autoFocus ?? false} busy={markBusy} t={t}
      onDraft={setDraft} onClose={dismissPanel} onCopy={() => run(copyText())} onHighlight={() => run(highlight())} onReply={value => {setReply(value); setDraft('')}} onDelete={setDeletingComment} canDelete={comment => Boolean(currentUserId) && (!isCollection || comment.userId === stableUserId)} onSubmit={() => run(submitComment())} />
    <OutlineSheet visible={outlineStatus === 'expanded'} markdown={outline.content} pending={outline.pending} busy={outline.busy} error={outline.error} position={outlinePosition} t={t} onClose={() => {telemetry.firebase('outline', 'interact', {}, 'close'); setOutlineStatus('hidden'); void clearSelection(); run(outlineWriter.flush('background'))}} onCollapse={() => {telemetry.firebase('outline', 'interact', {}, 'collapse'); setOutlineStatus('collapsed'); run(outlineWriter.flush('background'))}} onRetry={() => void loadAi('outline', true)} onPosition={position => {setOutlinePosition(position); outlineWriter.update(position)}} onLink={href => {if (href.startsWith('#')) {setOutlineStatus('collapsed'); run(reader.current?.scrollToAnchor(href.slice(1)))} }} />
    <TranscriptSheet visible={transcriptVisible} cues={cues} currentTime={youtubeTime} t={t} onClose={() => setTranscriptVisible(false)} onSeek={seconds => {setTranscriptVisible(false); run(reader.current?.seekYoutube(seconds))}} />
    {gallery ? <ImageGallery errorLabel={t('rss_image_failed')} images={gallery.images} index={gallery.index} resolveUri={resolveGalleryUri} allowNetworkFallback={!fixtureOnly} onDismiss={() => setGallery(null)} /> : null}
    <OverviewDialog visible={overlay === 'overview'} content={overview.content} takeaways={overview.takeaways} title={t('overview_dialog_title')} closeLabel={t('btn_close')} onClose={closeOverview} />
    <SourceDialog visible={overlay === 'edit'} onDismiss={() => setOverlay(null)} title={t('edit_title_dialog_title')} actions={<><TextAction label={t('btn_cancel')} onPress={() => setOverlay(null)} /><TextAction label={t('btn_confirm')} disabled={!draftTitle.trim()} onPress={() => {if (!isCollection && isAccountActive()) run(repositories?.updateBookmark(bookmarkId, {aliasTitle: draftTitle.replace(/\s+/g, ' ').trim()})); setOverlay(null)}} /></>}><TextInput value={draftTitle} onChangeText={setDraftTitle} multiline autoFocus style={styles.textInput} /></SourceDialog>
    <SourceDialog visible={overlay === 'delete'} onDismiss={() => setOverlay(null)} title={t('bookmark_delete_confirm_title')} actions={<><TextAction label={t('btn_cancel')} onPress={() => setOverlay(null)} /><TextAction color={C.danger} label={t('btn_confirm')} onPress={() => {setOverlay(null); run(deleteBookmark())}} /></>}><SourceText>{t('bookmark_delete_confirm_message')}</SourceText></SourceDialog>
    <SourceDialog visible={overlay === 'subscription'} onDismiss={() => setOverlay(null)} title={t('subscription_required_title')} actions={<TextAction label={t('subscription_required_btn_ok')} onPress={() => setOverlay(null)} />}><SourceText>{t('subscription_required_message')}</SourceText></SourceDialog>
    <ReaderTagSheet visible={overlay === 'tags'} tags={tags} remoteIds={selectedTagIds} t={t} onDismiss={() => setOverlay(null)} onError={fail}
      onConfirm={ids => {if (!isCollection && isAccountActive()) run(repositories?.updateTags(bookmarkId, ids)); telemetry.firebase('bookmark', 'tag_update', {}, 'add'); setOverlay(null)}}
      onCreate={async name => {if (!repositories || isCollection || !isAccountActive()) throw new Error('Tag creation is not allowed'); return repositories.createTag(name)}} />
    <SourceDialog visible={externalUrl !== null} onDismiss={() => setExternalUrl(null)} title={t('external_link_alert_title')} actions={<><TextAction label={t('btn_cancel')} onPress={() => setExternalUrl(null)} /><TextAction label={t('btn_confirm')} onPress={() => run(confirmExternal())} /></>}><SourceText>{t('external_link_alert_message')}</SourceText><Pressable accessibilityRole="checkbox" accessibilityState={{checked: doNotAlert}} onPress={() => setDoNotAlert(value => !value)} style={{flexDirection: 'row', alignItems: 'center', marginTop: 12}}><SourceIcon name={doNotAlert ? 'ic_agree_enable' : 'ic_agree_disable'} size={16} /><SourceText style={T.helper}>{t('external_link_do_not_alert')}</SourceText></Pressable></SourceDialog>
    <SourceDialog visible={discard !== null} onDismiss={() => setDiscard(null)} title={t('comment_panel_discard_title')} actions={<><TextAction label={t('comment_panel_discard_cancel')} onPress={() => setDiscard(null)} /><TextAction label={t('comment_panel_discard_confirm')} onPress={() => {setDiscard(null); setDraft(''); setReply(null); setPanel(null); void clearSelection()}} /></>}><SourceText>{t('comment_panel_discard_message')}</SourceText></SourceDialog>
    <SourceDialog visible={deletingComment !== null} onDismiss={() => setDeletingComment(null)} title={t('comment_panel_confirm_delete')} actions={<><TextAction label={t('btn_cancel')} onPress={() => setDeletingComment(null)} /><TextAction label={t('comment_panel_delete')} color={C.danger} onPress={() => {const comment = deletingComment; setDeletingComment(null); const record = marks.find(mark => comment && sourceStableId(mark.id) === comment.markId); if (record && isAccountActive()) run(repositories?.deleteMark(record.id, policy, currentUserId))}} /></>} />
    <SourceDialog visible={operationError !== null} onDismiss={() => setOperationError(null)} title={t('load_bookmark_content_error')} actions={<TextAction label={t('btn_ok')} onPress={() => setOperationError(null)} />}><SourceText>{operationError}</SourceText></SourceDialog>
    {copied ? <View pointerEvents="none" style={styles.copyToast}><SourceText style={[T.helper, {color: C.surface}]}>{t('comment_panel_copied')}</SourceText></View> : null}
  </View>
}

const styles = StyleSheet.create({root: {flex: 1, backgroundColor: C.readerBackground}, header: {paddingHorizontal: 20, paddingBottom: 24}, rssHeader: {paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, gap: 12}, rssSave: {minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 12}, rssOriginal: {flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#6A6E8333', alignItems: 'center', justifyContent: 'center'}, metadata: {flexDirection: 'row', alignItems: 'center', marginTop: 12}, tags: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16}, tag: {borderWidth: 1, borderColor: C.tagBorder, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 1}, overview: {marginTop: 20, backgroundColor: C.background, borderRadius: 8, padding: 12}, center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20}, textInput: {fontSize: 16, lineHeight: 24, color: C.bodyText, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 12}, errorBanner: {position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: C.background, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center'}, copyToast: {position: 'absolute', top: 120, alignSelf: 'center', backgroundColor: C.bodyText, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10}})
