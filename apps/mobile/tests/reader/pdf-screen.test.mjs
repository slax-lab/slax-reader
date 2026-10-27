import test from 'node:test'
import assert from 'node:assert/strict'
import {React, act, nativeBoundary, loadComponent, withNativeHost, withRenderedElement} from './parity-host.mjs'
import {PreferenceStore, PREFERENCE_KEYS} from '../../src/data/preferences.ts'
import {MemoryPreferences} from '../data/helpers.ts'
import * as repositoriesModule from '../../src/data/repositories.ts'
import * as pdfContracts from '@slax-reader/contracts/pdf'
import * as model from '../../src/reader/model.ts'
import * as account from '../../src/reader/account.ts'
import * as input from '../../src/reader/input.ts'
import * as coordinates from '../../src/reader/coordinates.ts'
import {ReaderPositionWriter} from '../../src/reader/position.ts'
import {ReaderCrashRecovery} from '../../src/reader/recovery.ts'
import {mobileColors, mobileTypography} from '../../src/theme/index.ts'
import * as transportErrors from '../../src/data/transport-errors.ts'
import * as pdfErrors from '../../src/reader/pdf-errors.ts'
import {ApiError} from '../../src/data/api.ts'
import * as outlineMotion from '../../src/reader/outline-motion.ts'

const documentId = 'a'.repeat(64), otherDocumentId = 'b'.repeat(64)
const source = [{type: 'pdf', version: 1, document_id: documentId, page: 3, text: 'Exact\n\nPDF text', quads: [[0, 0, 10, 0, 10, 10, 0, 10]]}]
const captured = {source, text: source[0].text, select_content: [{type: 'text', text: source[0].text, src: ''}],
  approx_source: {exact: source[0].text, raw_text: source[0].text, prefix: '', suffix: '', position_start: 0, position_end: source[0].text.length}}
const fresh = {id: '', source, stroke: [], comments: [], approx: captured.approx_source}
const descriptor = {url: '/v1/bookmark/pdf?bookmark_uid=book', document_id: documentId, size: 1000, filename: 'local.pdf', source: 'upload', text_status: 'empty', pages: 10}
const bookmark = {id: 'book', title: '', aliasTitle: '', metadata: '{}', url: 'slax-pdf://upload', contentType: 'pdf'}
const find = (node, predicate) => Array.isArray(node) ? node.map(child => find(child, predicate)).find(Boolean) : React.isValidElement(node) ? predicate(node) ? node : find(node.props.children, predicate) : undefined
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no}); return {promise, resolve, reject}}
const failure = status => Object.assign(new Error(`Denied ${status}`), {name: 'ApiError', status, stage: 'pdf-range'})

