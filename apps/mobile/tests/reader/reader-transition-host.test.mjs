import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {React, act, loadComponent, nativeBoundary, withNativeHost} from './parity-host.mjs'
import * as bridge from '../../src/reader/bridge.ts'
import * as coordinates from '../../src/reader/coordinates.ts'
import * as hostGeometry from '../../src/reader/host/geometry.ts'
import * as documentComposer from '../../src/reader/document.ts'
import * as recovery from '../../src/reader/recovery.ts'
import * as input from '../../src/reader/input.ts'
import * as security from '../../src/reader/security.ts'
import {ReaderNativeAttachment} from '../../src/reader/native-attachment.ts'
import {ReaderPositionWriter} from '../../src/reader/position.ts'

const envelope = (pageId, payload) => JSON.stringify({channel: 'slax-reader', pageId, payload})

async function lifecycleProbe(host, {routes, timers}) {
  const listeners = new Map(), removed = []
  const navigation = {isFocused: () => true, getState: () => ({routes}),
    addListener(name, callback) {listeners.set(name, callback); return () => {removed.push(name); if (listeners.get(name) === callback) listeners.delete(name)}}}
  const {useReaderLifecycle, READER_TRANSITION_FALLBACK_MS} = await loadComponent('../../src/reader/state/useReaderLifecycle.ts', {react: React,
    'react-native': {...host.native, AppState: {currentState: 'active', addEventListener: () => ({remove() {}})}}, '../../data': {PREFERENCE_KEYS: {continueReading: 'continue_reading_bookmark'}}},
  timers ? {setTimeout: (callback, ms) => {timers.push({callback, ms}); return timers.length}, clearTimeout: id => {if (timers[id - 1]) timers[id - 1].cleared = true}} : {})
  const states = [], busy = []
  function Probe() {
    const life = useReaderLifecycle({cacheKey: 'key', bookmarkId: 'book', isPreview: false}, {navigation, routeKey: 'reader', t: key => key, isAccountActive: () => true, writePreferences: async () => {},
      setInteractionBusy: (value, source) => busy.push([value, source])})
    states.push(life.transitionReady)
    return null
  }
  await host.render(React.createElement(Probe))
  return {listeners, removed, states, busy, READER_TRANSITION_FALLBACK_MS}
}

test('Reader host readiness follows the native push transition, ignores closing transitions and cleans up', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const timers = []
    const probe = await lifecycleProbe(host, {routes: [{key: 'library'}, {key: 'reader'}], timers})
    assert.equal(probe.states.at(-1), false, 'A pushed Reader does not mount its document host during the transition')
    assert.deepEqual(probe.busy, [[true, 'transition:reader']], 'The push transition defers status persistence')
    assert.equal(timers.length, 1)
    assert.equal(timers[0].ms, probe.READER_TRANSITION_FALLBACK_MS)
    assert.equal(probe.READER_TRANSITION_FALLBACK_MS, 600)
    await act(async () => probe.listeners.get('transitionEnd')({data: {closing: true}}))
    assert.equal(probe.states.at(-1), false, 'A closing transition never reports readiness')
    assert.deepEqual(probe.busy, [[true, 'transition:reader']], 'A closing transition does not end the push deferral')
    await act(async () => probe.listeners.get('transitionEnd')({data: {closing: false}}))
    assert.equal(probe.states.at(-1), true)
    assert.deepEqual(probe.busy, [[true, 'transition:reader'], [false, 'transition:reader']], 'The deferral ends exactly once with the transition')
    assert.equal(timers[0].cleared, true, 'The fallback is cancelled once the transition settled')
    assert.ok(probe.removed.includes('transitionEnd') && probe.removed.includes('gestureCancel'), 'Transition listeners are removed after readiness')
    assert.equal(probe.listeners.has('transitionStart'), false, 'A later pop transition cannot unmount the document host')
  })
})

