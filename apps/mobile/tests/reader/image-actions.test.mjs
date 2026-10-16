import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {imageExportType, stagedImageExpired, stagedImageName} from '../../src/domain/image-export.ts'
import {parseReaderMessage} from '../../src/reader/bridge.ts'
import {drawerSettleDuration, motionDuration} from '../../src/motion/policy.ts'
import {React, act, loadComponent, withNativeHost} from './parity-host.mjs'

const bytes = values => Uint8Array.from(values)
const text = value => Uint8Array.from(value, character => character.charCodeAt(0))

test('image exports are typed by file signature rather than cached file name', () => {
  assert.equal(imageExportType(bytes([0xff, 0xd8, 0xff, 0xe0]))?.extension, 'jpg')
  assert.equal(imageExportType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mimeType, 'image/png')
  assert.equal(imageExportType(text('GIF89a'))?.extension, 'gif')
  assert.equal(imageExportType(text('RIFF\0\0\0\0WEBPVP8 '))?.extension, 'webp')
  assert.equal(imageExportType(text('\0\0\0\x18ftypheic'))?.uti, 'public.heic')
  assert.equal(imageExportType(text('\0\0\0\x1cftypavif'))?.extension, 'avif')
  assert.equal(imageExportType(text('<svg xmlns=')), null, 'Vector and text payloads are not photo-library images')
  assert.equal(imageExportType(bytes([])), null)
  const name = stagedImageName(1000, 'a/b-c!', {extension: 'png', mimeType: 'image/png', uti: 'public.png'})
  assert.equal(name, 'image-1000-abc.png')
  assert.equal(stagedImageExpired(name, 1000 + 60_000, 120_000), false)
  assert.equal(stagedImageExpired(name, 1000 + 180_000, 120_000), true)
  assert.equal(stagedImageExpired('unrelated.png', Number.MAX_SAFE_INTEGER, 1), false, 'Only staged export names are pruned')
})

test('reader bridge accepts a long-pressed image source and rejects malformed payloads', () => {
  const wrap = payload => JSON.stringify({channel: 'slax-reader', pageId: 'page', payload})
  assert.deepEqual(parseReaderMessage(wrap({type: 'imageLongPress', src: 'slaxstatics://images.test/a.png'}), 'page'), {type: 'imageLongPress', src: 'slaxstatics://images.test/a.png'})
  assert.equal(parseReaderMessage(wrap({type: 'imageLongPress', src: ''}), 'page'), null)
  assert.equal(parseReaderMessage(wrap({type: 'imageLongPress'}), 'page'), null)
  assert.equal(parseReaderMessage(wrap({type: 'imageLongPress', src: 'x'}), 'other-page'), null)
})

test('in-document long press posts image actions and suppresses the following tap and gallery click', async () => {
  const source = await readFile(new URL('../../assets/embedded/js/react-native-host.js', import.meta.url), 'utf8')
  const listeners = new Map(), messages = [], timers = new Map()
  let timerId = 0, selection = {isCollapsed: true, removeAllRanges() {}}
  const listen = (type, callback) => {if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback)}
  const fire = (type, event) => {for (const callback of listeners.get(type) ?? []) callback(event)}
  const window = {ReactNativeWebView: {postMessage: raw => messages.push(JSON.parse(raw).payload)}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    addEventListener: listen, removeEventListener() {}, getSelection: () => selection, webkit: {messageHandlers: {}}}
  window.top = window
  const document = {readyState: 'complete', body: {scrollHeight: 10, offsetHeight: 10}, documentElement: {scrollHeight: 10, appendChild() {}},
    addEventListener: listen, removeEventListener() {}, querySelectorAll: () => [], createElement: () => ({}), head: {appendChild() {}}}
  const image = {currentSrc: 'slaxstatics://images.test/a.png', closest: query => query === 'img' ? image : null}
  vm.runInNewContext(source.replace('__SLAX_READER_CONFIGURATION__', JSON.stringify({pageId: 'page', platform: 'ios'})), {window, document,
    setTimeout: (callback, ms) => {timers.set(++timerId, {callback, ms}); return timerId}, clearTimeout: id => timers.delete(id)})
  const touch = (x, y) => ({clientX: x, clientY: y})
  fire('touchstart', {touches: [touch(10, 10)], target: image})
  const pending = [...timers.values()].find(timer => timer.ms === 450)
  assert.ok(pending, 'A still press on an image schedules the long-press action')
  pending.callback()
  assert.deepEqual(messages.filter(message => message.type === 'imageLongPress'), [{type: 'imageLongPress', src: 'slaxstatics://images.test/a.png'}])
  fire('touchend', {changedTouches: [touch(10, 10)], target: image})
  assert.equal(messages.some(message => message.type === 'tap'), false, 'The long press never toggles the toolbar')
  let prevented = 0, stopped = 0
  fire('click', {preventDefault() {prevented++}, stopImmediatePropagation() {stopped++}})
  assert.equal(prevented, 1); assert.equal(stopped, 1, 'The trailing click cannot open the gallery')
  timers.clear()
  fire('touchstart', {touches: [touch(10, 10)], target: image})
  fire('touchmove', {touches: [touch(30, 10)], target: image})
  assert.equal(timers.size, 0, 'Moving the finger cancels the long press')
  selection = {isCollapsed: false, removeAllRanges() {}}
  fire('touchstart', {touches: [touch(10, 10)], target: image})
  assert.equal([...timers.values()].some(timer => timer.ms === 450), false, 'An active text selection keeps its own interaction')
  window.__SlaxReaderHost.teardown()
})

