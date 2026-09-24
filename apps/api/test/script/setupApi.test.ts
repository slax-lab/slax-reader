import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { afterEach, describe, expect, test } from 'vitest'
import { parse, stringify } from 'smol-toml'
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto'
import { SignJWT, importJWK } from 'jose'
import { powerSyncPublicEnvironment } from '../../script/deploy/setup-api'
import { API_ROOT, ROOT } from '../../script/root'

const fixtureKey = { ...generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' }
const fixturePublic = { PS_JWK_N: fixtureKey.n, PS_JWK_E: fixtureKey.e, PS_JWK_KID: fixtureKey.kid }
const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function fixture() {
  const root = fs.mkdtempSync(path.join(API_ROOT, 'test/.tmp-root-deployment-full-'))
  temps.push(root)
  for (const file of ['script/root.ts', 'script/deploy/config.ts', 'script/deploy/setup-api.ts', 'script/deploy/check-readiness.ts', 'script/deploy/generate-powersync-keys.mjs']) {
    const dest = path.join(root, 'apps/api', file)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(API_ROOT, file), dest)
  }
  fs.mkdirSync(path.join(root, 'deploy/cloudflare'), { recursive: true })
  fs.mkdirSync(path.join(root, 'deploy/local'), { recursive: true })
  const configFile = path.join(root, 'deploy/local/api.toml')
  fs.copyFileSync(path.join(ROOT, 'deploy/cloudflare/api.toml.example'), configFile)
  fs.copyFileSync(configFile, path.join(root, 'deploy/cloudflare/api.toml.example'))
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
  const keys = path.join(root, 'deploy/local/powersync-local')
  fs.mkdirSync(keys, { recursive: true })
  const pub = { kty: 'RSA', kid: 'fixture', n: 'fixture-modulus', e: 'AQAB' }
  fs.writeFileSync(path.join(keys, 'dev-jwks-public.json'), JSON.stringify({ keys: [pub] }))
  fs.writeFileSync(path.join(keys, 'dev-jwks-private.json'), '{}')
  fs.writeFileSync(path.join(keys, 'compose.env'), 'PS_JWK_N=fixture-modulus\nPS_JWK_E=AQAB\nPS_JWK_KID=fixture\n')
  const vars = path.join(root, 'deploy/local/.dev.vars')
  fs.writeFileSync(vars, `JWT_SECRET_TEXT=fixture-jwt\nHASH_IDS_SALT=fixture-hash\nEDGE_SHARED_SECRET=fixture-edge\nPOWERSYNC_JWK_PRIVATE_KEY='${JSON.stringify(fixtureKey)}'\n`)
  fs.mkdirSync(path.join(root, 'bin'))
  fs.writeFileSync(path.join(root, 'bin/docker'), `#!${process.execPath}\nprocess.exit(Number(process.env.DOCKER_EXIT || 0));\n`, { mode: 0o755 })
  fs.writeFileSync(
    path.join(root, 'bin/pnpm'),
    `#!${process.execPath}
import fs from 'node:fs';
const command = process.argv.at(-1).endsWith('setup-backend.sh') ? 'infrastructure' : process.argv.at(-1);
fs.appendFileSync(process.env.CALLS, JSON.stringify({ command, args: process.argv.slice(2), config: process.env.SLAX_API_CONFIG, cwd: process.cwd(), publicKey: { PS_JWK_N: process.env.PS_JWK_N, PS_JWK_E: process.env.PS_JWK_E, PS_JWK_KID: process.env.PS_JWK_KID } })+'\\n');
if (process.env.WAIT_SIGNAL === command) {
  process.on('SIGTERM', () => process.exit(0)); console.log('waiting'); setInterval(() => {}, 1000);
} else process.exit(command === 'infrastructure' ? Number(process.env.SETUP_EXIT || 0) : Number(process.env.LOGIN_EXIT || 0));
`,
    { mode: 0o755 }
  )
  fs.copyFileSync(path.join(root, 'bin/pnpm'), path.join(root, 'bin/bash'))
  const executable = path.join(API_ROOT, 'node_modules/.bin/tsx')
  const entry = path.join(root, 'apps/api/script/deploy/setup-api.ts')
  const env = { PATH: `${root}/bin:${process.env.PATH}`, HOME: root, CALLS: path.join(root, 'calls.jsonl') }
  return { root, configFile, vars, keys, executable, entry, env }
}

