import { API_ROOT, ROOT } from './root'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [database, name] = process.argv.slice(2)
if (!database || !name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
  throw new Error('usage: pnpm api -- gen:diff:d1 <local-sqlite-file> <migration-name>')
}
const migrations = path.join(API_ROOT, 'prisma/d1_migrations')
const indices = fs
  .readdirSync(migrations)
  .map(file => Number.parseInt(file.split('_')[0]))
  .filter(Number.isFinite)
const output = path.join(migrations, `${String(Math.max(0, ...indices) + 1).padStart(5, '0')}_${name}.sql`)
const result = spawnSync(
  'prisma',
  ['migrate', 'diff', '--from-config-datasource', '--to-schema', path.join(API_ROOT, 'prisma/schema.prisma'), '--script', '--config', path.join(API_ROOT, 'prisma/diff.config.ts')],
  {
    cwd: API_ROOT,
    encoding: 'utf8',
    env: { ...process.env, D1_DIFF_DATABASE_URL: `file:${path.resolve(ROOT, database)}` }
  }
)
if (result.error || result.status !== 0) throw new Error('D1 migration diff failed; verify the local database and Prisma configuration')
const sql = result.stdout
  .split('\n')
  .filter(line => !line.includes('slax_fts_') && !line.includes('_cf_METADATA'))
  .join('\n')
fs.writeFileSync(output, sql, { flag: 'wx' })
console.log(`Generated ${output}; review the SQL before applying it`)
