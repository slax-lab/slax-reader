import test from 'node:test'
import assert from 'node:assert/strict'
import {React, act, nativeBoundary, loadComponent, withNativeHost} from './parity-host.mjs'
import {PreferenceStore, PREFERENCE_KEYS} from '../../src/data/preferences.ts'
import {MemoryPreferences} from '../data/helpers.ts'
import {bookmarkCacheKey, bookmarkDisplayTitle, collectionMarkPolicy, PERSONAL_MARK_POLICY, PENDING_COLLECTION_MARK_POLICY} from '../../src/data/repositories.ts'
import * as model from '../../src/reader/model.ts'
import * as account from '../../src/reader/account.ts'
import * as input from '../../src/reader/input.ts'
import * as coordinates from '../../src/reader/coordinates.ts'
import {ReaderPositionWriter} from '../../src/reader/position.ts'
import {ReaderCrashRecovery} from '../../src/reader/recovery.ts'
import {resolveGalleryImage} from '../../src/reader/gallery-resource.ts'
import * as outlineMotion from '../../src/reader/outline-motion.ts'
import {mobileColors, mobileTypography} from '../../src/theme/index.ts'

const source = [{type: 'text', path: '/p/text()', start: 0, end: 5}]
const approx = {exact: 'Quote', prefix: 'Before', suffix: 'After', raw_text: 'Quote', position_start: 0, position_end: 5}
const selection = {source: [{type: 'text', xpath: '/p/text()', start_offset: 0, end_offset: 5}], text: 'Quote', approx_source: approx, select_content: [{type: 'text', text: 'Quote', src: ''}]}
const fresh = {id: '', source, approx, stroke: [], comments: []}
const comment = {markId: model.sourceStableId('new-uuid'), userId: model.sourceStableId('fixture-user'), comment: 'First comment', username: 'Fixture', avatar: '', isDeleted: false, createdAt: '2026-10-11 12:00:00', children: []}
const find = (node, predicate) => Array.isArray(node) ? node.map(child => find(child, predicate)).find(Boolean) : React.isValidElement(node) ? predicate(node) ? node : find(node.props.children, predicate) : undefined

