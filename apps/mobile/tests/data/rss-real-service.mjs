import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, randomBytes, sign} from 'node:crypto';
import {createServer, request as httpRequest} from 'node:http';
import {connect as tcpConnect} from 'node:net';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const API_ROOT = path.join(ROOT, 'apps/api');
const POWER_SYNC_ROOT = path.join(ROOT, 'deploy/local/powersync-local');
const PS_IMAGE = 'journeyapps/powersync-service@sha256:413a0c813e96935ebe7203b5759f8a594a7b7cd8aa42134713e63af637e0f079';
const PG_IMAGE = 'postgres@sha256:f02121de6f74d30d8a94cd1d9584125e2178d7e6c377d8130112d4e52d867995';
const LABEL = 'com.slax.rss-real-service.owner';
const AUDIENCE = 'reader-sync';
const API_PORT = 18878;
const SYNC_PORT = 18879;
const DB_PASSWORD = 'rss-local-fixture-not-a-credential';
const API_ADMIN_TOKEN = 'rss-local-fixture-admin-not-a-credential';
const USERS = Object.freeze({
  a: Object.freeze({id: 890001, uuid: 'rss-local-user-a', session: 'rss-local-fixture-session-a-NOT-A-REAL-CREDENTIAL'}),
  b: Object.freeze({id: 890002, uuid: 'rss-local-user-b', session: 'rss-local-fixture-session-b-NOT-A-REAL-CREDENTIAL'}),
});
const IDS = Object.freeze({feed: 'rss-local-feed-shared', privateFeedB: 'rss-local-feed-b-only', subA: 'rss-local-sub-a', subB: 'rss-local-sub-b', subBPrivate: 'rss-local-sub-b-only', latest: 'rss-local-entry-live', history: 'rss-local-entry-history', privateEntryB: 'rss-local-entry-b-only'});
const CHECKPOINTS = new Set(['fresh-empty', 'first-sync', 'owner-isolation', 'history-excluded', 'bookmark-preserved', 'remark-update', 'entry-update', 'labs-disabled', 'labs-reenabled', 'reconnected']);
const TABLES = Object.freeze(['sr_user', 'sr_user_lab_feature', 'sr_rss_feed', 'sr_rss_subscription', 'sr_rss_entry', 'sr_bookmark', 'sr_user_bookmark']);

const hash = value => createHash('sha256').update(value).digest('hex');
const ident = value => {assert(/^[a-z][a-z0-9_]*$/.test(value), 'Invalid SQL identifier'); return `"${value}"`;};
const literal = value => value === null ? 'NULL' : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? `'${value.replaceAll("'", "''")}'` : assert.fail('Only primitive synthetic SQL values are accepted');
const fixtureToken = owner => `Bearer ${USERS[owner]?.session ?? ''}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function validateRunId(value) {
  assert(/^[a-zA-Z0-9-]{1,64}$/.test(value ?? ''), 'An explicit bounded synthetic run ID is required');
  return value;
}

export function initialSeedSql() {
  const stamp = '2026-10-20 00:00:00+00';
  return `
BEGIN;
INSERT INTO sr_user(id,uuid,email,last_login_at,created_at) VALUES
  (${USERS.a.id},${literal(USERS.a.uuid)},'rss-local-a@example.invalid',${literal(stamp)},${literal(stamp)}),
  (${USERS.b.id},${literal(USERS.b.uuid)},'rss-local-b@example.invalid',${literal(stamp)},${literal(stamp)});
INSERT INTO sr_user_lab_feature(user_id,feature,enabled,created_at,updated_at) VALUES
  (${USERS.a.id},'rss',TRUE,${literal(stamp)},${literal(stamp)}),
  (${USERS.b.id},'rss',TRUE,${literal(stamp)},${literal(stamp)});
INSERT INTO sr_rss_feed(id,feed_url,title,site_url,next_fetch_at,next_allowed_at,icon_url,created_at) VALUES
  (${literal(IDS.feed)},'https://rss-local-fixture.invalid/feed','RSS Local Shared Feed','https://rss-local-fixture.invalid',${literal(stamp)},${literal(stamp)},NULL,${literal(stamp)}),
  (${literal(IDS.privateFeedB)},'https://rss-local-fixture.invalid/b-only','RSS Local B-only Feed','https://rss-local-fixture.invalid/b-only',${literal(stamp)},${literal(stamp)},NULL,${literal(stamp)});
INSERT INTO sr_rss_subscription(id,user_id,feed_id,remark,created_at) VALUES
  (${literal(IDS.subA)},${USERS.a.id},${literal(IDS.feed)},'Owner A private remark',${literal(stamp)}),
  (${literal(IDS.subB)},${USERS.b.id},${literal(IDS.feed)},'Owner B private remark',${literal(stamp)}),
  (${literal(IDS.subBPrivate)},${USERS.b.id},${literal(IDS.privateFeedB)},'Owner B-only remark',${literal(stamp)});
