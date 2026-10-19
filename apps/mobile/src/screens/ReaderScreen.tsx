import React, {useCallback, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {Platform, StyleSheet, View} from 'react-native'
import {useSafeAreaInsets} from 'react-native-safe-area-context'
import {SourceText} from '../components'
import {bookmarkCacheKey, type PreferenceValues} from '../data'
import type {MobileScreenProps} from '../navigation/types'
import {useReadingMobile, useControlledUpgradeReaderObserver} from '../runtime'
import {mobileColors as C, mobileTypography as T} from '../theme'
import {readerNativeAdapter} from '../native/reader'
import {useTelemetry} from '../telemetry'
import type {ReaderEvent} from '../reader'
import {FloatingActions, ImageActionNotice, ImageActionSheet, ReaderToolbar, SelectionMenu, TranscriptSheet} from '../reader/ReaderOverlays'
import {imageActionPort} from '../native/image-actions'
import type {ImageActionSurface} from '../reader/state/useImageActions'
import {ImageGallery} from '../reader/ImageGallery'
import {ReaderAiOutline, ReaderAiOverview, ReaderAiExcerpt, ReaderCommentPanel} from '../reader/components/ReaderFeatureViews'
import {ReaderTagSheet} from '../reader/TagSheet'
import {sourceStableId} from '../reader/model'
import {readerAccountActive, updateReaderPreferences} from '../reader/account'
import {ReaderHeader, ReaderHeaderMore, RssReaderHeader, RssSaveButton} from '../reader/components/ReaderHeader'
import {PdfNotesSheet} from '../reader/components/PdfNotesSheet'
import {ReaderDialogs} from '../reader/components/ReaderDialogs'
import {ReaderContent} from '../reader/components/ReaderContent'
import {useReaderLifecycle} from '../reader/state/useReaderLifecycle'
import {useReaderBookmark, readerPresentationIdentity} from '../reader/state/useReaderBookmark'
import {useReaderDocument} from '../reader/state/useReaderDocument'
import {useReaderAnnotations} from '../reader/state/useReaderAnnotations'
import {useReaderAi} from '../reader/state/useReaderAi'
import {useReaderInteractions} from '../reader/state/useReaderInteractions'
import {useReaderDiagnostics} from '../reader/diagnostics/useReaderDiagnostics'
import type {ReaderDocumentTransitions} from '../reader/state/types'

/** Identity-stable wrapper that always calls the latest render's handler, so memoized hosts are not rerendered by new closures. */
function useEvent<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const latest = useRef(handler); latest.current = handler
  return useCallback((...args: A) => latest.current(...args), [])
}

