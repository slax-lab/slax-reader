import test from 'node:test';
import assert from 'node:assert/strict';
import {rewriteReaderImageTransports} from '../../src/reader/image-transports.ts';
import {composeReaderDocument} from '../../src/reader/document.ts';
import {READER_CSP, readerAllowsImage, readerAllowsUrl} from '../../src/reader/security.ts';

const origin = 'https://api.example';
const signed = `${origin}/static/image?d=${'a'.repeat(32)}&u=https%253A%252F%252Fpublic.test%252Fa.mp4&r=https%3A%2F%2Ffeed.test%2Fa`;
test('only signed media src attributes get isolated media transport without rewriting DOM or raw strings', () => {
  const escaped = signed.replaceAll('&', '&amp;');
  const html = `<p>Text</p><video controls src="${escaped}"><source src='${signed}' type="video/mp4"></video><iframe src="${signed}"></iframe><script>const x='<video src="${signed}">'</script><!-- <video src="${signed}"> --><video src="https://public.test/direct.mp4"></video><video src="${origin}/account"></video>`;
  const changed = rewriteReaderImageTransports(html, undefined, [origin]);
  assert.equal(changed, html.replace(`src="${escaped}"`, `src="${escaped.replace('https:', 'slaxmedias:')}"`).replace(`src='${signed}'`, `src='${signed.replace('https:', 'slaxmedias:')}'`));
  assert.equal(rewriteReaderImageTransports(`<video src="${signed}&m=rss">`, undefined, [origin]), `<video src="${signed}&m=rss">`);
  assert.equal(rewriteReaderImageTransports(`<video src="${signed}">`, undefined, ['https://different.example']), `<video src="${signed}">`);
});
test('media schemes are exclusively permitted as media, never image/frame/script/connect destinations', () => {
  const sections = Object.fromEntries(READER_CSP.split(';').filter(Boolean).map(value => {const [name, ...sources] = value.trim().split(' '); return [name, sources];}));
  assert.ok(sections['media-src'].includes('slaxmedias:'));
  for (const [name, sources] of Object.entries(sections)) if (name !== 'media-src') assert.ok(!sources.includes('slaxmedias:') && !sources.includes('slaxmedia:'));
  assert.equal(readerAllowsUrl(signed.replace('https:', 'slaxmedias:'), ['api.example']), false);
  assert.equal(readerAllowsImage(signed.replace('https:', 'slaxmedias:'), ['api.example'], [origin]), false);
  const document = composeReaderDocument(`<video src="${signed}"></video>`, {pageId: 'media', platform: 'ios', imageProxyOrigins: [origin]});
  assert.ok(document.includes(signed.replace('https:', 'slaxmedias:')));
  assert.ok(document.indexOf(READER_CSP) < document.indexOf('<video'));
});
