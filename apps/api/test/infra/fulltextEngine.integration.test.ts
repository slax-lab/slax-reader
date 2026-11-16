/**
 * Focused FTS engine verification: production Normalizer + real Jieba WASM
 * produce the stored normalized text and the query tokens; the query runs on
 * real D1 FTS5 (porter unicode61) through BookmarkSearchRepo, and current
 * PostgreSQL admission runs on PGlite with all committed migrations.
 *
 * No production-scale performance claim is made: candidate batches are bounded
 * by the search service (10 pages x 100), and EXPLAIN QUERY PLAN is inspected
 * only to confirm the access path.
 */
import { PGlite } from '@electric-sql/pglite'
import { createRequire } from 'node:module'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PrismaClient } from '@prisma/hyperdrive-client'
import { HybridSearchService, SEARCH_FULLTEXT_MAX_PAGES, SEARCH_FULLTEXT_PAGE_SIZE } from '@/domain/hybridSearch'
import type { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import type { ContextManager } from '@/utils/context'
import type { VectorEmbeddingClient } from '@/infra/external/vectorEmbedding'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { BookmarkSearchRepo } from '@/infra/repository/dbBookmarkSearch'
import { HybridSearchRepo } from '@/infra/repository/dbHybridSearch'
import { Normalizer } from '@/utils/hybridSearch/normalizer'
import { SlaxJieba } from '@/utils/hybridSearch/jieba'

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      public ctx: unknown,
      public env: unknown
    ) {}
  }
}))

const req = createRequire(import.meta.url)
const { Miniflare } = createRequire(req.resolve('wrangler/package.json'))('miniflare')

const apiRoot = fileURLToPath(new URL('../../', import.meta.url))
const pgMigrationsRoot = path.join(apiRoot, 'prisma/pg_migrations')
const d1FulltextMigrationsRoot = path.join(apiRoot, 'prisma/d1_migrations/fulltext')

let pg: PGlite
let d1: D1Database
let runtime: InstanceType<typeof Miniflare>
let jieba: InstanceType<typeof SlaxJieba>
let normalizer: Normalizer
let searchEnv: Env
let fulltext: BookmarkSearchRepo
let search: HybridSearchRepo
let pgQuery: ReturnType<typeof vi.fn>

function flattenSql(text: string) {
  return text.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim()
}

async function applyPostgresMigrations(db: PGlite) {
  const dirs = (await readdir(pgMigrationsRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort()
  for (const dir of dirs) await db.exec(await readFile(path.join(pgMigrationsRoot, dir, 'migration.sql'), 'utf8'))
}

async function applyFulltextMigrations(db: D1Database) {
  const files = (await readdir(d1FulltextMigrationsRoot)).filter(name => name.endsWith('.sql')).sort()
  for (const file of files) await db.exec(flattenSql(await readFile(path.join(d1FulltextMigrationsRoot, file), 'utf8')))
}

beforeAll(async () => {
  const wasm = await WebAssembly.compile(await readFile(new URL('../../src/utils/wasmJieba/jieba_rs_wasm_bg.wasm', import.meta.url)))
  jieba = new SlaxJieba({} as never, {} as never)
  await (jieba as unknown as { __wbg_init: (module: WebAssembly.Module) => Promise<unknown> }).__wbg_init(wasm)

  const jiebaStub = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (_input: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { text?: string; hmm?: boolean }
        return Response.json({ data: await jieba.cutForSearch(body.text ?? '', body.hmm) })
      }
    })
  }
  searchEnv = { SLAX_JIEBA: jiebaStub } as unknown as Env
  normalizer = new Normalizer(searchEnv)

  pg = new PGlite()
  await applyPostgresMigrations(pg)

  runtime = new Miniflare({
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: 'fulltext-engine-fixture',
          type: 'worker',
          compatibilityDate: '2026-08-01',
          manifest: {
            mainModule: 'fixture.mjs',
            modulesRoot: apiRoot,
            modules: { 'fixture.mjs': { type: 'esm', contents: 'export default { fetch(){ return new Response("ok") } }' } }
          },
          env: { DB_FULLTEXT: { type: 'd1', id: 'fulltext-engine-fixture' } }
        }
      }
    ]
  })
  d1 = (await runtime.getD1Database('DB_FULLTEXT')) as unknown as D1Database
  await applyFulltextMigrations(d1)

  fulltext = new BookmarkSearchRepo(() => d1Prisma())
}, 120_000)

