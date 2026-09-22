import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse, stringify } from 'smol-toml'
import { afterEach, expect, test } from 'vitest'
import { API_ROOT, ROOT } from '../../script/root'

const fixtures: string[] = []
afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

test.each([
  { local: true, runtimeFile: true },
  { local: true, runtimeFile: false },
  { local: false, runtimeFile: true }
])('runtime file loading: $local local, $runtimeFile file present', ({ local, runtimeFile }) => {
  // Everything runs outside the checkout with synthetic configuration and a fake deployment executable.
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
  const result = spawnSync(process.execPath, ['--import', 'tsx', path.join(api, 'script/deploy/deploy.ts'), ...(local ? ['--dev'] : []), 'core'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20000,
    env: {
      PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
      HOME: root,
      TMPDIR: os.tmpdir(),
      WRANGLER_SEND_METRICS: 'false',
      MOCK_LOG: path.join(root, 'result.json')
    }
  })
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
