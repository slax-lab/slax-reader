import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import React, {act} from 'react'
import {PreferenceStore, PREFERENCE_KEYS} from '../../src/data/preferences.ts'
import {MemoryPreferences} from '../data/helpers.ts'
import * as pdfContracts from '@slax-reader/contracts/pdf'
import * as transportErrors from '../../src/data/transport-errors.ts'
import * as pdfErrors from '../../src/reader/pdf-errors.ts'
import * as model from '../../src/reader/model.ts'
import * as account from '../../src/reader/account.ts'
import {ReaderPositionWriter} from '../../src/reader/position.ts'
import {ReaderCrashRecovery} from '../../src/reader/recovery.ts'
import {FixtureActionRouter} from '../../src/components/fixture-actions.ts'
import * as bridge from '../../src/reader/bridge.ts'
import * as coordinates from '../../src/reader/coordinates.ts'
import * as hostGeometry from '../../src/reader/host/geometry.ts'
import * as documentComposer from '../../src/reader/document.ts'
import * as recovery from '../../src/reader/recovery.ts'
import * as input from '../../src/reader/input.ts'
import * as security from '../../src/reader/security.ts'
import {ReaderNativeAttachment} from '../../src/reader/native-attachment.ts'
import {ApiError} from '../../src/data/api.ts'
import {throwIfAborted} from '../../src/utils/abort.ts'
import {resolveGalleryImage} from '../../src/reader/gallery-resource.ts'
import {bookmarkCacheKey} from '../../src/data/repositories.ts'