INSERT INTO sr_rss_entry(id,feed_id,entry_key,article_url,title,author,summary,content_key,content_truncated,image_url,published_at,first_seen_at,sort_at,updated_at,is_history) VALUES
  (${literal(IDS.latest)},${literal(IDS.feed)},'live-key','https://rss-local-fixture.invalid/article-live','RSS Local Live Entry','Fixture Author','Initial live entry summary','rss-local-live-content',FALSE,NULL,${literal(stamp)},${literal(stamp)},${literal(stamp)},${literal(stamp)},FALSE),
  (${literal(IDS.history)},${literal(IDS.feed)},'history-key','https://rss-local-fixture.invalid/article-history','RSS Local History Entry','Fixture Author','History must not sync','rss-local-history-content',FALSE,NULL,${literal(stamp)},${literal(stamp)},'2026-10-19 00:00:00+00',${literal(stamp)},TRUE),
  (${literal(IDS.privateEntryB)},${literal(IDS.privateFeedB)},'b-only-key','https://rss-local-fixture.invalid/article-b-only','RSS Local B-only Entry','Fixture Author','Owner B feed must not sync to A','rss-local-b-only-content',FALSE,NULL,${literal(stamp)},${literal(stamp)},${literal(stamp)},${literal(stamp)},FALSE);
INSERT INTO sr_bookmark(target_url,private_user,created_at,updated_at,published_at,title) VALUES
  ('https://rss-local-fixture.invalid/article-live',${USERS.a.id},${literal(stamp)},${literal(stamp)},${literal(stamp)},'Preserved RSS bookmark');
INSERT INTO sr_user_bookmark(user_id,bookmark_id,is_starred,updated_at,metadata)
SELECT ${USERS.a.id},id,TRUE,${literal(stamp)},'{"bookmark":{"target_url":"https://rss-local-fixture.invalid/article-live"}}'::jsonb
FROM sr_bookmark WHERE target_url='https://rss-local-fixture.invalid/article-live' AND private_user=${USERS.a.id};
COMMIT;
`;
}

function migrationConfig(directory) {
  const config = path.join(directory, 'isolated-postgres.prisma.config.ts');
  const value = {schema: path.join(API_ROOT, 'prisma/pgsql.prisma'), migrations: {path: path.join(API_ROOT, 'prisma/pg_migrations')}};
  writeFileSync(config, `export default ${JSON.stringify(value).slice(0, -1)}, datasource: { url: process.env.HYPERDRIVE_DATABASE_URL } };\n`, {flag: 'wx'});
  return config;
}

function docker(args, input) {
  const result = spawnSync('docker', args, {input, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024});
  assert.equal(result.status, 0, `Owned Docker operation failed (${args[0]}); no shared service is reused`);
  return result.stdout.trim();
}

function dockerInspectIfPresent(kind, name) {
  const result = spawnSync('docker', [kind, 'inspect', name], {encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024});
  if (result.status === 0) return true;
  if (/no such (object|container|volume|network)/i.test(result.stderr ?? '')) return false;
  assert.equal(result.status, 0, `Unable to inspect task-owned Docker ${kind}`);
  return false;
}

function verifyDockerOwner(kind, name, runId) {
  const format = kind === 'container' ? `{{index .Config.Labels "${LABEL}"}}` : `{{index .Labels "${LABEL}"}}`;
  assert.equal(docker([kind, 'inspect', '--format', format, name]), runId, `Refusing to touch unowned Docker ${kind}`);
}

export function stopOwned(directory) {
  const requested = path.resolve(directory);
  assert(/^slax-rss-real-service-[a-zA-Z0-9]+$/.test(path.basename(requested)), 'Use only a task-owned RSS service directory under the system temp root');
  if (!existsSync(requested)) return;
  const canonical = realpathSync(directory);
  assert(path.dirname(canonical) === realpathSync(tmpdir()) && /^slax-rss-real-service-[a-zA-Z0-9]+$/.test(path.basename(canonical)), 'Use only a marked task-owned RSS service directory');
  const markerPath = path.join(canonical, 'service-owner.json');
  assert(lstatSync(markerPath).isFile() && !lstatSync(markerPath).isSymbolicLink(), 'Missing regular ownership marker');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  assert(marker.kind === 'slax-controlled-rss-real-service' && marker.version === 1 && validateRunId(marker.runId) === marker.runId, 'Invalid RSS service ownership marker');
  for (const name of [...marker.containers].reverse()) {
    assert(name.startsWith(marker.prefix + '-'), 'Invalid owned container name');
    if (dockerInspectIfPresent('container', name)) {verifyDockerOwner('container', name, marker.runId); docker(['rm', '--force', name]);}
  }
  for (const name of marker.volumes) {
    assert(name.startsWith(marker.prefix + '-'), 'Invalid owned volume name');
    if (dockerInspectIfPresent('volume', name)) {verifyDockerOwner('volume', name, marker.runId); docker(['volume', 'rm', name]);}
  }
  for (const name of [...marker.networks].reverse()) {
    assert([`${marker.prefix}-internal`, `${marker.prefix}-gateway`].includes(name), 'Invalid owned network name');
    if (dockerInspectIfPresent('network', name)) {verifyDockerOwner('network', name, marker.runId); docker(['network', 'rm', name]);}
  }
  rmSync(canonical, {recursive: true, force: true});
}

function sql(container, text) {
  return docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], text);
}

function safeMigration(directory, sourcePort, password) {
  const config = migrationConfig(directory);
  const home = path.join(directory, 'prisma-home');
  const temp = path.join(home, 'tmp');
  mkdirSync(temp, {recursive: true});
  const env = {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    HOME: home,
    TMPDIR: temp,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_DATA_HOME: path.join(home, 'data'),
    DOTENV_CONFIG_PATH: '/dev/null',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    CI: 'true',
    HYPERDRIVE_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${sourcePort}/postgres`,
  };
  const prisma = path.join(API_ROOT, 'node_modules/.bin/prisma');
  assert(existsSync(prisma), 'The installed API Prisma CLI is required');
  const result = spawnSync(prisma, ['migrate', 'deploy', '--config', config], {cwd: API_ROOT, env, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024});
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '<isolated-local-database-url>').replace(/Bearer\s+[^\s]+/gi, 'Bearer <redacted>');
  writeFileSync(path.join(directory, 'migration.log'), output);
  assert.equal(result.status, 0, 'Full branch PostgreSQL migrations failed in the isolated RSS database; see the owned migration log');
}

