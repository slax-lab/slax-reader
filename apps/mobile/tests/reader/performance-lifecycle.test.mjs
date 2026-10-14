import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
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
test('inactive commands cancel polls and deadlines without turning into operation failures or replaying work', async () => {
  let calls = 0
  const session = new bridge.ReaderBridgeSession('page', async script => {
    calls++
    const requestId = /"requestId":"([^"]+)"/.exec(script)[1]
    return JSON.stringify({pageId: 'page', requestId, status: calls === 1 ? 'pending' : 'fulfilled', value: 42})
  }, 40)
  session.receive(envelope('page', {type: 'domReady'}))
  const pending = session.request({operation: 'queryYoutubeTime'})
  const cancelled = assert.rejects(pending, bridge.isReaderOperationCancelled)
  await Promise.resolve()
  session.setActive(false)
  await cancelled
  await assert.rejects(session.request({operation: 'captureSelection'}), bridge.isReaderOperationCancelled)
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(calls, 1)
  session.setActive(true)
  assert.equal(await session.request({operation: 'queryYoutubeTime'}), 42)
  assert.equal(calls, 2)
  session.invalidate()
  assert.equal(session.receive(envelope('page', {type: 'domReady'})), null)
  await assert.rejects(session.request({operation: 'captureSelection'}), bridge.isReaderOperationCancelled)
})

test('active native failures and real command deadlines remain errors', async () => {
  const failure = new Error('Native evaluation failed')
  const session = new bridge.ReaderBridgeSession('page', async () => {throw failure})
  session.receive(envelope('page', {type: 'domReady'}))
  await assert.rejects(session.request({operation: 'captureSelection'}), error => error === failure && !bridge.isReaderOperationCancelled(error))
  session.dispose()
  const timeout = new bridge.ReaderBridgeSession('page', () => new Promise(() => {}), 10)
  timeout.receive(envelope('page', {type: 'domReady'}))
  await assert.rejects(timeout.request({operation: 'captureSelection'}), /timed out/)
  timeout.dispose()
})

for (const platform of ['ios', 'android']) test(`${platform} DOM scroll performs no layout reads or duplicate scroll bridge publication`, async () => {
  const source = await readFile(new URL('../../assets/embedded/js/react-native-host.js', import.meta.url), 'utf8')
  const listeners = new Map(), messages = [], frames = []
  let resize, reads = 0, height = 1000
  const body = {get scrollHeight() {reads++; return height}, get offsetHeight() {reads++; return height}}
  const window = {ReactNativeWebView: {postMessage: raw => messages.push(JSON.parse(raw).payload)}, ResizeObserver: true,
    requestAnimationFrame(callback) {frames.push(callback); return frames.length}, cancelAnimationFrame() {},
    addEventListener(type, callback) {listeners.set(type, callback)}, removeEventListener(type) {listeners.delete(type)}}
  window.top = window
  const document = {body, documentElement: {get scrollHeight() {reads++; return height}}, readyState: 'complete',
    addEventListener() {}, removeEventListener() {}, querySelectorAll: () => []}
  class ResizeObserver {constructor(callback) {resize = callback} observe() {} disconnect() {}}
  vm.runInNewContext(source.replace('__SLAX_READER_CONFIGURATION__', JSON.stringify({pageId: 'page', platform})), {window, document, ResizeObserver, setTimeout, clearTimeout})
  frames.shift()()
  assert.equal(reads, 3)
  assert.deepEqual(messages, [{type: 'contentHeight', height: 1000}])
  assert.equal(listeners.has('scroll'), false)
  for (let y = 0; y < 120; y++) listeners.get('scroll')?.()
  assert.equal(reads, 3)
  height = 1400
  resize(); frames.shift()()
  assert.equal(reads, 6)
  assert.deepEqual(messages.at(-1), {type: 'contentHeight', height: 1400})
  window.__SlaxReaderHost.teardown()
})

