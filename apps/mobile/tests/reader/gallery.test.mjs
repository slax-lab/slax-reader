import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React, {act} from 'react';
import {isCustomGalleryImage, resolveGalleryImage} from '../../src/reader/gallery-resource.ts';
import {galleryCacheFixture, deferred, imageResponse, NativeAbortController} from './gallery-cache-fixture.mjs';

const require = createRequire(import.meta.url);
let domModule = process.env.SLAX_READER_DOM_MODULE;
if (!domModule) {
  try {domModule = require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});} catch {}
}
const code = ts.transpileModule(await readFile(new URL('../../src/reader/ImageGallery.tsx', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
}).outputText;
const nativeBoundary = {skip: !domModule && 'An existing happy-dom runtime is required'};

async function mountedGallery(props, run) {
  const {Window} = await import(pathToFileURL(domModule).href), window = new Window();
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true});
  const {createRoot} = await import('react-dom/client');
  let imageProps, gestures, mounted = true, configuration = {index: 0, onDismiss() {}, errorLabel: 'image-load-failed', ...props};
  const primitive = ({children}) => React.createElement('div', null, children);
  class Value {setValue() {} stopAnimation() {}}
  const boundaries = {
    react: React,
    'react-native': {
      ActivityIndicator: () => React.createElement('div', {'data-busy': true}),
      Animated: {Value, View: primitive, timing: () => ({start() {}}), parallel: () => ({start() {}})},
      Image: value => {imageProps = value; return React.createElement('div', {'data-image-uri': value.source.uri});},
      Modal: primitive, View: primitive, StyleSheet: {create: value => value, absoluteFill: {}},
      useWindowDimensions: () => ({width: 390, height: 844}),
      PanResponder: {create: value => {gestures = value; return {panHandlers: {}};}},
    },
    '../components': {SourceText: primitive},
    './gallery-resource': {isCustomGalleryImage},
  };
  const exported = {};
  vm.runInNewContext(code, {exports: exported, AbortController: NativeAbortController, setTimeout, clearTimeout, require(name) {
    assert.ok(Object.hasOwn(boundaries, name), `Unexpected native gallery boundary ${name}`); return boundaries[name];
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
  try {
    await render();
    await settle();
    await run({window, settle, unmount, render, imageProps: () => imageProps, gestures: () => gestures});
  } finally {
    await unmount(); await window.happyDOM.close();
    for (const [name, descriptor] of previous) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];}
  }
}

test('the actual gallery shows custom failures without bypassing its cache resolver through HTTP', nativeBoundary, async () => {
  for (const result of [null, new Error('Synthetic download failure')]) {
    await mountedGallery({images: ['slaxstatics://images.test/offline.png'], resolveUri: async () => {if (result instanceof Error) throw result; return result;}}, async ({window}) => {
      assert.equal(window.document.querySelector('[data-image-uri]'), null);
      assert.equal(window.document.body.textContent, 'image-load-failed');
    });
  }
});

test('the actual gallery never bypasses its credentialless resolver for ordinary HTTPS', nativeBoundary, async () => {
  await mountedGallery({images: ['https://images.test/rss.png'], resolveUri: async () => null}, async ({window}) => {
    assert.equal(window.document.querySelector('[data-image-uri]'), null);
    assert.equal(window.document.body.textContent, 'image-load-failed');
  });
  await mountedGallery({images: ['https://images.test/rss.png'], resolveUri: async () => null, allowNetworkFallback: false}, async ({window}) => {
    assert.equal(window.document.querySelector('[data-image-uri]'), null);
    assert.equal(window.document.body.textContent, 'image-load-failed');
  });
});

test('an actual gallery page gesture cancels its former request and ignores its late resolution', nativeBoundary, async () => {
  const first = deferred(), calls = [];
  await mountedGallery({images: ['slaxstatics://images.test/first.png', 'slaxstatics://images.test/second.png'], resolveUri: (uri, signal) => {
    calls.push({uri, signal}); return calls.length === 1 ? first.promise : Promise.resolve('file:///second.png');
  }}, async ({window, gestures, settle}) => {
    await act(async () => {
      const event = {nativeEvent: {touches: [{pageX: 100, pageY: 100}]}};
      gestures().onPanResponderGrant(event);
      gestures().onPanResponderMove(event, {dx: -100, dy: 0});
      gestures().onPanResponderRelease(event, {dx: -100, dy: 0});
    });
    await settle();
    assert.equal(calls.length, 2); assert.equal(calls[0].signal.aborted, true); assert.equal(calls[1].signal.aborted, false);
    assert.equal(window.document.querySelector('[data-image-uri]').getAttribute('data-image-uri'), 'file:///second.png');
    await act(async () => first.resolve('file:///late-first.png')); await settle();
    assert.equal(window.document.querySelector('[data-image-uri]').getAttribute('data-image-uri'), 'file:///second.png');
    assert.equal(window.document.body.textContent, '2 / 2');
  });
});

