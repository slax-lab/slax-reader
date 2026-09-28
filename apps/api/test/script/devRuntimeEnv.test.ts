import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse, stringify } from 'smol-toml'
import { afterEach, expect, test } from 'vitest'
import { API_ROOT, ROOT } from '../../script/root'

const fixtures: string[] = []
const servers: net.Server[] = []
afterEach(async () => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(() => resolve(undefined)))))
})

// Everything runs outside the checkout with synthetic configuration and a fake deployment executable.
function harness(local: boolean, runtimeFile: boolean) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'slax-dev-runtime-'))
  fixtures.push(root)
  const api = path.join(root, 'apps/api')
  for (const file of ['script/root.ts', 'script/env.ts', 'script/deploy/config.ts', 'script/deploy/deploy.ts']) {
    const destination = path.join(api, file)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(API_ROOT, file), destination)
  }
  fs.symlinkSync(path.join(API_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir')
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
  const directory = path.join(root, 'deploy/local')
  fs.mkdirSync(directory, { recursive: true })
  const config = parse(fs.readFileSync(path.join(ROOT, 'deploy/cloudflare/api.toml.example'), 'utf8')) as any
  if (!local) {
    config.vars.RUN_ENV = 'prod'
    config.vars.BACKEND_API_PREFIX = 'https://api.example.com'
    for (const [table, key] of [
      ['d1_databases', 'database_id'],
      ['kv_namespaces', 'id'],
      ['hyperdrive', 'id']
    ]) {
      for (const row of config[table] ?? []) row[key] = 'fixture-resource'
    }
  }
  fs.writeFileSync(path.join(directory, 'api.toml'), stringify(config))
  fs.writeFileSync(path.join(directory, '.env'), 'CLOUDFLARE_API_TOKEN=synthetic-tool-credential\n')
  if (runtimeFile) {
    fs.writeFileSync(path.join(directory, '.dev.vars'), 'GOOGLE_CLIENT_ID_TEXT=synthetic-client\nGOOGLE_CLIENT_SECRET_TEXT=synthetic-secret\n')
  }
  fs.mkdirSync(path.join(root, 'bin'))
  fs.writeFileSync(
    path.join(root, 'bin/wrangler'),
    `#!${process.execPath}
import fs from 'node:fs';
import { unstable_getVarsForDev } from 'wrangler';
const args = process.argv.slice(2);
const configPath = args[args.indexOf('--config') + 1];
const index = args.indexOf('--env-file');
const envFiles = index < 0 ? undefined : [args[index + 1]];
// Exercise Wrangler's actual binding loader, but never start or deploy a Worker.
const bindings = args[0] === 'dev' ? unstable_getVarsForDev(configPath, envFiles, {}, undefined, true) : {};
fs.writeFileSync(process.env.MOCK_LOG, JSON.stringify({
  args, bindings,
  load: process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV,
  include: process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV,
  generated: fs.readFileSync(configPath, 'utf8')
}));
`,
    { mode: 0o755 }
  )
  const run = (args: string[], extraEnv: NodeJS.ProcessEnv = {}) =>
    spawnSync(process.execPath, ['--import', 'tsx', path.join(api, 'script/deploy/deploy.ts'), ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20000,
      env: {
        PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
        HOME: root,
        TMPDIR: os.tmpdir(),
        WRANGLER_SEND_METRICS: 'false',
        MOCK_LOG: path.join(root, 'result.json'),
        ...extraEnv
      }
    })
  return { root, run }
}

test.each([
  { local: true, runtimeFile: true },
  { local: true, runtimeFile: false },
  { local: false, runtimeFile: true }
])('runtime file loading: $local local, $runtimeFile file present', ({ local, runtimeFile }) => {
  const { root, run } = harness(local, runtimeFile)
  // The stubbed wrangler never binds ports; skip the dev port guard so the
  // suite does not depend on whether a real dev session is running.
  const result = run([...(local ? ['--dev'] : []), 'core'], { SLAX_API_SKIP_DEV_PORT_GUARD: '1' })
  expect(result.status, result.stderr).toBe(0)
  const call = JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8'))
  const shouldLoad = local && runtimeFile
  expect(call.load).toBe(String(shouldLoad))
  expect(call.include).toBe('false')
  expect(call.args.includes('--env-file')).toBe(shouldLoad)
  expect(call.bindings.GOOGLE_CLIENT_ID_TEXT?.value).toBe(shouldLoad ? 'synthetic-client' : undefined)
  expect(call.bindings.GOOGLE_CLIENT_SECRET_TEXT?.value).toBe(shouldLoad ? 'synthetic-secret' : undefined)
  expect(call.bindings.CLOUDFLARE_API_TOKEN).toBeUndefined()
  expect(call.generated).not.toContain('synthetic-secret')
  expect(call.generated).not.toContain('synthetic-tool-credential')
})

test('dev port guard exits before spawning wrangler when any dev port is occupied', async ctx => {
  const { root, run } = harness(true, false)
  // Occupy a port other than the requested target's: all four are probed.
  const blocker = net.createServer()
  servers.push(blocker)
  const blocked = await new Promise<boolean>(resolve => {
    blocker.once('error', () => resolve(false))
    blocker.listen(8788, '127.0.0.1', () => resolve(true))
  })
  if (!blocked) {
    servers.pop()
    ctx.skip('127.0.0.1:8788 is occupied on this machine')
  }
  const result = run(['--dev', 'core'])
  expect(result.status, result.stderr).toBe(1)
  expect(result.stderr).toContain('127.0.0.1:8788 is already in use')
  // The stub never ran: no call was logged.
  expect(fs.existsSync(path.join(root, 'result.json'))).toBe(false)
})
