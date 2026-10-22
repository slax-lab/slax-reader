import test from 'node:test'
import assert from 'node:assert/strict'
import {React, act, loadComponent, nativeBoundary, withNativeHost} from './parity-host.mjs'
import * as geometry from '../../src/reader/host/geometry.ts'
import * as coordinates from '../../src/reader/coordinates.ts'
import {ReaderNativeAttachment} from '../../src/reader/native-attachment.ts'
import {pdfFailure, pdfFailureError} from '../../src/reader/pdf-errors.ts'
import * as bridge from '../../src/reader/bridge.ts'

test('shared host geometry separates native scroll metrics from PDF document viewport', () => {
  const inputs = {pixelRatio: 3, headerHeight: 300, headerSafeArea: 60, screenTop: 80, viewportHeight: 700, scrollPoints: 500}
  assert.equal(geometry.readerHostGeometry('ios', inputs).headerHeightPoints, 240)
  assert.equal(geometry.readerHostGeometry('android', inputs).webViewScreenTopPoints, -120)
  assert.deepEqual(geometry.readerHostViewport('android', 200, 700, 300), {offset: -100, height: 700})
  assert.deepEqual(geometry.readerHostViewport('ios', -300, 700, 300), {offset: -300, height: 700})
  assert.equal(geometry.documentScrollToHost('android', 1200, 300), 1500)
  assert.equal(geometry.documentScrollToHost('ios', 1200, 300), 1200)
  assert.equal(geometry.documentScrollToHost('android', 0, 300, true), 0)
  assert.equal(geometry.documentScrollToHost('ios', 0, 300, true), -300)
  assert.equal(geometry.readerHostLayoutReady('android', 3000, 300, 700, 1000, 3), false)
  assert.equal(geometry.readerHostLayoutReady('android', 3000, 300, 700, 3300, 3), true)
})

test('renderer diagnostics retain allowlisted causes without content, URLs or arbitrary error text', () => {
  const network = Object.assign(new Error('https://private.example/document?token=secret'), {name: 'DataTransportError', code: 'network_unavailable', stage: 'pdf-range'})
  const error = pdfFailureError(network, 'range')
  assert.equal(error.code, 'network_unavailable'); assert.equal(error.stage, 'pdf-range')
  assert.doesNotMatch(error.message, /private|secret/)
  assert.deepEqual(pdfFailure({code: 'pdf_identity_mismatch', stage: 'pdf-range', status: 412}, 'range'), {code: 'pdf_identity_mismatch', stage: 'pdf-range', status: 412})
  assert.deepEqual(pdfFailure({code: 'selected private words', stage: 'https://private', status: 20000}, 'render'), {code: 'PdfRenderError', stage: 'render'})
  assert.equal(pdfFailureError({name: 'PasswordException'}, 'document').name, 'PasswordException')
  assert.equal(pdfFailureError({name: 'ReaderProcessGone'}, 'native').name, 'ReaderProcessGone')
})

