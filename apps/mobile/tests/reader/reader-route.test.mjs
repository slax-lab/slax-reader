import test from 'node:test'
import assert from 'node:assert/strict'
import {React, loadComponent} from './parity-host.mjs'
import * as security from '../../src/reader/security.ts'

const config = {webUrl: 'https://r.slax.com', webDomain: '.slax.com', apiUrl: 'https://api-reader.slax.com', betaApiUrl: 'https://api-reader-beta.slax.com'}
async function route() {
  const Slot = () => null, prewarms = []
  const module = await loadComponent('../../src/navigation/reader-route.tsx', {react: React, 'react-native': {View: () => null, StyleSheet: {create: value => value}},
    '../reader/components/ReaderHeaderSlot': {ReaderHeaderSlot: Slot}, '../screens/ReaderScreen': {ReaderScreen: Slot},
    '../native/reader-prewarm': {prewarmReaderHost: async () => {prewarms.push('native')}}})
  return {...module, Slot, prewarms}
}

test('Reader route options are transparent from the first native configuration and reserve the right item for bookmarks', async () => {
  const {readerScreenOptions, Slot} = await route()
  const bookmark = readerScreenOptions({route: {params: {bookmarkId: 'b'}}})
  assert.equal(bookmark.headerTransparent, true)
  assert.equal(bookmark.headerShadowVisible, false)
  assert.equal(bookmark.headerStyle.backgroundColor, 'transparent')
  assert.equal(bookmark.title, '')
  assert.equal(bookmark.headerRight().type, Slot, 'The first configuration already carries the fixed-size right item')
  const [item] = bookmark.unstable_headerRightItems()
  assert.equal(item.type, 'custom'); assert.equal(item.hidesSharedBackground, true); assert.equal(item.element.type, Slot)
  const preview = readerScreenOptions({route: {params: {bookmarkId: '', rssEntryId: 'r'}}})
  assert.equal(preview.headerTransparent, true)
  assert.equal(preview.headerRight, undefined, 'An RSS preview has only the native back control')
  assert.equal(preview.unstable_headerRightItems, undefined)
  for (const options of [bookmark, preview]) {
    assert.equal(options.headerShown, undefined, 'The native header and its back control stay')
    assert.equal(JSON.stringify(options.scrollEdgeEffects), JSON.stringify({top: 'hidden', bottom: 'hidden', left: 'hidden', right: 'hidden'}), 'iOS 26 adds no scroll-edge blur band under the transparent header')
  }
})

test('Reader prewarm runs once at idle after the Library is presented and cancels with its owner', async () => {
  const {createReaderPrewarm} = await route()
  const scheduled = [], loads = [], warmed = [], listeners = new Set()
  let presented = false, cancelled = 0
  const source = {isLibraryPresented: () => presented, subscribeLibraryPresented: listener => {listeners.add(listener); return () => listeners.delete(listener)}}
  const present = value => {presented = value; listeners.forEach(listener => listener())}
  const prewarm = createReaderPrewarm({load: () => loads.push('reader'), prewarm: async () => {warmed.push('native')},
    schedule: work => {scheduled.push(work); return () => {cancelled++}}})
  const stop = prewarm.afterLibrary(source)
  assert.equal(scheduled.length, 0, 'Nothing is warmed before the Library is presented')
  present(true); present(true)
  assert.equal(scheduled.length, 1, 'Presentation schedules one idle warmup')
  assert.deepEqual(loads, [], 'The warmup waits for idle')
  scheduled[0]()
  await Promise.resolve()
  assert.deepEqual(loads, ['reader']); assert.deepEqual(warmed, ['native'])
  present(false); present(true)
  const again = prewarm.afterLibrary(source); present(true)
  assert.equal(scheduled.length, 1, 'A later presentation or account never warms again')
  stop(); again()
  const pending = createReaderPrewarm({load: () => loads.push('late'), prewarm: async () => {}, schedule: work => {scheduled.push(work); return () => {cancelled++}}})
  presented = true
  const release = pending.afterLibrary(source)
  release()
  assert.equal(cancelled, 1, 'Disposal cancels a pending idle warmup')
  assert.equal(listeners.size, 0)
})

test('preloadReader loads the route module and warms the native host only once', async () => {
  const {preloadReader, prewarms} = await route()
  preloadReader(); preloadReader()
  await Promise.resolve()
  assert.deepEqual(prewarms, ['native'])
})

for (const platform of ['ios', 'android']) test(`${platform} native Reader warmup receives the Reader's protected hosts and proxy origins`, async () => {
  const calls = []
  const {prewarmReaderHost} = await loadComponent('../../src/native/reader-prewarm.ts', {'react-native': {Platform: {OS: platform}},
    expo: {requireNativeModule: name => {assert.equal(name, 'SlaxPlatform'); return {prewarmReader: async (...args) => {calls.push(args)}}}},
    '../config': {mobileConfig: config}, '../reader/security.ts': security})
  await prewarmReaderHost()
  if (platform === 'ios') assert.deepEqual(calls, [[security.readerProtectedHosts(config), security.readerImageProxyOrigins(config)]])
  else assert.deepEqual(calls, [], 'Android has no Reader warmup')
})
