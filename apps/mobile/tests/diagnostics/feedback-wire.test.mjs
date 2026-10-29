import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {SlaxApi} from '../../src/data/api.ts';
import {stageRecentDiagnostics} from '../../src/diagnostics/storage.ts';
import {sanitizeDiagnosticExportEntry, DIAGNOSTIC_REQUEST_MAX_BYTES} from '@slax-reader/contracts/feedback';

test('real loopback HTTP receives legacy JSON then one consented sanitized NDJSON attachment', async () => {
  const received = [];
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/user/report'); assert.equal(request.headers.authorization, 'Bearer test-token');
      const chunks = []; let size = 0;
      for await (const chunk of request) {size += chunk.length; assert.ok(size <= DIAGNOSTIC_REQUEST_MAX_BYTES); chunks.push(chunk);}
      const body = new Response(Buffer.concat(chunks), {headers: {'Content-Type': request.headers['content-type']}});
      if (request.headers['content-type'].startsWith('multipart/form-data; boundary=')) {
        const form = await body.formData(); assert.deepEqual([...form.keys()], ['report', 'diagnostic_log']);
        const report = JSON.parse(form.get('report')); assert.equal(report.attach_diagnostic_log, true);
        const file = form.get('diagnostic_log'), text = await file.text();
        assert.match(file.name, /^slax-diagnostics-.*\.ndjson$/); assert.equal(file.type, 'application/x-ndjson');
        assert.equal(text.includes('private-token'), false); assert.equal(text.includes('private-body'), false);
        for (const line of text.trim().split('\n')) assert.ok(sanitizeDiagnosticExportEntry(JSON.parse(line)));
        received.push({report, text});
      } else {assert.equal(request.headers['content-type'], 'application/json'); received.push({report: await body.json()});}
      response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({code: 200, data: 'accepted', message: ''}));
    } catch (error) {response.writeHead(500, {'Content-Type': 'application/json'}).end(JSON.stringify({code: 500, message: String(error)}));}
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`, session = {token: 'test-token', userId: 'test-user', refreshedAt: 0};
    const api = new SlaxApi({baseUrl, platform: 'ios', version: '1.0.25', sessions: {getSession: async () => session, clearIfMatches: async () => false}});
    const report = {bookmark_uuid: 'bookmark', entry_point: 'bookmark_detail', type: 'parse_error', content: 'Feedback draft', platform: 'app', environment: 'iOS 794', version: '1.0.25 (794)', allow_follow_up: false, target_url: 'https://example.org/article'};
    assert.equal(await api.sendFeedback(report), 'accepted');
    const source = {storage: {shareAvailable: true, list: async () => [], async stage(text) {return {uri: 'file:///cache/slax-diagnostics-wire.ndjson', filename: 'slax-diagnostics-wire.ndjson', file: new Blob([text], {type: 'application/x-ndjson'}), release() {}};}},
      async snapshot() {return {v: 1, ts: new Date().toISOString(), event: 'snapshot', session: 'authenticated', network: 'online', sync: {connected: true, pendingUploads: 0}, token: 'private-token', body: 'private-body'};}};
    const file = await stageRecentDiagnostics(source);
    try {assert.equal(await api.sendFeedback(report, undefined, file), 'accepted');} finally {file.release();}
    assert.equal(received.length, 2); assert.deepEqual(received[0].report, report); assert.equal(received[0].text, undefined); assert.equal(received[1].report.attach_diagnostic_log, true);
  } finally {server.close(); server.closeAllConnections(); await once(server, 'close');}
});