function apiEnvelope(response, data, status = 200, message = 'ok') {
  response.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
  response.end(JSON.stringify({code: status, message, data}));
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {raw += chunk; assert(raw.length <= 16 * 1024, 'Bounded local fixture request required');}
  return raw ? JSON.parse(raw) : {};
}

function ownerFromRequest(request) {
  return Object.keys(USERS).find(owner => request.headers.authorization === fixtureToken(owner));
}

function onlyKeys(input, allowed) {
  assert(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => allowed.includes(key)), 'Only the bounded fixture contract is accepted');
}

export function validateCheckpointInput(input, authenticatedOwner) {
  onlyKeys(input, ['name', 'owner', 'firstSync', 'rssSubscriptions', 'rssEntries', 'bookmarks', 'otherOwnerRows', 'historyRows', 'ownRemarkVisible', 'otherRemarkVisible', 'liveEntryVisible']);
  assert(CHECKPOINTS.has(input.name) && input.owner === authenticatedOwner, 'Checkpoint must match a known phase and the authenticated owner');
  assert(typeof input.firstSync === 'boolean' && (input.firstSync || input.name === 'fresh-empty'), 'Only the pre-sync empty checkpoint may precede first sync');
  for (const key of ['rssSubscriptions', 'rssEntries', 'bookmarks', 'otherOwnerRows', 'historyRows']) assert(Number.isSafeInteger(input[key]) && input[key] >= 0 && input[key] <= 100, 'Checkpoint requires bounded local observations');
  for (const key of ['ownRemarkVisible', 'otherRemarkVisible', 'liveEntryVisible']) assert(typeof input[key] === 'boolean', 'Checkpoint requires boolean visibility observations');
  if (input.name === 'fresh-empty') {
    assert(authenticatedOwner === 'a' && input.firstSync === false, 'Fresh-empty must be captured for owner A before the RSS stream first sync');
    assert(['rssSubscriptions', 'rssEntries', 'bookmarks', 'otherOwnerRows', 'historyRows'].every(key => input[key] === 0), 'Fresh-empty requires all local RSS and bookmark counts to be zero');
    assert(['ownRemarkVisible', 'otherRemarkVisible', 'liveEntryVisible'].every(key => input[key] === false), 'Fresh-empty requires all RSS visibility observations to be false');
  }
  return {name: input.name, owner: authenticatedOwner, firstSync: input.firstSync, rssSubscriptions: input.rssSubscriptions, rssEntries: input.rssEntries, bookmarks: input.bookmarks, otherOwnerRows: input.otherOwnerRows, historyRows: input.historyRows, ownRemarkVisible: input.ownRemarkVisible, otherRemarkVisible: input.otherRemarkVisible, liveEntryVisible: input.liveEntryVisible};
}