for (const platform of ['ios', 'android']) test(`${platform} Reader offsets preserve geometry and flush latest position without React document renders`, nativeBoundary, async () => {
  await withNativeHost(async host => {
    let documentProps, headerProps, outerProps, renders = 0, appState
    const overlays = new Map(), writes = [], errors = []
    const View = React.forwardRef((props, ref) => {
      if (props.onLayout && !props.testID) headerProps = props
      return React.createElement(host.native.View, {...props, ref})
    })
    const ScrollView = React.forwardRef((props, ref) => {outerProps = props; return React.createElement(host.native.ScrollView, {...props, ref})})
    const WebView = React.forwardRef((props, ref) => {
      documentProps = props; renders++
      React.useImperativeHandle(ref, () => ({stopLoading() {}, evaluateJavaScript: async script => vm.runInNewContext(script, {
        window: {__SlaxReaderHost: {execute: command => JSON.stringify({pageId: command.pageId, requestId: command.requestId, status: 'fulfilled', value: null})}},
      })}), [])
      return null
    })
    const adapter = {HostComponent: WebView, OverlayComponent: props => {overlays.set(props.overlayKind, props); return React.createElement(View, props)},
      nativeConfig: context => ({props: context}), attach() {}, subscribeTouch: () => () => {}, updateInsets() {}, setScrollsToTop() {}, detach() {}, scrollTo() {}}
    const {ReaderWebView} = await loadComponent('../../src/reader/ReaderWebView.tsx', {
      react: React, 'react-native': {...host.native, View, ScrollView, Platform: {OS: platform}, PixelRatio: {get: () => 3},
        AppState: {currentState: 'active', addEventListener: (_name, callback) => {appState = callback; return {remove() {}}}}},
      'react-native-webview': {WebView}, './bridge.ts': bridge, './coordinates.ts': coordinates, './document.ts': documentComposer, './host/geometry.ts': hostGeometry,
      './security.ts': security, '../config': {mobileConfig: {webUrl: 'https://r.slax.com', webDomain: '.slax.com', apiUrl: 'https://api-reader.slax.com', betaApiUrl: 'https://api-reader-beta.slax.com'}},
      './input.ts': input, './native-attachment.ts': {ReaderNativeAttachment}, './recovery.ts': recovery, './position.ts': {ReaderPositionWriter},
    }, {Error})
    const ref = React.createRef()
    await host.render(React.createElement(ReaderWebView, {ref, cacheKey: 'fixture', cacheDirectory: '/cache/slax-ui-fixtures/scroll/', html: '<p>Article</p>', currentUserId: 7,
      nativeAdapter: adapter, header: React.createElement('div', null, 'Header'), headerSafeAreaPoints: 62,
      onPositionFlush: value => writes.push(value), onError: error => errors.push(error)}))
    const pageId = /"pageId":"([^"]+)"/.exec(documentProps.source.html)[1]
    await act(async () => {
      host.props.get('reader-container').onLayout({nativeEvent: {layout: {height: 600}}})
      headerProps.onLayout({nativeEvent: {layout: {height: 200}}})
      documentProps.onLoadStart({nativeEvent: {target: 47}})
      documentProps.onMessage({nativeEvent: {data: envelope(pageId, {type: 'contentHeight', height: 1200})}})
      documentProps.onMessage({nativeEvent: {data: envelope(pageId, {type: 'domReady'})}})
      documentProps.onLoadEnd()
    })
    if (platform === 'android') await act(async () => {
      outerProps.onLayout({nativeEvent: {layout: {height: 600}}})
      outerProps.onContentSizeChange(390, 1400)
    })
    await host.settle()
    assert.equal(ref.current.inspectFixturePosition().consumed, true)
    if (platform === 'ios') assert.equal(overlays.get('header').headerHeightPoints, 138)
    const settledRenders = renders
    await act(async () => {
      for (let y = 0; y <= 300; y++) (platform === 'ios' ? documentProps : outerProps).onScroll({nativeEvent: {
        contentOffset: {y}, contentSize: {height: 1400}, layoutMeasurement: {height: 600},
      }})
    })
    assert.equal(renders, settledRenders, 'Per-offset updates never rerender the document')
    const position = ref.current.inspectFixturePosition()
    assert.equal(position.observed.scrollPoints, 300)
    if (platform === 'android') assert.equal(position.geometry.webViewScreenTopPoints, position.geometry.containerScreenTopPoints - 100)
    await act(async () => appState('background'))
    assert.equal(writes.at(-1), platform === 'ios' ? 1500 : 900)
    assert.deepEqual(errors, [])
    await act(async () => appState('active'))
    await act(async () => documentProps.onError({nativeEvent: {code: -1001, description: 'Process interrupted'}}))
    assert.equal(errors.at(-1).name, 'ReaderProcessGone')
    assert.equal(ref.current.inspectFixturePosition().bridge.ready, false)
    assert.equal(ref.current.inspectFixturePosition().bridge.documentLoaded, false)
    await act(async () => (platform === 'ios' ? documentProps : outerProps).onScroll({nativeEvent: {
      contentOffset: {y: 0}, contentSize: {height: 0}, layoutMeasurement: {height: 600},
    }}))
    assert.equal(ref.current.inspectFixturePosition().observed.scrollPoints, 300, 'Dead WebKit layout cannot overwrite the recoverable reading position')
    await assert.rejects(ref.current.captureSelection(), bridge.isReaderOperationCancelled)
  })
})
