import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT } from '../../script/root'
import { LocalResources } from './localResources'
import { powerSyncPublicEnvironment } from '../../script/deploy/setup-api'
import { parse } from 'dotenv'
import { generateKeyPairSync } from 'node:crypto'

async function main() {
  const resources = new LocalResources()
  const project = `slax-setup-${Date.now()}`
  const local = resolve(resources.workspace, 'deploy/local')
  const keys = resolve(local, 'powersync-local')
  const composeFile = resolve(local, 'dockerfile-local-pgsql.yaml')
  const script = resolve(keys, 'init.sh')
  const generator = resolve(resources.workspace, 'apps/api/script/deploy/generate-powersync-keys.mjs')
  mkdirSync(keys, { recursive: true })
  mkdirSync(resolve(generator, '..'), { recursive: true })
  resources.env.COMPOSE_PROJECT_NAME = project
  const compose = ['compose', '--env-file', '/dev/null', '-f', composeFile]
  try {
    // Discover only the executable path, never copy Docker authentication/config files.
    const plugin = spawnSync('docker', ['info', '--format', '{{range .ClientInfo.Plugins}}{{if eq .Name "compose"}}{{.Path}}{{end}}{{end}}'], { encoding: 'utf8' })
    assert.equal(plugin.status, 0, 'Docker Compose metadata is unavailable')
    assert.ok(plugin.stdout.trim(), 'Docker Compose plugin is required')
    const plugins = resolve(resources.home, '.docker/cli-plugins')
    mkdirSync(plugins, { recursive: true })
    symlinkSync(plugin.stdout.trim(), resolve(plugins, 'docker-compose'))
    // Only public templates and freshly generated fixture keys are used.
    resources.command('docker', ['image', 'inspect', 'journeyapps/powersync-service:latest', '--format', '{{.Id}}'])
    for (const name of ['powersync.yaml', 'sync_rules.yaml']) copyFileSync(resolve(ROOT, 'deploy/local/powersync-local', name), resolve(keys, name))
    copyFileSync(resolve(ROOT, 'apps/api/script/deploy/generate-powersync-keys.mjs'), generator)
    resources.command(process.execPath, [generator])
    // The Worker has a different valid key from the obsolete generated files.
    const privateJwk = { ...generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' }), kid: 'api-signing-key', alg: 'RS256' }
    const runtimeFile = resolve(local, '.dev.vars')
    writeFileSync(runtimeFile, `POWERSYNC_JWK_PRIVATE_KEY='${JSON.stringify(privateJwk)}'\n`)
    Object.assign(resources.env, powerSyncPublicEnvironment(parse(readFileSync(runtimeFile)).POWERSYNC_JWK_PRIVATE_KEY))
    writeFileSync(
      composeFile,
      readFileSync(resolve(ROOT, 'deploy/local/dockerfile-local-pgsql.yaml'), 'utf8')
        .replaceAll('dev-postgres', `${project}-pg`)
        .replaceAll('dev-powersync', `${project}-sync`)
        .replaceAll('127.0.0.1:15432:', '127.0.0.1:0:')
        .replaceAll('127.0.0.1:18080:', '127.0.0.1:0:')
        .replaceAll('127.0.0.1:18081:', '127.0.0.1:0:')
        .replace('      - ./init-scripts:/docker-entrypoint-initdb.d\n', '')
    )
    writeFileSync(script, readFileSync(resolve(ROOT, 'deploy/local/powersync-local/init.sh'), 'utf8').replace('PG_CONTAINER="dev-postgres"', `PG_CONTAINER="${project}-pg"`))
    assert.equal(await resources.run('postgres', 'bash', [script, '--postgres-only']), 0)
    const address = resources.command('docker', [...compose, 'port', 'postgres', '5432'])
    const port = address.split(':').at(-1)
    assert.equal(await resources.migrate('main', `postgresql://admin:admin@127.0.0.1:${port}/slax-reader-backend-internal`, 'pgsql'), 0)
    assert.equal(await resources.migrate('logs', `postgresql://admin:admin@127.0.0.1:${port}/slax-reader-logs`, 'logs'), 0)
    assert.equal(await resources.run('powersync', 'bash', [script]), 0)
    for (const service of ['powersync', 'powersync-api']) {
      const address = resources.command('docker', [...compose, 'port', service, '8080'])
      const response = await fetch(`http://${address}/probes/liveness`, { signal: AbortSignal.timeout(5000) })
      assert.equal(response.status, 200)
    }
    const configured = JSON.parse(resources.command('docker', [...compose, 'config', '--format', 'json']))
    for (const name of ['powersync', 'powersync-api']) {
      assert.equal(configured.services[name].environment.PS_JWK_N, privateJwk.n)
      assert.equal(configured.services[name].environment.PS_JWK_KID, privateJwk.kid)
    }
    console.log('PowerSync setup acceptance passed: migrated databases, both services healthy, isolated ports and volumes.')
  } finally {
    try {
      if (readable(composeFile)) resources.command('docker', [...compose, 'down', '--volumes', '--remove-orphans'])
    } finally {
      resources.cleanup()
      resources.removeWorkspace()
    }
  }
}
function readable(file: string) {
  try {
    readFileSync(file)
    return true
  } catch {
    return false
  }
}
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
