import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse, stringify } from 'smol-toml'
import { afterEach, describe, expect, test } from 'vitest'
import { API_ROOT, ROOT } from '../../script/root'

const fixtures: string[] = []
afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = fs.mkdtempSync(path.join(API_ROOT, 'test/.tmp-root-deployment-'))
  fixtures.push(root)
  for (const file of [
    'script/root.ts',
    'script/env.ts',
    'script/generate-worker-types.ts',
    'worker-configuration.d.ts',
    'script/deploy/config.ts',
    'script/deploy/build.ts',
    'script/deploy/deploy.ts',
    'script/deploy/wrangler.ts',
    'script/deploy/gen-config.ts',
    'script/deploy/init-config.ts'
  ]) {
    const dest = path.join(root, 'apps/api', file)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(API_ROOT, file), dest)
  }
  fs.mkdirSync(path.join(root, 'deploy/cloudflare'), { recursive: true })
  fs.mkdirSync(path.join(root, 'deploy/local'), { recursive: true })
  const config = parse(fs.readFileSync(path.join(ROOT, 'deploy/cloudflare/api.toml.example'), 'utf8'))
  fs.writeFileSync(path.join(root, 'deploy/local/api.toml'), stringify(config))
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
  fs.mkdirSync(path.join(root, 'bin'))
  fs.writeFileSync(
    path.join(root, 'bin/wrangler'),
    `#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2), ci=args.indexOf('--config'), ei=args.indexOf('--env-file');
fs.appendFileSync(process.env.MOCK_LOG,JSON.stringify({args,cwd:process.cwd(),config:fs.readFileSync(args[ci+1],'utf8'),empty:ei<0?null:fs.readFileSync(args[ei+1],'utf8'),dotenv:process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV})+'\\n');
if(args[0]==='types') fs.writeFileSync(args[1], '// Begin runtime types\\ninterface FixtureRuntime {}\\n');
process.exit(Number(process.env.MOCK_EXIT||0));
`,
    { mode: 0o755 }
  )
  return root
}
function run(root: string, script: string, args: string[], status = 0, env: NodeJS.ProcessEnv = {}) {
  const filename = script === 'types' ? 'apps/api/script/generate-worker-types.ts' : `apps/api/script/deploy/${script}.ts`
  return spawnSync(path.join(API_ROOT, 'node_modules/.bin/tsx'), [path.join(root, filename), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: `${path.join(root, 'bin')}:${process.env.PATH}`, HOME: root, MOCK_LOG: path.join(root, 'calls.jsonl'), MOCK_EXIT: String(status), ...env }
  })
}
function calls(root: string): any[] {
  const file = path.join(root, 'calls.jsonl')
  return fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map(row => JSON.parse(row))
    : []
}

