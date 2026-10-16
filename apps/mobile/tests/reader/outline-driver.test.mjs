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
  assert.equal(ui.jsCalls.length, 0, 'Outline animation frames do not dispatch to JS')
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