test('Reader host readiness settles on a cancelled back gesture, on the fallback, or immediately for the first route', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const cancelled = await lifecycleProbe(host, {routes: [{key: 'library'}, {key: 'reader'}], timers: []})
    await act(async () => cancelled.listeners.get('gestureCancel')())
    assert.equal(cancelled.states.at(-1), true)
    assert.deepEqual(cancelled.busy.at(-1), [false, 'transition:reader'])
    await host.unmount()
  })
  await withNativeHost(async host => {
    const unmounted = await lifecycleProbe(host, {routes: [{key: 'library'}, {key: 'reader'}], timers: []})
    await host.unmount()
    assert.deepEqual(unmounted.busy, [[true, 'transition:reader'], [false, 'transition:reader']], 'Unmounting mid-transition clears the deferral')
  })
  await withNativeHost(async host => {
    const timers = []
    const fallback = await lifecycleProbe(host, {routes: [{key: 'library'}, {key: 'reader'}], timers})
    await act(async () => timers[0].callback())
    assert.equal(fallback.states.at(-1), true, 'A stack that never reports the transition end still mounts the host')
    await host.unmount()
  })
  await withNativeHost(async host => {
    const timers = []
    const first = await lifecycleProbe(host, {routes: [{key: 'reader'}], timers})
    assert.equal(first.states.at(-1), true, 'The first route has no push transition to wait for')
    assert.equal(timers.length, 0); assert.deepEqual(first.busy, [])
  })
})

async function contentHarness(host, platform = 'android') {
  const {installedMotionHost} = await import('../ui/installed-motion-host.mjs')
  const motion = installedMotionHost(host.native.View)
  const timing = motion.reanimated.withTiming, timings = []
  motion.reanimated = {...motion.reanimated, withTiming: (value, config, callback) => {timings.push(config); return timing(value, config, callback)}}
  const hosts = []
  const ReaderWebView = props => {hosts.push(props); return React.createElement(host.native.View, {testID: 'reader-document-host'})}
  const {ReaderContent} = await loadComponent('../../src/reader/components/ReaderContent.tsx', {react: React, 'react-native': {...host.native, Platform: {OS: platform}},
    'react-native-reanimated': motion.reanimated, '../../components': {SourceText: host.native.View, TextAction: host.native.View},
    '../../components/SourceRing': {SourceCircularProgress: () => null}, '../../theme': {mobileColors: {}, mobileTypography: {}},
    '../index': {ReaderWebView}, '../ReaderSkeleton': {ReaderSkeleton: props => React.createElement(host.native.View, {testID: 'skeleton-content'}, props.header)},
    '../PdfWebView': {PdfWebView: () => assert.fail('An article never mounts the PDF renderer')}})
  const base = {isPdf: false, isPreview: false, pdfProps: null, htmlProps: {html: '<p>Article</p>'}, top: 62, header: React.createElement('header'), title: 'Title',
    contentError: null, nativeFailure: null, rssError: null, t: key => key, reload() {}, retryPdf() {}, retryNative() {}}
  const render = props => host.render(React.createElement(ReaderContent, {...base, ...props}))
  const cover = () => host.window.document.querySelector('[data-testid="reader-loading-cover"]')
  const mounted = () => host.window.document.querySelector('[data-testid="reader-document-host"]') !== null
  return {motion, hosts, render, cover, mounted, timings}
}

test('iOS Reader content creates its host beneath the skeleton during the push and reveals it only when presentable, with no overlay afterwards', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const content = await contentHarness(host, 'ios')
    await content.render({loading: true, html: null, hostKey: 'k:1', transitionReady: false})
    assert.equal(content.mounted(), false, 'No host exists before the document is composed')
    const loadingCover = content.cover()
    await content.render({loading: false, html: '<p>Article</p>', hostKey: 'k:1', transitionReady: false})
    assert.equal(content.mounted(), true, 'iOS creates the native host before transitionEnd')
    assert.equal(content.cover(), loadingCover, 'The same skeleton keeps covering the new host')
    assert.equal(host.props.get('reader-loading-cover').pointerEvents, 'auto')
    const mountedHosts = content.hosts.length
    await content.render({loading: false, html: '<p>Article</p>', hostKey: 'k:1', transitionReady: true})
    assert.equal(content.mounted(), true)
    assert.equal(content.cover(), loadingCover, 'The settled transition neither remounts the host nor reveals it')
    assert.ok(content.hosts.length >= mountedHosts)
    await act(async () => content.hosts.at(-1).onPresentable('page-1'))
    assert.equal(host.props.get('reader-loading-cover').pointerEvents, 'none', 'Only presentable reveals the document')
    await act(async () => content.motion.advance(1000))
    assert.equal(content.cover(), null, 'After the fade no overlay remains to take touches')
    await content.render({loading: false, html: '<p>Preview</p>', hostKey: 'rss:1', transitionReady: false, isPreview: true})
    assert.equal(content.mounted(), true, 'An iOS RSS preview host is also created during the push')
  })
})

