import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..')
const TMP_BASE = path.join(REPO_ROOT, 'apps/api/test/.tmp-setup-backend')

const MOCK_NODE = `#!/bin/sh
if [ "$1" = "-p" ]; then echo "22.23.1"; exit 0; fi
if [ "$1" = "-v" ]; then echo "v22.23.1"; exit 0; fi
echo "mock node: unsupported args $*" >&2
exit 1
`

const MOCK_PNPM = `#!/bin/sh
echo "pnpm $* | HYPERDRIVE_DATABASE_URL=$HYPERDRIVE_DATABASE_URL LOGS_DATABASE_URL=$LOGS_DATABASE_URL | cwd=$PWD" >> "$MOCK_LOG"
if [ -n "\${MOCK_PNPM_FAIL_CONTAINS:-}" ]; then
  case " $* " in
    *"$MOCK_PNPM_FAIL_CONTAINS"*) echo "mock pnpm: forced failure" >&2; exit 1 ;;
  esac
fi
exit 0
`

const MOCK_DOCKER = `#!/bin/sh
echo "docker $*" >> "$MOCK_LOG"
if [ -n "\${MOCK_DOCKER_FAIL_CONTAINS:-}" ]; then
  case " $* " in
    *"$MOCK_DOCKER_FAIL_CONTAINS"*) echo "mock docker: forced failure" >&2; exit 1 ;;
  esac
fi
case " $* " in
  *" psql "*)
    echo "--- stdin for: docker $*" >> "$MOCK_STDIN_LOG"
    cat >> "$MOCK_STDIN_LOG"
    ;;
esac
exit 0
`

interface RunResult {
  status: number
  stdout: string
  stderr: string
  log: string
  stdinLog: string
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(TMP_BASE + '-')
  fs.mkdirSync(path.join(dir, 'apps/api'), { recursive: true })
  for (const file of ['apps/api/script/deploy/setup-backend.sh', 'deploy/local/powersync-local/init.sh', 'deploy/local/dockerfile-local-pgsql.yaml']) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.copyFileSync(path.join(REPO_ROOT, file), path.join(dir, file))
  }
  fs.mkdirSync(path.join(dir, 'deploy/local'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'deploy/local/api.toml'), '# fixture')
  fs.writeFileSync(path.join(dir, 'deploy/local/powersync-local/compose.env'), 'PS_JWK_N=fixture\n')
  for (const name of ['dev-jwks-public.json', 'dev-jwks-private.json']) fs.writeFileSync(path.join(dir, 'deploy/local/powersync-local', name), '{}')

  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'node'), MOCK_NODE, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'pnpm'), MOCK_PNPM, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'docker'), MOCK_DOCKER, { mode: 0o755 })
  return dir
}

function runSetup(repo: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): RunResult {
  const log = path.join(repo, 'mock.log')
  const stdinLog = path.join(repo, 'mock-stdin.log')
  const res = spawnSync('bash', [path.join(repo, 'apps/api/script/deploy/setup-backend.sh'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      HYPERDRIVE_DATABASE_URL: '',
      LOGS_DATABASE_URL: '',
      PS_JWK_N: 'fixture',
      PS_JWK_E: 'AQAB',
      PS_JWK_KID: 'fixture',
      ...extraEnv,
      PATH: path.join(repo, 'bin') + ':' + process.env.PATH,
      MOCK_LOG: log,
      MOCK_STDIN_LOG: stdinLog
    }
  })
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
    stdinLog: fs.existsSync(stdinLog) ? fs.readFileSync(stdinLog, 'utf8') : ''
  }
}

function runInit(repo: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): RunResult {
  const log = path.join(repo, 'mock.log')
  const stdinLog = path.join(repo, 'mock-stdin.log')
  const res = spawnSync('bash', [path.join(repo, 'deploy/local/powersync-local/init.sh'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PS_JWK_N: 'fixture',
      PS_JWK_E: 'AQAB',
      PS_JWK_KID: 'fixture',
      ...extraEnv,
      PATH: path.join(repo, 'bin') + ':' + process.env.PATH,
      MOCK_LOG: log,
      MOCK_STDIN_LOG: stdinLog
    }
  })
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
    stdinLog: fs.existsSync(stdinLog) ? fs.readFileSync(stdinLog, 'utf8') : ''
  }
}

