import { API_ROOT } from '../../script/root'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { isolatedEnvironment, localDevOptions, ROOT } from '../../script/deploy/dev-local'

const workspaces: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true })
})

function fixture() {
  const workspace = mkdtempSync(resolve(ROOT, '.tmp-root-tooling-http-test-'))
  workspaces.push(workspace)
  const edge = resolve(workspace, 'edge.json')
  const core = resolve(workspace, 'core.json')
  const ai = resolve(workspace, 'ai.json')
  const objects = resolve(workspace, 'objects.json')
  const state = resolve(workspace, 'state')
  const empty = resolve(workspace, 'empty.env-file')
  mkdirSync(state)
  writeFileSync(empty, '')
  const shared = { tsconfig: relative(workspace, resolve(ROOT, 'apps/api/tsconfig.json')), vars: { RUN_ENV: 'development', RUN_TYPE: 'dev' } }
  const entry = (name: string) => relative(workspace, resolve(ROOT, `apps/api/src/entry/${name}/index.ts`))
  const hyperdrive = [{ binding: 'HYPERDRIVE', localConnectionString: 'postgresql://postgres:test@127.0.0.1:6543/disposable' }]
  const coreData = {
    ...shared,
    name: 'local-core',
    main: entry('core'),
    hyperdrive,
    services: [{ binding: 'VECTOR', service: 'local-ai', entrypoint: 'AiEntry' }],
    durable_objects: { bindings: [{ name: 'SLAX_JIEBA', class_name: 'SlaxJieba', script_name: 'local-objects' }] }
  }
  const edgeData = {
    ...shared,
    name: 'local-edge',
    main: entry('edge'),
    services: [
      { binding: 'CORE', service: 'local-core' },
      { binding: 'AIGC', service: 'local-ai' }
    ]
  }
  const aiData = { ...shared, name: 'local-ai', main: entry('ai'), hyperdrive }
  const objectsData = {
    ...shared,
    name: 'local-objects',
    main: entry('objects'),
    durable_objects: { bindings: [{ name: 'SLAX_JIEBA', class_name: 'SlaxJieba' }] },
    migrations: [{ tag: 'objects-v1', new_sqlite_classes: ['SlaxJieba'] }]
  }
  writeFileSync(core, JSON.stringify(coreData))
  writeFileSync(edge, JSON.stringify(edgeData))
  writeFileSync(ai, JSON.stringify(aiData))
  writeFileSync(objects, JSON.stringify(objectsData))
  return {
    workspace,
    edge,
    core,
    ai,
    objects,
    state,
    empty,
    coreData,
    edgeData,
    aiData,
    objectsData,
    args: ['--edge-config', edge, '--core-config', core, '--ai-config', ai, '--objects-config', objects, '--state', state, '--env-file', empty]
  }
}