test('Android preview waits for the push transition before creating its host', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const content = await contentHarness(host, 'android')
    await content.render({loading: false, html: '<p>Preview</p>', hostKey: 'rss:1', transitionReady: false, isPreview: true})
    assert.equal(content.mounted(), false)
    await content.render({loading: false, html: '<p>Preview</p>', hostKey: 'rss:1', transitionReady: true, isPreview: true})
    assert.equal(content.mounted(), true)
  })
})

test('Android Reader content keeps one skeleton cover from loading until the mounted host is presentable, then fades it out', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const content = await contentHarness(host)
    await content.render({loading: true, html: null, hostKey: 'k:1', transitionReady: false})
    assert.ok(content.cover()?.querySelector('[data-testid="skeleton-content"] header'), 'Loading shows the skeleton with the known header')
    assert.equal(content.mounted(), false)
    await content.render({loading: false, html: '<p>Article</p>', hostKey: 'k:1', transitionReady: false})
    assert.equal(content.mounted(), false, 'An Android composed document still waits for the push transition before creating its native host')
    const loadingCover = content.cover()
    await content.render({loading: false, html: '<p>Article</p>', hostKey: 'k:1', transitionReady: true})
    assert.equal(content.mounted(), true)
    assert.equal(content.cover(), loadingCover, 'The skeleton is not remounted when the host appears beneath it')
    assert.equal(host.props.get('reader-loading-cover').pointerEvents, 'auto')
    assert.equal(host.props.get('reader-loading-cover').accessibilityElementsHidden, true)
    const presentable = content.hosts.at(-1).onPresentable
    assert.equal(typeof presentable, 'function')
    content.motion.setReducedMotion(true)
    await act(async () => presentable('page-1'))
    assert.ok(content.cover(), 'The cover fades instead of disappearing in one frame')
    assert.equal(host.props.get('reader-loading-cover').pointerEvents, 'none', 'A fading cover never blocks the revealed document')
    assert.equal(content.motion.started.at(-1).toValue, 0)
    assert.equal(content.motion.started.at(-1).reduceMotion, true, 'The fade resolves the system reduced-motion setting')
    assert.equal(content.timings.at(-1).duration, 120, 'The reveal is a short fade')
    await act(async () => content.motion.advance(1000))
    assert.equal(content.cover(), null)
    const renders = content.hosts.length
    await content.render({loading: false, html: '<p>Article</p>', hostKey: 'k:1', transitionReady: true})
    assert.equal(content.hosts.at(-1).onPresentable, presentable, 'The memoized document host receives a stable presentable callback')
    assert.ok(content.hosts.length >= renders)
    await content.render({loading: false, html: '<p>Article</p>', hostKey: 'k:2', transitionReady: true})
    assert.ok(content.cover(), 'A replacement document host is covered again until it is presentable')
    await act(async () => presentable('late-page'))
    assert.equal(host.props.get('reader-loading-cover').pointerEvents, 'auto', 'A retired host cannot reveal its replacement')
    await content.render({loading: false, html: '<p>Article</p>', hostKey: 'k:2', transitionReady: true, nativeFailure: 'Interrupted'})
    assert.equal(host.props.get('reader-loading-cover').pointerEvents, 'none', 'A native failure reveals the retry surface instead of an endless skeleton')
    assert.ok(host.window.document.querySelector('[data-testid="reader-native-retry"]'), 'Its retry banner is shown')
    await content.render({loading: false, html: '<p>Article</p>', hostKey: 'k:3', transitionReady: true})
    assert.equal(host.props.get('reader-loading-cover').pointerEvents, 'auto')
    await content.render({loading: false, html: '<p>Article</p>', hostKey: 'k:3', transitionReady: true, contentError: 'Refresh failed'})
    assert.equal(host.props.get('reader-loading-cover').pointerEvents, 'none', 'A content error uncovers the article at once beneath its banner')
    await content.render({loading: false, html: '<p>Article</p>', hostKey: 'k:3', transitionReady: true})
    await act(async () => content.hosts.at(-1).onPresentable('page-3'))
    await act(async () => content.motion.advance(1000))
    assert.equal(content.cover(), null)
    await content.render({loading: false, html: '<p>Refreshed article</p>', htmlProps: {html: '<p>Refreshed article</p>'}, hostKey: 'k:3', transitionReady: true})
    assert.ok(content.cover(), 'A forced reload publishing new HTML under the same host key is covered again')
    assert.equal(host.props.get('reader-loading-cover').pointerEvents, 'auto')
    await act(async () => content.hosts.at(-1).onPresentable('page-3b'))
    assert.equal(host.props.get('reader-loading-cover').pointerEvents, 'none', 'The new page reveals itself once presentable')
  })
})

