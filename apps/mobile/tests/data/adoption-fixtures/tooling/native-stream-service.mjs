import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';

assert.deepEqual(process.argv.slice(2), ['--start'], 'Choose the bounded owned native stream service');
const directory = mkdtempSync(path.join(tmpdir(), 'slax-native-stream-service-'));
const nonce = randomUUID(), observations = [];
const owner = {kind: 'slax-controlled-native-stream-service', version: 1, directory, nonce, processId: process.pid, createdAt: new Date().toISOString()};
const timers = new Set();
const persist = () => writeFileSync(path.join(directory, 'observations.json'), JSON.stringify({kind: 'slax-controlled-native-stream-observations', nonce, observations}, null, 2) + '\n');
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST');
    assert(['/v1/bookmark/overview', '/v1/bookmark/outline'].includes(request.url));
    assert.equal(request.headers.authorization, 'Bearer fixture-stream-token-NOT-A-REAL-CREDENTIAL');
    assert.equal(request.headers.accept, 'text/event-stream');
    let body = ''; for await (const chunk of request) {body += chunk; assert(body.length < 1024);}
    assert.deepEqual(JSON.parse(body), {bookmark_uid: `stream-${nonce}`, force: false});
    const mode = request.url.endsWith('/overview') ? 'timed-chunks' : 'cancel';
    assert(!observations.some(value => value.mode === mode), 'Only one selected request per stream mode');
    const observation = {mode, receivedAt: Date.now(), events: [], responseClosedAt: null, finalSentAt: null, futureChunkSent: false}; observations.push(observation); persist();
    response.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'close'}); response.flushHeaders();
    const first = Buffer.from(JSON.stringify({type: 'data', data: {overview: '真实流式首块'}}) + '\n');
    const split = first.indexOf(Buffer.from('真')) + 1;
    response.write(first.subarray(0, split));
    const schedule = (delay, work) => {const timer = setTimeout(() => {timers.delete(timer); if (!response.destroyed) work();}, delay); timers.add(timer);};
    schedule(80, () => {response.write(first.subarray(split)); observation.events.push({name: 'first-complete-line', sentAt: Date.now()}); persist();});
    schedule(1800, () => {response.write(JSON.stringify({type: 'data', data: {overview: '真实流式第二块'}}) + '\n'); observation.futureChunkSent = true; observation.events.push({name: 'second-line', sentAt: Date.now()}); persist();});
    schedule(3200, () => {response.end(JSON.stringify({type: 'done', data: {done: true}})); observation.finalSentAt = Date.now(); observation.events.push({name: 'unterminated-final-line', sentAt: observation.finalSentAt}); persist();});
    response.once('close', () => {observation.responseClosedAt = Date.now(); persist();});
  } catch {
    // Never log request headers, bodies or credential material, even on a guard failure.
    if (!response.headersSent) response.writeHead(400); response.end('Controlled stream request rejected');
  }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address(); assert(address && typeof address !== 'string' && address.address === '127.0.0.1');
  owner.origin = `http://127.0.0.1:${address.port}`; writeFileSync(path.join(directory, 'fixture-owner.json'), JSON.stringify(owner, null, 2) + '\n'); persist();
  console.log(JSON.stringify(owner));
});
const shutdown = () => {timers.forEach(clearTimeout); timers.clear(); server.closeAllConnections(); server.close(() => process.exit(0));};
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
setTimeout(shutdown, 120000).unref();
