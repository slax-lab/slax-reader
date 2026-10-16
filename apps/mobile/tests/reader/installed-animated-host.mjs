import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync, realpathSync} from 'node:fs'
import {dirname, resolve, relative} from 'node:path'
import vm from 'node:vm'
import React from 'react'

const require = createRequire(import.meta.url)
const root = dirname(realpathSync(require.resolve('react-native/package.json')))
const rnRequire = createRequire(resolve(root, 'package.json'))
const flowPlugin = rnRequire.resolve('@babel/plugin-transform-flow-strip-types')
const babel = createRequire(flowPlugin)('@babel/core')
const commonjs = rnRequire.resolve('@babel/plugin-transform-modules-commonjs')
const hermes = rnRequire.resolve('babel-plugin-syntax-hermes-parser')
const transformed = new Map()

export function installedAnimatedHost(host) {
  const modules = new Map(), scheduled = new Map(), nodes = new Map(), nativeAnimations = new Map(), attached = new Set(), starts = []
  let now = 0, taskId = 0, nodeTag = 0, animationId = 0
  const schedule = (callback, delay = 0) => {const id = ++taskId; scheduled.set(id, {callback, due: now + delay}); return id}
  const cancel = id => scheduled.delete(id)
  class ClockDate extends Date {static now() {return now}}
  const api = {
    setWaitingForIdentifier() {}, unsetWaitingForIdentifier() {},
    createAnimatedNode(tag, config) {nodes.set(tag, {...config})}, dropAnimatedNode(tag) {nodes.delete(tag)},
    connectAnimatedNodes() {}, disconnectAnimatedNodes() {}, connectAnimatedNodeToView() {}, disconnectAnimatedNodeFromView() {},
    restoreDefaultValues() {},
    getValue(tag, callback) {callback(nodes.get(tag)?.value ?? 0)},
    setAnimatedNodeValue(tag, value) {if (nodes.has(tag)) nodes.get(tag).value = value},
    startAnimatingNode(id, tag, config, callback) {
      const task = schedule(() => {nativeAnimations.delete(id); if (nodes.has(tag)) nodes.get(tag).value = config.toValue; callback({finished: true, value: config.toValue})}, config.frames.length * 1000 / 60)
      nativeAnimations.set(id, {task, callback})
    },
    stopAnimation(id) {const animation = nativeAnimations.get(id); if (animation) {nativeAnimations.delete(id); cancel(animation.task); animation.callback({finished: false})}},
  }
  const helper = {API: api, shouldUseNativeDriver: config => config.useNativeDriver, assertNativeAnimatedModule() {}, generateNewNodeTag: () => ++nodeTag, generateNewAnimationId: () => ++animationId,
    transformDataType: value => value, nativeEventEmitter: {addListener: () => ({remove() {}})}}
  const flags = {shouldUseAnimatedObjectForTransform: () => false, cxxNativeAnimatedEnabled: () => false, useSharedAnimatedBackend: () => false}
  const boundaries = new Map([
    ['src/private/animated/NativeAnimatedHelper.js', helper],
    ['src/private/animated/NativeAnimatedValidation.js', {validateInterpolation() {}, validateStyles() {}, validateTransform() {}}],
    ['src/private/featureflags/ReactNativeFeatureFlags.js', flags],
    ['Libraries/ReactNative/RendererProxy.js', {findNodeHandle: () => 1}],
    ['Libraries/ReactPrivate/ReactNativePrivateInterface.js', {getNodeFromPublicInstance: () => null}],
    ['Libraries/Utilities/Platform.js', {OS: 'android'}],
    ['Libraries/StyleSheet/normalizeColor.js', value => value],
    ['Libraries/StyleSheet/processColor.js', value => value],
    ['Libraries/Animated/createAnimatedComponent.js', () => {throw new Error('The React host attaches actual AnimatedProps instead')}],
    ['Libraries/Animated/AnimatedEvent.js', {AnimatedEvent: class {}, attachNativeEventImpl() {throw new Error('No native event mapping in this regression')}}],
    ['Libraries/Animated/nodes/AnimatedColor.js', class {}],
  ])
  function load(file) {
    const name = relative(root, file)
    if (boundaries.has(name)) return boundaries.get(name)
    if (modules.has(file)) return modules.get(file).exports
    assert.ok(name.startsWith('Libraries/Animated/') || name === 'Libraries/StyleSheet/flattenStyle.js', `Unexpected installed Animated dependency ${name}`)
    if (!transformed.has(file)) transformed.set(file, babel.transformSync(readFileSync(file, 'utf8'), {filename: file, configFile: false, babelrc: false, plugins: [hermes, flowPlugin, commonjs]}).code)
    const module = {exports: {}}; modules.set(file, module)
    const localRequire = createRequire(file)
    vm.runInNewContext(transformed.get(file), {module, exports: module.exports, __DEV__: false, process, console, Date: ClockDate,
      global: {cancelAnimationFrame: cancel}, setTimeout: schedule, clearTimeout: cancel, requestAnimationFrame: callback => schedule(callback, 16), cancelAnimationFrame: cancel,
      require(name) {if (!name.startsWith('.')) return localRequire(name); return load(localRequire.resolve(name))}}, {filename: file})
    return module.exports
  }
  const implementation = load(resolve(root, 'Libraries/Animated/AnimatedImplementation.js')).default
  const AnimatedProps = load(resolve(root, 'Libraries/Animated/nodes/AnimatedProps.js')).default
  const timing = implementation.timing
  const Animated = {...implementation, timing(value, config) {const animation = timing(value, config); return {...animation, start(...args) {starts.push({value, config}); animation.start(...args)}}}}
  Animated.View = function InstalledAnimatedView(props) {
    const node = React.useMemo(() => new AnimatedProps({style: props.style}, () => {}), [props.style])
    React.useLayoutEffect(() => {node.__attach(); attached.add(node); return () => {attached.delete(node); node.__detach()}}, [node])
    return React.createElement(host.native.View, props)
  }
  return {Animated, Easing: load(resolve(root, 'Libraries/Animated/Easing.js')).default, AnimatedProps, starts,
    attached: () => attached.size, pending: () => scheduled.size, nativePending: () => nativeAnimations.size,
    advance(milliseconds) {
      const until = now + milliseconds
      for (let count = 0; count < 10000; count++) {
        const next = [...scheduled].sort((a, b) => a[1].due - b[1].due)[0]
        if (!next || next[1].due > until) {now = until; return}
        scheduled.delete(next[0]); now = next[1].due; next[1].callback()
      }
      throw new Error('Installed Animated clock did not settle')
    },
  }
}