export function validateControlInput(input, authenticatedOwner, runId) {
  onlyKeys(input, ['runId', 'operation', 'enabled', 'available', 'remark', 'title', 'summary']);
  assert(input.runId === runId, 'Control requires the current fixture run ID');
  if (input.operation === 'set-labs') {onlyKeys(input, ['runId', 'operation', 'enabled']); assert(typeof input.enabled === 'boolean', 'Labs state must be boolean');}
  else if (input.operation === 'set-sync-available') {onlyKeys(input, ['runId', 'operation', 'available']); assert(authenticatedOwner === 'a' && typeof input.available === 'boolean', 'Owner A may set bounded local sync availability');}
  else if (input.operation === 'set-api-available') {onlyKeys(input, ['runId', 'operation', 'available']); assert(authenticatedOwner === 'a' && typeof input.available === 'boolean', 'Owner A may set bounded local API availability');}
  else if (input.operation === 'update-remark') {onlyKeys(input, ['runId', 'operation', 'remark']); assert(authenticatedOwner === 'a' && typeof input.remark === 'string' && input.remark.length <= 120, 'Bounded owner-A remark required');}
  else if (input.operation === 'update-entry') {onlyKeys(input, ['runId', 'operation', 'title', 'summary']); assert(authenticatedOwner === 'a' && typeof input.title === 'string' && input.title.length <= 120 && typeof input.summary === 'string' && input.summary.length <= 300, 'Bounded owner-A entry fields required');}
  else if (input.operation === 'disconnect') assert(Object.keys(input).length === 2, 'Disconnect marker has no parameters');
  else assert.fail('Unknown fixture operation');
  return input.operation;
}

function tableSnapshotSql() {
  return `SELECT json_build_object(
    'users', (SELECT json_agg(json_build_object('id',id,'uuid',uuid) ORDER BY id) FROM sr_user WHERE id IN (${USERS.a.id},${USERS.b.id})),
    'labs', (SELECT json_agg(json_build_object('user_id',user_id,'enabled',enabled) ORDER BY user_id) FROM sr_user_lab_feature WHERE user_id IN (${USERS.a.id},${USERS.b.id}) AND feature='rss'),
    'subscriptions', (SELECT json_agg(json_build_object('id',id,'user_id',user_id,'feed_id',feed_id,'remark',remark) ORDER BY user_id,id) FROM sr_rss_subscription WHERE id IN (${literal(IDS.subA)},${literal(IDS.subB)},${literal(IDS.subBPrivate)})),
    'feeds', (SELECT json_agg(json_build_object('id',id,'title',title) ORDER BY id) FROM sr_rss_feed WHERE id IN (${literal(IDS.feed)},${literal(IDS.privateFeedB)})),
    'entries', (SELECT json_agg(json_build_object('id',id,'feed_id',feed_id,'title',title,'is_history',is_history) ORDER BY id) FROM sr_rss_entry WHERE id IN (${literal(IDS.latest)},${literal(IDS.history)},${literal(IDS.privateEntryB)})),
    'bookmarks', (SELECT count(*) FROM sr_user_bookmark ub JOIN sr_bookmark b ON b.id=ub.bookmark_id WHERE ub.user_id=${USERS.a.id} AND b.target_url='https://rss-local-fixture.invalid/article-live' AND ub.deleted_at IS NULL),
    'publicationTables', (SELECT count(*) FROM pg_publication_tables WHERE pubname='powersync'),
    'replicationSlots', (SELECT coalesce(json_agg(json_build_object('slotName',slot_name,'plugin',plugin,'active',active,'confirmedFlushLsn',confirmed_flush_lsn::text) ORDER BY slot_name),'[]') FROM pg_replication_slots)
  );`;
}