const require = createRequire(import.meta.url)
let domModule = process.env.SLAX_READER_DOM_MODULE
if (!domModule) {
  try {domModule = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]})} catch {}
}
const {loadComponent, withRenderedElement} = await import('./parity-host.mjs')
const rssExports = {}
const rssCode = ts.transpileModule(await readFile(new URL('../../src/rss/controller.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText
vm.runInNewContext(rssCode, {exports: rssExports, AbortController, Date, URL, Error, require: name => {
  if (name === '../data/api') return {ApiError}
  assert.equal(name, '../utils/abort.ts'); return {throwIfAborted}
}})
const {rssErrorCode} = rssExports

for (const {platform, kind, initialRssError} of [
  {platform: 'ios', kind: 'article'}, {platform: 'android', kind: 'article'},
  {platform: 'ios', kind: 'rss'}, {platform: 'android', kind: 'rss'},
  {platform: 'android', kind: 'collection'},
  {platform: 'ios', kind: 'rss', initialRssError: 'not_found'},
  {platform: 'android', kind: 'rss', initialRssError: 'lab_disabled'},
]) test(`actual ${platform} ${kind} Reader retains source full-window geometry without automatic bookmark writes${initialRssError ? ` after ${initialRssError} load failure` : ''}`, {skip: !domModule && 'An existing happy-dom runtime is required'}, async () => {
  const {Window} = await import(pathToFileURL(domModule).href)
  const window = new Window()
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true})
  const {createRoot} = await import('react-dom/client')
  const preferences = new PreferenceStore(new MemoryPreferences({user_id: 'fixture-user', continue_reading_bookmark: 'previous'}))
  let preferenceWrites = 0, optionWrites = 0, renders = 0, toolbarVisible = false, commentVisible = false, options, readerProps, selectionMenuProps, skeletonProps, galleryProps, refreshRows, articleReads = 0, backBlocked = false, toolbarProps, committedExits = 0
  const bookmarkWrites = [], collectionReads = [], localWrites = [], rssSaves = [], savedEntries = [], imageReads = []
  let failRssSave = true
  let failRssDetail = initialRssError, retryAction, releaseRssDetail, releaseRssSave
  const detailGate = kind === 'rss' ? new Promise(resolve => {releaseRssDetail = resolve}) : Promise.resolve()
  let holdSave = false
  const progressRenders = []
  const SourceCircularProgress = props => {progressRenders.push(props); return null}
  const headerAnimations = []
  const nativeEvents = []
  const originalUpdate = preferences.update.bind(preferences)
  preferences.update = async edit => {
    // Bound a regression failure instead of letting a broken effect consume the test process.
    if (++preferenceWrites > 20) throw new Error('Reader preference effects did not settle')
    return originalUpdate(edit)
  }
  const Context = React.createContext(null)
  const rendered = new Map()
  const primitive = props => {
    if (props.testID) rendered.set(props.testID, props)
    return React.createElement('div', {'data-testid': props.testID}, props.children)
  }
  const nil = () => null
  const components = {SourceDialog: nil, SourceIcon: nil, SourceText: primitive, TextAction: props => {if (props.label === 'rss_retry') retryAction = props; return null}}
  const fixtureActions = new FixtureActionRouter(), stopActions = fixtureActions.activate('fixture-only')
  const session = {status: 'authenticated', session: {token: 'synthetic', userId: 'fixture-user', refreshedAt: 0}}
  const sessions = {getSnapshot: () => session}
  const repositories = {
    local: {read: async () => ({overview: 'Cached overview', outline: 'Cached outline', read_position: '240'}), update: async (...write) => {localWrites.push(write)}},
    getBookmark: async () => ({id: 'fixture-bookmark', title: 'Fixture article', metadata: '{}'}),
    watchUser: callback => {callback({}); return () => {}},
    watchSubscription: callback => {callback([]); return () => {}},
    watchTags: callback => {callback([]); return () => {}},
    watchComments: (_id, callback) => {callback([]); return () => {}},
    watchCollectionSettings: (_owner, callback) => {callback([]); return () => {}},
    watchRows: (_sql, _params, callback) => {refreshRows = callback; callback(); return () => {}},
    updateBookmark: async (...write) => {bookmarkWrites.push(write)},
    markCollectionRead: async (...read) => {collectionReads.push(read)},
  }
  const cache = {readArticle: async () => {articleReads++; return '<p>Fixture article</p>'}, writeArticle() {},
    getResourceUri: async (...request) => {imageReads.push(request); return 'file:///fixture/cached-image.png'},
    ensureImage: async () => {throw new Error('An isolated document fixture must not fetch images')}}
  const api = {
    rssDetail: async () => {await detailGate; if (failRssDetail) throw new Error(failRssDetail); return {id: 'fixture-rss', title: 'Fixture RSS article', content_html: '<p>Fixture RSS article</p>', source_title: 'Fixture feed', article_url: 'https://fixture.test/article'}},
    rssSave: async id => {rssSaves.push(id); if (holdSave) await new Promise(resolve => {releaseRssSave = resolve}); if (failRssSave) throw new Error('invalid_feed'); return {bookmark_user_uuid: 'fixture-saved-bookmark'}},
    getBookmarkRawContent: async () => '<p>Refreshed fixture article</p>',
  }
  const runtime = {beginArticleAccess: () => () => {}, getNativeResourceOwner: () => null, getArticleContent: (_id, _owner, signal) => api.getBookmarkRawContent(_id, signal)}
  const network = {isConnected: true, isInternetReachable: true}
  const telemetry = {element: (...event) => nativeEvents.push(event), firebase: (...event) => nativeEvents.push(event)}
  const boundaries = {
    '@slax-reader/contracts/pdf': pdfContracts, '../data/transport-errors': transportErrors, '../reader/pdf-errors': pdfErrors,
    '../reader/PdfWebView': {PdfWebView: () => assert.fail('An HTML lifecycle fixture must not mount the PDF renderer')},
    react: React,
    'react-native': {ActivityIndicator: nil, Animated: {Value: class {constructor(value) {this.value = value}}, View: primitive,
      timing: (_value, config) => ({start() {headerAnimations.push(config)}, stop() {}})}, Easing: {bezier: (...points) => points},
      AccessibilityInfo: {isReduceMotionEnabled: async () => false, addEventListener: () => ({remove() {}})},
      AppState: {addEventListener: () => ({remove() {}})}, Platform: {OS: platform}, Linking: {}, Pressable: primitive, ScrollView: primitive, StyleSheet: {create: value => value}, TextInput: nil, View: primitive},
    'expo-clipboard': {}, 'expo-network': {}, 'expo-file-system': {}, 'expo/fetch': {fetch: async () => {throw new Error('An isolated document fixture must not fetch images')}}, '@react-navigation/native': {usePreventRemove(blocked) {backBlocked = blocked}},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34, left: 0, right: 0})},
    '../components': components,
    '../components/SourceRing': {SourceCircularProgress},
    '../data': {bookmarkCacheKey, bookmarkDisplayTitle: record => record.title, collectionMarkPolicy: () => ({showMarks: true, showProfile: false}), PERSONAL_MARK_POLICY: {showMarks: true, showProfile: false}, PENDING_COLLECTION_MARK_POLICY: {}, PREFERENCE_KEYS},
    '../runtime': {useReadingMobile: () => React.useContext(Context), useMobile: () => React.useContext(Context), useControlledUpgradeReaderObserver: () => undefined},
    '../rss/controller': {reportRssSaved: (...saved) => savedEntries.push(saved), rssErrorCode}, '../theme': {mobileColors: {}, mobileTypography: {}},
    '../native/reader': {readerNativeAdapter: {}}, '../native/image-actions': {imageActionPort: {save: async () => {}, share: async () => {}}}, '../native/platform': {},
    '../telemetry': {useTelemetry: () => telemetry}, '../reader/share': {},
    '../reader': {ReaderWebView: React.forwardRef((props, ref) => {readerProps = props; React.useImperativeHandle(ref, () => ({commitExit: async () => {committedExits++}, clearSelection: async () => {}, flushPosition: async () => {}}), []); return null}), toolbarVisible: coordinates.toolbarVisible},
    '../reader/input': input,
    '../reader/ReaderOverlays': {CommentPanel: props => {commentVisible = props.visible; return null}, FloatingActions: nil, OutlineSheet: nil, ReaderToolbar: props => {toolbarVisible = props.visible; toolbarProps = props; return null}, SelectionMenu: props => {selectionMenuProps = props; return null}, TranscriptSheet: nil},
    '../reader/ImageGallery': {ImageGallery: props => {galleryProps = props; return null}}, '../reader/OverviewViews': {OverviewDialog: nil, OverviewExcerpt: nil},
    '../reader/components/CommentPanel': {CommentPanel: props => {commentVisible = props.visible; return null}}, '../reader/components/OutlineSheet': {OutlineSheet: nil},
    '../reader/gallery-resource': {resolveGalleryImage},
    '../reader/ReaderSkeleton': {ReaderSkeleton: props => {skeletonProps = props; return null}},
    '../reader/TagSheet': {ReaderTagSheet: nil}, '../reader/model': model,
    '../reader/position': {ReaderPositionWriter}, '../reader/recovery': {ReaderCrashRecovery}, '../reader/account': account,
    '../components/fixture-actions': {fixtureActions},
  }
  const exported = await loadComponent('../../src/screens/ReaderScreen.tsx', boundaries)
  const listeners = new Map()
  const navigation = {isFocused: () => true, setOptions: value => {options = value; optionWrites++}, navigate() {}, goBack() {}, addListener: (name, callback) => {listeners.set(name, callback); return () => listeners.delete(name)}}
  function Harness() {
    const [settings, setSettings] = React.useState({user_id: 'fixture-user'})
    React.useEffect(() => preferences.subscribe(setSettings), [])
    if (++renders > 60) throw new Error('Reader context did not settle')
    // Match the controlled fixture adapter: a preference notification creates new
    // translation and fixtureOnly objects around unchanged account/storage handles.
    const value = {runtime, preferences, sessions, repositories, cache, settings, session, api, t: key => key, config: {platform}, fixtureOnly: {network, dataDirectory: 'fixture-only'}, nativeResourceOwner: null}
    const params = {bookmarkId: 'fixture-bookmark', ...(kind === 'rss' ? {rssEntryId: 'fixture-rss'} : {}), ...(kind === 'collection' ? {collectionOwnerId: 'fixture-owner', collectionId: 'fixture-collection'} : {})}
    return React.createElement(Context.Provider, {value}, React.createElement(exported.ReaderScreen, {navigation, route: {key: 'fixture-reader-route', params}}))
  }
  const root = createRoot(window.document.body)
  try {
    await act(async () => {root.render(React.createElement(Harness)); await new Promise(resolve => setTimeout(resolve, 30))})
    if (kind === 'rss') {
      assert.ok(progressRenders.length, 'A pending real RSS load renders the source default circular indicator')
      assert.equal(progressRenders.at(-1).size, undefined, 'Centered RSS loading selects pinned Material3 defaults rather than the RN 20dp small indicator')
      await act(async () => {releaseRssDetail()})
    }
    await act(async () => {await new Promise(resolve => setTimeout(resolve, 300))})
    if (initialRssError) {
      assert.equal(readerProps, undefined, 'An RSS load failure never substitutes an article error WebView')
      assert.match(window.document.body.textContent, new RegExp(`rss_error_${initialRssError}`))
      assert.equal(backBlocked, false, 'The source centered load error retains genuine native Back')
      assert.ok(retryAction, 'The failed original feed route exposes retry')
      failRssDetail = undefined
      await act(async () => {retryAction.onPress()})
      assert.ok(readerProps, 'A successful retry mounts the actual returned RSS document')
    }
    assert.ok(preferenceWrites <= 2, `Expected bounded entry/title effects, got ${preferenceWrites}`)
    assert.equal((await preferences.read()).continue_reading_bookmark, undefined)
    const before = preferenceWrites
    await act(async () => {await preferences.update(values => {values.user_language = 'en'})})
    assert.equal(preferenceWrites, before + 1, 'A settings notification must not restart Reader entry writes')
    assert.deepEqual(bookmarkWrites, [], 'Opening a cached source Reader must not manufacture an is_read business operation')
    assert.deepEqual(collectionReads, kind === 'collection' ? [['fixture-collection']] : [], 'Source collection last-read remains a distinct operation')
    if (refreshRows) await act(async () => {refreshRows()})
    await act(async () => {readerProps.onEvent({type: 'refreshContent'}, 'fixture-page')})
    assert.deepEqual(bookmarkWrites, [], 'Preference/watch/content refresh must not mark the bookmark read')
    if (kind !== 'rss') {
      assert.ok(articleReads >= 2, 'The actual cached article branch and explicit refresh both ran')
      await act(async () => {await readerProps.onPositionFlush(321, 'background', 'fixture-page')})
      const sourceCacheKey = bookmarkCacheKey('fixture-bookmark', kind === 'collection' ? 'fixture-owner' : undefined)
      assert.equal(JSON.stringify(localWrites.at(-1)), JSON.stringify([sourceCacheKey, {read_position: '321'}]), 'Real local position flush retains its source personal/collection owner key')
      const image = 'slaxstatics://fixture.test/article-image.png'
      await act(async () => {readerProps.onEvent({type: 'imageClick', src: image, allImages: [image]}, 'fixture-page')})
      assert.equal(galleryProps.isActive(), true)
      assert.equal(await galleryProps.resolveUri(image, new AbortController().signal), 'file:///fixture/cached-image.png')
      assert.deepEqual(imageReads, [[sourceCacheKey, image]], 'The actual article gallery resolver retains its source personal/collection cache owner')
      await act(async () => {galleryProps.onDismiss()})
    }
    assert.equal(options.header, undefined, 'The source overlay must not replace the genuine native header/back implementation')
    assert.equal(options.headerTransparent, true, 'Original Reader draws under the native overlay instead of losing toolbar viewport')
    assert.equal(options.headerStyle.backgroundColor, 'transparent')
    if (kind === 'rss') assert.equal(skeletonProps, undefined, 'The original RSS route starts with its own centered loading indicator')
    else assert.equal(skeletonProps.topSpacer, 106, 'Both source platform article skeletons reserve status padding plus 44 before their first 12-point gap')
    await withRenderedElement(readerProps.header, () => {
      const header = rendered.get(kind === 'rss' ? 'reader-rss-header' : 'reader-article-header')
      assert.equal(header.style[1].paddingTop, kind === 'rss' ? 114 : 106, 'Source article/RSS spacers remain 44/52 beneath the actual status inset')
    })
    assert.equal(readerProps.headerSafeAreaPoints, platform === 'ios' ? 62 : 0, 'Only iOS separates WK native safe/header insets; Android scrolls the whole measured header')
    if (kind === 'rss') {
      assert.equal(options.headerRight, undefined, 'Original RSS has genuine Back and no bookmark More action')
      assert.equal(options.unstable_headerRightItems, undefined)
      for (const event of [
        {type: 'textSelected', mark: {stroke: []}, text: 'RSS text', containerYPoints: 12},
        {type: 'markClicked', mark: {id: 'fixture-mark', stroke: [], comments: []}, text: 'RSS text'},
        {type: 'markItemInfosChanged', marks: []}, {type: 'selectionError', error: 'Synthetic RSS selection'},
      ]) await act(async () => {readerProps.onEvent(event, 'fixture-page')})
      assert.equal(selectionMenuProps, undefined, 'RSS native/DOM selection is not an application annotation flow')
      assert.equal(commentVisible, false)
      assert.equal(toolbarVisible, false)
      assert.equal(backBlocked, false, 'Ignored RSS annotation events do not intercept genuine Back')
      const rssImage = 'https://fixture.test/image?m=rss&d=synthetic-image'
      await act(async () => {readerProps.onEvent({type: 'imageClick', src: rssImage, allImages: [rssImage]}, 'fixture-page')})
      assert.equal(JSON.stringify(galleryProps.images), JSON.stringify([rssImage]), 'Source RSS image/gallery remains available for an actual source-compatible image URL')
      assert.equal(galleryProps.isActive(), true)
      assert.equal(await galleryProps.resolveUri(rssImage, new AbortController().signal), 'file:///fixture/cached-image.png')
      assert.deepEqual(imageReads, [['rss-fixture-rss', rssImage]], 'The actual RSS gallery resolver retains its source cache key and isolated local-only path')
      assert.equal(backBlocked, true, 'An actual gallery remains a source transient before native route exit')
      await act(async () => {galleryProps.onDismiss()})
      assert.equal(backBlocked, false)
      const findElement = async (node, id) => {
        rendered.clear()
        return withRenderedElement(node, () => rendered.has(id) ? {props: rendered.get(id)} : undefined)
      }
      const save = await findElement(readerProps.header, 'reader-rss-save')
      assert.ok(save && !save.props.disabled, 'The source RSS header save control remains enabled')
      holdSave = true
      await act(async () => {save.props.onPress()})
      assert.deepEqual(rssSaves, ['fixture-rss'])
      const busySave = await findElement(readerProps.header, 'reader-rss-save')
      assert.equal(busySave.props.disabled, true, 'A pending save prevents a duplicate command while retaining the body')
      const progress = React.Children.toArray(busySave.props.children).find(child => child.type === SourceCircularProgress)
      assert.equal(progress.props.size, 14); assert.equal(progress.props.thickness, 1.5)
      assert.equal(readerProps.html, '<p>Fixture RSS article</p>')
      await act(async () => {releaseRssSave()})
      assert.equal((await findElement(readerProps.header, 'reader-rss-error')).props.children, 'rss_error_source_unavailable', 'A failed RSS save remains an inline source header error')
      assert.equal((await findElement(readerProps.header, 'reader-rss-save')).props.disabled, false, 'The unchanged unsaved entry remains available for retry')
      assert.deepEqual(savedEntries, [], 'A denied save must not report a saved entry')
      assert.equal(backBlocked, false, 'An inline source error does not intercept genuine native Back')
      assert.equal(readerProps.html, '<p>Fixture RSS article</p>', 'A save failure retains the original feed document')
      failRssSave = false
      holdSave = false
      const retrySave = await findElement(readerProps.header, 'reader-rss-save')
      await act(async () => {retrySave.props.onPress()})
      assert.deepEqual(rssSaves, ['fixture-rss', 'fixture-rss'])
      assert.equal(await findElement(readerProps.header, 'reader-rss-error'), undefined, 'Retry clears the prior source error')
      assert.deepEqual(savedEntries, [['fixture-rss', 'fixture-saved-bookmark', 'https://fixture.test/article']])
      assert.equal((await findElement(readerProps.header, 'reader-rss-save')).props.disabled, true, 'The real saved result disables duplicate saves')
      assert.deepEqual(bookmarkWrites, [])
      return
    }
    assert.ok(options.headerRight, 'The source more action belongs next to the genuine native back control')
    await act(async () => readerProps.onEvent({type: 'textSelected', mark: {stroke: []}, text: 'Near status bar', containerYPoints: 12}, 'fixture-page'))
    assert.equal(selectionMenuProps.minTop, platform === 'ios' ? 82 : 60, 'Source full-window menus use iOS status+20 and the Android fixed 60dp minimum')
    assert.equal(options.unstable_headerRightItems()[0].hidesSharedBackground, true, 'The adjacent source more action must not inherit the iOS 26 native back background exception')
    const writesBeforeFlips = optionWrites
    await withRenderedElement(options.headerRight(), async () => {
      assert.equal(rendered.get('reader-header-more-container').pointerEvents, 'auto')
      await act(async () => {readerProps.onPositionChange(240, false)})
      const hiddenMore = rendered.get('reader-header-more-container')
      assert.equal(hiddenMore.pointerEvents, 'none', 'The mounted native header item follows toolbar visibility without new options')
      assert.equal(hiddenMore.accessibilityElementsHidden, true)
      await act(async () => {readerProps.onPositionChange(0, false)})
      assert.equal(rendered.get('reader-header-more-container').pointerEvents, 'auto')
      await act(async () => {readerProps.onPositionChange(240, false)})
    })
    assert.equal(optionWrites, writesBeforeFlips, 'Toolbar flips do not reconfigure the native navigation header')
    await withRenderedElement(options.headerRight(), () => assert.equal(rendered.get('reader-header-more-container').pointerEvents, 'none', 'A fresh header element reads the current visibility'))
    assert.equal(headerAnimations.at(-1).toValue, -100)
    assert.equal(headerAnimations.at(-1).duration, 300)
    assert.equal(headerAnimations.at(-1).useNativeDriver, true)
    await act(async () => {readerProps.onPositionChange(0, false)})
    assert.equal(headerAnimations.at(-1).toValue, 0)
    const button = await withRenderedElement(options.headerRight(), () => ({props: rendered.get('reader-header-more')}))
    assert.equal(button.props.accessibilityLabel, 'detail_toolbar_share')
    await act(async () => {button.props.onPress()})
    assert.equal(toolbarVisible, true)
    assert.deepEqual(nativeEvents, [['detail_toolbar_open', 'detail'], ['bookmark', 'use_toolbar_menu']])
    await act(async () => {toolbarProps.onDismiss()})
    await act(async () => {listeners.get('state')({data: {state: {routes: [{key: 'fixture-reader-route'}]}}})})
    assert.equal(committedExits, 0, 'A retained route after cancellation keeps its reader attached')
    await act(async () => {
      const removed = {data: {state: {routes: [{key: 'fixture-library-route'}]}}}
      listeners.get('state')(removed); listeners.get('state')(removed)
    })
    assert.equal(committedExits, 1, 'Actual route removal commits reader teardown once')
  } finally {
    await act(async () => root.unmount())
    stopActions(); await window.happyDOM.close()
    for (const [name, descriptor] of previous) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]}
  }
})

