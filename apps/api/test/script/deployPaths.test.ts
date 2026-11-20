import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { parse, stringify, type TomlTable } from 'smol-toml'
import { afterEach, describe, expect, test } from 'vitest'
import {
  API_ROOT,
  ROOT,
  TARGETS,
  readConfig,
  workerConfig,
  writeGenerated,
  checkDeployment,
  checkRemote,
  queueMapping,
  selectEnvironment,
  workerNames,
  DATABASE_REGION,
  type ApiConfig,
  type McpPhase
} from '../../script/deploy/config'

const template = path.join(ROOT, 'deploy/cloudflare/api.toml.example')
const temps: string[] = []
function directory() {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'slax-api-config-test-'))
  temps.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('single API configuration', () => {
  test.each(['2024-08-06', '2025-05-05'])('preserves request cancellation for Edge and Core at %s', compatibilityDate => {
    const config = readConfig(template)
    config.compatibility_date = compatibilityDate
    expect(config.compatibility_flags).toContain('enable_request_signal')
    const dir = directory()
    for (const local of [false, true]) {
      for (const target of ['core', 'edge'] as const) {
        const filename = writeGenerated(config, target, dir, local)
        const output = parse(fs.readFileSync(filename, 'utf8'))
        expect(output.compatibility_date).toBe(compatibilityDate)
        expect(output.compatibility_flags).toEqual(config.compatibility_flags)
        expect(output.compatibility_flags).toContain('enable_request_signal')
        expect(output.compatibility_flags).not.toContain('disable_request_signal')
      }
    }
  })
  test('diagnostic bindings stay private to responsible Workers and disable URL capture', () => {
    const config = readConfig(template)
    ;(config.vars as TomlTable).DIAGNOSTIC_DOWNLOAD_SECRET = 'synthetic-test-secret'
    for (const target of TARGETS) {
      const output = workerConfig(config, target)
      const buckets = (output.r2_buckets ?? []) as TomlTable[]
      expect(buckets.some(bucket => bucket.binding === 'DIAGNOSTICS')).toBe(target === 'core')
      expect((output.vars as TomlTable).DIAGNOSTIC_DOWNLOAD_SECRET).toBe(target === 'core' ? 'synthetic-test-secret' : undefined)
      if (['core', 'edge'].includes(target)) {
        expect(output.observability).toMatchObject({ logs: { invocation_logs: false }, traces: { enabled: false } })
      }
    }
  })
  test('fails when the configured file is missing instead of deploying an example', () => {
    expect(() => readConfig(path.join(directory(), 'api.toml'))).toThrow('configuration is missing')
  })
  test('every target resolves app source, tsconfig and historical D1 migrations', () => {
    const dir = path.join(directory(), 'nested/output')
    const config = readConfig(template)
    for (const target of TARGETS) {
      const filename = writeGenerated(config, target, dir)
      const output = parse(fs.readFileSync(filename, 'utf8'))
      expect(path.resolve(dir, String(output.main))).toBe(path.join(API_ROOT, `src/entry/${target}/index.ts`))
      expect(path.resolve(dir, String(output.tsconfig))).toBe(path.join(API_ROOT, 'tsconfig.json'))
      expect(output.workers).toBeUndefined()
      for (const db of (output.d1_databases as TomlTable[]) ?? []) expect(fs.existsSync(path.resolve(dir, String(db.migrations_dir)))).toBe(true)
    }
  })
  test('custom Worker identities wire services, DO ownership and Workflow owners consistently', () => {
    const config = readConfig(template)
    config.name = 'custom-core'
    for (const row of config.services as TomlTable[]) {
      const role = { CORE: 'core', EDGE: 'edge', AIGC: 'ai', VECTOR: 'ai', SlaxBrowser: 'browser' }[String(row.binding)]
      if (role) row.service = `custom-${role}`
    }
    ;(config.services as TomlTable[]).push({ binding: 'OBJECTS', service: 'custom-objects' })
    const original = structuredClone(config.migrations)
    const [core, edge, ai, objects, browser] = (['core', 'edge', 'ai', 'objects', 'browser'] as const).map(target => workerConfig(config, target))
    expect([core.name, edge.name, ai.name, objects.name, browser.name]).toEqual(['custom-core', 'custom-edge', 'custom-ai', 'custom-objects', 'custom-browser'])
    expect(edge.services).toEqual([
      { binding: 'CORE', service: 'custom-core' },
      { binding: 'AIGC', service: 'custom-ai' }
    ])
    const doTargets = (output: TomlTable) => Object.fromEntries(((output.durable_objects as TomlTable).bindings as TomlTable[]).map(row => [row.name, row.script_name ?? 'self']))
    expect(doTargets(core)).toEqual({
      SLAX_JIEBA: 'custom-objects',
      WEBSOCKET_SERVER: 'custom-objects',
      SCREENSHOT_BROWSER: 'custom-objects',
      SLAX_BROWSER: 'custom-browser',
      VECTOR_V5_PREFERENCE: 'self'
    })
    expect(doTargets(ai)).toEqual({ SLAX_JIEBA: 'custom-objects', WEBSOCKET_SERVER: 'custom-objects', SCREENSHOT_BROWSER: 'custom-objects', VECTOR_V5_PREFERENCE: 'custom-core' })
    expect(doTargets(objects)).toEqual({ SLAX_JIEBA: 'self', WEBSOCKET_SERVER: 'self', SCREENSHOT_BROWSER: 'self' })
    expect(doTargets(browser)).toEqual({ SLAX_BROWSER: 'self' })
    expect(edge.durable_objects).toBeUndefined()
    for (const workflow of core.workflows as TomlTable[]) expect(workflow.script_name).toBeUndefined()
    for (const workflow of ai.workflows as TomlTable[]) expect(workflow.script_name).toBe('custom-core')
    for (const output of [edge, objects, browser]) expect(output.workflows).toBeUndefined()
    expect(core.migrations).toEqual(original)
    expect(objects.migrations).toEqual([{ tag: 'objects-v1', new_sqlite_classes: ['SlaxJieba', 'SlaxWebSocketServer', 'ScreenshotBrowser'] }])
    for (const output of [edge, ai]) expect(output.migrations).toBeUndefined()
    for (const output of [core, ai, objects, browser]) {
      expect(output.workers_dev).toBe(false)
      expect(output.routes).toEqual([])
      expect(output.preview_urls).toBe(false)
    }
    expect((core.triggers as TomlTable).crons).toEqual((config.triggers as TomlTable).crons)
    for (const output of [edge, ai, objects]) expect(output.triggers).toEqual({ crons: [] })
    expect((core.queues as TomlTable).consumers).toEqual((config.queues as TomlTable).consumers)
    expect((ai.queues as TomlTable).consumers).toBeUndefined()
    for (const output of [edge, objects, browser]) expect(output.queues).toBeUndefined()
    for (const output of [core, edge, objects, browser]) expect(output.vectorize).toBeUndefined()
    expect(ai.vectorize).toEqual(config.vectorize)
    for (const row of workerConfig(config, 'ai', true).vectorize as TomlTable[]) expect(row.remote).toBe(true)
    for (const output of [core, ai]) expect(output.services).toContainEqual({ binding: 'VECTOR', service: 'custom-ai', entrypoint: 'AiEntry' })
    for (const output of [objects, browser]) expect(output.services ?? []).toEqual([])
    for (const key of ['d1_databases', 'hyperdrive', 'kv_namespaces', 'ai', 'browser', 'rules']) expect(edge[key]).toBeUndefined()
    expect((objects.d1_databases as TomlTable[]).map(row => row.binding)).toEqual(['DB'])
    expect((objects.hyperdrive as TomlTable[]).map(row => row.binding)).toEqual(['HYPERDRIVE'])
    expect((objects.r2_buckets as TomlTable[]).map(row => row.binding)).toEqual(['OSS'])
  })
  test('Objects identity is derived from Core and must be distinct', () => {
    const config = readConfig(template)
    expect(workerNames(config).objects).toBe('reader-objects')
    expect(workerNames({ ...config, name: 'reader-core-beta' }).objects).toBe('reader-objects-beta')
    expect(workerNames({ ...config, name: 'acme-api' }).objects).toBe('acme-api-objects')
    const dir = directory(),
      file = path.join(dir, 'api.toml')
    ;(config.services as TomlTable[]).push({ binding: 'OBJECTS', service: String(config.name) })
    fs.writeFileSync(file, stringify(config))
    expect(() => readConfig(file)).toThrow('services.OBJECTS.service')
  })
  test('placement is owned by the deployment script', () => {
    const config = readConfig(template)
    for (const target of TARGETS) {
      const remote = workerConfig(config, target)
      expect(remote.placement).toEqual(['core', 'ai', 'objects'].includes(target) ? { region: DATABASE_REGION } : undefined)
      expect(workerConfig(config, target, true).placement).toBeUndefined()
    }
    expect(DATABASE_REGION).toBe('aws:ap-southeast-1')
    const dir = directory(),
      file = path.join(dir, 'api.toml')
    for (const placed of [{ placement: { mode: 'smart' } }, { env: { prod: { placement: { region: 'aws:us-east-1' } } } }]) {
      fs.writeFileSync(file, stringify({ ...readConfig(template), ...placed }))
      expect(() => readConfig(file, 'env' in placed ? 'prod' : undefined)).toThrow('remove placement')
    }
  })
  test('custom physical queue names retain logical dispatch including DLQ', () => {
    const config = readConfig(template)
    const queues = config.queues as { producers: TomlTable[]; consumers: TomlTable[] }
    for (const row of [...queues.producers, ...queues.consumers]) {
      row.queue = `custom-${row.queue}`
      if (row.dead_letter_queue) row.dead_letter_queue = `custom-${row.dead_letter_queue}`
    }
    expect(queueMapping(config)['custom-slax-reader-parser-stripe']).toBe('slax-reader-parser-stripe')
    expect(queueMapping(config)['custom-slax-reader-import-other-dql']).toBe('slax-reader-import-other-dql')
    const output = workerConfig(config, 'core')
    expect(JSON.parse(String((output.vars as TomlTable).API_QUEUE_CHANNELS))).toEqual(queueMapping(config))
    for (const row of (output.queues as { consumers: TomlTable[] }).consumers) expect(row.channel).toBeUndefined()
  })
  test('rejects ambiguous identities, unknown queue roles and retired variables', () => {
    const dir = directory(),
      file = path.join(dir, 'api.toml')
    const invalid = (change: (config: ApiConfig) => void, message: string) => {
      const config = readConfig(template)
      change(config)
      fs.writeFileSync(file, stringify(config))
      expect(() => readConfig(file)).toThrow(message)
    }
    invalid(c => {
      ;(c.services as TomlTable[]).find(row => row.binding === 'EDGE')!.service = c.name
    }, 'distinct')
    invalid(c => {
      c.services = (c.services as TomlTable[]).filter(row => !['AIGC', 'VECTOR'].includes(String(row.binding)))
    }, 'services.AIGC.service')
    invalid(c => {
      ;(c.services as TomlTable[]).find(row => row.binding === 'SlaxBrowser')!.service = 'invalid name'
    }, 'services.SlaxBrowser.service')
    invalid(c => {
      ;(c.vars as TomlTable).SES_SECRET_KEY = 'fixture'
    }, 'retired')
    invalid(c => {
      ;(c.queues as { consumers: TomlTable[] }).consumers[0].queue = 'unknown'
    }, 'logical channel')
  })
  test('private runtime values round-trip to every Worker with owner-only permissions', () => {
    const dir = directory()
    const config = readConfig(template)
    const runtime = {
      EDGE_SHARED_SECRET: 'synthetic-edge-value',
      IMAGER_CHECK_DIGST_SALT: 'synthetic-image-salt',
      REPORT_PUSH_API: 'https://alerts.example.com/synthetic',
      APPLE_SIGN_AUTH_KEY: 'synthetic-line-one\nsynthetic-line-two\n'
    }
    Object.assign(config.vars as TomlTable, runtime)
    const input = path.join(dir, 'api.toml')
    fs.writeFileSync(input, stringify(config))
    const selected = readConfig(input)
    for (const target of TARGETS) {
      const filename = writeGenerated(selected, target, dir)
      fs.chmodSync(filename, 0o644)
      writeGenerated(selected, target, dir)
      expect(fs.statSync(filename).mode & 0o777).toBe(0o600)
      expect(parse(fs.readFileSync(filename, 'utf8')).vars).toMatchObject(runtime)
    }
    expect(selected.vars).toMatchObject(runtime)
  })
  test.each(['__proto__', 'constructor', 'toString'])('rejects inherited properties as logical queue roles: %s', channel => {
    const config = readConfig(template)
    ;(config.queues as any).producers[0].binding = channel
    expect(() => queueMapping(config)).toThrow('logical channel')
  })
  test('native environments preserve dev bindings and inherited history without production resources', () => {
    const base = readConfig(template)
    const dev = structuredClone(base)
    delete dev.name
    dev.services = (dev.services as TomlTable[]).filter(row => row.binding !== 'EDGE')
    ;(dev.services as TomlTable[]).find(row => row.binding === 'CORE')!.service = 'reader-core-dev'
    ;(dev.d1_databases as TomlTable[])[0].database_id = 'dev-database-id'
    delete dev.migrations
    base.env = { dev }
    base.tail_consumers = [{ service: 'production-tail' }]
    ;(base.vars as TomlTable).PRODUCTION_ONLY = 'must-not-inherit'
    const before = stringify(base)
    const selected = selectEnvironment(base, undefined, true)
    expect(selected.name).toBe('reader-core-dev')
    expect(workerNames(selected).edge).toBe('reader-backend-dev')
    expect(selected.migrations).toEqual(base.migrations)
    expect(selected.tail_consumers).toBeUndefined()
    expect((selected.vars as TomlTable).PRODUCTION_ONLY).toBeUndefined()
    expect((selected.d1_databases as TomlTable[])[0].database_id).toBe('dev-database-id')
    expect(selectEnvironment(base).name).toBe('reader-core')
    expect(() => selectEnvironment(base, 'missing')).toThrow('Missing [env.missing]')
    expect(stringify(base)).toBe(before)
  })
  test('local runs keep the top-level Pipeline binding while deployments do not inherit it', () => {
    const base = readConfig(template)
    const stream = [{ binding: 'SLAX_READER_STREAM_STREAM', stream: 'events-stream-id', remote: true }]
    base.pipelines = structuredClone(stream)
    base.env = { dev: { vars: { RUN_ENV: 'development' } } }
    const local = selectEnvironment(base, undefined, true)
    expect(local.pipelines).toEqual(stream)
    expect(workerConfig(local, 'core').pipelines).toEqual(stream)
    expect(workerConfig(local, 'edge').pipelines).toEqual(stream)
    expect(workerConfig(local, 'ai').pipelines).toEqual(stream)
    expect(workerConfig(local, 'objects').pipelines).toBeUndefined()
    expect(selectEnvironment(base, 'dev').pipelines).toBeUndefined()
    expect(selectEnvironment(base).pipelines).toEqual(stream)
  })
  test('old parser queue remains configured without inventing a dispatch handler', () => {
    const config = readConfig(template)
    const queues = config.queues as any
    queues.producers.push({ binding: 'PRODUCER', queue: 'slax-reader-parser-dev' })
    queues.consumers.push({ queue: 'slax-reader-parser-dev' })
    expect(queueMapping(config)['slax-reader-parser-dev']).toBeUndefined()
    expect((workerConfig(config, 'core').queues as any).consumers).toContainEqual({ queue: 'slax-reader-parser-dev' })
  })
  test('preserves operator resource IDs and migration history; only deployment preflight requires v5 bindings', () => {
    const config = readConfig(template)
    expect(() => checkRemote(config)).toThrow('HTTPS')
    ;(config.vars as TomlTable).BACKEND_API_PREFIX = 'https://api.example.com'
    expect(() => checkRemote(config)).toThrow('RUN_ENV')
    ;(config.vars as TomlTable).RUN_ENV = 'prod'
    expect(() => checkRemote(config)).toThrow('placeholder')
    for (const [name, field] of [
      ['d1_databases', 'database_id'],
      ['kv_namespaces', 'id'],
      ['hyperdrive', 'id']
    ])
      for (const row of config[name] as TomlTable[]) row[field] = 'operator-resource-id'
    config.migrations = [{ tag: 'existing-v7', new_classes: ['SlaxJieba'] }]
    expect(() => checkRemote(config)).not.toThrow()
    expect(() => checkDeployment(config)).toThrow('Missing VectorPreferenceObject new_sqlite_classes migration')
    config.migrations = [
      { tag: 'existing-v7', new_classes: ['SlaxJieba'] },
      { tag: 'existing-v8', new_sqlite_classes: ['VectorPreferenceObject'] }
    ]
    expect(() => checkDeployment(config)).not.toThrow()
    const missingObject = structuredClone(config)
    ;(missingObject.durable_objects as TomlTable).bindings = ((missingObject.durable_objects as TomlTable).bindings as TomlTable[]).filter(
      row => row.name !== 'VECTOR_V5_PREFERENCE'
    )
    expect(() => checkRemote(missingObject)).not.toThrow()
    expect(() => checkDeployment(missingObject)).toThrow('Missing VECTOR_V5_PREFERENCE')
    for (const binding of ['VECTOR_V5_ARTICLE', 'VECTOR_V5_USER', 'VECTOR_V5_COLLECTION']) {
      const incomplete = structuredClone(config)
      incomplete.vectorize = (incomplete.vectorize as TomlTable[]).filter(row => row.binding !== binding)
      expect(() => checkRemote(incomplete)).not.toThrow()
      expect(() => checkDeployment(incomplete)).toThrow(`Missing ${binding}`)
    }
    const missingWorkflow = structuredClone(config)
    missingWorkflow.workflows = (missingWorkflow.workflows as TomlTable[]).filter(row => row.binding !== 'VECTOR_V5_MAINTENANCE_WORKFLOW')
    expect(() => checkRemote(missingWorkflow)).not.toThrow()
    expect(() => checkDeployment(missingWorkflow)).toThrow('Missing VECTOR_V5_MAINTENANCE_WORKFLOW')
    ;(config.vars as TomlTable).RUN_ENV = 'development'
    expect(() => checkRemote(config)).toThrow('RUN_ENV')
    ;(config.vars as TomlTable).RUN_ENV = 'prod'
    expect(workerConfig(config, 'core').migrations).toEqual(config.migrations)
    expect(workerConfig(config, 'ai').d1_databases).toEqual(config.d1_databases)
    expect(workerConfig(config, 'edge').d1_databases).toBeUndefined()
  })

  test('the removed MCP server is deleted from Core histories that created it, and from Edge only in step 4', () => {
    const config = readConfig(template)
    const created = [
      { tag: 'v1', new_classes: ['SlaxJieba', 'SlaxWebSocketServer', 'ScreenshotBrowser'] },
      { tag: 'v2', new_sqlite_classes: ['SlaxMcpServer'] },
      { tag: 'vector-preference-v1', new_sqlite_classes: ['VectorPreferenceObject'] }
    ]
    config.migrations = created
    const retire = { tag: 'retire-mcp-v1', deleted_classes: ['SlaxMcpServer'] }
    expect(workerConfig(config, 'core').migrations).toEqual([...created, retire])
    // Steps 2 and 3 keep the namespace, so they stay reversible.
    expect(workerConfig(config, 'core', false, 'keep-mcp').migrations).toEqual(created)
    expect(workerConfig(config, 'core', false, 'retire-mcp').migrations).toEqual([...created, retire])
    // An operator history that already deletes it, or never created it, is left as it is.
    config.migrations = [...created, { tag: 'operator-delete', deleted_classes: ['SlaxMcpServer'] }]
    expect(workerConfig(config, 'core').migrations).toEqual(config.migrations)
    config.migrations = [created[0], created[2]]
    expect(workerConfig(config, 'core').migrations).toEqual(config.migrations)
    // Edge's legacy history is not in configuration: it carries only the deletion, and only in step 4.
    expect(workerConfig(config, 'edge').migrations).toBeUndefined()
    expect(workerConfig(config, 'edge', false, 'keep-mcp').migrations).toBeUndefined()
    expect(workerConfig(config, 'edge', false, 'retire-mcp').migrations).toEqual([retire])
    for (const target of ['ai', 'objects', 'browser'] as const)
      expect(JSON.stringify(workerConfig(config, target, false, 'retire-mcp').migrations ?? [])).not.toContain('SlaxMcpServer')
  })

  test('the stub that keeps the MCP namespace is published only during steps 2 and 3', () => {
    const config = readConfig(template)
    const dir = fs.mkdtempSync(path.join(tmpdir(), 'mcp-phase-'))
    try {
      for (const target of ['core', 'edge'] as const) {
        const main = (mcp: McpPhase) => String(parse(fs.readFileSync(writeGenerated(config, target, dir, false, false, mcp), 'utf8')).main)
        expect(main('retired')).toMatch(new RegExp(`src/entry/${target}/index\\.ts$`))
        expect(main('retire-mcp')).toMatch(new RegExp(`src/entry/${target}/index\\.ts$`))
        expect(main('keep-mcp')).toMatch(new RegExp(`src/entry/transition/${target}\\.ts$`))
      }
      expect(String(parse(fs.readFileSync(writeGenerated(config, 'ai', dir, false, false, 'keep-mcp'), 'utf8')).main)).toMatch(/src\/entry\/ai\/index\.ts$/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