function createApiServer(state) {
  return createServer(async (request, response) => {
    const url = new URL(request.url, state.apiOrigin);
    if (request.method === 'GET' && url.pathname === '/fixture/session') {
      const ownerName = url.searchParams.get('owner');
      const owner = ownerName === 'A' ? 'a' : ownerName === 'B' ? 'b' : undefined;
      if (!owner || [...url.searchParams.keys()].some(key => key !== 'owner') || url.searchParams.getAll('owner').length !== 1) return apiEnvelope(response, null, 400, 'Known synthetic owner required');
      return apiEnvelope(response, {userId: USERS[owner].uuid, token: USERS[owner].session, owner: owner.toUpperCase()});
    }
    const owner = ownerFromRequest(request);
    if (!owner) return apiEnvelope(response, null, 401, 'Fixture session required');
    const pathname = url.pathname;
    try {
      if (request.method === 'GET' && pathname === '/fixture/status') {
        const snapshot = JSON.parse(sql(state.source, tableSnapshotSql()));
        return apiEnvelope(response, {runId: state.runId, database: snapshot, transport: state.transport, apiAvailable: state.apiAvailable, syncAvailable: state.syncAvailable, checkpoints: state.checkpoints, operations: state.operations, disconnectRequests: state.disconnectRequests, issuedTokenCount: state.issuedTokens});
      }
      if (request.method === 'POST' && pathname === '/fixture/checkpoints') {
        const input = await readJson(request);
        const checkpoint = {...validateCheckpointInput(input, owner), at: Date.now()};
        state.checkpoints.push(checkpoint);
        return apiEnvelope(response, {accepted: true, sequence: state.checkpoints.length});
      }
      if (request.method === 'POST' && pathname === '/fixture/control') {
        const input = await readJson(request);
        const operation = validateControlInput(input, owner, state.runId);
        if (operation === 'set-labs') {
          sql(state.source, `UPDATE sr_user_lab_feature SET enabled=${literal(input.enabled)},updated_at=now() WHERE user_id=${USERS[owner].id} AND feature='rss';`);
        } else if (operation === 'update-remark') {
          sql(state.source, `UPDATE sr_rss_subscription SET remark=${literal(input.remark)} WHERE id=${literal(IDS.subA)} AND user_id=${USERS.a.id};`);
        } else if (operation === 'update-entry') {
          sql(state.source, `UPDATE sr_rss_entry SET title=${literal(input.title)},summary=${literal(input.summary)},updated_at=now() WHERE id=${literal(IDS.latest)} AND is_history=false;`);
        } else if (operation === 'set-sync-available') {
          if (input.available) assert(state.checkpoints.some(checkpoint => checkpoint.name === 'fresh-empty' && checkpoint.owner === 'a' && checkpoint.firstSync === false && checkpoint.rssSubscriptions === 0 && checkpoint.rssEntries === 0 && checkpoint.bookmarks === 0 && checkpoint.otherOwnerRows === 0 && checkpoint.historyRows === 0 && !checkpoint.ownRemarkVisible && !checkpoint.otherRemarkVisible && !checkpoint.liveEntryVisible), 'Record the empty native RSS database before opening the sync transport');
          state.syncAvailable = input.available;
          if (!input.available) dropConnections(state.proxy);
        } else if (operation === 'set-api-available') {
          state.apiAvailable = input.available;
        } else if (operation === 'disconnect') {
          // The client owns the actual PowerSync disconnect/reconnect; this marker only records test sequencing.
          state.disconnectRequests++;
        } else {
          assert.fail('Unknown fixture operation');
        }
        state.operations.push({operation, owner, at: Date.now()});
        return apiEnvelope(response, {accepted: true});
      }
      if (request.method === 'POST' && pathname === '/v1/sync/token') {
        if (!state.apiAvailable) return apiEnvelope(response, null, 503, 'Local API transport is disabled');
        const header = Buffer.from(JSON.stringify({alg: 'RS256', kid: state.keyId, typ: 'JWT'})).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        const payload = Buffer.from(JSON.stringify({sub: USERS[owner].uuid, aud: AUDIENCE, iat: now, exp: now + 24 * 60 * 60 - 1})).toString('base64url');
        const signingInput = `${header}.${payload}`;
        const token = `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput), state.privateKey).toString('base64url')}`;
        state.issuedTokens++;
        return apiEnvelope(response, {endpoint: state.syncOrigin, token});
      }
      if (request.method === 'GET' && pathname === '/v1/user/labs') {
        if (!state.apiAvailable) return apiEnvelope(response, null, 503, 'Local API transport is disabled');
        const rows = JSON.parse(sql(state.source, `SELECT coalesce(json_agg(json_build_object('enabled',enabled)),'[]') FROM sr_user_lab_feature WHERE user_id=${USERS[owner].id} AND feature='rss';`));
        return apiEnvelope(response, {features: [{key: 'rss', enabled: !!rows[0]?.enabled}]});
      }
      if (request.method === 'POST' && /^\/v1\/user\/setting\/(enable|disable)$/.test(pathname)) {
        if (!state.apiAvailable) return apiEnvelope(response, null, 503, 'Local API transport is disabled');
        const input = await readJson(request);
        onlyKeys(input, ['key']);
        assert(input.key === 'lab:rss', 'Only the RSS Labs switch is accepted');
        const enabled = pathname.endsWith('/enable');
        sql(state.source, `UPDATE sr_user_lab_feature SET enabled=${literal(enabled)},updated_at=now() WHERE user_id=${USERS[owner].id} AND feature='rss';`);
        state.operations.push({operation: 'set-labs', owner, enabled, at: Date.now()});
        return apiEnvelope(response, {key: 'lab:rss', enabled});
      }
      if (request.method === 'GET' && pathname === '/v1/rss/subscriptions') return state.apiAvailable ? apiEnvelope(response, {items: []}) : apiEnvelope(response, null, 503, 'Local API transport is disabled');
      if (request.method === 'GET' && pathname === '/v1/rss/entries') return state.apiAvailable ? apiEnvelope(response, {items: [], next_cursor: null, has_more: false, cached_more: false, history_status: 'available', retry_at: null}) : apiEnvelope(response, null, 503, 'Local API transport is disabled');
      return apiEnvelope(response, null, 404, 'Unsupported local fixture route');
    } catch {
      return apiEnvelope(response, null, 400, 'Local fixture request rejected');
    }
  });
}

