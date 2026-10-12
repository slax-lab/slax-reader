import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import React, {act} from 'react'

const require = createRequire(import.meta.url)
let domModule = process.env.SLAX_READER_DOM_MODULE
if (!domModule) {
  try {domModule = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]})} catch {}
}
export const nativeBoundary = {skip: !domModule && 'An existing happy-dom runtime is required'}
export {React, act}
export async function loadComponent(path, boundaries, globals = {}) {
  const code = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText
  const exports = {}
  vm.runInNewContext(code, {exports, __DEV__: true, AbortController, Date, URL, setTimeout, clearTimeout, ...globals, require(name) {
    assert.ok(Object.hasOwn(boundaries, name), `Unexpected native parity boundary: ${name}`)
    return boundaries[name]
  }})
  return exports
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
    View: primitive, Pressable: primitive, ScrollView: primitive, FlatList: primitive, TextInput: primitive, KeyboardAvoidingView: primitive,
    Modal: value => value.visible ? React.createElement(primitive, value) : null,
    ActivityIndicator: primitive, Image: primitive,
    Animated: {Value, View: primitive, timing, sequence: group, parallel: group},
    Easing: {bezier: (...points) => points, linear: 'linear'}, StyleSheet: {create: value => value, absoluteFill: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0}},
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
