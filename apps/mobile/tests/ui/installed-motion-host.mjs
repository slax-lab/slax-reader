import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {motionModules} from './motion-modules.mjs';

const require = createRequire(import.meta.url);
const workletsRequire = createRequire(require.resolve('react-native-worklets/package.json'));
const babel = workletsRequire('@babel/core');
const workletPlugin = workletsRequire.resolve('react-native-worklets/plugin');
const modulesPlugin = workletsRequire.resolve('@babel/plugin-transform-modules-commonjs');
export function loadWorkletComponent(url, boundaries, globals = {}) {
  boundaries = {...motionModules(boundaries), ...boundaries};
  const code = ts.transpileModule(readFileSync(url, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText;
  const transformed = babel.transformSync(code, {filename: url.pathname, configFile: false, babelrc: false, plugins: [workletPlugin, modulesPlugin]}).code;
  const exports = {};
  vm.runInNewContext(transformed, {exports, global: {Error}, __DEV__: false, ...globals, require: name => {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}}, {filename: url.pathname});
  return exports;
}
/** The production drawer gesture policy, compiled with the same worklet plugin as its consumer. */
export function drawerMotionModule() {return loadWorkletComponent(new URL('../../src/components/drawer-motion.ts', import.meta.url), {});}
function installed(file, boundaries = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports, __DEV__: false, require: name => {assert.ok(Object.hasOwn(boundaries, name), `${file}: ${name}`); return boundaries[name];}}, {filename: file});
  return exports;
}
export function installedMotionHost(View, {reducedMotion = false, deferJS = false} = {}) {
  const gh = dirname(require.resolve('react-native-gesture-handler/package.json'));
  const callbackTypes = installed(resolve(gh, 'src/CallbackType.ts'));
  const base = installed(resolve(gh, 'src/handlers/gestures/gesture.ts'), {'../../CallbackType': callbackTypes, '../getNextHandlerTag': {getNextHandlerTag: () => 1}, '../../utils': {isRemoteDebuggingEnabled: () => false}});
  const {PanGesture} = installed(resolve(gh, 'src/handlers/gestures/panGesture.ts'), {'./gesture': base});
  const {PinchGesture} = installed(resolve(gh, 'src/handlers/gestures/pinchGesture.ts'), {'./gesture': base});
  const {TapGesture} = installed(resolve(gh, 'src/handlers/gestures/tapGesture.ts'), {'./gesture': base});
  const {NativeGesture} = installed(resolve(gh, 'src/handlers/gestures/nativeGesture.ts'), {'./gesture': base});
  const {ComposedGesture, SimultaneousGesture, ExclusiveGesture} = installed(resolve(gh, 'src/handlers/gestures/gestureComposition.ts'), {'./gesture': base});
  const ra = dirname(require.resolve('react-native-reanimated/package.json'));
  const {Bezier} = installed(resolve(ra, 'src/Bezier.ts'));
  const {Easing} = installed(resolve(ra, 'src/Easing.ts'), {'./Bezier': {Bezier}});
  const {ReduceMotion} = installed(resolve(ra, 'src/commonTypes.ts'));
  const systemMotion = {value: reducedMotion};
  const commonAnimationUtil = installed(resolve(ra, 'src/animation/utilCommon.ts'), {
    'react-native-worklets': {createSerializable: value => value, serializableMappingCache: new Map(), RuntimeKind: {ReactNative: 1}},
    '../Colors': {isColor: () => false}, '../common': {SHOULD_BE_USE_WEB: true, logger: {warn() {}}},
    '../commonTypes': {ReduceMotion}, '../ReducedMotion': {ReducedMotionManager: {uiValue: systemMotion}},
    './transformationMatrix/matrixUtils': {isAffineMatrixFlat: () => false},
  });
  const animationUtil = installed(resolve(ra, 'src/animation/util.ts'), {
    'react-native-worklets': {RuntimeKind: {ReactNative: 1}}, './utilCommon': commonAnimationUtil,
  });
  const {withTiming} = installed(resolve(ra, 'src/animation/timing.ts'), {'../Easing': {Easing}, './util': animationUtil});
  const {withDelay} = installed(resolve(ra, 'src/animation/delay.ts'), {'./util': animationUtil});
  const {withSequence} = installed(resolve(ra, 'src/animation/sequence.ts'), {'./util': animationUtil, '../common': {logger: {warn() {}}}});
  const {withRepeat} = installed(resolve(ra, 'src/animation/repeat.ts'), {'./util': animationUtil});
  const springConfigs = installed(resolve(ra, 'src/animation/spring/springConfigs.ts'));
  const springUtils = installed(resolve(ra, 'src/animation/spring/springUtils.ts'), {'../../common': {logger: {warn() {}}}});
  const {withSpring} = installed(resolve(ra, 'src/animation/spring/spring.ts'), {'../util': animationUtil, './springConfigs': springConfigs, './springUtils': springUtils});
  const animations = new Map(), values = [], detectors = new Map(), jsCalls = [], queuedJS = [], started = [], writes = [], cancels = [], styles = [];
  let now = 1;
  function cancelAnimation(value) {cancels.push(value); const animation = animations.get(value); if (animation) {animations.delete(value); animation.callback?.(false);}}
  const toJS = (callback, args) => {jsCalls.push(callback); if (deferJS) queuedJS.push(() => callback(...args)); else return callback(...args);};
  const reanimated = {
    __esModule: true, default: {View, ScrollView: View}, withTiming, withDelay, withSequence, withRepeat, withSpring, Easing, ReduceMotion, cancelAnimation,
    runOnJS: callback => (...args) => {jsCalls.push(callback); if (deferJS) queuedJS.push(() => callback(...args)); else return callback(...args);},
    useSharedValue(initial) {
      return React.useMemo(() => {let current = initial; const value = {get value() {return current;}, set value(next) {
        writes.push(value);
        const previous = animations.get(value); cancelAnimation(value);
        if (next && typeof next === 'object' && next.onFrame) {next.onStart(next, current, now, previous); started.push(next); animations.set(value, next);} else current = next;
      }, frame(next) {current = next;}}; values.push(value); return value;}, []);
    },
    // Each call is one UI-thread mapper; `deps` mirrors the optional dependency array.
    useAnimatedStyle: (callback, deps) => {styles.push({callback, deps}); return callback();},
    // Animated props are UI-thread state: expose live getters so tests read the value the UI thread would commit.
    useAnimatedProps: callback => new Proxy({}, {get: (_target, key) => callback()[key], has: (_target, key) => key in callback(), ownKeys: () => Reflect.ownKeys(callback()), getOwnPropertyDescriptor: (_target, key) => ({value: callback()[key], enumerable: true, configurable: true})}),
    useAnimatedScrollHandler: handlers => typeof handlers === 'function' ? handlers : {scrollHandlers: handlers},
  };
  const worklets = {scheduleOnRN: (callback, ...args) => toJS(callback, args)};
  const workletCallbacks = ['onBegin', 'onActivate', 'onUpdate', 'onDeactivate', 'onFinalize'];
  // RNGH v3 hook: the config is the gesture; every supplied callback must be a UI worklet.
  const usePanGesture = config => React.useMemo(() => ({type: 'pan', config, handlers: config, shouldUseReanimated: workletCallbacks.filter(key => config[key]).every(key => '__workletHash' in config[key])}), [config]);
  const gestures = {usePanGesture, Gesture: {
    Pan: () => new PanGesture(), Pinch: () => new PinchGesture(), Tap: () => new TapGesture(), Native: () => new NativeGesture(),
    Race: (...children) => new ComposedGesture(...children), Simultaneous: (...children) => new SimultaneousGesture(...children), Exclusive: (...children) => new ExclusiveGesture(...children),
  }, GestureHandlerRootView: View, GestureDetector: function GestureDetector({gesture, children}) {
    const key = React.useRef(Symbol()).current;
    React.useLayoutEffect(() => {gesture.prepare?.(); detectors.set(key, gesture); return () => detectors.delete(key);});
    return React.createElement(View, null, children);
  }};
  return {reanimated, gestures, worklets, values, jsCalls, started, writes, cancels, styles, detectors: () => [...detectors.values()],
    setReducedMotion(value) {systemMotion.value = value;},
    flushJS() {while (queuedJS.length) queuedJS.shift()();},
    advance(ms) {now += ms; for (const [value, animation] of [...animations]) {const done = animation.onFrame(animation, now); value.frame(animation.current); if (done) {animations.delete(value); animation.callback?.(true);}}},
    pending: () => animations.size,
  };
}
