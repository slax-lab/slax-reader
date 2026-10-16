import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const paths = [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname];
let modules;
try {
  modules = await Promise.all(['happy-dom', 'parse5'].map(name => import(pathToFileURL(require.resolve(name, {paths})).href)));
} catch {}
const options = {skip: modules ? false : 'Existing HTML5 parser and DOM test runtime are unavailable'};
const template = await readFile(new URL('../../../../packages/reader-embed/assets/html/error.html', import.meta.url), 'utf8');
const adapter = await readFile(new URL('../../fixtures/source-android/SourceReaderAdapter.kt', import.meta.url), 'utf8');
const predicate = adapter.match(/return probeDocument\(html, """(\(function\(\)\{var root=document\.querySelector\('\.slax-reader-notfound-container'\)[\s\S]*?)"""\)/)?.[1];
assert.ok(predicate, 'The regression evaluates the actual source adapter readiness predicate');

async function page(reason, detail) {
  const [{Window}, {parse, serialize}] = modules;
  const window = new Window({settings: {enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true}});
  const html = template.replace('{{TITLE}}', '<center>Failed to load content</center>')
    .replace('{{REASON}}', `<center>${reason}</center>`).replace('{{DETAIL}}', `<center>${detail}</center>`);
  // Normalize with the HTML5 tree builder; happy-dom itself retains invalid
  // center-inside-p nesting, unlike the actual Chromium error document.
  window.document.write(serialize(parse(html)));
  await window.happyDOM.waitUntilComplete();
  const script = predicate.replaceAll('$reason', JSON.stringify(reason)).replaceAll('$detail', JSON.stringify(detail));
  return {window, ready: () => window.eval(script), close: () => window.happyDOM.close()};
}

test('the original HTTP error document is ready after HTML5 closes paragraphs before center elements', options, async () => {
  const fixture = await page('Error code: 503', 'Prepared content failure');
  try {
    assert.equal(fixture.window.document.querySelector('.notfound-p').textContent, '');
    assert.equal(fixture.window.document.querySelector('.notfound-reason p').textContent, '');
    assert.equal(fixture.ready(), true);
    fixture.window.document.querySelector('.notfound-reason center').textContent = 'Network error';
    assert.equal(fixture.ready(), false, 'A different terminal error must fail the prepared status guard');
  } finally {await fixture.close();}
});

test('the original offline error document requires the exact explanation and Retry control', options, async () => {
  const fixture = await page('No network connection', 'This article is not cached on this device');
  try {
    assert.equal(fixture.ready(), true);
    fixture.window.document.querySelector('.retry-btn').remove();
    assert.equal(fixture.ready(), false);
  } finally {await fixture.close();}
});

test('the original RSS preview readiness does not require its intentionally absent annotation manager', options, async () => {
  const [{Window}] = modules;
  const window = new Window({settings: {enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true}});
  const script = adapter.match(/return probeDocument\(html, "(Boolean\(document\.readyState !== 'loading' && window\.SlaxWebViewBridge && document\.body && document\.body\.innerText\.trim\(\)\.length > 0\))"\)/)?.[1];
  assert.ok(script, 'The regression evaluates the actual RSS-specific source adapter predicate');
  try {
    window.document.write('<body><article><p>Prepared RSS content</p></article></body>');
    await window.happyDOM.waitUntilComplete();
    assert.equal(window.eval(script), false, 'A missing actual reader bridge remains unready');
    window.SlaxWebViewBridge = {markManager: null};
    assert.equal(window.eval(script), true, 'RSS never initializes bookmark annotation monitoring');
    window.document.body.textContent = '';
    assert.equal(window.eval(script), false, 'The actual RSS body must also be present');
  } finally {await window.happyDOM.close();}
});