for (const {controlledDirectory, debug, observes, name} of [
  {controlledDirectory: true, debug: true, observes: true, name: 'isolated document fixture'},
  {controlledDirectory: false, debug: true, observes: true, name: 'original-installation observer without fixture branches'},
  {controlledDirectory: false, debug: false, observes: true, name: 'Release drops an observer and input callbacks'},
  {controlledDirectory: false, debug: true, observes: false, name: 'ordinary Debug omits input observations'},
]) test(`actual iOS Reader observer boundaries (${name})`, {skip: !domModule && 'An existing happy-dom runtime is required'}, async () => {
  const {Window} = await import(pathToFileURL(domModule).href), window = new Window()
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true})
  const {createRoot} = await import('react-dom/client')
  let containerProps, measuredHeaderProps, documentProps, headerStyle
  const NativeView = React.forwardRef(function NativeView(props, ref) {
    React.useImperativeHandle(ref, () => ({measureInWindow: callback => callback(0, 80), setNativeProps(value) {
      if (Array.isArray(props.style) && props.style[0]?.position === 'absolute') headerStyle = [props.style[0], value.style]
    }}), [props.style])
    if (props.testID === 'reader-container') containerProps = props
    else if (props.onLayout) measuredHeaderProps = props
    if (Array.isArray(props.style) && props.style[0]?.position === 'absolute') headerStyle = props.style
    return React.createElement('div', null, props.children)
  })
  const WebView = React.forwardRef(function WebView(props, ref) {
    documentProps = props
    React.useImperativeHandle(ref, () => ({async evaluateJavaScript(script) {
      return vm.runInNewContext(script, {window: {__SlaxReaderHost: {execute(command) {
        if (command.operation === 'scrollTo') {
          nativeCalls.push(['document-scroll', command.argument.y, command.argument.animated])
          documentProps.onScroll({nativeEvent: {contentOffset: {y: command.argument.y}, contentSize: {height: 1200}, layoutMeasurement: {height: 600}}})
        }
        return JSON.stringify({pageId: command.pageId, requestId: command.requestId, status: 'fulfilled', value: null})
      }}}})
    }, stopLoading() {}}), [])
    return null
  })
  const boundaries = {
    react: React,
    'react-native': {AppState: {addEventListener: () => ({remove() {}})}, PixelRatio: {get: () => 3}, Platform: {OS: 'ios'}, ScrollView: NativeView, View: NativeView, StyleSheet: {create: value => value}},
    'react-native-webview': {WebView}, './bridge.ts': bridge, './coordinates.ts': coordinates, './document.ts': documentComposer, './host/geometry.ts': hostGeometry,
    './security.ts': security, '../config': {mobileConfig: {webUrl: 'https://r.slax.com', webDomain: '.slax.com', apiUrl: 'https://api-reader.slax.com', betaApiUrl: 'https://api-reader-beta.slax.com'}},
    './input.ts': input,
    './native-attachment.ts': {ReaderNativeAttachment}, './recovery.ts': recovery, './position.ts': {ReaderPositionWriter},
  }
  const code = ts.transpileModule(await readFile(new URL('../../src/reader/ReaderWebView.tsx', import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText
  const exported = {}
  vm.runInNewContext(code, {exports: exported, __DEV__: debug, setTimeout, clearTimeout, require: name => {
    assert.ok(Object.hasOwn(boundaries, name), `Unexpected Reader boundary: ${name}`)
    return boundaries[name]
  }})
  const reader = React.createRef(), persisted = [], persistedPages = [], published = [], lifecycle = [], observations = [], delivered = [], root = createRoot(window.document.body)
  const positionSnapshot = () => controlledDirectory ? reader.current.inspectFixturePosition() : observations.filter(item => ['native-scroll', 'ready', 'restore'].includes(item.type)).at(-1).event
  const actualLifecycle = () => controlledDirectory ? lifecycle : observations.filter(item => item.type === 'lifecycle').map(item => item.event)
  const nativeCalls = []
  let releaseInsets
  const pendingInsets = new Promise(resolve => {releaseInsets = resolve})
  const nativeAdapter = {
    nativeConfig: () => ({}), attach: async () => {}, subscribeTouch: () => () => {}, setScrollsToTop: async () => {}, detach: async tag => {nativeCalls.push(['detach', tag])},
    updateInsets: async (tag, top, bottom) => {nativeCalls.push(['insets', tag, top, bottom]); await pendingInsets},
    scrollTo: async () => {assert.fail('The original iOS reader restores through its document bridge')},
  }
  try {
    await act(async () => root.render(React.createElement(exported.ReaderWebView, {
      ref: reader, cacheKey: 'fixture-bookmark', ...(controlledDirectory ? {cacheDirectory: '/cache/slax-ui-fixtures/isolated/'} : {}), html: '<p>Original fixture body</p>',
      currentUserId: 7, initialPosition: 240, header: React.createElement('div', null, 'Original article header'), headerSafeAreaPoints: 62,
      nativeAdapter,
      onPositionFlush: (value, _reason, pageId) => {persisted.push(value); persistedPages.push(pageId)}, onPositionChange: value => published.push(value),
      onEvent: (event, pageId) => delivered.push({event, pageId}),
      onFixtureLifecycle: event => lifecycle.push(event),
      onObservation: observes ? event => {observations.push(structuredClone(event)); throw new Error('The controlled writer is unavailable')} : undefined,
    })))
    assert.ok(documentProps.source.html.includes(`"observeInput":${debug && observes}`))
    if (!debug || !observes) {
      assert.ok(documentProps.source.html.includes('"controlledFixture":false'))
      const pageId = /"pageId":"([^"]+)"/.exec(documentProps.source.html)[1]
      await act(async () => {
        const snapshot = {sequence: 0, touchStarts: 0, touchEnds: 0, touchCancels: 0, clicks: 0, selectionChanges: 0,
          bubbleTouchStarts: 0, bubbleTouchEnds: 0, bubbleTouchCancels: 0,
          sourceMarkClicks: 0, sourceSelections: 0, sourceDeselections: 0, sourceErrors: 0, lastDomEventCode: 0, lastSourceEventCode: 0,
          lastTouchCount: 0, lastTouchHadStart: false, lastTouchRangePresent: false, lastTouchRangeCollapsed: null, lastTouchMovedX: null, lastTouchMovedY: null, lastTargetClosestMark: false,
          lastHitClosestMark: false, lastMarkInfoPresent: false, lastMarkCommentCount: 0, monitorPresent: true, monitoring: true,
          pointerDown: false, pendingSelection: false, selectionTimerActive: false, lastSelectionTextLength: 0,
          rangePresent: false, rangeCollapsed: null, rangeInsideMonitor: false, rangeSuppressed: false}
        assert.ok(input.parseReaderInputSnapshot(snapshot))
        for (const payload of [{type: 'inputObservation', snapshot}, {type: 'textDeselected'}]) {
          documentProps.onMessage({nativeEvent: {data: JSON.stringify({channel: 'slax-reader', pageId, payload})}})
        }
      })
      assert.deepEqual(observations, [], 'Release and ordinary Debug do not invoke the controlled observer')
      assert.deepEqual(delivered.map(value => value.event.type), ['textDeselected'], 'Diagnostic messages never reach application actions')
      return
    }
    await act(async () => {containerProps.onLayout({nativeEvent: {layout: {height: 600}}}); measuredHeaderProps.onLayout({nativeEvent: {layout: {height: 200}}})})
    await act(async () => documentProps.onScroll({nativeEvent: {contentOffset: {y: -200}, contentSize: {height: 1200}, layoutMeasurement: {height: 600}}}))
    assert.ok(headerStyle[1].transform[0].translateY === 0, 'A native offset of -headerInset must leave the article header visible')
    const position = positionSnapshot()
    assert.equal(position.requestedPixels, 240)
    assert.equal(position.consumed, false)
    assert.equal(position.observed.scrollPoints, -200)
    assert.equal(position.observed.positionPixels, 0)
    assert.equal(position.geometry.headerHeightPoints, 138)
    assert.equal(position.geometry.topInsetPoints, 200)
    assert.deepEqual(persisted, [], 'An early inset/layout scroll must not overwrite the saved position')
    assert.deepEqual(published, [], 'Toolbar/persistence notifications remain fenced until restore')
    const pageId = position.bridge.pageId
    await act(async () => {
      documentProps.onMessage({nativeEvent: {data: JSON.stringify({channel: 'slax-reader', pageId, payload: {type: 'markClicked', markId: 'known', text: 'not logged', data: {id: 'known', source: [], stroke: [], comments: []}}})}})
      documentProps.onMessage({nativeEvent: {data: JSON.stringify({channel: 'slax-reader', pageId, payload: {type: 'markClicked', markId: 'known', text: 'not logged', data: null}})}})
    })
    assert.deepEqual(observations.filter(value => value.type === 'input').map(value => value.event), [
      {pageId, stage: 'received', eventCode: 1, parsed: true, markValid: true},
      {pageId, stage: 'received', eventCode: 1, parsed: true, markValid: false},
    ])
    assert.equal(delivered.filter(value => value.event.type === 'markClicked').length, 2, 'A failing passive observer does not interrupt the real callback')
    assert.ok(delivered.every(value => value.pageId === pageId))
    await act(async () => {
      for (const payload of [{type: 'contentHeight', height: 1200}, {type: 'domReady'}]) documentProps.onMessage({nativeEvent: {data: JSON.stringify({channel: 'slax-reader', pageId, payload})}})
      documentProps.onLoadEnd()
    })
    assert.equal(positionSnapshot().consumed, false, 'DOM/load/layout readiness must not consume a negative restore before native attachment')
    assert.deepEqual(nativeCalls, [])
    await act(async () => documentProps.onLoadStart({nativeEvent: {target: 47}}))
    assert.ok(nativeCalls.some(call => call[0] === 'insets'))
    assert.ok(!nativeCalls.some(call => call[0] === 'document-scroll'), 'The restore must await the actual native inset promise')
    assert.equal(positionSnapshot().consumed, false)
    await act(async () => {
      // A second layout/document update while native work is held must not start
      // another restore or prematurely consume the first operation.
      containerProps.onLayout({nativeEvent: {layout: {height: 601}}})
      releaseInsets()
      await new Promise(resolve => setTimeout(resolve, 5))
    })
    const restored = positionSnapshot()
    assert.equal(restored.consumed, true)
    assert.equal(restored.observed.positionPixels, 240)
    assert.deepEqual(nativeCalls.filter(call => call[0] === 'document-scroll'), [['document-scroll', -120, false]])
    await act(async () => documentProps.onScroll({nativeEvent: {contentOffset: {y: -50}, contentSize: {height: 1200}, layoutMeasurement: {height: 600}}}))
    assert.equal(headerStyle[1].opacity, 0, 'Source hides the full header when logical offset passes its measured column, excluding status padding')
    await act(async () => {
      documentProps.onMessage({nativeEvent: {data: JSON.stringify({channel: 'slax-reader', pageId, payload: {type: 'scrollToPosition', percentage: .5}})}})
      await new Promise(resolve => setTimeout(resolve, 5))
    })
    assert.deepEqual(nativeCalls.filter(call => call[0] === 'document-scroll').at(-1), ['document-scroll', 400, true])
    await act(async () => {
      documentProps.onMessage({nativeEvent: {data: JSON.stringify({channel: 'slax-reader', pageId, payload: {type: 'scrollToTop'}})}})
      await new Promise(resolve => setTimeout(resolve, 5))
    })
    assert.deepEqual(nativeCalls.filter(call => call[0] === 'document-scroll').at(-1), ['document-scroll', 0, true], 'Original iOS top after an anchor scroll uses document zero, not negative header inset')
    assert.equal(positionSnapshot().observed.positionPixels, 600, 'Document top and persisted logical position are distinct with an iOS inset')
    assert.deepEqual(actualLifecycle().map(event => event.kind), ['mount'], 'Layout, attachment and scroll updates do not dispose an active document')
    assert.deepEqual(nativeCalls.filter(call => call[0] === 'detach'), [], 'Native resources remain attached while the route stays mounted')
    await act(async () => {await reader.current.commitExit(); await reader.current.commitExit()})
    assert.deepEqual(nativeCalls.filter(call => call[0] === 'detach'), [['detach', 47]], 'Committed exit releases the actual attached tag exactly once')
    assert.deepEqual(persisted, [600], 'Committed exit flushes the latest observed position')
    assert.deepEqual(persistedPages, [pageId], 'A queued flush retains its real document identity')
    assert.deepEqual(actualLifecycle().map(event => event.kind), ['mount', 'dispose-requested', 'native-detach-completed', 'position-flush-completed'])
    assert.equal(actualLifecycle().at(-1).reason, 'exit')
    assert.equal(actualLifecycle().at(-1).pageId, pageId)
    assert.ok(observations.some(event => event.type === 'restore' && event.event.consumed && event.event.observed.positionPixels === 240))
    assert.ok(observations.some(event => event.type === 'native-scroll' && event.event.observed.positionPixels === 600))
    if (!controlledDirectory) {
      assert.deepEqual(lifecycle, [], 'The original-installation observer must not turn on the separate document fixture callback')
      assert.throws(() => reader.current.inspectFixturePosition(), /disabled/)
    }
  } finally {
    await act(async () => root.unmount())
    if (debug && observes) {
      assert.equal(actualLifecycle().at(-1).kind, 'unmount')
      assert.equal(actualLifecycle().filter(event => event.kind === 'dispose-requested').length, 1, 'React unmount does not repeat a committed teardown')
    } else assert.deepEqual(observations, [])
    await window.happyDOM.close()
    for (const [name, descriptor] of previous) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]}
  }
})