async function readerPage(host, platform, adapterOverrides = {}, handleOverrides = {}, globals = {}) {
  let documentProps, outerProps, headerProps, renders = 0
  const insets = [], presentable = []
  const View = React.forwardRef((props, ref) => {
    if (props.onLayout && !props.testID) headerProps = props
    return React.createElement(host.native.View, {...props, ref})
  })
  const scrolls = []
  const ScrollView = React.forwardRef((props, ref) => {
    outerProps = props
    React.useImperativeHandle(ref, () => ({scrollTo: value => scrolls.push(value)}), [])
    return React.createElement(host.native.ScrollView, props)
  })
  const commands = []
  const WebView = React.forwardRef((props, ref) => {
    documentProps = props; renders++
    React.useImperativeHandle(ref, () => ({stopLoading() {}, evaluateJavaScript: async script => vm.runInNewContext(script, {
      window: {__SlaxReaderHost: {execute: command => {commands.push(command); return JSON.stringify({pageId: command.pageId, requestId: command.requestId, status: 'fulfilled', value: null})}}},
    }), ...handleOverrides}), [])
    return null
  })
  const adapter = {HostComponent: WebView, nativeConfig: context => ({props: context}), attach() {}, subscribeTouch: () => () => {},
    updateInsets: (tag, top, bottom) => {insets.push([tag, top, bottom])}, setScrollsToTop() {}, detach() {}, scrollTo() {}, ...adapterOverrides}
  const {ReaderWebView} = await loadComponent('../../src/reader/ReaderWebView.tsx', {
    react: React, 'react-native': {...host.native, View, ScrollView, Platform: {OS: platform}, PixelRatio: {get: () => 3},
      AppState: {currentState: 'active', addEventListener: () => ({remove() {}})}},
    'react-native-webview': {WebView}, './bridge.ts': bridge, './coordinates.ts': coordinates, './document.ts': documentComposer, './host/geometry.ts': hostGeometry,
    './security.ts': security, '../config': {mobileConfig: {webUrl: 'https://r.slax.com', webDomain: '.slax.com', apiUrl: 'https://api-reader.slax.com', betaApiUrl: 'https://api-reader-beta.slax.com'}},
    './input.ts': input, './native-attachment.ts': {ReaderNativeAttachment}, './recovery.ts': recovery, './position.ts': {ReaderPositionWriter},
  }, {Error, ...globals})
  const ref = React.createRef()
  const element = props => React.createElement(ReaderWebView, {ref, cacheKey: 'fixture', cacheDirectory: '/cache/slax-ui-fixtures/scroll/', html: '<p>Article</p>', currentUserId: 7,
    nativeAdapter: adapter, header: React.createElement('div', null, 'Header'), headerSafeAreaPoints: 62, initialPosition: 300, onPresentable: pageId => presentable.push(pageId), ...props})
  await host.render(element({}))
  const pageId = /"pageId":"([^"]+)"/.exec(documentProps.source.html)[1]
  const send = payload => documentProps.onMessage({nativeEvent: {data: envelope(pageId, payload)}})
  return {ref, insets, presentable, scrolls, commands, pageId, send, element, renders: () => renders, documentProps: () => documentProps, outerProps: () => outerProps,
    header: () => headerProps}
}

test('iOS Reader skips identical native inset updates and restores once', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const page = await readerPage(host, 'ios')
    await act(async () => {
      host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
      page.documentProps().onLoadStart({nativeEvent: {target: 47}})
      page.send({type: 'contentHeight', height: 1200})
      page.send({type: 'domReady'})
      page.documentProps().onLoadEnd()
    })
    await act(async () => page.header().onLayout({nativeEvent: {layout: {height: 200}}}))
    await host.settle(10)
    assert.equal(page.ref.current.inspectFixturePosition().consumed, true)
    const applied = page.insets.length
    assert.ok(applied >= 1)
    assert.equal(new Set(page.insets.map(value => value.join(':'))).size, page.insets.length, 'No identical native inset update is sent twice')
    await act(async () => {for (let index = 0; index < 5; index++) page.send({type: 'contentHeight', height: 1300 + index})})
    await host.settle(10)
    assert.equal(page.insets.length, applied, 'Rerenders with unchanged insets do not reach native')
  })
})

