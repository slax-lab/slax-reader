import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { afterEach, describe, expect, test } from 'vitest'
import { API_ROOT, ROOT } from '../../script/root'

const temp: string[] = []
afterEach(() => {
  for (const dir of temp.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
const read = (filename: string) => JSON.parse(fs.readFileSync(filename, 'utf8'))
function fixture() {
  const dir = fs.mkdtempSync(path.join(ROOT, '.tmp-root-tooling-proxy-'))
  temp.push(dir)
  for (const child of ['tooling', 'apps/api', 'bin']) fs.mkdirSync(path.join(dir, child), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'tooling/api.mjs'), path.join(dir, 'tooling/api.mjs'))
  fs.copyFileSync(path.join(ROOT, 'tooling/pnpm-command.mjs'), path.join(dir, 'tooling/pnpm-command.mjs'))
  fs.writeFileSync(path.join(dir, 'apps/api/package.json'), JSON.stringify({ name: 'slax-reader-backend', scripts: { fixture: 'unused' } }))
  fs.writeFileSync(
    path.join(dir, 'bin/pnpm'),
    `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));\nif (process.env.WAIT_SIGNAL) { process.on('SIGTERM',()=>process.exit(0)); process.on('SIGINT',()=>process.exit(0)); setInterval(()=>{},1000) } else process.exit(Number(process.env.EXIT_CODE || 0));\n`,
    { mode: 0o755 }
  )
  return { dir, env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}` } }
}

describe('API workspace command contract', () => {
  test('root exposes one API abstraction and preserves repository checks', () => {
    const root = read(path.join(ROOT, 'package.json'))
    expect(Object.keys(root.scripts).sort()).toEqual(['agent:check', 'agent:sync', 'api', 'extension', 'preflight', 'prepare', 'test:preflight', 'web'])
    expect(root.scripts['agent:check']).toContain('check-gh-aw-drift.sh')
    expect(Object.keys(root.devDependencies).sort()).toEqual(['@fission-ai/openspec', 'lefthook', 'rulesync'])
  })
  test('API owns its commands, Prisma configs and build tools without duplicate root configs', () => {
    const api = read(path.join(API_ROOT, 'package.json'))
    for (const name of [
      'dev',
      'deploy',
      'build',
      'types',
      'gen:all',
      'gen:model',
      'test',
      'test:http',
      'test:integration:local',
      'migration:local',
      'migration:remote:d1',
      'lint',
      'typecheck'
    ])
      expect(api.scripts[name], name).toBeTruthy()
    for (const file of ['tsconfig.json', 'vitest.config.ts', 'eslint.config.mjs', '.prettierrc.mjs', '.editorconfig']) {
      expect(fs.existsSync(path.join(API_ROOT, file)), file).toBe(true)
      expect(fs.existsSync(path.join(ROOT, file)), file).toBe(false)
    }
    for (const kind of ['d1', 'pgsql', 'logs', 'diff']) {
      expect(fs.existsSync(path.join(API_ROOT, `prisma/${kind}.config.ts`))).toBe(true)
      expect(fs.existsSync(path.join(ROOT, `prisma.${kind}.config.ts`))).toBe(false)
    }
    expect(api.devDependencies.prisma).toBe(api.dependencies['@prisma/client'])
  })
  test('passes command and arguments as data, including spaces and shell metacharacters', () => {
    const f = fixture()
    const args = ['--', 'fixture', '--option', 'one two', '$(touch forbidden)', '--', 'literal']
    const result = spawnSync(process.execPath, [path.join(f.dir, 'tooling/api.mjs'), ...args], { env: f.env, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['--filter', 'slax-reader-backend', 'run', ...args.slice(1)])
  })
  test.each([0, 23])('preserves child exit status %s', exit => {
    const f = fixture()
    expect(spawnSync(process.execPath, [path.join(f.dir, 'tooling/api.mjs'), 'fixture'], { env: { ...f.env, EXIT_CODE: String(exit) } }).status).toBe(exit)
  })
  test('rejects unknown commands before invoking pnpm and shows help without configuration', () => {
    const f = fixture()
    const result = spawnSync(process.execPath, [path.join(f.dir, 'tooling/api.mjs'), 'does-not-exist'], { env: f.env, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Unknown API command')
    const help = spawnSync(process.execPath, [path.join(f.dir, 'tooling/api.mjs'), '--', '--help'], { env: f.env, encoding: 'utf8' })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('fixture')
  })
  test.each([
    ['SIGTERM', 143],
    ['SIGINT', 130]
  ] as const)('forwards %s to the command group and returns signal status', async (signal, status) => {
    const f = fixture()
    const child = spawn(process.execPath, [path.join(f.dir, 'tooling/api.mjs'), 'fixture'], { env: { ...f.env, WAIT_SIGNAL: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await new Promise<void>((done, reject) => {
        child.stdout!.once('data', () => done())
        child.once('error', reject)
      })
      const closed = new Promise<number | null>(done => child.once('close', code => done(code)))
      child.kill(signal)
      expect(await closed).toBe(status)
    } finally {
      child.kill('SIGKILL')
    }
  })
})
