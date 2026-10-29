import test from 'node:test'
import assert from 'node:assert/strict'
import {React, act, nativeBoundary, loadComponent, withNativeHost} from './parity-host.mjs'
import {installedAnimatedHost} from './installed-animated-host.mjs'
import {installedMotionHost} from '../ui/installed-motion-host.mjs'
import {flattenStyle} from './parity-host.mjs'
import * as motion from '../../src/reader/outline-motion.ts'
import * as model from '../../src/reader/model.ts'
import * as coordinates from '../../src/reader/coordinates.ts'
import {mobileColors, mobileTypography} from '../../src/theme/index.ts'

const conflict = /Attempting to run JS driven animation on animated node/

test('installed RN promotes sibling opacity through AnimatedProps and rejects a later JS driver', nativeBoundary, async () => withNativeHost(async host => {
  const {Animated, AnimatedProps} = installedAnimatedHost(host)
  const offset = new Animated.Value(0), opacity = new Animated.Value(0)
  const props = new AnimatedProps({style: {opacity, transform: [{translateY: offset}]}}, () => {})
  props.__attach()
  const native = Animated.timing(offset, {toValue: 150, duration: 300, useNativeDriver: true})
  try {
    native.start()
    assert.equal(opacity.__isNative, true, 'The real RN style graph promotes the opacity even though only offset started natively')
    assert.throws(() => Animated.timing(opacity, {toValue: 1, duration: 200, useNativeDriver: false}).start(), conflict)
  } finally {native.stop(); props.__detach()}
}))

for (const first of ['none', 'collapsed', 'expanded']) test(`actual OutlineSheet uses installed UI animation sequences from ${first} through interruption and remount`, nativeBoundary, async () => withNativeHost(async host => {
  const installed = installedAnimatedHost(host), ui = installedMotionHost(host.native.View)
  const {OutlineSheet} = await loadComponent('../../src/reader/ReaderOverlays.tsx', {
    react: React, 'react-native': {...host.native, Animated: installed.Animated, Easing: installed.Easing},
    'react-native-reanimated': ui.reanimated,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})},
    '../components': host.components, '../theme': {mobileColors, mobileTypography}, './coordinates.ts': coordinates, './model.ts': model,
    './MarkdownView.tsx': {MarkdownView: props => React.createElement(host.native.View, {...props, testID: 'markdown'})}, './outline-motion.ts': motion,
  })
  const props = {toolbarVisible: true, markdown: 'Outline', pending: false, busy: false, error: null, position: 120, t: key => key,
    onClose() {}, onCollapse() {}, onExpand() {}, onRetry() {}, onLink() {}, onPosition() {}}
  const render = (status, toolbarVisible = true, key = 'first') => host.render(React.createElement(OutlineSheet, {...props, status, toolbarVisible, key}))
  const advance = async duration => act(async () => {for (let time = 0; time < duration; time += 16) ui.advance(16)})
  await render(first)
  await advance(75)
  for (const [status, toolbarVisible] of [['collapsed', true], ['expanded', true], ['collapsed', false], ['expanded', false], ['hidden', true], ['collapsed', true], ['none', false], ['collapsed', true]]) {
    await render(status, toolbarVisible)
    await advance(75)
  }
  await render('expanded')
  await advance(1000)
  await render('expanded')
  assert.ok(host.props.get('markdown'))
  const morphStyle = flattenStyle(host.props.get('reader-outline-morph').style)
  assert.equal(morphStyle.width, 390)
  assert.equal(morphStyle.height, 746)
  assert.equal(flattenStyle(host.props.get('reader-outline-panel').style).opacity, 1)
  assert.equal(installed.starts.length, 0, 'Outline never starts an RN JavaScript-frame animation')
  assert.ok(ui.jsCalls.length <= 1, 'Only a settled expansion reports to JS, once; animation frames never do')
  await render('collapsed')
  await advance(110)
  await host.render(null)
  assert.equal(ui.pending(), 0)
  await render('collapsed', true, 'remounted')
  await render('expanded', false, 'remounted')
  await advance(1000)
  assert.equal(ui.pending(), 0)
  await host.render(null)
  assert.equal(ui.pending(), 0)
}))

const outlineProps = {toolbarVisible: true, markdown: 'Outline', pending: false, busy: false, error: null, position: 120, t: key => key,
  onClose() {}, onCollapse() {}, onExpand() {}, onRetry() {}, onLink() {}, onPosition() {}}
async function outlineHost(host, options) {
  const ui = installedMotionHost(host.native.View, options)
  const {OutlineSheet} = await loadComponent('../../src/reader/ReaderOverlays.tsx', {
    react: React, 'react-native': {...host.native, PixelRatio: {get: () => 3, roundToNearestPixel: value => value}}, 'react-native-reanimated': ui.reanimated,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})},
    '../components': host.components, '../theme': {mobileColors, mobileTypography}, './coordinates.ts': coordinates, './model.ts': model,
    './MarkdownView.tsx': {MarkdownView: props => React.createElement(host.native.View, {...props, testID: 'markdown'})}, './outline-motion.ts': motion,
  })
  const render = props => host.render(React.createElement(OutlineSheet, {...outlineProps, ...props}))
  const advance = async duration => act(async () => {for (let time = 0; time < duration; time += 16) ui.advance(16)})
  return {ui, render, advance}
}