test('a failed native inset update is retried instead of being deduplicated away', nativeBoundary, async () => {
  await withNativeHost(async host => {
    let fail = true
    const calls = []
    const errors = []
    const page = await readerPage(host, 'ios', {updateInsets: async (...args) => {calls.push(args); if (fail && args[1] === 200) {fail = false; throw new Error('Native inset failed')}}})
    await host.render(page.element({onError: error => errors.push(error.message)}))
    await act(async () => {
      host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
      page.documentProps().onLoadStart({nativeEvent: {target: 47}})
      page.send({type: 'contentHeight', height: 1200})
      page.send({type: 'domReady'})
      page.documentProps().onLoadEnd()
    })
    await act(async () => page.header().onLayout({nativeEvent: {layout: {height: 200}}}))
    await host.settle(10)
    assert.ok(errors.length >= 1 && errors.every(message => message === 'Native inset failed'))
    assert.equal(page.ref.current.inspectFixturePosition().consumed, false)
    await act(async () => page.send({type: 'contentHeight', height: 1250}))
    await host.settle(10)
    assert.equal(calls.filter(value => value.join(':') === '47:200:0').length, 2, 'The failed insets are sent again instead of being treated as applied')
    assert.equal(page.ref.current.inspectFixturePosition().consumed, true, 'Restore proceeds once the retried insets succeed')
  })
})

test('android natively sized document stops rerendering for height changes after restore', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const page = await readerPage(host, 'android', {appliesContentHeight: true})
    assert.equal(page.documentProps().style.height, undefined, 'The native host owns the WebView height')
    assert.equal(page.documentProps().containerStyle.height, undefined)
    await act(async () => {
      host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
      page.header().onLayout({nativeEvent: {layout: {height: 200}}})
      page.documentProps().onLoadStart({nativeEvent: {target: 47}})
      page.send({type: 'contentHeight', height: 1200})
      page.send({type: 'domReady'})
      page.documentProps().onLoadEnd()
    })
    await act(async () => {page.outerProps().onLayout({nativeEvent: {layout: {height: 600}}}); page.outerProps().onContentSizeChange(390, 1400)})
    await host.settle(10)
    assert.equal(page.ref.current.inspectFixturePosition().consumed, true)
    assert.equal(page.scrolls.at(-1).y, 100, 'The legacy 300px position is restored in the outer scroller')
    const settled = page.renders()
    await act(async () => {for (let height = 1250; height <= 3000; height += 50) {page.send({type: 'contentHeight', height}); page.outerProps().onContentSizeChange(390, height + 200)}})
    assert.equal(page.renders(), settled, 'Image-driven height growth is applied natively without rerendering the Reader document')
    assert.equal(page.ref.current.inspectFixturePosition().bridge.documentHeightPoints, 3000, 'Scroll math still sees the latest document height')
  })
})

test('android natively sized document still sizes and restores when no native content-height event fires', nativeBoundary, async () => {
  await withNativeHost(async host => {
    // The host never emits onContentHeight; only the bridge fallback sizes its container.
    const applied = []
    const page = await readerPage(host, 'android', {appliesContentHeight: true}, {applyDocumentHeight: height => applied.push(height)})
    await act(async () => {
      host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
      page.header().onLayout({nativeEvent: {layout: {height: 200}}})
      page.documentProps().onLoadStart({nativeEvent: {target: 47}})
      page.send({type: 'contentHeight', height: 1200})
      page.send({type: 'domReady'})
      page.documentProps().onLoadEnd()
    })
    assert.deepEqual(applied, [1200], 'The bridge height reaches the natively sized host')
    await act(async () => {page.outerProps().onLayout({nativeEvent: {layout: {height: 600}}}); page.outerProps().onContentSizeChange(390, 200 + applied.at(-1))})
    await host.settle(10)
    assert.equal(page.ref.current.inspectFixturePosition().consumed, true, 'The Android restore guard passes on the bridge-sized document')
    await act(async () => page.send({type: 'contentHeight', height: 1600}))
    assert.deepEqual(applied, [1200, 1600], 'Later bridge heights keep the fallback current without a React height')
  })
})