export function ReaderScreen({navigation, route}: MobileScreenProps<'Reader'>) {
  const {runtime, api, repositories, cache, preferences, settings, session, sessions, t, config, fixtureOnly, nativeResourceOwner} = useReadingMobile()
  const observer = useControlledUpgradeReaderObserver(), safeArea = useSafeAreaInsets(), telemetry = useTelemetry()
  const isIos = Platform.OS === 'ios', controlledFixture = Boolean(__DEV__ && fixtureOnly)
  const resourceOwnerAtMount = useRef(nativeResourceOwner).current
  const {bookmarkId, collectionOwnerId, collectionId, rssEntryId} = route.params
  const cacheKey = rssEntryId ? `rss-${rssEntryId}` : bookmarkCacheKey(bookmarkId, collectionOwnerId)
  const currentUserId = session.status === 'authenticated' ? session.session.userId : ''
  const isAccountActive = useCallback(() => readerAccountActive(sessions.getSnapshot(), currentUserId, controlledFixture ? undefined : {owner: resourceOwnerAtMount, currentOwner: runtime.getNativeResourceOwner()}), [sessions, currentUserId, controlledFixture, resourceOwnerAtMount, runtime])
  const writePreferences = useCallback((edit: (values: PreferenceValues) => void) => updateReaderPreferences(preferences, currentUserId, sessions.getSnapshot, edit, isAccountActive), [preferences, sessions, currentUserId, isAccountActive])
  const identity = {...route.params, cacheKey, currentUserId, isCollection: Boolean(collectionOwnerId || collectionId), isPreview: Boolean(rssEntryId)}
  const {isCollection, isPreview} = identity
  const stableUserId = sourceStableId(currentUserId), transitions = useRef<ReaderDocumentTransitions | null>(null)
  const selectionCommand = useRef<() => void>(() => {})
  const clearSelection = useCallback(() => selectionCommand.current(), [])
  const subscriptionCommand = useRef<() => void>(() => {})
  const life = useReaderLifecycle(identity, {navigation, routeKey: route.key, t, isAccountActive, writePreferences})
  const scope = {...identity, mounted: life.mounted, foreground: life.foreground, appActive: life.appActive, routeVisible: life.routeVisible, transitionReady: life.transitionReady, reader: life.reader, isAccountActive, fail: life.fail, t}
  const {reader, appActive, fail} = life
  useLayoutEffect(() => {
    if (!isAccountActive()) return
    return runtime.beginArticleAccess(cacheKey)
  }, [runtime, cacheKey, isAccountActive])
  const run = (work: Promise<unknown> | undefined) => {void work?.catch(fail)}
  const bookmark = useReaderBookmark(scope, {repositories, cache, config, fixtureOnly: Boolean(fixtureOnly), telemetry, clearSelection, goBack: () => navigation.goBack()})
  const document = useReaderDocument(scope, {runtime, api, repositories, cache, fixtureOnly, nativeResourceOwner, resourceOwnerAtMount, stableUserId, record: bookmark.record, transitions})
  const presentation = readerPresentationIdentity(bookmark.record, {pdf: document.pdf, rss: document.rss, isPreview, routeTitle: route.params.title, t})
  const {title, originalUrl, isPdf} = presentation
  const annotations = useReaderAnnotations(scope, {repositories, api, policy: bookmark.policy, user: bookmark.user, documentReady: document.documentReady, isPdf, pdfSnapshot: document.pdfSnapshot})
  const ai = useReaderAi(scope, {api, local: repositories?.local, network: fixtureOnly?.network, subscribed: bookmark.subscribed, platform: config.platform, telemetry, clearSelection, subscription: () => subscriptionCommand.current(), document})
  const interactions = useReaderInteractions(scope, {isIos, nativeResourceOwner, fixtureOnly: Boolean(fixtureOnly), settings, writePreferences, cache, telemetry, api,
    document, annotations, bookmark, ai, presentation, operationError: life.operationError, clearError: life.clearError,
    feedback: entryPoint => navigation.navigate('Feedback', {bookmarkId, title, targetUrl: originalUrl, entryPoint, type: 'parse_error'}), imageActions: imageActionPort})
  selectionCommand.current = () => {void annotations.clearSelection()}
  subscriptionCommand.current = () => {
    if (config.platform === 'ios') {telemetry.firebase('subscription', 'view', {source: 'dialog'}); navigation.navigate('Subscription')}
    else interactions.showSubscription()
  }
  transitions.current = {
    acceptRecord: bookmark.acceptRecord, hydrateProfiles: annotations.hydrateProfiles, hydrateAi: ai.hydrate,
    documentChanged: () => {annotations.documentChanged(); ai.documentChanged()},
    revokeAccess: () => {annotations.revoke(); ai.reset(); interactions.revoke()}, clearSelection,
  }
  life.commands.current = {
    abort: () => {document.abort(); ai.abort(); interactions.cancelPending()}, persist: document.persist,
    background: () => {interactions.cancelPending(); annotations.background()}, flushOutline: ai.flush, nativeFailure: document.handleNativeFailure,
  }
  life.title.current = title
  const diagnostics = useReaderDiagnostics(scope, {fixtureOnly, observer, navigation, routeKey: route.key, local: repositories?.local, selection: annotations.selection,
    showOverview: interactions.showOverview, openOutline: ai.open, loadAi: ai.load, showTranscript: interactions.showTranscript, closeTranscript: interactions.closeTranscript,
    saveRss: document.saveRss, flushOutline: () => ai.flush('background')})
  const event = (value: ReaderEvent, pageId: string) => {diagnostics.event(value, pageId); interactions.handleEvent(value)}
  const headerMore = useCallback(() => <ReaderHeaderMore visibility={interactions.headerMoreVisible} offset={interactions.headerMoreOffset} t={t} onPress={interactions.showToolbar} />,
    [interactions.headerMoreVisible, interactions.headerMoreOffset, interactions.showToolbar, t])
  useLayoutEffect(() => navigation.setOptions({title: '', headerShadowVisible: false, headerTransparent: true,
    headerStyle: {backgroundColor: 'transparent'}, headerRight: isPreview ? undefined : headerMore,
    unstable_headerRightItems: isPreview ? undefined : () => [{type: 'custom', element: headerMore(), hidesSharedBackground: true}],
  }), [navigation, headerMore, isPreview])
  const [containerHeight, setContainerHeight] = useState(1)
  const infoPack = useMemo(() => ({metadataUrl: originalUrl, bookmarkId, platform: config.platform, version: config.version}), [originalUrl, bookmarkId, config.platform, config.version])
  // Header, footer and HTML host callbacks keep their identity across toolbar/selection/panel/AI updates so the
  // memoized HTML document host only rerenders when its document, marks, geometry or header content change.
  // Its live-only callbacks (events, scroll, links) are never invoked after unmount, so they may read the latest render.
  const saveRss = useEvent(() => run(document.saveRss()))
  const openOriginal = useEvent(() => bookmark.openOriginal(originalUrl))
  const showOverview = useEvent(() => interactions.showOverview())
  const showTags = useEvent(() => interactions.showTags())
  const saveButton = useMemo(() => <RssSaveButton loading={document.loading} rss={document.rss} t={t} onSave={saveRss} />, [document.loading, document.rss, t, saveRss])
  const overview = useMemo(() => <ReaderAiExcerpt state={ai.overview} prefix={t('overview_prefix')} onPress={showOverview} />, [ai.overview, t, showOverview])
  const header = useMemo(() => isPreview ? <RssReaderHeader top={safeArea.top} rss={document.rss} error={document.rssError} originalUrl={originalUrl} saveButton={saveButton} t={t} onOriginal={openOriginal} /> :
    <ReaderHeader top={safeArea.top} title={title} record={bookmark.record} pdf={document.pdf} isPdf={isPdf} originalUrl={originalUrl} isCollection={isCollection}
      selectedTags={bookmark.selectedTags} overview={overview} t={t} onOriginal={openOriginal} onTags={showTags} onOverview={showOverview} />,
  [isPreview, safeArea.top, document.rss, document.rssError, originalUrl, saveButton, t, openOriginal, title, bookmark.record, document.pdf, isPdf, isCollection, bookmark.selectedTags, overview, showTags, showOverview])
  const {pdf, html, contentError, documentReady} = document
  const {panel, selection, policy = bookmark.policy} = {...annotations, policy: bookmark.policy}
  const isRouteRemoved = useEvent(() => !navigation.getState().routes.some(value => value.key === route.key))
  const commentPanelVisible = Boolean(panel), headerSafeAreaPoints = isIos ? safeArea.top : 0
  const hostShared = useMemo(() => ({cacheKey, resourceOwner: resourceOwnerAtMount, currentUserId: stableUserId, marks: annotations.markDetail, initialPosition: document.initialPosition,
    header, headerSafeAreaPoints, commentPanelVisible, isRouteRemoved}),
  [cacheKey, resourceOwnerAtMount, stableUserId, annotations.markDetail, document.initialPosition, header, headerSafeAreaPoints, commentPanelVisible, isRouteRemoved])
  const htmlEvent = useEvent(event)
  const htmlExternalUrl = useEvent((url: string) => interactions.external(url))
  const htmlPositionChange = useEvent((position: number, nearBottom: boolean) => interactions.scroll(position, nearBottom))
  const fixtureLifecycle = useEvent((value: Parameters<NonNullable<typeof diagnostics.onFixtureLifecycle>>[0]) => diagnostics.onFixtureLifecycle?.(value))
  const observation = useEvent((value: Parameters<NonNullable<typeof diagnostics.onObservation>>[0]) => diagnostics.onObservation?.(value))
  // A retired document's final flush must keep its own account/document fence, so this is memoized on those inputs only.
  const persistence = useRef({persistHtml: document.persistHtml, positionPersisted: diagnostics.positionPersisted})
  persistence.current = {persistHtml: document.persistHtml, positionPersisted: diagnostics.positionPersisted}
  const htmlPositionFlush = useCallback(async (position: number, reason: Parameters<typeof diagnostics.positionPersisted>[1], pageId: string) => {
    if (isPreview || !isAccountActive() || !repositories) return
    await persistence.current.persistHtml(position); await persistence.current.positionPersisted(position, reason, pageId)
  }, [isPreview, isAccountActive, repositories, cacheKey])
  const reload = useEvent((force?: boolean) => void document.load(force))
  const retryNative = useEvent(() => run(document.retryNative()))
  const images = interactions.imageActions
  const openGalleryImageAction = useCallback((source: string) => images.open(source, 'gallery'), [images.open])
  // Each surface owns its own sheet/notice so a gallery action presents inside the gallery modal.
  const imageActionSheet = (surface: ImageActionSurface) => images.request?.surface === surface ?
    <ImageActionSheet visible={images.visible} t={t} onSave={images.save} onShare={images.share} onCancel={images.cancel} onDidDismiss={images.dismissed} /> : null
  const imageActionNotice = (surface: ImageActionSurface) => images.notice?.surface === surface ? <ImageActionNotice message={t(`image_action_${images.notice.kind}`)} /> : null
  const footer = useMemo(() => isPreview ? <View style={{paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 + safeArea.bottom}}><View style={{height: 0.5, backgroundColor: '#E9E5DF', marginBottom: 20}} />{saveButton}</View> : undefined,
    [isPreview, safeArea.bottom, saveButton])

  return <View style={styles.root} testID="reader-screen" onLayout={event => setContainerHeight(event.nativeEvent.layout.height)}>
    <ReaderContent isPdf={isPdf} isPreview={isPreview} loading={document.loading} html={html} hostKey={`${cacheKey}:${pdf?.document_id ?? ''}:${document.readerGeneration}`}
      top={safeArea.top} title={title} header={header} contentError={contentError} nativeFailure={document.nativeFailure} rssError={document.rssError} t={t}
      reload={reload} retryPdf={document.retryPdf} retryNative={retryNative}
      pdfProps={pdf ? {...hostShared, ref: document.attachPdfHost, style: {flex: 1}, descriptor: pdf, cacheDirectory: fixtureOnly?.pdfNativeOwner ? undefined : fixtureOnly?.dataDirectory,
        readRange: document.readPdfRange, labels: {loading: t('pdf_loading'), error: t('pdf_load_failed'), mark: t('pdf_notes')},
        // PDF callbacks stay per-render closures: each captures its own host lease, which keeps a retired host's late callbacks inert.
        onEvent: (value, pageId) => {if (document.isPdfHostCurrent()) event(value, pageId)},
        onOperationError: error => {if (!document.contentErrorSnapshot.current && document.isPdfHostCurrent()) fail(error)}, onError: document.pdfError,
        onPositionChange: position => {if (document.isPdfHostCurrent()) document.pdfPosition.current = position},
        onScrollMetrics: (position, nearBottom) => {if (document.isPdfHostCurrent()) interactions.scroll(position, nearBottom)}, onPositionFlush: document.persistPdf,
      } : null}
      htmlProps={{...hostShared, ref: reader, cacheDirectory: fixtureOnly?.dataDirectory, html: html ?? '', baseUrl: config.webUrl, infoPack,
        rewriteImageTransports: !isPreview || Boolean(__DEV__ && fixtureOnly), footerOnlyForLongDocument: true, nativeAdapter: readerNativeAdapter,
        onEvent: htmlEvent, onError: fail, onExternalUrl: htmlExternalUrl, onPositionChange: htmlPositionChange, footer,
        onFixtureLifecycle: diagnostics.onFixtureLifecycle ? fixtureLifecycle : undefined, onObservation: diagnostics.onObservation ? observation : undefined,
        onPositionFlush: htmlPositionFlush,
      }} />
    {!isPreview ? <FloatingActions visible={interactions.toolbarIsVisible && !panel} isCollection={isCollection} starred={Boolean(bookmark.record?.isStarred)} archived={Boolean(bookmark.record?.archiveStatus)}
      outlineCollapsed={ai.outlineStatus === 'collapsed'} t={t} onStar={() => bookmark.toggle('isStarred')} onArchive={() => bookmark.toggle('archiveStatus')} onMore={interactions.showToolbar} onOutline={ai.expand} /> : null}
    {!isPreview && selection && !panel ? <SelectionMenu y={selection.y} height={containerHeight} minTop={isIos ? safeArea.top + 20 : 60} hasStroke={Boolean(selection.mark.stroke.length)}
      allowLine={policy.allowLine} allowComment={policy.allowComment} t={t} onCopy={() => run(annotations.copyText())} onHighlight={() => run(annotations.highlight())} onComment={() => run(annotations.startComment())} /> : null}
    <ReaderToolbar key={`reader-toolbar-${interactions.toolbarId}`} visible={!isPreview && interactions.overlay === 'toolbar'} collection={isCollection} youtube={Boolean(html?.includes('<youtube-player'))}
      starred={Boolean(bookmark.record?.isStarred)} archived={Boolean(bookmark.record?.archiveStatus)}
      pdf={isPdf ? {notesEnabled: Boolean(pdf && documentReady && !contentError && policy.showMarks && annotations.pdfMarkInfos.length)} : undefined}
      t={t} onDismiss={interactions.dismissToolbar} onDidDismiss={interactions.toolbarDidDismiss} onAction={interactions.action} />
    <ReaderCommentPanel visible={Boolean(panel)} mark={panel?.mark ?? null} text={panel?.text ?? ''} draftState={annotations.draftState} reply={annotations.reply} currentUserAvatar={String(bookmark.user.picture ?? '')}
      hideProfiles={!policy.showProfile} allowLine={policy.allowLine} allowComment={policy.allowComment} autoFocus={appActive && life.routeVisible && life.transitionReady && (panel?.autoFocus ?? false)} busy={annotations.markBusy}
      menu={appActive && life.routeVisible ? annotations.commentMenu : null} onMenu={annotations.setCommentMenu} t={t} onClose={annotations.dismissPanel}
      onCopy={() => run(annotations.copyText())} onCopyComment={comment => run(annotations.copyComment(comment))} onHighlight={() => run(annotations.highlight())} onReply={annotations.replyTo}
      onDelete={annotations.requestDelete} canDelete={annotations.canDelete} onSubmit={() => run(annotations.submitComment())} />
    <ReaderAiOutline state={ai.outline} status={ai.outlineStatus} toolbarVisible={interactions.toolbarIsVisible && !panel} onExpand={ai.expand}
      position={ai.position.current} t={t} onClose={() => ai.close('hidden')} onCollapse={() => ai.close('collapsed')} onRetry={() => void ai.load('outline', true)} onPosition={ai.updatePosition} onLink={ai.link} />
    <TranscriptSheet visible={interactions.transcriptVisible} cues={interactions.cues} currentTime={interactions.youtubeTime} t={t} onClose={interactions.closeTranscript} onSeek={interactions.seek} />
    {interactions.gallery ? <ImageGallery errorLabel={t('rss_image_failed')} images={interactions.gallery.images} index={interactions.gallery.index} resolveUri={interactions.resolveGalleryUri}
      visible={life.routeVisible && appActive} allowNetworkFallback={!fixtureOnly} isActive={isAccountActive} onDismiss={interactions.closeGallery}
      onImageLongPress={openGalleryImageAction}>{imageActionSheet('gallery')}{imageActionNotice('gallery')}</ImageGallery> : null}
    <PdfNotesSheet visible={isPdf && annotations.pdfNotesVisible && appActive && life.routeVisible && policy.showMarks} marks={annotations.pdfMarkInfos} bottom={safeArea.bottom} t={t} onClose={annotations.closeNotes} onSelect={mark => run(annotations.openNote(mark))} />
    <ReaderAiOverview state={ai.overview} visible={interactions.overlay === 'overview'} isPdf={isPdf} pdfTextMessage={document.pdfTextMessage} loadingLabel={t('pdf_loading')}
      title={t('overview_dialog_title')} closeLabel={t('btn_close')} onClose={interactions.closeOverview} />
    <ReaderTagSheet visible={interactions.overlay === 'tags'} tags={bookmark.tags} remoteIds={bookmark.selectedTagIds} t={t} onDismiss={interactions.closeOverlay} onError={fail}
      onConfirm={ids => {run(bookmark.updateTags(ids)); interactions.closeOverlay()}} onCreate={bookmark.createTag} />
    <ReaderDialogs active={appActive && isAccountActive()} overlay={interactions.overlay} t={t} closeOverlay={interactions.closeOverlay}
      title={{draft: bookmark.draftTitle, change: bookmark.setDraftTitle, confirm: () => {run(bookmark.saveTitle()); interactions.closeOverlay()}}}
      deleteBookmark={() => {interactions.closeOverlay(); run(bookmark.remove())}}
      external={{id: interactions.externalDialogId, visible: interactions.externalUrl !== null, doNotAlert: interactions.doNotAlert, cancel: interactions.cancelExternal, didDismiss: interactions.externalDidDismiss, confirm: () => run(interactions.confirmExternal()), toggleAlert: interactions.toggleAlert}}
      discard={{visible: annotations.discard !== null, cancel: annotations.cancelDiscard, confirm: annotations.discardDraft}}
      comment={{visible: annotations.deletingComment !== null, cancel: annotations.cancelDelete, confirm: () => run(annotations.confirmDelete())}}
      error={{message: life.operationError, close: life.clearError}} />
    {imageActionSheet('document')}{imageActionNotice('document')}
    {annotations.copied ? <View pointerEvents="none" style={styles.copyToast}><SourceText style={[T.helper, {color: C.surface}]}>{t('comment_panel_copied')}</SourceText></View> : null}
  </View>
}
const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: C.readerBackground},
  copyToast: {position: 'absolute', top: 120, alignSelf: 'center', backgroundColor: C.bodyText, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10},
})
