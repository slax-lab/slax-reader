import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React, {act} from 'react';
import {resolveGalleryImage} from '../../src/reader/gallery-resource.ts';
import * as geometry from '../../src/reader/gallery-geometry.ts';
import {galleryCacheFixture, deferred, NativeAbortController} from './gallery-cache-fixture.mjs';
import {installedMotionHost, loadWorkletComponent} from '../ui/installed-motion-host.mjs';

const require = createRequire(import.meta.url);
const domModule = process.env.SLAX_READER_DOM_MODULE || require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});
const code = ts.transpileModule(await readFile(new URL('../../src/reader/ImageGallery.tsx', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
}).outputText;

async function mountedGallery(props, run) {
  const {Window} = await import(pathToFileURL(domModule).href), window = new Window();
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true});
  const {createRoot} = await import('react-dom/client');
  let imageProps, mounted = true, viewport = {width: 390, height: 844}, configuration = {index: 0, onDismiss() {}, errorLabel: 'image-load-failed', ...props};
  const appListeners = new Set();
  const primitive = ({children, testID}) => React.createElement('div', {'data-testid': testID}, children);
  const motion = installedMotionHost(primitive, {deferJS: true});
  const native = {ActivityIndicator: () => React.createElement('div', {'data-busy': true}),
    AppState: {currentState: 'active', addEventListener: (_name, listener) => {appListeners.add(listener); return {remove: () => appListeners.delete(listener)};}},
    Modal: primitive, View: primitive, StyleSheet: {create: value => value, absoluteFill: {}, absoluteFillObject: {}}, useWindowDimensions: () => viewport};
  const {ZoomableImage} = loadWorkletComponent(new URL('../../src/components/ZoomableImage.tsx', import.meta.url), {
    react: React, 'react-native': native, 'react-native-reanimated': motion.reanimated, 'react-native-gesture-handler': motion.gestures,
    './AppImage': {AppImage: value => {if (value.active) imageProps = value; return React.createElement('div', {'data-image-uri': value.active ? value.source : undefined, 'data-prepared-uri': value.source});}},
  });
  const boundaries = {react: React, 'react-native': native, 'react-native-reanimated': motion.reanimated, 'react-native-gesture-handler': motion.gestures,
    '../components': {SourceText: primitive}, '../components/ZoomableImage': {ZoomableImage}, '../motion/useReducedMotion': {useReducedMotion: () => false}, './gallery-geometry': geometry};
  const exported = {};
  vm.runInNewContext(code, {exports: exported, AbortController: NativeAbortController, require(name) {
    assert.ok(Object.hasOwn(boundaries, name), `Unexpected gallery boundary ${name}`); return boundaries[name];
  }});
  const root = createRoot(window.document.body);
  function CommitProbe({callback}) {React.useLayoutEffect(() => callback?.(), [callback]); return null;}
  const render = async (changes = {}, onCommit) => {
    configuration = {...configuration, ...changes};
    await act(async () => root.render(React.createElement(React.Fragment, null,
      React.createElement(exported.ImageGallery, configuration), React.createElement(CommitProbe, {callback: onCommit}))));
  };
  const settle = async () => {await act(async () => {await new Promise(resolve => setTimeout(resolve, 0));});};
  const unmount = async () => {if (mounted) {await act(async () => root.unmount()); mounted = false;}};
  const gesture = (name, taps) => motion.detectors().flatMap(value => value.toGestureArray()).find(value => value.handlerName === name && value.config.enabled && (taps === undefined || value.config.numberOfTaps === taps));
  const swipe = async (translationX = -200, velocityX = -300, flush = true) => {
    await act(async () => {const pan = gesture('PanGestureHandler'), event = {translationX, translationY: 0, velocityX, numberOfPointers: 1};
      pan.handlers.onStart(event); pan.handlers.onUpdate(event); pan.handlers.onEnd(event, true); pan.handlers.onFinalize(event, true);
      motion.advance(250); if (flush) motion.flushJS();});
    await settle();
  };
  try {
    await render(); await settle();
    await run({window, settle, unmount, render, imageProps: () => imageProps, motion, gesture, swipe,
      background: async state => {native.AppState.currentState = state; await act(async () => {for (const listener of appListeners) listener(state);});},
      resize: async value => {viewport = value; await render();}});
  } finally {
    await unmount(); await window.happyDOM.close();
    for (const [name, descriptor] of previous) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];}
  }
}