async function screenFixture(host, options, run) {
  const nil = () => null, writes = [], markWrites = [], calls = [], copied = [], dialogs = new Map(), listeners = new Map(), appListeners = new Set(), timers = new Map()
  host.native.Platform.OS = options.platform ?? 'ios'
  let timerId = 0, record = options.missingRecord ? null : {...bookmark, ...options.bookmark}, pdf = {...descriptor, ...options.pdf}
  let owner = 'owner', recordChanged, settingsChanged, pdfProps, panelProps, menuProps, outlineProps, overviewProps, floatingProps, toolbarProps, headerOptions, back, capture = captured, metadataFailure = options.metadataFailure, rangeFailure
  let local = {read_position: '999', pdf_read_position: JSON.stringify({document_id: documentId, position: 3.25}), ...options.local}
  let session = {status: 'authenticated', session: {userId: 'user', token: 'synthetic', refreshedAt: 0}}
  const sessions = {getSnapshot: () => session}, preferences = new PreferenceStore(new MemoryPreferences({user_id: 'user'}))
  const download = deferred(), range = options.range ?? null, metadataRequests = [], mounts = [], cacheStatusRequests = []
  const repositories = {
    local: {read: async key => {calls.push(['local', key]); return local}, update: async (key, value) => {writes.push([key, value]); local = {...local, ...value}}},
    getBookmark: async () => {calls.push('record'); return record},
    watchRows: (_sql, _params, callback) => {recordChanged = callback; return nil},
    watchUser: callback => {callback([]); return nil}, watchTags: callback => {callback([]); return nil}, watchSubscription: callback => {callback(options.subscribed ? [{subscription_end_time: '2099-01-01 00:00:00'}] : []); return nil},
    watchComments: (_id, callback) => {callback([]); return nil}, markCollectionRead: async () => {},
    watchCollectionSettings: (_owner, callback) => {settingsChanged = callback; callback([{allow_highlight: true, show_highlight: true, allow_access: true}]); return nil},
    addMark: async value => {markWrites.push(value); return 'new-mark'}, deleteMark: async id => {calls.push(['delete', id])},
  }
  const runtime = {
    getNativeResourceOwner: () => owner, beginArticleAccess: () => nil,
    getPdfMetadata: async (id, collectionOwner, signal) => {metadataRequests.push({id, collectionOwner, signal}); if (metadataFailure) throw metadataFailure; return pdf},
    pdfCacheStatus: async (...args) => {cacheStatusRequests.push(args); return options.status ?? {downloadedBytes: 250, totalBytes: 1000, complete: false}},
    readPdfRange: async (...args) => {calls.push(['range', ...args]); if (rangeFailure) throw rangeFailure; return range ? range.promise : new Uint8Array(args[3] - args[2])},
    cachePdf: (...args) => {calls.push(['download', ...args]); return download.promise},
    cancelCache: () => assert.fail('Reader must not cancel independently retained cache work'),
  }
  const api = {
    getBookmarkRawContent: async () => assert.fail('PDF must not fetch raw HTML'),
    streamAi: async function* (kind) {calls.push(['ai', kind]); yield {type: 'done', data: kind === 'overview' ? {overview: 'Generated overview'} : {outline: 'Generated outline'}}},
    sendMetrics: async () => {}, getMarkUsers: async () => [],
  }
  const PdfWebView = React.forwardRef(function PdfBoundary(props, ref) {
    pdfProps = props
    const latest = React.useRef(props); latest.current = props
    React.useEffect(() => {
      mounts.push(props.descriptor.document_id)
      return () => {
        if (pdfProps === latest.current) pdfProps = null
        if (options.cleanupPosition !== undefined) void Promise.resolve().then(() => latest.current.onPositionFlush(options.cleanupPosition, 'document-change', 'pdf-page'))
      }
    }, [])
    React.useImperativeHandle(ref, () => ({
      captureSelection: async () => capture, clearSelection: async () => {},
      flushPosition: async reason => {
        calls.push(['flush', reason]); await Promise.resolve()
        if (options.flushPositions?.[reason] !== undefined) await latest.current.onPositionFlush(options.flushPositions[reason], reason, 'pdf-page')
      },
      commitExit: async () => {calls.push('exit'); await Promise.resolve(); if (options.flushPositions?.exit !== undefined) await latest.current.onPositionFlush(options.flushPositions.exit, 'exit', 'pdf-page')},
      scrollToAnchor: async key => {calls.push(['anchor', key]); return true},
    }), [])
    return React.createElement(host.native.View, {testID: 'pdf-boundary'}, props.header)
  })
  const {ReaderToolbar} = await loadComponent('../../src/reader/ReaderOverlays.tsx', {
    react: React, 'react-native': host.native, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})},
    '../components': host.components, '../components/SourceSheetModal': {SourceSheetModal: props => {toolbarProps = props; return props.visible ? React.createElement(host.native.View, {}, props.children) : null}},
    '../theme': {mobileColors, mobileTypography}, './coordinates.ts': coordinates, './model.ts': model, './outline-motion.ts': outlineMotion, './MarkdownView.tsx': {MarkdownView: nil},
  })
  const telemetry = {element() {}, firebase() {}}, t = key => key
  const mobile = {runtime, api, repositories, cache: {readArticle: async () => {calls.push('html-cache'); return '<p>Speculative HTML must not render</p>'}}, preferences, settings: {}, session, sessions, t,
    config: {platform: host.native.Platform.OS}, nativeResourceOwner: owner}
  const boundaries = {
    react: React, 'react-native': {...host.native, ScrollView: props => React.createElement(host.native.View, {...props, testID: props.testID ?? 'screen-scroll-view'}), AppState: {currentState: 'active', addEventListener: (_name, callback) => {appListeners.add(callback); return {remove: () => appListeners.delete(callback)}}}},
    'expo-clipboard': {setStringAsync: async text => copied.push(text)}, 'expo-network': {getNetworkStateAsync: async () => ({isConnected: !options.offline})}, 'expo-file-system': {}, 'expo/fetch': {},
    '@react-navigation/native': {usePreventRemove: (blocked, callback) => {back = {blocked, callback}}}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})},
    '@slax-reader/contracts/pdf': pdfContracts, '../reader/PdfWebView': {PdfWebView}, '../data/transport-errors': transportErrors, '../reader/pdf-errors': pdfErrors,
    '../components': {...host.components, SourceDialog: props => {dialogs.set(props.title, props); return null}}, '../components/SourceRing': {SourceCircularProgress: nil},
    '../data': {...repositoriesModule, PREFERENCE_KEYS}, '../runtime': {useReadingMobile: () => mobile, useMobile: () => mobile, useMobileSettings: select => select ? select(mobile.settings ?? {}) : mobile.settings ?? {}, useControlledUpgradeReaderObserver: () => undefined}, '../rss/controller': {},
    '../theme': {mobileColors, mobileTypography}, '../native/reader': {}, '../native/image-actions': {imageActionPort: {save: async () => {}, share: async () => {}}}, '../native/platform': {}, '../telemetry': {useTelemetry: () => telemetry}, '../reader/share': {},
    '../reader': {ReaderWebView: () => assert.fail('PDF must not mount the HTML reader'), composeReaderError: () => assert.fail('PDF must not compose an HTML error'), toolbarVisible: coordinates.toolbarVisible}, '../reader/input': input,
    '../reader/ReaderOverlays': {CommentPanel: props => {panelProps = props; return null}, SelectionMenu: props => {menuProps = props; return null}, OutlineSheet: props => {outlineProps = props; return null}, FloatingActions: props => {floatingProps = props; return null}, ReaderToolbar, TranscriptSheet: nil},
    '../reader/components/CommentPanel': {CommentPanel: props => {panelProps = props; return null}}, '../reader/components/OutlineSheet': {OutlineSheet: props => {outlineProps = props; return null}},
    '../reader/ImageGallery': {}, '../reader/gallery-resource': {}, '../reader/OverviewViews': {OverviewDialog: props => {overviewProps = props; return null}, OverviewExcerpt: nil},
    '../reader/ReaderSkeleton': {ReaderSkeleton: nil}, '../reader/TagSheet': {ReaderTagSheet: nil}, '../reader/model': model, '../reader/account': account,
    '../reader/position': {ReaderPositionWriter}, '../reader/recovery': {ReaderCrashRecovery}, '../components/fixture-actions': {},
  }
  const {ReaderScreen} = await loadComponent('../../src/screens/ReaderScreen.tsx', boundaries, {
    Error, TypeError, setTimeout: (callback, ms) => {const id = ++timerId; timers.set(id, {callback, ms}); return id}, clearTimeout: id => timers.delete(id),
  })
  const navigation = {isFocused: () => true, setOptions: value => {headerOptions = value}, addListener: (name, callback) => {listeners.set(name, callback); return () => listeners.delete(name)}, getState: () => ({routes: [{key: 'reader'}]})}
  const route = {key: 'reader', params: {bookmarkId: 'book', ...(options.collection ? {collectionOwnerId: 'collection-owner', collectionId: 'collection'} : {})}}
  const render = () => host.render(React.createElement(ReaderScreen, {navigation, route}))
  await render(); await host.settle()
  const fixture = {
    reader: () => pdfProps, panel: () => panelProps, selection: () => menuProps, outline: () => outlineProps, overview: () => overviewProps, floating: () => floatingProps, toolbar: () => toolbarProps, back: () => back,
    calls, writes, markWrites, copied, dialogs, metadataRequests, cacheStatusRequests, mounts, timers, download, render,
    text: () => host.window.document.body.textContent,
    openToolbar: () => withRenderedElement(headerOptions.headerRight(), () => act(async () => host.props.get('reader-header-more').onPress())),
    toolbarAction: async id => {await act(async () => host.props.get(`reader-toolbar-${id}`).onPress()); if (host.native.Platform.OS === 'ios') await act(async () => toolbarProps.onDidDismiss())},
    arrive: async () => {record = {...bookmark, ...options.bookmark}; await act(async () => recordChanged()); await host.settle()},
    setPdf: value => {pdf = {...pdf, ...value}}, setCapture: value => {capture = value}, denyMetadata: value => {metadataFailure = value}, denyRange: value => {rangeFailure = value},
    emit: async event => act(async () => pdfProps.onEvent(event, 'pdf-page')),
    select: async () => act(async () => pdfProps.onEvent({type: 'textSelected', mark: fresh, text: captured.text, containerYPoints: 120}, 'pdf-page')),
    state: async state => act(async () => [...appListeners].forEach(callback => callback(state))),
    tick: async ms => {const pending = [...timers].filter(([, value]) => value.ms === ms); await act(async () => {for (const [id, value] of pending) {if (timers.delete(id)) value.callback()}})},
    settings: async value => act(async () => settingsChanged([value])),
    revoke: async () => {owner = 'replacement-owner'; session = {status: 'anonymous'}; mobile.session = session; mobile.nativeResourceOwner = owner; await render()},
    exit: async () => act(async () => listeners.get('state')({data: {state: {routes: []}}})),
    retry: async () => {const view = host.props.get('reader-pdf-loading-or-error'); const action = find(view.children, node => node.props.label === 'rss_retry'); assert.ok(action); await act(async () => action.props.onPress())},
  }
  await run(fixture)
}

