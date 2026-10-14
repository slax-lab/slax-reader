import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {React, act, nativeBoundary, loadComponent, withNativeHost} from './parity-host.mjs'
import {PreferenceStore, PREFERENCE_KEYS} from '../../src/data/preferences.ts'
import {MemoryPreferences} from '../data/helpers.ts'
import {bookmarkCacheKey, bookmarkDisplayTitle, collectionMarkPolicy, PERSONAL_MARK_POLICY, PENDING_COLLECTION_MARK_POLICY} from '../../src/data/repositories.ts'
import * as pdfContracts from '@slax-reader/contracts/pdf'
import * as transportErrors from '../../src/data/transport-errors.ts'
import * as pdfErrors from '../../src/reader/pdf-errors.ts'
import * as model from '../../src/reader/model.ts'
import * as account from '../../src/reader/account.ts'
import * as input from '../../src/reader/input.ts'
import * as coordinates from '../../src/reader/coordinates.ts'
import * as motion from '../../src/reader/outline-motion.ts'
import {ReaderPositionWriter} from '../../src/reader/position.ts'
import {ReaderCrashRecovery, readerDocumentError, READER_PROCESS_GONE} from '../../src/reader/recovery.ts'
import {scriptJson} from '../../src/reader/document.ts'
import {markdownToHtml} from '../../src/reader/markdown.ts'
import {mobileColors, mobileTypography} from '../../src/theme/index.ts'

const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes}); return {promise, resolve}}
const captured = {source: [{type: 'text', xpath: '/p/text()', start_offset: 0, end_offset: 5}], text: 'Quote', approx_source: {exact: 'Quote'}, select_content: [{type: 'text', text: 'Quote', src: ''}]}
const mark = {id: '', source: [], approx: {}, stroke: [], comments: []}