function createSyncProxy(state) {
  return createServer((request, response) => {
    const pathname = new URL(request.url, state.syncOrigin).pathname;
    if (pathname.startsWith('/sync/')) {
      state.transport.syncHttpRequests++;
      if (!state.syncAvailable) {
        state.transport.blockedSyncRequests++;
        request.resume();
        response.writeHead(503, {'Content-Type': 'application/json', 'Retry-After': '1'}); response.end('{"status":false}');
        return;
      }
    }
    const forwarded = httpRequest({host: '127.0.0.1', port: state.upstreamPort, path: request.url, method: request.method, headers: request.headers}, upstream => {
      response.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.on('data', chunk => {state.transport.serviceToClientBytes += chunk.length;});
      upstream.pipe(response);
    });
    forwarded.on('error', () => {if (!response.headersSent) response.writeHead(502); response.end();});
    response.on('close', () => forwarded.destroy());
    request.on('data', chunk => {state.transport.clientToServiceBytes += chunk.length;});
    request.pipe(forwarded);
  });
}

function listen(server, port) {return new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', resolve);});}
function closeServer(server) {
  if (!server) return Promise.resolve();
  dropConnections(server);
  return new Promise(resolve => {if (!server.listening) return resolve(); server.close(() => resolve());});
}
function dropConnections(server) {
  if (!server) return;
  server.closeAllConnections?.();
  for (const socket of server.__fixtureSockets ?? []) socket.destroy();
}
function trackSockets(server) {
  server.__fixtureSockets = new Set();
  server.on('connection', socket => {server.__fixtureSockets.add(socket); socket.once('close', () => server.__fixtureSockets.delete(socket));});
}

export async function startOwned(runId, {apiPort = API_PORT, syncPort = SYNC_PORT} = {}) {
  validateRunId(runId);
  for (const port of [apiPort, syncPort]) assert(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Owned loopback ports must be valid');
  assert(apiPort !== syncPort, 'API and PowerSync proxy ports must differ');
  const canBind = async port => new Promise((resolve, reject) => {const server = createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve(true)));});
  await canBind(apiPort); await canBind(syncPort);
  const imageIDs = Object.fromEntries([PS_IMAGE, PG_IMAGE].map(image => {
    const id = docker(['image', 'inspect', '--format', '{{.Id}}', image]);
    assert(/^sha256:[0-9a-f]{64}$/.test(id), 'The pinned local image must already be available; network pulls are disabled');
    return [image, id];
  }));
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'slax-rss-real-service-')));
  const prefix = `slax-rss-${randomBytes(4).toString('hex')}`;
  const names = {internal: `${prefix}-internal`, gateway: `${prefix}-gateway`, source: `${prefix}-source`, storage: `${prefix}-storage`, service: `${prefix}-sync`};
  const marker = {kind: 'slax-controlled-rss-real-service', version: 1, runId, prefix, apiPort, syncPort, names, networks: [], containers: [], volumes: [], imageIDs, powerSyncImage: PS_IMAGE, postgresImage: PG_IMAGE, syncRulesSHA256: null, powerSyncYamlSHA256: null, schemaMigration: 'pending', publication: 'pending', privateSigningKeyPersisted: false, jwtPersisted: false, sessionValuesPersisted: false, startedAt: new Date().toISOString()};
  const markerPath = path.join(directory, 'service-owner.json');
  const saveMarker = () => writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n');
  saveMarker();
  let api, proxy;
  try {
    const rulesSource = path.join(POWER_SYNC_ROOT, 'sync_rules.yaml');
    const yamlSource = path.join(POWER_SYNC_ROOT, 'powersync.yaml');
    const rules = readFileSync(rulesSource);
    const yaml = readFileSync(yamlSource);
    const configDir = path.join(directory, 'config'); mkdirSync(configDir);
    writeFileSync(path.join(configDir, 'sync_rules.yaml'), rules, {flag: 'wx'});
    writeFileSync(path.join(configDir, 'powersync.yaml'), yaml, {flag: 'wx'});
    marker.syncRulesSHA256 = hash(rules); marker.powerSyncYamlSHA256 = hash(yaml); marker.schemaMigration = 'branch-prisma-postgresql-migrations';
    saveMarker();

    const label = ['--label', `${LABEL}=${runId}`];
    docker(['network', 'create', '--internal', ...label, names.internal]); marker.networks.push(names.internal); saveMarker();
    docker(['network', 'create', ...label, names.gateway]); marker.networks.push(names.gateway); saveMarker();
    for (const [role, name] of [['source', names.source], ['storage', names.storage]]) {
      const volume = `${name}-data`;
      docker(['volume', 'create', ...label, volume]); marker.volumes.push(volume); saveMarker();
      const publish = role === 'source' ? ['-p', '127.0.0.1::5432'] : [];
      const primaryNetwork = role === 'source' ? names.gateway : names.internal;
      docker(['run', '--pull=never', '-d', '--name', name, ...label, '--network', primaryNetwork, ...publish, '--memory', '768m', '--cpus', '1', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_USER=postgres', '-e', 'POSTGRES_DB=postgres', '-v', `${volume}:/var/lib/postgresql/data`, PG_IMAGE, '-c', 'wal_level=logical', '-c', 'max_replication_slots=8', '-c', 'max_wal_senders=8', '-c', 'shared_buffers=96MB']);
      marker.containers.push(name); saveMarker();
      if (role === 'source') docker(['network', 'connect', names.internal, name]);
      await waitFor(() => spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], {timeout: 5000, stdio: 'ignore'}).status === 0, `${role} PostgreSQL`);
    }
    const sourcePorts = JSON.parse(docker(['container', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', names.source]))['5432/tcp'];
    assert(sourcePorts?.length === 1 && sourcePorts[0].HostIp === '127.0.0.1', `Isolated migration port must bind loopback only (mapped addresses: ${JSON.stringify(sourcePorts ?? null)})`);
    const sourcePort = Number(sourcePorts[0].HostPort);
    assert(Number.isInteger(sourcePort) && sourcePort > 0, 'Isolated migration port mapping must be valid');
    marker.sourcePort = sourcePort; saveMarker();
    safeMigration(directory, sourcePort, DB_PASSWORD);
    marker.schemaMigration = 'completed'; saveMarker();
    sql(names.source, "CREATE PUBLICATION powersync FOR ALL TABLES;\n");
    sql(names.source, initialSeedSql());
    const schema = JSON.parse(sql(names.source, `SELECT json_build_object('requiredTables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN (${TABLES.map(literal).join(',')})),'publicationTables',(SELECT count(*) FROM pg_publication_tables WHERE pubname='powersync'));`));
    assert.equal(schema.requiredTables, TABLES.length, 'Real migrated RSS and identity tables must exist');
    assert(schema.publicationTables >= TABLES.length, 'The owned publication must contain the real migrated tables');
    marker.publication = 'powersync-for-all-tables-in-owned-migrated-database'; saveMarker();

    const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
    const jwk = {...publicKey.export({format: 'jwk'}), alg: 'RS256', kid: `rss-${prefix}`};
    const serviceEnv = [
      '-e', 'POWERSYNC_CONFIG_PATH=/config/powersync.yaml',
      '-e', `PS_DATA_SOURCE_URI=postgresql://postgres:${DB_PASSWORD}@${names.source}:5432/postgres`,
      '-e', `PS_STORAGE_POSTGRESQL_URI=postgresql://postgres:${DB_PASSWORD}@${names.storage}:5432/postgres`,
      '-e', 'PS_PORT=8080',
      '-e', `PS_API_TOKEN=${API_ADMIN_TOKEN}`,
      '-e', `PS_JWKS_AUDIENCE=${AUDIENCE}`,
      '-e', `PS_JWK_N=${jwk.n}`,
      '-e', `PS_JWK_E=${jwk.e}`,
      '-e', `PS_JWK_KID=${jwk.kid}`,
    ];
    docker(['create', '--pull=never', '--name', names.service, ...label, '--network', names.gateway, '--memory', '768m', '--cpus', '1', '-e', 'NODE_OPTIONS=--max-old-space-size=640', ...serviceEnv, '-v', `${configDir}:/config:ro`, '-p', '127.0.0.1::8080', PS_IMAGE, 'start', '-r', 'unified']);
    marker.containers.push(names.service); saveMarker();
    docker(['network', 'connect', names.internal, names.service]);
    docker(['start', names.service]);
    verifyDockerOwner('container', names.service, runId);
    const servicePortMapping = JSON.parse(docker(['container', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', names.service]));
    const servicePorts = servicePortMapping['8080/tcp'];
    assert(servicePorts?.length === 1 && servicePorts[0].HostIp === '127.0.0.1', 'PowerSync upstream port must bind loopback only');
    const upstreamPort = Number(servicePortMapping['8080/tcp']?.[0]?.HostPort);
    assert(upstreamPort > 0, 'Owned PowerSync loopback mapping is required');
    await waitFor(async () => {try {return (await fetch(`http://127.0.0.1:${upstreamPort}/probes/readiness`, {signal: AbortSignal.timeout(2000)})).ok;} catch {return false;}}, 'PowerSync with branch RSS sync rules');
    const transport = {syncHttpRequests: 0, websocketUpgrades: 0, clientToServiceBytes: 0, serviceToClientBytes: 0};
    const state = {runId, source: names.source, syncOrigin: `http://127.0.0.1:${syncPort}`, apiOrigin: `http://127.0.0.1:${apiPort}`, upstreamPort, privateKey, keyId: jwk.kid, issuedTokens: 0, transport: {...transport, blockedSyncRequests: 0}, apiAvailable: true, syncAvailable: false, proxy: null, checkpoints: [], operations: [], disconnectRequests: 0};
    api = createApiServer(state); proxy = createSyncProxy(state); trackSockets(api); trackSockets(proxy);
    state.proxy = proxy;
    await listen(proxy, syncPort); state.syncOrigin = `http://127.0.0.1:${syncPort}`;
    await listen(api, apiPort); state.apiOrigin = `http://127.0.0.1:${apiPort}`;
    proxy.on('upgrade', (request, socket, head) => {
      state.transport.websocketUpgrades++;
      if (!state.syncAvailable) {
        state.transport.blockedSyncRequests++;
        socket.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nRetry-After: 1\r\nConnection: close\r\n\r\n');
        return;
      }
      const target = tcpConnect(state.upstreamPort, '127.0.0.1', () => {
        target.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${Object.entries(request.headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
        if (head.length) target.write(head);
        socket.on('data', chunk => {state.transport.clientToServiceBytes += chunk.length;});
        target.on('data', chunk => {state.transport.serviceToClientBytes += chunk.length;});
        socket.pipe(target); target.pipe(socket);
      });
      target.on('error', () => socket.destroy()); socket.on('error', () => target.destroy()); socket.on('close', () => target.destroy());
    });
    state.syncOrigin = `http://127.0.0.1:${syncPort}`;
    state.transport.websocketUpgrades = 0;
    state.apiOrigin = `http://127.0.0.1:${apiPort}`;
    marker.syncOrigin = state.syncOrigin; marker.apiOrigin = state.apiOrigin; marker.upstreamPort = state.upstreamPort;
    marker.migrationCount = JSON.parse(sql(names.source, 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;'));
    marker.storageSchemaMigration = 'PowerSync-owned-storage-database';
    marker.publicJwkSHA256 = hash(JSON.stringify(jwk));
    saveMarker();
    await waitFor(async () => {try {return (await fetch(`${state.syncOrigin}/probes/readiness`, {signal: AbortSignal.timeout(2000)})).ok;} catch {return false;}}, 'PowerSync proxy readiness');

    const status = await fetch(`${state.apiOrigin}/fixture/status`, {headers: {Authorization: fixtureToken('a')}});
    assert.equal(status.status, 200, 'Local fixture controls must be available');
    const initial = (await status.json()).data;
    assert.equal(initial.database.subscriptions.length, 3);
    assert.equal(initial.database.entries.length, 3);
    assert.equal(initial.database.bookmarks, 1);
    assert.equal(initial.database.feeds.length, 2);
    assert.equal(initial.database.publicationTables >= TABLES.length, true);
    const session = await fetch(`${state.apiOrigin}/fixture/session?owner=A`);
    assert.equal(session.status, 200);
    assert.deepEqual((await session.json()).data, {userId: USERS.a.uuid, token: USERS.a.session, owner: 'A'});
    console.log(JSON.stringify({kind: marker.kind, status: 'ready', runId, directory, markerPath, apiOrigin: state.apiOrigin, syncOrigin: state.syncOrigin, userIds: {a: USERS.a.uuid, b: USERS.b.uuid}, rssIds: IDS, migrationCount: marker.migrationCount, configSha256: marker.powerSyncYamlSHA256, syncRulesSha256: marker.syncRulesSHA256, privateSigningKeyPersisted: false, jwtPersisted: false, appSessionValuesPersisted: false}));
    let stopping;
    const stop = () => stopping ??= (async () => {
      await closeServer(api);
      await closeServer(proxy);
      stopOwned(directory);
    })();
    return {directory, marker, apiOrigin: state.apiOrigin, syncOrigin: state.syncOrigin, stop};
  } catch (error) {
    try {await closeServer(api); await closeServer(proxy);} catch {}
    try {stopOwned(directory);} catch {}
    throw error;
  }
}

async function waitFor(check, name) {
  for (let count = 0; count < 90; count++) {if (await check()) return; await pause(1000);}
  throw new Error(`Owned ${name} did not become ready`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === 'start' && args[1] === '--run-id' && args.length === 3) {
    const running = await startOwned(args[2]);
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void running.stop().then(() => process.exit(0), () => {
        process.stderr.write('Owned RSS fixture cleanup failed; retry stop with the recorded ownership marker.\n');
        process.exit(1);
      });
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } else if (args[0] === 'stop' && args[1] === '--directory' && args.length === 3) {
    stopOwned(args[2]); console.log(JSON.stringify({status: 'owned-rss-resources-removed'}));
  } else {
    throw new Error('Use start --run-id <synthetic-id> or stop --directory <owned-temp-directory>');
  }
}