for (const platform of ['ios', 'android']) test(`${platform} PDF waits for the repository type without exposing filenames or raw source metadata`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {platform, missingRecord: true}, async fixture => {
  assert.equal(fixture.reader(), undefined)
  assert.equal(fixture.metadataRequests.length, 0)
  assert.ok(fixture.calls.every(value => value === 'record' || value === 'html-cache' || value[0] === 'local'), 'Only the record and speculative local reads run before the type is known')
  await fixture.arrive()
  assert.ok(fixture.reader())
  assert.match(fixture.text(), /pdf_reader/)
  assert.doesNotMatch(fixture.text(), /local\.pdf|pdf_source_upload|slax-pdf|detail_view_original/)
  assert.equal(fixture.reader().initialPosition, 3.25)
  assert.ok(fixture.calls.findIndex(value => Array.isArray(value) && value[0] === 'local') > fixture.calls.indexOf('record'))
  assert.equal(fixture.calls.filter(value => value === 'html-cache').length, 1, 'Once the record is known as a PDF no HTML read is issued')
  assert.doesNotMatch(fixture.text(), /Speculative HTML/)
})))

test('PDF URL source retains the original link and complete offline cache permits exact marks', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {offline: true, pdf: {source: 'url'}, bookmark: {url: 'https://example.test/paper.pdf'}, status: {downloadedBytes: 1000, totalBytes: 1000, complete: true}}, async fixture => {
  assert.doesNotMatch(fixture.text(), /https:\/\/example\.test\/paper\.pdf|local\.pdf/)
  assert.match(fixture.text(), /detail_view_original/)
  assert.doesNotMatch(fixture.text(), /pdf_source_upload/)
  assert.doesNotMatch(fixture.text(), /pdf_downloaded|pdf_partial_cache|pdf_text_/)
  assert.equal(fixture.cacheStatusRequests.length, 0)
  await fixture.openToolbar()
  assert.equal(host.props.has('reader-toolbar-pdf-download'), false)
  assert.equal(fixture.cacheStatusRequests.length, 0)
  assert.equal(fixture.calls.some(value => Array.isArray(value) && value[0] === 'download'), false)
  await fixture.select(); await act(async () => fixture.selection().onHighlight())
  assert.equal(fixture.markWrites.length, 1)
  assert.deepEqual(fixture.markWrites[0].source, source)
  assert.deepEqual(fixture.markWrites[0].selectContent, captured.select_content)
})))