const d1Queries: { sql: string; values: unknown[]; rowsRead: number }[] = []

function d1Prisma() {
  return {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const { Prisma } = await import('@prisma/client')
      const query = Prisma.sql(strings, ...values)
      const statement = d1.prepare(query.sql)
      const bound = query.values.length ? statement.bind(...query.values) : statement
      const result = await bound.all()
      d1Queries.push({ sql: query.sql, values: query.values, rowsRead: result.meta.rows_read })
      return result.results ?? []
    }
  } as unknown as PrismaClient
}

async function explainLastQuery() {
  const query = d1Queries.at(-1)!
  const result = await d1.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).bind(...query.values).all<{ detail: string }>()
  return (result.results ?? []).map(row => row.detail)
}

beforeEach(async () => {
  d1Queries.length = 0
  await d1.exec('DELETE FROM slax_bookmark_raw')
  await pg.exec('BEGIN')
  await pg.exec(`
    INSERT INTO sr_user (id, email, last_login_at, created_at) VALUES
      (1, 'engine-viewer@example.test', now(), now()),
      (2, 'engine-other@example.test', now(), now());
    INSERT INTO sr_bookmark (id, title, target_url, private_user, status, created_at, updated_at, published_at) VALUES
      (10, 'Chinese body title', 'https://example.test/engine-10', 1, 'success', now(), now(), now()),
      (11, 'Mixed title',        'https://example.test/engine-11', 1, 'success', now(), now(), now()),
      (12, 'Deleted auth title', 'https://example.test/engine-12', 1, 'success', now(), now(), now()),
      (40, 'Multi chunk title',  'https://example.test/engine-40', 1, 'success', now(), now(), now()),
      (50, 'Stale auth title',   'https://example.test/engine-50', 1, 'success', now(), now(), now());
    INSERT INTO sr_user_bookmark (id, user_id, bookmark_id, updated_at, deleted_at) VALUES
      (100, 1, 10, now(), NULL),
      (110, 1, 11, now(), NULL),
      (120, 1, 12, now(), NULL),
      (140, 1, 40, now(), NULL),
      (150, 1, 50, now(), now());
  `)
  pgQuery = vi.fn(async (sqlArg: unknown, ...values: unknown[]) => {
    const sql = sqlArg as { text?: string; values?: unknown[] }
    const text = typeof sql?.text === 'string' ? sql.text : ''
    return (await pg.query(text, Array.isArray(sql?.values) ? sql.values : values)).rows
  })
  const throwing = () => {
    throw new Error('fulltext engine fixture must not use the D1 or app Prisma clients')
  }
  search = new HybridSearchRepo(() => ({ $queryRaw: pgQuery }) as unknown as PrismaClient, new BookmarkRepo(throwing, throwing))
})

afterEach(async () => {
  await pg.exec('ROLLBACK')
})

afterAll(async () => {
  await runtime?.dispose()
  await pg?.close()
})

async function insertRaw(bookmarkId: number, shardIdx: number, content: string, title: string, rawContent = content, rawTitle = title) {
  await d1
    .prepare('INSERT INTO slax_bookmark_raw (shard_idx, bookmark_id, content, raw_content, title, raw_title) VALUES (?,?,?,?,?,?)')
    .bind(shardIdx, bookmarkId, content, rawContent, title, rawTitle)
    .run()
}

async function ingest(bookmarkId: number, title: string, content: string) {
  const shards = await normalizer.processFulltext(title, content)
  expect(shards.length).toBeGreaterThan(0)
  for (const shard of shards) {
    await insertRaw(bookmarkId, shard.shard_idx, shard.normalized_content, shard.normalized_title, shard.raw_content, shard.raw_title)
  }
  return shards
}

async function queryTerms(keyword: string) {
  const tokens = await normalizer.cut(keyword, true, { strict: true })
  return [...new Set(tokens.map(token => token.trim()).filter(token => /[\p{L}\p{N}]/u.test(token)))]
}

