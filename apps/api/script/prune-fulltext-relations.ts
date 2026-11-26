import { ROOT } from './root'
import { Client } from 'pg'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// The fulltext database mirrors (user_id, bookmark_id) relations in slax_user_bookmark. Two PostgreSQL deletion paths
// (import-failure batch delete and account deletion) did not remove the mirror row, so it holds relations PostgreSQL
// no longer has. This reads both sides and writes the DELETE statements for the stale mirror rows; it never writes.

export interface MirrorRow {
  user_id: number
  bookmark_id: number
}

// Any relation still in PostgreSQL, trashed or not, keeps its mirror row: a trashed bookmark can be restored.
export const currentRelationsQuery = `SELECT user_id, bookmark_id FROM sr_user_bookmark WHERE user_id = ANY($1::int[])`

export function staleMirrorRows(mirror: MirrorRow[], current: MirrorRow[]): MirrorRow[] {
  const live = new Set(current.map(row => `${Number(row.user_id)}:${Number(row.bookmark_id)}`))
  return mirror.filter(row => !live.has(`${Number(row.user_id)}:${Number(row.bookmark_id)}`))
}

export function pruneSql(rows: MirrorRow[], batch = 200): string {
  const statements: string[] = []
  const byUser = new Map<number, number[]>()
  for (const row of rows) {
    const userId = Number(row.user_id)
    const bookmarkId = Number(row.bookmark_id)
    if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(bookmarkId) || bookmarkId < 1) throw new Error('invalid_mirror_row')
    byUser.set(userId, [...(byUser.get(userId) ?? []), bookmarkId])
  }
  for (const [userId, ids] of [...byUser].sort((a, b) => a[0] - b[0]))
    for (let offset = 0; offset < ids.length; offset += batch)
      statements.push(`DELETE FROM slax_user_bookmark WHERE user_id = ${userId} AND bookmark_id IN (${ids.slice(offset, offset + batch).join(',')});`)
  return statements.length ? statements.join('\n') + '\n' : ''
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(
      [
        'Usage: pnpm api -- fulltext:prune-relations --mirror <file.json> [--output-sql <new-file>]',
        '--mirror: JSON array of {user_id, bookmark_id} exported from the fulltext database, for example',
        '  wrangler d1 execute <fulltext-db> --remote --json --command "SELECT user_id, bookmark_id FROM slax_user_bookmark" > mirror.json',
        'Reads PostgreSQL (HYPERDRIVE_DATABASE_URL) in a read-only transaction and prints the stale row count.',
        '--output-sql writes the DELETE statements to a new file, to be applied with wrangler d1 execute --file. Never applies writes.'
      ].join('\n')
    )
    return
  }
  const flag = (name: string) => {
    const index = args.indexOf(name)
    if (index < 0) return undefined
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    return value
  }
  const mirrorFile = flag('--mirror')
  const output = flag('--output-sql')
  if (!mirrorFile) throw new Error('--mirror is required')
  if (!process.env.HYPERDRIVE_DATABASE_URL) throw new Error('HYPERDRIVE_DATABASE_URL is required')
  const parsed = JSON.parse(await readFile(path.resolve(ROOT, mirrorFile), 'utf8'))
  const mirror: MirrorRow[] = (Array.isArray(parsed) && parsed[0]?.results ? parsed[0].results : parsed) as MirrorRow[]
  const users = [...new Set(mirror.map(row => Number(row.user_id)))]
  const client = new Client({ connectionString: process.env.HYPERDRIVE_DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 60000 })
  await client.connect()
  try {
    await client.query('BEGIN READ ONLY')
    const current: MirrorRow[] = []
    for (let offset = 0; offset < users.length; offset += 500) current.push(...(await client.query<MirrorRow>(currentRelationsQuery, [users.slice(offset, offset + 500)])).rows)
    await client.query('COMMIT')
    const stale = staleMirrorRows(mirror, current)
    if (output) await writeFile(path.resolve(ROOT, output), pruneSql(stale), { flag: 'wx' })
    console.log(JSON.stringify({ mirror: mirror.length, current: current.length, stale: stale.length, output: output || null, applied: false }))
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