for (const platform of ['ios', 'android']) test(`${platform} PDF shares native header layout and scroll geometry without per-frame React state`, nativeBoundary, async () => {
  await withNativeHost(async host => {
    let current, renders = 0, touch
    const scrolls = [], insets = [], viewports = [], metrics = [], failures = []
    let restores = 0, detached = 0
    const Scroller = React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({scrollTo: value => scrolls.push(value.y)}))
      host.props.set('pdf-reader-scroll', props)
      return React.createElement('div', {}, props.children)
    })
    const native = {...host.native, Platform: {OS: platform}, PixelRatio: {get: () => 3}, ScrollView: Scroller}
    const adapter = {OverlayComponent: host.native.View, attach: async () => {}, detach: async () => {detached++},
      subscribeTouch(_tag, callback) {touch = callback; return () => {}}, setScrollsToTop: async () => {},
      updateInsets: async (_tag, top, bottom) => insets.push([top, bottom]), scrollTo: async (_tag, y) => scrolls.push(y)}
    const {usePdfScrollHost} = await loadComponent('../../src/reader/host/usePdfScrollHost.tsx', {react: React, 'react-native': native,
      '../../native/reader': {readerNativeAdapter: adapter}, '../native-attachment.ts': {ReaderNativeAttachment}, '../coordinates.ts': coordinates, './geometry.ts': geometry, '../bridge.ts': bridge},
      {requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout})
    const Header = () => React.createElement('header')
    function Probe() {
      renders++
      current = usePdfScrollHost({context: {pageId: 'pdf-host', scrollsToTop: true}, ready: true, header: React.createElement(Header), headerSafeAreaPoints: 60,
        onViewport: value => viewports.push(value), onInitialLayout: () => {restores++}, onScrollMetrics: (...value) => metrics.push(value), onError: error => failures.push(error)})
      return current.wrap(React.createElement('article', {'data-testid': 'document'}))
    }
    await host.render(React.createElement(Probe))
    await act(async () => {
      current.nativeLoad({nativeEvent: {target: 31}})
      host.props.get('pdf-reader-container').onLayout({nativeEvent: {layout: {height: 700}}})
      current.setDocumentHeight(3000)
    })
    const tree = host.window.document.querySelector('header')
    assert.ok(tree)
    // The header's React Native measurement wrapper exposes no test ID; invoke it through its React owner in a mounted probe below.
    const containerProps = host.props.get('pdf-reader-container')
    const layout = containerProps.children
    const measuredHeader = platform === 'android' ? layout.props.children[0] : layout.props.children[1].props.children
    await act(async () => measuredHeader.props.onLayout({nativeEvent: {layout: {height: 300}}}))
    if (platform === 'android') {
      assert.equal(restores, 0, 'DOM height is not proof of committed native scroll content')
      await act(async () => host.props.get('pdf-reader-scroll').onContentSizeChange(390, 3300))
    }
    await host.settle()
    assert.equal(restores, 1)
    await current.scrollToDocument(0, true)
    assert.equal(scrolls.at(-1), platform === 'ios' ? -300 : 0)
    assert.deepEqual(insets.at(-1), platform === 'ios' ? [300, 0] : [0, 0])
    const before = renders
    const event = {nativeEvent: {contentOffset: {y: 900}, contentSize: {height: platform === 'ios' ? 3000 : 3300}, layoutMeasurement: {height: 700}}}
    await act(async () => {
      if (platform === 'ios') current.nativeScroll(event)
      else host.props.get('pdf-reader-scroll').onScroll(event)
      await new Promise(resolve => setTimeout(resolve, 5))
    })
    assert.equal(renders, before)
    assert.deepEqual(JSON.parse(JSON.stringify(viewports.at(-1))), {offset: platform === 'ios' ? 900 : 600, height: 700})
    assert.equal(metrics.at(-1)[0], platform === 'ios' ? 3600 : 2700)
    touch(260)
    assert.equal(current.selectionY(400), 60)
    await current.scrollToDocument(1800)
    assert.equal(scrolls.at(-1), platform === 'ios' ? 1800 : 2100)
    assert.deepEqual(failures, [])
    await host.unmount()
    assert.equal(detached, 1)
  })
})