for (const savedId of [documentId, otherDocumentId]) test(`PDF page restoration is document-bound (${savedId === documentId ? 'same' : 'changed'} identity) and owner-scoped`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {collection: true, local: {pdf_read_position: JSON.stringify({document_id: savedId, position: 7.625})}}, async fixture => {
  assert.equal(fixture.reader().initialPosition, savedId === documentId ? 7.625 : 1)
  await act(async () => fixture.reader().onPositionFlush(4.75, 'background', 'pdf-page'))
  const [key, fields] = fixture.writes.at(-1)
  assert.equal(key, 'collection-collection-owner-book')
  assert.deepEqual(JSON.parse(fields.pdf_read_position), {document_id: documentId, position: 4.75})
  assert.equal(fixture.writes.some(([, fields]) => Object.hasOwn(fields, 'read_position')), false)
})))

for (const state of ['pending', 'empty', 'failed', 'ready']) test(`PDF AI uses extraction state ${state} without requesting HTML`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {pdf: {text_status: state}, subscribed: true}, async fixture => {
  await fixture.emit({type: 'domReady'})
  const ai = fixture.calls.filter(value => Array.isArray(value) && value[0] === 'ai')
  assert.deepEqual(ai, state === 'ready' ? [['ai', 'overview'], ['ai', 'outline']] : [])
  assert.doesNotMatch(fixture.text(), /pdf_text_|pdf_downloaded|pdf_partial_cache/)
  assert.equal(fixture.outline().error, null)
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
  if (state !== 'ready') {
    await fixture.openToolbar(); await fixture.toolbarAction('outline')
    assert.equal(fixture.outline().status, 'expanded')
    assert.equal(fixture.outline().error, `pdf_text_${state}`, 'Only an explicit AI action reports extraction eligibility')
    assert.equal(fixture.calls.some(value => Array.isArray(value) && value[0] === 'ai'), false)
    assert.ok(fixture.reader())
  }
})))

test('pending PDF extraction polling is bounded, stops on background and restarts safely', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {pdf: {text_status: 'pending'}}, async fixture => {
  await fixture.emit({type: 'domReady'})
  for (let index = 0; index < 14; index++) await fixture.tick(5000)
  assert.equal(fixture.metadataRequests.length, 13)
  await fixture.state('background'); await fixture.tick(5000)
  assert.equal(fixture.metadataRequests.length, 13)
  await fixture.state('active'); fixture.setPdf({text_status: 'ready'}); await fixture.tick(5000)
  assert.equal(fixture.metadataRequests.length, 14)
  assert.deepEqual(fixture.calls.filter(value => Array.isArray(value) && value[0] === 'ai'), [['ai', 'overview'], ['ai', 'outline']])
})))

for (const platform of ['ios', 'android']) test(`${platform} PDF delegates the full header to its single host and uses root-relative selection coordinates once`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {platform}, async fixture => {
  await act(async () => host.props.get('reader-screen').onLayout({nativeEvent: {layout: {height: 844}}}))
  assert.equal(host.window.document.querySelector('[data-testid="screen-scroll-view"]'), null)
  assert.equal(host.window.document.querySelector('[data-testid="reader-pdf-viewport"]'), null)
  assert.ok(host.window.document.querySelector('[data-testid="pdf-boundary"] [data-testid="reader-article-header"]'))
  assert.equal(fixture.reader().headerSafeAreaPoints, platform === 'ios' ? 62 : 0)
  assert.equal(host.props.get('reader-article-header').style[1].paddingTop, 106)
  assert.equal(host.props.get('reader-article-header').children[0].props.numberOfLines, 3)
  assert.equal(fixture.reader().isRouteRemoved(), false)
  await fixture.select()
  assert.equal(fixture.selection().y, 120)
  assert.equal(fixture.selection().height, 844)
  await fixture.emit({type: 'textSelected', mark: fresh, text: captured.text, containerYPoints: 334})
  assert.equal(fixture.selection().y, 334, 'Relayout coordinates from the shared host are already root-relative')
  await act(async () => fixture.selection().onComment())
  assert.equal(fixture.reader().commentPanelVisible, true)
})))

