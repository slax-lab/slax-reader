import assert from 'node:assert/strict';
import {createServer} from 'node:http';

// Synthetic responses only; no backend, account, signing or operator configuration.
const allowed = ['success', 'legacy-success', 'signed-out', 'expired', 'rejected', 'failed', 'cancel', 'safari-success'];
const safariTitle = 'Controlled Safari preprocessing title';
const args = process.argv.slice(2);
assert(args.length === 0 || args.length === 2 && args[0] === '--port' && /^[1-9]\d*$/.test(args[1]) && Number(args[1]) > 1024 && Number(args[1]) < 65536, 'Use an ephemeral or explicit controlled loopback port');
let scenario = '', serial = 0;
const receipts = [];
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/fixture/receipts' && request.method === 'GET') {
      response.writeHead(200, {'Content-Type': 'application/json'}); response.end(JSON.stringify({controlledFixture: true, receipts})); return;
    }
    if (pathname === '/fixture/page' && request.method === 'GET') {
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>' + safariTitle + '</title></head><body><h1>Controlled Safari share page</h1><p>Only this owned loopback page is used for preprocessing acceptance.</p></body></html>'); return;
    }
    assert.equal(request.method, 'POST');
    let body = '';
    for await (const chunk of request) {body += chunk; assert(body.length < 8192);}
    const input = JSON.parse(body);
    if (pathname === '/fixture/control') {
      assert(allowed.includes(input.scenario)); scenario = input.scenario; serial++;
      receipts.push({kind: 'prepared', scenario, serial});
      response.writeHead(200); response.end('{}'); return;
    }
    assert.equal(pathname, '/v1/bookmark/add_url');
    assert(allowed.includes(scenario) && scenario !== 'signed-out');
    assert.equal(request.headers.authorization, 'Bearer fixture-share-token-NOT-A-REAL-CREDENTIAL');
    assert.equal(request.headers['user-agent'], 'SlaxReader/iOS 1.0.25 (757)');
    const expected = scenario === 'safari-success' ? {target_url: `http://127.0.0.1:${server.address().port}/fixture/page`, target_title: safariTitle} : {target_url: 'https://share-fixture.test/controlled-article'};
    assert.deepEqual(input, expected);
    const received = {kind: 'native-collection', scenario, serial, targetUrl: input.target_url, ...(input.target_title ? {targetTitle: input.target_title} : {}), responseStatus: null, disconnectedBeforeResponse: false};
    receipts.push(received);
    response.on('close', () => {if (!response.writableEnded) received.disconnectedBeforeResponse = true;});
    if (received.scenario === 'cancel') await new Promise(resolve => setTimeout(resolve, 4000));
    else await new Promise(resolve => setTimeout(resolve, 300));
    const status = received.scenario === 'expired' ? 401 : received.scenario === 'rejected' ? 400 : received.scenario === 'failed' ? 503 : 200;
    received.responseStatus = status;
    if (!response.destroyed) {response.writeHead(status, {'Content-Type': 'application/json'}); response.end(JSON.stringify({code: status, message: status === 400 ? 'Controlled collection rejection' : 'Controlled response', data: null}));}
  } catch {response.writeHead(400); response.end('{"message":"Controlled request rejected"}');}
});
server.listen(args.length ? Number(args[1]) : 0, '127.0.0.1', () => console.log(JSON.stringify({controlledFixture: true, pid: process.pid, apiOrigin: `http://127.0.0.1:${server.address().port}`, productionRequests: false, credentialsPersisted: false})));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
