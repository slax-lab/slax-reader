import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {LEGACY_MOBILE_TABLES} from '../../../src/data/schema.ts';

const upstream = new URL(process.argv[2]);
assert(upstream.hostname === '127.0.0.1' && upstream.protocol === 'http:');
const token = 'fixture-auth-token-NOT-A-REAL-CREDENTIAL';
const input = JSON.parse(readFileSync(new URL('../adoption-fixtures/visible-legacy-inputs.json', import.meta.url), 'utf8'));
const rows = Object.fromEntries(Object.entries(LEGACY_MOBILE_TABLES).filter(([, t]) => !t.options?.localOnly).map(([name]) => [name, []]));
rows.sr_user = [{id: 'synthetic-user', name: 'Upgrade Test', email: 'upgrade@example.invalid', lang: 'en', ai_lang: 'en'}];
rows.sr_user_tag = [input.tag];
rows.sr_user_bookmark = [
  {...input.bookmark, alias_title: 'Cloud article after reset', metadata: JSON.stringify({bookmark: {...input.bookmarkDetails, title: 'Cloud article after reset', target_url: 'https://example.invalid/cloud'}, tags: ['tag-1'], share: input.share})},
  {...input.bookmark, id: 'cloud-only-2', alias_title: 'Second cloud article', metadata: JSON.stringify({bookmark: {...input.bookmarkDetails, uuid: 'article-2', title: 'Second cloud article', target_url: 'https://example.invalid/second'}, tags: [], share: {...input.share, uuid: 'share-2'}})},
];
const call = async (path, body) => {
  const response = await fetch(new URL(path, upstream), {method: body === undefined ? 'GET' : 'POST', headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const result = await response.json(); assert.equal(result.code, 200); return result.data;
};
await call('/fixture/init', {runId: 'legacy-reset-ui-20261109', platform: 'android', rows});
await call('/fixture/release-uploads', {});
let loginCount = 0, contentCount = 0;
const json = (out, data) => {out.setHeader('Content-Type', 'application/json');out.end(JSON.stringify({code: 200, message: 'Synthetic acceptance service', data}));};
const server = createServer(async (req, out) => {
  try {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    let body = ''; for await (const chunk of req) {body += chunk; assert(body.length < 1048576);}
    if (path === '/v1/user/login') {assert(JSON.parse(body).code === 'synthetic-provider-success');loginCount++; return json(out, {token, user_id: 'synthetic-user', is_new_user: false});}
    if (path === '/v1/user/refresh') return json(out, {token});
    if (path === '/terms' || path === '/privacy') {out.setHeader('Content-Type', 'text/html');return out.end('<html><body><h1>Isolated simulator agreement</h1><p>Only synthetic acceptance data.</p></body></html>');}
    if (path === '/fixture/summary') return json(out, {loginCount, contentCount, backend: await call('/fixture/server-receipts')});
    if (path === '/v1/sync/token' || path === '/v1/sync/changes') {assert(req.headers.authorization === `Bearer ${token}`);return json(out, await call(path, body ? JSON.parse(body) : undefined));}
    if (path === '/v1/user/labs') return json(out, {features: []});
    if (path === '/v1/bookmark/content') {assert(req.headers.authorization === `Bearer ${token}`);contentCount++;out.setHeader('Content-Type', 'text/html; charset=utf-8');return out.end('<article><h1>Cloud article after reset</h1><p>Downloaded from the isolated server after discarding old device data.</p><p>This is not the old cached article.</p></article>');}
    if (path === '/v1/bookmark/metadata') return json(out, {...input.bookmarkDetails, uuid: 'bookmark-1', title: 'Cloud article after reset', alias_title: 'Cloud article after reset', type: 'article', is_starred: false, archive_status: 0});
    if (path === '/events' || path === '/m') return json(out, {});
    return json(out, {});
  } catch {out.statusCode = 400;json(out, null);}
});
server.listen(8198, '127.0.0.1', () => console.log(JSON.stringify({status: 'ready', origin: 'http://127.0.0.1:8198', provider: 'synthetic', sync: 'real-local-powersync', rows: rows.sr_user_bookmark.length})));
process.on('SIGTERM', () => server.close());
