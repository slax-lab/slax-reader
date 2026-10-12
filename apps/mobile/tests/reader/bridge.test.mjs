import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { parseReaderMessage, parseReaderSelection, ReaderBridgeSession } from '../../src/reader/bridge.ts'
import { composeReaderDocument, composeReaderError, scriptJson } from '../../src/reader/document.ts'
import { legacyPositionToScrollPoints, scrollPointsToLegacyPosition, anchorToScrollPoints, selectionMenuTop, readerNearBottom } from '../../src/reader/coordinates.ts'
import { ReaderPositionWriter } from '../../src/reader/position.ts'
import {readerAssets} from '../../src/reader/embedded.generated.ts'

const wrap = (payload, pageId = 'fixture') => JSON.stringify({ channel: 'slax-reader', pageId, payload })
const range = {
  id: 'range-1', source: [{ type: 'text', path: 'div:nth-child(1) > p#first', start: 2, end: 5 }],
  comments: [], stroke: [{ mark_id: 12, userId: 7 }], approx: { exact: 'pha', prefix: 'Al', suffix: ' end.' },
}

test('bridge accepts legacy nested selection JSON and rejects malformed/stale messages', () => {
  const event = parseReaderMessage(wrap({ type: 'textSelected', data: JSON.stringify(range), selectionGeometry: { touchClientY: 40, top: 20, bottom: 35 } }), 'fixture')
  assert.equal(event.type, 'textSelected')
  assert.equal(event.text, 'pha')
  assert.deepEqual(event.mark.source, range.source)
  assert.equal(event.selectionGeometry.touchClientY, 40)
  assert.equal(parseReaderMessage(wrap({ type: 'textSelected', data: JSON.stringify(range) }, 'old-page'), 'fixture'), null)
  assert.equal(parseReaderMessage(wrap({ type: 'textSelected', data: '{malformed' }), 'fixture'), null)
  assert.equal(parseReaderMessage(wrap({ type: 'scrollToPosition', percentage: Infinity }), 'fixture'), null)
  assert.equal(parseReaderMessage(wrap({ type: 'purchase', productId: 'unrelated' }), 'fixture'), null)
  assert.equal(parseReaderMessage('not json', 'fixture'), null)
})

test('selection input keeps source start_offset spelling, exact context, and cross-node paths', () => {
  const selection = {
    source: [{ type: 'text', xpath: 'p#first', start_offset: 2, end_offset: 5 }, { type: 'text', xpath: 'p#second', start_offset: 0, end_offset: 4 }],
    select_content: [{ type: 'text', text: 'phaNext', src: '' }],
    approx_source: { exact: 'pha\nNext', prefix: 'Al', suffix: '.', position_start: 2, position_end: 10 }, text: 'phaNext',
  }
  assert.deepEqual(parseReaderSelection(JSON.stringify(selection)), selection)
  assert.equal(parseReaderSelection(null), null)
  assert.throws(() => parseReaderSelection({ ...selection, source: [{ type: 'text', xpath: 'p', start_offet: 1, end_offset: 2 }] }), /Invalid selection/)
})

test('commands round-trip dangerous article characters without executing them', async () => {
  let command
  const session = new ReaderBridgeSession('fixture', async script => {
    return vm.runInNewContext(script, { window: { __SlaxReaderHost: { execute: value => {
      command = value
      return JSON.stringify({pageId: value.pageId, requestId: value.requestId, status: 'fulfilled', value: true})
    } } } })
  })
  session.receive(wrap({ type: 'domReady' }))
  const anchor = '</script>` ${globalThis.secret} \u2028\\ quoted "text"'
  const result = session.request({ operation: 'scrollToAnchor', argument: anchor })
  assert.equal(command.argument, anchor)
  session.receive(wrap({ type: 'commandResult', requestId: command.requestId, value: true }, 'stale'))
  session.receive(wrap({ type: 'commandResult', requestId: command.requestId, value: true }))
  assert.equal(await result, true)
  session.dispose()
  assert.ok(!scriptJson({ anchor }).includes('</script>'))
})

test('page release cancels pending callbacks and does not accept old responses', async () => {
  const session = new ReaderBridgeSession('fixture', () => new Promise(() => {}))
  session.receive(wrap({ type: 'domReady' }))
  const result = session.request({ operation: 'captureSelection' })
  session.dispose()
  await assert.rejects(result, /released/)
  assert.equal(session.receive(wrap({ type: 'domReady' })), null)
  await assert.rejects(session.request({ operation: 'clearSelection' }), /released/)
})

test('a missing document result times out without leaking an outstanding request', async () => {
  const session = new ReaderBridgeSession('fixture', () => new Promise(() => {}), 5)
  session.receive(wrap({ type: 'domReady' }))
  await assert.rejects(session.request({ operation: 'captureSelection' }), /timed out/)
  session.dispose()
})

test('composer preserves article markup and literal source-template markers', () => {
  const article = '<p>{{ARTICLE-CSS}} `${message}`</p><iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe><table><tr><td>Cell</td></tr></table>'
  const document = composeReaderDocument(article, { pageId: '</script>', platform: 'ios' })
  assert.ok(document.includes(article))
  assert.ok(document.includes('window.SlaxWebViewBridge = new'))
  assert.ok(document.includes('window.__slaxSeekYoutube = doSeek'))
  assert.ok(document.indexOf('installSlaxReaderHost') < document.indexOf('SlaxReaderWebBridgeExports'))
  const error = composeReaderError('<title>', 'Reason & cause', 'Unsafe <script>')
  assert.ok(error.includes('&lt;title&gt;'))
  assert.ok(error.includes('Reason &amp; cause'))
  assert.ok(error.includes('data:image/png;base64,'))
})