for (const platform of ['ios', 'android']) test(`${platform} PDF physical metrics drive floating controls independently of page persistence and native recovery`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {platform}, async fixture => {
  await act(async () => fixture.reader().onPositionChange(8.75, false))
  assert.equal(fixture.floating().visible, true)
  await act(async () => fixture.reader().onScrollMetrics(1200, false))
  assert.equal(fixture.floating().visible, false)
  await act(async () => fixture.reader().onPositionChange(1.1, true))
  assert.equal(fixture.floating().visible, false)
  await act(async () => fixture.reader().onScrollMetrics(1800, true))
  assert.equal(fixture.floating().visible, true)
  await act(async () => fixture.reader().onPositionChange(8.75, false))
  await act(async () => fixture.reader().onError(Object.assign(new Error('Native process gone'), {name: 'ReaderProcessGone'})))
  assert.equal(fixture.reader().initialPosition, 8.75)
  assert.equal(fixture.mounts.length, 2)
  assert.equal(host.window.document.querySelector('[data-testid="reader-pdf-loading-or-error"]'), null)
})))

test('PDF copy and comment retain exact text while stale selections cannot create marks or comments', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {}, async fixture => {
  await fixture.select(); await act(async () => fixture.selection().onCopy())
  assert.deepEqual(fixture.copied, [captured.text])
  await fixture.select(); await act(async () => fixture.selection().onComment())
  assert.equal(fixture.panel().text, captured.text)
  await act(async () => fixture.panel().onDraft('Exact comment'))
  await act(async () => fixture.panel().onSubmit())
  assert.equal(fixture.markWrites.length, 1)
  assert.equal(fixture.markWrites[0].comment, 'Exact comment')
  assert.deepEqual(fixture.markWrites[0].source, source)
  await act(async () => fixture.panel().onClose())
  fixture.setCapture({...captured, source: [{...source[0], document_id: otherDocumentId}]})
  await fixture.select(); await act(async () => fixture.selection().onHighlight())
  await act(async () => fixture.selection().onComment())
  assert.equal(fixture.markWrites.length, 1)
  assert.equal(fixture.panel().visible, false)
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').children.props.children, 'pdf_selection_invalid')
})))

test('PDF note selection reveals the renderer anchor and opens the matching native comment panel', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {}, async fixture => {
  const note = {...fresh, id: 'pdf-note'}
  await fixture.emit({type: 'domReady'})
  await fixture.emit({type: 'markItemInfosChanged', marks: [note]})
  await fixture.openToolbar(); await fixture.toolbarAction('pdf-notes')
  assert.equal(fixture.back().blocked, true)
  const item = find(host.props.get('reader-pdf-note-list').children, node => node.key === note.id)
  assert.ok(item)
  await act(async () => item.props.onPress())
  assert.deepEqual(fixture.calls.find(value => Array.isArray(value) && value[0] === 'anchor'), ['anchor', 'pdf-note'])
  assert.equal(fixture.panel().mark.id, note.id)
  assert.equal(fixture.panel().text, captured.text)
  assert.equal(fixture.panel().autoFocus, false)
  assert.equal(host.window.document.querySelector('[data-testid="reader-pdf-note-list"]'), null)
})))

test('PDF background and cancelled range reads preserve drafts; native back retains discard protection', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {}, async fixture => {
  await fixture.select(); await act(async () => fixture.selection().onComment())
  await act(async () => fixture.panel().onDraft('Keep this draft'))
  await fixture.state('background')
  assert.equal(fixture.panel().draft, 'Keep this draft')
  assert.equal(fixture.panel().autoFocus, false)
  fixture.denyRange(failure(403))
  const controller = new AbortController(); controller.abort()
  await act(async () => assert.rejects(fixture.reader().readRange(0, 10, controller.signal)))
  assert.ok(fixture.reader())
  assert.equal(fixture.panel().draft, 'Keep this draft')
  await fixture.state('active'); await act(async () => fixture.back().callback())
  const dialog = fixture.dialogs.get('comment_panel_discard_title')
  assert.equal(dialog.visible, true)
  await act(async () => find(dialog.actions, node => node.props.label === 'comment_panel_discard_confirm').props.onPress())
  assert.equal(fixture.panel().draft, '')
  assert.equal(fixture.panel().visible, false)
})))

for (const status of [401, 403, 404]) test(`background PDF authorization denial ${status} removes inaccessible content, notes and draft`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {}, async fixture => {
  await fixture.emit({type: 'markItemInfosChanged', marks: [{...fresh, id: 'pdf-note'}]})
  await fixture.select(); await act(async () => fixture.selection().onComment())
  await act(async () => fixture.panel().onDraft('Private draft'))
  const activeReader = fixture.reader(), controller = new AbortController()
  await fixture.state('background'); fixture.denyRange(failure(status))
  await act(async () => assert.rejects(activeReader.readRange(0, 10, controller.signal)))
  assert.equal(host.window.document.querySelector('[data-testid="pdf-boundary"]'), null)
  assert.equal(fixture.panel().visible, false)
  assert.equal(fixture.panel().draft, '')
  await fixture.state('active')
  assert.equal(host.window.document.querySelector('[data-testid="reader-pdf-notes"]'), null)
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
  assert.equal(fixture.markWrites.length, 0)
})))

