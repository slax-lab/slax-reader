import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {DatabaseSync} from 'node:sqlite'
import {OfflineCoordinator} from '../../src/data/offline-coordinator.ts'
import {LocalBookmarkRepository} from '../../src/data/repositories/local-metadata.ts'
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
import {IncrementalMarkdown} from '../../src/reader/markdown.ts'
import {markdownDomScript} from '../../src/reader/markdown-dom.ts'
import {mobileColors, mobileTypography} from '../../src/theme/index.ts'

const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes}); return {promise, resolve}}
const captured = {source: [{type: 'text', xpath: '/p/text()', start_offset: 0, end_offset: 5}], text: 'Quote', approx_source: {exact: 'Quote'}, select_content: [{type: 'text', text: 'Quote', src: ''}]}
const mark = {id: '', source: [], approx: {}, stroke: [], comments: []}

function automaticArticle(owner, persist) {
  const db = new DatabaseSync(':memory:'), watchers = new Set(), files = new Map(), started = deferred(), response = deferred(), writing = deferred(), requests = []
  db.exec(`CREATE TABLE sr_user_bookmark(id TEXT PRIMARY KEY, metadata TEXT, archive_status INTEGER, deleted_at TEXT, created_at TEXT, type INTEGER, updated_at TEXT);
    CREATE TABLE sr_user_collection(id TEXT PRIMARY KEY, owner_id TEXT);
    CREATE TABLE sr_user_collection_subscriber(collection_id TEXT);
    CREATE TABLE sr_collection_bookmark(id TEXT, owner_id TEXT, metadata TEXT, starred_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY, data TEXT);`)
  const key = bookmarkCacheKey('book', owner)
  if (owner) {
    db.prepare('INSERT INTO sr_user_collection VALUES (?, ?)').run('collection', owner)
    db.prepare('INSERT INTO sr_user_collection_subscriber VALUES (?)').run('collection')
    db.prepare('INSERT INTO sr_collection_bookmark VALUES (?, ?, ?, NULL, ?, ?)').run('book', owner, '{"bookmark":{"status":"success"}}', '2026-10-01', 'v1')
  } else db.prepare('INSERT INTO sr_user_bookmark VALUES (?, ?, 0, NULL, ?, 0, ?)').run('book', '{"bookmark":{"status":"success"}}', '2026-10-01', 'v1')
  db.prepare('INSERT INTO ps_data_local__local_bookmark_info VALUES (?, ?)').run(key, '{"read_position":"240","overview":"Cached","outline":"Cached","future":"keep"}')
  let tail = Promise.resolve()
  const transaction = {execute: async (sql, args = []) => db.prepare(sql).run(...args), getOptional: async (sql, args = []) => db.prepare(sql).get(...args) ?? null}
  const database = {...transaction, getAll: async (sql, args = []) => db.prepare(sql).all(...args),
    writeTransaction(work) {
      const result = tail.then(async () => {
        db.exec('BEGIN')
        try {const value = await work(transaction); db.exec('COMMIT'); for (const notify of watchers) notify(); return value}
        catch (error) {db.exec('ROLLBACK'); throw error}
      })
      tail = result.catch(() => undefined); return result
    },
    watch(sql, args, handler, {signal}) {
      const notify = () => {if (!signal.aborted) handler.onResult({rows: {_array: db.prepare(sql).all(...args)}})}
      watchers.add(notify); signal.addEventListener('abort', () => watchers.delete(notify), {once: true}); notify()
    },
  }
  // A minimal stand-in for the native engine: one shared acquisition per key, committed before any reader resolves.
  const listeners = new Set(), flights = new Map(), cancels = new Map(), emit = items => {for (const listener of listeners) listener({owner: 'engine-owner', items})}
  const acquire = (key, id, collectionOwner, manual) => {
    let flight = flights.get(key)
    if (!flight) {
      const controller = new AbortController(), request = {id, owner: collectionOwner, signal: controller.signal}
      flight = {controller, waiters: 0, background: false, promise: (async () => {
        requests.push(request); started.resolve(); emit([{key, state: 'downloading', manual}])
        await response.promise; if (controller.signal.aborted) throw Object.assign(new Error('cancelled'), {code: 'CANCELLED'})
        writing.resolve(); await persist?.promise; files.set(key, '<p>Shared automatic body</p>')
        emit([{key, state: 'complete', manual}]); return files.get(key)
      })().finally(() => flights.delete(key))}
      flights.set(key, flight)
    }
    return flight
  }
  const engine = {
    async open() {return {adopted: [], dropped: [], migrationPending: false}}, async commitMigration() {}, async suspend() {}, resume() {}, async close() {for (const flight of flights.values()) flight.controller.abort()},
    setCredential() {}, setConditions() {}, protect: (_owner, value) => value, release() {}, async evict() {return []},
    cancel(_owner, requestId) {const cancel = cancels.get(requestId); cancels.delete(requestId); cancel?.()},
    applyPlan(_owner, plan) {for (const task of plan.upsert) {const flight = acquire(task.key, task.id, task.collectionOwner, task.manual); flight.background = true; flight.promise.catch(() => undefined)}},
    async readArticle(_owner, value) {return files.get(value) ?? null},
    async fetchArticle(_owner, request) {
      if (files.has(request.key) && !request.force) return files.get(request.key)
      const flight = acquire(request.key, request.id, request.collectionOwner, true); flight.waiters++
      let detached = false
      const detach = () => {if (detached) return; detached = true; if (--flight.waiters === 0 && !flight.background) flight.controller.abort()}
      cancels.set(request.requestId, detach)
      try {return await flight.promise} finally {cancels.delete(request.requestId); detach()}
    },
    addListener(event, listener) {if (event !== 'onStatus') return {remove() {}}; listeners.add(listener); return {remove() {listeners.delete(listener)}}},
  }
  const worker = new OfflineCoordinator({engine, database, preferences: new PreferenceStore(new MemoryPreferences({cache_count: 1, download_images: 0})), assertActive() {}, flushDelayMs: 0,
    scope: {owner: 'engine-owner', scope: '["fixture","user"]', origin: 'https://fixture.test', directory: '/fixture', userAgent: 'fixture', clientType: 'ios', clientVersion: 'fixture'},
    credentials: {current: () => ({token: 'synthetic', reject: async () => false}), subscribe: () => () => {}}})
  return {worker, local: new LocalBookmarkRepository(database), files, key, requests, started, response, writing,
    async close() {response.resolve(); persist?.resolve(); await worker.close(); await worker.settled(); await tail; db.close()}}
}

