import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync, readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import * as pdfContracts from '@slax-reader/contracts/pdf';
import * as readerBridge from '../../src/reader/bridge.ts';
import {ReaderPositionWriter} from '../../src/reader/position.ts';
import {ReaderNativeAttachment} from '../../src/reader/native-attachment.ts';
import * as coordinates from '../../src/reader/coordinates.ts';
import * as hostGeometry from '../../src/reader/host/geometry.ts';
import * as pdfErrors from '../../src/reader/pdf-errors.ts';
import * as recovery from '../../src/reader/recovery.ts';
import * as transportErrors from '../../src/data/transport-errors.ts';
import {React, act, nativeBoundary, loadComponent, withNativeHost} from './parity-host.mjs';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const require = createRequire(new URL('../../../extension/package.json', import.meta.url));
let chromium;
try {({chromium} = require('playwright-core'));} catch {}
function fixturePdf(count = 12, passwordProtected = false) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UTF16-H /DescendantFonts [5 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /DW 1000 >>'];
  const pages = [];
  for (let number = 1; number <= count; number++) {
    pages.push(`${objects.length + 1} 0 R`);
    const text = `BT /F1 24 Tf 48 700 Td (PDF page ${number} line one) Tj 0 -36 Td (Selection second line) Tj ET\nBT /F2 24 Tf 48 600 Td <65E5672C> Tj ET\n0 1 1 0 k 48 480 80 80 re f`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number === 5 ? '420 1000' : '612 792'}] ${number === 3 ? '/Rotate 90' : ''} /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${objects.length + 2} 0 R >>`, `<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  objects.push(`<< /Length 600000 >>\nstream\n${' '.repeat(600000)}\nendstream`);
  objects[1] = `<< /Type /Pages /Count ${count} /Kids [${pages.join(' ')}] >>`;
  if (passwordProtected) objects.push(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'00'.repeat(32)}> /U <${'11'.repeat(32)}> /P -4 >>`);
  const encryption = passwordProtected ? `/Encrypt ${objects.length} 0 R /ID [<${'22'.repeat(16)}> <${'22'.repeat(16)}>]` : '';
  let text = '%PDF-1.7\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {offsets.push(text.length); text += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;}
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encryption} >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}

test('PDF WebView document uses real worker, bounded pages, exact selections, local resources and isolated transport', {skip: !chromium || !existsSync(chrome), timeout: 60000}, async () => {
  const runtime = await build({entryPoints: [new URL('../../src/reader/pdf-runtime.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'browser', format: 'iife', target: ['safari16.4', 'chrome110'], minify: true, legalComments: 'inline'});
  const assets = JSON.parse(readFileSync(new URL('../../assets/pdf/bundle.json', import.meta.url), 'utf8'));
  assert.equal(assets.script, runtime.outputFiles[0].text, 'Generated PDF assets must contain the current extracted runtime');
  const output = await build({entryPoints: [new URL('../../src/reader/pdf-document.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{name: 'fresh-pdf-runtime', setup(build) {build.onLoad({filter: /assets\/pdf\/bundle\.json$/}, () => ({contents: JSON.stringify(assets), loader: 'json'}));}}]});
  const {composePdfDocument} = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
  const bytes = fixturePdf();
  const documentId = createHash('sha256').update(bytes).digest('hex');
  const descriptor = {size: bytes.length, document_id: documentId, filename: 'fixture.pdf', url: 'https://private.example/document?token=must-not-leak'};
  const html = composePdfDocument({pageId: 'fixture', descriptor, currentUserId: 1});
  assert.ok(!html.includes('must-not-leak'));
  const browser = await chromium.launch({executablePath: chrome, headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    const messages = [], errors = [], warnings = [], workers = [], requests = [];
    page.on('worker', worker => workers.push(worker));
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {if (['warning', 'error'].includes(message.type())) warnings.push(message.text());});
    await page.route('**/*', route => {
      requests.push(route.request().url());
      if (route.request().url() === 'https://pdf.reader.slax.invalid/') return route.fulfill({status: 200, contentType: 'text/html', body: html});
      return route.abort();
    });
    await page.exposeFunction('nativePdfMessage', async raw => {
      const message = JSON.parse(raw);
      messages.push(message);
      if (message.kind === 'range') {
        for (let offset = message.begin; offset < message.end; offset += 131072) await page.evaluate(message => window.__slaxPdfReceive(message), {
          channel: 'slax-pdf', pageId: 'fixture', kind: 'rangeChunk', id: message.id, offset,
          data: bytes.subarray(offset, Math.min(message.end, offset + 131072)).toString('base64'),
        });
      }
    });
    await page.addInitScript(() => {window.ReactNativeWebView = {postMessage: value => window.nativePdfMessage(value)};});
    await page.goto('https://pdf.reader.slax.invalid/');
    await page.waitForFunction(() => document.querySelectorAll('.textLayer span').length > 3, {timeout: 20000});
    assert.equal(workers.length, 1, JSON.stringify({errors, warnings, messages}));
    await page.waitForFunction(() => document.querySelectorAll('.page > canvas').length === 6);
    assert.equal(await page.locator('.page').count(), 12);
    assert.equal(await page.locator('.page > canvas').count(), 6);
    const pixels = await page.locator('.page > canvas').first().evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data).filter((value, index) => index % 4 !== 3 && value < 100).length);
    assert.ok(pixels > 100, 'canvas rendered actual PDF text');
    assert.match(await page.locator('.page[data-page-number="1"] .textLayer').innerText(), /日本/);
    assert.equal(await workers[0].evaluate(async () => {
      const bytes = globalThis.__slaxPdfResourceBytes('slax-pdf-resource:wasm/qcms_bg.wasm');
      return WebAssembly.validate(bytes);
    }), true);
    await assert.rejects(workers[0].evaluate(() => globalThis.__slaxPdfResourceBytes('https://example.com/private')));
    assert.ok(messages.filter(message => message.kind === 'range').length >= 2);
    await page.evaluate(() => {
      const spans = document.querySelectorAll('.page[data-page-number="1"] .textLayer span');
      const range = document.createRange();
      range.setStart(spans[0].firstChild, 0);
      range.setEnd(spans[1].firstChild, spans[1].firstChild.length);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    await page.waitForTimeout(200);
    const selected = messages.find(message => message.event?.type === 'textSelected');
    assert.ok(selected, JSON.stringify({errors, warnings, messages}));
    assert.equal(selected.event.selection.source[0].page, 1);
    assert.equal(selected.event.selection.source[0].document_id, documentId);
    assert.ok(selected.event.selection.source[0].quads.length >= 2);
    assert.match(selected.event.selection.text, /Selection second line/);
    const command = (id, operation, argument, pageId = 'fixture') => page.evaluate(message => window.__slaxPdfReceive(message), {channel: 'slax-pdf', pageId, kind: 'command', id, operation, argument});
    await command('clear', 'clearSelection');
    const line = {id: 42, user_id: 1, type: 1, source: selected.event.selection.source, parent_id: 0, root_id: 0, comment: '', created_at: ''};
    const rootComment = {...line, id: 43, type: 2, comment: 'Root comment'};
    const reply = {...line, id: 44, type: 3, source: 43, parent_id: 43, root_id: 43, comment: 'Live reply'};
    const details = {mark_list: [line, rootComment, reply], user_list: {1: {id: 1, username: 'Reader', avatar: ''}}};
    await command('line-only', 'drawMarks', {...details, mark_list: [line]});
    assert.equal(await page.locator('.mark-quad').first().evaluate(element => getComputedStyle(element).strokeDasharray), '3px, 3px');
    await command('marks', 'drawMarks', details);
    const marksEvent = () => messages.filter(message => message.event?.type === 'markItemInfosChanged').at(-1).event;
    assert.equal(marksEvent().marks.length, 1, 'LINE and COMMENT with the same exact range share one group');
    assert.deepEqual(marksEvent().marks[0].stroke, [{mark_id: 42, userId: 1}]);
    assert.equal(marksEvent().marks[0].comments[0].children[0].markId, 44);
    const count = selected.event.selection.source.reduce((sum, source) => sum + source.quads.length, 0);
    assert.equal(await page.locator('.mark-quad').count(), count);
    assert.equal(await page.locator('.mark-quad').first().evaluate(element => element.tagName), 'path');
    assert.equal(await page.locator('.mark-quad').first().evaluate(element => getComputedStyle(element).fill), 'none');
    assert.equal(await page.locator('.mark-quad').first().evaluate(element => getComputedStyle(element).strokeDasharray), 'none');
    for (let index = 0; index < 3; index++) await command(`redraw-${index}`, 'drawMarks', details);
    assert.equal(await page.locator('.mark-quad').count(), count, 'Redrawing cannot duplicate overlays');
    assert.equal(marksEvent().marks[0].comments.length, 1);
    await page.evaluate(() => {
      const spans = document.querySelectorAll('.page[data-page-number="1"] .textLayer span');
      const range = document.createRange(); range.setStart(spans[0].firstChild, 0); range.setEnd(spans[1].firstChild, spans[1].firstChild.length);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    await page.waitForTimeout(200);
    const reselected = messages.filter(message => message.event?.type === 'textSelected').at(-1).event;
    assert.equal(reselected.mark.id, '42');
    assert.equal(reselected.mark.stroke.some(stroke => stroke.userId === 1), true, 'Reselection exposes hasStroke for removal instead of another highlight');
    assert.equal(reselected.mark.comments[0].markId, 43);
    await command('copy', 'captureSelection');
    assert.equal(messages.find(message => message.id === 'copy').result.text, selected.event.selection.text);
    await command('clear-again', 'clearSelection');
    await page.locator('.mark-quad').first().focus();
    await page.keyboard.press('Enter');
    assert.ok(messages.some(message => message.event?.type === 'markClicked' && message.event.markId === '42' && message.event.mark.comments[0].children[0].markId === 44));
    const underline = await page.locator('.mark-quad').first().boundingBox();
    const clicks = messages.filter(message => message.event?.type === 'markClicked').length;
    await page.mouse.click(underline.x + underline.width / 2, underline.y - 1);
    await page.waitForTimeout(30);
    assert.equal(messages.filter(message => message.event?.type === 'markClicked').length, clicks + 1);
    assert.equal(messages.filter(message => message.event?.type === 'markClicked').at(-1).event.mark.comments[0].markId, 43);
    await command('deleted-root', 'drawMarks', {...details, mark_list: [{...line, is_deleted: true}, {...rootComment, is_deleted: true}, reply]});
    assert.equal(marksEvent().marks[0].stroke.length, 0);
    assert.equal(marksEvent().marks[0].comments[0].isDeleted, true);
    assert.equal(marksEvent().marks[0].comments[0].children[0].comment, 'Live reply');
    assert.equal(await page.locator('.mark-quad').count(), count);
    await command('bad-marks', 'drawMarks', {mark_list: [{...line, source: [{type: 'pdf'}]}], user_list: {}});
    assert.equal(messages.find(message => message.id === 'bad-marks').error, 'PDF command failed');
    assert.equal(await page.locator('.mark-quad').count(), count);
    await command('bad-anchor', 'scrollToAnchor', {page: 12});
    assert.equal(messages.find(message => message.id === 'bad-anchor').error, 'PDF command failed');
    await command('stale', 'scrollToAnchor', '12', 'stale-page');
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert.equal(await page.locator('#controls, #page, #zoom, #fit, button, input').count(), 0, 'PDF exposes no format-specific navigation chrome');
    await command('goto', 'scrollToAnchor', '12');
    await page.waitForFunction(() => document.querySelector('.page[data-page-number="12"] .textLayer span'));
    assert.ok(await page.locator('.page > canvas').count() <= 6);
    await command('fit-page', 'scrollToAnchor', '7');
    await page.waitForFunction(() => document.querySelector('.page[data-page-number="7"] .textLayer span'));
    await page.setViewportSize({width: 320, height: 844});
    await page.waitForFunction(() => document.querySelector('.page[data-page-number="7"] .textLayer span') && Math.abs(document.querySelector('.page[data-page-number="7"]').getBoundingClientRect().width - 304) < 1);
    const fitted = await page.locator('.page[data-page-number="7"]').boundingBox();
    assert.ok(fitted.x >= 0 && fitted.x + fitted.width <= 320 && Math.abs(fitted.width - 304) < 1);
    assert.ok(await page.locator('.page > canvas').count() <= 6);
    await page.setViewportSize({width: 390, height: 844});
    await command('after-fit', 'scrollToAnchor', '12');
    await page.waitForFunction(() => document.querySelector('.page[data-page-number="12"] .textLayer span'));
    await command('position', 'position');
    assert.ok(messages.some(message => message.kind === 'position' && message.position >= 10));
    const lowerSource = [{type: 'pdf', version: 1, document_id: documentId, page: 7, text: 'Lower passage', quads: [[48, 150, 230, 150, 230, 130, 48, 130]]}];
    await command('lower-note', 'drawMarks', {mark_list: [{...rootComment, id: 70, source: lowerSource}, {...reply, id: 71, parent_id: 70, root_id: 70, source: 70}], user_list: {}});
    await command('jump-reply', 'scrollToAnchor', '71');
    await page.waitForFunction(() => document.querySelector('.page[data-page-number="7"] .mark-quad'));
    const revealed = await page.locator('.page[data-page-number="7"] .mark-quad').first().boundingBox();
    assert.ok(revealed.y >= 0 && revealed.y < 80, JSON.stringify({revealed}));
    assert.ok(await page.locator('.page[data-page-number="7"]').evaluate(element => element.getBoundingClientRect().top) < -200, 'Note jump reveals the quad, not merely the page top');
    assert.deepEqual(requests, ['https://pdf.reader.slax.invalid/']);
    assert.deepEqual(errors, []);
    assert.ok(!warnings.some(value => /fake worker|Unable to load|CSP|Content Security Policy/.test(value)), warnings.join('\n'));
    const workerClosed = workers[0].waitForEvent('close');
    await command('teardown', 'teardown');
    await workerClosed;
    assert.equal(await page.evaluate(() => typeof window.__slaxPdfReceive), 'undefined');
    const external = await browser.newPage({viewport: {width: 390, height: 10000}});
    const externalMessages = [];
    const externalHtml = composePdfDocument({pageId: 'android-host', descriptor, currentUserId: 1, platform: 'android', hostViewport: true});
    await external.route('**/*', route => route.fulfill({status: 200, contentType: 'text/html', body: externalHtml}));
    await external.exposeFunction('nativePdfMessage', async raw => {
      const message = JSON.parse(raw); externalMessages.push(message);
      if (message.kind === 'range') for (let offset = message.begin; offset < message.end; offset += 131072) await external.evaluate(message => window.__slaxPdfReceive(message), {
        channel: 'slax-pdf', pageId: 'android-host', kind: 'rangeChunk', id: message.id, offset,
        data: bytes.subarray(offset, Math.min(message.end, offset + 131072)).toString('base64'),
      });
    });
    await external.addInitScript(() => {window.ReactNativeWebView = {postMessage: value => window.nativePdfMessage(value)};});
    await external.goto('https://pdf.reader.slax.invalid/');
    await external.waitForFunction(() => document.querySelectorAll('.page').length === 12);
    assert.equal(await external.locator('.page > canvas').count(), 0, 'A document-height Android WebView must await its actual host viewport');
    const externalSend = message => external.evaluate(message => window.__slaxPdfReceive(message), {channel: 'slax-pdf', pageId: 'android-host', ...message});
    await externalSend({kind: 'viewport', offset: -240, height: 640});
    await external.waitForFunction(() => document.querySelectorAll('.page > canvas').length === 6);
    await externalSend({kind: 'command', id: 'restore-header', operation: 'restore', argument: 1});
    await external.waitForTimeout(40);
    assert.ok(externalMessages.some(message => message.kind === 'scroll' && message.revealHeader === true && message.restoreId === 'restore-header'));
    const waitResult = async id => {
      const deadline = Date.now() + 2000;
      while (!externalMessages.some(message => message.kind === 'result' && message.id === id) && Date.now() < deadline) await external.waitForTimeout(10);
      const result = externalMessages.find(message => message.kind === 'result' && message.id === id);
      assert.ok(result, `Missing command result: ${id}`);
      return result;
    };
    await external.evaluate(() => {
      const send = message => window.__slaxPdfReceive({channel: 'slax-pdf', pageId: 'android-host', kind: 'command', operation: 'restore', ...message});
      send({id: 'superseded-restore', argument: 3.25});
      send({id: 'latest-restore', argument: 5.5});
    });
    assert.equal((await waitResult('superseded-restore')).error, 'PDF_COMMAND_FAILED');
    assert.equal((await waitResult('latest-restore')).result, null);
    assert.equal(externalMessages.some(message => message.kind === 'scroll' && message.restoreId === 'superseded-restore'), false);
    const latestRestore = externalMessages.find(message => message.kind === 'scroll' && message.restoreId === 'latest-restore');
    const mixedPage = await external.locator('.page[data-page-number="5"]').evaluate(element => ({top: element.offsetTop, height: element.offsetHeight}));
    assert.equal(latestRestore.y, mixedPage.top + mixedPage.height * 0.5, 'Restore measures the mixed-size target before publishing its document coordinate');
    const readyCount = externalMessages.filter(message => message.event?.type === 'domReady').length;
    const heightCount = externalMessages.filter(message => message.kind === 'documentHeight').length;
    await external.evaluate(() => {
      window.__slaxPdfReceive({channel: 'slax-pdf', pageId: 'android-host', kind: 'command', operation: 'restore', id: 'suspended-restore', argument: 7.25});
      window.__slaxPdfReceive({channel: 'slax-pdf', pageId: 'android-host', kind: 'lifecycle', active: false});
    });
    assert.equal((await waitResult('suspended-restore')).error, 'PDF_COMMAND_FAILED');
    assert.equal(externalMessages.some(message => message.kind === 'scroll' && message.restoreId === 'suspended-restore'), false);
    await externalSend({kind: 'command', operation: 'captureSelection', id: 'inactive-selection'});
    assert.equal((await waitResult('inactive-selection')).error, 'PDF command failed');
    await externalSend({kind: 'lifecycle', active: true});
    assert.equal(externalMessages.filter(message => message.event?.type === 'domReady').length, readyCount + 1, 'Foreground replays readiness for the current native restore lifetime');
    assert.ok(externalMessages.filter(message => message.kind === 'documentHeight').length > heightCount);
    await externalSend({kind: 'lifecycle', active: true});
    assert.equal(externalMessages.filter(message => message.event?.type === 'domReady').length, readyCount + 1, 'Duplicate active messages do not replay readiness twice');
    await externalSend({kind: 'command', operation: 'restore', id: 'foreground-restore', argument: 1});
    assert.equal((await waitResult('foreground-restore')).result, null);
    assert.ok(externalMessages.some(message => message.kind === 'scroll' && message.restoreId === 'foreground-restore' && message.revealHeader));
    const lastTop = await external.locator('.page[data-page-number="12"]').evaluate(element => element.offsetTop);
    await externalSend({kind: 'viewport', offset: lastTop + 100, height: 640});
    await external.waitForFunction(() => document.querySelector('.page[data-page-number="12"] .textLayer span'));
    assert.ok(await external.locator('.page > canvas').count() <= 6);
    assert.equal(await external.locator('.page[data-page-number="1"] canvas').count(), 0);
    assert.ok(externalMessages.some(message => message.kind === 'position' && message.position >= 12));
    await externalSend({kind: 'command', id: 'external-note', operation: 'drawMarks', argument: {mark_list: [{...rootComment, id: 70, source: lowerSource}], user_list: {}}});
    await externalSend({kind: 'command', id: 'external-jump', operation: 'scrollToAnchor', argument: '70'});
    await external.waitForTimeout(40);
    const externalJump = externalMessages.filter(message => message.kind === 'scroll').at(-1);
    const seventhTop = await external.locator('.page[data-page-number="7"]').evaluate(element => element.offsetTop);
    assert.ok(externalJump.y > seventhTop + 200, 'Android note jumps request document coordinates from the outer scroll owner');
    assert.equal(await external.evaluate(() => scrollY), 0, 'Android runtime never scrolls its document-height WebView');
    assert.ok(externalMessages.some(message => message.kind === 'documentHeight' && message.height > 4000));
    await externalSend({kind: 'command', id: 'external-close', operation: 'teardown'});
    const blocked = await browser.newPage();
    await blocked.route('**/*', route => route.fulfill({status: 200, contentType: 'text/html', body: html}));
    await blocked.addInitScript(() => {
      window.Worker = class {constructor() {throw new Error('Worker unavailable')}};
      window.pdfErrors = [];
      window.ReactNativeWebView = {postMessage: raw => window.pdfErrors.push(JSON.parse(raw))};
    });
    await blocked.goto('https://pdf.reader.slax.invalid/');
    await blocked.waitForFunction(() => window.pdfErrors.some(message => message.kind === 'error'));
    assert.equal(await blocked.locator('.page > canvas').count(), 0);
    assert.equal(await blocked.locator('#status').getAttribute('role'), 'alert');
    const suspended = await browser.newPage({viewport: {width: 390, height: 844}});
    const lifecycleMessages = [];
    let serving = false;
    await suspended.route('**/*', route => route.fulfill({status: 200, contentType: 'text/html', body: html}));
    await suspended.exposeFunction('nativePdfMessage', async raw => {
      const message = JSON.parse(raw); lifecycleMessages.push(message);
      if (serving && message.kind === 'range') for (let offset = message.begin; offset < message.end; offset += 131072) await suspended.evaluate(message => window.__slaxPdfReceive(message), {
        channel: 'slax-pdf', pageId: 'fixture', kind: 'rangeChunk', id: message.id, offset,
        data: bytes.subarray(offset, Math.min(message.end, offset + 131072)).toString('base64'),
      });
    });
    await suspended.addInitScript(() => {
      window.ReactNativeWebView = {postMessage: value => window.nativePdfMessage(value)};
      const set = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => set(callback, delay === 60000 ? 2000 : delay, ...args);
    });
    await suspended.goto('https://pdf.reader.slax.invalid/');
    await suspended.waitForFunction(() => typeof window.__slaxPdfReceive === 'function');
    while (!lifecycleMessages.some(message => message.kind === 'range')) await suspended.waitForTimeout(10);
    const interrupted = lifecycleMessages.find(message => message.kind === 'range');
    await suspended.evaluate(() => window.__slaxPdfReceive({channel: 'slax-pdf', pageId: 'fixture', kind: 'lifecycle', active: false}));
    await suspended.waitForTimeout(2200);
    assert.ok(lifecycleMessages.some(message => message.kind === 'cancelRange' && message.id === interrupted.id));
    assert.ok(!lifecycleMessages.some(message => message.kind === 'error'), 'Background suspension pauses byte and worker initialization timeouts');
    await suspended.evaluate(message => window.__slaxPdfReceive(message), {channel: 'slax-pdf', pageId: 'fixture', kind: 'rangeError', id: interrupted.id});
    serving = true;
    await suspended.evaluate(() => window.__slaxPdfReceive({channel: 'slax-pdf', pageId: 'fixture', kind: 'lifecycle', active: true}));
    await suspended.waitForFunction(() => document.querySelector('.textLayer span'), {timeout: 20000});
    assert.ok(lifecycleMessages.some(message => message.kind === 'range' && message.id !== interrupted.id && message.begin === interrupted.begin));
    assert.ok(!lifecycleMessages.some(message => message.kind === 'error'));
    await suspended.evaluate(() => window.__slaxPdfReceive({channel: 'slax-pdf', pageId: 'fixture', kind: 'command', id: 'done', operation: 'teardown'}));
    const encrypted = fixturePdf(1, true);
    const protectedHtml = composePdfDocument({pageId: 'password-fixture', descriptor: {...descriptor, size: encrypted.length, document_id: createHash('sha256').update(encrypted).digest('hex')}, currentUserId: 1});
    const passwordPage = await browser.newPage();
    const passwordMessages = [];
    await passwordPage.route('**/*', route => route.fulfill({status: 200, contentType: 'text/html', body: protectedHtml}));
    await passwordPage.exposeFunction('nativePdfMessage', async raw => {
      const message = JSON.parse(raw); passwordMessages.push(message);
      if (message.kind === 'range') for (let offset = message.begin; offset < message.end; offset += 131072) await passwordPage.evaluate(message => window.__slaxPdfReceive(message), {
        channel: 'slax-pdf', pageId: 'password-fixture', kind: 'rangeChunk', id: message.id, offset,
        data: encrypted.subarray(offset, Math.min(message.end, offset + 131072)).toString('base64'),
      });
    });
    await passwordPage.addInitScript(() => {window.ReactNativeWebView = {postMessage: value => window.nativePdfMessage(value)};});
    await passwordPage.goto('https://pdf.reader.slax.invalid/');
    await passwordPage.waitForFunction(() => document.getElementById('status').getAttribute('role') === 'alert');
    assert.equal(passwordMessages.find(message => message.kind === 'error').code, 'PasswordException');
    console.log(JSON.stringify({worker: workers.length, pages: 12, maxCanvases: 6, selectionQuads: selected.event.selection.source[0].quads.length, byteRanges: messages.filter(message => message.kind === 'range').length, warnings}));
  } finally {await browser.close();}
});

for (const platform of ['ios', 'android']) test(`PDF ${platform} native boundary validates complete events and command results, isolates static pages, and cancels inactive ranges`, nativeBoundary, async () => {
  await withNativeHost(async host => {
    host.native.Platform.OS = platform;
    let config, webProps, stateListener;
    const sent = [], events = [], reads = [], errors = [], operations = [];
    const origin = 'https://pdf.reader.slax.invalid/';
    const reportedUrl = platform === 'android' ? 'about:blank' : origin;
    const documentId = 'a'.repeat(64);
    const source = [{type: 'pdf', version: 1, page: 1, document_id: documentId, text: 'Quote', quads: [[0, 10, 20, 10, 20, 0, 0, 0]]}];
    const approx = {exact: 'Quote', prefix: '', suffix: '', position_start: 0, position_end: 5};
    const selection = {source, text: 'Quote', select_content: [{type: 'text', text: 'Quote', src: ''}], approx_source: approx};
    const mark = {id: '42', source, stroke: [{mark_id: 42, userId: 1}], comments: [], approx};
    const WebView = React.forwardRef((props, ref) => {
      webProps = props;
      React.useImperativeHandle(ref, () => ({injectJavaScript(script) {sent.push(JSON.parse(script.slice('window.__slaxPdfReceive?.('.length, -');true;'.length)));}, stopLoading() {}}));
      return React.createElement('div');
    });
    const adapter = {HostComponent: WebView, nativeConfig: context => ({props: context}), attach: async () => {}, detach: async () => {},
      subscribeTouch: () => () => {}, setScrollsToTop: async () => {}, updateInsets: async () => {}, scrollTo: async () => {}};
    const native = {...host.native, PixelRatio: {get: () => 3}, AppState: {currentState: 'active', addEventListener(_event, listener) {stateListener = listener; return {remove() {}};}}};
    const globals = {Uint8Array, btoa, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout};
    const scrollHost = await loadComponent('../../src/reader/host/usePdfScrollHost.tsx', {react: React, 'react-native': native,
      '../../native/reader': {readerNativeAdapter: adapter}, '../native-attachment.ts': {ReaderNativeAttachment}, '../coordinates.ts': coordinates, './geometry.ts': hostGeometry, '../bridge.ts': readerBridge}, globals);
    const {PdfWebView} = await loadComponent('../../src/reader/PdfWebView.tsx', {
      react: React, 'react-native': native,
      '../native/reader': {readerNativeAdapter: adapter}, '@slax-reader/contracts/pdf': pdfContracts,
      './pdf-document.ts': {PDF_ORIGIN: origin, PDF_BRIDGE_CHUNK_BYTES: 131072, composePdfDocument(value) {config = value; return '<html></html>';}},
      './host/usePdfScrollHost.tsx': scrollHost, './pdf-errors.ts': pdfErrors, './recovery.ts': recovery, '../data/transport-errors.ts': transportErrors,
      './bridge.ts': readerBridge, './position.ts': {ReaderPositionWriter},
    }, globals);
    const ref = React.createRef();
    const props = {descriptor: {document_id: documentId, size: 1024, filename: 'fixture.pdf', pages: 2}, cacheKey: 'account/pdf', cacheDirectory: '/marked/slax-ui-fixtures/account', resourceOwner: 'account-owner', currentUserId: 1,
      readRange(begin, end, signal) {reads.push({begin, end, signal}); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true}));},
      onEvent: event => events.push(event), onError: error => errors.push(error), onOperationError: error => operations.push(error)};
    await host.render(React.createElement(PdfWebView, {...props, ref}));
    assert.equal(webProps.nativeConfig.props.pdfMode, true);
    assert.equal(webProps.nativeConfig.props.resourceOwner, props.resourceOwner);
    assert.equal(webProps.nativeConfig.props.cacheDirectory, props.cacheDirectory);
    assert.equal(webProps.nativeConfig.props.suppressSelectionMenu, true);
    assert.equal(webProps.menuItems, undefined);
    assert.equal(webProps.onShouldStartLoadWithRequest({url: reportedUrl, navigationType: 'other', isTopFrame: true}), true);
    await act(async () => webProps.onLoadStart({nativeEvent: {url: reportedUrl, target: 41}}));
    webProps.onLoadEnd({nativeEvent: {url: reportedUrl}});
    assert.equal(webProps.onShouldStartLoadWithRequest({url: 'about:blank', navigationType: 'other', isTopFrame: false}), false);
    const receive = (message, url = reportedUrl, pageId = config.pageId) => webProps.onMessage({nativeEvent: {url, data: JSON.stringify({channel: 'slax-pdf', pageId, ...message})}});
    const selected = {type: 'textSelected', text: 'Quote', mark, selection, selectionGeometry: {touchClientY: null, top: 10, bottom: 20}};
    for (const event of [
      {...selected, mark: null}, {...selected, mark: {...mark, stroke: [{userId: 'bad'}]}},
      {...selected, mark: {...mark, comments: [{markId: 4}]}}, {...selected, selection: {...selection, select_content: null}},
      {...selected, selectionGeometry: {touchClientY: null, top: 'wrong', bottom: 20}},
      {...selected, mark: {...mark, source: [{...source[0], document_id: 'b'.repeat(64)}]}},
      {...selected, mark: {...mark, approx: {...approx, raw_text: {invalid: true}}}},
      {type: 'markItemInfosChanged', marks: [{...mark, comments: [{}]}]}, {type: 'markClicked', markId: 'other', text: 'Quote', mark},
    ]) receive({kind: 'event', event});
    receive({kind: 'event', event: selected}, 'https://evil.example/');
    receive({kind: 'event', event: selected}, origin, 'stale-page');
    assert.equal(events.length, 0);
    receive({kind: 'event', event: selected});
    assert.equal(events.length, 1); assert.equal(events[0].containerYPoints, 20);
    receive({kind: 'event', event: {type: 'markItemInfosChanged', marks: [mark]}});
    receive({kind: 'event', event: {type: 'markClicked', markId: '42', text: 'Quote', mark}});
    assert.equal(events.length, 3);
    await act(async () => receive({kind: 'event', event: {type: 'domReady'}}));
    await host.render(React.createElement(PdfWebView, {...props, marks: {mark_list: [], user_list: {}}, ref}));
    const draw = sent.findLast(message => message.operation === 'drawMarks');
    receive({kind: 'result', id: draw.id, error: 'PDF_COMMAND_FAILED'});
    await host.settle();
    assert.equal(operations.length, 1);
    assert.equal(errors.length, 0, 'Failed annotations cannot turn a readable document into a load error');
    const captured = ref.current.captureSelection();
    const capture = sent.at(-1);
    receive({kind: 'result', id: capture.id, result: {...selection, select_content: null}});
    await assert.rejects(captured, /Invalid PDF command result/);
    const anchor = ref.current.scrollToAnchor('42');
    receive({kind: 'result', id: sent.at(-1).id, result: 'truthy'});
    await assert.rejects(anchor, /Invalid PDF command result/);
    const validCapture = ref.current.captureSelection();
    receive({kind: 'result', id: sent.at(-1).id, result: selection});
    assert.deepEqual(JSON.parse(JSON.stringify(await validCapture)), selection);
    receive({kind: 'range', id: 'bad-number', begin: '0', end: 4});
    receive({kind: 'range', id: 'wrong-origin', begin: 0, end: 4}, platform === 'ios' ? 'about:blank' : 'https://evil.example/');
    assert.equal(reads.length, 0);
    receive({kind: 'range', id: 'range-1', begin: 0, end: 4});
    assert.equal(reads.length, 1);
    const pending = ref.current.captureSelection();
    const stopped = assert.rejects(pending, /inactive/);
    await act(async () => stateListener('background'));
    await stopped;
    assert.equal(reads[0].signal.aborted, true);
    assert.ok(sent.some(message => message.kind === 'lifecycle' && message.active === false));
    const priorEvents = events.length;
    receive({kind: 'event', event: selected});
    receive({kind: 'range', id: 'range-suspended', begin: 0, end: 4});
    assert.equal(events.length, priorEvents); assert.equal(reads.length, 1);
    await act(async () => stateListener('active'));
    assert.ok(sent.some(message => message.kind === 'lifecycle' && message.active === true));
    receive({kind: 'range', id: 'range-resumed', begin: 0, end: 4});
    assert.equal(reads.length, 2); assert.equal(reads[1].signal.aborted, false);
    assert.deepEqual(errors, []);
    receive({kind: 'error', code: 'PasswordException'});
    assert.equal(errors.at(-1).name, 'PasswordException');
    receive({kind: 'error', code: 'UntrustedErrorName'});
    assert.equal(errors.length, 1, 'Later generic errors cannot replace the original load cause');
    assert.equal(errors.at(-1).name, 'PasswordException');
    const beforeNavigation = events.length;
    const rejectedOnClose = ref.current.captureSelection();
    const cancelledOnClose = assert.rejects(rejectedOnClose, error => readerBridge.isReaderOperationCancelled(error));
    const failuresBeforeClose = errors.length;
    assert.equal(webProps.onShouldStartLoadWithRequest({url: 'about:blank', navigationType: 'other', isTopFrame: true}), false);
    await cancelledOnClose;
    await assert.rejects(ref.current.captureSelection(), error => readerBridge.isReaderOperationCancelled(error));
    webProps.onError({nativeEvent: {description: 'late old document failure', code: -1}});
    assert.equal(errors.length, failuresBeforeClose, 'Released document errors cannot poison the replacement reader');
    receive({kind: 'event', event: selected}, 'about:blank');
    receive({kind: 'event', event: selected}, origin);
    receive({kind: 'range', id: 'after-nav', begin: 0, end: 4}, 'about:blank');
    assert.equal(events.length, beforeNavigation);
    assert.equal(reads.length, 2);
    assert.equal(reads[1].signal.aborted, true);
    const oldPageId = config.pageId;
    await host.render(React.createElement(PdfWebView, {...props, cacheKey: 'replacement/pdf', ref}));
    assert.notEqual(config.pageId, oldPageId);
    receive({kind: 'event', event: selected}, reportedUrl, oldPageId);
    assert.equal(events.length, beforeNavigation);
    webProps.onLoadStart({nativeEvent: {url: 'https://evil.example/'}});
    receive({kind: 'event', event: selected}, 'about:blank');
    receive({kind: 'event', event: selected}, origin);
    assert.equal(events.length, beforeNavigation);
    await host.unmount();
  });
});
