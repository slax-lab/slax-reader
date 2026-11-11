import { Client } from 'pg'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const REFRESH_STAGES = ['article', 'article-preference', 'collection', 'subscription'] as const
export type RefreshStage = (typeof REFRESH_STAGES)[number]

export interface RefreshOptions {
  user?: number
  ids?: number[]
  kind?: RefreshStage
  afterId: number
  batch: number
  dryRun: boolean
}

export type RefreshRow = { cursor: number; userId: number; bookmarkId: number } | { cursor: number; userId: number } | { cursor: number; collectionId: number }

export interface EnumerationDatabase {
  query(text: string, values: unknown[]): Promise<{ rows: { id: number; user_id?: number; bookmark_id?: number }[] }>
}

const REFRESH_ENDPOINTS = {
  article: '/v1/bookmark/vector/refresh',
  'article-preference': '/v1/bookmark/preference/refresh',
  collection: '/v1/collection/vector/refresh',
  subscription: '/v1/collection/preference/refresh'
} as const

function integer(value: string, minimum = 1): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) throw new Error('invalid_integer')
  return Number(value)
}

export function parseRefreshOptions(args: string[]): RefreshOptions {
  const options: RefreshOptions = { batch: 10, dryRun: false, afterId: 0 }
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    if (seen.has(key)) throw new Error('duplicate_option')
    seen.add(key)
    if (key === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (!['--user', '--ids', '--kind', '--batch', '--after-id'].includes(key)) throw new Error('unknown_option')
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error('missing_option_value')
    if (key === '--user') options.user = integer(value)
    if (key === '--batch') options.batch = integer(value)
    if (key === '--after-id') options.afterId = integer(value, 0)
    if (key === '--ids') {
      options.ids = [...new Set(value.split(',').map(value => integer(value)))].sort((a, b) => a - b)
      if (options.ids.length > 1000) throw new Error('too_many_ids')
    }
    if (key === '--kind') {
      if (!REFRESH_STAGES.includes(value as RefreshStage)) throw new Error('invalid_kind')
      options.kind = value as RefreshStage
    }
  }
  if (options.batch > 50) throw new Error('batch_exceeds_50')
  if (options.ids && !options.kind) throw new Error('ids_require_kind')
  if (seen.has('--after-id') && !options.kind) throw new Error('after_id_requires_kind')
  return options
}

export async function enumeratePage(db: EnumerationDatabase, stage: RefreshStage, cursor: number, options: RefreshOptions): Promise<{ cursor: number; rows: RefreshRow[] }> {
  const values = [cursor, options.user ?? null, options.ids ?? null, options.batch]
  let sql: string
  if (stage === 'article') {
    sql = `SELECT ub.id, ub.user_id, ub.bookmark_id FROM sr_user_bookmark ub JOIN sr_bookmark b ON b.id = ub.bookmark_id
      JOIN sr_user owner ON owner.id = ub.user_id
      WHERE ub.id > $1 AND ub.deleted_at IS NULL AND owner.deleted_at IS NULL
        AND ub.type IN (0, 2) AND (b.private_user = 0 OR b.private_user = ub.user_id)
        AND ($2::int IS NULL OR ub.user_id = $2) AND ($3::int[] IS NULL OR ub.id = ANY($3))
      ORDER BY ub.id LIMIT $4`
  } else if (stage === 'collection') {
    sql = `SELECT c.id FROM sr_user_collection c JOIN sr_user owner ON owner.id = c.owner_id
      WHERE c.id > $1 AND (c.status = 1 OR $3::int[] IS NOT NULL) AND owner.deleted_at IS NULL
        AND ($2::int IS NULL OR c.owner_id = $2) AND ($3::int[] IS NULL OR c.id = ANY($3))
      ORDER BY c.id LIMIT $4`
  } else {
    sql = `SELECT u.id FROM sr_user u
      WHERE u.id > $1 AND u.deleted_at IS NULL
        AND ($2::int IS NULL OR u.id = $2) AND ($3::int[] IS NULL OR u.id = ANY($3))
      ORDER BY u.id LIMIT $4`
  }
  const { rows } = await db.query(sql, values)
  if (rows.length > options.batch) throw new Error('invalid_enumeration')
  let previous = cursor
  const targets = rows.map((row): RefreshRow => {
    if (!Number.isSafeInteger(row.id) || row.id <= previous) throw new Error('invalid_enumeration')
    previous = row.id
    if (stage === 'article') {
      if (!Number.isSafeInteger(row.user_id) || row.user_id! < 1 || !Number.isSafeInteger(row.bookmark_id) || row.bookmark_id! < 1) throw new Error('invalid_enumeration')
      return { cursor: row.id, userId: row.user_id!, bookmarkId: row.bookmark_id! }
    }
    return stage === 'collection' ? { cursor: row.id, collectionId: row.id } : { cursor: row.id, userId: row.id }
  })
  return { rows: targets, cursor: previous }
}