async function screenFixture(host, options, run) {
  const nil = () => null, dialogs = new Map(), appListeners = new Set(), writes = [], calls = [], timers = []
  const owner = {id: 'owner'}
  let currentOwner = owner, reader, panel, selection, outline, skeleton, mounts = 0, renders = 0, leases = 0
  const accessEvents = []
  const appState = {currentState: 'active', addEventListener: (_name, listener) => {appListeners.add(listener); return {remove: () => appListeners.delete(listener)}}}
  const preferences = new PreferenceStore(new MemoryPreferences({user_id: 'user'}))
  const session = {status: 'authenticated', session: {userId: 'user', token: 'synthetic', refreshedAt: 0}}
  const repositories = {
    local: {read: async key => {calls.push('local-read'); return options.local ? await options.local.promise : options.storage ? options.storage.local.read(key) : {read_position: '240', outline_read_position: '120', overview: 'Cached', outline: 'Cached'}},
      update: async (key, value) => {writes.push(value); if (options.storage) await options.storage.local.update(key, value); if (value.is_downloaded === 2 && options.metadataWrite) await options.metadataWrite.promise}},
    getBookmark: async () => {calls.push('record'); if (options.record) await options.record.promise; return {id: 'book', title: 'Known title', aliasTitle: '', metadata: '{}'}},
    watchUser: callback => {callback([]); return nil}, watchSubscription: callback => {callback([]); return nil}, watchTags: callback => {callback([]); return nil},
    watchRows: () => nil, watchComments: (_id, callback) => {callback([]); return nil},
    watchCollectionSettings: (_owner, callback) => {callback([{allow_highlight: true, show_highlight: true, allow_access: true}]); return nil}, markCollectionRead: async () => {},
    addMark: async value => {calls.push(['addMark', value]); if (options.addMark) await options.addMark.promise},
  }
  const cache = {readArticle: async key => {calls.push('cache-read'); return options.cacheRead ? await options.cacheRead.promise : options.storage ? options.storage.files.get(key) ?? null : options.remote ? null : '<p>Cached body</p>'},
    writeArticle: async () => assert.fail('The offline engine commits article bodies; the Reader never writes them')}
  const api = {getBookmarkRawContent: async () => assert.fail('Reader must acquire HTML through its account resource scheduler'),
    streamAi: async function* (kind) {calls.push(['ai', kind]); yield {type: 'done'}}, getMarkUsers: async () => []}
  const runtime = {getNativeResourceOwner: () => currentOwner, beginArticleAccess: key => {leases++; accessEvents.push(`+${key}`); const release = options.background?.beginForeground(key); return () => {release?.(); leases--; accessEvents.push(`-${key}`)}},
    getArticleContent: async (id, owner, signal, force) => {calls.push('download'); return options.background ? options.background.getArticleContent(id, owner, signal, force) : '<p>Downloaded body</p>'}}
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
    '../components': {...host.components, SourceDialog: props => {dialogs.set(props.title, props); return null}, AppImage: nil}, '../components/SourceRing': {SourceCircularProgress: nil},
    '../data': {bookmarkCacheKey, bookmarkDisplayTitle, collectionMarkPolicy, PERSONAL_MARK_POLICY, PENDING_COLLECTION_MARK_POLICY, PREFERENCE_KEYS},
    '../runtime': {useMobile: () => ({runtime, repositories, cache, api, preferences, session, sessions: {getSnapshot: () => session}, settings: {}, t: key => key, config: {}, nativeResourceOwner: owner}), useControlledUpgradeReaderObserver: () => undefined},
    '../rss/controller': {}, '../theme': {mobileColors, mobileTypography}, '../native/reader': {}, '../native/image-actions': {imageActionPort: {save: async () => {}, share: async () => {}}}, '../native/platform': {}, '../telemetry': {useTelemetry: () => telemetry}, '../reader/share': {},
    '../reader': {ReaderWebView, toolbarVisible: coordinates.toolbarVisible, composeReaderError: () => '<p>Error</p>'}, '../reader/input': input,
    '../reader/ReaderOverlays': {CommentPanel: props => {panel = props; return null}, SelectionMenu: props => {selection = props; return null}, OutlineSheet: props => {outline = props; return null}, FloatingActions: nil, ReaderToolbar: nil, TranscriptSheet: nil},
    '../reader/ImageGallery': {}, '../reader/gallery-resource': {}, '../reader/OverviewViews': {OverviewDialog: nil, OverviewExcerpt: nil}, '../reader/components/CommentPanel': {CommentPanel: props => {panel = props; return null}}, '../reader/components/OutlineSheet': {OutlineSheet: props => {outline = props; return null}}, '../reader/ReaderSkeleton': {ReaderSkeleton: props => {skeleton = props; return null}}, '../reader/TagSheet': {ReaderTagSheet: nil},
    '../reader/model': model, '../reader/account': account, '../reader/position': {ReaderPositionWriter}, '../reader/recovery': {ReaderCrashRecovery}, '../components/fixture-actions': {},
  }
  const sessions = {getSnapshot: () => session}, t = key => key, telemetry = {element() {}, firebase() {}}
  const mobile = {...boundaries['../runtime'].useMobile(), sessions, t}
  boundaries['../runtime'].useMobile = () => mobile
  boundaries['../runtime'].useReadingMobile = () => mobile
  boundaries['../runtime'].useMobileSettings = select => select ? select(mobile.settings) : mobile.settings
  const {ReaderScreen} = await loadComponent('../../src/screens/ReaderScreen.tsx', boundaries, {Error, setTimeout: (callback, ms) => {timers.push(ms); return setTimeout(callback, ms)}})
  const listeners = new Map()
  const navigation = {isFocused: () => true, addListener: (name, callback) => {listeners.set(name, callback); return () => listeners.delete(name)}, setOptions() {}, getState: () => ({routes: [{key: 'reader'}]})}
  await host.render(React.createElement(ReaderScreen, {navigation, route: {key: 'reader', params: {bookmarkId: 'book', title: 'Known title', ...(options.collectionOwner ? {collectionOwnerId: options.collectionOwner, collectionId: 'collection'} : {})}}}))
  await run({reader: () => reader, panel: () => panel, selection: () => selection, outline: () => outline, skeleton: () => skeleton,
    calls, writes, timers, dialogs, mounts: () => mounts, renders: () => renders, leases: () => leases, accessEvents: () => accessEvents,
    revoke: () => {currentOwner = {id: 'next-owner'}},
    state: async value => act(async () => {appState.currentState = value; [...appListeners].forEach(callback => callback(value))}),
    exit: async () => act(async () => listeners.get('state')({data: {state: {routes: []}}})),
  })
}