async function screenFixture(host, kind, run, platform = 'ios') {
  host.native.Platform.OS = platform
  const preferences = new PreferenceStore(new MemoryPreferences({user_id: 'fixture-user'}))
  let session = {status: 'authenticated', session: {token: 'synthetic', userId: 'fixture-user', refreshedAt: 0}}
  const sessions = {getSnapshot: () => session}
  const Context = React.createContext(null), nil = () => null, owner = {id: 'fixture-owner'}
  const dialogs = new Map(), subscriptions = [], writes = [], deleted = [], copied = [], opened = []
  let readerProps, panelProps, selectionProps, preventRemove, refreshSettings, refreshRows, headerOptions, toolbarModal
  const toolbarLifecycle = [], shares = [], routes = []
  let toolbarPhase = 'hidden', shareFailure = false
  let records = [], settings = {}, params = {bookmarkId: 'bookmark', ...(kind === 'rss' ? {rssEntryId: 'rss'} : {}), ...(kind === 'collection' ? {collectionId: 'collection', collectionOwnerId: 'owner'} : {}), ...(kind === 'missing-owner' ? {collectionId: 'collection'} : {})}
  const repositories = {
    local: {read: async () => ({overview: 'cached', outline: 'cached'}), update: async () => {}},
    getBookmark: async () => ({id: 'bookmark', title: 'Article', aliasTitle: '', url: 'https://fixture.test/original', metadata: '{}'}),
    watchUser: callback => {callback([{id: 'fixture-user', name: 'Fixture'}]); return () => {}},
    watchSubscription: callback => {callback([]); return () => {}}, watchTags: callback => {callback([]); return () => {}},
    watchRows: (_sql, _params, callback) => {refreshRows = callback; return () => {}},
    watchCollectionSettings: (_owner, callback) => {refreshSettings = callback; callback([{allow_highlight: true, show_highlight: true, allow_access: true}]); return () => {}}, markCollectionRead: async () => {},
    watchComments: (id, onRows, onError, options) => {const item = {id, onRows, onError, options, stopped: false}; subscriptions.push(item); onRows(records); return () => {item.stopped = true}},
    addMark: async value => {
      writes.push(value)
      const id = writes.length === 1 ? 'new-uuid' : `recreated-${writes.length}`
      records = [{id, type: value.type, source: JSON.stringify(source), approx_source: JSON.stringify(approx), comment: value.comment ?? '', created_at: '2026-10-11 12:00:00', metadata: JSON.stringify({user_id: 'fixture-user'}), is_deleted: 0}]
      subscriptions.at(-1).onRows(records)
      return id
    }, deleteMark: async (...args) => {
      deleted.push(args)
      records = records.map(record => record.id === args[0] ? {...record, is_deleted: 1} : record)
      subscriptions.at(-1).onRows(records)
    },
  }
  const runtime = {beginArticleAccess: () => () => {}, getNativeResourceOwner: () => owner}
  const api = {rssDetail: async () => ({id: 'rss', title: 'RSS', article_url: 'https://fixture.test/rss-original', content_html: '<p>RSS</p>'}), getMarkUsers: async () => [], streamAi: async function* () {yield {type: 'done'}}}
  const cache = {readArticle: async () => '<p>Article</p>'}, telemetry = {element() {}, firebase() {}}
  const dialogLifecycle = []
  let externalNative
  function NativeDialog(props) {
    const native = React.useRef({phase: 'hidden'}).current
    const isExternal = props.title === 'external_link_alert_title'
    React.useLayoutEffect(() => {
      if (props.visible && ['edit_title_dialog_title', 'bookmark_delete_confirm_title', 'load_bookmark_content_error'].includes(props.title)) toolbarLifecycle.push(`${props.title}:${toolbarPhase}`)
      if (isExternal) {
        if (props.visible) {native.phase = 'presented'; externalNative = native; dialogLifecycle.push('external-presented')}
        else if (native.phase === 'presented') {native.phase = 'dismissing'; dialogLifecycle.push('external-dismissing')}
      } else if (props.title === 'load_bookmark_content_error' && props.visible) {
        dialogLifecycle.push(`error-presented:${externalNative?.phase ?? 'hidden'}`)
      }
    }, [props.visible, isExternal, native, props.title])
    dialogs.set(props.title, {...props, ...(isExternal ? {onDidDismiss() {native.phase = 'dismissed'; dialogLifecycle.push('external-dismissed'); props.onDidDismiss?.()}} : {})})
    return null
  }
  function ToolbarModal(props) {
    React.useLayoutEffect(() => {if (props.visible) {toolbarPhase = 'presented'; toolbarLifecycle.push('presented')} else if (toolbarPhase === 'presented') {toolbarPhase = 'dismissing'; toolbarLifecycle.push('dismissing')}}, [props.visible])
    toolbarModal = {...props, onDismiss() {toolbarPhase = 'dismissed'; toolbarLifecycle.push('dismissed'); props.onDismiss?.()}}
    return props.visible ? React.createElement(host.native.View, props) : null
  }
  const {ReaderToolbar} = await loadComponent('../../src/reader/ReaderOverlays.tsx', {
    react: React, 'react-native': {...host.native, Modal: ToolbarModal}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})},
    '../components': host.components, '../theme': {mobileColors, mobileTypography}, './coordinates.ts': coordinates, './model.ts': model,
    './MarkdownView.tsx': {MarkdownView: nil}, './outline-motion.ts': outlineMotion,
  })
  const boundaries = {
    react: React, 'react-native': host.native, 'expo-clipboard': {setStringAsync: async value => copied.push(value)}, 'expo-network': {getNetworkStateAsync: async () => ({isConnected: false})}, 'expo-file-system': {}, 'expo/fetch': {},
    '@react-navigation/native': {usePreventRemove: (blocked, callback) => {preventRemove = {blocked, callback}}}, 'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})},
    '../components': {...host.components, SourceDialog: NativeDialog}, '../components/SourceRing': {SourceCircularProgress: nil},
    '../data': {bookmarkCacheKey, bookmarkDisplayTitle, collectionMarkPolicy, PERSONAL_MARK_POLICY, PENDING_COLLECTION_MARK_POLICY, PREFERENCE_KEYS},
    '../runtime': {useMobile: () => React.useContext(Context), useControlledUpgradeReaderObserver: () => undefined}, '../rss/controller': {reportRssSaved() {}, rssErrorCode: () => ''}, '../theme': {mobileColors: {}, mobileTypography: {}},
    '../native/reader': {readerNativeAdapter: {}}, '../native/platform': {openInAppBrowser: async url => opened.push(url), shareArticle: async (...args) => {shares.push({args, phase: toolbarPhase}); if (shareFailure) throw new Error('Synthetic share failure')}}, '../telemetry': {useTelemetry: () => telemetry}, '../reader/share': {readerShareImage: async () => null},
    '../reader': {ReaderWebView: React.forwardRef((props, ref) => {readerProps = props; React.useImperativeHandle(ref, () => ({clearSelection: async () => {}, captureSelection: async () => selection, queryImageUrls: async () => [], flushPosition: async () => {}}), []); return null}), toolbarVisible: coordinates.toolbarVisible, composeReaderError: () => '<p>Load error</p>'}, '../reader/input': input,
    '../reader/ReaderOverlays': {CommentPanel: props => {panelProps = props; return null}, SelectionMenu: props => {selectionProps = props; return null}, FloatingActions: nil, OutlineSheet: nil, ReaderToolbar, TranscriptSheet: nil},
    '../reader/ImageGallery': {ImageGallery: nil}, '../reader/gallery-resource': {resolveGalleryImage}, '../reader/OverviewViews': {OverviewDialog: nil, OverviewExcerpt: nil}, '../reader/ReaderSkeleton': {ReaderSkeleton: nil}, '../reader/TagSheet': {ReaderTagSheet: nil},
    '../reader/model': model, '../reader/account': account, '../reader/position': {ReaderPositionWriter}, '../reader/recovery': {ReaderCrashRecovery}, '../components/fixture-actions': {},
  }
  const {ReaderScreen} = await loadComponent('../../src/screens/ReaderScreen.tsx', boundaries)
  const navigation = {addListener: () => () => {}, setOptions(value) {headerOptions = value}, navigate: (...args) => routes.push({args, phase: toolbarPhase}), getState: () => ({routes: [{key: 'reader'}]})}
  const t = key => key
  const render = () => host.render(React.createElement(Context.Provider, {value: {runtime, repositories, api, cache, preferences, settings, session, sessions, t, config: {platform}, nativeResourceOwner: owner}}, React.createElement(ReaderScreen, {navigation, route: {key: 'reader', params}})))
  await render(); await host.settle(300)
  await run({reader: () => readerProps, panel: () => panelProps, selectionMenu: () => selectionProps, back: () => preventRemove, subscriptions, writes, deleted, copied, opened, dialogs, preferences, dialogLifecycle,
    toolbar: () => toolbarModal, toolbarLifecycle, shares, routes, failShare: () => {shareFailure = true},
    openToolbar: () => act(async () => headerOptions.headerRight().props.children.props.onPress()),
    toolbarAction: id => act(async () => host.props.get(`reader-toolbar-${id}`).onPress()),
    render, setSettings: async value => {settings = value; await render()}, settingsChanged: async value => act(async () => refreshSettings([value])),
    setUser: userId => {session = {status: 'authenticated', session: {token: 'synthetic', userId, refreshedAt: 0}}},
    changeRoute: async value => {params = value; await render(); await host.settle(300)}, records: () => records,
  })
}