function logOrder(log: string): string[] {
  return log
    .split('\n')
    .filter(Boolean)
    .map(line => line.split(' | ')[0])
}

function indexOfLine(lines: string[], needle: string): number {
  return lines.findIndex(line => line.includes(needle))
}

let repos: string[] = []
function newRepo(): string {
  const dir = makeRepo()
  repos.push(dir)
  return dir
}

beforeEach(() => {
  fs.mkdirSync(TMP_BASE, { recursive: true })
})

afterEach(() => {
  for (const dir of repos) fs.rmSync(dir, { recursive: true, force: true })
  repos = []
})

describe('apps/api/script/deploy/setup-backend.sh', () => {
  it('--help prints usage and exits 0', () => {
    const repo = newRepo()
    const res = runSetup(repo, ['--help'])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain('use pnpm api -- setup:api')
    expect(res.log).toBe('')
  })

  it('rejects unknown arguments', () => {
    const repo = newRepo()
    const res = runSetup(repo, ['--bogus'])
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain('unknown argument')
  })

  it('runs setup steps in the correct order with --no-start', () => {
    const repo = newRepo()
    const res = runSetup(repo, ['--no-start'])
    expect(res.status).toBe(0)
    expect(res.log).toContain('pnpm api -- setup:api --check')

    const lines = logOrder(res.log)
    const installIdx = indexOfLine(lines, 'pnpm install --frozen-lockfile')
    const pgUpIdx = lines.findIndex(line => /docker compose .* up -d postgres$/.test(line))
    const pgsqlIdx = indexOfLine(lines, 'api -- migration:deploy:pgsql')
    const logsIdx = indexOfLine(lines, 'api -- migration:deploy:logs')
    const d1Idx = indexOfLine(lines, 'pnpm api -- migration:local:d1')
    const fulltextIdx = indexOfLine(lines, 'pnpm api -- migration:local:fulltext')
    const genIdx = indexOfLine(lines, 'pnpm api -- gen:all')
    const pnpmLines = res.log.split('\n').filter(line => line.startsWith('pnpm '))
    expect(pnpmLines).toHaveLength(7)
    for (const line of pnpmLines) expect(line).toContain(` | cwd=${repo}`)

    for (const idx of [installIdx, pgUpIdx, pgsqlIdx, logsIdx, d1Idx, fulltextIdx, genIdx]) {
      expect(idx).toBeGreaterThanOrEqual(0)
    }
    expect(installIdx).toBeLessThan(pgUpIdx)
    expect(pgUpIdx).toBeLessThan(pgsqlIdx)
    expect(pgsqlIdx).toBeLessThan(logsIdx)
    expect(logsIdx).toBeLessThan(d1Idx)
    expect(d1Idx).toBeLessThan(fulltextIdx)
    expect(fulltextIdx).toBeLessThan(genIdx)

    // powersync services started via full init.sh run after codegen
    const upAllIdx = lines.findIndex(line => /docker compose .* up -d --wait --wait-timeout 120$/.test(line))
    expect(upAllIdx).toBeGreaterThan(genIdx)

    // Infrastructure setup never launches API Workers
    expect(indexOfLine(lines, 'pnpm api -- dev')).toBe(-1)
  })

  it('runs preflight even when .dev.vars exists', () => {
    const repo = newRepo()
    fs.writeFileSync(path.join(repo, 'deploy/local/.dev.vars'), 'SOME_KEY=x\n')
    const res = runSetup(repo, ['--no-start'])
    expect(res.status).toBe(0)
    expect(res.stderr).not.toContain('deploy/local/.dev.vars is missing')
  })

  it('stops before PostgreSQL mutation when the shared preflight reports missing or invalid configuration', () => {
    const res = runSetup(newRepo(), [], { MOCK_PNPM_FAIL_CONTAINS: 'setup:api --check' })
    expect(res.status).not.toBe(0)
    expect(res.log).not.toContain('up -d postgres')
    expect(res.log).not.toContain('migration:deploy:')
  })

  it('does not claim success when PowerSync fails its health check', () => {
    const res = runSetup(newRepo(), [], { MOCK_DOCKER_FAIL_CONTAINS: '--wait' })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain('PowerSync startup failed')
    expect(res.stdout).not.toContain('infrastructure is healthy')
    expect(res.log).toContain('ps -a')
  })

  it('only initializes by default and confirms Workers remain stopped', () => {
    const repo = newRepo()
    const res = runSetup(repo)
    expect(res.status).toBe(0)
    const lines = logOrder(res.log)
    expect(lines).not.toContain('pnpm api -- dev')
    expect(res.stdout).toContain('API Workers have not been started')
    expect(res.stdout).toContain('infrastructure is healthy')
  })

  it('pins local postgres URLs for prisma commands instead of inheriting the environment', () => {
    const repo = newRepo()
    const res = runSetup(repo, ['--no-start'], {
      HYPERDRIVE_DATABASE_URL: 'postgresql://remote-host:5432/evil',
      LOGS_DATABASE_URL: 'postgresql://remote-host:5432/evil-logs'
    })
    expect(res.status).toBe(0)
    const migrateLines = res.log.split('\n').filter(line => line.includes('migration:deploy:'))
    expect(migrateLines.length).toBe(2)
    for (const line of migrateLines) {
      expect(line).toContain('HYPERDRIVE_DATABASE_URL=postgresql://admin:admin@localhost:15432/slax-reader-backend-internal')
      expect(line).toContain('LOGS_DATABASE_URL=postgresql://admin:admin@localhost:15432/slax-reader-logs')
      expect(line).not.toContain('remote-host')
    }
  })

  it('accepts an external configuration without requiring a default local copy', () => {
    const repo = newRepo()
    const external = path.join(repo, 'operator.toml')
    fs.renameSync(path.join(repo, 'deploy/local/api.toml'), external)
    expect(runSetup(repo, [], { SLAX_API_CONFIG: external }).status).toBe(0)
    expect(runSetup(repo, [], { SLAX_API_CONFIG: 'operator.toml' }).status).toBe(0)
    expect(fs.readFileSync(external, 'utf8')).toBe('# fixture')
  })

  it('stops immediately when a step fails', () => {
    const repo = newRepo()
    const res = runSetup(repo, ['--no-start'], { MOCK_PNPM_FAIL_CONTAINS: 'migration:deploy:pgsql' })
    expect(res.status).not.toBe(0)
    const lines = logOrder(res.log)
    expect(indexOfLine(lines, 'api -- migration:deploy:pgsql')).toBeGreaterThanOrEqual(0)
    expect(indexOfLine(lines, 'api -- migration:deploy:logs')).toBe(-1)
    expect(indexOfLine(lines, 'pnpm api -- gen:all')).toBe(-1)
    expect(indexOfLine(lines, 'pnpm api -- dev')).toBe(-1)
  })

  it('stops when postgres startup fails inside init.sh', () => {
    const repo = newRepo()
    const res = runSetup(repo, ['--no-start'], { MOCK_DOCKER_FAIL_CONTAINS: 'up -d postgres' })
    expect(res.status).not.toBe(0)
    const lines = logOrder(res.log)
    expect(indexOfLine(lines, 'migration:deploy:')).toBe(-1)
    expect(indexOfLine(lines, 'pnpm api -- gen:all')).toBe(-1)
  })

  it('does not create an obsolete root .wrangler symlink', () => {
    const repo = newRepo()
    expect(runSetup(repo, ['--no-start']).status).toBe(0)
    expect(fs.existsSync(path.join(repo, '.wrangler'))).toBe(false)
  })

  it('keeps an existing real .wrangler directory', () => {
    const repo = newRepo()
    const link = path.join(repo, '.wrangler')
    fs.mkdirSync(link)
    fs.writeFileSync(path.join(link, 'keep.txt'), 'keep')
    const res = runSetup(repo, ['--no-start'])
    expect(res.status).toBe(0)
    expect(fs.lstatSync(link).isDirectory()).toBe(true)
    expect(fs.existsSync(path.join(link, 'keep.txt'))).toBe(true)
  })

  it('leaves an unrelated root .wrangler symlink untouched', () => {
    const repo = newRepo()
    fs.symlinkSync('somewhere-else', path.join(repo, '.wrangler'))
    expect(runSetup(repo, ['--no-start']).status).toBe(0)
    expect(fs.readlinkSync(path.join(repo, '.wrangler'))).toBe('somewhere-else')
  })
})