function calls(f: ReturnType<typeof fixture>) {
  return fs.existsSync(f.env.CALLS)
    ? fs
        .readFileSync(f.env.CALLS, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
    : []
}
function run(f: ReturnType<typeof fixture>, args: string[] = [], extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(f.executable, [f.entry, ...args], { cwd: f.root, env: { ...f.env, ...extra }, encoding: 'utf8', timeout: 10000 })
}

describe('read-only API readiness probe', () => {
  test.each(['ready', 'missing-secrets', 'invalid-key', 'invalid-config', 'both-invalid', 'remote-database'])(
    'separates startup and functionality for %s without invoking setup',
    problem => {
      const f = fixture()
      if (problem === 'missing-secrets' || problem === 'both-invalid') fs.unlinkSync(f.vars)
      if (problem === 'invalid-key') fs.appendFileSync(f.vars, 'POWERSYNC_JWK_PRIVATE_KEY=PRIVATE_OUTPUT_MARKER\n')
      if (problem === 'invalid-config' || problem === 'both-invalid') fs.writeFileSync(f.configFile, '[PRIVATE_OUTPUT_MARKER')
      if (problem === 'remote-database') {
        const config: any = parse(fs.readFileSync(f.configFile, 'utf8'))
        config.hyperdrive[0].localConnectionString = 'postgresql://PRIVATE_OUTPUT_MARKER@remote.invalid/db'
        fs.writeFileSync(f.configFile, stringify(config))
      }
      fs.writeFileSync(path.join(f.root, 'bin/docker'), `#!${process.execPath}\nthrow new Error('Docker must not be called');\n`)
      f.entry = path.join(f.root, 'apps/api/script/deploy/check-readiness.ts')
      const before = fs.readFileSync(f.configFile, 'utf8')
      const result = run(f, [], { TSX_DISABLE_CACHE: '1' })
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ startup: !['invalid-config', 'both-invalid'].includes(problem), local: problem === 'ready' })
      expect(result.stdout + result.stderr).not.toContain('PRIVATE_OUTPUT_MARKER')
      expect(result.stderr).toBe('')
      expect(calls(f)).toEqual([])
      expect(fs.readFileSync(f.configFile, 'utf8')).toBe(before)
      expect(fs.existsSync(path.join(f.root, 'deploy/local/.generated'))).toBe(false)
    }
  )

  test('honors custom config and environment selection including local env.dev fallback', () => {
    const f = fixture()
    const config: any = parse(fs.readFileSync(f.configFile, 'utf8'))
    const external = path.join(f.root, 'external.toml')
    fs.writeFileSync(external, stringify({ ...config, vars: {}, env: { dev: config, selected: config } }))
    fs.unlinkSync(f.configFile)
    f.entry = path.join(f.root, 'apps/api/script/deploy/check-readiness.ts')
    for (const selected of [undefined, 'selected', 'absent']) {
      const result = run(f, [], { SLAX_API_CONFIG: external, SLAX_API_ENV: selected, TSX_DISABLE_CACHE: '1' })
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ startup: selected !== 'absent', local: selected !== 'absent' })
    }
  })
})