test('actual Reader first comment updates the open blank-ID panel and retains reply/copy/discard safeguards', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  await act(async () => fixture.reader().onEvent({type: 'textSelected', mark: fresh, text: 'Quote', containerYPoints: 200}, 'page'))
  await act(async () => fixture.selectionMenu().onComment())
  assert.equal(fixture.panel().mark.id, '')
  await act(async () => fixture.panel().onDraft(' First comment '))
  await act(async () => fixture.panel().onSubmit())
  assert.equal(fixture.writes.length, 1)
  assert.equal(fixture.writes[0].comment, 'First comment')
  assert.equal(JSON.stringify(fixture.writes[0].source), JSON.stringify(source))
  const updated = {...fresh, id: 'new-uuid', comments: [comment]}
  await act(async () => fixture.reader().onEvent({type: 'markItemInfosChanged', marks: [updated]}, 'page'))
  assert.equal(fixture.panel().mark.id, 'new-uuid'); assert.equal(fixture.panel().mark.comments.length, 1)
  assert.equal(fixture.panel().text, 'Quote'); assert.equal(fixture.panel().autoFocus, true)
  await act(async () => fixture.panel().onReply(comment))
  await act(async () => fixture.panel().onDraft('Keep reply'))
  await act(async () => fixture.panel().onCopyComment(comment))
  assert.deepEqual(fixture.copied, ['First comment'])
  assert.equal(fixture.panel().draft, 'Keep reply'); assert.equal(fixture.panel().reply, comment)
  await act(async () => fixture.panel().onMenu({markId: comment.markId, x: 10, y: 20}))
  await act(async () => fixture.back().callback())
  assert.equal(fixture.panel().menu, null); assert.equal(fixture.panel().visible, true)
  await act(async () => fixture.back().callback())
  assert.equal(fixture.dialogs.get('comment_panel_discard_title').visible, true)
  const cancel = find(fixture.dialogs.get('comment_panel_discard_title').actions, node => node.props.label === 'comment_panel_discard_cancel')
  await act(async () => cancel.props.onPress())
  assert.equal(fixture.panel().draft, 'Keep reply')
  await act(async () => fixture.panel().onDelete(comment))
  assert.deepEqual(fixture.deleted, [])
  assert.equal(fixture.dialogs.get('comment_panel_confirm_delete').visible, true)
  const confirm = find(fixture.dialogs.get('comment_panel_confirm_delete').actions, node => node.props.label === 'comment_panel_delete')
  await act(async () => confirm.props.onPress())
  assert.equal(fixture.deleted.length, 1); assert.equal(fixture.deleted[0][0], 'new-uuid')
})))

