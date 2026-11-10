import { createServer } from 'node:net'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { request as nodeRequest } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Auth } from '../../src/utils/jwt'
import { Hashid } from '../../src/utils/hashids'
import { ROOT } from '../../script/deploy/dev-local'
import { LocalResources } from './localResources'
import { prepareForkSmoke } from './forkSmoke'
import { startEmailRedisFixture } from './emailRedisFixture'

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
  if (process.env.DOCKER_HOST) {
    assert.ok(process.env.DOCKER_HOST.startsWith('unix://'), 'Only a local Docker socket is allowed')
    resources.env.DOCKER_HOST = process.env.DOCKER_HOST
  }
  // macOS Unix socket paths are limited to 104 bytes; worktree paths can exceed it.
  const ipcTemp = mkdtempSync(resolve(tmpdir(), 'slax-http-'))
  resources.env.TMPDIR = ipcTemp
  const evidence: Record<string, unknown> = {}
  let worker: ChildProcess | undefined
  let workerLog = ''
  let forks: Awaited<ReturnType<typeof prepareForkSmoke>> | undefined
  let emailRedis: Awaited<ReturnType<typeof startEmailRedisFixture>> | undefined
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
    if (process.env.EMAIL_AUTH_HTTP_SMOKE === '1') emailRedis = await startEmailRedisFixture()
    for (const database of ['http_reader', 'http_logs']) resources.sql(pg.id, 'postgres', `CREATE DATABASE ${database};`)
    const url = (database: string) => `postgresql://postgres:isolated@127.0.0.1:${pg.port}/${database}`
    const vars = {
      RUN_ENV: 'development',
      RUN_TYPE: 'dev',
      JWT_ALGORITHMS: 'HS256',
      JWT_EXPIRES: '3600',
      JWT_ISSUER: 'isolated-http-smoke',
      JWT_SECRET_TEXT: randomUUID() + randomUUID(),
      DIAGNOSTIC_DOWNLOAD_SECRET: randomUUID() + randomUUID(),
      HASH_IDS_SALT: randomUUID(),
      EDGE_SHARED_SECRET: randomUUID(),
      FRONT_END_URL: 'https://reader.smoke.invalid',
      BACKEND_API_PREFIX: `http://localhost:${httpPort}`,
      IMAGE_PREFIX: `http://localhost:${httpPort}`,
      PROXY_IMAGE_PREFIX: `http://localhost:${httpPort}`,
      ...(emailRedis
        ? {
            EMAIL_AUTH_HMAC_SECRET: randomUUID() + randomUUID(),
            RESEND_API_KEY: 'fixture-only',
            UPSTASH_REDIS_REST_URL: emailRedis.url,
            UPSTASH_REDIS_REST_TOKEN: 'fixture-only'
          }
        : {})
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
          name: `root-tooling-${httpPort}-core`,
          main: localPath('apps/api/test/runtime/diagnosticWorker.ts'),
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
          r2_buckets: [
            { binding: 'OSS', bucket_name: 'http-reader' },
            { binding: 'DIAGNOSTICS', bucket_name: 'http-diagnostics' }
          ],
          workflows: [{ binding: 'CRAWL_WORKFLOW', name: 'fork-smoke-crawl', class_name: 'CrawlWorkflow', script_name: `root-tooling-${httpPort}-edge` }],
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
          ...JSON.parse(readFileSync(coreConfig, 'utf8')),
          name: `root-tooling-${httpPort}-edge`,
          workflows: [{ binding: 'CRAWL_WORKFLOW', name: 'fork-smoke-crawl', class_name: 'CrawlWorkflow' }],
          main: localPath('apps/api/src/entry/edge/index.ts'),
          services: [{ binding: 'CORE', service: `root-tooling-${httpPort}-core` }],
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
    if (process.env.FORK_SMOKE === '1') forks = await prepareForkSmoke(resources, pg.id, state, url('http_reader'), `root-tooling-${httpPort}-edge`)
    const token = await new Auth(vars as Env).sign({ id: String(new Hashid(vars as Env).encodeId(1)), email: 'saver@smoke.invalid', lang: 'en' })
    worker = spawn(
      'pnpm',
      ['api', '--', 'dev:local', '--edge-config', edgeConfig, '--core-config', coreConfig, '--state', state, '--env-file', resources.emptyEnv, '--port', String(httpPort)],
      {
        cwd: ROOT,
        env: { ...resources.env, SLAX_API_INHERIT_PROCESS_GROUP: '1', SLAX_API_DIAGNOSTIC_HTTP_FIXTURE: '1' },
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
    let coreReady = 0
    await poll(async () => {
      try {
        const response = await localFetch(`http://localhost:${httpPort}/v1/bookmark/list?page=1&size=20`, { headers: { Authorization: `Bearer ${token}` } })
        const data = (await response.json()) as { code?: number }
        coreReady = response.status === 200 && data.code === 200 ? coreReady + 1 : 0
        if (coreReady < 3) await delay(500)
        return coreReady >= 3
      } catch {
        coreReady = 0
        return false
      }
    }, 'authenticated Core database ready')
    if (emailRedis) {
      const authCall = async (path: string, body?: object, bearer?: string, runType: 'dev' | 'beta' | 'prod' = 'dev') => {
        const response = await localFetch(`http://localhost:${httpPort}${path}`, {
          method: body ? 'POST' : 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Fixture-Email-Run-Type': runType,
            'X-Device-ID': 'email-http-smoke',
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {})
          },
          body: body ? JSON.stringify(body) : undefined
        })
        return response.json() as Promise<{ code: number; data: any }>
      }
      const prove = async (purpose: 'login' | 'bind', email: string, bearer?: string, runType: 'dev' | 'beta' | 'prod' = 'dev') => {
        const sent = await authCall('/v1/user/login/email/send', { email, purpose }, bearer, runType)
        assert.equal(sent.code, 200, JSON.stringify(sent))
        const { request_id } = sent.data
        const fixture = await localFetch(`http://localhost:${httpPort}/__fixture/email-code?id=${request_id}`, { headers: { Authorization: `Bearer ${token}` } })
        const code = await fixture.json()
        assert.match(String(code), /^\d{6}$/)
        return authCall(purpose === 'login' ? '/v1/user/login' : '/v1/user/bind', { type: 'email', email, request_id, code }, bearer, runType)
      }
      const userInfo = '/v1/user/userinfo'
      assert.equal((await authCall(userInfo)).code, 401)
      assert.equal((await authCall('/v1/user/login/email/send', { email: 'owner@smoke.invalid', purpose: 'bind' })).code, 401)
      assert.equal((await authCall('/v1/user/bind', { type: 'email' })).code, 401)
      assert.equal((await authCall(userInfo, undefined, token)).data.login_identities.show_email_binding, true)
      const provider = await authCall('/v1/user/bind_link', { platform: 'google', client_platform: 'web' }, token)
      assert.equal(provider.code, 200)
      assert.match(provider.data.state, /^link\./)
      assert.match(provider.data.nonce, /^[0-9a-f]{64}$/)
      assert.equal((await prove('login', 'owner@smoke.invalid')).data, 'EMAIL_AUTH_USE_EXISTING_LOGIN')
      const ownerToken = await new Auth(vars as Env).sign({
        id: String(new Hashid(vars as Env).encodeId(2)),
        email: 'owner@smoke.invalid',
        lang: 'en'
      })
      for (const runType of ['beta', 'prod'] as const) {
        assert.equal((await authCall(userInfo, undefined, ownerToken, runType)).data.login_identities.show_email_binding, false)
        const binding = await prove('bind', 'rollout-owner@smoke.invalid', ownerToken, runType)
        assert.equal(binding.code, 200)
        assert.deepEqual(binding.data, { email: 'rollout-owner@smoke.invalid' })
      }
      assert.deepEqual((await prove('bind', 'saver@smoke.invalid', token)).data, { email: 'saver@smoke.invalid' })
      const returning = await prove('login', 'Saver@SMOKE.INVALID')
      assert.equal(returning.code, 200)
      assert.equal(returning.data.user_id, String(new Hashid(vars as Env).encodeId(1)))
      assert.equal(returning.data.is_new_user, false)
      const fresh = await prove('login', 'new-reader@smoke.invalid')
      assert.equal(fresh.code, 200)
      assert.equal(fresh.data.is_new_user, true)
      assert.equal((await authCall(userInfo, undefined, fresh.data.token)).data.login_identities.email, 'new-reader@smoke.invalid')
      evidence.emailAuthentication = 'binding API works in dev, beta, and prod with a dev-only UI hint; legacy sign-in guidance, existing-account login, and new-account session'
    }
    for (const origin of [vars.FRONT_END_URL, vars.FRONT_END_URL + '.attacker.invalid']) {
      const response = await localFetch(`http://localhost:${httpPort}/events`, { method: 'OPTIONS', headers: { Origin: origin } })
      assert.equal(response.status, 204)
      assert.equal(response.headers.get('Access-Control-Allow-Credentials'), origin === vars.FRONT_END_URL ? 'true' : null)
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin === vars.FRONT_END_URL ? origin : '*')
    }
    evidence.customFrontendCors = 'exact configured origin allowed; attacker suffix rejected'
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
    if (forks)
      evidence.fork = await forks.exercise(
        (path, init) => localFetch(`http://localhost:${httpPort}${path}`, init),
        headers,
        vars.FRONT_END_URL,
        id => new Hashid(vars as Env, 1).encodeId(id)
      )
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
    const { exerciseDiagnosticFeedback } = await import('./diagnosticSmoke')
    evidence.diagnostics = await exerciseDiagnosticFeedback(
      (path, options) => localFetch(`http://localhost:${httpPort}${path}`, options),
      headers,
      query => resources.sql(pg.id, 'http_reader', query),
      vars.DIAGNOSTIC_DOWNLOAD_SECRET,
      () => workerLog,
      async key => (await (await localFetch(`http://localhost:${httpPort}/__fixture/diagnostic-object-missing?key=${encodeURIComponent(key)}`, { headers })).json()) as boolean
    )
    if (emailRedis) {
      assert.equal(resources.sql(pg.id, 'http_reader', "SELECT count(*) FROM sr_platform_bind WHERE user_id=1 AND platform='mail'"), '1')
      evidence.deletedEmailReservation = 'account cleanup kept the verified mailbox reservation'
    }
    const admissions = (await (await localFetch(`http://localhost:${httpPort}/__fixture/vector-maintenance-admissions`, { headers })).json()) as {
      target: { kind: string; id: number; userId?: number; preference?: string }
    }[]
    assert.ok(admissions.some(({ target }) => target.kind === 'article' && target.userId === 1 && target.id === id))
    assert.ok(admissions.some(({ target }) => target.kind === 'user' && target.id === 1 && target.preference === 'article'))
    evidence.vectorMaintenance = { boundary: 'admission-only fixture; no model or Vectorize execution', count: admissions.length, ownerSpecificDeletion: true }
    evidence.status = 'passed'
  } catch (error) {
    evidence.status = 'failed'
    evidence.error = String(error)
    const beforeCleanup = workerLog.slice(-20000)
    console.error('HTTP_PRE_TERMINATION_EVIDENCE_BEGIN')
    console.error(beforeCleanup)
    console.error('HTTP_PRE_TERMINATION_EVIDENCE_END')
    console.error(error)
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
    await forks?.dispose()
    await emailRedis?.dispose()
    resources.cleanup()
    writeFileSync(resolve(resources.workspace, 'worker.log'), workerLog)
    writeFileSync(resolve(resources.workspace, 'http-results.json'), JSON.stringify(evidence, null, 2))
    if (evidence.status === 'failed') console.error(workerLog.slice(-16000))
    console.log(`HTTP acceptance: ${evidence.status}`)
    console.log(JSON.stringify(evidence, null, 2))
    resources.removeWorkspace()
    rmSync(ipcTemp, { recursive: true, force: true })
  }
}
void main()