test('unmounting the actual gallery cancels a held production download before cache commit', nativeBoundary, async () => {
  const fixture = galleryCacheFixture(), body = deferred(), reading = deferred(); let requestSignal, pending;
  const images = ['slaxstatics://images.test/offline.png'];
  await mountedGallery({images, resolveUri: (uri, signal) => {
    pending = resolveGalleryImage(fixture.cache, 'bookmark', uri, {allowNetwork: true, isActive: fixture.isActive, signal,
      loadImage: async (_url, value) => {requestSignal = value; reading.resolve(); return new Uint8Array(await body.promise);}});
    return pending;
  }}, async ({unmount}) => {
    await reading.promise; await unmount();
    assert.equal(requestSignal.aborted, true);
    body.resolve(new Uint8Array([1]).buffer);
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(fixture.contents.size, 0);
  });
});

test('a gallery result from an inactive account cannot start an ordinary HTTP fallback', nativeBoundary, async () => {
  const response = deferred(); let active = true;
  await mountedGallery({images: ['https://images.test/rss.png'], isActive: () => active, resolveUri: () => response.promise}, async ({window, settle}) => {
    active = false; await act(async () => response.reject(new Error('Account scope ended'))); await settle();
    assert.equal(window.document.querySelector('[data-image-uri]'), null);
  });
});

test('the gallery default account predicate remains stable when its image finishes loading', nativeBoundary, async () => {
  let requests = 0;
  await mountedGallery({images: ['slaxstatics://images.test/offline.png'], resolveUri: async () => {requests++; return 'file:///offline.png';}}, async ({imageProps, settle}) => {
    await act(async () => imageProps().onLoad({nativeEvent: {source: {width: 100, height: 100}}})); await settle();
    assert.equal(requests, 1, 'The loading state update must not cancel and restart its settled resolver');
  });
});

test('queued native image callbacks from an old page cannot finish or fail its replacement', nativeBoundary, async () => {
  const second = deferred();
  await mountedGallery({images: ['https://images.test/first.png', 'https://images.test/second.png'],
    resolveUri: uri => uri.endsWith('first.png') ? Promise.resolve('file:///first.png') : second.promise}, async ({window, imageProps, gestures, settle}) => {
    const old = imageProps();
    await act(async () => {
      const event = {nativeEvent: {touches: [{pageX: 100, pageY: 100}]}};
      gestures().onPanResponderGrant(event); gestures().onPanResponderMove(event, {dx: -100, dy: 0}); gestures().onPanResponderRelease(event, {dx: -100, dy: 0});
    });
    await settle();
    for (const deliver of [() => old.onLoad({nativeEvent: {source: {uri: 'file:///first.png', width: 120, height: 80}}}), () => old.onError({nativeEvent: {error: 'Old decode error'}})]) {
      await act(async () => deliver()); await settle();
      assert.ok(window.document.querySelector('[data-busy]'), 'An old decode callback cannot finish the replacement loading state');
      assert.equal(window.document.body.textContent, '2 / 2', 'An old decode error cannot mark the replacement as failed');
    }
    second.resolve('file:///second.png'); await settle();
    await act(async () => imageProps().onLoad({nativeEvent: {source: {uri: 'file:///second.png', width: 240, height: 160}}}));
    assert.equal(window.document.querySelector('[data-busy]'), null, 'The current native load still finishes its own page');
  });
});

test('same-page source replacement hides the former native image before passive cleanup and rejects its callbacks', nativeBoundary, async () => {
  const replacement = deferred(), firstImages = ['https://images.test/first.png'];
  const resolveUri = uri => uri.endsWith('first.png') ? Promise.resolve('file:///first.png') : replacement.promise;
  await mountedGallery({images: firstImages, resolveUri}, async ({window, imageProps, render, settle}) => {
    const old = imageProps(); let imageDuringCommit;
    await render({images: ['https://images.test/replacement.png']}, () => {
      imageDuringCommit = window.document.querySelector('[data-image-uri]')?.getAttribute('data-image-uri') ?? null;
      old.onError({nativeEvent: {error: 'Queued source error'}});
      old.onLoad({nativeEvent: {source: {uri: 'file:///first.png', width: 90, height: 60}}});
    });
    assert.equal(imageDuringCommit, null, 'The render transition must hide the old URI before passive request cleanup');
    await settle();
    assert.ok(window.document.querySelector('[data-busy]'));
    assert.equal(window.document.body.textContent, '');
    replacement.resolve('file:///replacement.png'); await settle();
    await act(async () => old.onError({nativeEvent: {error: 'Former URI error'}})); await settle();
    assert.equal(window.document.querySelector('[data-image-uri]').getAttribute('data-image-uri'), 'file:///replacement.png');
    assert.equal(window.document.body.textContent, '');
    assert.ok(window.document.querySelector('[data-busy]'), 'Only the replacement decode may finish its loading state');
  });
});

test('native decode callbacks recheck account ownership before changing loading or error state', nativeBoundary, async () => {
  let active = true;
  await mountedGallery({images: ['https://images.test/account.png'], isActive: () => active, resolveUri: async () => 'file:///account.png'}, async ({window, imageProps, settle}) => {
    const old = imageProps(); active = false;
    await act(async () => old.onLoad({nativeEvent: {source: {uri: 'file:///account.png', width: 100, height: 100}}}));
    await act(async () => old.onError({nativeEvent: {error: 'Revoked owner decode'}})); await settle();
    assert.ok(window.document.querySelector('[data-busy]'), 'Revoked ownership cannot publish native load completion');
    assert.equal(window.document.body.textContent, '', 'Revoked ownership cannot publish a new image error');
  });
});