test('sidebar settle time covers only the remaining distance', () => {
  assert.equal(motionDuration.drawer, 220)
  assert.equal(drawerSettleDuration(0, 1), 220)
  assert.equal(drawerSettleDuration(0.75, 1), 120, 'Short completions keep a minimum perceivable duration')
  assert.equal(drawerSettleDuration(0.3, 1), 154)
  assert.equal(drawerSettleDuration(1, 1), 0)
})

test('image actions start only after the sheet dismisses and report save results per surface', async () => withNativeHost(async host => {
  const {useImageActions} = await loadComponent('../../src/reader/state/useImageActions.ts', {react: React})
  const calls = [], gate = {}
  let state, active = true, denied = false
  const port = {
    async save(uri) {calls.push(['save', uri]); if (denied) throw Object.assign(new Error('denied'), {denied: true})},
    async share(uri) {calls.push(['share', uri])},
    feedback() {calls.push(['feedback'])},
    isPermissionDenied: error => Boolean(error?.denied),
  }
  const resolveUri = async (uri, signal) => {calls.push(['resolve', uri]); if (gate.promise) await gate.promise; if (signal.aborted) throw Object.assign(new Error('aborted'), {name: 'AbortError'}); return `file:///cache/${uri.split('/').pop()}`}
  function Harness() {state = useImageActions({port, resolveUri, isActive: () => active}); return null}
  await host.render(React.createElement(Harness))
  await act(async () => state.open('https://images.test/a.png', 'document'))
  assert.equal(state.visible, true); assert.equal(state.request.surface, 'document'); assert.equal(JSON.stringify(calls), JSON.stringify([['feedback']]))
  await act(async () => state.save())
  assert.equal(state.visible, false); assert.equal(calls.length, 1, 'Nothing runs while the sheet is still dismissing')
  await act(async () => state.dismissed()); await host.settle()
  assert.equal(JSON.stringify(calls.slice(1)), JSON.stringify([['resolve', 'https://images.test/a.png'], ['save', 'file:///cache/a.png']]))
  assert.equal(state.notice.kind, 'saved'); assert.equal(state.notice.surface, 'document'); assert.equal(state.request, null)

  calls.length = 0; denied = true
  await act(async () => state.open('https://images.test/b.png', 'gallery'))
  await act(async () => state.save()); await act(async () => state.dismissed()); await host.settle()
  assert.equal(state.notice.kind, 'save_permission'); assert.equal(state.notice.surface, 'gallery')

  calls.length = 0
  await act(async () => state.open('https://images.test/c.png', 'document'))
  await act(async () => state.cancel()); await act(async () => state.dismissed()); await host.settle()
  assert.equal(JSON.stringify(calls), JSON.stringify([['feedback']]), 'Cancel performs no file or share work')

  calls.length = 0; let release; gate.promise = new Promise(resolve => {release = resolve})
  await act(async () => state.open('https://images.test/d.png', 'document'))
  await act(async () => state.share()); await act(async () => state.dismissed())
  active = false; release(); await host.settle()
  assert.equal(calls.some(([name]) => name === 'share'), false, 'A result after the account becomes inactive is discarded')
}))
