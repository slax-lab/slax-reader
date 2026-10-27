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

test('iOS Reader content creates its host beneath the skeleton during the push and reveals it only when presentable', nativeBoundary, async () => {
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

test('iOS Reader skips identical native inset updates and reports presentable once after restore', nativeBoundary, async () => {
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
    assert.deepEqual(page.presentable, [page.pageId], 'Presentable fires exactly once, after the initial restore')
    const applied = page.insets.length
    assert.ok(applied >= 1)
    assert.equal(new Set(page.insets.map(value => value.join(':'))).size, page.insets.length, 'No identical native inset update is sent twice')
    await act(async () => {for (let index = 0; index < 5; index++) page.send({type: 'contentHeight', height: 1300 + index})})
    await host.settle(10)
    assert.equal(page.insets.length, applied, 'Rerenders with unchanged insets do not reach native')
    assert.deepEqual(page.presentable, [page.pageId])
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
    assert.deepEqual(page.presentable, [page.pageId])
    const settled = page.renders()
    await act(async () => {for (let height = 1250; height <= 3000; height += 50) {page.send({type: 'contentHeight', height}); page.outerProps().onContentSizeChange(390, height + 200)}})
    assert.equal(page.renders(), settled, 'Image-driven height growth is applied natively without rerendering the Reader document')
    assert.equal(page.ref.current.inspectFixturePosition().bridge.documentHeightPoints, 3000, 'Scroll math still sees the latest document height')
  })
})

test('android natively sized document still sizes and becomes presentable when no native content-height event fires', nativeBoundary, async () => {
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
    assert.deepEqual(page.presentable, [page.pageId])
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

// Controlled clock and timers for the restore/presentable windows; Date.now drives the settle deadline.
function controlledTime() {
  let now = 1000, sequence = 0
  const timers = new Map()
  const clock = {now: () => now}
  const DateShim = new Proxy(Date, {get: (target, key) => key === 'now' ? clock.now : Reflect.get(target, key)})
  return {
    globals: {Date: DateShim, setTimeout: (callback, ms) => {const id = ++sequence; timers.set(id, {callback, at: now + ms}); return id}, clearTimeout: id => {timers.delete(id)}},
    pending: () => [...timers.values()].map(timer => timer.at - now),
    advance: async ms => {
      const end = now + ms
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        timers.delete(next[0]); now = next[1].at
        await act(async () => {next[1].callback()})
      }
      now = end
    },
  }
}
const iosScrolls = page => page.commands.filter(command => command.operation === 'scrollTo').map(command => command.argument.y)
async function iosDomReady(page, host, height = 1200) {
  await act(async () => {
    host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
    page.documentProps().onLoadStart({nativeEvent: {target: 47}})
    page.send({type: 'contentHeight', height})
    page.send({type: 'domReady'})
  })
  await act(async () => page.header().onLayout({nativeEvent: {layout: {height: 200}}}))
  await host.settle(10)
}

test('iOS Reader restores and becomes presentable on DOM readiness and height without waiting for the load event', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const page = await readerPage(host, 'ios')
    await iosDomReady(page, host)
    assert.equal(page.ref.current.inspectFixturePosition().bridge.documentLoaded, false, 'Slow external resources have not finished loading')
    assert.equal(page.ref.current.inspectFixturePosition().consumed, true)
    assert.deepEqual(page.presentable, [page.pageId], 'The cover lifts before onLoadEnd')
    assert.deepEqual(iosScrolls(page), [300 / 3 - 200], 'The saved position was applied once')
    await act(async () => page.documentProps().onLoadEnd())
    assert.equal(page.ref.current.inspectFixturePosition().bridge.documentLoaded, true, 'Diagnostics still record the load event')
    assert.deepEqual(page.presentable, [page.pageId], 'A later load event never reports presentable again')
  })
})

test('android Reader restores before the load event once the outer scroller holds header and document', nativeBoundary, async () => {
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
    assert.equal(page.scrolls.at(-1).y, 100)
    assert.deepEqual(page.presentable, [page.pageId])
  })
})

for (const platform of ['ios', 'android']) test(`${platform} late image layout re-applies a saved position once at the load event while the reader has not interacted`, nativeBoundary, async () => {
  await withNativeHost(async host => {
    const time = controlledTime()
    const page = await readerPage(host, platform, {}, {}, time.globals)
    const scrolls = () => platform === 'ios' ? iosScrolls(page) : page.scrolls.map(value => value.y)
    if (platform === 'ios') await iosDomReady(page, host)
    else {
      await act(async () => {
        host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
        page.header().onLayout({nativeEvent: {layout: {height: 200}}})
        page.documentProps().onLoadStart({nativeEvent: {target: 47}})
        page.send({type: 'contentHeight', height: 1200}); page.send({type: 'domReady'})
      })
      await act(async () => {page.outerProps().onLayout({nativeEvent: {layout: {height: 600}}}); page.outerProps().onContentSizeChange(390, 1400)})
      await host.settle(10)
    }
    assert.equal(scrolls().length, 1)
    // Images above the saved position expand, then the window load event arrives.
    await act(async () => {page.send({type: 'contentHeight', height: 2400}); if (platform === 'android') page.outerProps().onContentSizeChange(390, 2600)})
    await act(async () => page.documentProps().onLoadEnd())
    await host.settle(10)
    assert.equal(scrolls().length, 2, 'Grown layout re-applies the saved position at the load event')
    assert.equal(scrolls()[1], scrolls()[0], 'The same saved position is re-applied')
    await time.advance(3000); await host.settle(10)
    await act(async () => {page.send({type: 'contentHeight', height: 3000}); if (platform === 'android') page.outerProps().onContentSizeChange(390, 3200)})
    await time.advance(3000); await host.settle(10)
    assert.equal(scrolls().length, 2, 'The settle window closed with the load event; later growth never moves the reader')
  })
})