test('actual Reader clears its last deleted comment and adopts a new UUID on the preserved range', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  await act(async () => fixture.reader().onEvent({type: 'textSelected', mark: fresh, text: 'Quote', containerYPoints: 200}, 'page'))
  await act(async () => fixture.selectionMenu().onComment())
  await act(async () => fixture.panel().onDraft('First comment'))
  await act(async () => fixture.panel().onSubmit())
  await act(async () => fixture.reader().onEvent({type: 'markItemInfosChanged', marks: [{...fresh, id: 'new-uuid', comments: [comment]}]}, 'page'))
  await act(async () => fixture.panel().onDelete(comment))
  await act(async () => dialogAction(fixture.dialogs.get('comment_panel_confirm_delete'), 'comment_panel_delete')())
  assert.equal(fixture.reader().marks.mark_list.length, 0, 'Deleting the last comment removes the group from the complete transport')
  await act(async () => fixture.reader().onEvent({type: 'markItemInfosChanged', marks: []}, 'page'))
  assert.equal(fixture.panel().visible, true)
  assert.equal(fixture.panel().text, 'Quote')
  assert.equal(fixture.panel().mark.id, '')
  assert.equal(fixture.panel().mark.comments.length, 0)
  assert.equal(fixture.panel().mark.stroke.length, 0)
  assert.equal(fixture.panel().mark.source, source)
  await act(async () => fixture.panel().onDraft('Recreated comment'))
  await act(async () => fixture.panel().onSubmit())
  assert.equal(fixture.writes.at(-1).type, 2)
  assert.equal(JSON.stringify(fixture.writes.at(-1).source), JSON.stringify(source))
  const recreated = {...comment, markId: model.sourceStableId('recreated-2'), comment: 'Recreated comment'}
  await act(async () => fixture.reader().onEvent({type: 'markItemInfosChanged', marks: [{...fresh, id: 'recreated-2', comments: [recreated]}]}, 'page'))
  assert.equal(fixture.panel().mark.id, 'recreated-2')
  assert.equal(fixture.panel().mark.comments[0].comment, 'Recreated comment')
})))

