import { ROOT } from './root'
import { Client } from 'pg'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** One audited publisher bookmark: owner relation UUID, correct original time, wrong stored time. */
export interface PublishedAtCorrection {
  uuid: string
  ours: string
  reader: string
}

export type CorrectionOutcome = 'updated' | 'would_update' | 'already_correct' | 'changed_since_audit' | 'not_publisher_owned' | 'not_found'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseCorrections(text: string): PublishedAtCorrection[] {
  const rows = JSON.parse(text)
  if (!Array.isArray(rows)) throw new Error('Expected a JSON array of corrections')
  const seen = new Set<string>()
  return rows.map((row, index) => {
    const ours = new Date(row?.ours)
    const reader = new Date(row?.reader)
    if (typeof row?.uuid !== 'string' || !UUID.test(row.uuid) || Number.isNaN(ours.getTime()) || Number.isNaN(reader.getTime()))
      throw new Error(`Invalid correction at index ${index}`)
    if (seen.has(row.uuid)) throw new Error(`Duplicate correction for ${row.uuid}`)
    seen.add(row.uuid)
    return { uuid: row.uuid, ours: ours.toISOString(), reader: reader.toISOString() }
  })
}

export function publisherIds(value: string | undefined): number[] {
  const ids = (value ?? '')
    .split(',')
    .map(id => Number(id.trim()))
    .filter(id => Number.isSafeInteger(id) && id > 0)
  if (!ids.length) throw new Error('PUBLISHER_USER_IDS must list at least one publisher account')
  return ids
}

// sr_bookmark timestamps have no zone and store UTC; compare and write them as UTC text.
export const lookupSql = `
  SELECT b.id, b.private_user, ub.user_id, to_char(b.published_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS published_at
  FROM sr_user_bookmark ub JOIN sr_bookmark b ON b.id = ub.bookmark_id
  WHERE ub.uuid = $1
`
export const updateSql = `
  UPDATE sr_bookmark SET published_at = ($2::timestamptz AT TIME ZONE 'UTC')
  WHERE id = $1 AND private_user = $3 AND status = 'success'
    AND published_at = ($4::timestamptz AT TIME ZONE 'UTC')
`

type Lookup = { id: number; private_user: number; user_id: number; published_at: string }

export function classify(correction: PublishedAtCorrection, row: Lookup | undefined, publishers: number[]): CorrectionOutcome {
  if (!row) return 'not_found'
  if (row.private_user !== row.user_id || !publishers.includes(row.private_user)) return 'not_publisher_owned'
  if (row.published_at === correction.ours) return 'already_correct'
  if (row.published_at !== correction.reader) return 'changed_since_audit'
  return 'would_update'
}

export async function backfill(client: Pick<Client, 'query'>, corrections: PublishedAtCorrection[], publishers: number[], apply: boolean) {
  const counts: Record<CorrectionOutcome, number> = { updated: 0, would_update: 0, already_correct: 0, changed_since_audit: 0, not_publisher_owned: 0, not_found: 0 }
  const details: { uuid: string; outcome: CorrectionOutcome; from?: string; to: string }[] = []
  for (const correction of corrections) {
    const row = (await client.query<Lookup>(lookupSql, [correction.uuid])).rows[0]
    let outcome = classify(correction, row, publishers)
    if (outcome === 'would_update' && apply) {
      const result = await client.query(updateSql, [row!.id, correction.ours, row!.private_user, correction.reader])
      outcome = result.rowCount === 1 ? 'updated' : 'changed_since_audit'
    }
    counts[outcome]++
    details.push({ uuid: correction.uuid, outcome, from: row?.published_at, to: correction.ours })
  }
  return { counts, details }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(
      'Usage: backfill-publisher-published-at.ts --input <corrections.json> [--apply]\n' +
        'Reads HYPERDRIVE_DATABASE_URL and PUBLISHER_USER_IDS from the environment. Default: dry run that reports each outcome. ' +
        '--apply writes only rows owned by a listed publisher that still hold the audited wrong time.'
    )
    return
  }
  const inputFlag = args.indexOf('--input')
  const input = inputFlag >= 0 ? args[inputFlag + 1] : undefined
  if (!input || input.startsWith('--')) throw new Error('--input <corrections.json> is required')
  if (!process.env.HYPERDRIVE_DATABASE_URL) throw new Error('HYPERDRIVE_DATABASE_URL is required')
  const apply = args.includes('--apply')
  const corrections = parseCorrections(await readFile(path.resolve(ROOT, input), 'utf8'))
  const publishers = publisherIds(process.env.PUBLISHER_USER_IDS)
  const client = new Client({ connectionString: process.env.HYPERDRIVE_DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 60000 })
  await client.connect()
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY')
    const result = await backfill(client, corrections, publishers, apply)
    await client.query('COMMIT')
    for (const row of result.details) if (row.outcome !== 'already_correct') console.log(JSON.stringify(row))
    console.log(JSON.stringify({ applied: apply, total: corrections.length, ...result.counts }))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
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
