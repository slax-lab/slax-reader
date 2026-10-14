import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse, stringify } from 'smol-toml'
import { readConfig } from '../../script/deploy/config'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { environmentTypes, generateWorkerTypes } from '../../script/generate-worker-types'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

const ROOT = path.resolve(import.meta.dirname, '../../../..')
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.resetAllMocks()
})

describe('Worker types security', () => {
  test('tracked Env has no literal config values and preserves optional security bindings', () => {
    const env = environmentTypes(fs.readFileSync(path.join(ROOT, 'apps/api/worker-configuration.d.ts'), 'utf8'))
    expect(env).toContain('TELEGRAM_WEBHOOK_SECRET?: string')
    expect(env).toContain('GA4_API_SECRET?: string')
    expect(env).toContain('OPENAI_MODERATION_ENDPOINT?: string')
    expect(env).toContain('STRIPE_LIVE_MODE?: string')
    expect(env).toContain('STRIPE_SECRET_KEY: string')
    expect(env).toContain('STRIPE_CALLBACK_SECRET: string')
    expect(env).toContain('APP_STORE_API_PRIVATE_KEY: string')
    expect(env).toContain('DB: D1Database')
    for (const name of ['REPORT_PUSH_API', 'STRIPE_PUSH_API', 'ERROR_LOG_PUSH_API', 'CRAWL_PUSH_API']) expect(env).toContain(`${name}?: string`)
    expect(env).not.toMatch(/SlaxNote|STRIPE_CONNECT|NOTE_STRIPE|SES_/)
  })

  test.each(["'example-secret'", "'first' | 'second'", '{ nested: "example-secret" }'])('rejects literal Env binding types: %s', type => {
    expect(() => environmentTypes(`interface Env { API_KEY: ${type} }\n// Begin runtime types`)).toThrow('must not contain literal')
  })

  test('types command uses the safe runtime-only generator', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/api/package.json'), 'utf8'))
    expect(manifest.scripts.types).toBe('tsx --tsconfig tsconfig.json script/generate-worker-types.ts')
  })

  test('generation preserves Env and uses a minimal config and explicitly empty env file', () => {
    const root = fs.mkdtempSync(path.resolve('.worker-types-test-'))
    tempDirs.push(root)
    fs.mkdirSync(path.join(root, 'config'))
    const env = 'interface Env { API_KEY: string; OPTIONAL_SECRET?: string }\n'
    fs.writeFileSync(path.join(root, 'worker-configuration.d.ts'), env + '// Begin runtime types\nold runtime')
    fs.writeFileSync(path.join(root, 'config/prod.toml'), 'compatibility_date = "2024-08-06"\ncompatibility_flags = ["nodejs_compat_v2"]\n[vars]\nAPI_KEY = "fixture-secret"\n')
    vi.mocked(spawnSync).mockImplementation(((command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => {
      expect(command).toBe('wrangler')
      expect(args).toContain('--include-env=false')
      expect(args).toContain('--strict-vars=false')
      const config = parse(fs.readFileSync(args[args.indexOf('--config') + 1], 'utf8'))
      expect(config).toEqual({ name: 'worker-runtime-types', compatibility_date: '2024-08-06', compatibility_flags: ['nodejs_compat_v2'] })
      expect(fs.readFileSync(args[args.indexOf('--env-file') + 1], 'utf8')).toBe('')
      expect(options.cwd.startsWith(root)).toBe(true)
      expect(options.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV).toBe('false')
      expect(options.env.WRANGLER_SEND_METRICS).toBe('false')
      fs.writeFileSync(args[1], '// Begin runtime types\nnew runtime')
      return { status: 0 }
    }) as typeof spawnSync)
    generateWorkerTypes(root, path.join(root, 'config/prod.toml'))
    expect(fs.readFileSync(path.join(root, 'worker-configuration.d.ts'), 'utf8')).toBe(env + '// Begin runtime types\nnew runtime')
    expect(fs.readdirSync(root).sort()).toEqual(['config', 'worker-configuration.d.ts'])
  })

  test('deployment rejects retired configuration instead of supporting it as a secret', () => {
    const retired = [
      'STRIPE_CONNECT_CALLBACK_SECRET',
      'NOTE_STRIPE_PUSH_API',
      'STRIPE_CONNECT_API',
      'SES_SMTP_FROM_ADDRESS',
      'SES_SMTP_HOST',
      'SES_SMTP_USER_NAME',
      'SES_SMTP_PASSWORD',
      'SES_ACCESS_KEY',
      'SES_SECRET_KEY'
    ]
    const directory = fs.mkdtempSync(path.join(ROOT, '.worker-types-test-'))
    tempDirs.push(directory)
    const filename = path.join(directory, 'api.toml')
    const template = readConfig(path.join(ROOT, 'deploy/cloudflare/api.toml.example'))
    for (const name of retired) {
      for (const value of ['__WORKER_SECRET__', 'fixture-retired-value']) {
        const config = structuredClone(template)
        ;(config.vars as any)[name] = value
        fs.writeFileSync(filename, stringify(config))
        expect(() => readConfig(filename)).toThrow(`${name} is retired and must be removed from Reader configuration`)
      }
    }
  })

  test('public example does not contain secret vars at any Worker level', () => {
    const config = parse(fs.readFileSync(path.join(ROOT, 'deploy/cloudflare/api.toml.example'), 'utf8'))
    const forbidden = [
      'EDGE_SHARED_SECRET',
      'THIRD_PARTY_FETCHER_KEY',
      'IMAGER_CHECK_DIGST_SALT',
      'REPORT_PUSH_API',
      'STRIPE_PUSH_API',
      'ERROR_LOG_PUSH_API',
      'CRAWL_PUSH_API',
      'GA4_API_SECRET'
    ]
    const walk = (value: unknown) => {
      if (!value || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        if (key === 'vars') {
          for (const name of forbidden) expect(Object.hasOwn(child, name), `secret variable ${name}`).toBe(false)
          expect(Object.keys(child).some(name => /STRIPE_CONNECT|NOTE_STRIPE|SES_/.test(name))).toBe(false)
        }
        if (key === 'services') {
          expect((child as { binding: string }[]).some(service => service.binding === 'SlaxNote')).toBe(false)
        }
        walk(child)
      }
    }
    walk(config)
    expect((config.d1_databases as { binding: string }[]).map(database => database.binding)).toEqual(expect.arrayContaining(['DB', 'DB_FULLTEXT']))
  })
})