export function refreshEndpoint(raw: string | undefined): URL {
  if (!raw) throw new Error('missing_vector_refresh_url')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('invalid_vector_refresh_url')
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('invalid_vector_refresh_url')
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('invalid_vector_refresh_url')
  return url
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function summarizeResult(value: unknown): { result: Record<string, unknown>; pending: boolean; failed: boolean } {
  if (!record(value) || typeof value.state !== 'string' || !['written', 'deleted', 'empty', 'pending', 'failed'].includes(value.state)) throw new Error('invalid_refresh_response')
  const result: Record<string, unknown> = { state: value.state }
  const pending = value.state === 'pending'
  const failed = value.state === 'failed'
  if (
    typeof value.reason === 'string' &&
    (/^[a-z_]{1,100}$/.test(value.reason) ||
      /^missing_dependency:(?:a:[1-9]\d*:[1-9]\d*(?::c:(?:0|[1-9]\d*))?|c:[1-9]\d*|u:[1-9]\d*:(?:article(?::centered)?|collection))$/.test(value.reason))
  )
    result.reason = value.reason
  if (record(value.coverage)) {
    const { eligible, used, missing } = value.coverage
    if ([eligible, used, missing].every(count => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) && eligible === (used as number) + (missing as number))
      result.coverage = { eligible, used, missing }
  }
  return { result, pending, failed }
}

export function readRefreshResponse(payload: unknown) {
  if (!record(payload) || payload.code !== 200 || !Object.prototype.hasOwnProperty.call(payload, 'data')) throw new Error('invalid_refresh_response')
  return summarizeResult(payload.data)
}

export interface RefreshDependencies {
  db: EnumerationDatabase
  send: (stage: RefreshStage, row: RefreshRow) => Promise<unknown>
  log?: (message: string) => void
  stopped?: () => boolean
}

export async function runVectorRefresh(options: RefreshOptions, dependencies: RefreshDependencies) {
  const stages = options.kind ? [options.kind] : [...REFRESH_STAGES]
  const counts = { received: 0, pending: 0, failed: 0 }
  let enumerated = 0
  for (const stage of stages) {
    let cursor = options.afterId
    while (true) {
      if (dependencies.stopped?.()) throw new Error('refresh_interrupted')
      const page = await enumeratePage(dependencies.db, stage, cursor, options)
      if (!page.rows.length) break
      enumerated += page.rows.length
      if (options.dryRun) {
        dependencies.log?.(JSON.stringify({ stage, afterId: cursor, nextAfterId: page.cursor, dryRun: true, rows: page.rows }))
      } else {
        for (const row of page.rows) {
          if (dependencies.stopped?.()) throw new Error('refresh_interrupted')
          let response: ReturnType<typeof readRefreshResponse>
          try {
            response = readRefreshResponse(await dependencies.send(stage, row))
          } catch {
            if (dependencies.stopped?.()) throw new Error('refresh_interrupted')
            counts.failed++
            dependencies.log?.(JSON.stringify({ stage, ...row, afterId: cursor, failed: true, reason: 'refresh_request_failed' }))
            cursor = row.cursor
            continue
          }
          counts.received++
          if (response.pending) counts.pending++
          if (response.failed) counts.failed++
          dependencies.log?.(JSON.stringify({ stage, ...row, afterId: cursor, ...response }))
          cursor = row.cursor
        }
      }
      cursor = page.cursor
    }
  }
  return { counts, enumerated }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      [
        'pnpm api -- vector:refresh [--user ID] [--kind article|article-preference|collection|subscription] [--ids ID,ID] [--after-id ID] [--batch 10] [--dry-run]',
        'Batch: 1..50, default 10; SQL page size only. HTTP requests are sequential with one outstanding request and one target per POST.',
        '--ids and --after-id require one --kind. Article IDs/cursors are sr_user_bookmark.id enumeration keys only; the request body is the raw {user_id, bookmark_id} pair. Different users sharing a bookmark remain separate targets.',
        'Article-preference and subscription IDs/cursors are sr_user.id. Each stage enumerates every selected active user once, including users with no saves or subscriptions so stale preferences can clear. Both send {user_id}.',
        'Collection IDs/cursors are sr_user_collection.id and requests send {collection_id}. Default enumeration selects active Collections; explicit --ids also permits closed Collections for cleanup. Deleted owners and out-of-scope users remain excluded.',
        '--user filters the article owner, Collection owner or preference user. It never expands scope to dependencies. --kind runs only that stage.',
        'Default stage order: article -> article-preference -> collection -> subscription. Subscription means collection-preference users, not subscription records. Every action refreshes only its own target using existing dependencies.',
        'Output is JSON target IDs/cursors, safe domain state/reason, pending/failed flags and counts; preference targets also report numeric coverage (eligible, used, missing). received counts recognized code:200 operation results, not completed or query-visible vectors. Unknown states count as failures.',
        'Pending and failed rows do not stop later rows or stages. The final summary precedes nonzero exit if any row was pending or failed. Missing dependencies are never replaced with zero vectors.',
        'Rerun reported cursors as --kind KIND --ids ID,ID, or use exclusive --after-id with one --kind. Cursors track enumeration, not completed work; later cursors do not resolve earlier pending rows.',
        'No automatic retries, polling, checkpoints or state files. Dry-run only enumerates with read-only SQL; no HTTP, task credential or writes.',
        'Environment only: VECTOR_REFRESH_DATABASE_URL (required read-only PostgreSQL session), VECTOR_REFRESH_URL (API origin), VECTOR_REFRESH_SECRET (fixed task secret matching Core). Send it only as X-Vector-Refresh-Secret; omit Authorization and X-API-Key so existing whitelist forwarding reaches the handler. Every refresh handler checks the secret before path/body parsing; Reader login cannot substitute for it. Edge needs no task secret configuration. No Bearer compatibility, environment-file loading or credential arguments/logs. Dry-run needs only the database URL.',
        'With VECTOR_REFRESH_DATABASE_URL already supplied: pnpm api -- vector:refresh --kind article --batch 10 --dry-run'
      ].join('\n')
    )
    return
  }
  const options = parseRefreshOptions(args)
  const connectionString = process.env.VECTOR_REFRESH_DATABASE_URL
  if (!connectionString) throw new Error('missing_refresh_database_url')
  const origin = options.dryRun ? undefined : refreshEndpoint(process.env.VECTOR_REFRESH_URL)
  const secret = options.dryRun ? undefined : process.env.VECTOR_REFRESH_SECRET
  if (!options.dryRun && (!secret || /\s/.test(secret))) throw new Error('invalid_vector_refresh_secret')
  const db = new Client({ connectionString, connectionTimeoutMillis: 10_000 })
  const abort = new AbortController()
  const interrupt = () => abort.abort()
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    await db.connect()
    await db.query('SET default_transaction_read_only = on')
    await db.query("SET statement_timeout = '30s'")
    const result = await runVectorRefresh(options, {
      db,
      log: message => console.log(message),
      stopped: () => abort.signal.aborted,
      send: async (stage, row) => {
        let body: { user_id: number; bookmark_id: number } | { user_id: number } | { collection_id: number }
        if (stage === 'article' && 'bookmarkId' in row) body = { user_id: row.userId, bookmark_id: row.bookmarkId }
        else if (stage === 'collection' && 'collectionId' in row) body = { collection_id: row.collectionId }
        else if ((stage === 'article-preference' || stage === 'subscription') && 'userId' in row) body = { user_id: row.userId }
        else throw new Error('invalid_enumeration')
        const response = await fetch(new URL(REFRESH_ENDPOINTS[stage], origin), {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(120_000)]),
          headers: { 'X-Vector-Refresh-Secret': secret!, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
        if (response.status !== 200) throw new Error('refresh_http_failed')
        return response.json()
      }
    })
    console.log(JSON.stringify({ scope: options, ...result }))
    if (result.counts.pending || result.counts.failed) throw new Error('refresh_incomplete')
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    await db.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    const reason = error instanceof Error && /^[a-z_]{1,100}$/.test(error.message) ? error.message : 'vector_refresh_failed'
    console.error(JSON.stringify({ error: reason }))
    process.exitCode = 1
  })
}
