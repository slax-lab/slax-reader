import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import ts from 'typescript';
import {MobileRepositories, PERSONAL_MARK_POLICY} from '../../src/data/repositories.ts';
import {buildReaderMarks, selectionPaths} from '../../src/reader/model.ts';
import {validatePdfSources} from '@slax-reader/contracts/pdf';
import {groupPdfMarks, isPdfMarkDetail, pdfSourceKey} from '../../src/reader/pdf/runtime/annotations.ts';
import {rectToPdfQuad, quadToViewport} from '../../src/reader/pdf-geometry.ts';
import {createPdfLayout} from '../../src/reader/pdf/runtime/layout.ts';
import {nativeBoundary, withNativeHost} from './parity-host.mjs';

const mobile = new URL('../../', import.meta.url).pathname;
const web = new URL('../../../web/', import.meta.url).pathname;
const selection = new URL('../../../../packages/selection/', import.meta.url).pathname;
const webRequire = createRequire(`${web}package.json`);
const extensionRequire = createRequire(new URL('../../../extension/package.json', import.meta.url));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let chromium;
try {({chromium} = extensionRequire('playwright-core')); await access(chrome);} catch {chromium = undefined;}

function rotatedPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 2 /Kids [4 0 R 6 0 R] >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const [index, rotation] of [0, 90].entries()) {
    const text = `BT /F1 24 Tf 72 680 Td (Interop page ${index + 1} first line) Tj 0 -40 Td (Second exact passage) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate ${rotation} /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`, `<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;});
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

async function webHarness() {
  const sfc = await readFile(`${web}app/components/Article/Pdf/PdfReader.client.vue`, 'utf8');
  const script = /<script setup lang="ts">([\s\S]*?)<\/script>/.exec(sfc)?.[1];
  assert.ok(script, 'The production Web PDF script must be present');
  const ast = ts.createSourceFile('PdfReader.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const drawPage = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'drawPage');
  assert.equal(drawPage.length, 1, 'Extract the actual Web SVG renderer, never a test reimplementation');
  const output = await build({stdin: {resolveDir: web, loader: 'ts', contents: `
import * as api from 'pdfjs-dist/legacy/build/pdf.mjs';
import {ref} from 'vue';
import {MarkManager} from ${JSON.stringify(`${selection}src/core/MarkManager.ts`)};
import {MarkType} from '@slax-reader/contracts/interface';
import {capturePdfSelection, quadToViewport, findPdfTextRange} from './app/components/Article/Pdf/geometry.ts';
import {InlinePdfViewer} from './app/components/Article/Pdf/InlinePdfViewer.ts';
const props = {pdf: {document_id: ''}};
const pageInfos = new Map();
const viewerElement = ref(document.getElementById('viewer'));
const draft = ref(null);
let viewer, manager, worker, loading;
let quoteFlash, markClick;
const t = key => key;
const openComment = info => {window.openedComment = JSON.parse(JSON.stringify(info));};
${drawPage[0].getText(ast)}
window.interop = {
  async start(documentId) {
    props.pdf.document_id = documentId;
    const {PDFPageView, EventBus} = await import('pdfjs-dist/web/pdf_viewer.mjs');
    worker = new Worker('/pdf.worker.mjs', {type: 'module'});
    loading = api.getDocument({url: '/document.pdf', worker: new api.PDFWorker({port: worker}), standardFontDataUrl: '/standard_fonts/', useSystemFonts: false});
    const pdf = await loading.promise;
    const eventBus = new EventBus();
    viewer = new InlinePdfViewer({element: viewerElement.value, eventBus, PageView: PDFPageView, maxCanvasPixels: 4000000, pageColors: {background: '#fff', foreground: '#000'}});
    eventBus.on('textlayerrendered', ({pageNumber}) => drawPage(pageNumber));
    await viewer.setDocument(pdf);
    const renderer = {
      async drawMark(info) {
        for (const source of info.source) if (source.type === 'pdf') {
          if (!pageInfos.has(source.page)) pageInfos.set(source.page, new Set());
          const page = pageInfos.get(source.page);
          for (const old of page) if (old.id === info.id) page.delete(old);
          page.add(info); drawPage(source.page);
        }
        return info.id;
      },
      clearAllMarks() {pageInfos.clear(); viewerElement.value.querySelectorAll('.slax-pdf-marks').forEach(node => node.remove());},
      setMarkClickHandler(handler) {markClick = handler;},
      transferNodeInfos() {throw Error('PDF marks cannot use the HTML fallback');},
    };
    manager = new MarkManager({containerDom: viewerElement.value, monitorDom: viewerElement.value, allowAction: true},
      {getWindow: () => window, getDocument: () => document, getSelection: () => getSelection()},
      {userProvider: {getUserId: () => 1, getUserInfo: () => ({userId: 1, name: 'Reader'})},
        httpClient: {post: request => window.persistWebMark(JSON.parse(JSON.stringify(request)))},
        toastService: {showToast: value => {throw Error(JSON.stringify(value));}}, i18nService: {t},
        bookmarkProvider: {getBookmarkUid: () => 'interop-bookmark'}, refFactory: ref,
        getMarkType: type => ({line: MarkType.LINE, comment: MarkType.COMMENT, reply: MarkType.REPLY})[type]}, renderer,
      {isPanelExist: () => false, showMenus() {}, showPanel: ({info}) => openComment(info), dismissPanel: async () => {}}, () => {});
  },
  zoom(value) {viewer.currentScale = value; viewer.currentPageNumber = 2;},
  capture() {
    const view = viewer.getPageView(1);
    const range = findPdfTextRange(view.div.querySelector('.textLayer'), 'Interop page 2 first lineSecond exact passage');
    if (!range) throw Error('Real PDF text range missing');
    getSelection().removeAllRanges(); getSelection().addRange(range);
    const source = capturePdfSelection(range, viewerElement.value, props.pdf.document_id, number => viewer.getPageView(number - 1)?.viewport);
    return {source, rotation: view.viewport.rotation, scale: viewer.currentScale};
  },
  async save(source, comment, replyToUid) {
    const text = source.map(item => item.text).join('\\n');
    const info = manager.markItemInfos.value.find(item => manager.checkMarkSourceIsSame(item.source, source)) ?? {id: crypto.randomUUID(), source, stroke: [], comments: [], approx: {exact: text, prefix: '', suffix: '', position_start: 0, position_end: 0}};
    manager.clearSelectContent();
    for (const item of source) manager.pushSelectContent({type: 'text', text: item.text, src: ''});
    await manager.strokeSelection({info, comment, replyToUid});
    return JSON.parse(JSON.stringify(manager.markItemInfos.value));
  },
  async restore(detail) {await manager.drawMarks(detail); return JSON.parse(JSON.stringify(manager.markItemInfos.value));},
  projected(source, width) {
    const current = viewer.getPageView(1).viewport;
    const viewport = width ? current.clone({scale: current.scale * width / current.width}) : current;
    return source.flatMap(item => item.quads.map(quad => quadToViewport(quad, viewport)));
  },
  async close() {viewer.destroy(); await loading.destroy(); worker.terminate();},
};`}, bundle: true, write: false, platform: 'browser', format: 'iife', target: ['safari16.4', 'chrome110']});
  return output.outputFiles[0].text;
}

function persistedStore() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sr_bookmark_comment (id TEXT PRIMARY KEY, type INTEGER, source TEXT, user_bookmark_uuid TEXT, comment TEXT, approx_source TEXT, content TEXT, is_deleted INTEGER, created_at TEXT, metadata TEXT)');
  const database = {execute: async (sql, params = []) => db.prepare(sql).run(...params), getOptional: async (sql, params = []) => db.prepare(sql).get(...params), writeTransaction: async work => work(database)};
  let id = 100;
  const repository = new MobileRepositories(database, () => String(++id), () => '2026-01-01T00:00:00Z');
  const rows = () => db.prepare('SELECT * FROM sr_bookmark_comment ORDER BY id').all();
  const detail = () => buildReaderMarks(rows(), [], {id: '1', name: 'Reader'}, PERSONAL_MARK_POLICY);
  const save = async (source, type, comment = '', parentId) => repository.addMark({bookmarkId: 'interop-bookmark', userId: '1', type, source, comment, parentId, rootId: parentId,
    selectContent: source.map(item => ({type: 'text', text: item.text, src: ''})), approxSource: {exact: source.map(item => item.text).join('\n'), prefix: '', suffix: '', position_start: 0, position_end: 0}, markPolicy: PERSONAL_MARK_POLICY});
  return {db, rows, detail, save, repository};
}

function assertPoints(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((points, index) => {
    assert.equal(points.length, expected[index].length);
    points.forEach((value, point) => assert.ok(Math.abs(value - expected[index][point]) < 0.001, `${value} != ${expected[index][point]}`));
  });
}

test('extracted PDF annotation grouping retains exact sources, deleted ancestors, replies and anchor lookup', () => {
  const documentId = 'a'.repeat(64);
  const source = [{type: 'pdf', version: 1, document_id: documentId, page: 2, text: 'Exact passage', quads: [[0, 10, 20, 10, 20, 0, 0, 0]]}];
  const row = (id, type, extra = {}) => ({id, type, source, parent_id: 0, root_id: 0, user_id: 1, comment: '', created_at: '', ...extra});
  const detail = {mark_list: [row(10, 1), row(11, 2, {is_deleted: true}), row(12, 3, {source: 11, parent_id: 11, root_id: 11, is_deleted: true}), row(13, 3, {source: 12, parent_id: 12, root_id: 11, comment: 'Live reply'})], user_list: {1: {username: 'Reader', avatar: ''}}};
  assert.equal(isPdfMarkDetail(detail, documentId), true);
  const {items, anchors} = groupPdfMarks(detail, documentId);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, '10');
  assert.deepEqual(items[0].stroke, [{mark_id: 10, userId: 1}]);
  assert.equal(items[0].comments[0].isDeleted, true);
  assert.equal(items[0].comments[0].children[0].isDeleted, true);
  assert.equal(items[0].comments[0].children[0].children[0].comment, 'Live reply');
  for (const id of [10, 11, 12, 13]) assert.deepEqual(anchors.get(String(id)), source[0]);
  assert.equal(pdfSourceKey(source), pdfSourceKey(source.map(({quads, ...rest}) => ({quads, ...rest}))));
  assert.notEqual(pdfSourceKey(source), pdfSourceKey([{...source[0], page: 3}]));
  const deleted = groupPdfMarks({...detail, mark_list: detail.mark_list.map(item => ({...item, is_deleted: true}))}, documentId);
  assert.equal(deleted.items.length, 0);
  assert.deepEqual(deleted.anchors.get('13'), source[0], 'Deleted records retain their established note anchor behavior');
  assert.equal(isPdfMarkDetail(detail, 'b'.repeat(64)), false);
});

test('extracted PDF annotation grouping terminates cyclic replies and rejects invalid bridge mark details', () => {
  const documentId = 'a'.repeat(64);
  const source = [{type: 'pdf', version: 1, document_id: documentId, page: 1, text: 'Quote', quads: [[0, 10, 20, 10, 20, 0, 0, 0]]}];
  const root = {id: 1, type: 2, source, parent_id: 0, root_id: 0, user_id: 1, comment: 'Root', created_at: ''};
  const reply = {...root, id: 2, type: 3, source: 3, parent_id: 3, root_id: 1};
  const detail = {mark_list: [root, reply, {...reply, id: 3, source: 2, parent_id: 2}], user_list: []};
  assert.equal(isPdfMarkDetail(detail, documentId), true);
  const grouped = groupPdfMarks(detail, documentId);
  assert.deepEqual(grouped.items[0].comments.map(item => item.markId), [1, 2, 3]);
  assert.ok(grouped.items[0].comments.every(item => item.children.length === 0));
  for (const value of [null, {...detail, user_list: [null]}, {...detail, mark_list: [{...root, id: 1.5}]}, {...detail, mark_list: [{...root, source: [{...source[0], quads: []}]}]}, {...detail, mark_list: [{...root, approx_source: {exact: 1}}]}]) assert.equal(isPdfMarkDetail(value, documentId), false);
});

test('mobile PDF quad conversion round-trips fractional translated and rotated viewport geometry', () => {
  const rect = {left: 12.25, top: 24.5, right: 120.75, bottom: 55.125};
  for (const scale of [0.5, 1.25, 2]) for (const rotated of [false, true]) {
    const viewport = {
      width: 600, height: 800,
      convertToPdfPoint: (x, y) => rotated ? [(y - 11) / scale, (x - 7) / scale] : [(x - 7) / scale, (800 - y) / scale],
      convertToViewportPoint: (x, y) => rotated ? [y * scale + 7, x * scale + 11] : [x * scale + 7, 800 - y * scale],
    };
    const quad = rectToPdfQuad(rect, viewport);
    assertPoints(quadToViewport(quad, viewport), [[rect.left, rect.top], [rect.right, rect.top], [rect.right, rect.bottom], [rect.left, rect.bottom]]);
  }
});

test('extracted PDF layout discards deferred restores after lifecycle replacement and preserves completion order', nativeBoundary, async () => {
  await withNativeHost(async host => {
    Object.defineProperty(host.window.document.documentElement, 'clientWidth', {value: 390});
    const lifecycle = {active: true, disposed: false, failed: false, generation: 0};
    const requests = [], messages = [], order = [];
    const pdf = {numPages: 2, getPage: number => new Promise(resolve => requests.push({number, resolve}))};
    const options = {hostViewport: true, labels: {page: 'Page'}, descriptor: {document_id: 'a'.repeat(64)}};
    const root = host.window.document.createElement('div');
    const layout = createPdfLayout(root, options, {lifecycle, getDocument: () => pdf, post: message => {messages.push(message); order.push(message.kind)}, schedule: () => order.push('schedule')});
    layout.initialize({width: 612, height: 792}, 2);
    for (const [index, slot] of layout.slots.entries()) Object.defineProperties(slot, {offsetTop: {get: () => index * 500}, offsetHeight: {get: () => 480}});
    const page = {getViewport: ({scale}) => ({width: 612 * scale, height: 792 * scale})};
    const first = layout.restore(1.25, 'replaced', () => order.push('replaced'));
    const rejected = assert.rejects(first, /Restore cancelled/);
    lifecycle.active = false; lifecycle.generation++;
    lifecycle.active = true; lifecycle.generation++;
    requests.shift().resolve(page);
    await rejected;
    assert.equal(messages.some(message => message.kind === 'scroll'), false);
    const latest = layout.restore(2.5, 'latest', () => order.push('complete'));
    requests.shift().resolve(page);
    await latest;
    assert.deepEqual(messages.filter(message => message.kind === 'scroll'), [{kind: 'scroll', y: 740, revealHeader: false, restoreId: 'latest'}]);
    assert.deepEqual(order.slice(-3), ['scroll', 'schedule', 'complete']);
    const tornDown = layout.restore(1, 'disposed', () => order.push('disposed'));
    const cancelled = assert.rejects(tornDown, /Restore cancelled/);
    lifecycle.disposed = true;
    requests.shift().resolve(page);
    await cancelled;
    assert.equal(messages.filter(message => message.kind === 'scroll').length, 1);
    assert.throws(() => layout.restore(NaN, 'invalid', () => {}), /Invalid PDF position/);
  });
});

test('Web PDF geometry and shared MarkManager interoperate with persisted mobile marks on a rotated, zoomed PDF (local browser, not server sync)', {skip: !chromium, timeout: 60000}, async () => {
  const bytes = rotatedPdf();
  const documentId = createHash('sha256').update(bytes).digest('hex');
  const assets = JSON.parse(await readFile(`${mobile}assets/pdf/bundle.json`, 'utf8'));
  const runtime = await build({entryPoints: [`${mobile}src/reader/pdf-runtime.ts`], bundle: true, write: false, platform: 'browser', format: 'iife', target: ['safari16.4', 'chrome110']});
  assets.script = runtime.outputFiles[0].text;
  const documentBundle = await build({entryPoints: [`${mobile}src/reader/pdf-document.ts`], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{name: 'current-runtime', setup(build) {build.onLoad({filter: /assets\/pdf\/bundle\.json$/}, () => ({contents: JSON.stringify(assets), loader: 'json'}));}}]});
  const {composePdfDocument} = await import(`data:text/javascript;base64,${Buffer.from(documentBundle.outputFiles[0].text).toString('base64')}`);
  const webScript = await webHarness();
  const css = await readFile(webRequire.resolve('pdfjs-dist/web/pdf_viewer.css'), 'utf8');
  const workerScript = await readFile(webRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
  const browser = await chromium.launch({executablePath: chrome, headless: true});
  const store = persistedStore();
  try {
    const webPage = await browser.newPage({viewport: {width: 1200, height: 1000}});
    const mobilePage = await browser.newPage({viewport: {width: 390, height: 844}});
    const errors = [], requests = [], mobileEvents = [], webWrites = [];
    for (const page of [webPage, mobilePage]) {page.on('pageerror', error => errors.push(error.message)); page.on('console', message => {if (message.type() === 'warning' && /fake worker|Unable to load/.test(message.text())) errors.push(message.text());});}
    await webPage.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/') return route.fulfill({contentType: 'text/html', body: `<html><head><style>${css}\nbody{margin:0}.pdfViewer{width:1000px}.pdf-page-slot{overflow:auto}.pdfViewer .page{border:0}.slax-pdf-marks{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}</style></head><body><div id="viewer" class="pdfViewer"></div><script src="/fixture.js"></script></body></html>`});
      if (path === '/fixture.js') return route.fulfill({contentType: 'text/javascript', body: webScript});
      if (path === '/pdf.worker.mjs') return route.fulfill({contentType: 'text/javascript', body: workerScript});
      if (path === '/document.pdf') return route.fulfill({contentType: 'application/pdf', body: bytes});
      if (path === '/images/loading-icon.gif') return route.fulfill({contentType: 'image/gif', body: await readFile(webRequire.resolve('pdfjs-dist/web/images/loading-icon.gif'))});
      if (path.startsWith('/standard_fonts/') && !path.includes('..')) return route.fulfill({body: await readFile(webRequire.resolve(`pdfjs-dist${path}`))});
      requests.push(route.request().url()); return route.abort();
    });
    await webPage.exposeFunction('persistWebMark', async request => {
      webWrites.push(request);
      const body = request.body;
      assert.equal(validatePdfSources(body.source, documentId) > 0, true);
      const id = await store.repository.addMark({bookmarkId: body.bookmark_uid, userId: '1', source: body.source, type: body.type, comment: body.comment, parentId: body.parent_uid, rootId: body.parent_uid, selectContent: body.select_content, approxSource: body.approx_source, markPolicy: PERSONAL_MARK_POLICY});
      return {mark_uid: id, root_uid: body.parent_uid ?? id};
    });
    const mobileBytes = `/pdf/cross-interop/${documentId}/${bytes.length}`;
    const mobileHtml = composePdfDocument({pageId: 'cross-interop', descriptor: {document_id: documentId, size: bytes.length, filename: 'rotated.pdf'}, source: mobileBytes, currentUserId: 1});
    await mobilePage.route('**/*', route => {
      const url = new URL(route.request().url());
      if (route.request().url() === 'https://pdf.reader.slax.invalid/') return route.fulfill({contentType: 'text/html', body: mobileHtml});
      // Byte ranges come from the page's own origin, as the native PDF hosts serve them.
      const range = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range ?? '');
      if (url.origin === 'https://pdf.reader.slax.invalid' && url.pathname === mobileBytes && range) {
        const begin = Number(range[1]), end = Math.min(Number(range[2]) + 1, bytes.length);
        return route.fulfill({status: 206, contentType: 'application/pdf', headers: {'Content-Range': `bytes ${begin}-${end - 1}/${bytes.length}`}, body: bytes.subarray(begin, end)});
      }
      requests.push(route.request().url()); return route.abort();
    });
    await mobilePage.exposeFunction('nativePdfMessage', async raw => {mobileEvents.push(JSON.parse(raw));});
    await mobilePage.addInitScript(() => {window.ReactNativeWebView = {postMessage: value => window.nativePdfMessage(value)};});
    await webPage.goto('https://web-pdf.test/');
    await webPage.evaluate(id => window.interop.start(id), documentId);
    await webPage.evaluate(() => window.interop.zoom(1.25));
    await webPage.waitForFunction(() => document.querySelector('.page[data-page-number="2"] .textLayer span'));
    const capturedWeb = await webPage.evaluate(() => window.interop.capture());
    assert.equal(capturedWeb.rotation, 90); assert.equal(capturedWeb.scale, 1.25);
    assert.equal(capturedWeb.source[0].document_id, documentId); assert.equal(capturedWeb.source[0].page, 2);
    assert.equal(capturedWeb.source[0].text, 'Interop page 2 first line Second exact passage');
    assert.equal(capturedWeb.source[0].quads.length, 2);
    await webPage.evaluate(source => window.interop.save(source), capturedWeb.source);
    await webPage.evaluate(source => window.interop.save(source, 'Root from Web'), capturedWeb.source);
    const rootId = store.rows()[1].id;
    await webPage.evaluate(({source, rootId}) => window.interop.save(source, 'Reply from Web', rootId), {source: capturedWeb.source, rootId});
    assert.equal(webWrites.length, 3);
    for (const row of store.rows()) assert.deepEqual(JSON.parse(row.source), capturedWeb.source);
    await store.repository.deleteMark(rootId, PERSONAL_MARK_POLICY, '1');
    const persisted = JSON.parse(JSON.stringify(store.detail()));
    assert.deepEqual(persisted.mark_list[0].source, capturedWeb.source);
    await mobilePage.goto('https://pdf.reader.slax.invalid/');
    await mobilePage.waitForFunction(() => document.querySelector('.page[data-page-number="2"] .textLayer span'));
    let commandId = 0;
    const command = async (operation, argument) => {
      const id = `interop-${++commandId}`;
      await mobilePage.evaluate(message => window.__slaxPdfReceive(message), {channel: 'slax-pdf', pageId: 'cross-interop', kind: 'command', id, operation, argument});
      while (!mobileEvents.some(message => message.kind === 'result' && message.id === id)) await mobilePage.waitForTimeout(5);
      const result = mobileEvents.find(message => message.kind === 'result' && message.id === id);
      assert.equal(result.error, undefined); return result.result;
    };
    await command('drawMarks', persisted);
    await command('scrollToAnchor', '2');
    await mobilePage.setViewportSize({width: 577, height: 844});
    await mobilePage.waitForFunction(() => document.querySelectorAll('.page[data-page-number="2"] .mark-quad').length === 2 && document.querySelector('.page[data-page-number="2"]').clientWidth === 561);
    assert.equal(await mobilePage.locator('#controls, #zoom, #zoom-in, #fit').count(), 0);
    const mobileMark = mobileEvents.filter(message => message.event?.type === 'markItemInfosChanged').at(-1).event.marks[0];
    assert.deepEqual(mobileMark, groupPdfMarks(persisted, documentId).items[0], 'Real browser composition consumes the extracted annotation policy');
    assert.deepEqual(mobileMark.source, capturedWeb.source);
    assert.equal(mobileMark.stroke.length, 1); assert.equal(mobileMark.comments[0].isDeleted, true);
    assert.equal(mobileMark.comments[0].children[0].comment, 'Reply from Web');
    const width = await mobilePage.locator('.page[data-page-number="2"]').evaluate(element => element.clientWidth);
    const projected = await webPage.evaluate(({source, width}) => window.interop.projected(source, width), {source: capturedWeb.source, width});
    const paths = await mobilePage.locator('.page[data-page-number="2"] .mark-quad').evaluateAll(elements => elements.map(element => element.getAttribute('d').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number)));
    assertPoints(paths, projected.map(points => [points[3], points[2]].flat()));
    await mobilePage.locator('.mark-quad').first().focus(); await mobilePage.keyboard.press('Enter');
    assert.equal(mobileEvents.filter(message => message.event?.type === 'markClicked').at(-1).event.mark.comments[0].children[0].comment, 'Reply from Web');

    await mobilePage.evaluate(() => {
      const spans = document.querySelectorAll('.page[data-page-number="2"] .textLayer span');
      const range = document.createRange(); range.setStart(spans[0].firstChild, 0); range.setEnd(spans[1].firstChild, spans[1].firstChild.length);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    const capturedMobile = await command('captureSelection');
    assert.equal(capturedMobile.source[0].page, 2); assert.equal(capturedMobile.source[0].document_id, documentId);
    assert.equal(capturedMobile.text, capturedWeb.source[0].text);
    store.db.exec('DELETE FROM sr_bookmark_comment');
    const mobileSource = selectionPaths(capturedMobile);
    await store.save(mobileSource, 1);
    const mobileRoot = await store.save(mobileSource, 2, 'Root from mobile');
    await store.save(mobileSource, 3, 'Reply from mobile', mobileRoot);
    await store.repository.deleteMark(mobileRoot, PERSONAL_MARK_POLICY, '1');
    const restoredWeb = await webPage.evaluate(detail => window.interop.restore(detail), JSON.parse(JSON.stringify(store.detail())));
    assert.equal(restoredWeb.length, 1); assert.deepEqual(restoredWeb[0].source, capturedMobile.source);
    assert.equal(restoredWeb[0].stroke.length, 1); assert.equal(restoredWeb[0].comments[0].isDeleted, true);
    assert.equal(restoredWeb[0].comments[0].children[0].comment, 'Reply from mobile');
    await webPage.evaluate(() => window.interop.zoom(0.75));
    await webPage.waitForFunction(() => document.querySelectorAll('.page[data-page-number="2"] .slax-pdf-marks polygon').length === 2);
    const webProjection = await webPage.evaluate(source => window.interop.projected(source), capturedMobile.source);
    const polygons = await webPage.locator('.page[data-page-number="2"] .slax-pdf-marks polygon').evaluateAll(elements => elements.map(element => element.getAttribute('points').split(/[ ,]+/).map(Number)));
    assertPoints(polygons, webProjection.map(points => points.flat()));
    await webPage.locator('.slax-pdf-marks g').first().focus(); await webPage.keyboard.press('Enter');
    const opened = await webPage.evaluate(() => window.openedComment);
    assert.deepEqual(opened.source, capturedMobile.source); assert.equal(opened.comments[0].children[0].comment, 'Reply from mobile');
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    await command('teardown'); await webPage.evaluate(() => window.interop.close());
  } finally {store.db.close(); await browser.close();}
});