test('PDF transient byte failure waits for the renderer load decision and preserves the draft through one error/retry panel', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {}, async fixture => {
  await fixture.select(); await act(async () => fixture.selection().onComment())
  await act(async () => fixture.panel().onDraft('Retry this draft'))
  const error = new transportErrors.DataTransportError('network', 'pdf-range'), active = fixture.reader()
  fixture.denyRange(error)
  await act(async () => assert.rejects(active.readRange(0, 10, new AbortController().signal), error))
  assert.equal(fixture.panel().draft, 'Retry this draft')
  assert.ok(fixture.reader())
  assert.equal(host.window.document.querySelector('[data-testid="reader-pdf-loading-or-error"]'), null)
  await act(async () => active.onError(error))
  assert.match(fixture.text(), /pdf_offline_missing \(pdf-range\/network_unavailable\)/)
  assert.equal((fixture.text().match(/pdf_offline_missing/g) ?? []).length, 1)
  await act(async () => active.onError(new Error('Generic later failure')))
  assert.doesNotMatch(fixture.text(), /renderer\/unknown/)
  fixture.denyRange(null); await fixture.retry()
  assert.ok(fixture.reader())
  assert.equal(fixture.panel().draft, 'Retry this draft')
})))

test('PDF metadata denial clears a private draft while a changed document rejects the retained selection', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {pdf: {text_status: 'pending'}}, async fixture => {
  await fixture.select(); await act(async () => fixture.selection().onComment())
  await act(async () => fixture.panel().onDraft('Do not attach to another document'))
  fixture.setPdf({document_id: otherDocumentId})
  await fixture.tick(5000)
  assert.equal(fixture.reader().descriptor.document_id, otherDocumentId)
  assert.equal(fixture.panel().draft, 'Do not attach to another document')
  await act(async () => fixture.panel().onSubmit())
  assert.equal(fixture.markWrites.length, 0)
  fixture.denyMetadata(failure(403)); await fixture.tick(5000)
  assert.equal(fixture.panel().visible, false)
  assert.equal(fixture.panel().draft, '')
  assert.equal(host.window.document.querySelector('[data-testid="pdf-boundary"]'), null)
})))

test('PDF account revocation clears a background draft and rejects old submit/position callbacks', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {}, async fixture => {
  await fixture.select(); await act(async () => fixture.selection().onComment())
  await act(async () => fixture.panel().onDraft('Previous account only'))
  const oldPanel = fixture.panel(), oldReader = fixture.reader(), writes = fixture.writes.length
  await fixture.state('background'); await fixture.revoke()
  assert.equal(fixture.panel().visible, false)
  assert.equal(fixture.panel().draft, '')
  await act(async () => {oldPanel.onSubmit(); await oldReader.onPositionFlush(6.5, 'background', 'old-page')})
  assert.equal(fixture.markWrites.length, 0)
  assert.equal(fixture.writes.length, writes)
})))

for (const platform of ['ios', 'android']) test(`${platform} PDF toolbar retains disabled notes without a separate offline-download action`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {platform}, async fixture => {
  assert.equal(fixture.cacheStatusRequests.length, 0)
  await fixture.tick(5000); await fixture.state('background'); await fixture.state('active'); await fixture.tick(1500)
  assert.equal(fixture.cacheStatusRequests.length, 0, 'No badge-only cache status polling remains')
  await fixture.openToolbar()
  const notes = host.props.get('reader-toolbar-pdf-notes')
  assert.equal(notes.disabled, true); assert.equal(notes.accessibilityState.disabled, true)
  await act(async () => notes.onPress())
  assert.equal(fixture.toolbar().visible, true)
  assert.equal(host.props.has('reader-toolbar-pdf-download'), false)
  await act(async () => fixture.toolbar().onDismiss())
  assert.equal(fixture.toolbar().visible, false)
  assert.equal(fixture.cacheStatusRequests.length, 0)
  assert.equal(fixture.calls.filter(value => Array.isArray(value) && value[0] === 'download').length, 0)
})))

for (const name of ['AbortError', 'ReaderOperationCancelled']) test(`PDF ${name} command/load cancellation keeps readable content and draft`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {}, async fixture => {
  await fixture.select(); await act(async () => fixture.selection().onComment()); await act(async () => fixture.panel().onDraft('Keep this draft'))
  const error = Object.assign(new Error('Cancelled'), {name}), reader = fixture.reader()
  await act(async () => {reader.onOperationError(error); reader.onError(error)})
  assert.ok(fixture.reader()); assert.equal(fixture.mounts.length, 1)
  assert.equal(fixture.panel().draft, 'Keep this draft')
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
})))

test('PDF annotation operation failure cannot become a document load failure', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {}, async fixture => {
  await fixture.select(); await act(async () => fixture.selection().onComment()); await act(async () => fixture.panel().onDraft('Retained'))
  await act(async () => fixture.reader().onOperationError(new Error('Annotation could not be saved')))
  assert.ok(fixture.reader()); assert.equal(fixture.panel().draft, 'Retained'); assert.equal(fixture.mounts.length, 1)
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, true)
  assert.equal(host.window.document.querySelector('[data-testid="reader-pdf-loading-or-error"]'), null)
})))

for (const [error, code] of [
  [new Error('Private URL https://private.example/document?token=secret'), 'unknown'],
  [new ApiError(404, 'Private unavailable URL', undefined, {stage: 'pdf-metadata'}), 'http_not_found'],
]) test(`PDF metadata ${code} appears once with safe stage and never substitutes HTML`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {metadataFailure: error}, async fixture => {
  assert.equal(fixture.reader(), undefined)
  assert.equal((fixture.text().match(/pdf_load_failed/g) ?? []).length, 1)
  assert.ok(fixture.text().includes(`pdf-metadata/${code}`))
  assert.doesNotMatch(fixture.text(), /private|token=|https:\/\//i)
  fixture.denyMetadata(null); await fixture.retry()
  assert.ok(fixture.reader())
})))

