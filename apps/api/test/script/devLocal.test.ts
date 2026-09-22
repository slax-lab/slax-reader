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
  const state = resolve(workspace, 'state')
  const empty = resolve(workspace, 'empty.env-file')
  mkdirSync(state)
  writeFileSync(empty, '')
  const shared = { tsconfig: relative(workspace, resolve(ROOT, 'apps/api/tsconfig.json')), vars: { RUN_ENV: 'development', RUN_TYPE: 'dev' } }
  const coreData = {
    ...shared,
    name: 'local-core',
    main: relative(workspace, resolve(ROOT, 'apps/api/src/entry/core/index.ts')),
    hyperdrive: [{ binding: 'HYPERDRIVE', localConnectionString: 'postgresql://postgres:test@127.0.0.1:6543/disposable' }]
  }
  const edgeData = {
    ...shared,
    name: 'local-edge',
    main: relative(workspace, resolve(ROOT, 'apps/api/src/entry/edge/index.ts')),
    services: [{ binding: 'CORE', service: 'local-core' }]
  }
  writeFileSync(core, JSON.stringify(coreData))
  writeFileSync(edge, JSON.stringify(edgeData))
  return { workspace, edge, core, state, empty, coreData, edgeData, args: ['--edge-config', edge, '--core-config', core, '--state', state, '--env-file', empty] }
}

describe('explicit isolated local Worker launcher', () => {
  test('requires all inputs and never defaults to production-capable dev configs', () => {
    expect(() => localDevOptions([])).toThrow('All four explicit')
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
    expect(result.env.SLAX_API_ENV_FILE).toBe(f.empty)
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
  test.each(['vectorize', 'ai', 'browser', 'queues', 'workflows', 'build', 'env'])('rejects unsupported %s configuration', key => {
    const f = fixture()
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, [key]: {} }))
    expect(() => localDevOptions(f.args)).toThrow('minimal local binding')
  })
  test('rejects remote Hyperdrive and unmatched service targets', () => {
    const f = fixture()
    writeFileSync(f.core, JSON.stringify({ ...f.coreData, hyperdrive: [{ localConnectionString: 'postgresql://u:p@example.com:5432/db' }] }))
    expect(() => localDevOptions(f.args)).toThrow('loopback')
    writeFileSync(f.core, JSON.stringify(f.coreData))
    writeFileSync(f.edge, JSON.stringify({ ...f.edgeData, services: [{ binding: 'CORE', service: 'external-core' }] }))
    expect(() => localDevOptions(f.args)).toThrow('local Edge-to-Core')
  })
  test('does not inherit dotenv, Node injection or cloud credential variables', () => {
    vi.stubEnv('NODE_OPTIONS', '--require forbidden')
    vi.stubEnv('DOTENV_CONFIG_PATH', 'forbidden')
    const env = isolatedEnvironment('/isolated/home', '/isolated/empty')
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.DOTENV_CONFIG_PATH).toBe('/isolated/empty')
  })
})
