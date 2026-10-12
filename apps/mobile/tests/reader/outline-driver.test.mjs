import test from 'node:test'
import assert from 'node:assert/strict'
import {React, act, nativeBoundary, loadComponent, withNativeHost} from './parity-host.mjs'
import {installedAnimatedHost} from './installed-animated-host.mjs'
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

for (const first of ['none', 'collapsed', 'expanded']) test(`actual OutlineSheet uses stable installed RN driver ownership from ${first} through interrupted transitions and remount`, nativeBoundary, async () => withNativeHost(async host => {
  const installed = installedAnimatedHost(host)
  const {OutlineSheet} = await loadComponent('../../src/reader/ReaderOverlays.tsx', {
    react: React, 'react-native': {...host.native, Animated: installed.Animated, Easing: installed.Easing},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 62, bottom: 34})},
    '../components': host.components, '../theme': {mobileColors, mobileTypography}, './coordinates.ts': coordinates, './model.ts': model,
    './MarkdownView.tsx': {MarkdownView: props => React.createElement(host.native.View, {...props, testID: 'markdown'})}, './outline-motion.ts': motion,
  })
  const props = {toolbarVisible: true, markdown: 'Outline', pending: false, busy: false, error: null, position: 120, t: key => key,
    onClose() {}, onCollapse() {}, onExpand() {}, onRetry() {}, onLink() {}, onPosition() {}}
  const render = async (status, toolbarVisible = true, key = 'first') => {
    try {await host.render(React.createElement(OutlineSheet, {...props, status, toolbarVisible, key}))}
    catch (error) {throw new Error((error.errors ?? [error]).map(value => value.stack ?? value).join('\n'))}
  }
  await render(first)
  await act(async () => installed.advance(75))
  for (const [status, toolbarVisible] of [['collapsed', true], ['expanded', true], ['collapsed', false], ['expanded', false], ['hidden', true], ['collapsed', true], ['none', false], ['collapsed', true]]) {
    await render(status, toolbarVisible)
    await act(async () => installed.advance(75))
  }
  await render('expanded')
  await act(async () => installed.advance(1000))
  assert.ok(host.props.get('markdown'), 'The actual sequence finishes and exposes outline content')
  const byValue = new Map()
  for (const {value, config} of installed.starts) {
    if (!byValue.has(value)) byValue.set(value, new Set())
    byValue.get(value).add(config.useNativeDriver)
  }
  assert.ok([...byValue.values()].every(drivers => drivers.size === 1), 'A value never changes driver between zero-duration, timed and interrupted transitions')
  const morphStyle = host.props.get('reader-outline-morph').style
  assert.equal(morphStyle.opacity.__isNative, false)
  assert.equal(morphStyle.width.__isNative, false, 'Width/height morph cannot be promoted to the unsupported native layout driver')
  assert.equal(morphStyle.height.__isNative, false)
  assert.ok(installed.starts.filter(({config}) => config.duration === 380).every(({config}) => config.useNativeDriver === false))
  assert.ok(installed.starts.filter(({config}) => config.duration === 150 && config.delay === 430).every(({config}) => config.useNativeDriver === true), 'Collapsed opacity remains native throughout delayed collapse')
  assert.ok(installed.starts.some(({config}) => config.useNativeDriver === false), 'Geometry morph remains JS-driven')
  assert.ok(installed.starts.some(({config}) => config.useNativeDriver === true), 'Supported motion retains native offload')
  await render('collapsed')
  await act(async () => installed.advance(110))
  await host.render(null)
  assert.equal(installed.attached(), 0)
  assert.equal(installed.nativePending(), 0)
  assert.equal(installed.pending(), 0)
  await act(async () => installed.advance(1000))
  await render('collapsed', true, 'remounted')
  await render('expanded', false, 'remounted')
  await act(async () => installed.advance(1000))
  assert.equal(installed.nativePending(), 0)
  await host.render(null)
  assert.equal(installed.attached(), 0)
  assert.equal(installed.pending(), 0)
}))