const shown = window => window.document.querySelector('[data-image-uri]')?.getAttribute('data-image-uri') ?? null;
test('gallery fails closed for custom and HTTPS resources without a remote image fallback', async () => {
  for (const source of ['slaxstatics://images.test/offline.png', 'https://images.test/rss.png']) for (const result of [null, new Error('Failure'), 'https://images.test/unsafe.png']) {
    await mountedGallery({images: [source], resolveUri: async () => {if (result instanceof Error) throw result; return result;}}, async ({window}) => {
      assert.equal(shown(window), null); assert.equal(window.document.body.textContent, 'image-load-failed');
    });
  }
});

test('continuous paging prepares only current and neighbors, cancelling pages outside that window', async () => {
  const first = deferred(), calls = [], images = Array.from({length: 5}, (_, i) => `https://images.test/${i}.png`);
  await mountedGallery({images, resolveUri: (uri, signal) => {calls.push({uri, signal}); return uri === images[0] ? first.promise : Promise.resolve(`file:///${images.indexOf(uri)}.png`);}}, async ({window, swipe, settle}) => {
    assert.equal(calls.length, 2); await swipe();
    assert.equal(calls.length, 3); assert.equal(calls[0].signal.aborted, false, 'The former page remains a retained neighbor');
    assert.equal(shown(window), 'file:///1.png');
    await swipe(); assert.equal(calls.length, 4); assert.equal(calls[0].signal.aborted, true);
    assert.equal(shown(window), 'file:///2.png'); assert.equal(window.document.body.textContent, '3 / 5');
    await act(async () => first.resolve('file:///late-first.png')); await settle(); assert.equal(shown(window), 'file:///2.png');
    assert.equal(window.document.querySelectorAll('[data-prepared-uri]').length, 3);
  });
});

test('queued page settlement cannot win over a newer pinch, and background restores the selected page', async () => {
  const calls = [], images = ['https://images.test/0.png', 'https://images.test/1.png'];
  await mountedGallery({images, resolveUri: async (uri, signal) => {calls.push(signal); return `file:///${images.indexOf(uri)}.png`;}}, async ({window, swipe, motion, gesture, background}) => {
    await swipe(-200, -300, false);
    await act(async () => {gesture('PinchGestureHandler').handlers.onStart({focalX: 195, focalY: 422}); motion.flushJS();});
    assert.equal(window.document.body.textContent, '1 / 2');
    await act(async () => gesture('PinchGestureHandler').handlers.onFinalize({}, true));
    await swipe(); assert.equal(shown(window), 'file:///1.png');
    await background('background'); assert.ok(calls.every(signal => signal.aborted)); assert.equal(shown(window), null);
    await background('active'); assert.equal(shown(window), 'file:///1.png'); assert.equal(window.document.body.textContent, '2 / 2');
  });
});

test('pinch and double-tap use installed UI gestures without continuous JS calls', async () => {
  await mountedGallery({images: ['https://images.test/image.png'], resolveUri: async () => 'file:///image.png'}, async ({gesture, motion, imageProps, resize}) => {
    await act(async () => imageProps().onLoad({width: 1000, height: 500}));
    const before = motion.jsCalls.length;
    await act(async () => {const pinch = gesture('PinchGestureHandler'); pinch.handlers.onStart({focalX: 195, focalY: 422}); pinch.handlers.onUpdate({scale: 3, focalX: 195, focalY: 422}); pinch.handlers.onFinalize({}, true);});
    assert.equal(motion.jsCalls.length, before); assert.ok(motion.values.some(value => value.value === 3));
    await act(async () => {gesture('TapGestureHandler', 2).handlers.onEnd({x: 195, y: 422}, true); motion.advance(250);});
    assert.equal(motion.jsCalls.length, before);
    await resize({width: 844, height: 390}); assert.ok(motion.values.some(value => value.value === 780), 'Fitted image width is recalculated after rotation');
  });
});

