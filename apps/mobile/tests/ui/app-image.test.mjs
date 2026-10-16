import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React, {act} from 'react';
import {decodeImage} from '../../src/components/image-decode.ts';

const require = createRequire(import.meta.url);
const domModule = process.env.SLAX_READER_DOM_MODULE || require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});
const code = ts.transpileModule(await readFile(new URL('../../src/components/AppImage.tsx', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true},
}).outputText;
const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};
async function host(run) {
  const {Window} = await import(pathToFileURL(domModule).href), window = new Window();
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, {value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : name === 'window' ? window : window[name], configurable: true, writable: true});
  let value, reduced = false, mounted = true; const requests = [];
  function Image(props) {value = props; return React.createElement('div');}
  Image.loadAsync = (source, options) => {const result = deferred(); requests.push({source, options, ...result}); return result.promise;};
  const boundaries = {react: React, 'expo-image': {Image}, '../../assets': {mobileAssets: {default_avatar: 91}},
    '../motion/useReducedMotion': {useReducedMotion: () => reduced}, './image-decode': {decodeImage}};
  const exports = {};
  vm.runInNewContext(code, {exports, URL, AbortController, require(name) {assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name];}});
  const {createRoot} = await import('react-dom/client'), root = createRoot(window.document.body);
  const render = async props => {await act(async () => root.render(React.createElement(exports.AppImage, props)));};
  const unmount = async () => {if (mounted) {await act(async () => root.unmount()); mounted = false;}};
  try {await run({render, unmount, requests, value: () => value, reduced: state => {reduced = state;}, source: exports.appImageSource});}
  finally {await unmount(); await window.happyDOM.close(); for (const [name, descriptor] of previous) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];}}
}

test('AppImage preserves bundled sources, rejects unsafe URIs and applies bounded native decode', async () => {
  await host(async ({render, requests, value, source, reduced}) => {
    assert.equal(source(12), 12); assert.equal(source('javascript:alert(1)'), undefined); assert.equal(source('https://user:pass@images.test/a.png'), undefined);
    assert.equal(source('invalid', 'default_avatar'), 91);
    let released = 0;
    await render({source: 12, maxPixels: Infinity, fallback: 'default_avatar', label: 'Avatar'});
    assert.equal(requests[0].source, 12); assert.equal(requests[0].options.maxWidth, 1024); assert.equal(value().source, 91);
    const image = {width: 100, height: 100, release() {released++;}};
    await act(async () => requests[0].resolve(image)); assert.equal(value().source, image); assert.equal(value().accessibilityLabel, 'Avatar'); assert.equal(value().cachePolicy, 'none');
    reduced(true); await render({source: 12, maxPixels: Infinity, fallback: 'default_avatar'});
    assert.equal(value().transition, 0); assert.equal(value().autoplay, false); assert.equal(requests.length, 1);
    await render({source: 'file:///large.png', maxPixels: 100_000_000});
    assert.equal(released, 1); assert.equal(requests[1].options.maxWidth, 2048); assert.equal(requests[1].options.maxHeight, 2048);
    await act(async () => requests[1].resolve({width: 2048, height: 2048, release() {}}));
  });
});

test('AppImage source and owner replacement release late decodes without old callbacks or paint', async () => {
  await host(async ({render, unmount, requests, value}) => {
    let oldLoads = 0, newLoads = 0, released = 0;
    const make = () => ({width: 10, height: 10, release() {released++;}});
    await render({source: 'file:///one.png', identity: 'owner-a', onLoad: () => oldLoads++});
    await render({source: 'file:///two.png', identity: 'owner-b', onLoad: () => newLoads++});
    assert.equal(value().source, null);
    await act(async () => requests[0].resolve(make())); assert.equal(oldLoads, 0); assert.equal(newLoads, 0); assert.equal(released, 1); assert.equal(value().source, null);
    await act(async () => requests[1].resolve(make())); assert.equal(newLoads, 1); assert.notEqual(value().source, null);
    await unmount(); assert.equal(released, 2);
  });
});

test('AppImage decode failure retains fallback and unmounted work releases its result', async () => {
  await host(async ({render, requests, value, unmount}) => {
    let errors = 0, released = 0;
    await render({source: 'file:///bad.png', fallback: 'default_avatar', onError: () => errors++});
    await act(async () => requests[0].reject(new Error('Decode failed'))); assert.equal(errors, 1); assert.equal(value().source, 91);
    await render({source: 'file:///held.png'}); await unmount();
    await act(async () => requests[1].resolve({width: 1, height: 1, release() {released++;}})); assert.equal(released, 1);
  });
});

test('AppImage displays thumbnails through the native memory cache without occupying the decode queue', async () => {
  await host(async ({render, requests, value}) => {
    let loads = 0, errors = 0;
    await render({source: 'https://images.test/avatar.png', maxPixels: 126 ** 2, fallback: 'default_avatar', label: 'Avatar', onLoad: () => loads++, onError: () => errors++});
    assert.equal(requests.length, 0, 'An avatar never waits behind gallery decodes');
    assert.equal(value().source.uri, 'https://images.test/avatar.png'); assert.equal(value().cachePolicy, 'memory'); assert.equal(value().allowDownscaling, true);
    assert.equal(value().placeholder, 91, 'The fallback paints while the remote image loads');
    await act(async () => value().onLoad({source: {width: 300, height: 300}})); assert.equal(loads, 1);
    await render({source: 'javascript:alert(1)', maxPixels: 126 ** 2, fallback: 'default_avatar', onError: () => errors++});
    assert.equal(errors, 1); assert.equal(value().source, 91); assert.equal(value().onError, undefined);
  });
});

test('AppImage reuses a gallery-retained decode instead of decoding the same page again', async () => {
  await host(async ({render, unmount, requests, value}) => {
    const kept = new Map(); let released = 0, loads = 0;
    const retention = {take: key => {const image = kept.get(key) ?? null; kept.delete(key); return image;}, keep: (key, image) => {kept.set(key, image);}};
    const image = {width: 2048, height: 1024, release() {released++;}};
    await render({source: 'file:///page-1.png', maxPixels: 4 * 1024 * 1024, retention, onLoad: () => loads++});
    await act(async () => requests[0].resolve(image)); assert.equal(loads, 1);
    await render({source: 'file:///page-3.png', maxPixels: 4 * 1024 * 1024, retention, onLoad: () => loads++});
    assert.equal(kept.size, 1, 'The page that left the window keeps its decoded image'); assert.equal(released, 0);
    await render({source: 'file:///page-1.png', maxPixels: 4 * 1024 * 1024, retention, onLoad: () => loads++});
    assert.equal(requests.length, 2, 'Returning to the page does not decode it again'); assert.equal(value().source, image); assert.equal(loads, 2);
    await unmount(); await act(async () => requests[1].resolve({width: 1, height: 1, release() {released++;}}));
    assert.equal(released, 1, 'The abandoned replacement decode is released');
  });
});