test('warm reader starts local/cache reads together, reveals known title, and mounts with no minimum timer', nativeBoundary, async () => withNativeHost(async host => {
  const local = deferred(), cacheRead = deferred()
  await screenFixture(host, {local, cacheRead}, async fixture => {
    assert.deepEqual(fixture.calls.filter(value => value !== 'record'), ['local-read', 'cache-read'])
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

test('cached article and local reads start before the bookmark record resolves', nativeBoundary, async () => withNativeHost(async host => {
  const record = deferred(), cacheRead = deferred()
  await screenFixture(host, {record, cacheRead}, async fixture => {
    assert.deepEqual(fixture.calls.filter(value => value !== 'record'), ['local-read', 'cache-read'], 'The committed body is requested concurrently with the record lookup')
    assert.ok(fixture.calls.includes('record'))
    await act(async () => cacheRead.resolve('<p>Early body</p>'))
    assert.equal(fixture.reader(), undefined, 'The body is not published before the record confirms an HTML document')
    await act(async () => record.resolve())
    assert.equal(fixture.reader().html, '<p>Early body</p>')
    assert.equal(fixture.calls.filter(value => value === 'cache-read').length, 1)
    assert.ok(!fixture.calls.includes('download'), 'A cached body never reaches the network path')
  })
}))

test('downloaded content and source restore are usable before the deferred download-state write, which retains its lease', nativeBoundary, async () => withNativeHost(async host => {
  const metadataWrite = deferred()
  await screenFixture(host, {remote: true, metadataWrite}, async fixture => {
    assert.equal(fixture.reader().html, '<p>Downloaded body</p>')
    assert.equal(fixture.reader().initialPosition, 240)
    assert.equal(fixture.writes.some(value => value.is_downloaded === 2), false, 'The resolved download state waits until the document is presentable')
    assert.deepEqual(fixture.accessEvents(), ['+book', '+book'], 'The mounted Reader holds its global reading lease alongside the active document load')
    assert.equal(fixture.leases(), 2)
    await act(async () => fixture.reader().onEvent({type: 'domReady'}, 'page'))
    assert.equal(fixture.writes.filter(value => value.is_downloaded === 2).length, 1)
    assert.equal(fixture.reader().html, '<p>Downloaded body</p>')
    assert.equal(fixture.leases(), 2, 'A held download-state write keeps the document lease until it completes')
    await act(async () => metadataWrite.resolve())
    assert.equal(fixture.leases(), 1, 'The completed document load releases its own lease while the mounted Reader retains the global one')
    assert.equal(fixture.mounts(), 1)
    await host.unmount()
    assert.deepEqual(fixture.accessEvents(), ['+book', '+book', '-book', '-book'])
    assert.equal(fixture.leases(), 0, 'Unmounting the Reader releases the retained global reading lease')
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
  let props, parses = 0, replacements = 0
  const positions = [], scrolls = []
  let scroll = 0, content
  const WebView = React.forwardRef((value, ref) => {
    props = value
    React.useImperativeHandle(ref, () => ({injectJavaScript: script => host.window.eval(script)}), [])
    return null
  })
  class CountingMarkdown extends IncrementalMarkdown {update(markdown) {parses++; return super.update(markdown)}}
  const {MarkdownView} = await loadComponent('../../src/reader/MarkdownView.tsx', {
    react: React, 'react-native': {PixelRatio: {get: () => 3}}, 'react-native-webview': {WebView}, './document.ts': {scriptJson},
    './markdown.ts': {IncrementalMarkdown: CountingMarkdown}, './markdown-dom.ts': {markdownDomScript},
  })
  const render = (initialPosition, markdown = '# Title\n\nStatic outline') => host.render(React.createElement(MarkdownView, {markdown, initialPosition, onLink() {}, onPosition: value => positions.push(value)}))
  await render(120)
  const source = props.source
  Object.defineProperty(host.window, 'scrollY', {get: () => scroll, set: value => {scroll = value}, configurable: true})
  host.window.scrollTo = (_x, y) => {scroll = y; scrolls.push(y)}
  host.window.ReactNativeWebView = {postMessage() {}}
  content = host.window.document.createElement('main'); content.id = 'content'
  const insert = content.insertBefore.bind(content)
  content.insertBefore = (...args) => {replacements++; return insert(...args)}
  host.window.document.body.append(content)
  host.window.eval(/<script>([\s\S]+)<\/script>/.exec(props.source.html)[1])
  await act(async () => props.onLoadEnd())
  assert.equal(parses, 1); assert.equal(replacements, 1); assert.equal(scrolls.at(-1), 40)
  assert.deepEqual(Array.from(content.children, element => element.outerHTML), ['<h1>Title</h1>', '<p>Static outline</p>'])
  const beforeScrolls = scrolls.length
  for (let y = 1; y <= 50; y++) {
    await act(async () => {props.onScroll({nativeEvent: {contentOffset: {y}}}); props.onScroll({nativeEvent: {contentOffset: {y}}})})
    await render(y * 3)
  }
  assert.equal(props.source, source)
  assert.equal(positions.length, 50, 'Duplicate native offsets are coalesced')
  assert.equal(parses, 1); assert.equal(replacements, 1); assert.equal(scrolls.length, beforeScrolls)
  scroll = 50
  const title = content.firstChild
  await render(0, '# Title\n\nStreamed addition')
  assert.equal(replacements, 2); assert.equal(scrolls.at(-1), 50, 'A genuine content revision preserves live scroll, not the restore seed')
  assert.equal(content.firstChild, title, 'The unchanged leading block keeps its retained DOM node')
  assert.deepEqual(Array.from(content.children, element => element.outerHTML), ['<h1>Title</h1>', '<p>Streamed addition</p>'])
}))

test('comment focus is consumed once and pending focus is cancelled when backgrounded', nativeBoundary, async () => withNativeHost(async host => {
  const listeners = new Set(), app = {currentState: 'active', addEventListener: (_name, callback) => {listeners.add(callback); return {remove: () => listeners.delete(callback)}}}
  const {CommentPanel} = await loadComponent('../../src/reader/ReaderOverlays.tsx', {react: React, 'react-native': {...host.native, AppState: app},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})}, '../components': host.components, '../theme': {mobileColors, mobileTypography}, './coordinates.ts': coordinates, './model.ts': model, './MarkdownView.tsx': {}, './outline-motion.ts': motion,
    '../components/SourceSheetModal.tsx': {}, './components/ReaderSheet': {ReaderSheet: props => props.children ?? null}, './components/IconAction': {IconAction: () => null}})
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
    assert.deepEqual(fixture.accessEvents(), ['+book', '+book'], 'The mounted Reader holds its global reading lease alongside the active document load')
    assert.equal(fixture.leases(), 2)
    if (end === 'revoke') {fixture.revoke(); await fixture.state('background')}
    else if (end === 'background') await fixture.state('background')
    else if (end === 'exit') await fixture.exit()
    else await host.unmount()
    if (end === 'unmount') assert.equal(fixture.leases(), 0, 'Unmounting releases every reading lease')
    else assert.equal(fixture.leases(), 1, 'The document load releases its own lease while the still-mounted Reader retains the global one')
    assert.equal(fixture.writes.some(value => value.is_downloaded === 2), end !== 'revoke')
    if (end !== 'unmount') {await host.unmount(); assert.equal(fixture.leases(), 0, 'Unmounting the Reader releases the retained global reading lease')}
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

for (const collectionOwner of [undefined, 'shared-owner']) test(`mounted ${collectionOwner ? 'collection' : 'personal'} Reader joins automatic HTML and preserves the same owner cache and position`, nativeBoundary, async () => withNativeHost(async host => {
  const storage = automaticArticle(collectionOwner)
  try {
    storage.worker.start(); await storage.started.promise
    await screenFixture(host, {remote: true, background: storage.worker, storage, collectionOwner}, async fixture => {
      assert.equal(fixture.calls.filter(value => value === 'download').length, 1)
      assert.equal(storage.requests.length, 1); assert.equal(storage.requests[0].owner, collectionOwner)
      assert.equal(fixture.reader(), undefined)
      await act(async () => {storage.response.resolve(); await storage.worker.settled()})
      assert.equal(fixture.reader().html, '<p>Shared automatic body</p>'); assert.equal(fixture.reader().initialPosition, 240)
      assert.equal(fixture.mounts(), 1); assert.equal(fixture.timers.includes(250), false)
      await act(async () => fixture.reader().onEvent({type: 'domReady'}, 'page'))
      assert.equal(storage.requests.length, 1); assert.equal(storage.files.get(storage.key), '<p>Shared automatic body</p>')
      const local = await storage.local.read(storage.key)
      assert.equal(local.is_downloaded, 2); assert.equal(local.is_auto_cached, 0); assert.equal(local.future, 'keep')
      assert.equal(fixture.leases(), 1, 'The completed shared body releases the document lease while the mounted Reader retains the global one')
      await host.unmount()
      assert.equal(fixture.leases(), 0, 'Unmounting the Reader releases the retained global reading lease')
    })
  } finally {await storage.close()}
}))

test('unmounting a Reader detaches its shared body consumer while the automatic transfer commits safely', nativeBoundary, async () => withNativeHost(async host => {
  const storage = automaticArticle()
  try {
    storage.worker.start(); await storage.started.promise
    await screenFixture(host, {remote: true, background: storage.worker, storage}, async fixture => {
      assert.equal(fixture.calls.filter(value => value === 'download').length, 1)
      await host.unmount(); assert.equal(fixture.leases(), 0)
      assert.equal(storage.requests[0].signal.aborted, false)
      storage.response.resolve(); await storage.worker.settled()
      assert.equal(storage.requests.length, 1); assert.equal(storage.files.get(storage.key), '<p>Shared automatic body</p>')
      assert.equal((await storage.local.read(storage.key)).is_downloaded, 2)
    })
  } finally {await storage.close()}
}))

test('a Reader-only body request aborts the actual transport on unmount with no late cache or metadata completion', nativeBoundary, async () => withNativeHost(async host => {
  const storage = automaticArticle()
  try {
    await screenFixture(host, {remote: true, background: storage.worker, storage}, async fixture => {
      await storage.started.promise; await host.unmount()
      assert.equal(storage.requests[0].signal.aborted, true); assert.equal(fixture.leases(), 0)
      storage.response.resolve(); await storage.worker.settled()
      assert.equal(storage.files.size, 0); assert.notEqual((await storage.local.read(storage.key)).is_downloaded, 2)
      assert.equal(fixture.mounts(), 0)
    })
  } finally {await storage.close()}
}))