for (const platform of ['ios', 'android']) test(`${platform} initialization waits for success and retries only the current foreground lifetime`, nativeBoundary, async () => {
  await withNativeHost(async host => {
    let current, active = false, activation = 0
    const attempts = [], scrolls = [], errors = []
    const Scroller = React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({scrollTo: value => scrolls.push(value.y)}))
      host.props.set('pdf-reader-scroll', props)
      return React.createElement('div', {}, props.children)
    })
    const adapter = {OverlayComponent: host.native.View, attach: async () => {}, detach: async () => {}, subscribeTouch: () => () => {}, setScrollsToTop: async () => {}, updateInsets: async () => {}, scrollTo: async (_tag, y) => scrolls.push(y)}
    const {usePdfScrollHost} = await loadComponent('../../src/reader/host/usePdfScrollHost.tsx', {react: React,
      'react-native': {...host.native, Platform: {OS: platform}, PixelRatio: {get: () => 3}, ScrollView: Scroller},
      '../../native/reader': {readerNativeAdapter: adapter}, '../native-attachment.ts': {ReaderNativeAttachment}, '../coordinates.ts': coordinates, './geometry.ts': geometry, '../bridge.ts': bridge},
      {requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout})
    function Probe() {
      current = usePdfScrollHost({context: {pageId: 'restore-lifetime', scrollsToTop: true}, ready: true, active, activation,
        header: React.createElement('header'), onViewport() {}, onInitialLayout: () => new Promise((resolve, reject) => attempts.push({resolve, reject})),
        onError: error => errors.push(error), onOperationError: error => errors.push(error)})
      return current.wrap(React.createElement('article'))
    }
    const render = () => host.render(React.createElement(Probe))
    await render()
    await act(async () => {
      current.nativeLoad({nativeEvent: {target: 31}})
      host.props.get('pdf-reader-container').onLayout({nativeEvent: {layout: {height: 700}}})
      current.setDocumentHeight(8000)
    })
    const layout = host.props.get('pdf-reader-container').children
    const header = platform === 'android' ? layout.props.children[0] : layout.props.children[1].props.children
    await act(async () => {
      header.props.onLayout({nativeEvent: {layout: {height: 300}}})
      if (platform === 'android') host.props.get('pdf-reader-scroll').onContentSizeChange(390, 8300)
    })
    assert.equal(attempts.length, 0, 'Inactive layout must not consume restoration')
    active = true; activation++; await render(); await host.settle()
    assert.equal(attempts.length, 1)
    await act(async () => {
      current.setDocumentHeight(8001)
      if (platform === 'android') host.props.get('pdf-reader-scroll').onContentSizeChange(390, 8301)
    })
    assert.equal(attempts.length, 1, 'Layout changes cannot duplicate an in-flight restore')
    active = false; activation++; await render()
    await act(async () => attempts[0].reject(bridge.readerOperationCancelled()))
    active = true; activation++; await render(); await host.settle()
    assert.equal(attempts.length, 2)
    active = false; activation++; await render()
    active = true; activation++; await render(); await host.settle()
    assert.equal(attempts.length, 3)
    await act(async () => attempts[1].resolve())
    await act(async () => current.setDocumentHeight(8002))
    assert.equal(attempts.length, 3, 'Old completion cannot replace the current attempt')
    await act(async () => attempts[2].resolve())
    const event = {nativeEvent: {contentOffset: {y: 2500}, contentSize: {height: 8302}, layoutMeasurement: {height: 700}}}
    await act(async () => {if (platform === 'ios') current.nativeScroll(event); else host.props.get('pdf-reader-scroll').onScroll(event)})
    active = false; activation++; await render()
    active = true; activation++; await render(); await host.settle()
    assert.equal(attempts.length, 3, 'Foreground cannot repeat an accepted restore after manual scrolling')
    assert.deepEqual(errors, [])
    await host.unmount()
    await assert.rejects(current.scrollToDocument(6000), error => bridge.isReaderOperationCancelled(error))
    assert.deepEqual(scrolls, [], 'Old host cannot issue a phantom native scroll')
  })
})

for (const platform of ['android', 'ios']) test(`${platform} deferred scrolling settles only after issue and cancels superseded lifetimes`, nativeBoundary, async () => {
  await withNativeHost(async host => {
    let current, active = true, activation = 0
    const scrolls = [], nativeCompletions = []
    const Scroller = React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({scrollTo: value => scrolls.push(value.y)}))
      host.props.set('pdf-reader-scroll', props)
      return React.createElement('div', {}, props.children)
    })
    const adapter = {attach: async () => {}, detach: async () => {}, subscribeTouch: () => () => {}, setScrollsToTop: async () => {}, updateInsets: async () => {},
      scrollTo: async (_tag, y) => {scrolls.push(y); await new Promise(resolve => nativeCompletions.push(resolve))}}
    const {usePdfScrollHost} = await loadComponent('../../src/reader/host/usePdfScrollHost.tsx', {react: React,
      'react-native': {...host.native, Platform: {OS: platform}, PixelRatio: {get: () => 3}, ScrollView: Scroller},
      '../../native/reader': {readerNativeAdapter: adapter}, '../native-attachment.ts': {ReaderNativeAttachment}, '../coordinates.ts': coordinates, './geometry.ts': geometry, '../bridge.ts': bridge},
      {requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout})
    function Probe() {
      current = usePdfScrollHost({context: {pageId: 'deferred-scroll', scrollsToTop: true}, ready: true, active, activation,
        onViewport() {}, onInitialLayout() {}, onError(error) {throw error}})
      return current.wrap(React.createElement('article'))
    }
    const render = () => host.render(React.createElement(Probe))
    await render()
    await act(async () => {
      current.nativeLoad({nativeEvent: {target: 31}})
      host.props.get('pdf-reader-container').onLayout({nativeEvent: {layout: {height: 700}}})
      current.setDocumentHeight(8000)
    })
    let settled = false
    const first = current.scrollToDocument(1200)
    const firstResult = first.then(() => {settled = true; return null}, error => error)
    await host.settle()
    assert.equal(settled, false)
    if (platform === 'android') assert.deepEqual(scrolls, [])
    const second = current.scrollToDocument(1800)
    assert.ok(bridge.isReaderOperationCancelled(await firstResult))
    const secondResult = second.then(() => {settled = true; return null}, error => error)
    await host.settle()
    assert.equal(settled, false)
    if (platform === 'android') await act(async () => host.props.get('pdf-reader-scroll').onContentSizeChange(390, 8000))
    else await act(async () => {nativeCompletions[0](); nativeCompletions[1]()})
    assert.equal(await secondResult, null)
    assert.equal(scrolls.at(-1), 1800)
    const issued = scrolls.length
    if (platform === 'android') await act(async () => host.props.get('pdf-reader-scroll').onContentSizeChange(390, 8001))
    await host.settle()
    assert.equal(scrolls.length, issued, 'Layout drains the same request once')
    await act(async () => current.setDocumentHeight(9000))
    const thirdResult = current.scrollToDocument(2600).then(() => null, error => error)
    await host.settle()
    active = false; activation++; await render()
    assert.ok(bridge.isReaderOperationCancelled(await thirdResult))
    if (platform === 'ios') await act(async () => nativeCompletions[2]())
    const afterCancellation = scrolls.length
    active = true; activation++; await render()
    if (platform === 'android') await act(async () => host.props.get('pdf-reader-scroll').onContentSizeChange(390, 9000))
    await host.settle()
    assert.equal(scrolls.length, afterCancellation, 'Foreground cannot execute a cancelled deferred offset')
    await act(async () => current.setDocumentHeight(10000))
    const unmounted = current.scrollToDocument(3200).then(() => null, error => error)
    await host.settle()
    await host.unmount()
    assert.ok(bridge.isReaderOperationCancelled(await unmounted))
    if (platform === 'ios') nativeCompletions[3]()
  })
})

