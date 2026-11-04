import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {React, act, nativeBoundary, loadComponent, withNativeHost, flattenStyle} from './parity-host.mjs'
import {mobileColors} from '../../src/theme/index.ts'

const require = createRequire(import.meta.url)
const rnRequire = createRequire(require.resolve('react-native/package.json'))
const flow = rnRequire.resolve('@babel/plugin-transform-flow-strip-types')
const babel = createRequire(flow)('@babel/core')
const keyboardFile = rnRequire.resolve('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView')
const keyboardCode = babel.transformSync(readFileSync(keyboardFile, 'utf8'), {
  filename: keyboardFile, configFile: false, babelrc: false,
  plugins: [rnRequire.resolve('babel-plugin-syntax-hermes-parser'), flow,
    rnRequire.resolve('@babel/plugin-transform-modules-commonjs'),
    require.resolve('@babel/plugin-transform-react-jsx', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]})],
}).code

async function fixture(host, platform) {
  const listeners = new Map()
  const Keyboard = {isVisible: () => false, addListener(name, callback) {
    if (!listeners.has(name)) listeners.set(name, new Set())
    listeners.get(name).add(callback)
    return {remove() {listeners.get(name).delete(callback)}}
  }}
  const boundaries = {
    react: React, '../../LayoutAnimation/LayoutAnimation': {configureNext() {}, Types: {keyboard: 'keyboard'}},
    '../../StyleSheet/StyleSheet': {compose: (a, b) => [a, b]}, '../../Utilities/Platform': {OS: platform},
    '../AccessibilityInfo/AccessibilityInfo': {prefersCrossFadeTransitions: async () => false},
    '../View/View': host.native.View, './Keyboard': Keyboard,
  }
  const module = {exports: {}}
  vm.runInNewContext(keyboardCode, {module, exports: module.exports, require(name) {
    assert.ok(Object.hasOwn(boundaries, name), `Unexpected installed keyboard dependency ${name}`)
    return boundaries[name]
  }}, {filename: keyboardFile})
  const InstalledKeyboardAvoidingView = module.exports.default
  const native = {...host.native, Platform: {OS: platform}, Keyboard,
    KeyboardAvoidingView: props => React.createElement(InstalledKeyboardAvoidingView, {...props, testID: 'installed-comment-keyboard-layout'}),
  }
  const {ReaderSheet} = await loadComponent('../../src/reader/components/ReaderSheet.tsx', {
    react: React, 'react-native': native,
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 50, bottom: 24})},
    '../../components/SourceSheetModal': {}, '../../theme': {mobileColors},
  })
  await host.render(React.createElement(ReaderSheet, {visible: true, inline: true, comment: true, testID: 'comment-sheet', onDismiss() {}},
    React.createElement(host.native.View, {testID: 'comment-editor'})))
  return {
    layout: height => act(async () => host.props.get('installed-comment-keyboard-layout').onLayout({persist() {}, nativeEvent: {layout: {x: 0, y: 0, width: 390, height}}})),
    event: (visible, top = 500) => act(async () => {
      const name = `${platform === 'ios' ? 'keyboardWill' : 'keyboardDid'}${visible ? 'Show' : 'Hide'}`
      for (const callback of listeners.get(name)) callback({duration: 250, easing: 'keyboard', endCoordinates: {screenX: 0, screenY: top, width: 390, height: 844 - top}})
    }),
    style: () => flattenStyle(host.props.get('installed-comment-keyboard-layout').style),
    subscriptions: () => [...listeners.values()].reduce((total, callbacks) => total + callbacks.size, 0),
  }
}

for (const platform of ['android', 'ios']) test(`Reader comment editor avoids a changing ${platform} keyboard and restores its viewport`, nativeBoundary, async () => withNativeHost(async host => {
  const f = await fixture(host, platform)
  await f.layout(844)
  await f.event(true, 500)
  if (platform === 'android') assert.equal(f.style().height, 500, 'The bottom-anchored editor must end above the keyboard')
  else assert.equal(f.style().paddingBottom, 344)
  await f.layout(platform === 'android' ? 500 : 844)
  await f.event(true, 450)
  if (platform === 'android') assert.equal(f.style().height, 450)
  else assert.equal(f.style().paddingBottom, 394)
  await f.event(false)
  assert.equal(f.style().height, undefined)
  assert.equal(f.style().paddingBottom ?? 0, 0)
  assert.ok(host.props.get('comment-editor'), 'Keyboard changes retain the existing editor')
  await host.unmount()
  assert.equal(f.subscriptions(), 0)
}))

test('Reader does not subtract the Android keyboard twice when the native window already resized', nativeBoundary, async () => withNativeHost(async host => {
  const f = await fixture(host, 'android')
  await f.layout(844)
  await f.layout(500)
  await f.event(true, 500)
  assert.equal(f.style().height, undefined, 'The already resized parent supplies the available 500-point viewport')
  await f.event(false)
  assert.equal(f.style().height, undefined)
}))
