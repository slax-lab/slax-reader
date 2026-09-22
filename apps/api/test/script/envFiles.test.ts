import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, test } from 'vitest'
import { API_ROOT, ROOT } from '../../script/root'

const fixtures: string[] = []
afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function fixture() {
  const root = fs.mkdtempSync(path.join(API_ROOT, 'test/.tmp-root-deployment-env-'))
  fixtures.push(root)
  const api = path.join(root, 'apps/api')
  for (const name of [
    'script/root.ts',
    'script/env.ts',
    'script/deploy/config.ts',
    'script/deploy/wrangler.ts',
    'script/deploy/deploy.ts',
    'script/deploy/build.ts',
    'script/deploy/gen-config.ts',
    'prisma/d1.config.ts',
    'prisma/pgsql.config.ts',
    'prisma/logs.config.ts',
    'prisma/diff.config.ts',
    'prisma/schema.prisma',
    'prisma/pgsql.prisma',
    'prisma/logs.prisma'
  ]) {
    const dest = path.join(api, name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(API_ROOT, name), dest)
  }
  fs.mkdirSync(path.join(root, 'deploy/cloudflare'), { recursive: true })
  fs.mkdirSync(path.join(root, 'deploy/local'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'deploy/cloudflare/api.toml.example'), path.join(root, 'deploy/local/api.toml'))
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
  // All values and environment files here are synthetic fixtures.
  fs.writeFileSync(
    path.join(root, 'deploy/local/.env'),
    [
      'HYPERDRIVE_DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/file_pg',
      'LOGS_DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/file_logs',
      'D1_DIFF_DATABASE_URL=file:fixture.sqlite',
      'CLOUDFLARE_API_TOKEN=fixture-file-token'
    ].join('\n')
  )
  fs.writeFileSync(path.join(api, '.env'), 'CLOUDFLARE_API_TOKEN=wrong-legacy-token\n')
  fs.writeFileSync(path.join(root, '.env'), 'CLOUDFLARE_API_TOKEN=wrong-root-token\n')
  fs.writeFileSync(path.join(root, 'deploy/local/.dev.vars'), 'RUNTIME_FIXTURE=worker-only\n')
  fs.mkdirSync(path.join(root, 'bin'))
  fs.writeFileSync(
    path.join(root, 'bin/wrangler'),
    `#!${process.execPath}
import fs from 'node:fs';
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify({ args: process.argv.slice(2), token: process.env.CLOUDFLARE_API_TOKEN, include: process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV })+'\\n');
`,
    { mode: 0o755 }
  )
  return { root, api }
}

function run(f: ReturnType<typeof fixture>, executable: string, args: string[], extra: NodeJS.ProcessEnv = {}, cwd = f.root) {
  return spawnSync(path.join(API_ROOT, 'node_modules/.bin', executable), args, {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
    env: {
      PATH: `${path.join(f.root, 'bin')}:${process.env.PATH}`,
      HOME: f.root,
      TMPDIR: process.env.TMPDIR,
      CHECKPOINT_DISABLE: '1',
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
      WRANGLER_SEND_METRICS: 'false',
      MOCK_LOG: path.join(f.root, 'calls.jsonl'),
      ...extra
    }
  })
}

describe('automatic API environment files', () => {
  test.each(['pgsql', 'logs', 'd1', 'diff'])(
    'real Prisma CLI validates %s using file configuration',
    target => {
      const f = fixture()
      const result = run(f, 'prisma', ['validate', '--config', path.join(f.api, `prisma/${target}.config.ts`)])
      expect(result.status, result.stderr + result.stdout).toBe(0)
      expect(result.stdout).toContain('valid')
    },
    30000
  )

  test.each(['root', 'api'])('D1 wrapper loads the deployment file from %s cwd and preserves local state', location => {
    const f = fixture()
    const result = run(f, 'tsx', [path.join(f.api, 'script/deploy/wrangler.ts'), 'core', 'd1', 'migrations', 'list', 'DB', '--local'], {}, location === 'root' ? f.root : f.api)
    expect(result.status, result.stderr).toBe(0)
    const call = JSON.parse(fs.readFileSync(path.join(f.root, 'calls.jsonl'), 'utf8'))
    expect(call.token).toBe('fixture-file-token')
    expect(call.include).toBe('false')
    expect(call.args).toEqual(expect.arrayContaining(['--local', '--persist-to', path.join(f.root, 'deploy/local/.wrangler/state')]))
  })

  test('explicit process values, including setup local URLs, override file values without logging secrets', () => {
    const f = fixture()
    const entry = path.join(f.api, 'check.ts')
    fs.writeFileSync(
      entry,
      `import pg from './prisma/pgsql.config'; import logs from './prisma/logs.config';
if (pg.datasource.url !== 'postgresql://local/local_pg' || logs.datasource.url !== 'postgresql://local/local_logs') process.exit(2);`
    )
    const result = run(f, 'tsx', [entry], { HYPERDRIVE_DATABASE_URL: 'postgresql://local/local_pg', LOGS_DATABASE_URL: 'postgresql://local/local_logs' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain('fixture-file-token')
  })

  test('explicit files resolve from repository root and do not merge the default file', () => {
    const f = fixture()
    fs.writeFileSync(path.join(f.root, 'alternate.env'), 'CLOUDFLARE_API_TOKEN=alternate-token\n')
    const entry = path.join(f.api, 'check.ts')
    fs.writeFileSync(
      entry,
      `import { loadApiEnv } from './script/env'; loadApiEnv();
if (process.env.CLOUDFLARE_API_TOKEN !== 'alternate-token' || process.env.HYPERDRIVE_DATABASE_URL) process.exit(2);`
    )
    const result = run(f, 'tsx', [entry], { SLAX_API_ENV_FILE: 'alternate.env' }, f.api)
    expect(result.status, result.stderr).toBe(0)
  })

  test('missing default files allow CI variables; missing explicit and unreadable files fail', () => {
    const f = fixture()
    const entry = path.join(f.api, 'check.ts')
    fs.writeFileSync(entry, `import { loadApiEnv } from './script/env'; loadApiEnv(); if (process.env.CLOUDFLARE_API_TOKEN) process.exit(2);`)
    fs.unlinkSync(path.join(f.root, 'deploy/local/.env'))
    expect(run(f, 'tsx', [entry]).status).toBe(0)
    for (const file of ['missing.env', 'apps/api']) {
      const result = run(f, 'tsx', [entry], { SLAX_API_ENV_FILE: file })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Cannot load API environment file')
      expect(result.stderr).not.toContain('wrong-root-token')
    }
  })

  test('Worker development receives its runtime file separately from tool credentials', () => {
    const f = fixture()
    const result = run(f, 'tsx', [path.join(f.api, 'script/deploy/deploy.ts'), '--dev', 'core'])
    expect(result.status, result.stderr).toBe(0)
    const call = JSON.parse(fs.readFileSync(path.join(f.root, 'calls.jsonl'), 'utf8'))
    expect(call.token).toBe('fixture-file-token')
    expect(call.include).toBe('false')
    expect(call.args).toEqual(expect.arrayContaining(['--env-file', path.join(f.root, 'deploy/local/.dev.vars')]))
  })

  test.each([
    ['build', []],
    ['deploy', ['--dry-run']],
    ['gen-config', []]
  ])('%s offline path does not load tool environment files', (script, args) => {
    const f = fixture()
    const result = run(f, 'tsx', [path.join(f.api, `script/deploy/${script}.ts`), ...args], { SLAX_API_ENV_FILE: 'missing.env' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout + result.stderr).not.toContain('fixture-file-token')
  })
})