test('unmounting gallery cancels a held production download before cache commit', async () => {
  const fixture = galleryCacheFixture(), body = deferred(), reading = deferred(); let requestSignal, pending;
  await mountedGallery({images: ['slaxstatics://images.test/offline.png'], resolveUri: (uri, signal) => {
    pending = resolveGalleryImage(fixture.cache, 'bookmark', uri, {allowNetwork: true, isActive: fixture.isActive, signal,
      loadImage: async (_url, value) => {requestSignal = value; reading.resolve(); return new Uint8Array(await body.promise);}}); return pending;
  }}, async ({unmount}) => {
    await reading.promise; await unmount(); assert.equal(requestSignal.aborted, true);
    body.resolve(new Uint8Array([1]).buffer); await assert.rejects(pending, {name: 'AbortError'}); assert.equal(fixture.contents.size, 0);
  });
});

test('source and account replacement reject stale URI resolution and native callbacks', async () => {
  const replacement = deferred(), resolveUri = uri => uri.endsWith('first.png') ? Promise.resolve('file:///first.png') : replacement.promise;
  await mountedGallery({images: ['https://images.test/first.png'], resolveUri}, async ({window, imageProps, render, settle}) => {
    const old = imageProps(); let duringCommit;
    await render({images: ['https://images.test/replacement.png']}, () => {duringCommit = shown(window); old.onError(); old.onLoad({width: 90, height: 60});});
    assert.equal(duringCommit, null); await settle(); assert.equal(window.document.body.textContent, '');
    replacement.resolve('file:///replacement.png'); await settle(); await act(async () => old.onError());
    assert.equal(shown(window), 'file:///replacement.png'); assert.ok(window.document.querySelector('[data-busy]'));
  });
  const held = deferred(); let active = true;
  await mountedGallery({images: ['https://images.test/account.png'], isActive: () => active, resolveUri: () => held.promise}, async ({window, settle}) => {
    active = false; held.resolve('file:///account.png'); await settle(); assert.equal(shown(window), null);
  });
});

test('loading publication does not restart a settled resolver and retired decode cannot fail a new page', async () => {
  let requests = 0;
  await mountedGallery({images: ['https://images.test/first.png', 'https://images.test/second.png'], resolveUri: async uri => {requests++; return uri.endsWith('first.png') ? 'file:///first.png' : 'file:///second.png';}}, async ({window, imageProps, swipe}) => {
    const old = imageProps(); await act(async () => old.onLoad({width: 100, height: 100})); assert.equal(requests, 2);
    await swipe(); await act(async () => old.onError()); assert.equal(shown(window), 'file:///second.png');
    assert.equal(window.document.body.textContent.includes('image-load-failed'), true, 'Only the retained old page reports its own decode failure');
    await act(async () => imageProps().onLoad({width: 240, height: 160})); assert.equal(requests, 2);
  });
});

test('mounted gallery uses production URI caching and fences cancelled native acquisition without byte loading', async () => {
  const held = deferred(), entered = deferred(); let captured, capturedSignal, pending;
  const fixture = galleryCacheFixture(async (request, signal) => {captured = request; capturedSignal = signal; entered.resolve(); return held.promise;});
  await mountedGallery({images: ['https://images.test/native.png'], resolveUri: (uri, signal) => {
    pending = resolveGalleryImage(fixture.cache, 'bookmark', uri, {allowNetwork: true, isActive: fixture.isActive, signal}); return pending;
  }}, async ({unmount}) => {
    await entered.promise; assert.equal(captured.owner, 'owner-a'); assert.equal(captured.allowNetwork, true); assert.equal(captured.strict, true);
    await unmount(); assert.equal(capturedSignal.aborted, true); held.resolve({uri: 'file:///app/data/bookmark/bookmark/images/native.png', size: 3});
    await assert.rejects(pending, {name: 'AbortError'});
  });
});
