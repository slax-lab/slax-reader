import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import React, {act} from 'react'
import {motionModules} from '../ui/motion-modules.mjs'

const require = createRequire(import.meta.url)
let domModule = process.env.SLAX_READER_DOM_MODULE
if (!domModule) {
  try {domModule = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]})} catch {}
}
export const nativeBoundary = {skip: !domModule && 'An existing happy-dom runtime is required'}
const frames = new Map()
let frameId = 0
// Native frame boundary: work scheduled for the next frame runs after the current synchronous
// task completes, so fixtures observe frame-deferred readiness once they await.
const frameBoundary = {
  requestAnimationFrame: callback => {const id = ++frameId; frames.set(id, callback); queueMicrotask(() => {const pending = frames.get(id); frames.delete(id); pending?.(0)}); return id},
  cancelAnimationFrame: id => frames.delete(id),
}
export {React, act}
export async function loadComponent(path, boundaries, globals = {}) {
  // Host-mounted UI has no Expo native modules. Tests that exercise a native
  // boundary provide their own implementation, overriding these unavailable
  // defaults explicitly.
  boundaries = {
    expo: {requireNativeModule() {throw new Error('Native Expo module unavailable in parity host');}},
    'expo-app-intents': {isAvailable: () => false, useAppIntents() {}, removePendingInvocationAsync: async () => {}, setEntityCatalogAsync: async () => {throw new Error('App Intents unavailable in parity host');}, deleteDonationsAsync: async () => {throw new Error('App Intents unavailable in parity host');}, donateIntentAsync: async () => {throw new Error('App Intents unavailable in parity host');}},
    'expo-widgets': {}, '@expo/ui/swift-ui': {},
    ...boundaries,
  }
  boundaries = {...motionModules(boundaries), ...boundaries}
  if (path.endsWith('/ReaderOverlays.tsx') && !boundaries['../components/SourceSheetModal']) {
    boundaries = {...boundaries, '../components/SourceSheetModal': await loadComponent('../../src/components/SourceSheetModal.tsx', {react: boundaries.react, 'react-native': boundaries['react-native'], '../theme': boundaries['../theme'], 'react-native-reanimated': boundaries['react-native-reanimated'], 'react-native-gesture-handler': boundaries['react-native-gesture-handler']}, globals)}
  }
  if ((!boundaries['react-native-reanimated'] || !boundaries['react-native-gesture-handler']) && boundaries['react-native']?.View) {
    const {installedMotionHost} = await import('../ui/installed-motion-host.mjs')
    const motion = installedMotionHost(boundaries['react-native'].View)
    boundaries = {...boundaries, 'react-native-reanimated': boundaries['react-native-reanimated'] ?? motion.reanimated, 'react-native-gesture-handler': boundaries['react-native-gesture-handler'] ?? motion.gestures}
  }
  const entry = new URL(path, import.meta.url)
  const normalize = url => url.href.replace(/\.(tsx?|jsx?)$/, '').replace(/\/index$/, '')
  const mapped = new Map(Object.entries(boundaries).map(([name, value]) => [name.startsWith('.') ? normalize(new URL(name, entry)) : name, value]))
  const modules = new Map()
  const load = async url => {
    const key = normalize(url)
    if (mapped.has(key)) return mapped.get(key)
    if (modules.has(key)) return modules.get(key)
    let source, resolved
    for (const suffix of /\.[a-z]+$/.test(url.pathname) ? [''] : ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      try {resolved = new URL(`${url.href}${suffix}`); source = await readFile(resolved, 'utf8'); break} catch (error) {if (error.code !== 'ENOENT') throw error}
    }
    assert.notEqual(source, undefined, `Missing real parity module: ${url.pathname}`)
    const exports = {}; modules.set(key, exports)
    const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText
    const imports = new Map()
    for (const match of code.matchAll(/require\(["']([^"']+)["']\)/g)) {
      const name = match[1]
      if (name.startsWith('.')) imports.set(name, await load(new URL(name, resolved)))
      else {assert.ok(mapped.has(name), `Unexpected native parity boundary: ${name} in ${resolved.pathname}`); imports.set(name, mapped.get(name))}
    }
    vm.runInNewContext(code, {exports, __DEV__: true, AbortController, Date, URL, setTimeout, clearTimeout, ...frameBoundary, ...globals, require: name => imports.get(name)}, {filename: resolved.pathname})
    return exports
  }
  return load(entry)
}
export async function withRenderedElement(element, run) {
  const {createRoot} = await import('react-dom/client')
  const container = document.createElement('div'), root = createRoot(container)
  document.body.append(container)
  try {await act(async () => root.render(element)); return await run(container)}
  finally {await act(async () => root.unmount()); container.remove()}
}
export async function withNativeHost(run) {
  const {Window} = await import(pathToFileURL(domModule).href), window = new Window()
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true})
  const {createRoot} = await import('react-dom/client')
  const root = createRoot(window.document.body), props = new Map(), animations = [], values = [], keyboard = new Map()
  let gestures, focused = 0, dismisses = 0
  class Value {
    constructor(value) {this.value = value; values.push(this)}
    setValue(value) {this.value = value}
    stopAnimation() {}
    interpolate(config) {return {value: this, ...config}}
  }
  const primitive = React.forwardRef(function Primitive(value, ref) {
    React.useImperativeHandle(ref, () => ({focus() {focused++}, measureInWindow(callback) {callback(0, 200, 390, 40)}}), [])
    if (value.testID) props.set(value.testID, value)
    return React.createElement('div', {'data-testid': value.testID}, value.children)
  })
  const timing = (value, config) => ({start(callback) {animations.push(config); value.setValue(config.toValue); callback?.({finished: true})}, stop() {}})
  const group = children => ({start(callback) {children.forEach(child => child.start()); callback?.({finished: true})}, stop() {children.forEach(child => child.stop())}})
  const native = {
    View: primitive, Pressable: primitive, ScrollView: primitive, FlatList: props => React.createElement(primitive, props, props.data?.map((item, index) => React.createElement(React.Fragment, {key: props.keyExtractor?.(item, index) ?? index}, props.renderItem({item, index})))), TextInput: primitive, KeyboardAvoidingView: primitive,
    Modal: value => value.visible ? React.createElement(primitive, value) : null,
    ActivityIndicator: primitive, Image: primitive,
    Animated: {Value, View: primitive, timing, sequence: group, parallel: group},
    Easing: {bezier: (...points) => points, linear: 'linear', cubic: 'cubic', out: value => value}, StyleSheet: {create: value => value, absoluteFill: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0}},
    AccessibilityInfo: {isReduceMotionEnabled: async () => false, addEventListener: () => ({remove() {}})},
    Platform: {OS: 'ios'}, useWindowDimensions: () => ({width: 390, height: 844}),
    Keyboard: {addListener: (name, callback) => {keyboard.set(name, callback); return {remove() {keyboard.delete(name)}}}, dismiss() {dismisses++}},
    AppState: {addEventListener: () => ({remove() {}})},
    PanResponder: {create(value) {gestures = value; return {panHandlers: {}}}},
  }
  const components = {SourceAvatar: primitive, SourceText: primitive, SourceIcon: primitive, TextAction: primitive, SourceDialog: value => value.visible ? React.createElement(primitive, value, value.children, value.actions) : null}
  try {
    await run({native, components, window, props, animations, values, keyboard, gestures: () => gestures, focused: () => focused, dismisses: () => dismisses,
      render: async element => {props.clear(); await act(async () => root.render(element))},
      settle: async (delay = 0) => act(async () => {await new Promise(resolve => setTimeout(resolve, delay))}),
      unmount: async () => act(async () => root.unmount()),
    })
  } finally {
    await act(async () => root.unmount()); await window.happyDOM.close()
    for (const [name, descriptor] of previous) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]}
  }
}
export const flattenStyle = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean))