test('actual selection drops a removed last stroke and adopts same-range recreation without reopening', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  const highlighted = {...fresh, id: 'old-stroke', stroke: [{userId: 1}]}
  await act(async () => fixture.reader().onEvent({type: 'textSelected', mark: highlighted, text: 'Quote', containerYPoints: 200}, 'page'))
  assert.equal(fixture.selectionMenu().hasStroke, true)
  await act(async () => fixture.reader().onEvent({type: 'markItemInfosChanged', marks: []}, 'page'))
  assert.equal(fixture.selectionMenu().hasStroke, false)
  const recreated = {...highlighted, id: 'replacement-stroke'}
  await act(async () => fixture.reader().onEvent({type: 'markItemInfosChanged', marks: [recreated]}, 'page'))
  assert.equal(fixture.selectionMenu().hasStroke, true)
  await act(async () => fixture.selectionMenu().onComment())
  assert.equal(fixture.panel().mark.id, 'replacement-stroke')
  assert.equal(fixture.panel().text, 'Quote')
})))

for (const kind of ['personal', 'rss']) test(`actual ${kind} original bypasses confirmation while body links retain confirmation and preference`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, kind, async fixture => {
  const original = find(fixture.reader().header, node => node.props.onPress && find(node.props.children, child => child.props.children === (kind === 'rss' ? 'rss_original' : 'detail_view_original')))
  assert.ok(original)
  await act(async () => original.props.onPress())
  assert.deepEqual(fixture.opened, [`https://fixture.test/${kind === 'rss' ? 'rss-original' : 'original'}`])
  assert.equal(fixture.dialogs.get('external_link_alert_title').visible, false)
  await act(async () => fixture.reader().onExternalUrl('https://fixture.test/body'))
  assert.equal(fixture.dialogs.get('external_link_alert_title').visible, true)
  assert.equal(fixture.opened.length, 1)
  const confirm = find(fixture.dialogs.get('external_link_alert_title').actions, node => node.props.label === 'btn_confirm')
  await act(async () => confirm.props.onPress())
  assert.equal(fixture.opened.length, 1, 'iOS must wait for native modal dismissal')
  await act(async () => fixture.dialogs.get('external_link_alert_title').onDidDismiss())
  assert.equal(fixture.opened.at(-1), 'https://fixture.test/body')
  await fixture.setSettings({[PREFERENCE_KEYS.detailDoNotAlert]: 'true'})
  await act(async () => fixture.reader().onExternalUrl('https://fixture.test/remembered'))
  assert.equal(fixture.opened.at(-1), 'https://fixture.test/remembered')
  await act(async () => fixture.reader().onExternalUrl('javascript:alert(1)'))
  assert.equal(fixture.opened.length, 3)
})))

test('actual collection watch follows resolved visibility/owner, drops late callbacks and never subscribes without owner', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'collection', async fixture => {
  assert.equal(fixture.subscriptions[0].options.enabled, false)
  const enabled = fixture.subscriptions.at(-1)
  assert.equal(enabled.options.enabled, true); assert.equal(enabled.options.collectionOwnerId, 'owner')
  await act(async () => fixture.reader().onEvent({type: 'markClicked', mark: {...fresh, id: 'existing', comments: [comment]}, text: 'Quote'}, 'page'))
  assert.equal(fixture.panel().visible, true)
  await fixture.settingsChanged({allow_highlight: false, show_highlight: false, allow_access: true})
  assert.equal(enabled.stopped, true)
  assert.equal(fixture.subscriptions.at(-1).options.enabled, false)
  assert.equal(fixture.panel().visible, false)
  await act(async () => enabled.onRows([{id: 'late-private', type: 2, source: '[]', comment: 'private', metadata: '{}', is_deleted: 0}]))
  assert.equal(fixture.reader().marks.mark_list.length, 0)
  await act(async () => fixture.reader().onEvent({type: 'markClicked', mark: {...fresh, comments: [comment]}, text: 'Private'}, 'page'))
  assert.equal(fixture.panel().visible, false)
  await act(async () => fixture.reader().onEvent({type: 'textSelected', mark: {...fresh, stroke: [{userId: 1}], comments: [comment]}, text: 'Quote', containerYPoints: 200}, 'page'))
  assert.equal(fixture.selectionMenu().hasStroke, false)
  assert.equal(fixture.selectionMenu().allowLine, false)
  const count = fixture.subscriptions.length
  await fixture.changeRoute({bookmarkId: 'next', collectionId: 'collection'})
  assert.equal(fixture.subscriptions.length, count, 'A collection route missing owner cannot fall back to a personal watch')
  assert.equal(fixture.subscriptions.at(-1).stopped, true)
  await host.unmount()
  assert.ok(fixture.subscriptions.every(item => item.stopped))
})))