test('PDF renderer failures preserve bounded worker/password causes without raw private messages', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {}, async fixture => {
  const reader = fixture.reader()
  await act(async () => reader.onError(pdfErrors.pdfFailureError({code: 'PDF_WORKER_UNAVAILABLE', message: 'private'}, 'worker')))
  assert.match(fixture.text(), /worker\/PDF_WORKER_UNAVAILABLE/)
  assert.equal((fixture.text().match(/pdf_load_failed/g) ?? []).length, 1)
  await fixture.retry()
  await act(async () => fixture.reader().onError(pdfErrors.pdfFailureError({name: 'PasswordException'}, 'document')))
  assert.match(fixture.text(), /pdf_password \(document\/PasswordException\)/)
  assert.doesNotMatch(fixture.text(), /private/)
})))

test('PDF document replacement rejects old error, metric, event and position callbacks', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {pdf: {text_status: 'pending'}}, async fixture => {
  const retired = fixture.reader()
  fixture.setPdf({document_id: otherDocumentId}); await fixture.tick(5000)
  assert.equal(fixture.reader().descriptor.document_id, otherDocumentId)
  const writes = fixture.writes.length
  await act(async () => {
    retired.onError(new Error('Retired document failure'))
    retired.onOperationError(new Error('Retired command failure'))
    retired.onScrollMetrics(900, false)
    retired.onPositionChange(7.5, false)
    await retired.onPositionFlush(7.5, 'background', 'old-page')
  })
  assert.ok(fixture.reader()); assert.equal(fixture.floating().visible, true)
  assert.equal(fixture.writes.length, writes)
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
})))

for (const sequence of [['manual', 'native'], ['native', 'manual', 'native']]) test(`PDF mixed ${sequence.join('/')} retries always replace the same-document host`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {}, async fixture => {
  await fixture.select(); await act(async () => fixture.selection().onComment()); await act(async () => fixture.panel().onDraft('Survives every host'))
  let expectedMounts = 1
  for (const kind of sequence) {
    const current = fixture.reader()
    await act(async () => current.onPositionChange(8.5, false))
    if (kind === 'manual') {
      await act(async () => current.onError(new Error('Load failed')))
      await fixture.retry()
    } else {
      await act(async () => current.onError(Object.assign(new Error('Process gone'), {name: 'ReaderProcessGone'})))
      if (host.window.document.querySelector('[data-testid="reader-native-retry"]')) {
        const retry = find(host.props.get('reader-native-retry').children, node => node.props.label === 'rss_retry')
        await act(async () => retry.props.onPress())
      }
    }
    assert.equal(fixture.mounts.length, ++expectedMounts, `${kind} must create a fresh React host`)
    assert.equal(fixture.reader().initialPosition, 8.5)
    assert.equal(fixture.panel().draft, 'Survives every host')
  }
})))

for (const kind of ['manual', 'native']) test(`PDF same-document ${kind} replacement rejects all retired callbacks and retains latest position/draft`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {}, async fixture => {
  const retired = fixture.reader()
  if (kind === 'manual') {await act(async () => retired.onError(new Error('Load failed'))); await fixture.retry()}
  else await act(async () => retired.onError(Object.assign(new Error('Process gone'), {name: 'ReaderProcessGone'})))
  const current = fixture.reader()
  await fixture.emit({type: 'domReady'})
  await fixture.select(); await act(async () => fixture.selection().onComment()); await act(async () => fixture.panel().onDraft('New host draft'))
  await act(async () => {current.onPositionChange(8.5, false); current.onScrollMetrics(0, false); await current.onPositionFlush(8.5, 'background', 'pdf-page')})
  const writes = fixture.writes.length, mounts = fixture.mounts.length
  await act(async () => {
    retired.onPositionChange(2.25, false); retired.onScrollMetrics(1200, false)
    await retired.onPositionFlush(2.25, 'background', 'pdf-page')
    await retired.onPositionFlush(2.25, 'document-change', 'pdf-page')
    await retired.onPositionFlush(2.25, 'exit', 'pdf-page')
    retired.onEvent({type: 'markClicked', mark: {...fresh, id: 'retired'}, text: 'Retired quote'}, 'pdf-page')
    retired.onEvent({type: 'markItemInfosChanged', marks: [{...fresh, id: 'retired'}]}, 'pdf-page')
    retired.onEvent({type: 'domReady'}, 'pdf-page')
    retired.onOperationError(new Error('Retired operation'))
    retired.onError(new Error('Retired load failure'))
  })
  assert.ok(fixture.reader(), 'A retired error cannot unmount the new PDF host')
  assert.equal(fixture.mounts.length, mounts)
  assert.equal(fixture.writes.length, writes)
  assert.equal(JSON.parse(fixture.writes.at(-1)[1].pdf_read_position).position, 8.5)
  assert.equal(fixture.panel().draft, 'New host draft'); assert.equal(fixture.panel().text, captured.text)
  assert.equal(fixture.panel().mark.id, '')
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
  await act(async () => fixture.panel().onClose())
  await act(async () => find(fixture.dialogs.get('comment_panel_discard_title').actions, node => node.props.label === 'comment_panel_discard_confirm').props.onPress())
  assert.equal(fixture.floating().visible, true, 'Retired physical metrics cannot hide the controls')
  await act(async () => current.onError(new Error('Current load failure'))); await fixture.retry()
  assert.equal(fixture.reader().initialPosition, 8.5)
})))