test('android without native sizing keeps the React height path', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const page = await readerPage(host, 'android')
    await act(async () => page.send({type: 'contentHeight', height: 1200}))
    assert.equal(page.documentProps().style.height, 1200)
    assert.equal(page.documentProps().containerStyle.height, 1200)
  })
})

const iosScrolls = page => page.commands.filter(command => command.operation === 'scrollTo').map(command => command.argument.y)

test('iOS Reader restores the saved position once at DOM readiness and height, before the load event', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const page = await readerPage(host, 'ios')
    await act(async () => {
      host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
      page.documentProps().onLoadStart({nativeEvent: {target: 47}})
      page.send({type: 'contentHeight', height: 1200})
      page.send({type: 'domReady'})
    })
    await act(async () => page.header().onLayout({nativeEvent: {layout: {height: 200}}}))
    await host.settle(10)
    assert.equal(page.ref.current.inspectFixturePosition().bridge.documentLoaded, false, 'Slow external resources have not finished loading')
    assert.equal(page.ref.current.inspectFixturePosition().consumed, true)
    assert.deepEqual(iosScrolls(page), [300 / 3 - 200], 'The saved position is applied once')
    await act(async () => {for (const height of [1600, 2400, 3000]) page.send({type: 'contentHeight', height})})
    await act(async () => page.documentProps().onLoadEnd())
    await act(async () => page.send({type: 'contentHeight', height: 3600}))
    await host.settle(200)
    assert.equal(page.ref.current.inspectFixturePosition().bridge.documentLoaded, true, 'Diagnostics still record the load event')
    assert.deepEqual(iosScrolls(page), [300 / 3 - 200], 'Late images and the load event never move the position again')
  })
})

test('android Reader restores once the outer scroller holds header and document, without the load event, and never again', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const page = await readerPage(host, 'android')
    await act(async () => {
      host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
      page.header().onLayout({nativeEvent: {layout: {height: 200}}})
      page.documentProps().onLoadStart({nativeEvent: {target: 47}})
      page.send({type: 'contentHeight', height: 1200})
      page.send({type: 'domReady'})
    })
    await act(async () => {page.outerProps().onLayout({nativeEvent: {layout: {height: 600}}}); page.outerProps().onContentSizeChange(390, 1300)})
    await host.settle(10)
    assert.equal(page.ref.current.inspectFixturePosition().consumed, false, 'The committed scroller is still shorter than header + document')
    assert.deepEqual(page.scrolls, [])
    await act(async () => page.outerProps().onContentSizeChange(390, 1400))
    await host.settle(10)
    assert.equal(page.ref.current.inspectFixturePosition().consumed, true, 'The guard passes on committed layout, not on onLoadEnd')
    assert.deepEqual(page.scrolls.map(value => value.y), [100])
    await act(async () => {page.send({type: 'contentHeight', height: 2400}); page.outerProps().onContentSizeChange(390, 2600)})
    await act(async () => page.documentProps().onLoadEnd())
    await host.settle(200)
    assert.deepEqual(page.scrolls.map(value => value.y), [100], 'Later growth and the load event never move the position')
  })
})

// Controlled frames: work scheduled for the next frame runs only when the test paints it.
function controlledFrames() {
  const frames = new Map(), timers = []
  let sequence = 0
  return {
    globals: {requestAnimationFrame: callback => {const id = ++sequence; frames.set(id, callback); return id}, cancelAnimationFrame: id => {frames.delete(id)},
      setTimeout: (callback, ms) => {timers.push(ms); return setTimeout(callback, ms)}, clearTimeout},
    pending: () => frames.size, timers,
    paint: async () => {const pending = [...frames.values()]; frames.clear(); await act(async () => {for (const callback of pending) callback(0)})},
  }
}
async function iosReady(page, host) {
  await act(async () => {
    host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
    page.documentProps().onLoadStart({nativeEvent: {target: 47}})
    page.send({type: 'contentHeight', height: 1200})
    page.send({type: 'domReady'})
  })
  await act(async () => page.header().onLayout({nativeEvent: {layout: {height: 200}}}))
  await host.settle(10)
}

