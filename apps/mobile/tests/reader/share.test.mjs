import test from 'node:test';
import assert from 'node:assert/strict';
import {selectShareImage} from '../../src/reader/share-model.ts';
import {loadComponent} from './parity-host.mjs';
import {normalizeImageUrl} from '../../src/data/cache-paths.ts';
test('source sharing accepts only the first two iOS candidates and dimensions strictly greater than 100', async () => {
  const tried = [];
  const source = {ensureCached: async url => {tried.push(url); return `cached:${url}`;}, dimensions: async uri => uri.endsWith('first') ? {width: 100, height: 200} : {width: 101, height: 101}, fallback: async () => 'logo'};
  assert.equal(await selectShareImage('ios', ['first', 'second', 'third'], source), 'cached:second');
  assert.deepEqual(tried, ['first', 'second']);
  tried.length = 0; source.dimensions = async () => ({width: 200, height: 100});
  assert.equal(await selectShareImage('ios', ['first', 'second', 'third'], source), 'logo');
  assert.deepEqual(tried, ['first', 'second']);
});
test('failed images fall back, Android skips image downloads, and missing source logo remains nullable', async () => {
  let downloads = 0;
  const source = {ensureCached: async () => {downloads++; throw new Error('offline');}, dimensions: async () => null, fallback: async () => 'source-logo'};
  assert.equal(await selectShareImage('android', ['first'], source), 'source-logo'); assert.equal(downloads, 0);
  assert.equal(await selectShareImage('ios', ['first', 'second', 'third'], source), 'source-logo'); assert.equal(downloads, 2);
  source.fallback = async () => {throw new Error('asset unavailable');};
  assert.equal(await selectShareImage('android', [], source), null);
});
test('logout during image dimensions cannot return an old-account image or continue fallback work', async () => {
  let active = true, dimensionsStarted, releaseDimensions;
  const started = new Promise(resolve => {dimensionsStarted = resolve});
  const pending = new Promise(resolve => {releaseDimensions = resolve});
  const attempted = [];
  const selecting = selectShareImage('ios', ['first', 'second'], {
    isActive: () => active,
    ensureCached: async url => {attempted.push(url); return `old-account:${url}`;},
    dimensions: async () => {dimensionsStarted(); await pending; return {width: 200, height: 200};},
    fallback: async () => {attempted.push('logo'); return 'logo';},
  });
  await started; active = false; releaseDimensions();
  assert.equal(await selecting, null); assert.deepEqual(attempted, ['first']);
});

test('actual share adapter reuses owned URIs for article images and development logo without byte/file roundtrips', async () => {
  const calls = [], measured = []; let asset = 'file:///bundle/logo.png';
  const {readerShareImage} = await loadComponent('../../src/reader/share.ts', {
    'react-native': {Image: {resolveAssetSource: () => ({uri: asset}), getSize: async uri => {measured.push(uri); return {width: 200, height: 200};}}},
    'expo-image': {Image: {loadAsync: async uri => {measured.push(uri); return {width: 200, height: 200};}}},
    '../../assets': {mobileAssets: {share_logo: 1}}, '../data/cache.ts': {normalizeImageUrl}, './share-model.ts': {selectShareImage},
  });
  const cache = {ensureImage: async (...args) => {calls.push(['network', ...args]); return 'file:///cache/article.png';}, getResourceUri: async (...args) => {calls.push(['local', ...args]); return 'file:///cache/article.png';}};
  assert.equal(await readerShareImage('ios', ['slaxstatics://image.test/a'], cache, 'book'), 'file:///cache/article.png');
  assert.deepEqual(calls, [['network', 'book', 'https://image.test/a']]); assert.deepEqual(measured, ['file:///cache/article.png']); calls.length = 0;
  assert.equal(await readerShareImage('ios', ['https://image.test/a'], cache, 'book', {allowNetwork: false}), 'file:///cache/article.png');
  assert.deepEqual(calls, [['local', 'book', 'https://image.test/a']]); calls.length = 0;
  assert.equal(await readerShareImage('android', ['https://image.test/a'], cache, 'book'), asset); assert.equal(calls.length, 0);
  asset = 'http://localhost:8081/logo.png'; assert.equal(await readerShareImage('ios', [], cache, 'book'), 'file:///cache/article.png');
  assert.deepEqual(calls, [['network', 'book', asset]]); calls.length = 0;
  assert.equal(await readerShareImage('ios', [], cache, 'book', {allowNetwork: false}), 'file:///cache/article.png');
  assert.deepEqual(calls, [['local', 'book', asset]]);
});
