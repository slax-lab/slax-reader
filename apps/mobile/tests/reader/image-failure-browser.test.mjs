import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {composeReaderDocument} from '../../src/reader/document.ts';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const require = createRequire(new URL('../../../extension/package.json', import.meta.url));
let chromium;
try {({chromium} = require('playwright-core'));} catch {}

const svg = (width, height) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#2a7"/></svg>`;

test('a failed Reader image stays in place as a retry placeholder and recovers on tap in a real browser', {skip: !chromium || !existsSync(chrome)}, async () => {
  const browser = await chromium.launch({executablePath: chrome, headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 393, height: 852}});
    await page.addInitScript(() => {
      window.readerMessages = [];
      window.ReactNativeWebView = {postMessage: raw => window.readerMessages.push(JSON.parse(raw).payload)};
    });
    const content = `<p id="before">Before the image.</p>
      <p><img id="flaky" src="https://images.example.org/flaky.svg"></p>
      <p><img id="broken" src="https://images.example.org/broken.svg"></p>
      <p><img id="good" src="https://images.example.org/good.svg"></p>
      <p id="after">After the image.</p>`;
    const composed = composeReaderDocument(content, {pageId: 'image-failure', platform: 'android', rewriteImageTransports: false, imageProxyOrigins: [], locale: 'zh'});
    assert.match(composed, /src="slaxstatics:\/\/images\.example\.org\/flaky\.svg"/, 'Article images use the native transport');
    // Chrome has no native scheme handler, so the test serves the same document over https for the browser to load.
    const document = composed.replaceAll('slaxstatics://images.example.org/', 'https://images.example.org/');
    let flakyAttempts = 0;
    const requested = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'reader.slax.invalid') return route.fulfill({contentType: 'text/html', body: document});
      if (url.hostname === 'images.example.org') {
        requested.push(url.pathname + url.search + url.hash);
        if (url.pathname === '/broken.svg') return route.fulfill({status: 502, body: ''});
        if (url.pathname === '/flaky.svg' && ++flakyAttempts === 1) return route.fulfill({status: 504, body: ''});
        return route.fulfill({contentType: 'image/svg+xml', body: svg(640, 360)});
      }
      return route.fulfill({status: 404, body: ''});
    });
    await page.goto('https://reader.slax.invalid/');
    await page.waitForFunction(() => window.readerMessages.some(message => message.type === 'domReady'));
    const command = (operation, argument) => page.evaluate(({operation, argument}) => JSON.parse(window.__SlaxReaderHost.execute({pageId: 'image-failure', requestId: `${operation}:${Math.random()}`, operation, argument})), {operation, argument});
    await command('initialize', {currentUserId: 1});
    await page.waitForFunction(() => document.querySelector('#flaky').classList.contains('slax-image-failed') && document.querySelector('#broken').classList.contains('slax-image-failed'));

    const placeholder = await page.evaluate(() => {
      const image = document.querySelector('#flaky'), style = getComputedStyle(image), rect = image.getBoundingClientRect();
      return {display: style.display, content: style.content.startsWith('url("data:image/svg+xml'), retryText: decodeURIComponent(style.content).includes('点击重试'),
        role: image.getAttribute('role'), label: image.getAttribute('aria-label'), height: rect.height, width: rect.width,
        parentChildren: image.parentElement.childNodes.length, src: image.getAttribute('src')};
    });
    assert.equal(placeholder.display, 'block', 'The failed image is shown, not hidden by the source bridge');
    assert.equal(placeholder.content, true); assert.equal(placeholder.retryText, true, 'The placeholder shows the localized retry hint');
    assert.equal(placeholder.role, 'button'); assert.equal(placeholder.label, '点击重试');
    assert.ok(placeholder.height >= 120 && placeholder.width > 300, `The placeholder occupies a visible box (${placeholder.width}x${placeholder.height})`);
    assert.equal(placeholder.parentChildren, 1, 'No node is inserted beside the image');
    const errors = await page.evaluate(() => window.readerMessages.filter(message => message.type === 'imageError').map(message => message.src).sort());
    assert.deepEqual(errors, ['https://images.example.org/broken.svg', 'https://images.example.org/flaky.svg'], 'Each failed source is reported once');

    // A tap on the placeholder retries instead of opening the gallery or toggling the toolbar.
    await page.evaluate(() => document.querySelector('#flaky').click());
    await page.waitForFunction(() => !document.querySelector('#flaky').classList.contains('slax-image-failed') && !document.querySelector('#flaky').classList.contains('slax-image-retrying') && document.querySelector('#flaky').naturalWidth === 640);
    const recovered = await page.evaluate(() => {
      const image = document.querySelector('#flaky'), style = getComputedStyle(image);
      return {display: style.display, content: style.content, role: image.getAttribute('role'), src: image.getAttribute('src'), inline: image.style.display};
    });
    assert.notEqual(recovered.display, 'none'); assert.equal(recovered.content, 'normal'); assert.equal(recovered.role, null);
    assert.equal(recovered.src, 'https://images.example.org/flaky.svg#slax-retry-1', 'The retry reuses the same request URL with a fragment');
    assert.equal(recovered.inline, '', 'The source bridge restored its own display state');
    assert.ok(requested.filter(path => path === '/flaky.svg').length === 2, `The fragment is not sent and the same path is requested again (${requested})`);
    assert.equal(await page.evaluate(() => window.readerMessages.filter(message => message.type === 'imageClick').length), 0, 'The retry tap did not open the gallery');

    // The recovered image regains its normal gallery tap with the original source.
    await page.evaluate(() => document.querySelector('#flaky').click());
    const click = await page.evaluate(() => window.readerMessages.find(message => message.type === 'imageClick'));
    assert.ok(click, 'The recovered image opens the gallery');
    assert.equal(click.src, 'https://images.example.org/flaky.svg#slax-retry-1');

    // A retry that fails again returns to the placeholder and can be tapped again; it is not reported twice.
    await page.evaluate(() => document.querySelector('#broken').click());
    await page.waitForFunction(() => document.querySelector('#broken').getAttribute('src').endsWith('#slax-retry-1') && document.querySelector('#broken').classList.contains('slax-image-failed'));
    await page.evaluate(() => document.querySelector('#broken').click());
    await page.waitForFunction(() => document.querySelector('#broken').getAttribute('src').endsWith('#slax-retry-2') && document.querySelector('#broken').classList.contains('slax-image-failed'));
    assert.equal(await page.evaluate(() => window.readerMessages.filter(message => message.type === 'imageError').length), 2);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#good')).content), 'normal', 'A loaded image is untouched');
  } finally {await browser.close();}
});