describe('API setup without application startup', () => {
  test('setup logs in once per run, initializes dependencies and preserves every operator file', () => {
    const f = fixture()
    const files = [f.configFile, f.vars, ...['dev-jwks-private.json', 'dev-jwks-public.json', 'compose.env'].map(name => path.join(f.keys, name))]
    const before = files.map(file => fs.readFileSync(file, 'utf8'))
    expect(run(f).status).toBe(0)
    expect(run(f).status).toBe(0)
    expect(files.map(file => fs.readFileSync(file, 'utf8'))).toEqual(before)
    expect(fs.existsSync(path.join(f.root, 'deploy/local/.env'))).toBe(false)
    expect(fs.existsSync(`${f.configFile}.legacy`)).toBe(false)
    expect(calls(f).map(x => x.command)).toEqual(['login', 'infrastructure', 'login', 'infrastructure'])
  })

  test('setup reads env.dev and leaves the native operator configuration unchanged', () => {
    const f = fixture()
    const dev: any = parse(fs.readFileSync(f.configFile, 'utf8'))
    delete dev.name
    dev.vars.BACKEND_API_PREFIX = 'https://development-api.example.com'
    dev.services = dev.services.filter((x: any) => x.binding !== 'EDGE')
    dev.services.find((x: any) => x.binding === 'CORE').service = 'existing-core-dev'
    const source = { name: 'existing-core', compatibility_date: dev.compatibility_date, compatibility_flags: dev.compatibility_flags, vars: { RUN_ENV: 'prod' }, env: { dev } }
    const original = stringify(source)
    fs.writeFileSync(f.configFile, original)
    const result = run(f)
    expect(result.status, result.stderr).toBe(0)
    expect(fs.readFileSync(f.configFile, 'utf8')).toBe(original)
    expect(fs.existsSync(`${f.configFile}.legacy`)).toBe(false)
    expect(calls(f).map(x => x.command)).toEqual(['login', 'infrastructure'])
  })

  test.each([{ args: [] }, { args: ['--check'] }])('setup with $args reports all missing local files and creates nothing', ({ args }) => {
    const f = fixture()
    fs.unlinkSync(f.configFile)
    fs.unlinkSync(f.vars)
    fs.rmSync(f.keys, { recursive: true })
    const result = run(f, args)
    expect(result.status).not.toBe(0)
    for (const name of ['api.toml', '.dev.vars']) expect(result.stderr).toContain(name)
    expect(fs.existsSync(f.configFile)).toBe(false)
    expect(fs.existsSync(f.vars)).toBe(false)
    expect(calls(f)).toEqual([])
  })

  test('--check skips login and setup; normal setup logs in once before infrastructure with the selected config', () => {
    const f = fixture()
    expect(run(f, ['--check']).status).toBe(0)
    expect(calls(f)).toEqual([])
    const external = path.join(f.root, 'external.toml')
    fs.renameSync(f.configFile, external)
    const result = run(f, ['--config', external])
    expect(result.status, result.stderr).toBe(0)
    expect(calls(f)).toEqual([
      { command: 'login', args: ['exec', 'wrangler', 'login'], config: external, cwd: path.join(f.root, 'apps/api'), publicKey: fixturePublic },
      { command: 'infrastructure', args: [path.join(f.root, 'apps/api/script/deploy/setup-backend.sh')], config: external, cwd: f.root, publicKey: fixturePublic }
    ])
    expect(result.stdout).toContain('Start the application separately: pnpm api -- dev')
  })
  test.each(['vars', 'invalid-key', 'remote', 'production', 'docker'])('fails before setup when %s prerequisites are invalid', problem => {
    const f = fixture()
    if (problem === 'vars') fs.unlinkSync(f.vars)
    if (problem === 'invalid-key') fs.appendFileSync(f.vars, 'POWERSYNC_JWK_PRIVATE_KEY=invalid-json\n')
    if (problem === 'remote' || problem === 'production') {
      const config: any = parse(fs.readFileSync(f.configFile, 'utf8'))
      if (problem === 'remote') config.hyperdrive[0].localConnectionString = 'postgresql://sensitive:password@production.invalid/private'
      else config.vars.RUN_ENV = 'prod'
      fs.writeFileSync(f.configFile, stringify(config))
    }
    const result = run(f, ['--check'], problem === 'docker' ? { DOCKER_EXIT: '1' } : {})
    expect(result.status).not.toBe(0)
    expect(calls(f)).toEqual([])
    expect(result.stderr).not.toContain('sensitive:password')
    expect(result.stderr).not.toContain('fixture-private')
  })
  test('uses only the API signing key even if old key files and inherited public parameters disagree', () => {
    const f = fixture()
    const result = run(f, [], { PS_JWK_N: 'stale', PS_JWK_E: 'stale', PS_JWK_KID: 'stale' })
    expect(result.status, result.stderr).toBe(0)
    for (const call of calls(f)) expect(call.publicKey).toEqual(fixturePublic)
    fs.rmSync(f.keys, { recursive: true })
    expect(run(f).status).toBe(0)
    expect(fs.existsSync(f.keys)).toBe(false)
    expect(result.stdout + result.stderr).not.toContain(fixtureKey.d)
  })

  test('derived public key verifies a JWT signed with the API private JWK', async () => {
    const env = powerSyncPublicEnvironment(JSON.stringify(fixtureKey))
    const token = await new SignJWT({ sub: 'fixture-user', aud: 'reader-sync' })
      .setProtectedHeader({ alg: 'RS256', kid: fixtureKey.kid })
      .sign(await importJWK(fixtureKey, 'RS256'))
    const [header, payload, signature] = token.split('.')
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        createPublicKey({ key: { kty: 'RSA', n: env.PS_JWK_N, e: env.PS_JWK_E }, format: 'jwk' }),
        Buffer.from(signature, 'base64url')
      )
    ).toBe(true)
    expect(Object.keys(env).sort()).toEqual(['PS_JWK_E', 'PS_JWK_KID', 'PS_JWK_N'])
  })

  test.each([
    ['invalid JSON', 'not-json', 'valid JSON'],
    ['wrong type', '[]', 'single RSA'],
    ['missing private material', JSON.stringify({ kty: 'RSA', kid: 'test', n: 'test', e: 'AQAB' }), 'missing RSA fields'],
    ['wrong algorithm', JSON.stringify({ ...fixtureKey, alg: 'HS256' }), 'RS256 signing'],
    ['invalid key', JSON.stringify({ ...fixtureKey, n: 'invalid-key' }), 'cannot sign and verify']
  ])('reports %s without disclosing key material', (_name, value, message) => {
    expect(() => powerSyncPublicEnvironment(value)).toThrow(message)
    try {
      powerSyncPublicEnvironment(value)
    } catch (error) {
      expect(String(error)).not.toContain(fixtureKey.d)
    }
  })

  test('login failure prevents infrastructure and infrastructure failure is propagated without launching dev', () => {
    const f = fixture()
    expect(run(f, [], { LOGIN_EXIT: '23' }).status).toBe(23)
    expect(calls(f).map(x => x.command)).toEqual(['login'])
    fs.unlinkSync(f.env.CALLS)
    expect(run(f, [], { SETUP_EXIT: '17' }).status).toBe(17)
    expect(calls(f).map(x => x.command)).toEqual(['login', 'infrastructure'])
  })
  test.each([
    ['SIGINT', 130, 'login'],
    ['SIGTERM', 143, 'login'],
    ['SIGINT', 130, 'infrastructure'],
    ['SIGTERM', 143, 'infrastructure']
  ] as const)(
    '%s stops setup in %s / %s without launching Workers',
    async (signal, status, phase) => {
      const f = fixture()
      const child = spawn(f.executable, [f.entry], { cwd: f.root, env: { ...f.env, WAIT_SIGNAL: phase }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      const closed = new Promise<number | null>((resolve, reject) => {
        child.once('exit', resolve)
        child.once('error', reject)
      })
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid!, 'SIGKILL')
        } catch {}
      }, 8000)
      try {
        await new Promise<void>((resolve, reject) => {
          child.stdout.on('data', data => {
            if (String(data).includes('waiting')) resolve()
          })
          child.once('exit', () => reject(new Error('Exited before waiting for signal')))
        })
        child.kill(signal)
        expect(await closed).toBe(status)
        expect(calls(f).map(x => x.command)).toEqual(phase === 'login' ? ['login'] : ['login', 'infrastructure'])
      } finally {
        clearTimeout(timer)
        try {
          process.kill(-child.pid!, 'SIGKILL')
        } catch {}
      }
    },
    12000
  )
})