test('legacy physical-pixel positions round-trip across the two source scroll models', () => {
  const geometry = { pixelRatio: 3, topInsetPoints: 180, headerHeightPoints: 150, containerScreenTopPoints: 90, webViewScreenTopPoints: 90, viewportHeightPoints: 600 }
  for (const platform of ['android', 'ios']) {
    for (const position of [0, 120, 1500, 9000]) {
      assert.equal(scrollPointsToLegacyPosition(platform, legacyPositionToScrollPoints(platform, position, geometry), geometry), position)
    }
  }
  assert.equal(legacyPositionToScrollPoints('ios', 0, geometry), -180)
  assert.equal(anchorToScrollPoints('android', 800, geometry), 800)
  assert.equal(anchorToScrollPoints('ios', 800, geometry), 620)
  assert.equal(selectionMenuTop(30, 600, 20), 62)
  assert.equal(selectionMenuTop(590, 600, 20), 514)
})

test('iOS bottom toolbar uses the source adjusted KVO distance, including the header but excluding inset twice', () => {
  const geometry = {pixelRatio: 3, topInsetPoints: 296, headerHeightPoints: 230, containerScreenTopPoints: 0, webViewScreenTopPoints: 0, viewportHeightPoints: 758}
  // Source ScrollChange at raw 516pt is 812pt/2436px after its top inset.
  // DetailScreen's remaining gap is (1440 - 812 - 758 + 230) * 3 = 300px.
  assert.equal(readerNearBottom('ios', 516, 1440, 758, geometry), false)
  assert.equal(readerNearBottom('ios', 517, 1440, 758, geometry), true)
  assert.equal(readerNearBottom('ios', -216, 1440, 758, geometry), false)
  // Android's outer scroll content already includes the article header.
  assert.equal(readerNearBottom('android', 1050, 1900, 758, geometry), true)
  assert.equal(readerNearBottom('android', 1042, 1900, 758, geometry), false)
})

test('immediate background flush cancels debounce and serializes newer snapshots', async () => {
  const calls = []
  let release
  const paused = new Promise(resolve => { release = resolve })
  const writer = new ReaderPositionWriter(async (position, reason) => { calls.push([position, reason]); if (position === 40) await paused }, () => {}, 1000)
  writer.update(40)
  const first = writer.flush('background')
  writer.update(80)
  const second = writer.flush('exit')
  await Promise.resolve()
  assert.deepEqual(calls, [[40, 'background']])
  release()
  await Promise.all([first, second])
  await writer.dispose()
  assert.deepEqual(calls, [[40, 'background'], [80, 'exit']])
})

test('a failed position write remains retryable and does not poison later persistence', async () => {
  let attempts = 0
  const errors = []
  const writer = new ReaderPositionWriter(() => { if (++attempts === 1) throw new Error('disk unavailable') }, error => errors.push(error), 1000)
  writer.update(120)
  await assert.rejects(writer.flush('background'), /disk unavailable/)
  await writer.flush('exit')
  await writer.dispose()
  assert.equal(attempts, 2)
  assert.equal(errors.length, 1)
})


test('iOS transport retains dynamically exposed native handlers and rejects stale source forwarding', () => {
  const messages = []
  let sourceCalls = 0
  const sourceHandler = {postMessage(message) { sourceCalls++; window.__SlaxReaderHost.receiveSourceMessage(message, 'fixture') }}
  const nativeHandler = {postMessage() { throw new Error('The native transport must retain its own handler') }}
  const webkit = {}
  // Each access exposes the registered native names. Adding a JS property to
  // one returned map cannot register a handler in a later map.
  Object.defineProperty(webkit, 'messageHandlers', {get: () => ({slaxReader: nativeHandler, NativeBridge: sourceHandler})})
  const window = {ReactNativeWebView: {postMessage: message => messages.push(message)}, addEventListener() {}, removeEventListener() {}}
  window.top = window
  Object.defineProperty(window, 'webkit', {get: () => webkit})
  const document = {readyState: 'loading', addEventListener() {}, removeEventListener() {}, querySelectorAll() { return [] }}
  const script = readerAssets.nativeHostJs.replace('__SLAX_READER_CONFIGURATION__', JSON.stringify({pageId: 'fixture', platform: 'ios'}))
  assert.doesNotThrow(() => vm.runInNewContext(script, {window, document}))
  assert.equal(window.webkit, webkit)
  assert.equal(window.webkit.messageHandlers.NativeBridge, sourceHandler)
  assert.equal(window.webkit.messageHandlers.slaxReader, nativeHandler)
  assert.equal(typeof window.__SlaxReaderHost.execute, 'function')
  assert.equal(typeof window.__SlaxReaderHost.receiveSourceMessage, 'function')
  window.webkit.messageHandlers.NativeBridge.postMessage(JSON.stringify({type: 'domReady'}))
  assert.equal(sourceCalls, 1)
  assert.equal(parseReaderMessage(messages[0], 'fixture')?.type, 'domReady')
  assert.equal(window.__SlaxReaderHost.receiveSourceMessage(JSON.stringify({type: 'tap'}), 'released-page'), false)
  for (const raw of ['{', 'null', '[]', 'true', '{"type":2}', 'x'.repeat(8 * 1024 * 1024 + 1)]) {
    assert.equal(window.__SlaxReaderHost.receiveSourceMessage(raw, 'fixture'), false)
  }
  assert.equal(messages.length, 1, 'Malformed or stale source messages cannot reach RN')
  window.__SlaxReaderHost.teardown()
  assert.equal(window.__SlaxReaderHost.receiveSourceMessage(JSON.stringify({type: 'tap'}), 'fixture'), false)
  assert.equal(messages.length, 1, 'Released document messages cannot reach RN')
})
