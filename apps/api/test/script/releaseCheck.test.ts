import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { parse, stringify, type TomlTable } from 'smol-toml'
import { expect, test } from 'vitest'
import { API_ROOT, ROOT, workerNames } from '../../script/deploy/config'

test('release preflight checks account, identities, remote bindings and explicit named environment offline', () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'slax-release-check-'))
  const config = parse(fs.readFileSync(path.join(ROOT, 'deploy/cloudflare/api.toml.example'), 'utf8'))
  config.account_id = '1'.repeat(32)
  const vars = config.vars as TomlTable
  vars.RUN_ENV = 'prod'
  vars.RUN_TYPE = 'dev'
  vars.BACKEND_API_PREFIX = 'https://api.example.com'
  for (const key of ['d1_databases', 'hyperdrive', 'kv_namespaces'])
    for (const row of config[key] as TomlTable[]) {
      const field = key === 'd1_databases' ? 'database_id' : 'id'
      row[field] = '3'.repeat(32)
      delete row.localConnectionString
    }
  const settings = { accountId: config.account_id, workers: workerNames(config) }
  const configFile = path.join(directory, 'api.toml')
  const settingsFile = path.join(directory, 'settings.json')
  const run = (native = config, selected = settings, environment = '') => {
    fs.writeFileSync(configFile, stringify(native))
    fs.writeFileSync(settingsFile, JSON.stringify(selected))
    return spawnSync(process.execPath, ['--import', 'tsx', 'script/deploy/release-check.ts'], {
      cwd: API_ROOT,
      env: { PATH: process.env.PATH, SLAX_API_CONFIG: configFile, SLAX_API_RELEASE_SETTINGS: settingsFile, SLAX_API_RELEASE_ENVIRONMENT: 'dev', SLAX_API_ENV: environment },
      encoding: 'utf8'
    })
  }
  try {
    const passed = run()
    expect(passed.status, passed.stderr).toBe(0)
    expect(passed.stdout).toBe('')
    expect(passed.stderr).toBe('')
    expect(run(config, { ...settings, accountId: '4'.repeat(32) }).status).not.toBe(0)
    expect(run(config, { ...settings, workers: { ...settings.workers, edge: 'wrong-edge' } }).status).not.toBe(0)
    const missingEdge = structuredClone(config)
    missingEdge.services = (missingEdge.services as TomlTable[]).filter(row => row.binding !== 'EDGE')
    expect(run(missingEdge).status).not.toBe(0)
    const missingDatabase = structuredClone(config)
    delete missingDatabase.d1_databases
    expect(run(missingDatabase).status).not.toBe(0)
    const named = structuredClone(config)
    named.vars = { ...vars, RUN_ENV: 'development' }
    named.env = {
      selected: {
        name: config.name,
        vars,
        services: config.services,
        d1_databases: config.d1_databases,
        kv_namespaces: config.kv_namespaces,
        hyperdrive: config.hyperdrive,
        queues: config.queues
      }
    }
    expect(run(named).status).not.toBe(0)
    expect(run(named, settings, 'selected').status).toBe(0)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
