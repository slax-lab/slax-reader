import test from 'node:test';
import assert from 'node:assert/strict';
import {AvatarCache, type AvatarStorage} from '../../src/data/avatar-cache.ts';

function storageFixture() {
  const manifest = new Map<string, string>(), images = new Map<string, Uint8Array>(), removed: string[] = [];
  const storage: AvatarStorage = {
    async read() {return manifest.get('manifest') ?? null;},
    async write(value) {manifest.set('manifest', value);},
    async exists(path) {return images.has(path);},
    uri(path) {return images.has(path) ? `file:///avatar-cache/${path}` : null;},
    async image(path, bytes) {images.set(path, bytes); return `file:///avatar-cache/${path}`;},
    async remove(path) {removed.push(path); images.delete(path);},
  };
  return {storage, manifest, images, removed};
}
const immediateBytes = async () => new Uint8Array([1, 2, 3, 4]);
const hash = (value: string) => [...new TextEncoder().encode(value)].reduce((out, byte) => `${out}${byte.toString(16).padStart(2, '0')}`, '');
const waitFor = async (predicate: () => boolean) => {for (let i = 0; i < 100; i++) {if (predicate()) return; await new Promise(resolve => setImmediate(resolve));} assert.ok(predicate(), 'expected asynchronous operation to start');};

test('avatar cache restores fresh manifest entries and refreshes stale entries without hiding the saved image', async () => {
  const f = storageFixture(); let now = 1_800_000_000_000, downloads = 0;
  const first = new AvatarCache(f.storage, hash, async () => {downloads++; return immediateBytes();}, () => now);
  const initial: string[] = []; await first.resolve('account:source', 'https://cdn.example/avatar.png', value => initial.push(value));
  assert.equal(downloads, 1); assert.equal(initial.length, 1);
  const persisted = [...f.images.keys()][0]!; first.dispose();

  const restored = new AvatarCache(f.storage, hash, async () => {downloads++; return new Uint8Array([5, 6, 7]);}, () => now + 10_000);
  const fresh: string[] = []; await restored.resolve('account:source', 'https://cdn.example/avatar.png', value => fresh.push(value));
  assert.deepEqual(fresh, [`file:///avatar-cache/${persisted}`]); assert.equal(downloads, 1, 'restart should reuse a fresh persisted image');

  const stale = new AvatarCache(f.storage, hash, async () => {downloads++; return new Uint8Array([5, 6, 7]);}, () => now + 24 * 60 * 60 * 1000 + 1);
  const refreshed: string[] = []; await stale.resolve('account:source', 'https://cdn.example/avatar.png', value => refreshed.push(value));
  assert.equal(downloads, 2); assert.equal(refreshed[0], `file:///avatar-cache/${persisted}`, 'publish prior valid image while stale data refreshes');
  assert.notEqual(refreshed.at(-1), refreshed[0], 'a refreshed file needs a new display identity so native image caches cannot retain stale bytes');
  const refreshedPath = [...f.images.keys()].find(path => path !== persisted);
  assert.ok(refreshedPath); assert.equal(refreshed.at(-1), `file:///avatar-cache/${refreshedPath}`);
  assert.deepEqual([...f.images.get(refreshedPath)!], [5, 6, 7]); assert.equal(await stale.bytes(), 3);
  stale.dispose();
});

test('clear invalidates a pending download and permits a fresh request afterwards', async () => {
  const f = storageFixture(); let release!: (value: Uint8Array) => void, calls = 0;
  const cache = new AvatarCache(f.storage, hash, async () => {calls++; if (calls === 1) return new Promise<Uint8Array>(resolve => {release = resolve;}); return new Uint8Array([8, 9]);});
  const published: string[] = []; const pending = cache.resolve('account:source', 'https://cdn.example/old.png', value => published.push(value));
  await waitFor(() => Boolean(release)); const clearing = cache.clear(); release(new Uint8Array([1, 2, 3])); await Promise.all([pending, clearing]);
  assert.equal(published.length, 0); assert.equal(await cache.bytes(), 0); assert.equal(f.manifest.get('manifest'), '{}'); assert.equal(f.images.size, 0);
  await cache.resolve('account:source', 'https://cdn.example/new.png', value => published.push(value));
  assert.equal(calls, 2); assert.equal(published.length, 1); assert.equal(await cache.bytes(), 2);
  cache.dispose();
});

test('disposing an account scope cancels a late image and prevents its manifest commit', async () => {
  const f = storageFixture(); let release!: (value: Uint8Array) => void;
  const cache = new AvatarCache(f.storage, hash, async () => new Promise<Uint8Array>(resolve => {release = resolve;}));
  const published: string[] = []; const pending = cache.resolve('account-a:source', 'https://cdn.example/avatar.png', value => published.push(value));
  await waitFor(() => Boolean(release)); cache.dispose(); release(new Uint8Array([1, 2, 3])); await pending;
  assert.equal(published.length, 0); assert.equal(f.images.size, 0); assert.equal(f.manifest.has('manifest'), false);
});
