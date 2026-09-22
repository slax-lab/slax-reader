import fs from 'node:fs'
import path from 'node:path'
import { parse, stringify, type TomlTable } from 'smol-toml'
import { afterEach, describe, expect, test } from 'vitest'
import {
  API_ROOT,
  ROOT,
  TARGETS,
  readConfig,
  workerConfig,
  writeGenerated,
  checkRemote,
  queueMapping,
  selectEnvironment,
  workerNames,
  type ApiConfig
} from '../../script/deploy/config'

const template = path.join(ROOT, 'deploy/cloudflare/api.toml.example')
const temps: string[] = []
function directory() {
  const dir = fs.mkdtempSync(path.join(ROOT, '.tmp-root-tooling-config-'))
  temps.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('single API configuration', () => {
  test('fails when the configured file is missing instead of deploying an example', () => {
    expect(() => readConfig(path.join(directory(), 'api.toml'))).toThrow('configuration is missing')
  })
  test('all four targets resolve app source, tsconfig and historical D1 migrations', () => {
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
    const original = structuredClone(config.migrations)
    const core = workerConfig(config, 'core'),
      edge = workerConfig(config, 'edge'),
      ai = workerConfig(config, 'ai'),
      browser = workerConfig(config, 'browser')
    expect(core.name).toBe('custom-core')
    expect(edge.name).toBe('custom-edge')
    expect(edge.services).toEqual(
      expect.arrayContaining([
        { binding: 'CORE', service: 'custom-core' },
        { binding: 'AIGC', service: 'custom-ai' }
      ])
    )
    expect((ai.durable_objects as TomlTable).bindings).toEqual([{ name: 'SLAX_JIEBA', class_name: 'SlaxJieba', script_name: 'custom-core' }])
    expect((edge.durable_objects as TomlTable).bindings).toEqual(
      expect.arrayContaining([{ name: 'WEBSOCKET_SERVER', class_name: 'SlaxWebSocketServer', script_name: 'custom-core' }])
    )
    for (const workflow of core.workflows as TomlTable[]) expect(workflow.script_name).toBe('custom-edge')
    for (const workflow of edge.workflows as TomlTable[]) expect(workflow.script_name).toBeUndefined()
    expect(core.migrations).toEqual(original)
    expect(edge.migrations).toBeUndefined()
    for (const output of [core, ai, browser]) {
      expect(output.workers_dev).toBe(false)
      expect(output.routes).toEqual([])
      expect(output.preview_urls).toBe(false)
    }
    expect(edge.triggers).toBeDefined()
    expect(core.triggers).toBeUndefined()
    expect((core.queues as TomlTable).consumers).toBeUndefined()
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
    const output = workerConfig(config, 'edge')
    expect(JSON.parse(String((output.vars as TomlTable).API_QUEUE_CHANNELS))).toEqual(queueMapping(config))
    for (const row of (output.queues as { consumers: TomlTable[] }).consumers) expect(row.channel).toBeUndefined()
  })
  test('rejects ambiguous identities, unknown queue roles and secrets', () => {
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
      ;(c.vars as TomlTable).EDGE_SHARED_SECRET = 'fixture'
    }, 'Worker secret')
    invalid(c => {
      ;(c.queues as { consumers: TomlTable[] }).consumers[0].queue = 'unknown'
    }, 'logical channel')
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
    expect(workerConfig(local, 'ai').pipelines).toBeUndefined()
    expect(selectEnvironment(base, 'dev').pipelines).toBeUndefined()
    expect(selectEnvironment(base).pipelines).toEqual(stream)
  })
  test('old parser queue remains configured without inventing a dispatch handler', () => {
    const config = readConfig(template)
    const queues = config.queues as any
    queues.producers.push({ binding: 'PRODUCER', queue: 'slax-reader-parser-dev' })
    queues.consumers.push({ queue: 'slax-reader-parser-dev' })
    expect(queueMapping(config)['slax-reader-parser-dev']).toBeUndefined()
    expect((workerConfig(config, 'edge').queues as any).consumers).toContainEqual({ queue: 'slax-reader-parser-dev' })
  })
  test('preserves operator resource IDs and migration history and refuses placeholders remotely', () => {
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
    ;(config.vars as TomlTable).RUN_ENV = 'development'
    expect(() => checkRemote(config)).toThrow('RUN_ENV')
    ;(config.vars as TomlTable).RUN_ENV = 'prod'
    expect(workerConfig(config, 'core').migrations).toEqual(config.migrations)
    expect(workerConfig(config, 'edge').d1_databases).toEqual(config.d1_databases)
  })
})