describe('explicit isolated local Worker launcher', () => {
  test('diagnostic fixture requires explicit opt in and cannot select arbitrary entrypoints', () => {
    const f = fixture()
    const main = relative(f.workspace, resolve(ROOT, 'apps/api/test/runtime/diagnosticWorker.ts'))
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, main }))
    expect(() => localDevOptions(f.args)).toThrow('actual Edge/Core/AI/Objects entrypoints')
    vi.stubEnv('SLAX_API_DIAGNOSTIC_HTTP_FIXTURE', '1')
    expect(localDevOptions(f.args).args).toContain('--local')
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, main: 'arbitrary.ts' }))
    expect(() => localDevOptions(f.args)).toThrow('actual Edge/Core/AI/Objects entrypoints')
    writeFileSync(f.core, JSON.stringify(f.coreData))
    // The diagnostic fixture replaces only Core; another Worker cannot borrow it.
    writeFileSync(f.ai, JSON.stringify({ ...f.aiData, main }))
    expect(() => localDevOptions(f.args)).toThrow('actual Edge/Core/AI/Objects entrypoints')
    vi.unstubAllEnvs()
    writeFileSync(f.ai, JSON.stringify(f.aiData))
    expect(localDevOptions(f.args).args).toContain('--local')
  })
  test('requires all inputs and never defaults to production-capable dev configs', () => {
    expect(() => localDevOptions([])).toThrow('All six explicit')
    expect(() => localDevOptions(['--remote', 'true'])).toThrow('Usage')
  })
  test('uses root CLI cwd, explicit local state, safe host and scrubbed process environment', () => {
    const f = fixture()
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'must-not-inherit')
    vi.stubEnv('JWT_SECRET_TEXT', 'must-not-inherit')
    const result = localDevOptions(f.args)
    expect(result.cwd).toBe(API_ROOT)
    expect(result.args).toContain('--local')
    expect(result.args).not.toContain('--remote')
    expect(result.args.slice(result.args.indexOf('--persist-to'), result.args.indexOf('--persist-to') + 2)).toEqual(['--persist-to', f.state])
    expect(result.args.slice(result.args.indexOf('--host'), result.args.indexOf('--host') + 2)).toEqual(['--host', 'localhost:8787'])
    expect(result.env.CLOUDFLARE_API_TOKEN).toBeUndefined()
    expect(result.env.JWT_SECRET_TEXT).toBeUndefined()
    expect(result.env.DOTENV_CONFIG_PATH).toBe(f.empty)
    expect(result.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV).toBe('false')
    expect(result.env.CLOUDFLARE_INCLUDE_PROCESS_ENV).toBe('false')
    expect(result.env.WRANGLER_SEND_METRICS).toBe('false')
    expect(JSON.parse(readFileSync(resolve(f.workspace, 'tsconfig.json'), 'utf8'))).toEqual({ extends: '../apps/api/tsconfig.json' })
    expect(localDevOptions(f.args).cwd).toBe(API_ROOT)
  })
  test('supports an explicit isolated port and rejects invalid values', () => {
    const f = fixture()
    const result = localDevOptions([...f.args, '--port', '49123'])
    expect(result.args.slice(result.args.indexOf('--port'), result.args.indexOf('--port') + 2)).toEqual(['--port', '49123'])
    expect(result.args).toContain('localhost:49123')
    for (const port of ['0', '-1', '65536', 'not-a-port']) expect(() => localDevOptions([...f.args, '--port', port])).toThrow('Local port')
  })

  test('rejects nonempty env files and external/symlink state before starting processes', () => {
    const f = fixture()
    writeFileSync(f.empty, 'NOT_EMPTY=yes')
    expect(() => localDevOptions(f.args)).toThrow('must be empty')
    writeFileSync(f.empty, '')
    rmSync(f.state, { recursive: true })
    symlinkSync(ROOT, f.state, 'dir')
    expect(() => localDevOptions(f.args)).toThrow('without symlinks')
  })
  test.each(['vectorize', 'ai', 'browser', 'queues', 'build', 'env'])('rejects unsupported %s configuration', key => {
    const f = fixture()
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, [key]: {} }))
    expect(() => localDevOptions(f.args)).toThrow('minimal local binding')
  })
  test('allows only the declared local Crawl Workflow, owned by Core', () => {
    const f = fixture()
    const workflow = { binding: 'CRAWL_WORKFLOW', name: 'local-crawl', class_name: 'CrawlWorkflow' }
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, workflows: [workflow] }))
    expect(localDevOptions(f.args).args).toContain('--local')
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, workflows: [{ ...workflow, script_name: 'remote-edge' }] }))
    expect(() => localDevOptions(f.args)).toThrow('local Crawl Workflow')
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, workflows: [{ ...workflow, class_name: 'OtherWorkflow' }] }))
    expect(() => localDevOptions(f.args)).toThrow('local Crawl Workflow')
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, workflows: {} }))
    expect(() => localDevOptions(f.args)).toThrow('local Crawl Workflow')
    writeFileSync(f.core, JSON.stringify(f.coreData))
    writeFileSync(f.edge, JSON.stringify({ ...f.edgeData, workflows: [workflow] }))
    expect(() => localDevOptions(f.args)).toThrow('local Crawl Workflow')
  })
  test('starts all four local Workers with Edge as the served primary', () => {
    const f = fixture()
    const args = localDevOptions(f.args).args
    expect(args.flatMap((arg, index) => (arg === '-c' ? [args[index + 1]] : []))).toEqual([f.edge, f.core, f.ai, f.objects])
  })
  test('Durable Objects live in the local Objects Worker and are reached from Core only', () => {
    const f = fixture()
    const binding = { name: 'SLAX_JIEBA', class_name: 'SlaxJieba' }
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, durable_objects: { bindings: [binding] } }))
    expect(() => localDevOptions(f.args)).toThrow('through the local Objects Worker')
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, durable_objects: { bindings: [{ ...binding, script_name: 'remote-objects' }] } }))
    expect(() => localDevOptions(f.args)).toThrow('through the local Objects Worker')
    writeFileSync(f.core, JSON.stringify(f.coreData))
    writeFileSync(f.edge, JSON.stringify({ ...f.edgeData, durable_objects: { bindings: [{ ...binding, script_name: 'local-objects' }] } }))
    expect(() => localDevOptions(f.args)).toThrow('Objects-owned Durable Objects')
    writeFileSync(f.edge, JSON.stringify(f.edgeData))
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, migrations: [{ tag: 'v1', new_classes: ['SlaxJieba'] }] }))
    expect(() => localDevOptions(f.args)).toThrow('Only the local Objects Worker declares')
  })
  test('rejects remote Hyperdrive and unmatched service targets', () => {
    const f = fixture()
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, hyperdrive: [{ localConnectionString: 'postgresql://u:p@example.com:5432/db' }] }))
    expect(() => localDevOptions(f.args)).toThrow('loopback')
    writeFileSync(f.core, JSON.stringify(f.coreData))
    writeFileSync(f.edge, JSON.stringify({ ...f.edgeData, services: [{ binding: 'CORE', service: 'external-core' }, f.edgeData.services[1]] }))
    expect(() => localDevOptions(f.args)).toThrow('local Edge-to-Core')
    writeFileSync(f.edge, JSON.stringify({ ...f.edgeData, services: [f.edgeData.services[0]] }))
    expect(() => localDevOptions(f.args)).toThrow('local Edge-to-Core')
    writeFileSync(f.edge, JSON.stringify(f.edgeData))
    writeFileSync(f.ai, JSON.stringify({ ...f.aiData, services: [{ binding: 'CORE', service: 'local-core' }] }))
    expect(() => localDevOptions(f.args)).toThrow('local Edge-to-Core')
    writeFileSync(f.ai, JSON.stringify(f.aiData))
    writeFileSync(f.objects, JSON.stringify({ ...f.objectsData, name: 'local-core' }))
    expect(() => localDevOptions(f.args)).toThrow('its own name')
  })
  test('does not inherit dotenv, Node injection or cloud credential variables', () => {
    vi.stubEnv('NODE_OPTIONS', '--require forbidden')
    vi.stubEnv('DOTENV_CONFIG_PATH', 'forbidden')
    const env = isolatedEnvironment('/isolated/home', '/isolated/empty')
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.DOTENV_CONFIG_PATH).toBe('/isolated/empty')
  })
})
