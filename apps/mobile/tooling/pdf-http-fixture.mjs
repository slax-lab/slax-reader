import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createFixturePdf} from '../fixtures/pdf.ts';
import {PDF_HTTP_TOKEN, PDF_HTTP_BOOKMARK} from '../fixtures/pdf-http.ts';

export async function startPdfHttpFixture({port = 8093, mode = 'normal'} = {}) {
  if (![0, 8093].includes(port) || !['normal', 'metadata-404', 'slow'].includes(mode)) throw new Error('Use the fixed PDF fixture port and prepared mode');
  const document = createFixturePdf('long-pages'), events = [];
  const record = event => {events.push(event); if (events.length > 128) events.shift();};
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const json = (status, value) => {const body = JSON.stringify(value); response.writeHead(status, {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}); response.end(body);};
    if (request.socket.remoteAddress !== '127.0.0.1' || request.headers.host !== `127.0.0.1:${server.address().port}` || request.headers.authorization !== `Bearer ${PDF_HTTP_TOKEN}`) {json(403, {code: 403, message: 'Synthetic fixture authorization required'}); return;}
    let url;
    try {url = new URL(request.url, `http://${request.headers.host}`);} catch {json(400, {code: 400}); return;}
    if (url.origin !== `http://${request.headers.host}` || url.username || url.password || url.hash || request.headers['content-length'] && request.headers['content-length'] !== '0' || request.headers['transfer-encoding']) {json(400, {code: 400}); return;}
    if (request.method === 'POST' && url.pathname === '/__fixture/control' && [...url.searchParams.keys()].every(key => key === 'mode') && ['normal', 'metadata-404', 'slow'].includes(url.searchParams.get('mode'))) {
      mode = url.searchParams.get('mode'); json(200, {mode, synthetic: true}); return;
    }
    if (request.method !== 'GET') {json(405, {code: 405}); return;}
    if (url.pathname === '/__fixture/status' && !url.search) {json(200, {mode, synthetic: true, bytes: document.bytes.length, events}); return;}
    if (url.pathname === '/v1/user/labs' && !url.search) {json(200, {code: 200, data: {features: [{key: 'pdf', enabled: true}, {key: 'rss', enabled: false}]}}); return;}
    if (url.pathname === '/m' && !url.search) {response.writeHead(204); response.end(); return;}
    if (url.searchParams.get('bookmark_uid') !== PDF_HTTP_BOOKMARK || [...url.searchParams.keys()].some(key => key !== 'bookmark_uid')) {json(404, {code: 404}); return;}
    if (url.pathname === '/v1/mark/users') {json(200, {code: 200, data: []}); return;}
    if (url.pathname === '/v1/bookmark/metadata') {
      const status = mode === 'metadata-404' ? 404 : 200; record({kind: 'metadata', status});
      json(status, status === 200 ? {code: 200, data: {pdf: {...document.descriptor, url: `/v1/bookmark/pdf?bookmark_uid=${PDF_HTTP_BOOKMARK}`}}} : {code: 404, message: 'Synthetic metadata unavailable'}); return;
    }
    if (url.pathname !== '/v1/bookmark/pdf') {json(404, {code: 404}); return;}
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
    const begin = Number(match?.[1]), end = Number(match?.[2]) + 1;
    if (!match || !Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > document.bytes.length || end - begin > 1024 * 1024) {response.setHeader('Content-Range', `bytes */${document.bytes.length}`); json(416, {code: 416}); return;}
    record({kind: 'range', begin, end, state: 'requested'});
    let finished = false, timer;
    const closed = () => {if (timer) clearTimeout(timer); if (!finished) {finished = true; record({kind: 'range', begin, end, state: 'aborted'});}};
    response.once('close', closed);
    const send = () => {
      if (response.destroyed) return;
      response.writeHead(206, {'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${begin}-${end - 1}/${document.bytes.length}`, 'Content-Length': end - begin});
      response.end(document.bytes.subarray(begin, end), () => {if (!finished) {finished = true; record({kind: 'range', begin, end, state: 'completed'});}});
    };
    if (mode === 'slow') timer = setTimeout(send, begin === 0 ? 500 : 5000); else send();
  });
  server.maxConnections = 16; server.headersTimeout = 5000; server.requestTimeout = 15000;
  await new Promise((yes, no) => {server.once('error', no); server.listen(port, '127.0.0.1', yes);});
  return {server, origin: `http://127.0.0.1:${server.address().port}`, document, async close() {await new Promise((yes, no) => {server.close(error => error ? no(error) : yes()); server.closeAllConnections();});}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args[0] && !['normal', 'metadata-404', 'slow'].includes(args[0])) throw new Error('Usage: node --experimental-strip-types tooling/pdf-http-fixture.mjs [normal|metadata-404|slow]');
  const fixture = await startPdfHttpFixture({mode: args[0] ?? 'normal'});
  console.log(JSON.stringify({fixture: 'synthetic-pdf-http', origin: fixture.origin, pages: 30, bytes: fixture.document.bytes.length, noProxy: true}));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {void fixture.close();});
}