for (const initialPosition of [300, 0, null]) test(`iOS Reader becomes presentable one frame after DOM readiness and the restore, without the load event (position ${initialPosition})`, nativeBoundary, async () => {
  await withNativeHost(async host => {
    const frames = controlledFrames()
    const page = await readerPage(host, 'ios', {}, {}, frames.globals)
    await host.render(page.element({initialPosition}))
    await act(async () => {host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}}); page.documentProps().onLoadStart({nativeEvent: {target: 47}})})
    await act(async () => page.send({type: 'contentHeight', height: 1200}))
    await act(async () => page.header().onLayout({nativeEvent: {layout: {height: 200}}}))
    await host.settle(10); await frames.paint()
    assert.deepEqual(page.presentable, [], 'Height and geometry alone do not present before DOM readiness')
    await act(async () => page.send({type: 'domReady'}))
    await host.settle(10)
    assert.equal(page.ref.current.inspectFixturePosition().consumed, true, 'The restore was applied')
    assert.deepEqual(iosScrolls(page), initialPosition === 300 ? [300 / 3 - 200] : initialPosition === 0 ? [-200] : [], 'The saved position is applied once')
    assert.deepEqual(page.presentable, [], 'The restored first screen has not painted yet')
    await frames.paint()
    assert.deepEqual(page.presentable, [page.pageId], 'Presentable follows one frame after the restore')
    assert.equal(page.ref.current.inspectFixturePosition().bridge.documentLoaded, false, 'The window load event never gated it')
    assert.deepEqual(frames.timers.filter(ms => ms >= 100), [], 'No presentation timeout is armed')
    await act(async () => {page.send({type: 'contentHeight', height: 2400}); page.documentProps().onLoadEnd()})
    await host.settle(50); await frames.paint()
    assert.deepEqual(page.presentable, [page.pageId], 'Presentable is reported once')
    assert.equal(iosScrolls(page).length, initialPosition === null ? 0 : 1, 'Late images and the load event never move the position again')
  })
})

test('android Reader becomes presentable one frame after the guarded restore, without the load event', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const frames = controlledFrames()
    const page = await readerPage(host, 'android', {}, {}, frames.globals)
    await act(async () => {
      host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
      page.header().onLayout({nativeEvent: {layout: {height: 200}}})
      page.documentProps().onLoadStart({nativeEvent: {target: 47}})
      page.send({type: 'contentHeight', height: 1200}); page.send({type: 'domReady'})
    })
    await act(async () => {page.outerProps().onLayout({nativeEvent: {layout: {height: 600}}}); page.outerProps().onContentSizeChange(390, 1300)})
    await host.settle(10); await frames.paint()
    assert.deepEqual(page.presentable, [], 'The scroller guard still holds back restore and presentation')
    await act(async () => page.outerProps().onContentSizeChange(390, 1400))
    await host.settle(10)
    assert.deepEqual(page.scrolls.map(value => value.y), [100])
    assert.deepEqual(page.presentable, [])
    await frames.paint()
    assert.deepEqual(page.presentable, [page.pageId])
  })
})

test('a native load failure between restore and paint cancels presentation and reports a recoverable document failure', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const frames = controlledFrames(), errors = []
    const page = await readerPage(host, 'ios', {}, {}, frames.globals)
    await host.render(page.element({onError: error => errors.push(error)}))
    await iosReady(page, host)
    assert.equal(frames.pending(), 1)
    await act(async () => page.documentProps().onError({nativeEvent: {code: -1, description: 'Reader security policy unavailable'}}))
    assert.equal(errors.length, 1); assert.equal(errors[0].name, 'ReaderDocumentLoadFailed')
    assert.equal(frames.pending(), 0, 'The failed host cannot publish a pending restored frame')
    await frames.paint()
    assert.deepEqual(page.presentable, [])
    await act(async () => page.documentProps().onError({nativeEvent: {code: -1, description: 'late failure'}}))
    assert.equal(errors.length, 1, 'A failed host reports its terminal failure once')
  })
})

test('a page unmounted between its restore and the next frame never reports presentable', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const frames = controlledFrames()
    const page = await readerPage(host, 'ios', {}, {}, frames.globals)
    await iosReady(page, host)
    assert.equal(frames.pending(), 1)
    await host.render(null)
    assert.equal(frames.pending(), 0, 'Unmount cancels the pending presentation frame')
    assert.deepEqual(page.presentable, [])
  })
})
