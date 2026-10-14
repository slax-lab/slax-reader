import { ROOT } from './root'
import { Client } from 'pg'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export interface AliasBackfillRow {
  device_id: string
  user_id: number | string
  bound_at: Date | string
}

export const aliasBackfillQuery = `
  SELECT BTRIM(extra_data->>'visitor_id') AS device_id, user_id, MIN(event_time) AS bound_at
  FROM user_logs
  WHERE user_id > 0 AND NULLIF(BTRIM(extra_data->>'visitor_id'), '') IS NOT NULL
  GROUP BY BTRIM(extra_data->>'visitor_id'), user_id
  ORDER BY user_id, device_id
`

export function aliasBackfillSql(rows: AliasBackfillRow[]): string {
  const quote = (value: string) => {
    if (value.includes('\0')) throw new Error('Invalid null byte in device ID')
    return `'${value.replaceAll("'", "''")}'`
  }
  return (
    rows
      .map(row => {
        const userId = Number(row.user_id)
        if (!row.device_id.trim() || !Number.isSafeInteger(userId) || userId < 1) throw new Error('Invalid alias identity')
        const boundAt = new Date(row.bound_at)
        if (Number.isNaN(boundAt.getTime())) throw new Error('Invalid binding time')
        return `INSERT OR IGNORE INTO user_device_alias (device_id, user_id, bound_at, bind_source) VALUES (${quote(row.device_id)}, ${userId}, ${quote(boundAt.toISOString())}, 'backfill');`
      })
      .join('\n') + '\n'
  )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('Read-only PG extraction. Default: print row count. Optional: --output-sql <new-file> writes an idempotent D1 SQL file. Never applies remote writes.')
    return
  }
  const outputFlag = args.indexOf('--output-sql')
  const output = outputFlag >= 0 ? args[outputFlag + 1] : undefined
  if (outputFlag >= 0 && (!output || output.startsWith('--'))) throw new Error('--output-sql requires a new file path')
  if (!process.env.LOGS_DATABASE_URL) throw new Error('LOGS_DATABASE_URL is required')
  const client = new Client({ connectionString: process.env.LOGS_DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 60000 })
  await client.connect()
  try {
    await client.query('BEGIN READ ONLY')
    const result = await client.query<AliasBackfillRow>(aliasBackfillQuery)
    await client.query('COMMIT')
    if (output) await writeFile(path.resolve(ROOT, output), aliasBackfillSql(result.rows), { flag: 'wx' })
    console.log(JSON.stringify({ pairs: result.rows.length, output: output || null, applied: false }))
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
