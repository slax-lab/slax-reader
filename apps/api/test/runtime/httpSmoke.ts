import { createServer } from 'node:net'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { request as nodeRequest } from 'node:http'
import { mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Auth } from '../../src/utils/jwt'
import { Hashid } from '../../src/utils/hashids'
import { ROOT } from '../../script/deploy/dev-local'
import { LocalResources } from './localResources'
import { API_ROOT } from '../../script/root'

let httpPort = 8787

const localFetch = (url: string, options: RequestInit = {}) =>
  new Promise<Response>((done, reject) => {
    const target = new URL(url)
    assert.equal(target.origin, `http://localhost:${httpPort}`)
    const headers = Object.fromEntries(new Headers(options.headers).entries())
    const req = nodeRequest(
      {
        hostname: '127.0.0.1',
        port: httpPort,
        agent: false,
        path: target.pathname + target.search,
        method: options.method ?? 'GET',
        headers: { ...headers, host: `localhost:${httpPort}` },
        timeout: 10000
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          try {
            const responseHeaders = new Headers()
            for (const [name, value] of Object.entries(res.headers)) {
              for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(name, item)
            }
            const noBody = options.method === 'HEAD' || [204, 205, 304].includes(res.statusCode ?? 200)
            done(new Response(noBody ? null : Buffer.concat(chunks), { status: res.statusCode, headers: responseHeaders }))
          } catch (error) {
            reject(error)
          }
        })
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Local HTTP request timed out')))
    req.end(options.body)
  })

