import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {createServer, request as httpRequest} from 'node:http';
import {connect as tcpConnect} from 'node:net';
import {existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MOBILE_TABLES} from '../../../../src/data/schema.ts';

const PS_IMAGE = 'journeyapps/powersync-service@sha256:413a0c813e96935ebe7203b5759f8a594a7b7cd8aa42134713e63af637e0f079';
const PG_IMAGE = 'postgres@sha256:f02121de6f74d30d8a94cd1d9584125e2178d7e6c377d8130112d4e52d867995';
const LABEL = 'com.slax.native-fixture.owner';
const tables = Object.fromEntries(Object.entries(MOBILE_TABLES).filter(([, value]) => !value.options?.localOnly));
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => value === null ? 'NULL' : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? `'${value.replaceAll("'", "''")}'` : assert.fail('Only primitive synthetic column values are accepted');
const identifier = value => {assert(/^[a-z][a-z0-9_]*$/.test(value), 'Invalid SQL identifier'); return `"${value}"`;};
const fields = table => ['id', ...tables[table].text, ...(tables[table].integer ?? [])];
function metadataPatch(name, value) {
  // The real uploader/API express tags and share enablement as dotted fields.
  // This controlled receiver materializes only those API-supported changes;
  // it never fills other fields from the fixture's desired final row.
  assert(typeof value === 'string', 'A serialized nested value is required');
  const parsed = JSON.parse(value);
  if (name === 'metadata.tags') {
    assert(Array.isArray(parsed) && parsed.length <= 250 && parsed.every(tag => typeof tag === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(tag)), 'Bounded synthetic tags required');
    return {path: '{tags}', value: JSON.stringify(parsed)};
  }
  assert(name === 'metadata.share.is_enable' && typeof parsed === 'boolean', 'Only the API-supported synthetic share enablement is accepted');
  return {path: '{share,is_enable}', value: JSON.stringify(parsed)};
}
export function validateSeed(value) {
  assert(value && Object.keys(value).sort().join(',') === Object.keys(tables).sort().join(','), 'Seed must contain every synchronized source table exactly once');
  for (const [table, rows] of Object.entries(value)) {
    assert(Array.isArray(rows) && rows.length <= 250, 'Bounded synthetic rows are required');
    for (const row of rows) {
      assert(row && /^[a-zA-Z0-9-]{1,128}$/.test(row.id), 'Bounded synthetic row IDs are required');
      for (const [column, entry] of Object.entries(row)) {
        assert(fields(table).includes(column), 'Unknown synthetic column'); quote(entry);
      }
    }
  }
  return value;
}
export function changesSql(changes) {
  assert(Array.isArray(changes) && changes.length > 0 && changes.length <= 150, 'Bounded synchronized changes are required');
  return changes.map(change => {
    assert(tables[change.table] && /^[a-zA-Z0-9-]{1,128}$/.test(change.id) && ['PUT', 'PATCH', 'DELETE'].includes(change.op), 'Unknown synchronized change');
    const table = identifier(change.table), id = quote(change.id);
    if (change.op === 'DELETE') return `DELETE FROM ${table} WHERE id=${id};`;
    assert(change.data && typeof change.data === 'object' && !Array.isArray(change.data), 'Change data is required');
    const entries = Object.entries(change.data);
    const nested = entries.filter(([name]) => name === 'metadata.tags' || name === 'metadata.share.is_enable');
    assert(entries.length && entries.every(([name]) => (fields(change.table).includes(name) && name !== 'id') || nested.some(([key]) => key === name)), 'Unknown or empty change fields');
    if (nested.length) assert(change.op === 'PATCH' && change.table === 'sr_user_bookmark' && !entries.some(([name]) => name === 'metadata'), 'Nested metadata is allowed only for an unambiguous bookmark PATCH');
    if (change.op === 'PATCH') {
      const assignments = entries.filter(([name]) => !nested.some(([key]) => key === name)).map(([name, value]) => `${identifier(name)}=${quote(value)}`);
      if (nested.length) {
        let expression = 'metadata::jsonb';
        for (const [name, value] of nested) {
          const patch = metadataPatch(name, value);
          expression = `jsonb_set(${expression},${quote(patch.path)}::text[],${quote(patch.value)}::jsonb,false)`;
        }
        assignments.push(`metadata=(${expression})::text`);
      }
      return `UPDATE ${table} SET ${assignments.join(',')} WHERE id=${id};`;
    }
    return `INSERT INTO ${table}(id,${entries.map(([name]) => identifier(name)).join(',')}) VALUES(${id},${entries.map(([, value]) => quote(value)).join(',')}) ON CONFLICT(id) DO UPDATE SET ${entries.map(([name]) => `${identifier(name)}=EXCLUDED.${identifier(name)}`).join(',')};`;
  }).join('\n');
}
function command(args, input) {
  const result = spawnSync('docker', args, {input, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024});
  assert.equal(result.status, 0, `Owned Docker command failed (${args[0]}); no configuration or credentials are logged`);
  return result.stdout.trim();
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, name) {for (let count = 0; count < 60; count++) {if (await check()) return; await pause(1000);} throw new Error(`Owned ${name} did not become ready`);}
function verifyOwner(kind, name, runId) {
  const format = kind === 'container' ? `{{index .Config.Labels "${LABEL}"}}` : `{{index .Labels "${LABEL}"}}`;
  assert.equal(command([kind, 'inspect', '--format', format, name]), runId, 'Refuse another task\'s Docker resource');
}
export function stopOwned(directory) {
  const canonical = realpathSync(directory);
  assert(path.dirname(canonical) === realpathSync(tmpdir()) && /^slax-native-real-service-[a-zA-Z0-9]+$/.test(path.basename(canonical)), 'Use only a newly marked controlled service directory');
  const markerPath = path.join(canonical, 'service-owner.json');
  assert(lstatSync(markerPath).isFile() && !lstatSync(markerPath).isSymbolicLink(), 'Missing regular ownership marker');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  assert(marker.kind === 'slax-controlled-native-real-service' && /^[a-zA-Z0-9-]{1,64}$/.test(marker.runId), 'Invalid service ownership marker');
  for (const mapping of marker.reverseMappings ?? []) {
    assert(/^emulator-\d+$/.test(mapping.device) && /^tcp:\d{4,5}$/.test(mapping.source) && mapping.source === mapping.destination && [new URL(marker.apiOrigin).port, new URL(marker.syncOrigin).port].includes(mapping.source.slice(4)), 'Invalid owned emulator mapping');
    const adb = args => {
      const result = spawnSync('adb', ['-s', mapping.device, ...args], {encoding: 'utf8', timeout: 30000});
      assert.equal(result.status, 0, 'Owned emulator mapping command failed'); return result.stdout.trim();
    };
    const existing = adb(['reverse', '--list']).split('\n').map(line => line.trim().split(/\s+/)).find(parts => parts[1] === mapping.source);
    assert(!existing || existing[2] === mapping.destination, 'Refuse to remove a changed emulator mapping');
    if (existing) adb(['reverse', '--remove', mapping.source]);
  }
  for (const name of marker.containers) {assert(name.startsWith(marker.prefix), 'Invalid owned container'); verifyOwner('container', name, marker.runId); command(['rm', '-f', name]);}
  for (const name of marker.volumes) {assert(name.startsWith(marker.prefix), 'Invalid owned volume'); verifyOwner('volume', name, marker.runId); command(['volume', 'rm', name]);}
  const networks = marker.networks ?? [marker.network];
  assert(networks.length >= 1 && networks.length <= 2 && new Set(networks).size === networks.length && networks.includes(`${marker.prefix}-net`), 'Invalid owned networks');
  for (const name of networks) {
    assert([`${marker.prefix}-net`, `${marker.prefix}-gateway`].includes(name), 'Invalid owned network');
    verifyOwner('network', name, marker.runId); command(['network', 'rm', name]);
  }
}
export async function startOwned(runId) {
  assert(/^[a-zA-Z0-9-]{1,64}$/.test(runId ?? ''), 'An explicit bounded synthetic run ID is required');
  const imageIDs = Object.fromEntries([PS_IMAGE, PG_IMAGE].map(image => {
    const id = command(['image', 'inspect', '--format', '{{.Id}}', image]);
    assert(/^sha256:[0-9a-f]{64}$/.test(id), 'The pinned image must already exist locally'); return [image, id];
  }));
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'slax-native-real-service-')));
  const prefix = `slax-native-${randomUUID().slice(0, 8)}`, network = `${prefix}-net`, gateway = `${prefix}-gateway`;
  const source = `${prefix}-source`, storage = `${prefix}-storage`, service = `${prefix}-sync`;
  const marker = {kind: 'slax-controlled-native-real-service', version: 1, runId, prefix, network, networks: [], containers: [], volumes: [], sourceImage: PG_IMAGE, serviceImage: PS_IMAGE, imageIDs, privateKeyPersisted: false, tokensPersisted: false};
  const saveMarker = () => writeFileSync(path.join(directory, 'service-owner.json'), JSON.stringify(marker, null, 2) + '\n');
  saveMarker();
  const owned = ['--label', `${LABEL}=${runId}`];
  command(['network', 'create', '--internal', ...owned, network]);
  marker.networks.push(network); saveMarker();
  command(['network', 'create', ...owned, gateway]);
  marker.networks.push(gateway); saveMarker();
  for (const name of [source, storage]) {
    const volume = `${name}-data`; command(['volume', 'create', ...owned, volume]); marker.volumes.push(volume); saveMarker();
    command(['run', '--pull=never', '-d', '--name', name, ...owned, '--network', network, '--memory', '256m', '--cpus', '0.5', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-v', `${volume}:/var/lib/postgresql/data`, PG_IMAGE, '-c', 'wal_level=logical', '-c', 'max_replication_slots=5', '-c', 'max_wal_senders=5', '-c', 'shared_buffers=32MB']);
    marker.containers.push(name); saveMarker();
    await waitFor(() => spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], {timeout: 5000, stdio: 'ignore'}).status === 0, 'PostgreSQL');
  }
  const psql = (sql, container = source) => command(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], sql);
  psql(Object.entries(tables).map(([table, definition]) => `CREATE TABLE ${identifier(table)}(id text PRIMARY KEY,${[...definition.text.map(name => `${identifier(name)} text`), ...(definition.integer ?? []).map(name => `${identifier(name)} bigint`)].join(',')});`).join('\n') + '\nCREATE PUBLICATION powersync FOR ALL TABLES;\nCREATE TABLE fixture_upload_receipts(sequence bigserial PRIMARY KEY,changes jsonb NOT NULL);');
  // Private RSA material and signed JWTs exist only in this process's closure.
  const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const jwk = {...publicKey.export({format: 'jwk'}), alg: 'RS256', kid: `fixture-${prefix}`};
  // Service 1.26.1 requires a password field even for our isolated trust-only PG instances.
  // This fixed public fixture string grants no access outside these owned, unpublished instances.
  const databaseUri = name => `postgresql://postgres:fixture-NOT-A-REAL-CREDENTIAL@${name}:5432/postgres`;
  const configuration = {replication: {connections: [{type: 'postgresql', uri: databaseUri(source), sslmode: 'disable'}]}, storage: {type: 'postgresql', uri: databaseUri(storage), sslmode: 'disable'}, port: 8080, telemetry: {disable_telemetry_sharing: true}, sync_config: {path: '/config/sync-config.yaml'}, client_auth: {audience: ['slax-controlled-native-fixture'], jwks: {keys: [jwk]}}, api: {}};
  writeFileSync(path.join(directory, 'service.yaml'), JSON.stringify(configuration, null, 2));
  writeFileSync(path.join(directory, 'sync-config.yaml'), JSON.stringify({config: {edition: 3}, streams: {controlled: {auto_subscribe: true, queries: Object.keys(tables).map(table => `SELECT * FROM ${table}`)}}}, null, 2));
  // Docker Desktop does not publish an internal-only network's ports. Only the
  // service joins this new gateway; both PostgreSQL instances stay internal.
  command(['create', '--pull=never', '--name', service, ...owned, '--network', gateway, '--memory', '512m', '--cpus', '1', '-e', 'NODE_OPTIONS=--max-old-space-size=384', '-e', 'POWERSYNC_CONFIG_PATH=/config/service.yaml', '-v', `${directory}:/config:ro`, '-p', '127.0.0.1::8080', PS_IMAGE, 'start', '-r', 'unified']);
  marker.containers.push(service); saveMarker();
  command(['network', 'connect', network, service]);
  command(['start', service]);
  verifyOwner('container', service, runId);
  const ports = JSON.parse(command(['container', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', service]));
  const mapping = ports['8080/tcp']; assert(mapping?.length === 1 && mapping[0].HostIp === '127.0.0.1', 'Only one loopback service port is allowed');
  const targetPort = Number(mapping[0].HostPort);
  await waitFor(async () => {try {return (await fetch(`http://127.0.0.1:${targetPort}/probes/readiness`, {signal: AbortSignal.timeout(2000)})).ok;} catch {return false;}}, 'PowerSync');
  const traffic = {streamHttpRequests: 0, webSocketUpgrades: 0, serverToClientBytes: 0};
  const receipts = {runId, initialized: false, platform: null, rejectedUploads: 0, committedUploads: [], mutations: [], allowUploads: false, traffic};
  const response = (out, data, status = 200) => {out.writeHead(status, {'Content-Type': 'application/json'}); out.end(JSON.stringify({code: status, message: status === 200 ? 'Controlled fixture' : 'Controlled retry', data}));};
  const body = async request => {let data = ''; for await (const chunk of request) {data += chunk; assert(data.length <= 1024 * 1024, 'Bounded synthetic body required');} return data ? JSON.parse(data) : undefined;};
  const token = () => {
    const header = Buffer.from(JSON.stringify({alg: 'RS256', kid: jwk.kid, typ: 'JWT'})).toString('base64url');
    const claims = Buffer.from(JSON.stringify({sub: 'synthetic-user', aud: 'slax-controlled-native-fixture', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url');
    const input = `${header}.${claims}`; return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
  };
  const api = createServer(async (request, out) => {
    try {
      assert(request.headers.authorization === 'Bearer fixture-auth-token-NOT-A-REAL-CREDENTIAL', 'Only the controlled synthetic API identity is accepted');
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      const input = request.method === 'POST' ? await body(request) : undefined;
      if (pathname === '/v1/sync/token') return response(out, {endpoint: marker.syncOrigin, token: token()});
      if (pathname === '/fixture/init') {
        assert(input?.runId === runId && ['android', 'ios'].includes(input.platform) && !receipts.initialized, 'Seed requires one exact fresh fixture');
        validateSeed(input.rows);
        const statements = Object.entries(input.rows).flatMap(([table, rows]) => rows.map(row => `INSERT INTO ${identifier(table)}(${Object.keys(row).map(identifier).join(',')}) VALUES(${Object.values(row).map(quote).join(',')});`));
        psql(`BEGIN;\n${statements.join('\n')}\nCOMMIT;`);
        receipts.initialized = true; receipts.platform = input.platform; return response(out, {seededTables: Object.keys(tables).length});
      }
      assert(receipts.initialized, 'Initialize the exact controlled fixture first');
      if (pathname === '/fixture/status') return response(out, receipts);
      if (pathname === '/fixture/release-uploads') {receipts.allowUploads = true; return response(out, {ready: true});}
      if (pathname === '/v1/sync/changes') {
        changesSql(input);
        if (!receipts.allowUploads) {receipts.rejectedUploads++; return response(out, {status: false}, 503);}
        const sql = changesSql(input);
        psql(`BEGIN;\n${sql}\nINSERT INTO fixture_upload_receipts(changes) VALUES(${quote(JSON.stringify(input))}::jsonb);\nCOMMIT;`);
        receipts.committedUploads.push(input); return response(out, {status: true});
      }
      if (pathname === '/fixture/replicate') {
        assert(/^[a-zA-Z0-9-]{1,128}$/.test(input?.tagId) && typeof input.display === 'string' && input.display.length < 256, 'Known bounded replication row required');
        psql(`UPDATE sr_user_tag SET display=${quote(input.display)} WHERE id=${quote(input.tagId)};`);
        receipts.mutations.push({tagId: input.tagId, display: input.display}); return response(out, {committed: true});
      }
      if (pathname === '/fixture/server-receipts') return response(out, {
        rows: JSON.parse(psql("SELECT coalesce(json_agg(changes ORDER BY sequence),'[]') FROM fixture_upload_receipts;")),
        materializedLegacyRows: Object.fromEntries([['sr_user_tag', 'tag-1'], ['sr_user_bookmark', 'bookmark-1'], ['sr_bookmark_comment', 'comment-1']].map(([table, id]) => [table, JSON.parse(psql(`SELECT coalesce(json_agg(row_to_json(t)),'[]') FROM (SELECT * FROM ${identifier(table)} WHERE id=${quote(id)}) t;`))])),
        replicationSlots: JSON.parse(psql("SELECT coalesce(json_agg(json_build_object('active',active,'confirmedFlushLsn',confirmed_flush_lsn)),'[]') FROM pg_replication_slots;")), traffic,
      });
      response(out, null, 404);
    } catch {response(out, null, 400);}
  });
  const proxy = createServer((request, out) => {
    if (request.url?.startsWith('/sync/')) traffic.streamHttpRequests++;
    const forwarded = httpRequest({host: '127.0.0.1', port: targetPort, path: request.url, method: request.method, headers: request.headers}, upstream => {
      out.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.on('data', chunk => {traffic.serverToClientBytes += chunk.length;}); upstream.pipe(out);
    });
    forwarded.on('error', () => {if (!out.headersSent) out.writeHead(502); out.end();}); request.pipe(forwarded);
  });
  proxy.on('upgrade', (request, socket, head) => {
    traffic.webSocketUpgrades++;
    const target = tcpConnect(targetPort, '127.0.0.1', () => {
      target.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${Object.entries(request.headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (head.length) target.write(head); socket.pipe(target); target.on('data', chunk => {traffic.serverToClientBytes += chunk.length;}); target.pipe(socket);
    });
    target.on('error', () => socket.destroy()); socket.on('error', () => target.destroy()); socket.on('close', () => target.destroy());
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  marker.syncOrigin = `http://127.0.0.1:${proxy.address().port}`; marker.apiOrigin = `http://127.0.0.1:${api.address().port}`;
  marker.serviceConfigSHA256 = hash(readFileSync(path.join(directory, 'service.yaml'))); marker.publicJwkSHA256 = hash(JSON.stringify(jwk)); saveMarker();
  console.log(JSON.stringify({kind: marker.kind, status: 'ready', runId, directory, apiOrigin: marker.apiOrigin, syncOrigin: marker.syncOrigin, images: [PG_IMAGE, PS_IMAGE], privateKeyPersisted: false, tokensPersisted: false}));
  const shutdown = () => {api.close(); proxy.close(); process.exit(0);}; process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  return {directory, marker, receipts};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === 'start' && args[1] === '--run-id' && args.length === 3) await startOwned(args[2]);
  else if (args[0] === 'stop' && args[1] === '--directory' && args.length === 3) {stopOwned(args[2]); console.log(JSON.stringify({status: 'owned-resources-removed'}));}
  else throw new Error('Use start --run-id or stop --directory for this isolated native service fixture');
}
