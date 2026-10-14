import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {ReaderBridgeSession, parseReaderMessage, parseReaderSelection} from '../../src/reader/bridge.ts'

const pageId = 'fixture'
const wrap = payload => JSON.stringify({channel: 'slax-reader', pageId, payload})
const selection = {text: 'Alpha', source: [{type: 'text', xpath: 'p#first', start_offset: 0, end_offset: 5}],
  select_content: [{type: 'text', text: 'Alpha', src: ''}],
  approx_source: {exact: 'Alpha', prefix: '', suffix: '.', position_start: 0, position_end: 5}}
const hostSource = await readFile(new URL('../../assets/embedded/js/react-native-host.js', import.meta.url), 'utf8')

function host(platform = 'ios') {
  const messages = [], media = []
  const window = {addEventListener() {}, removeEventListener() {}, ReactNativeWebView: {postMessage: raw => messages.push(raw)},
    SlaxWebViewBridge: {captureCurrentSelection: () => JSON.stringify(selection), clearSelection() {}, stopSelectionMonitoring() {}, drawMarks() {}, scrollToAnchor: () => true},
    __slaxGetYoutubeTime: () => 42, __slaxSeekYoutube: value => {media.push(value)}}
  window.top = window
  const document = {readyState: 'loading', addEventListener() {}, removeEventListener() {}, querySelectorAll: query => query === 'img' ? [{getAttribute: () => 'https://images.invalid/a.png'}] : []}
  const context = vm.createContext({window, document, setTimeout, clearTimeout, URL})
  vm.runInContext(hostSource.replace('__SLAX_READER_CONFIGURATION__', JSON.stringify({pageId, platform})), context)
  const evaluate = async script => {
    const value = vm.runInContext(script, context)
    return platform === 'android' ? JSON.stringify(value) : value
  }
  const session = new ReaderBridgeSession(pageId, evaluate, 200)
  session.receive(wrap({type: 'domReady'}))
  return {window, messages, media, evaluate, session, close() {session.dispose(); window.__SlaxReaderHost.teardown()}}
}

test('forged generic commandResult cannot resolve even a known outstanding request', async () => {
  let complete
  const session = new ReaderBridgeSession(pageId, () => new Promise(resolve => {complete = resolve}))
  session.receive(wrap({type: 'domReady'}))
  let settled = false
  const pending = session.request({operation: 'captureSelection'}).then(value => {settled = true; return value})
  const forged = wrap({type: 'commandResult', requestId: 'fixture:1', value: {...selection, text: 'forged'}})
  assert.equal(parseReaderMessage(forged, pageId), null)
  assert.equal(session.receive(forged), null)
  await Promise.resolve()
  assert.equal(settled, false)
  complete(JSON.stringify({pageId, requestId: 'fixture:1', status: 'fulfilled', value: selection}))
  assert.deepEqual(parseReaderSelection(await pending), selection)
  session.dispose()
})

for (const platform of ['ios', 'android']) {
  test(`${platform} evaluation channel captures selection, images, media and asynchronous operations without result events`, async () => {
    const fixture = host(platform)
    try {
      assert.deepEqual(parseReaderSelection(await fixture.session.request({operation: 'captureSelection'})), selection)
      assert.deepEqual(await fixture.session.request({operation: 'queryImageUrls'}), ['https://images.invalid/a.png'])
      await fixture.session.request({operation: 'seekYoutube', argument: 18})
      assert.deepEqual(fixture.media, [18])
      assert.equal(await fixture.session.request({operation: 'queryYoutubeTime'}), 42)
      fixture.window.SlaxWebViewBridge.captureCurrentSelection = () => Promise.resolve(JSON.stringify(selection))
      assert.deepEqual(parseReaderSelection(await fixture.session.request({operation: 'captureSelection'})), selection)
      fixture.window.SlaxWebViewBridge.drawMarks = () => Promise.resolve(undefined)
      assert.equal(await fixture.session.request({operation: 'drawMarks', argument: {mark_list: [], user_list: {}}}), null)
      fixture.window.SlaxWebViewBridge.captureCurrentSelection = () => Promise.reject(new Error('private article contents'))
      await assert.rejects(fixture.session.request({operation: 'captureSelection'}), /^Error: Reader command failed$/)
      assert.equal(fixture.messages.some(raw => JSON.parse(raw).payload.type === 'commandResult'), false)
    } finally {fixture.close()}
  })
}

