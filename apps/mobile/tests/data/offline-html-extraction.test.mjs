import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {offlineImageUrls} from '../../src/data/offline-image-urls.ts';

const golden = new URL('../fixtures/offline-html-extraction.json', import.meta.url);
/** Accepts `{cases: [...]}` or a bare array; each case is `{name?, html, images}` (`imageUrls`, `expected`, `urls` also accepted). */
function cases() {
  const value = JSON.parse(readFileSync(golden, 'utf8'));
  const list = Array.isArray(value) ? value : value.cases;
  assert.ok(Array.isArray(list) && list.length > 0, 'The golden fixture lists extraction cases');
  return list.map((item, index) => {
    const expected = item.images ?? item.imageUrls ?? item.expected ?? item.urls;
    assert.equal(typeof item.html, 'string', `case ${index} has html`); assert.ok(Array.isArray(expected), `case ${index} has expected image URLs`);
    return {name: item.name ?? `case ${index}`, html: item.html, expected};
  });
}

test('native HTML image extraction golden fixture matches the JavaScript tokenizer rules', {skip: !existsSync(golden) && 'apps/mobile/tests/fixtures/offline-html-extraction.json is created with the native engine'}, () => {
  for (const item of cases()) assert.deepEqual(offlineImageUrls(item.html), item.expected, item.name);
});

test('reference extraction keeps tokenizer rules: img src only, entities decoded, raw text skipped, duplicates and data URLs dropped', () => {
  const html = [
    '<p><img alt="a" src="https://cdn.test/a.png?x=1&amp;y=2"><IMG SRC=http://cdn.test/b.jpg></p>',
    '<img src=\'https://cdn.test/a.png?x=1&amp;y=2\'><img src="data:image/png;base64,AAAA"><img src="/relative.png">',
    '<script>var s = "<img src=\\"https://cdn.test/script.png\\">"</script><!-- <img src="https://cdn.test/comment.png"> -->',
    '<textarea><img src="https://cdn.test/textarea.png"></textarea><video poster="https://cdn.test/poster.png"><source src="https://cdn.test/v.mp4"></video>',
    '<img data-src="https://cdn.test/lazy.png" src="slaxstatics://cdn.test/already.png"><img src="https://cdn.test/&#x4e2d;.png">',
  ].join('');
  assert.deepEqual(offlineImageUrls(html), ['https://cdn.test/a.png?x=1&y=2', 'http://cdn.test/b.jpg', 'https://cdn.test/already.png', 'https://cdn.test/中.png']);
});