describe('API build and deployment processes', () => {
  test.each(['absolute', 'relative'])('all tools share an external configuration using a %s selection', selection => {
    const root = fixture()
    const folder = path.join(root, 'operator configuration')
    fs.mkdirSync(folder)
    const external = path.join(folder, 'api.toml')
    const config: any = parse(fs.readFileSync(path.join(root, 'deploy/local/api.toml'), 'utf8'))
    config.compatibility_date = '2025-06-01'
    config.name = 'external-' + config.name
    for (const service of config.services) service.service = 'external-' + service.service
    fs.writeFileSync(external, stringify(config))
    fs.unlinkSync(path.join(root, 'deploy/local/api.toml'))
    const before = fs.readFileSync(external, 'utf8')
    const env = { SLAX_API_CONFIG: selection === 'absolute' ? external : path.relative(root, external) }
    for (const [script, args] of [
      ['build', []],
      ['deploy', ['--dry-run']],
      ['wrangler', ['core', 'd1', 'migrations', 'list', 'DB', '--local']],
      ['gen-config', []],
      ['types', []]
    ] as [string, string[]][]) {
      const result = run(root, script, args, 0, env)
      expect(result.status, `${script}: ${result.stderr}`).toBe(0)
    }
    for (const call of calls(root)) {
      const generated: any = parse(call.config)
      expect(generated.compatibility_date).toBe('2025-06-01')
      if (call.args[0] === 'types') {
        expect(generated.name).toBe('worker-runtime-types')
        expect(call.empty).toBe('')
        expect(generated.vars).toBeUndefined()
      } else expect(generated.name).toMatch(/^external-/)
    }
    expect(fs.readFileSync(external, 'utf8')).toBe(before)
    expect(fs.existsSync(path.join(root, 'deploy/local/api.toml'))).toBe(false)
  })
  test('named native environment is selected once by build, deploy, D1, resources and types', () => {
    const root = fixture()
    const filename = path.join(root, 'deploy/local/api.toml')
    const source: any = parse(fs.readFileSync(filename, 'utf8'))
    const dev = structuredClone(source)
    dev.name = 'selected-core'
    dev.compatibility_date = '2025-07-01'
    for (const service of dev.services) service.service = 'selected-' + service.service
    dev.services.find((x: any) => x.binding === 'CORE').service = dev.name
    source.vars.PRODUCTION_ONLY = 'do-not-inherit'
    source.env = { dev }
    fs.writeFileSync(filename, stringify(source))
    const before = fs.readFileSync(filename, 'utf8')
    for (const [script, args] of [
      ['build', ['--env', 'dev']],
      ['deploy', ['--dev', 'core']],
      ['wrangler', ['core', 'd1', 'migrations', 'list', 'DB', '--local', '--env', 'dev']],
      ['gen-config', ['--env', 'dev']],
      ['types', ['--env', 'dev']]
    ] as [string, string[]][]) {
      const result = run(root, script, args)
      expect(result.status, `${script}: ${result.stderr}`).toBe(0)
    }
    for (const call of calls(root)) {
      const config: any = parse(call.config)
      expect(config.compatibility_date).toBe('2025-07-01')
      expect(config.env).toBeUndefined()
      expect(config.workers).toBeUndefined()
      expect(config.vars?.PRODUCTION_ONLY).toBeUndefined()
      if (call.args[0] !== 'types') expect(config.name).toMatch(/^selected-/)
      expect(call.args).not.toContain('--env')
    }
    expect(fs.readFileSync(filename, 'utf8')).toBe(before)
  })
  test('explicit config wins over environment selection and config:init cannot write into the external repo', () => {
    const root = fixture()
    const local = path.join(root, 'deploy/local/api.toml')
    const external = path.join(root, 'external.toml')
    const original = fs.readFileSync(local, 'utf8')
    fs.writeFileSync(external, '# do not overwrite')
    const env = { SLAX_API_CONFIG: external }
    expect(run(root, 'build', ['--config', local], 0, env).status).toBe(0)
    expect(run(root, 'types', ['--config', local], 0, env).status).toBe(0)
    fs.writeFileSync(path.join(root, 'deploy/cloudflare/api.toml.example'), original)
    fs.unlinkSync(local)
    expect(run(root, 'init-config', [], 0, env).status).toBe(0)
    expect(fs.readFileSync(local, 'utf8')).toBe(original)
    expect(fs.readFileSync(external, 'utf8')).toBe('# do not overwrite')
  })
  test('config initialization never overwrites operator configuration', () => {
    const root = fixture(),
      config = path.join(root, 'deploy/local/api.toml')
    const original = fs.readFileSync(config, 'utf8')
    fs.copyFileSync(config, path.join(root, 'deploy/cloudflare/api.toml.example'))
    fs.unlinkSync(config)
    expect(run(root, 'init-config', []).status).toBe(0)
    fs.writeFileSync(config, '# operator config')
    expect(run(root, 'init-config', []).status).toBe(1)
    expect(fs.readFileSync(config, 'utf8')).toBe('# operator config')
    expect(original).toContain('compatibility_date')
  })
  test('build bundles all Workers offline with empty env, app cwd and temporary configs', () => {
    const root = fixture()
    const result = run(root, 'build', [])
    expect(result.status, result.stderr).toBe(0)
    expect(calls(root)).toHaveLength(4)
    for (const call of calls(root)) {
      expect(call.cwd).toBe(path.join(root, 'apps/api'))
      expect(call.args).toContain('--dry-run')
      expect(call.empty).toBe('')
      expect(call.dotenv).toBe('false')
      expect(fs.existsSync(call.args[call.args.indexOf('--config') + 1])).toBe(false)
    }
  })
  test.each([0, 23])('build status %s leaves active configuration unchanged and cleans temporary files', status => {
    const root = fixture()
    expect(run(root, 'deploy', ['--dry-run']).status).toBe(0)
    const directory = path.join(root, 'deploy/local/.generated')
    const before = fs.readdirSync(directory).map(name => [name, fs.readFileSync(path.join(directory, name), 'utf8')])
    const result = run(root, 'build', [], status)
    expect(result.status, result.stderr).toBe(status)
    expect(calls(root)).toHaveLength(status ? 1 : 4)
    for (const [name, content] of before) expect(fs.readFileSync(path.join(directory, name), 'utf8')).toBe(content)
    expect(fs.readdirSync(directory).some(name => name.startsWith('.build-'))).toBe(false)
  })
  test('deploy dry run only generates configs; invalid or missing inputs never invoke Wrangler', () => {
    const root = fixture()
    expect(run(root, 'deploy', ['--dry-run']).status).toBe(0)
    expect(calls(root)).toEqual([])
    expect(run(root, 'build', ['dev']).status).toBe(1)
    expect(run(root, 'deploy', []).status).toBe(1) // placeholders
    fs.unlinkSync(path.join(root, 'deploy/local/api.toml'))
    expect(run(root, 'build', []).stderr).toContain('configuration is missing')
    expect(calls(root)).toEqual([])
  })
  test('explicit bootstrap orders first deployment and final configs restore internal bindings', () => {
    const root = fixture(),
      file = path.join(root, 'deploy/local/api.toml')
    const config: any = parse(fs.readFileSync(file, 'utf8'))
    config.vars.BACKEND_API_PREFIX = 'https://api.example.com'
    config.vars.RUN_ENV = 'prod'
    for (const [name, key] of [
      ['d1_databases', 'database_id'],
      ['kv_namespaces', 'id'],
      ['hyperdrive', 'id']
    ])
      for (const item of config[name]) item[key] = 'operator-id'
    fs.writeFileSync(file, stringify(config))
    const result = run(root, 'deploy', ['--bootstrap'])
    expect(result.status, result.stderr).toBe(0)
    const output = calls(root).map(call => parse(call.config))
    expect(output.map(config => config.name)).toEqual(['reader-browser', 'reader-core', 'reader-ai', 'reader-edge', 'reader-core'])
    expect(output[1].services).toBeUndefined()
    expect(output[1].workflows).toBeUndefined()
    expect(output[4].services).toBeDefined()
    expect(output[4].workflows).toBeDefined()
  })
  test('local migration wrapper preserves arguments, persistence directory and nonzero status', () => {
    const root = fixture()
    const result = run(root, 'wrangler', ['core', 'd1', 'execute', 'DB', '--local', '--command', 'SELECT 1'], 17)
    expect(result.status, result.stderr).toBe(17)
    const [call] = calls(root)
    expect(call.args).toContain('SELECT 1')
    expect(call.args.slice(-2)).toEqual(['--persist-to', path.join(root, 'deploy/local/.wrangler/state')])
  })
  test('the Wrangler wrapper refuses direct deployment and never invokes Wrangler', () => {
    const root = fixture()
    for (const args of [
      ['edge', 'deploy'],
      ['edge', 'deploy', '--dry-run'],
      ['core', 'publish']
    ]) {
      const result = run(root, 'wrangler', args)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('use pnpm api -- deploy')
    }
    expect(calls(root)).toEqual([])
  })
})