test('actual Android Reader waits for the native scroll content and viewport before restoring', {skip: !domModule && 'An existing happy-dom runtime is required'}, async () => {
  const {Window} = await import(pathToFileURL(domModule).href), window = new Window()
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true})
  const {createRoot} = await import('react-dom/client')
  let containerProps, measuredHeaderProps, scrollProps, documentProps, appStateChanged
  let nativeContentHeight = 393 + 1, nativeViewportHeight = 914
  const nativeCalls = [], persisted = [], published = []
  const NativeView = React.forwardRef(function NativeView(props, ref) {
    React.useImperativeHandle(ref, () => ({measureInWindow: callback => callback(0, 0)}), [])
    if (props.testID === 'reader-container') containerProps = props
    else if (props.onLayout) measuredHeaderProps = props
    return React.createElement('div', null, props.children)
  })
  const NativeScrollView = React.forwardRef(function NativeScrollView(props, ref) {
    scrollProps = props
    React.useImperativeHandle(ref, () => ({scrollTo({y, animated}) {
      nativeCalls.push({y, animated, nativeContentHeight, nativeViewportHeight})
      // Native ScrollView clamps against its committed content, not the DOM height in JS.
      const actualY = Math.min(y, Math.max(nativeContentHeight - nativeViewportHeight, 0))
      if (actualY > 0) scrollProps.onScroll({nativeEvent: {contentOffset: {y: actualY}, contentSize: {height: nativeContentHeight}, layoutMeasurement: {height: nativeViewportHeight}}})
    }}), [])
    return React.createElement('div', null, props.children)
  })
  const WebView = React.forwardRef(function WebView(props, ref) {
    documentProps = props
    React.useImperativeHandle(ref, () => ({async evaluateJavaScript(script) {
      return vm.runInNewContext(script, {window: {__SlaxReaderHost: {execute(command) {
        return JSON.stringify({pageId: command.pageId, requestId: command.requestId, status: 'fulfilled', value: null})
      }}}})
    }, stopLoading() {}}), [])
    return null
  })
  const boundaries = {
    react: React,
    'react-native': {AppState: {addEventListener: (_type, listener) => {appStateChanged = listener; return {remove() {}}}}, PixelRatio: {get: () => 2.625}, Platform: {OS: 'android'}, ScrollView: NativeScrollView, View: NativeView, StyleSheet: {create: value => value}},
    'react-native-webview': {WebView}, './bridge.ts': bridge, './coordinates.ts': coordinates, './document.ts': documentComposer, './host/geometry.ts': hostGeometry,
    './security.ts': security, '../config': {mobileConfig: {webUrl: 'https://r.slax.com', webDomain: '.slax.com', apiUrl: 'https://api-reader.slax.com', betaApiUrl: 'https://api-reader-beta.slax.com'}},
    './input.ts': input, './native-attachment.ts': {ReaderNativeAttachment}, './recovery.ts': recovery, './position.ts': {ReaderPositionWriter},
  }
  const code = ts.transpileModule(await readFile(new URL('../../src/reader/ReaderWebView.tsx', import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
  }).outputText
  const exported = {}
  vm.runInNewContext(code, {exports: exported, __DEV__: true, setTimeout, clearTimeout, require: name => {
    assert.ok(Object.hasOwn(boundaries, name), `Unexpected Reader boundary: ${name}`)
    return boundaries[name]
  }})
  const reader = React.createRef(), root = createRoot(window.document.body)
  try {
    await act(async () => root.render(React.createElement(exported.ReaderWebView, {
      ref: reader, cacheKey: 'fixture-bookmark', cacheDirectory: '/cache/slax-ui-fixtures/android-layout/', html: '<p>Actual article body</p>',
      currentUserId: 7, initialPosition: 240, header: React.createElement('div', null, 'Article header'),
      onPositionFlush: value => persisted.push(value), onPositionChange: value => published.push(value),
    })))
    const pageId = /"pageId":"([^"]+)"/.exec(documentProps.source.html)[1]
    await act(async () => {
      containerProps.onLayout({nativeEvent: {layout: {height: 914}}})
      measuredHeaderProps.onLayout({nativeEvent: {layout: {height: 393}}})
      for (const payload of [{type: 'contentHeight', height: 1440}, {type: 'domReady'}]) documentProps.onMessage({nativeEvent: {data: JSON.stringify({channel: 'slax-reader', pageId, payload})}})
      documentProps.onLoadEnd()
    })
    assert.deepEqual(nativeCalls, [], 'DOM/load readiness must not issue a command against the old native short content')
    assert.equal(reader.current.inspectFixturePosition().consumed, false)
    await act(async () => {scrollProps.onContentSizeChange(402, nativeContentHeight)})
    assert.deepEqual(nativeCalls, [], 'The initial one-point WebView measurement is not the committed rich document')
    nativeContentHeight = 393 + 1440
    await act(async () => {scrollProps.onContentSizeChange(402, nativeContentHeight)})
    assert.deepEqual(nativeCalls, [], 'Content readiness must also wait for the actual native viewport')
    await act(async () => {scrollProps.onLayout({nativeEvent: {layout: {height: nativeViewportHeight}}})})
    assert.equal(nativeCalls.length, 1)
    assert.equal(nativeCalls[0].y, 240 / 2.625)
    assert.equal(nativeCalls[0].animated, false)
    const restored = reader.current.inspectFixturePosition()
    assert.equal(restored.consumed, true)
    assert.equal(restored.observed.positionPixels, 240, 'The result comes from the actual native scroll callback')
    assert.deepEqual(persisted, [], 'Issuing restoration alone must not invent a persisted position')
    await act(async () => {
      scrollProps.onContentSizeChange(402, nativeContentHeight)
      scrollProps.onLayout({nativeEvent: {layout: {height: nativeViewportHeight}}})
    })
    assert.equal(nativeCalls.length, 1, 'Repeated native layout does not reapply a consumed restore')
    await act(async () => {
      scrollProps.onScroll({nativeEvent: {contentOffset: {y: 200}, contentSize: {height: nativeContentHeight}, layoutMeasurement: {height: nativeViewportHeight}}})
      appStateChanged('background')
    })
    assert.deepEqual(published, [525])
    assert.deepEqual(persisted, [525], 'Background flush writes the latest real native position, not the saved request')
  } finally {
    await act(async () => root.unmount())
    await window.happyDOM.close()
    for (const [name, descriptor] of previous) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]}
  }
})