async function main() {
  const resources = new LocalResources()
  const evidence: Record<string, unknown> = {}
  let worker: ChildProcess | undefined
  let workerLog = ''
  const state = resolve(resources.workspace, 'state')
  const coreConfig = resolve(resources.workspace, 'core.json')
  const edgeConfig = resolve(resources.workspace, 'edge.json')
  const localPath = (path: string) => relative(resources.workspace, resolve(ROOT, path))
  mkdirSync(state)
  const d1Args = ['--config', coreConfig, '--local', '--env-file', resources.emptyEnv, '--persist-to', state]
  const d1 = (binding: string, sql: string) => {
    const output = resources.command('pnpm', ['exec', 'wrangler', 'd1', 'execute', binding, ...d1Args, '--command', sql, '--json'])
    const result = JSON.parse(output) as { success: boolean; results: Record<string, unknown>[] }[]
    assert.ok(
      result.every(item => item.success),
      output
    )
    return result.flatMap(item => item.results)
  }
  const poll = async (check: () => boolean | Promise<boolean>, description: string) => {
    for (let i = 0; i < 60; i++) {
      if (await check()) return
      await delay(500)
    }
    throw new Error(`Timed out: ${description}`)
  }
  const request = async (label: string, path: string, options: RequestInit = {}) => {
    const response = await localFetch(`http://localhost:${httpPort}${path}`, { ...options, signal: AbortSignal.timeout(10000) })
    const body = (await response.json()) as { code: number; data: any; message?: string }
    evidence[label] = { status: response.status, body }
    console.log(`${label}: HTTP ${response.status} ${JSON.stringify(body)}`)
    return { status: response.status, body }
  }
  try {
    // Optional offline Corepack cache seed contains only the public package-manager distribution.
    if (process.argv[2] === '--corepack-archive' && process.argv[3]) resources.command('corepack', ['install', '--global', '--cache-only', resolve(process.argv[3])])
    resources.command('pnpm', ['exec', 'wrangler', '--version'])
    httpPort = await new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') return reject(new Error('Cannot allocate HTTP test port'))
        server.close(error => (error ? reject(error) : resolve(address.port)))
      })
    })
    const pg = await resources.container('postgres:17-alpine')
    for (const database of ['http_reader', 'http_logs']) resources.sql(pg.id, 'postgres', `CREATE DATABASE ${database};`)
    const url = (database: string) => `postgresql://postgres:isolated@127.0.0.1:${pg.port}/${database}`
    const vars = {
      RUN_ENV: 'development',
      RUN_TYPE: 'dev',
      NEWSLETTER_ENABLED: 'true',
      NEWSLETTER_DOMAIN: 'slax.dev',
      IMAGER_CHECK_DIGST_SALT: 'isolated-newsletter-images',
      JWT_ALGORITHMS: 'HS256',
      JWT_EXPIRES: '3600',
      JWT_ISSUER: 'isolated-http-smoke',
      JWT_SECRET_TEXT: randomUUID() + randomUUID(),
      HASH_IDS_SALT: randomUUID(),
      EDGE_SHARED_SECRET: randomUUID(),
      FRONT_END_URL: 'https://reader.smoke.invalid',
      BACKEND_API_PREFIX: `http://localhost:${httpPort}`,
      IMAGE_PREFIX: `http://localhost:${httpPort}`,
      PROXY_IMAGE_PREFIX: `http://localhost:${httpPort}`
    }
    const shared = {
      tsconfig: localPath('apps/api/tsconfig.json'),
      compatibility_date: '2025-05-05',
      compatibility_flags: ['nodejs_compat_v2', 'global_fetch_strictly_public'],
      vars,
      rules: [{ type: 'CompiledWasm', globs: ['**/*.wasm'], fallthrough: true }]
    }
    writeFileSync(
      coreConfig,
      JSON.stringify(
        {
          ...shared,
          name: 'root-tooling-local-core',
          main: localPath('apps/api/src/entry/core/index.ts'),
          hyperdrive: [
            { binding: 'HYPERDRIVE', id: '00000000000000000000000000000002', localConnectionString: url('http_reader') },
            { binding: 'HYPERDRIVE_LOGS', id: '00000000000000000000000000000003', localConnectionString: url('http_logs') }
          ],
          d1_databases: [
            { binding: 'DB', database_name: 'http-reader', database_id: '00000000-0000-0000-0000-000000000001', migrations_dir: localPath('apps/api/prisma/d1_migrations') },
            {
              binding: 'DB_FULLTEXT',
              database_name: 'http-fulltext',
              database_id: '00000000-0000-0000-0000-000000000002',
              migrations_dir: localPath('apps/api/prisma/d1_migrations/fulltext')
            }
          ],
          kv_namespaces: [{ binding: 'KV', id: '00000000000000000000000000000001' }],
          r2_buckets: [{ binding: 'OSS', bucket_name: 'http-reader' }],
          durable_objects: { bindings: [{ name: 'WEBSOCKET_SERVER', class_name: 'SlaxWebSocketServer' }] },
          migrations: [{ tag: 'v1', new_classes: ['SlaxWebSocketServer'] }]
        },
        null,
        2
      )
    )
    writeFileSync(
      edgeConfig,
      JSON.stringify(
        {
          ...shared,
          name: 'root-tooling-local-edge',
          main: localPath('apps/api/src/entry/edge/index.ts'),
          services: [{ binding: 'CORE', service: 'root-tooling-local-core' }],
          hyperdrive: [
            { binding: 'HYPERDRIVE', id: '00000000000000000000000000000002', localConnectionString: url('http_reader') },
            { binding: 'HYPERDRIVE_LOGS', id: '00000000000000000000000000000003', localConnectionString: url('http_logs') }
          ],
          r2_buckets: [{ binding: 'OSS', bucket_name: 'http-reader' }],
          ratelimits: [{ name: 'BOOKMARK_ADD_RATE_LIMITER', namespace_id: '1001', simple: { limit: 30, period: 60 } }]
        },
        null,
        2
      )
    )
    const pgStatus = await resources.migrate('migrate-pgsql', url('http_reader'), 'pgsql')
    const logsStatus = await resources.migrate('migrate-logs', url('http_logs'), 'logs')
    const d1Statuses = []
    for (const binding of ['DB', 'DB_FULLTEXT'])
      d1Statuses.push(await resources.run(`migrate-${binding}`, 'pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', binding, ...d1Args]))
    evidence.migrations = { pgsql: pgStatus, logs: logsStatus, d1: d1Statuses }
    assert.ok(
      [pgStatus, logsStatus, ...d1Statuses].every(status => status === 0),
      'Historical migrations failed; HTTP CRUD is blocked, never substitute db push or omit migrations'
    )
    resources.sql(
      pg.id,
      'http_reader',
      `
      INSERT INTO sr_user (id,email,name,last_login_at,created_at) VALUES (1,'saver@smoke.invalid','Saver',now(),now()),(2,'owner@smoke.invalid','Owner',now(),now());
      SELECT setval(pg_get_serial_sequence('sr_user','id'),2);
      INSERT INTO sr_bookmark (id,title,target_url,host_url,status,created_at,updated_at,published_at) VALUES (1,'Isolated HTTP source','https://example.invalid/http-source','example.invalid','success',now(),now(),now());
      SELECT setval(pg_get_serial_sequence('sr_bookmark','id'),1);
      INSERT INTO sr_user_bookmark (user_id,bookmark_id,updated_at) VALUES (2,1,now());
      INSERT INTO sr_bookmark_share (user_id,bookmark_id,share_code) VALUES (2,1,'SmokeA1');
    `
    )
    const token = await new Auth(vars as Env).sign({ id: String(new Hashid(vars as Env).encodeId(1)), email: 'saver@smoke.invalid', lang: 'en' })
    // Use the loader API: the tsx CLI IPC socket exceeds macOS path limits in long worktrees.
    const toolchain = resolve(resources.workspace, 'toolchain')
    mkdirSync(toolchain)
    const version = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
      .packageManager.split('@')
      .at(-1)
      .split('+')[0]
    const cachedPnpm = resolve(resources.home, 'cache/node/corepack/v1/pnpm', version, 'bin/pnpm.cjs')
    if (process.argv[2] === '--corepack-archive') symlinkSync(cachedPnpm, resolve(toolchain, 'pnpm'))
    worker = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        'script/deploy/dev-local.ts',
        '--edge-config',
        edgeConfig,
        '--core-config',
        coreConfig,
        '--state',
        state,
        '--env-file',
        resources.emptyEnv,
        '--port',
        String(httpPort)
      ],
      {
        cwd: API_ROOT,
        env: { ...resources.env, PATH: toolchain + ':' + resources.env.PATH, TSX_TSCONFIG_PATH: resolve(API_ROOT, 'tsconfig.json'), SLAX_API_INHERIT_PROCESS_GROUP: '1' },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    if (worker.pid) resources.ownProcessGroup(worker.pid)
    worker.stdout?.on('data', chunk => {
      workerLog += chunk
    })
    worker.stderr?.on('data', chunk => {
      workerLog += chunk
    })
    worker.on('error', error => {
      workerLog += String(error)
    })
    await poll(async () => {
      if (worker!.exitCode !== null) throw new Error(`Worker exited: ${workerLog}`)
      try {
        const response = await localFetch(`http://localhost:${httpPort}/v1/bookmark/list?page=1&size=20`)
        if (response.status === 401) {
          evidence.readiness = 'ready'
          return true
        }
        evidence.readiness = { status: response.status, body: await response.text() }
        return false
      } catch (error) {
        evidence.readiness = String(error)
        return false
      }
    }, 'local Edge ready')
    for (const origin of [vars.FRONT_END_URL, vars.FRONT_END_URL + '.attacker.invalid']) {
      const response = await localFetch(`http://localhost:${httpPort}/events`, { method: 'OPTIONS', headers: { Origin: origin } })
      assert.equal(response.status, 204)
      assert.equal(response.headers.get('Access-Control-Allow-Credentials'), origin === vars.FRONT_END_URL ? 'true' : null)
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin === vars.FRONT_END_URL ? origin : '*')
    }
    evidence.customFrontendCors = 'exact configured origin allowed; attacker suffix rejected'
    // Exercise actual Edge email dispatch, generated DI/router, Prisma transactions and local R2.
    const mailHeaders = { Authorization: `Bearer ${token}` }
    assert.equal(
      (
        await request('newsletter-account', '/v1/user/setting', {
          method: 'POST',
          headers: { ...mailHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'account', value: 'newsletter-smoke' })
        })
      ).body.code,
      200
    )
    assert.equal(
      (
        await request('newsletter-enable', '/v1/user/setting/enable', {
          method: 'POST',
          headers: { ...mailHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'lab:newsletter' })
        })
      ).body.code,
      200
    )
    const address = await request('newsletter-address', '/v1/user/newsletter_address', { method: 'POST', headers: mailHeaders })
    assert.equal(address.body.data.address, 'newsletter-smoke@slax.dev')
    const rawMail =
      'From: Smoke Weekly <weekly@example.com>\r\nTo: ignored@other.example\r\nSubject: Newsletter runtime smoke\r\nMessage-ID: <newsletter-runtime-smoke@example.com>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Runtime newsletter body</p><script>throw 1</script><img src="cid:part">'
    for (let repeat = 0; repeat < 2; repeat++) {
      const response = await localFetch(`http://localhost:${httpPort}/cdn-cgi/local/email?from=bounce%40example.com&to=newsletter-smoke%40slax.dev`, {
        method: 'POST',
        headers: { 'Content-Type': 'message/rfc822' },
        body: rawMail
      })
      assert.equal(response.status, 200, await response.text())
    }
    await poll(() => resources.sql(pg.id, 'http_reader', "SELECT count(*) FROM sr_newsletter_receipt WHERE state='done'") === '1', 'newsletter publication')
    const feed = await request('newsletter-feed', '/v1/feed/entries', { headers: mailHeaders })
    assert.equal(feed.body.data.items.length, 1)
    assert.equal(feed.body.data.items[0].kind, 'newsletter')
    const entryId = feed.body.data.items[0].id
    const detail = await request('newsletter-body', `/v1/feed/entries/${entryId}`, { headers: mailHeaders })
    assert.ok(detail.body.data.content_html.includes('Runtime newsletter body'))
    assert.ok(!/script|cid:/.test(detail.body.data.content_html))
    const subscriptions = await request('newsletter-sources', '/v1/feed/subscriptions', { headers: mailHeaders })
    assert.equal(subscriptions.body.data.items[0].kind, 'newsletter')
    const disabled = await request('newsletter-disable', '/v1/user/setting/disable', {
      method: 'POST',
      headers: { ...mailHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'lab:newsletter' })
    })
    assert.equal(disabled.body.code, 200)
    assert.equal((await request('newsletter-hidden', '/v1/feed/entries', { headers: mailHeaders })).body.data.items.length, 0)
    assert.equal((await request('newsletter-denied', `/v1/feed/entries/${entryId}`, { headers: mailHeaders })).body.code, 404)
    const rejection = await localFetch(`http://localhost:${httpPort}/cdn-cgi/local/email?from=bounce%40example.com&to=unknown%40slax.dev`, {
      method: 'POST',
      headers: { 'Content-Type': 'message/rfc822' },
      body: rawMail
    })
    evidence.newsletterRejection = { status: rejection.status, body: await rejection.text() }
    assert.equal(resources.sql(pg.id, 'http_reader', 'SELECT count(*) FROM sr_newsletter_receipt'), '1')
    evidence.newsletterRuntime = 'actual local Edge email twice -> one receipt/entry; R2 body through Core; disabled reads denied; unknown recipient creates no receipt'

    const listPath = '/v1/bookmark/list?page=1&size=20'
    for (const [label, headers] of [
      ['unauthorized', {}],
      ['invalid-token', { Authorization: 'Bearer invalid' }],
      [
        'spoofed-edge-identity',
        {
          'x-slax-edge-secret': vars.EDGE_SHARED_SECRET,
          'x-slax-edge-identity': btoa(JSON.stringify({ deId: 1, enId: 1, email: 'saver@smoke.invalid', lang: 'en', audience: 'reader' }))
        }
      ]
    ] as [string, Record<string, string>][]) {
      const response = await request(label, listPath, { headers })
      assert.equal(response.status, 401)
      assert.equal(response.body.code, 401)
    }
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const before = await request('list-before', listPath, { headers })
    assert.equal(before.status, 200)
    assert.equal(before.body.code, 200)
    assert.deepEqual(before.body.data, [])
    const targetUrl = `${vars.FRONT_END_URL}/s/SmokeA1`
    const added = await request('bookmark-add', '/v1/bookmark/add', {
      method: 'POST',
      headers,
      body: JSON.stringify({ target_url: targetUrl, target_title: 'Smoke', content: '', tags: [] })
    })
    assert.equal(added.status, 200)
    assert.equal(added.body.code, 200)
    const encodedId = added.body.data.bmId
    assert.ok(Number.isSafeInteger(encodedId) && encodedId > 0)
    const id = new Hashid(vars as Env, 1).decodeId(encodedId)
    assert.ok(Number.isSafeInteger(id) && id > 1)
    const stored = JSON.parse(
      resources.sql(
        pg.id,
        'http_reader',
        `SELECT row_to_json(b) FROM (SELECT ub.user_id,ub.type,b.title,b.target_url FROM sr_user_bookmark ub JOIN sr_bookmark b ON b.id=ub.bookmark_id WHERE ub.user_id=1 AND ub.bookmark_id=${id}) b`
      )
    )
    assert.deepEqual(stored, { user_id: 1, type: 1, title: 'Isolated HTTP source', target_url: targetUrl })
    evidence.pgAfterAdd = stored
    assert.equal(d1('DB_FULLTEXT', `SELECT count(*) AS n FROM slax_user_bookmark WHERE user_id=1 AND bookmark_id=${id}`)[0].n, 1)
    assert.equal(d1('DB', `SELECT count(*) AS n FROM slax_user_bookmark_change WHERE user_id=1 AND bookmark_id=${id} AND action='add'`)[0].n, 1)
    const listed = await request('bookmark-list', listPath, { headers })
    assert.equal(listed.status, 200)
    assert.equal(listed.body.code, 200)
    assert.ok(JSON.stringify(listed.body.data).includes(targetUrl))
    await poll(
      () =>
        resources.sql(
          pg.id,
          'http_logs',
          `SELECT count(*) FROM user_logs WHERE user_id=1 AND event_name='bookmark_add' AND extra_data->>'bookmark_id'='${id}' AND extra_data->>'status'='success'`
        ) === '1',
      'bookmark_add log persisted'
    )
    evidence.logsBookmarkAdd = 'one persisted success event for the created bookmark'
    const deleted = await request('bookmark-delete', '/v1/bookmark/del', { method: 'POST', headers, body: JSON.stringify({ bookmark_id: encodedId }) })
    assert.equal(deleted.status, 200)
    assert.equal(deleted.body.code, 200)
    await poll(() => resources.sql(pg.id, 'http_reader', `SELECT count(*) FROM sr_user_bookmark WHERE user_id=1 AND bookmark_id=${id}`) === '0', 'PG relation deleted')
    await poll(() => resources.sql(pg.id, 'http_reader', `SELECT count(*) FROM sr_bookmark WHERE id=${id}`) === '0', 'private PG bookmark deleted')
    evidence.pgAfterDelete = { relationCount: 0, bookmarkCount: 0 }
    assert.equal(d1('DB_FULLTEXT', `SELECT count(*) AS n FROM slax_user_bookmark WHERE user_id=1 AND bookmark_id=${id}`)[0].n, 0)
    const changes = d1('DB', `SELECT action FROM slax_user_bookmark_change WHERE user_id=1 AND bookmark_id=${id} ORDER BY id`)
    assert.deepEqual(changes, [{ action: 'add' }, { action: 'delete' }])
    evidence.d1Changes = changes
    evidence.d1Fulltext = { afterAdd: 1, afterDelete: 0 }
    assert.equal(resources.sql(pg.id, 'http_reader', "SELECT count(*) FROM sr_bookmark_share WHERE user_id=2 AND bookmark_id=1 AND share_code='SmokeA1'"), '1')
    assert.equal(resources.sql(pg.id, 'http_reader', 'SELECT count(*) FROM sr_user_bookmark WHERE user_id=2 AND bookmark_id=1'), '1')
    const after = await request('list-after-delete', listPath, { headers })
    assert.equal(after.status, 200)
    assert.equal(after.body.code, 200)
    assert.deepEqual(after.body.data, [])
    evidence.sourceShareRetained = true
    evidence.status = 'passed'
  } catch (error) {
    evidence.status = 'failed'
    evidence.error = String(error)
    console.error(error)
    console.error(workerLog.slice(-16000))
    process.exitCode = 1
  } finally {
    if (worker?.pid) {
      try {
        process.kill(-worker.pid, 'SIGTERM')
      } catch {
        /* already exited */
      }
      await delay(1000)
      try {
        process.kill(-worker.pid, 'SIGKILL')
      } catch {
        /* already exited */
      }
    }
    resources.cleanup()
    writeFileSync(resolve(resources.workspace, 'worker.log'), workerLog)
    writeFileSync(resolve(resources.workspace, 'http-results.json'), JSON.stringify(evidence, null, 2))
    console.log(`HTTP acceptance: ${evidence.status}`)
    console.log(JSON.stringify(evidence, null, 2))
    resources.removeWorkspace()
  }
}
void main()