for (const [from, settle] of [['none', 300], ['collapsed', 560]]) test(`outline mounts its Markdown WebView only after the ${from} → expanded transition settles`, nativeBoundary, async () => withNativeHost(async host => {
  const {ui, render, advance} = await outlineHost(host)
  assert.equal(motion.outlineSettleTrack(motion.outlineMotion(from, 'expanded')).duration, settle)
  await render({status: from}); await advance(400)
  await render({status: 'expanded'})
  assert.equal(host.props.get('markdown'), undefined, 'The WebView is not created while the panel slides or morphs in')
  await advance(settle - 40); await render({status: 'expanded'})
  assert.equal(host.props.get('markdown'), undefined, 'Still transitioning')
  assert.ok(flattenStyle(host.props.get('reader-outline-panel').style).opacity < 1 || from === 'none')
  await advance(80); await render({status: 'expanded'})
  assert.ok(host.props.get('markdown'), 'Settled expansion mounts the outline content')
  await render({status: 'collapsed'}); await advance(700); await render({status: 'collapsed'})
  assert.ok(host.props.get('markdown'), 'Collapsing keeps the mounted WebView, like the source composition')
  assert.equal(ui.pending(), 0)
}))

test('an interrupted expansion never reports settled content', nativeBoundary, async () => withNativeHost(async host => {
  const {render, advance} = await outlineHost(host)
  await render({status: 'none'})
  await render({status: 'expanded'}); await advance(100)
  await render({status: 'hidden'}); await advance(600); await render({status: 'hidden'})
  assert.equal(host.props.get('markdown'), undefined, 'A cancelled transition does not mount the WebView')
}))

test('reduced motion snaps the outline to its final state and mounts content immediately', nativeBoundary, async () => withNativeHost(async host => {
  const reducedNative = {...host.native, AccessibilityInfo: {isReduceMotionEnabled: async () => true, addEventListener: () => ({remove() {}})}}
  const ui = installedMotionHost(host.native.View, {reducedMotion: true})
  const {OutlineSheet} = await loadComponent('../../src/reader/ReaderOverlays.tsx', {
    react: React, 'react-native': reducedNative, 'react-native-reanimated': ui.reanimated,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})},
    '../components': host.components, '../theme': {mobileColors, mobileTypography}, './coordinates.ts': coordinates, './model.ts': model,
    './MarkdownView.tsx': {MarkdownView: props => React.createElement(host.native.View, {...props, testID: 'markdown'})}, './outline-motion.ts': motion,
  })
  const render = status => host.render(React.createElement(OutlineSheet, {...outlineProps, status}))
  await render('none'); await host.settle(); await render('none')
  await render('expanded'); await render('expanded')
  assert.ok(host.props.get('markdown'))
  assert.equal(flattenStyle(host.props.get('reader-outline-panel').style).opacity, 1)
  await act(async () => ui.advance(16))
  assert.equal(ui.pending(), 0, 'No transition frames run under reduced motion')
}))

test('outline loading states use the source skeleton, dots line and dots ring on UI-thread loops', nativeBoundary, async () => withNativeHost(async host => {
  const {ui, render, advance} = await outlineHost(host)
  await render({status: 'none'})
  await render({status: 'expanded', pending: true, busy: true}); await advance(400)
  assert.ok(host.props.get('reader-outline-skeleton'), 'Pending generation shows the pulsing skeleton')
  assert.equal(host.props.get('reader-outline-skeleton').accessibilityLabel, 'outline_summarizing')
  assert.equal(host.props.get('reader-outline-dots-line'), undefined)
  await render({status: 'expanded', pending: false, busy: true, markdown: '# Partial'}); await advance(16)
  assert.ok(host.props.get('reader-outline-dots-line'), 'Streaming beneath partial content shows the dots line')
  assert.equal(host.props.get('reader-outline-skeleton'), undefined)
  const looping = ui.pending()
  await advance(3000)
  assert.ok(ui.pending() >= looping && looping >= 4, 'Loading loops repeat on the UI thread until the stream ends')
  await render({status: 'collapsed', pending: false, busy: true, markdown: '# Partial'}); await advance(700)
  assert.ok(host.props.get('reader-outline-dots-ring'), 'The collapsed button carries the rotating ring while the outline streams')
  await render({status: 'collapsed', pending: false, busy: false, markdown: '# Done'}); await advance(16)
  assert.equal(host.props.get('reader-outline-dots-ring'), undefined)
  assert.equal(host.props.get('reader-outline-dots-line'), undefined)
  await host.render(null)
  assert.equal(ui.pending(), 0, 'Unmounting cancels every loading loop')
}))

test('outline loading loops stay still under reduced motion', nativeBoundary, async () => withNativeHost(async host => {
  const reducedNative = {...host.native, PixelRatio: {get: () => 3, roundToNearestPixel: value => value}, AccessibilityInfo: {isReduceMotionEnabled: async () => true, addEventListener: () => ({remove() {}})}}
  const ui = installedMotionHost(host.native.View, {reducedMotion: true})
  const {OutlineSheet} = await loadComponent('../../src/reader/ReaderOverlays.tsx', {
    react: React, 'react-native': reducedNative, 'react-native-reanimated': ui.reanimated,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})},
    '../components': host.components, '../theme': {mobileColors, mobileTypography}, './coordinates.ts': coordinates, './model.ts': model,
    './MarkdownView.tsx': {MarkdownView: props => React.createElement(host.native.View, {...props, testID: 'markdown'})}, './outline-motion.ts': motion,
  })
  const render = props => host.render(React.createElement(OutlineSheet, {...outlineProps, ...props}))
  await render({status: 'none'}); await host.settle()
  await render({status: 'collapsed', busy: true, pending: false}); await host.settle()
  await render({status: 'collapsed', busy: true, pending: false})
  assert.ok(host.props.get('reader-outline-dots-ring'))
  await act(async () => ui.advance(16))
  assert.equal(ui.pending(), 0, 'Reduced motion starts no repeating loading animation')
}))
