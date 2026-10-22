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
export function loadWorkletComponent(url, boundaries) {
  boundaries = {...motionModules(boundaries), ...boundaries};
  const code = ts.transpileModule(readFileSync(url, 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText;
  const transformed = babel.transformSync(code, {filename: url.pathname, configFile: false, babelrc: false, plugins: [workletPlugin, modulesPlugin]}).code;
  const exports = {};
  vm.runInNewContext(transformed, {exports, global: {Error}, __DEV__: false, require: name => {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}}, {filename: url.pathname});
  return exports;
}
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
  const springConfigs = installed(resolve(ra, 'src/animation/spring/springConfigs.ts'));
  const springUtils = installed(resolve(ra, 'src/animation/spring/springUtils.ts'), {'../../common': {logger: {warn() {}}}});
  const {withSpring} = installed(resolve(ra, 'src/animation/spring/spring.ts'), {'../util': animationUtil, './springConfigs': springConfigs, './springUtils': springUtils});
  const animations = new Map(), values = [], detectors = new Map(), jsCalls = [], queuedJS = [], started = [];
  let now = 1;
  function cancelAnimation(value) {const animation = animations.get(value); if (animation) {animations.delete(value); animation.callback?.(false);}}
  const reanimated = {
    __esModule: true, default: {View, ScrollView: View}, withTiming, withDelay, withSequence, withSpring, Easing, ReduceMotion, cancelAnimation,
    runOnJS: callback => (...args) => {jsCalls.push(callback); if (deferJS) queuedJS.push(() => callback(...args)); else return callback(...args);},
    useSharedValue(initial) {
      return React.useMemo(() => {let current = initial; const value = {get value() {return current;}, set value(next) {
        const previous = animations.get(value); cancelAnimation(value);
        if (next && typeof next === 'object' && next.onFrame) {next.onStart(next, current, now, previous); started.push(next); animations.set(value, next);} else current = next;
      }, frame(next) {current = next;}}; values.push(value); return value;}, []);
    },
    useAnimatedStyle: callback => callback(),
    useAnimatedScrollHandler: callback => callback,
  };
  const gestures = {Gesture: {
    Pan: () => new PanGesture(), Pinch: () => new PinchGesture(), Tap: () => new TapGesture(), Native: () => new NativeGesture(),
    Race: (...children) => new ComposedGesture(...children), Simultaneous: (...children) => new SimultaneousGesture(...children), Exclusive: (...children) => new ExclusiveGesture(...children),
  }, GestureHandlerRootView: View, GestureDetector: function GestureDetector({gesture, children}) {
    const key = React.useRef(Symbol()).current;
    React.useLayoutEffect(() => {gesture.prepare(); detectors.set(key, gesture); return () => detectors.delete(key);});
    return React.createElement(View, null, children);
  }};
  return {reanimated, gestures, values, jsCalls, started, detectors: () => [...detectors.values()],
    setReducedMotion(value) {systemMotion.value = value;},
    flushJS() {while (queuedJS.length) queuedJS.shift()();},
    advance(ms) {now += ms; for (const [value, animation] of [...animations]) {const done = animation.onFrame(animation, now); value.frame(animation.current); if (done) {animations.delete(value); animation.callback?.(true);}}},
    pending: () => animations.size,
  };
}
