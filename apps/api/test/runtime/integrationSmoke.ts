import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LocalResources } from './localResources'

const resources = new LocalResources()
const results: Record<string, { status: string; reason?: string; exitCode?: number }> = {}
const test = async (name: string, env: NodeJS.ProcessEnv) => {
  const exitCode = await resources.run(
    name,
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.config.ts',
      `test/infra/${name}.test.ts`,
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${resolve(resources.workspace, `${name}.json`)}`
    ],
    env
  )
  results[name] = { status: exitCode === 0 ? 'passed' : 'failed', exitCode }
}

async function main() {
  try {
    try {
      const redis = await resources.container('redis:7-alpine')
      await test('oauthRedis', { OAUTH_TEST_REDIS_PORT: String(redis.port) })
    } catch (error) {
      results.oauthRedis = { status: 'blocked', reason: String(error) }
    }
    let pg: Awaited<ReturnType<LocalResources['container']>> | undefined
    let fixedPort = true
    try {
      pg = await resources.container('postgres:17-alpine', { name: 'slax-payment-review', port: 6543 })
    } catch (error) {
      fixedPort = false
      results.fixedPostgres = { status: 'blocked', reason: String(error) }
      pg = await resources.container('postgres:17-alpine')
    }
    if (fixedPort) await test('collectionReadPagination.integration', { RUN_COLLECTION_READ_SQL: '1' })
    else results['collectionReadPagination.integration'] = { status: 'blocked', reason: 'Fixed-name container was not exclusively created by this run' }
    for (const db of ['runtime_reader', 'runtime_logs', 'payment_reader_clean', 'payment_test']) resources.sql(pg.id, 'postgres', `CREATE DATABASE ${db};`)
    const url = (database: string) => `postgresql://postgres@127.0.0.1:${pg.port}/${database}`
    const pgStatus = await resources.migrate('migrate-pgsql', url('runtime_reader'), 'pgsql')
    const logsStatus = await resources.migrate('migrate-logs', url('runtime_logs'), 'logs')
    results.pgsqlMigrations = { status: pgStatus === 0 ? 'passed' : 'failed', exitCode: pgStatus }
    results.logsMigrations = { status: logsStatus === 0 ? 'passed' : 'failed', exitCode: logsStatus }
    const env = { RUN_PG_INTEGRATION_TESTS: '1', HYPERDRIVE_DATABASE_URL: url('runtime_reader'), LOGS_DATABASE_URL: url('runtime_logs') }
    for (const name of ['tagIntersection.integration', 'tagRepo.integration', 'labRepo.integration', 'collectionTriggers.integration']) {
      if (pgStatus === 0) await test(name, env)
      else results[name] = { status: 'blocked', reason: 'Historical PostgreSQL migrations failed; no db push, migration edits, or partial-schema run allowed' }
    }
    if (logsStatus === 0) await test('collectionTelemetryLogs.integration', env)
    else results['collectionTelemetryLogs.integration'] = { status: 'blocked', reason: 'Historical logs migrations failed' }
    for (const [name, db, flag] of [
      ['paymentPostgres', 'payment_reader_clean', 'PAYMENT_LOCAL_PG_TEST'],
      ['accountRevocationPostgres', 'payment_test', 'ACCOUNT_LOCAL_PG_TEST']
    ]) {
      if (!fixedPort || pgStatus !== 0) {
        results[name] = { status: 'blocked', reason: !fixedPort ? 'Port 6543 was not exclusively owned by this run' : 'Historical PostgreSQL migrations failed' }
        continue
      }
      const status = await resources.migrate(`migrate-${db}`, url(db), 'pgsql')
      if (status === 0) await test(name, { [flag]: '1' })
      else results[name] = { status: 'blocked', reason: 'Historical PostgreSQL migrations failed', exitCode: status }
    }
  } catch (error) {
    results.runner = { status: 'failed', reason: String(error) }
  } finally {
    resources.cleanup()
    writeFileSync(resolve(resources.workspace, 'results.json'), JSON.stringify(results, null, 2))
    console.log(JSON.stringify(results, null, 2))
    if (Object.values(results).some(result => result.status !== 'passed')) process.exitCode = 1
  }
}
void main()