async function queryCandidates(keyword: string, offset = 0, limit = 20) {
  const terms = await queryTerms(keyword)
  if (!terms.length) return []
  const expression = terms.map(term => `"${term.replace(/"/g, '""')}"`).join(' OR ')
  return fulltext.searchCandidatePage(expression, offset, limit)
}

describe('fulltext engine: real Normalizer + Jieba WASM', () => {
  test('indexes and retrieves a representative Chinese body-only rare phrase', async () => {
    const shards = await ingest(10, '普通标题', '这是一段与关键词无关的说明。深度学习模型压缩与边缘推理优化是本次实验的重点。')
    const normalized = shards[0].normalized_content
    expect(normalized).toContain('边缘')
    expect(normalized).toContain('推理')
    expect(normalized).toContain('优化')
    expect(normalized).not.toContain('。')

    const terms = await queryTerms('边缘推理优化')
    expect(terms.length).toBeGreaterThan(0)
    expect(terms.some(term => /[\u4e00-\u9fff]/.test(term))).toBe(true)

    const hits = await queryCandidates('边缘推理优化')
    expect(hits.map(row => row.bookmark_id)).toContain(10)
    expect(hits[0].excerpt).toContain('推理')
    expect(hits[0].excerpt).not.toContain('。')
  })

  test('handles CJK + ASCII mixed content and case-insensitive English terms', async () => {
    await ingest(11, '混合标题', '使用 vLLM 部署 Qwen3 推理服务，并接入 RAG 向量检索。')
    expect(await queryCandidates('RAG 向量检索')).not.toEqual([])
    expect(await queryCandidates('vLLM Qwen3')).not.toEqual([])
    expect(await queryCandidates('rag')).not.toEqual([])
  })

  test('applies porter stemming for English surface forms', async () => {
    await ingest(20, 'running optimized retrieval', 'running optimized retrieval pipelines with rareword')
    for (const keyword of ['RUNNING OPTIMIZED RETRIEVAL', 'run optimize retrieval']) {
      const hits = await queryCandidates(keyword)
      expect(hits.map(row => row.bookmark_id), keyword).toContain(20)
    }
  })

  test('orders real BM25 scores ascending (lower is better) for the same term', async () => {
    await insertRaw(80, 0, 'rank token', 'bm25 title')
    await insertRaw(81, 0, 'rank rank rank token token token token', 'bm25 title')
    const hits = await queryCandidates('rank')
    const scores = hits.filter(row => [80, 81].includes(row.bookmark_id)).map(row => row.score)
    expect(scores).toHaveLength(2)
    expect(scores[0]).toBeLessThan(scores[1])
  })

  test('keeps hyphen, underscore, quotes and symbols consistent with stored normalization', async () => {
    const shards = await ingest(21, 'Punctuation title', 'state-of-the-art snake_case zzrare++ co-op “中文引号短语”')
    const normalized = shards[0].normalized_content
    expect(normalized).toContain('state of the art')
    expect(normalized).toContain('snake case')
    expect(normalized).toContain('zzrare')

    expect((await queryCandidates('state-of-the-art')).map(row => row.bookmark_id)).toContain(21)
    expect((await queryCandidates('zzrare++')).map(row => row.bookmark_id)).toContain(21)
    expect((await queryCandidates('co-op')).map(row => row.bookmark_id)).toContain(21)
    expect((await queryCandidates('“中文引号短语”')).map(row => row.bookmark_id)).toContain(21)
    expect((await queryCandidates('snake_case')).map(row => row.bookmark_id)).toContain(21)
  })

  test('treats a symbols-only keyword as no searchable terms without touching D1', async () => {
    const spy = vi.spyOn(fulltext, 'searchCandidatePage')
    expect(await queryTerms('+++ !!!')).toEqual([])
    expect(await queryCandidates('+++ !!!')).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('distinguishes title matches from body snippets and keeps snippets normalized', async () => {
    await ingest(22, '标题专属词组', '与标题无关的正文内容。')
    await ingest(23, '无关标题', '正文专属词组出现在这里。')
    await ingest(24, 'Snippet title', 'Hello, Rare_Phrase! 世界。')

    const titleOnly = await queryCandidates('标题专属词组')
    expect(titleOnly.map(row => row.bookmark_id)).toContain(22)
    // The repository snippet reads column 0 (normalized body), not the matched title.
    expect(titleOnly[0].excerpt).not.toContain('标题专属词组')

    const bodyOnly = await queryCandidates('正文专属词组')
    expect(bodyOnly.map(row => row.bookmark_id)).toContain(23)
    expect(bodyOnly[0].excerpt).toContain('正文')

    const snippet = await queryCandidates('Rare_Phrase')
    expect(snippet.map(row => row.bookmark_id)).toContain(24)
    expect(snippet[0].excerpt).not.toContain(',')
    expect(snippet[0].excerpt).not.toContain('。')
    expect(snippet[0].excerpt.toLowerCase()).toContain('rare phrase')
  })

  test('updates and deletes remove old tokens from FTS', async () => {
    const shards = await ingest(30, '更新标题', '甲乙丙丁戊只在这里出现。')
    expect((await queryCandidates('甲乙丙丁戊')).map(row => row.bookmark_id)).toContain(30)

    const replacement = await normalizer.processFulltext('新标题', '子丑寅卯辰出现在这里。')
    await d1.prepare('UPDATE slax_bookmark_raw SET content = ?, title = ? WHERE bookmark_id = ?').bind(replacement[0].normalized_content, replacement[0].normalized_title, 30).run()
    expect(await queryCandidates('甲乙丙丁戊')).toEqual([])
    expect((await queryCandidates('子丑寅卯辰')).map(row => row.bookmark_id)).toContain(30)

    await d1.prepare('DELETE FROM slax_bookmark_raw WHERE bookmark_id = ?').bind(30).run()
    expect(await queryCandidates('子丑寅卯辰')).toEqual([])
    expect(shards[0].normalized_content).toContain('甲乙')
  })
})

describe('fulltext engine: bounded candidates, chunk dedup and current admission', () => {
  test('returns duplicate chunk rows at repository level while PostgreSQL admission yields one article', async () => {
    await ingest(40, '多块标题', '多块检索专用词出现在第一段。')
    const second = await normalizer.processFulltext('多块标题', '多块检索专用词出现在第二段。')
    await insertRaw(40, 1, second[0].normalized_content, second[0].normalized_title)

    const hits = await queryCandidates('多块检索专用词')
    const ids = hits.map(row => row.bookmark_id)
    expect(ids.filter(id => id === 40)).toHaveLength(2)
    expect(new Set(ids).size).toBe(1)
    expect(await search.articles(1, [...new Set(ids)])).toEqual([expect.objectContaining({ bookmark_id: 40, user_id: 1, cb_id: 140 })])
  })

  test('returns bounded candidate pages without overlapping result rows', async () => {
    for (let id = 60; id < 85; id++) await insertRaw(id, 0, 'boundtoken body', 'boundtoken title')
    const first = await queryCandidates('boundtoken', 0, 10)
    const second = await queryCandidates('boundtoken', 10, 10)
    const third = await queryCandidates('boundtoken', 20, 10)
    expect([first.length, second.length, third.length]).toEqual([10, 10, 5])
    const ids = [...first, ...second, ...third].map(row => row.bookmark_id)
    expect(new Set(ids).size).toBe(25)
  })

  test('exposes the service-wide 1000-candidate scan cap', () => {
    expect(SEARCH_FULLTEXT_PAGE_SIZE).toBe(100)
    expect(SEARCH_FULLTEXT_MAX_PAGES).toBe(10)
    expect(SEARCH_FULLTEXT_PAGE_SIZE * SEARCH_FULLTEXT_MAX_PAGES).toBe(1000)
  })

  test('retains stale candidates at D1 retrieval and drops them at current PostgreSQL admission', async () => {
    await insertRaw(50, 0, 'stale admission token', 'stale admission title')
    expect((await queryCandidates('stale admission token')).map(row => row.bookmark_id)).toEqual([50])
    expect(await search.articles(1, [50])).toEqual([])
  })

  test('keeps the actual legacy 50-row CTE query on rowid lookups and the MATCH index', async () => {
    await d1.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 2000)
      INSERT INTO slax_bookmark_raw (shard_idx, bookmark_id, content, raw_content, title, raw_title)
      SELECT 0, 10000 + n, 'common planner body', 'common planner body', 'fixture title', 'fixture title' FROM seq`).run()
    const selected = await d1.prepare('SELECT id, bookmark_id FROM slax_bookmark_raw ORDER BY id LIMIT 50').all<{ id: number; bookmark_id: number }>()
    const rows = selected.results ?? []
    const hits = await fulltext.seachBM25(rows.map(row => row.id), '"common"')
    const plan = await explainLastQuery()
    expect(hits.map(row => row.bookmark_id).sort((a, b) => a - b)).toEqual(rows.map(row => row.bookmark_id))
    expect(plan.some(detail => /SEARCH r USING INTEGER PRIMARY KEY/.test(detail))).toBe(true)
    expect(plan.some(detail => /slax_fts_bookmark VIRTUAL TABLE INDEX .*M[0-9]+/.test(detail))).toBe(true)
    expect(plan.some(detail => /SCAN (?:r|raw|slax_bookmark_raw)(?:$| )/.test(detail))).toBe(false)
    expect(d1Queries.at(-1)!.values.slice(0, -1)).toEqual(rows.map(row => row.id))
    console.log(JSON.stringify({ query: 'legacy-50', returned: hits.length, rowsRead: d1Queries.at(-1)!.rowsRead, plan }))
  })

  test('keeps selective and common global queries indexed while exposing ranking work beyond LIMIT', async () => {
    await d1.prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 2000)
      INSERT INTO slax_bookmark_raw (shard_idx, bookmark_id, content, raw_content, title, raw_title)
      SELECT 0, 10000 + n, CASE WHEN n % 40 = 0 THEN 'common planner raretoken' ELSE 'common filler' END,
        'fixture body', 'fixture title', 'fixture title' FROM seq`).run()
    const observations: { keyword: string; offset: number; returned: number; rowsRead: number; plan: string[] }[] = []
    for (const [keyword, offset] of [['raretoken', 0], ['common', 0], ['common', 900]] as const) {
      const hits = await fulltext.searchCandidatePage(`"${keyword}"`, offset, 100)
      const plan = await explainLastQuery()
      expect(hits).toHaveLength(keyword === 'raretoken' ? 50 : 100)
      expect(plan.some(detail => /slax_fts_bookmark VIRTUAL TABLE INDEX .*M[0-9]+/.test(detail))).toBe(true)
      expect(plan.some(detail => /SEARCH raw USING INTEGER PRIMARY KEY/.test(detail))).toBe(true)
      expect(plan.some(detail => /SCAN (?:raw|slax_bookmark_raw)(?:$| )/.test(detail))).toBe(false)
      expect(plan).toContain('USE TEMP B-TREE FOR ORDER BY')
      observations.push({ keyword, offset, returned: hits.length, rowsRead: d1Queries.at(-1)!.rowsRead, plan })
    }
    expect(observations[1].rowsRead).toBeGreaterThan(observations[0].rowsRead)
    expect(observations[1].rowsRead).toBeGreaterThan(1000)
    console.log(JSON.stringify({ query: 'global-match', observations }))
  })
})