for (const platform of ['ios', 'android']) test(`${platform} late layout never moves a reader who already scrolled`, nativeBoundary, async () => {
  await withNativeHost(async host => {
    const time = controlledTime()
    const page = await readerPage(host, platform, {}, {}, time.globals)
    const scrolls = () => platform === 'ios' ? iosScrolls(page) : page.scrolls.map(value => value.y)
    await act(async () => {
      host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
      page.header().onLayout({nativeEvent: {layout: {height: 200}}})
      page.documentProps().onLoadStart({nativeEvent: {target: 47}})
      page.send({type: 'contentHeight', height: 1200}); page.send({type: 'domReady'})
    })
    if (platform === 'android') await act(async () => {page.outerProps().onLayout({nativeEvent: {layout: {height: 600}}}); page.outerProps().onContentSizeChange(390, 1400)})
    await host.settle(10)
    assert.equal(scrolls().length, 1)
    await act(async () => {
      if (platform === 'android') page.outerProps().onScrollBeginDrag({nativeEvent: {contentOffset: {y: 100}}})
      else host.props.get('reader-container').onTouchStart({nativeEvent: {}})
    })
    await act(async () => {page.send({type: 'contentHeight', height: 2400}); if (platform === 'android') page.outerProps().onContentSizeChange(390, 2600)})
    await time.advance(500)
    await act(async () => page.documentProps().onLoadEnd())
    await time.advance(500); await host.settle(10)
    assert.equal(scrolls().length, 1, 'A touch or drag hands the position to the reader')
  })
})

test('iOS late growth before the load event re-applies once after a quiet period, then stops at the 2 s deadline', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const time = controlledTime()
    const page = await readerPage(host, 'ios', {}, {}, time.globals)
    await iosDomReady(page, host)
    for (const height of [1600, 2000, 2400]) await act(async () => page.send({type: 'contentHeight', height}))
    await time.advance(200); await host.settle(10)
    assert.equal(iosScrolls(page).length, 2, 'A burst of image growth is coalesced into one re-apply')
    await time.advance(2500)
    await act(async () => page.send({type: 'contentHeight', height: 3000}))
    await time.advance(500); await host.settle(10)
    assert.equal(iosScrolls(page).length, 2, 'Growth after the bounded window is ignored')
  })
})

test('a top-of-article position is never re-applied after late layout', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const time = controlledTime()
    const page = await readerPage(host, 'ios', {}, {}, time.globals)
    await host.render(page.element({initialPosition: 0}))
    await iosDomReady(page, host)
    const restored = iosScrolls(page).length
    await act(async () => page.send({type: 'contentHeight', height: 2400}))
    await act(async () => page.documentProps().onLoadEnd())
    await time.advance(500); await host.settle(10)
    assert.equal(iosScrolls(page).length, restored)
  })
})

test('the article is uncovered 1500 ms after DOM readiness even when the restore cannot complete', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const time = controlledTime()
    const page = await readerPage(host, 'ios', {}, {}, time.globals)
    await act(async () => {
      host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
      page.documentProps().onLoadStart({nativeEvent: {target: 47}})
      page.send({type: 'domReady'})
    })
    await host.settle(10)
    assert.deepEqual(page.presentable, [], 'No document height yet, so the restore is still pending')
    await time.advance(1499); await host.settle(10)
    assert.deepEqual(page.presentable, [])
    await time.advance(1); await host.settle(10)
    assert.deepEqual(page.presentable, [page.pageId], 'The bounded fallback lifts the cover')
    await act(async () => host.props.get('reader-container').onTouchStart({nativeEvent: {}}))
    await act(async () => page.send({type: 'contentHeight', height: 1200}))
    await act(async () => page.header().onLayout({nativeEvent: {layout: {height: 200}}}))
    await host.settle(10)
    assert.equal(page.ref.current.inspectFixturePosition().consumed, true)
    assert.deepEqual(iosScrolls(page), [], 'A late restore never moves a reader who already touched the uncovered article')
    assert.deepEqual(page.presentable, [page.pageId], 'Presentable is reported once')
    assert.deepEqual(time.pending(), [], 'No fallback timer remains')
  })
})

test('a restore that completes in time cancels the presentable fallback', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const time = controlledTime()
    const page = await readerPage(host, 'ios', {}, {}, time.globals)
    await iosDomReady(page, host)
    assert.deepEqual(page.presentable, [page.pageId])
    await time.advance(5000); await host.settle(10)
    assert.deepEqual(page.presentable, [page.pageId])
  })
})