const externalDialog = fixture => fixture.dialogs.get('external_link_alert_title')
const dialogAction = (dialog, label) => find(dialog.actions, node => node.props.label === label).props.onPress
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {resolve = yes; reject = no})
  return {promise, resolve, reject}
}
async function startExternal(fixture, url = 'https://fixture.test/confirmed', remember = false) {
  await act(async () => fixture.reader().onExternalUrl(url))
  if (remember) await act(async () => find(externalDialog(fixture).children, node => node.props.accessibilityRole === 'checkbox').props.onPress())
  const dialog = externalDialog(fixture)
  await act(async () => dialogAction(dialog, 'btn_confirm')())
  return dialog
}

test('iOS confirmation waits for native dismissal and consumes repeated or retired callbacks once', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  const first = await startExternal(fixture)
  assert.equal(externalDialog(fixture).visible, false)
  assert.deepEqual(fixture.opened, [])
  await fixture.render()
  assert.deepEqual(fixture.opened, [], 'A React commit is not UIKit dismissal completion')
  await act(async () => {first.onDidDismiss(); first.onDidDismiss()})
  assert.deepEqual(fixture.opened, ['https://fixture.test/confirmed'])
  const next = await startExternal(fixture, 'https://fixture.test/next')
  await act(async () => first.onDidDismiss())
  assert.equal(fixture.opened.length, 1, 'A retired dialog cannot complete a later intent')
  await act(async () => {next.onDidDismiss(); externalDialog(fixture).onDidDismiss()})
  assert.deepEqual(fixture.opened, ['https://fixture.test/confirmed', 'https://fixture.test/next'])
})))

for (const first of ['dismissal', 'preference']) test(`iOS waits for both native dismissal and saved preference when ${first} completes first`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  const gate = deferred(), update = fixture.preferences.update.bind(fixture.preferences)
  let saves = 0
  fixture.preferences.update = async edit => {saves++; await gate.promise; return update(edit)}
  const dialog = await startExternal(fixture, 'https://fixture.test/remember', true)
  assert.equal(saves, 1)
  assert.deepEqual(fixture.opened, [])
  if (first === 'dismissal') await act(async () => {dialog.onDidDismiss(); dialog.onDidDismiss()})
  else await act(async () => gate.resolve())
  assert.deepEqual(fixture.opened, [])
  if (first === 'dismissal') await act(async () => gate.resolve())
  else await act(async () => dialog.onDidDismiss())
  assert.equal((await fixture.preferences.read())[PREFERENCE_KEYS.detailDoNotAlert], 'true')
  assert.deepEqual(fixture.opened, ['https://fixture.test/remember'])
  await act(async () => dialog.onDidDismiss())
  assert.equal(fixture.opened.length, 1)
})))

for (const dismissed of [false, true]) test(`iOS preference failure drops navigation with native dismissal ${dismissed ? 'already delivered' : 'still pending'}`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  const gate = deferred()
  fixture.preferences.update = () => gate.promise
  const dialog = await startExternal(fixture, 'https://fixture.test/rejected', true)
  assert.deepEqual(fixture.dialogLifecycle, ['external-presented', 'external-dismissing'])
  if (dismissed) await act(async () => dialog.onDidDismiss())
  await act(async () => gate.reject(new Error('Synthetic preference failure')))
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, dismissed, 'A preference failure cannot present a sibling dialog during the native fade-out')
  if (!dismissed) {
    await fixture.render()
    assert.deepEqual(fixture.dialogLifecycle, ['external-presented', 'external-dismissing'])
    await act(async () => dialog.onDidDismiss())
  }
  assert.deepEqual(fixture.dialogLifecycle, ['external-presented', 'external-dismissing', 'external-dismissed', 'error-presented:dismissed'])
  assert.deepEqual(fixture.opened, [])
  assert.equal((await fixture.preferences.read())[PREFERENCE_KEYS.detailDoNotAlert], undefined)
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, true)
  await act(async () => fixture.dialogs.get('load_bookmark_content_error').onDismiss())
  await act(async () => {dialog.onDidDismiss(); dialog.onDidDismiss()})
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false, 'Duplicate native completion cannot replay a consumed error')
  assert.equal(fixture.dialogLifecycle.filter(event => event.startsWith('error-presented:')).length, 1)
})))

