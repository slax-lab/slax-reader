import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeImage} from '../../src/components/image-decode.ts';

const deferred = <T>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};};
test('image decode limits native work, removes queued cancellation and releases late results', async () => {
  const first = deferred<{release(): void}>(), second = deferred<{release(): void}>();
  const a = new AbortController(), b = new AbortController(), c = new AbortController();
  let starts = 0, released = 0;
  const value = {release() {released++;}};
  const one = decodeImage(() => {starts++; return first.promise;}, a.signal);
  const two = decodeImage(() => {starts++; return second.promise;}, b.signal);
  const three = decodeImage(async () => {starts++; return value;}, c.signal);
  assert.equal(starts, 2);
  c.abort(); await assert.rejects(three, {name: 'AbortError'}); assert.equal(starts, 2);
  a.abort(); await assert.rejects(one, {name: 'AbortError'});
  first.resolve(value); second.resolve(value); assert.equal(await two, value);
  await Promise.resolve(); assert.equal(released, 1);
});