async function screenFixture(host, options, run) {
  const nil = () => null, dialogs = new Map(), appListeners = new Set(), writes = [], calls = [], timers = []
  const owner = {id: 'owner'}
  let currentOwner = owner, reader, panel, selection, outline, skeleton, mounts = 0, renders = 0, leases = 0
  const appState = {currentState: 'active', addEventListener: (_name, listener) => {appListeners.add(listener); return {remove: () => appListeners.delete(listener)}}}
  const preferences = new PreferenceStore(new MemoryPreferences({user_id: 'user'}))
  const session = {status: 'authenticated', session: {userId: 'user', token: 'synthetic', refreshedAt: 0}}
  const repositories = {
    local: {read: async () => {calls.push('local-read'); return options.local ? await options.local.promise : {read_position: '240', outline_read_position: '120', overview: 'Cached', outline: 'Cached'}},
      update: async (_key, value) => {writes.push(value); if (value.is_downloaded === 2 && options.metadataWrite) await options.metadataWrite.promise}},
    getBookmark: async () => ({id: 'book', title: 'Known title', aliasTitle: '', metadata: '{}'}),
    watchUser: callback => {callback([]); return nil}, watchSubscription: callback => {callback([]); return nil}, watchTags: callback => {callback([]); return nil},
    watchRows: () => nil, watchComments: (_id, callback) => {callback([]); return nil},
    addMark: async value => {calls.push(['addMark', value]); if (options.addMark) await options.addMark.promise},
  }
  const cache = {readArticle: async () => {calls.push('cache-read'); return options.cacheRead ? await options.cacheRead.promise : options.remote ? null : '<p>Cached body</p>'},
    writeArticle: async (_key, html) => {calls.push(['cache-write', html]); if (options.cacheWrite) await options.cacheWrite.promise}}
  const api = {getBookmarkRawContent: async () => {calls.push('download'); return '<p>Downloaded body</p>'},
    streamAi: async function* (kind) {calls.push(['ai', kind]); yield {type: 'done'}}, getMarkUsers: async () => []}
  const runtime = {getNativeResourceOwner: () => currentOwner, beginArticleAccess: () => {leases++; return () => {leases--}}}
  const ReaderWebView = React.forwardRef((props, ref) => {
    reader = props; renders++
    React.useEffect(() => {mounts++}, [])
    React.useImperativeHandle(ref, () => ({captureSelection: async () => {calls.push('capture'); return captured},
      clearSelection: async () => {calls.push('clear'); props.onEvent({type: 'textDeselected'}, 'page')},
      flushPosition: async () => {calls.push('flush'); if (options.flush) await options.flush.promise}, commitExit: async () => {calls.push('exit')}}), [])
    return React.createElement('div', null, props.html)
  })
  const boundaries = {
    '@slax-reader/contracts/pdf': pdfContracts, '../data/transport-errors': transportErrors, '../reader/pdf-errors': pdfErrors,
    '../reader/PdfWebView': {PdfWebView: () => assert.fail('An HTML performance fixture must not mount the PDF renderer')},
    react: React, 'react-native': {...host.native, AppState: appState}, 'expo-clipboard': {}, 'expo-network': {getNetworkStateAsync: async () => ({isConnected: true})}, 'expo-file-system': {}, 'expo/fetch': {},
    '@react-navigation/native': {usePreventRemove() {}}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})},
    '../components': {...host.components, SourceDialog: props => {dialogs.set(props.title, props); return null}}, '../components/SourceRing': {SourceCircularProgress: nil},
    '../data': {bookmarkCacheKey, bookmarkDisplayTitle, collectionMarkPolicy, PERSONAL_MARK_POLICY, PENDING_COLLECTION_MARK_POLICY, PREFERENCE_KEYS},
    '../runtime': {useMobile: () => ({runtime, repositories, cache, api, preferences, session, sessions: {getSnapshot: () => session}, settings: {}, t: key => key, config: {}, nativeResourceOwner: owner}), useControlledUpgradeReaderObserver: () => undefined},
    '../rss/controller': {}, '../theme': {mobileColors, mobileTypography}, '../native/reader': {}, '../native/platform': {}, '../telemetry': {useTelemetry: () => telemetry}, '../reader/share': {},
    '../reader': {ReaderWebView, toolbarVisible: coordinates.toolbarVisible, composeReaderError: () => '<p>Error</p>'}, '../reader/input': input,
    '../reader/ReaderOverlays': {CommentPanel: props => {panel = props; return null}, SelectionMenu: props => {selection = props; return null}, OutlineSheet: props => {outline = props; return null}, FloatingActions: nil, ReaderToolbar: nil, TranscriptSheet: nil},
    '../reader/ImageGallery': {}, '../reader/gallery-resource': {}, '../reader/OverviewViews': {OverviewDialog: nil, OverviewExcerpt: nil}, '../reader/ReaderSkeleton': {ReaderSkeleton: props => {skeleton = props; return null}}, '../reader/TagSheet': {ReaderTagSheet: nil},
    '../reader/model': model, '../reader/account': account, '../reader/position': {ReaderPositionWriter}, '../reader/recovery': {ReaderCrashRecovery}, '../components/fixture-actions': {},
  }
  const sessions = {getSnapshot: () => session}, t = key => key, telemetry = {element() {}, firebase() {}}
  const mobile = {...boundaries['../runtime'].useMobile(), sessions, t}
  boundaries['../runtime'].useMobile = () => mobile
  const {ReaderScreen} = await loadComponent('../../src/screens/ReaderScreen.tsx', boundaries, {Error, setTimeout: (callback, ms) => {timers.push(ms); return setTimeout(callback, ms)}})
  const listeners = new Map()
  const navigation = {addListener: (name, callback) => {listeners.set(name, callback); return () => listeners.delete(name)}, setOptions() {}, getState: () => ({routes: [{key: 'reader'}]})}
  await host.render(React.createElement(ReaderScreen, {navigation, route: {key: 'reader', params: {bookmarkId: 'book', title: 'Known title'}}}))
  await run({reader: () => reader, panel: () => panel, selection: () => selection, outline: () => outline, skeleton: () => skeleton,
    calls, writes, timers, dialogs, mounts: () => mounts, renders: () => renders, leases: () => leases,
    revoke: () => {currentOwner = {id: 'next-owner'}},
    state: async value => act(async () => {appState.currentState = value; [...appListeners].forEach(callback => callback(value))}),
    exit: async () => act(async () => listeners.get('state')({data: {state: {routes: []}}})),
  })
}

