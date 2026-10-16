import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveGalleryImage} from '../../src/reader/gallery-resource.ts';
import {imageCachePath} from '../../src/data/cache-paths.ts';
import {createHash} from 'node:crypto';
import {galleryCacheFixture, deferred, imageResponse, NativeAbortController} from './gallery-cache-fixture.mjs';

const custom = 'slaxstatics://images.test/offline.png?size=2';
const http = 'https://images.test/offline.png?size=2';
const options = fixture => ({allowNetwork: true, isActive: fixture.isActive, loadImage: async () => new Uint8Array([1, 2, 3])});

test('custom gallery misses commit the source file path and reopen offline without another download', async () => {
  const fixture = galleryCacheFixture(), requests = [];
  for (const key of ['personal-bookmark', 'collection-owner-bookmark', 'rss-entry']) {
    const uri = await resolveGalleryImage(fixture.cache, key, custom, {...options(fixture), loadImage: async (...request) => {requests.push(request); return new Uint8Array([1, 2, 3]);}});
    assert.equal(uri, `file:///app/data/${imageCachePath(key, http, url => createHash('md5').update(url).digest('hex'))}`);
    assert.deepEqual([...fixture.contents.get(uri)], [1, 2, 3]);
    assert.equal(await resolveGalleryImage(fixture.cache, key, custom, {...options(fixture), loadImage: async () => {throw new Error('Offline image unexpectedly downloaded');}}), uri);
  }
  assert.deepEqual(requests.map(([url]) => url), [http, http, http]);
  assert.ok(requests.every(([, signal]) => signal === undefined), 'Native image transport takes only URL and cancellation, never request credentials');
  assert.equal(fixture.contents.size, 3, 'Distinct source cache owners retain separate image files');
});

test('ordinary HTTPS gallery requests also resolve to owned files through the native image loader', async () => {
  const fixture = galleryCacheFixture();
  assert.match(await resolveGalleryImage(fixture.cache, 'bookmark', http, options(fixture)), /^file:\/\//);
  assert.equal(fixture.contents.size, 1);
});

test('native image rejection cannot create a cache file and remains retryable', async () => {
  const fixture = galleryCacheFixture();
  await assert.rejects(resolveGalleryImage(fixture.cache, 'bookmark', custom, {...options(fixture), loadImage: async () => {throw new Error('Image request failed');}}), /Image request failed/);
  assert.equal(fixture.contents.size, 0);
  assert.match(await resolveGalleryImage(fixture.cache, 'bookmark', custom, options(fixture)), /^file:\/\//);
  const empty = galleryCacheFixture();
  assert.equal(await resolveGalleryImage(empty.cache, 'bookmark', custom, {...options(empty), loadImage: async () => new Uint8Array()}), null);
  assert.equal(empty.contents.size, 0);
});

test('the installed React Native abort signal cancels a held image body before any cache commit', async () => {
  const fixture = galleryCacheFixture(), controller = new NativeAbortController(), body = deferred(), reading = deferred();
  assert.equal(controller.signal.throwIfAborted, undefined);
  let signal;
  const pending = resolveGalleryImage(fixture.cache, 'bookmark', custom, {...options(fixture), signal: controller.signal,
    loadImage: async (_url, value) => {signal = value; reading.resolve(); return new Uint8Array(await body.promise);}});
  await reading.promise;
  controller.abort();
  assert.equal(signal.aborted, true, 'The page cancellation is forwarded to the actual request signal');
  body.resolve(new Uint8Array([1]).buffer);
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(fixture.contents.size, 0);
});

test('a held account A gallery download cannot overwrite account B artwork after logout', async () => {
  const fixture = galleryCacheFixture(), body = deferred(), reading = deferred();
  const pending = resolveGalleryImage(fixture.cache, 'same-bookmark', custom, {...options(fixture),
    loadImage: async () => {reading.resolve(); return new Uint8Array(await body.promise);}});
  await reading.promise; fixture.revoke();
  const next = fixture.nextAccount();
  const nextFile = await next.ensureImage('same-bookmark', custom, async () => new Uint8Array([2]));
  body.resolve(new Uint8Array([1]).buffer);
  await assert.rejects(pending, error => error.name === 'AccountInactiveError');
  assert.deepEqual([...fixture.contents.get(nextFile)], [2]);
  await assert.rejects(resolveGalleryImage(fixture.cache, 'same-bookmark', custom, options(fixture)), error => error.name === 'AccountInactiveError');
});

test('local-only gallery reopening returns the committed custom image and never downloads a miss', async () => {
  const fixture = galleryCacheFixture();
  const local = await resolveGalleryImage(fixture.cache, 'bookmark', custom, options(fixture));
  const offline = {...options(fixture), allowNetwork: false, loadImage: async () => {throw new Error('Local-only gallery escaped its boundary');}};
  assert.equal(await resolveGalleryImage(fixture.cache, 'bookmark', custom, offline), local);
  assert.equal(await resolveGalleryImage(fixture.cache, 'missing-bookmark', custom, offline), null);
});