describe('deploy/local/powersync-local/init.sh', () => {
  it('starts postgres, waits with pg_isready, and applies idempotent SQL with ON_ERROR_STOP', () => {
    const repo = newRepo()
    const res = runInit(repo, ['--postgres-only'])
    expect(res.status).toBe(0)

    const lines = logOrder(res.log)
    expect(lines.some(line => /docker compose .* up -d postgres$/.test(line))).toBe(true)
    expect(lines.some(line => line.includes('pg_isready -h 127.0.0.1 -U admin'))).toBe(true)
    expect(lines.some(line => line.includes('down'))).toBe(false)
    // --postgres-only must not start powersync (no bare `up -d`)
    expect(lines.some(line => /docker compose .* up -d --wait --wait-timeout 120$/.test(line))).toBe(false)

    // psql is invoked with ON_ERROR_STOP and against the postgres database for db creation
    expect(res.stdinLog).toContain('psql -v ON_ERROR_STOP=1 -U admin -d postgres')
    expect(res.stdinLog).toContain('psql -v ON_ERROR_STOP=1 -U admin -d slax-reader-backend-internal')

    // idempotent guards
    expect(res.stdinLog).toContain('WHERE NOT EXISTS (SELECT FROM pg_database')
    expect(res.stdinLog).toContain('slax-reader-backend-internal')
    expect(res.stdinLog).toContain('slax-reader-logs')
    expect(res.stdinLog).toContain('powersync')
    expect(res.stdinLog).toContain('IF NOT EXISTS (SELECT FROM pg_roles')
    expect(res.stdinLog).toContain('WHERE NOT EXISTS (SELECT FROM pg_publication')
    expect(res.stdinLog).toContain('CREATE PUBLICATION powersync FOR ALL TABLES')
  })

  it('is safe to run twice (idempotent SQL on repeated runs)', () => {
    const repo = newRepo()
    expect(runInit(repo, ['--postgres-only']).status).toBe(0)
    const second = runInit(repo, ['--postgres-only'])
    expect(second.status).toBe(0)
    expect(second.stdinLog).toContain('WHERE NOT EXISTS')
  })

  it('starts powersync services when --postgres-only is not given', () => {
    const repo = newRepo()
    const res = runInit(repo)
    expect(res.status).toBe(0)
    const lines = logOrder(res.log)
    expect(lines.some(line => /docker compose .* up -d --wait --wait-timeout 120$/.test(line))).toBe(true)
  })

  it('reports missing derived PowerSync parameters before starting any containers', () => {
    const repo = newRepo()
    fs.unlinkSync(path.join(repo, 'deploy/local/powersync-local/compose.env'))
    fs.unlinkSync(path.join(repo, 'deploy/local/powersync-local/dev-jwks-private.json'))
    const res = runInit(repo, [], { PS_JWK_N: '' })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain('PS_JWK_N')
    expect(res.log).toBe('')
  })

  it('fails when postgres never becomes ready', () => {
    const repo = newRepo()
    const res = runInit(repo, ['--postgres-only'], { MOCK_DOCKER_FAIL_CONTAINS: 'pg_isready', PG_READY_MAX_ATTEMPTS: '2' })
    expect(res.status).not.toBe(0)
    expect(res.stderr).toContain('did not become ready')
  })
})