test('warm reader starts local/cache reads together, reveals known title, and mounts with no minimum timer', nativeBoundary, async () => withNativeHost(async host => {
  const local = deferred(), cacheRead = deferred()
  await screenFixture(host, {local, cacheRead}, async fixture => {
    assert.deepEqual(fixture.calls, ['local-read', 'cache-read'])
    assert.ok(fixture.skeleton().header, 'Known source header is available before cache IO resolves')
    await act(async () => cacheRead.resolve('<p>Warm body</p>'))
    assert.equal(fixture.reader(), undefined, 'Saved position must resolve before the first document mount')
    await act(async () => local.resolve({read_position: '420', outline_read_position: '180'}))
    assert.equal(fixture.reader().html, '<p>Warm body</p>')
    assert.equal(fixture.reader().initialPosition, 420)
    assert.equal(fixture.timers.includes(250), false)
    assert.equal(fixture.mounts(), 1)
    assert.ok(!fixture.calls.some(value => Array.isArray(value) && value[0] === 'ai'))
    const renders = fixture.renders()
    await act(async () => {for (let y = 1; y <= 1000; y++) fixture.outline().onPosition(y)})
    assert.equal(fixture.renders(), renders, 'Outline scrolling never rerenders ReaderScreen')
    await fixture.state('background')
    assert.ok(fixture.writes.some(value => value.outline_read_position === '1000'))
    await fixture.state('active')
    await act(async () => fixture.reader().onEvent({type: 'domReady'}, 'page'))
    assert.equal(fixture.calls.filter(value => Array.isArray(value) && value[0] === 'ai').length, 2)
    assert.equal(fixture.mounts(), 1)
  })
}))

test('downloaded content and source restore are usable before slow cache persistence, which retains its lease', nativeBoundary, async () => withNativeHost(async host => {
  const cacheWrite = deferred(), metadataWrite = deferred()
  await screenFixture(host, {remote: true, cacheWrite, metadataWrite}, async fixture => {
    assert.equal(fixture.reader().html, '<p>Downloaded body</p>')
    assert.equal(fixture.reader().initialPosition, 240)
    assert.equal(fixture.calls.some(value => Array.isArray(value) && value[0] === 'cache-write'), false)
    assert.equal(fixture.leases(), 1)
    await act(async () => fixture.reader().onEvent({type: 'domReady'}, 'page'))
    assert.equal(fixture.calls.filter(value => Array.isArray(value) && value[0] === 'cache-write').length, 1)
    assert.equal(fixture.reader().html, '<p>Downloaded body</p>')
    await act(async () => cacheWrite.resolve())
    assert.equal(fixture.leases(), 1)
    await act(async () => metadataWrite.resolve())
    assert.equal(fixture.leases(), 0)
    assert.equal(fixture.mounts(), 1)
  })
}))

test('captured comment survives background process recovery with one remount, latest position and no focus replay', nativeBoundary, async () => withNativeHost(async host => {
  await screenFixture(host, {}, async fixture => {
    await act(async () => fixture.reader().onEvent({type: 'textSelected', mark, text: 'Quote', containerYPoints: 200}, 'page'))
    await act(async () => fixture.selection().onComment())
    assert.deepEqual(fixture.calls.slice(-2), ['capture', 'clear'])
    await act(async () => {fixture.panel().onDraft('Keep draft'); fixture.reader().onPositionChange(777, false)})
    await fixture.state('background')
    await act(async () => {fixture.reader().onError(readerDocumentError(READER_PROCESS_GONE)); fixture.reader().onError(readerDocumentError(READER_PROCESS_GONE))})
    assert.equal(fixture.mounts(), 1)
    assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
    assert.equal(fixture.panel().draft, 'Keep draft')
    await fixture.state('active')
    assert.equal(fixture.mounts(), 2)
    assert.equal(fixture.reader().initialPosition, 777)
    assert.equal(fixture.panel().draft, 'Keep draft')
    assert.equal(fixture.panel().autoFocus, false)
    await act(async () => fixture.reader().onError(readerDocumentError(READER_PROCESS_GONE)))
    await fixture.state('background'); await fixture.state('active')
    assert.equal(fixture.mounts(), 2, 'Automatic recovery budget prevents a remount loop')
  })
}))

