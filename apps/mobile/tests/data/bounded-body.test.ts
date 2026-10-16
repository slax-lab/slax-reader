import test from 'node:test';
import assert from 'node:assert/strict';
import {ARTICLE_MAX_BYTES, readArticleBody} from '../../src/data/bounded-body.ts';

test('article reader preserves split UTF-8 and bounds streamed and declared bodies', async () => {
  const encoded = new TextEncoder().encode('first 你好 last');
  const response = new Response(new ReadableStream({start(controller) {controller.enqueue(encoded.slice(0, 8)); controller.enqueue(encoded.slice(8)); controller.close();}}));
  assert.equal(await readArticleBody(response), 'first 你好 last');
  let cancelled = false;
  await assert.rejects(readArticleBody(new Response(new ReadableStream({cancel() {cancelled = true;}}), {headers: {'content-length': String(ARTICLE_MAX_BYTES + 1)}})), {code: 'offline_integrity_invalid'});
  assert.equal(cancelled, true);
  const large = new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(ARTICLE_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close();}}));
  await assert.rejects(readArticleBody(large), {code: 'offline_integrity_invalid'});
});

test('article abort cancels a held stream without publishing partial text', async () => {
  let cancelled = false;
  const controller = new AbortController();
  const reading = readArticleBody(new Response(new ReadableStream({cancel() {cancelled = true;}})), controller.signal);
  controller.abort(); await assert.rejects(reading, {name: 'AbortError'}); assert.equal(cancelled, true);
});