test('native completion rejects wrong page, wrong request, malformed, undefined and native errors', async () => {
  for (const result of [undefined, 'null', 'undefined', '{}', {pageId: 'old', requestId: 'fixture:1', status: 'fulfilled'},
    {pageId, requestId: 'other', status: 'fulfilled'}, {pageId, requestId: 'fixture:1', status: 'unknown'}]) {
    const session = new ReaderBridgeSession(pageId, async () => result)
    session.receive(wrap({type: 'domReady'}))
    await assert.rejects(session.request({operation: 'captureSelection'}), /Invalid native reader result/)
    session.dispose()
  }
  const session = new ReaderBridgeSession(pageId, async () => {throw new Error('Reader page was released')})
  session.receive(wrap({type: 'domReady'}))
  await assert.rejects(session.request({operation: 'captureSelection'}), /released/)
  session.dispose()
})

test('teardown rejects pending async results and late native callbacks cannot revive a released session', async () => {
  const fixture = host()
  let complete
  fixture.window.SlaxWebViewBridge.captureCurrentSelection = () => new Promise(resolve => {complete = resolve})
  const capture = fixture.session.request({operation: 'captureSelection'})
  const rejected = assert.rejects(capture, /released/)
  await fixture.session.request({operation: 'teardown'})
  fixture.session.dispose()
  complete(selection)
  await rejected
  assert.equal(fixture.session.receive(wrap({type: 'domReady'})), null)
  await assert.rejects(fixture.session.request({operation: 'captureSelection'}), /released/)
  fixture.close()
})

test('a native callback delivered after release cannot resolve or run another poll', async () => {
  let complete, calls = 0
  const session = new ReaderBridgeSession(pageId, () => {calls++; return new Promise(resolve => {complete = resolve})})
  session.receive(wrap({type: 'domReady'}))
  const pending = session.request({operation: 'captureSelection'})
  const rejected = assert.rejects(pending, /released/)
  session.dispose()
  complete(JSON.stringify({pageId, requestId: 'fixture:1', status: 'pending'}))
  await rejected
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(calls, 1)
})

test('host rejects wrong-page and child-frame execution and clears abandoned async results', async () => {
  const fixture = host()
  try {
    assert.equal(JSON.parse(fixture.window.__SlaxReaderHost.execute({pageId: 'old', requestId: 'x', operation: 'captureSelection'})).status, 'rejected')
    fixture.window.top = {}
    assert.equal(JSON.parse(fixture.window.__SlaxReaderHost.execute({pageId, requestId: 'x', operation: 'captureSelection'})).status, 'rejected')
    fixture.window.top = fixture.window
    fixture.window.SlaxWebViewBridge.captureCurrentSelection = () => new Promise(() => {})
    const request = {pageId, requestId: 'pending', operation: 'captureSelection'}
    assert.equal(JSON.parse(fixture.window.__SlaxReaderHost.execute(request)).status, 'pending')
    fixture.window.__SlaxReaderHost.teardown()
    assert.equal(JSON.parse(fixture.window.__SlaxReaderHost.takeResult(request)).status, 'rejected')
  } finally {fixture.close()}
})

test('native adapters expose evaluation callbacks, bind account/page generation and cancel on release', async () => {
  const swift = await readFile(new URL('../../modules/slax-platform/ios/SlaxReaderView.swift', import.meta.url), 'utf8')
  const kotlin = await readFile(new URL('../../modules/slax-platform/android/src/main/java/com/slax/reader/platform/SlaxReaderView.kt', import.meta.url), 'utf8')
  assert.match(swift, /message\.frameInfo\.isMainFrame, message\.name == "slaxReader"/)
  assert.match(swift, /webView\.evaluateJavaScript\(script\) \{ \[weak self\] value, error in/)
  assert.match(swift, /self\.loadedGeneration == generation/)
  assert.match(swift, /loadedOwner == resourceOwner/)
  assert.match(swift, /loadedGeneration = nil; cancelEvaluations\(\)/)
  assert.match(kotlin, /webView\.evaluateJavascript\(script\) \{ value ->/)
  assert.match(kotlin, /generation != currentGeneration/)
  assert.match(kotlin, /loadedOwner == resourceOwner/)
  assert.match(kotlin, /pending\.forEach \{ it\.reject\("E_READER_RELEASED"/)
  assert.match(kotlin, /if \(!request\.isForMainFrame\) return request\.url\.scheme != "https"/)
  assert.doesNotMatch(kotlin, /if \(url == "about:blank".*return false/)
})