test('highlight uses the captured range before clearing selection; background cancellation and revoked errors stay silent', nativeBoundary, async () => withNativeHost(async host => {
  const addMark = deferred()
  await screenFixture(host, {addMark}, async fixture => {
    await act(async () => fixture.reader().onEvent({type: 'textSelected', mark, text: 'Quote', containerYPoints: 200}, 'page'))
    await act(async () => fixture.selection().onHighlight())
    assert.equal(fixture.calls.at(-1)[0], 'addMark')
    assert.equal(fixture.calls.includes('clear'), false)
    await act(async () => addMark.resolve())
    assert.equal(fixture.calls.at(-1), 'clear')
    await fixture.state('background')
    const abort = new Error('Cancelled'); abort.name = 'AbortError'
    await act(async () => {fixture.reader().onError(abort); fixture.reader().onError({name: 'ReaderOperationCancelled'}); fixture.reader().onError({code: 'E_READER_INACTIVE'})})
    await fixture.state('active')
    assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
    await fixture.state('background')
    await act(async () => fixture.reader().onError(new Error('Deferred failure')))
    assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
    fixture.revoke()
    await fixture.state('active')
    assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
    assert.equal(fixture.mounts(), 1)
  })
}))

test('mounted MarkdownView produces zero DOM replacements or parses on static outline scroll and restores once', nativeBoundary, async () => withNativeHost(async host => {
  let props, parses = 0, replacements = 0, markup = '', scriptContext
  const positions = [], scrolls = []
  const content = {get innerHTML() {return markup}, set innerHTML(value) {markup = value; replacements++}}
  const webWindow = {scrollY: 0, scrollTo(_x, y) {webWindow.scrollY = y; scrolls.push(y)}, ReactNativeWebView: {postMessage() {}}}
  const WebView = React.forwardRef((value, ref) => {
    props = value
    React.useImperativeHandle(ref, () => ({injectJavaScript: script => vm.runInNewContext(script, scriptContext)}), [])
    return null
  })
  const {MarkdownView} = await loadComponent('../../src/reader/MarkdownView.tsx', {
    react: React, 'react-native': {PixelRatio: {get: () => 3}}, 'react-native-webview': {WebView}, './document.ts': {scriptJson}, './markdown.ts': {markdownToHtml: value => {parses++; return markdownToHtml(value)}},
  })
  const render = (initialPosition, markdown = '# Title\n\nStatic outline') => host.render(React.createElement(MarkdownView, {markdown, initialPosition, onLink() {}, onPosition: value => positions.push(value)}))
  await render(120)
  const source = props.source
  scriptContext = {window: webWindow, document: {getElementById: () => content, addEventListener() {}}}
  vm.runInNewContext(/<script>([\s\S]+)<\/script>/.exec(props.source.html)[1], scriptContext)
  await act(async () => props.onLoadEnd())
  assert.equal(parses, 1); assert.equal(replacements, 1); assert.equal(scrolls.at(-1), 40)
  const beforeScrolls = scrolls.length
  for (let y = 1; y <= 50; y++) {
    await act(async () => {props.onScroll({nativeEvent: {contentOffset: {y}}}); props.onScroll({nativeEvent: {contentOffset: {y}}})})
    await render(y * 3)
  }
  assert.equal(props.source, source)
  assert.equal(positions.length, 50, 'Duplicate native offsets are coalesced')
  assert.equal(parses, 1); assert.equal(replacements, 1); assert.equal(scrolls.length, beforeScrolls)
  webWindow.scrollY = 50
  await render(0, '# Title\n\nStreamed addition')
  assert.equal(replacements, 2); assert.equal(scrolls.at(-1), 50, 'A genuine content revision preserves live scroll, not the restore seed')
}))

