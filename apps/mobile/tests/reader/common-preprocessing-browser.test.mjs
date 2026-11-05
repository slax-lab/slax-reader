import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {composeReaderDocument} from '../../src/reader/document.ts';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const require = createRequire(new URL('../../../extension/package.json', import.meta.url));
let chromium;
try {({chromium} = require('playwright-core'));} catch {}

test('generated Mobile bridge preserves common content and selections in a real browser, then releases observers', {skip: !chromium || !existsSync(chrome)}, async () => {
  const browser = await chromium.launch({executablePath: chrome, headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 393, height: 852}});
    await page.addInitScript(() => {
      window.readerMessages = [];
      window.ReactNativeWebView = {postMessage: raw => window.readerMessages.push(JSON.parse(raw).payload)};
      const ResizeObserver = window.ResizeObserver;
      window.readerObservers = 0;
      window.ResizeObserver = class extends ResizeObserver {
        active = true;
        constructor(callback) {super(callback); window.readerObservers++;}
        disconnect() {if (this.active) {this.active = false; window.readerObservers--;} super.disconnect();}
      };
    });
    const content = `<h2 id="outline-target">Common preprocessing outline heading</h2>
      <p id="paragraph">User selected text survives anchor navigation.</p>
      <p id="break-paragraph">Before<span id="line-break"><br></span>After</p>
      <a id="relative" href="../next?q=1">Next page</a>
      <details id="ordinary"><summary>Details</summary>Visible</details>
      <details class="slax-yt-contents"><summary>Contents</summary>Kept closed</details>
      <img id="icon" src="https://images.example.org/icon.svg" style="width:32px;height:32px;margin-left:4px!important">
      <img id="large" src="https://images.example.org/large.svg" style="width:600px;height:400px">
      <img id="recover" src="https://images.example.org/bad.svg">
      <table id="short"><tbody><tr><td>One</td><td>Two</td></tr></tbody></table>
      <table id="wide"><tbody><tr><td>${'Unbreakable'.repeat(80)}</td><td>Last</td></tr></tbody></table>
      <iframe id="frame" width="800" src="https://frame.example.org/blank"></iframe>
      <youtube-player data-video-id="abcdefghijk"></youtube-player><slax-media data-kind="audio"></slax-media>`;
    const document = composeReaderDocument(content, {pageId: 'common-browser', platform: 'ios', rewriteImageTransports: false, imageProxyOrigins: []});
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'reader.slax.invalid') return route.fulfill({contentType: 'text/html', body: document});
      if (url.hostname === 'images.example.org') {
        if (url.pathname === '/bad.svg') return route.fulfill({status: 404, body: ''});
        const small = url.pathname === '/icon.svg';
        return route.fulfill({contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${small ? 64 : 600}" height="${small ? 64 : 400}"><rect width="100%" height="100%" fill="#ccc"/></svg>`});
      }
      return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Frame</title>'});
    });
    await page.goto('https://reader.slax.invalid/');
    await page.waitForFunction(() => window.readerMessages.some(message => message.type === 'domReady'));
    const command = (operation, argument) => page.evaluate(({operation, argument}) => JSON.parse(window.__SlaxReaderHost.execute({pageId: 'common-browser', requestId: `${operation}:${Math.random()}`, operation, argument})), {operation, argument});
    await command('initialize', {currentUserId: 1, infoPack: {metadataUrl: 'https://mp.weixin.qq.com/articles/current'}});
    await page.waitForFunction(() => document.querySelector('#relative').getAttribute('href') === 'https://mp.weixin.qq.com/next?q=1');
    await page.waitForFunction(() => !document.querySelector('#large').classList.contains('slax-image-loading'));
    const initial = await page.evaluate(() => {
      const short = document.querySelector('#short'), wide = document.querySelector('#wide');
      window.originalCell = short.querySelector('td');
      return {
        icon: document.querySelector('#icon').getBoundingClientRect().width,
        iconHeight: document.querySelector('#icon').getBoundingClientRect().height,
        large: document.querySelector('#large').style.width,
        span: document.querySelector('#line-break').style.display,
        breakLines: document.querySelector('#break-paragraph').getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector('#break-paragraph')).lineHeight),
        details: document.querySelector('#ordinary').open,
        contents: document.querySelector('.slax-yt-contents').open,
        fit: short.classList.contains('slax-table-fit'),
        fillDelta: Math.abs(short.getBoundingClientRect().width - short.parentElement.getBoundingClientRect().width),
        wide: wide.scrollWidth > wide.clientWidth,
        iframe: document.querySelector('#frame').width,
        media: Boolean(document.querySelector('youtube-player') && document.querySelector('slax-media')),
      };
    });
    assert.equal(initial.icon, 32); assert.equal(initial.iconHeight, 32); assert.equal(initial.large, '100%');
    assert.notEqual(initial.span, 'none'); assert.ok(initial.breakLines >= 2); assert.equal(initial.details, true); assert.equal(initial.contents, false);
    assert.equal(initial.fit, true); assert.ok(initial.fillDelta < 2); assert.equal(initial.wide, true);
    assert.equal(initial.iframe, '100%'); assert.equal(initial.media, true);
    await page.evaluate(() => {document.querySelector('#wide').scrollLeft = 51;});
    await page.setViewportSize({width: 640, height: 852});
    await page.waitForFunction(() => document.querySelector('#short').classList.contains('slax-table-fit'));
    assert.equal(await page.evaluate(() => document.querySelector('#short td') === window.originalCell), true);
    assert.equal(await page.evaluate(() => document.querySelector('#wide').scrollLeft), 51);
    await page.waitForFunction(() => document.querySelector('#recover').style.display === 'none');
    await page.evaluate(() => {document.querySelector('#recover').src = 'https://images.example.org/replacement.svg';});
    await page.waitForFunction(() => document.querySelector('#recover').complete && document.querySelector('#recover').style.display !== 'none');
    await page.evaluate(() => document.querySelector('#recover').click());
    assert.equal(await page.evaluate(() => window.readerMessages.filter(message => message.type === 'imageClick').length), 1);
    await command('scrollToAnchor', 'Common preprocessing outline heading');
    await page.waitForFunction(() => window.getSelection()?.toString().includes('Common preprocessing'));
    // Wait past the real selection debounce to establish that the programmatic highlight stays silent.
    await page.waitForTimeout(380);
    assert.equal(await page.evaluate(() => window.readerMessages.filter(message => message.type === 'textSelected').length), 0);
    await page.evaluate(() => {
      document.dispatchEvent(new MouseEvent('mousedown'));
      const range = document.createRange(); range.setStart(document.querySelector('#paragraph').firstChild, 0); range.setEnd(document.querySelector('#paragraph').firstChild, 13);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      document.dispatchEvent(new Event('selectionchange')); document.dispatchEvent(new MouseEvent('mouseup'));
    });
    await page.waitForFunction(() => window.readerMessages.some(message => message.type === 'textSelected'));
    await page.screenshot({path: '/tmp/mobile-common-preprocessing-browser.png', fullPage: true});
    await command('teardown');
    assert.equal(await page.evaluate(() => window.readerObservers), 0);
  } finally {await browser.close();}
});