test('PDF loading cover keeps the article skeleton until revealed, then fades without blocking touches and unmounts', nativeBoundary, async () => {
  await withNativeHost(async host => {
    const {installedMotionHost} = await import('../ui/installed-motion-host.mjs')
    const motion = installedMotionHost(host.native.View)
    const adapter = {OverlayComponent: host.native.View, attach: async () => {}, detach: async () => {}, subscribeTouch: () => () => {}, setScrollsToTop: async () => {}, updateInsets: async () => {}, scrollTo: async () => {}}
    const {usePdfScrollHost} = await loadComponent('../../src/reader/host/usePdfScrollHost.tsx', {react: React, 'react-native': {...host.native, PixelRatio: {get: () => 3}},
      'react-native-reanimated': motion.reanimated, '../../native/reader': {readerNativeAdapter: adapter}, '../native-attachment.ts': {ReaderNativeAttachment},
      '../coordinates.ts': coordinates, './geometry.ts': geometry, '../bridge.ts': bridge}, {requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout})
    let setCovered
    function Probe() {
      const [covered, update] = React.useState(true); setCovered = update
      const current = usePdfScrollHost({context: {pageId: 'pdf-cover', scrollsToTop: true}, ready: true, covered, header: React.createElement('header'),
        placeholder: React.createElement('section', {'data-testid': 'skeleton'}), onViewport() {}, onInitialLayout() {}, onError() {}})
      return current.wrap(React.createElement('article'))
    }
    const cover = () => host.window.document.querySelector('[data-testid="pdf-reader-placeholder"]')
    await host.render(React.createElement(Probe))
    assert.ok(cover()?.querySelector('[data-testid="skeleton"]'), 'Ready alone does not lift the cover')
    assert.ok(host.window.document.querySelector('[data-testid="pdf-reader-container"] header'), 'The host header stays mounted beneath the cover')
    const shown = host.props.get('pdf-reader-placeholder')
    assert.equal(shown.pointerEvents, 'auto'); assert.equal(shown.accessibilityElementsHidden, true); assert.equal(shown.importantForAccessibility, 'no-hide-descendants')
    assert.equal(shown.style[0].top, 0, 'The cover spans the header too, so no unmeasured frame shows through')
    await act(async () => setCovered(false))
    assert.ok(cover(), 'The cover fades instead of disappearing in one frame')
    assert.equal(host.props.get('pdf-reader-placeholder').pointerEvents, 'none', 'A fading cover never blocks the revealed document')
    assert.equal(motion.started.at(-1).toValue, 0)
    await act(async () => motion.advance(1000))
    assert.equal(cover(), null, 'The finished cover unmounts')
  })
})