test('comment focus is consumed once and pending focus is cancelled when backgrounded', nativeBoundary, async () => withNativeHost(async host => {
  const listeners = new Set(), app = {currentState: 'active', addEventListener: (_name, callback) => {listeners.add(callback); return {remove: () => listeners.delete(callback)}}}
  const {CommentPanel} = await loadComponent('../../src/reader/ReaderOverlays.tsx', {react: React, 'react-native': {...host.native, AppState: app},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})}, '../components': host.components, '../theme': {mobileColors, mobileTypography}, './coordinates.ts': coordinates, './model.ts': model, './MarkdownView.tsx': {}, './outline-motion.ts': motion})
  const props = {visible: true, autoFocus: true, allowComment: true, mark, text: 'Quote', draft: '', currentUserAvatar: '', menu: null, t: key => key, onMenu() {}}
  await host.render(React.createElement(CommentPanel, props))
  await host.settle(310)
  assert.equal(host.focused(), 1)
  await host.render(React.createElement(CommentPanel, {...props, autoFocus: false, draft: 'Kept'}))
  await host.render(React.createElement(CommentPanel, {...props, draft: 'Kept'}))
  await host.settle(310)
  assert.equal(host.focused(), 1)
  await host.render(React.createElement(CommentPanel, {...props, visible: false}))
  await host.render(React.createElement(CommentPanel, props))
  await act(async () => {app.currentState = 'background'; [...listeners].forEach(callback => callback('background'))})
  await host.settle(310)
  assert.equal(host.focused(), 1)
}))

for (const end of ['background', 'exit', 'unmount', 'revoke']) test(`pending cache is completed safely on ${end} before document readiness`, nativeBoundary, async () => withNativeHost(async host => {
  await screenFixture(host, {remote: true}, async fixture => {
    assert.equal(fixture.leases(), 1)
    if (end === 'revoke') {fixture.revoke(); await fixture.state('background')}
    else if (end === 'background') await fixture.state('background')
    else if (end === 'exit') await fixture.exit()
    else await host.unmount()
    assert.equal(fixture.calls.filter(value => Array.isArray(value) && value[0] === 'cache-write').length, end === 'revoke' ? 0 : 1)
    assert.equal(fixture.leases(), 0)
    assert.equal(fixture.writes.some(value => value.is_downloaded === 2), end !== 'revoke')
  })
}))

test('valid foreground owner receives one deferred error without remounting the document', nativeBoundary, async () => withNativeHost(async host => {
  await screenFixture(host, {}, async fixture => {
    await fixture.state('background')
    await act(async () => fixture.reader().onError(new Error('Deferred failure')))
    assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
    await fixture.state('active')
    assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, true)
    await act(async () => fixture.dialogs.get('load_bookmark_content_error').onDismiss())
    await fixture.state('background'); await fixture.state('active')
    assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
    assert.equal(fixture.mounts(), 1)
  })
}))

for (const end of ['background', 'exit', 'revoke']) test(`pending foreground recovery does not remount after ${end}`, nativeBoundary, async () => withNativeHost(async host => {
  const flush = deferred()
  await screenFixture(host, {flush}, async fixture => {
    await act(async () => fixture.reader().onError(readerDocumentError(READER_PROCESS_GONE)))
    if (end === 'revoke') fixture.revoke()
    else if (end === 'exit') await fixture.exit()
    else await fixture.state('background')
    await act(async () => flush.resolve())
    assert.equal(fixture.mounts(), 1)
    if (end === 'background') {
      await fixture.state('active')
      assert.equal(fixture.mounts(), 2, 'A suspended, uncommitted recovery can resume within its one-retry budget')
    }
  })
}))