for (const change of ['unmount', 'account-snapshot', 'account-render', 'cancel', 'request-close']) test(`pending iOS external intent is dropped on ${change} before dismissal or preference completion`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  const gate = deferred(), update = fixture.preferences.update.bind(fixture.preferences)
  fixture.preferences.update = async edit => {await gate.promise; return update(edit)}
  const dialog = await startExternal(fixture, 'https://fixture.test/abandoned', true)
  if (change === 'unmount') await host.unmount()
  else if (change === 'account-snapshot') fixture.setUser('another-user')
  else if (change === 'account-render') {
    fixture.setUser('another-user'); await fixture.render()
    fixture.setUser('fixture-user'); await fixture.render()
  } else if (change === 'cancel') await act(async () => dialogAction(dialog, 'btn_cancel')())
  else await act(async () => dialog.onDismiss())
  await act(async () => dialog.onDidDismiss())
  if (change === 'account-snapshot') fixture.setUser('fixture-user')
  await act(async () => gate.resolve())
  await act(async () => dialog.onDidDismiss())
  assert.deepEqual(fixture.opened, [], 'A dropped intent cannot revive when asynchronous work completes')
})))

for (const cancel of ['button', 'back', 'request-close']) test(`iOS external ${cancel} cancellation never registers a browser intent`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  await act(async () => fixture.reader().onExternalUrl('https://fixture.test/cancel'))
  const dialog = externalDialog(fixture)
  await act(async () => cancel === 'button' ? dialogAction(dialog, 'btn_cancel')() : cancel === 'back' ? fixture.back().callback() : dialog.onDismiss())
  await act(async () => dialog.onDidDismiss())
  assert.equal(externalDialog(fixture).visible, false)
  assert.deepEqual(fixture.opened, [])
})))

test('Android confirmation does not depend on iOS-only dismissal but still waits for preference success', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  await startExternal(fixture, 'https://fixture.test/android')
  assert.deepEqual(fixture.opened, ['https://fixture.test/android'])
  const gate = deferred(), update = fixture.preferences.update.bind(fixture.preferences)
  fixture.preferences.update = async edit => {await gate.promise; return update(edit)}
  const dialog = await startExternal(fixture, 'https://fixture.test/android-remember', true)
  assert.equal(fixture.opened.length, 1)
  await act(async () => gate.resolve())
  assert.deepEqual(fixture.opened, ['https://fixture.test/android', 'https://fixture.test/android-remember'])
  await act(async () => dialog.onDidDismiss())
  assert.equal(fixture.opened.length, 2)
}, 'android')))

for (const change of ['unmount', 'account-snapshot', 'account-render', 'cancel']) test(`queued iOS external error is discarded on ${change} before native dismissal`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  const gate = deferred(), update = fixture.preferences.update.bind(fixture.preferences)
  fixture.preferences.update = () => gate.promise
  const dialog = await startExternal(fixture, 'https://fixture.test/rejected-abandoned', true)
  await act(async () => gate.reject(new Error('Synthetic preference failure')))
  fixture.preferences.update = update
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
  if (change === 'unmount') await host.unmount()
  else if (change === 'account-snapshot') fixture.setUser('another-user')
  else if (change === 'account-render') {fixture.setUser('another-user'); await fixture.render(); fixture.setUser('fixture-user'); await fixture.render()}
  else await act(async () => dialog.onDismiss())
  await act(async () => dialog.onDidDismiss())
  if (change === 'account-snapshot') fixture.setUser('fixture-user')
  await act(async () => dialog.onDidDismiss())
  assert.deepEqual(fixture.opened, [])
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
  assert.equal(fixture.dialogLifecycle.some(event => event.startsWith('error-presented:')), false)
})))

test('Android preference rejection reports its error without waiting for native modal dismissal', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  const gate = deferred()
  fixture.preferences.update = () => gate.promise
  const dialog = await startExternal(fixture, 'https://fixture.test/android-rejected', true)
  await act(async () => gate.reject(new Error('Synthetic preference failure')))
  assert.deepEqual(fixture.opened, [])
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, true)
  assert.equal(fixture.dialogLifecycle.includes('external-dismissed'), false)
  await act(async () => fixture.dialogs.get('load_bookmark_content_error').onDismiss())
  await act(async () => dialog.onDidDismiss())
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
}, 'android')))