describe('fulltext service: adaptive prefetch with real engines', () => {
  const expression = '"prefetchtoken"'
  const context = () => ({ env: searchEnv, getUserId: () => 1 }) as unknown as ContextManager
  const service = () => new HybridSearchService(search, fulltext, {} as VectorEmbeddingClient, {} as VectorMaintenanceService)

  beforeEach(async () => {
    await d1
      .prepare(
        `WITH RECURSIVE seq(n) AS (
          SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < 1499
        )
        INSERT INTO slax_bookmark_raw (shard_idx, bookmark_id, content, raw_content, title, raw_title)
        SELECT 0, 2500 - n, 'prefetchtoken', 'prefetchtoken', 'fixture', 'fixture'
        FROM seq`
      )
      .run()
    await insertRaw(1060, 1, 'prefetchtoken', 'fixture')
    await pg.exec(`
      INSERT INTO sr_bookmark (id, title, target_url, created_at, updated_at, published_at, status, private_user)
      VALUES
        (1060, 'own first page', 'https://example.com/1060', now(), now(), now(), 'success', 1),
        (1120, 'own second page', 'https://example.com/1120', now(), now(), now(), 'success', 1),
        (1180, 'other private', 'https://example.com/1180', now(), now(), now(), 'success', 2),
        (1300, 'deleted', 'https://example.com/1300', now(), now(), now(), 'success', 1),
        (1360, 'own later page', 'https://example.com/1360', now(), now(), now(), 'success', 1),
        (2200, 'beyond budget', 'https://example.com/2200', now(), now(), now(), 'success', 1);
      INSERT INTO sr_user_bookmark (id, user_id, bookmark_id, updated_at, deleted_at)
      VALUES
        (1060, 1, 1060, now(), NULL),
        (1120, 1, 1120, now(), NULL),
        (1180, 2, 1180, now(), NULL),
        (1300, 1, 1300, now(), now()),
        (1360, 1, 1360, now(), NULL),
        (2200, 1, 2200, now(), NULL);
    `)
  })

  test('matches the ten-query baseline while reducing real D1 reads to two queries', async () => {
    const baselineIds = new Set<number>()
    for (let page = 0; page < SEARCH_FULLTEXT_MAX_PAGES; page++) {
      const rows = await fulltext.searchCandidatePage(expression, page * SEARCH_FULLTEXT_PAGE_SIZE, SEARCH_FULLTEXT_PAGE_SIZE + 1)
      for (const row of rows.slice(0, SEARCH_FULLTEXT_PAGE_SIZE)) baselineIds.add(Number(row.bookmark_id))
    }
    const baseline = await search.articles(1, [...baselineIds])
    const baselineRowsRead = d1Queries.reduce((total, query) => total + query.rowsRead, 0)
    expect(d1Queries).toHaveLength(10)
    d1Queries.length = 0
    pgQuery.mockClear()

    const result = await service().fulltext(context(), 'prefetchtoken', new AbortController().signal)

    expect(result.matches.map(match => match.entity.id)).toEqual(['article:1060', 'article:1120', 'article:1360'])
    expect(result.matches.map(match => match.entity.id).sort()).toEqual(baseline.map(row => `article:${row.bookmark_id}`).sort())
    expect(result.coverage).toEqual({ exhausted: false, truncated: true, reasons: ['index_only', 'scan_budget'] })
    expect(d1Queries.map(query => query.values)).toEqual([
      [expression, 101, 0],
      [expression, 901, 100]
    ])
    expect(pgQuery).toHaveBeenCalledTimes(11)
    const optimizedRowsRead = d1Queries.reduce((total, query) => total + query.rowsRead, 0)
    expect(optimizedRowsRead).toBeLessThan(baselineRowsRead)
    console.log(JSON.stringify({ scenario: 'service-adaptive-prefetch', baselineRowsRead, optimizedRowsRead }))
  })

  test('revalidates permission after all buffered logical pages', async () => {
    const implementation = search.articles.bind(search)
    let admissions = 0
    const admission = vi.spyOn(search, 'articles').mockImplementation(async (...args) => {
      admissions++
      if (admissions === 11) {
        await pg.exec('UPDATE sr_user_bookmark SET deleted_at = now() WHERE user_id = 1 AND bookmark_id = 1120')
      }
      return implementation(...args)
    })
    try {
      const result = await service().fulltext(context(), 'prefetchtoken', new AbortController().signal)
      expect(result.matches.map(match => match.entity.id)).toEqual(['article:1060', 'article:1360'])
      expect(admissions).toBe(11)
      expect(d1Queries).toHaveLength(2)
      expect(result.coverage.reasons).toEqual(['index_only', 'scan_budget'])
    } finally {
      admission.mockRestore()
    }
  })

  test.each([1, 2])('stops after cancellation during logical admission %i', async cancelledAdmission => {
    const controller = new AbortController()
    const implementation = search.articles.bind(search)
    let admissions = 0
    const admission = vi.spyOn(search, 'articles').mockImplementation(async (...args) => {
      const result = await implementation(...args)
      if (++admissions === cancelledAdmission) controller.abort()
      return result
    })
    try {
      await expect(service().fulltext(context(), 'prefetchtoken', controller.signal)).rejects.toMatchObject({
        name: 'AbortError'
      })
      expect(admissions).toBe(cancelledAdmission)
      expect(d1Queries).toHaveLength(cancelledAdmission)
    } finally {
      admission.mockRestore()
    }
  })
})