test('PDF active host retains awaited document-change flush before metadata replacement', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {pdf: {text_status: 'pending'}, flushPositions: {'document-change': 6.75}}, async fixture => {
  fixture.setPdf({document_id: otherDocumentId}); await fixture.tick(5000)
  assert.equal(fixture.reader().descriptor.document_id, otherDocumentId)
  const flushes = fixture.writes.filter(([, value]) => value.pdf_read_position).map(([, value]) => JSON.parse(value.pdf_read_position))
  assert.ok(flushes.length > 0)
  assert.ok(flushes.every(value => value.document_id === documentId && value.position === 6.75))
  assert.equal(fixture.reader().initialPosition, 1)
})))

test('PDF current host commits its final position after navigation marks the screen inactive', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {flushPositions: {exit: 9.625}}, async fixture => {
  const active = fixture.reader()
  await fixture.exit()
  assert.equal(fixture.calls.includes('exit'), true)
  assert.deepEqual(JSON.parse(fixture.writes.at(-1)[1].pdf_read_position), {document_id: documentId, position: 9.625})
  const writes = fixture.writes.length
  await act(async () => {active.onError(new Error('Exit callback')); active.onOperationError(new Error('Exit command')); await active.onPositionFlush(1.25, 'background', 'pdf-page')})
  assert.equal(fixture.writes.length, writes)
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
})))

test('PDF host unmount preserves its final document-change flush while no replacement exists', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {cleanupPosition: 5.125}, async fixture => {
  await host.unmount()
  assert.deepEqual(JSON.parse(fixture.writes.at(-1)[1].pdf_read_position), {document_id: documentId, position: 5.125})
})))

test('PDF same-document replacement ignores deferred old cleanup after the new host attaches', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {cleanupPosition: 2.25}, async fixture => {
  const current = fixture.reader()
  await act(async () => {current.onPositionChange(8.5, false); await current.onPositionFlush(8.5, 'background', 'pdf-page')})
  const writes = fixture.writes.length
  await act(async () => current.onError(Object.assign(new Error('Native process gone'), {name: 'ReaderProcessGone'})))
  assert.equal(fixture.mounts.length, 2)
  assert.equal(fixture.reader().initialPosition, 8.5)
  assert.equal(fixture.writes.length, writes)
})))

test('PDF retired range callback cannot revoke the replacement host', nativeBoundary, async () => withNativeHost(async host => {
  const range = deferred()
  await screenFixture(host, {range}, async fixture => {
    const retired = fixture.reader(), pending = retired.readRange(0, 10, new AbortController().signal)
    const checked = assert.rejects(pending)
    await act(async () => retired.onError(Object.assign(new Error('Native process gone'), {name: 'ReaderProcessGone'})))
    assert.equal(fixture.mounts.length, 2)
    await act(async () => {range.reject(failure(403)); await checked})
    await act(async () => assert.rejects(retired.readRange(0, 10, new AbortController().signal), {name: 'ReaderOperationCancelled'}))
    assert.ok(fixture.reader())
    assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
  })
}))

test('PDF identity protocol failure removes inaccessible content and draft immediately', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {}, async fixture => {
  await fixture.select(); await act(async () => fixture.selection().onComment()); await act(async () => fixture.panel().onDraft('Private'))
  const error = new ApiError(0, 'Invalid PDF identity', undefined, {stage: 'pdf-range', code: 'pdf_identity_mismatch'})
  fixture.denyRange(error)
  await act(async () => assert.rejects(fixture.reader().readRange(0, 10, new AbortController().signal)))
  assert.equal(fixture.panel().draft, '')
  assert.equal(host.window.document.querySelector('[data-testid="pdf-boundary"]'), null)
  assert.match(fixture.text(), /pdf-range\/pdf_identity_mismatch/)
})))

test('PDF Reader exit owns metadata polling but leaves automatic cache work to the account runtime', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, {pdf: {text_status: 'pending'}}, async fixture => {
  await fixture.tick(5000)
  const signal = fixture.metadataRequests.at(-1).signal
  await fixture.openToolbar()
  assert.equal(host.props.has('reader-toolbar-pdf-download'), false)
  assert.equal(fixture.cacheStatusRequests.length, 0)
  await fixture.exit()
  assert.equal(signal.aborted, true)
  assert.equal(fixture.calls.includes('exit'), true)
  const count = fixture.metadataRequests.length
  await fixture.tick(5000); assert.equal(fixture.metadataRequests.length, count)
  await fixture.revoke(); await act(async () => fixture.download.resolve())
  assert.deepEqual(fixture.calls.filter(value => Array.isArray(value) && value[0] === 'download'), [])
  assert.equal(fixture.markWrites.length, 0)
})))