for (const platform of ['ios', 'android']) for (const action of ['edit', 'delete', 'share']) test(`actual ${platform} toolbar ${action} waits for the correct native dismissal boundary`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  await fixture.openToolbar(); const toolbar = fixture.toolbar()
  assert.equal(toolbar.visible, true)
  await fixture.toolbarAction(action)
  assert.equal(fixture.toolbar().visible, false)
  const title = action === 'edit' ? 'edit_title_dialog_title' : 'bookmark_delete_confirm_title'
  if (platform === 'ios') {
    assert.equal(fixture.dialogs.get(title).visible, false); assert.deepEqual(fixture.shares, [])
    await fixture.render()
    assert.equal(fixture.dialogs.get(title).visible, false); assert.deepEqual(fixture.shares, [])
    await act(async () => toolbar.onDismiss())
  }
  if (action === 'share') {assert.equal(fixture.shares.length, 1); if (platform === 'ios') assert.equal(fixture.shares[0].phase, 'dismissed')}
  else {assert.equal(fixture.dialogs.get(title).visible, true); if (platform === 'ios') assert.ok(fixture.toolbarLifecycle.includes(`${title}:dismissed`)); await act(async () => fixture.dialogs.get(title).onDismiss())}
  await act(async () => {toolbar.onDismiss(); toolbar.onDismiss()})
  if (action === 'share') assert.equal(fixture.shares.length, 1); else assert.equal(fixture.dialogs.get(title).visible, false)
}, platform)))

for (const cancel of ['cancel', 'back', 'unmount', 'account', 'account-render']) test(`actual iOS pending toolbar action is discarded on ${cancel}`, nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  await fixture.openToolbar(); const toolbar = fixture.toolbar()
  if (cancel === 'back') await act(async () => fixture.back().callback())
  else {
    await fixture.toolbarAction('share')
    if (cancel === 'cancel') await act(async () => toolbar.onRequestClose())
    else if (cancel === 'unmount') await host.unmount()
    else if (cancel === 'account') fixture.setUser('other')
    else {fixture.setUser('other'); await fixture.render(); fixture.setUser('fixture-user'); await fixture.render()}
  }
  await act(async () => toolbar.onDismiss())
  if (cancel === 'account') fixture.setUser('fixture-user')
  await act(async () => toolbar.onDismiss())
  assert.deepEqual(fixture.shares, [])
})))

test('retired iOS toolbar callbacks cannot replay actions into a replacement toolbar', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  await fixture.openToolbar(); const retired = fixture.toolbar(), retiredAction = host.props.get('reader-toolbar-edit').onPress
  await fixture.toolbarAction('edit')
  await fixture.openToolbar(); await fixture.toolbarAction('share')
  const current = fixture.toolbar()
  await act(async () => {retired.onRequestClose(); retiredAction(); retired.onDismiss()})
  assert.equal(fixture.dialogs.get('edit_title_dialog_title').visible, false); assert.deepEqual(fixture.shares, [])
  await act(async () => current.onDismiss())
  assert.equal(fixture.shares.length, 1)
})))

test('iOS toolbar share failure and routed outline/feedback continue only after native dismissal', nativeBoundary, async () => withNativeHost(async host => screenFixture(host, 'personal', async fixture => {
  fixture.failShare(); await fixture.openToolbar(); await fixture.toolbarAction('share')
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, false)
  await act(async () => fixture.toolbar().onDismiss())
  assert.equal(fixture.dialogs.get('load_bookmark_content_error').visible, true)
  assert.ok(fixture.toolbarLifecycle.includes('load_bookmark_content_error:dismissed'))
  await act(async () => fixture.dialogs.get('load_bookmark_content_error').onDismiss())
  for (const action of ['outline', 'feedback']) {
    const before = fixture.routes.length
    await fixture.openToolbar(); await fixture.toolbarAction(action)
    assert.equal(fixture.routes.length, before)
    await act(async () => fixture.toolbar().onDismiss())
    assert.equal(fixture.routes.length, before + 1)
    assert.equal(fixture.routes.at(-1).phase, 'dismissed')
  }
})))

