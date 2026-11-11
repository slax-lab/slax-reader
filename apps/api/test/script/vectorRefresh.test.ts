import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { enumeratePage, main, parseRefreshOptions, readRefreshResponse, refreshEndpoint, runVectorRefresh } from '../../script/vector-refresh'
import type { EnumerationDatabase, RefreshRow, RefreshStage } from '../../script/vector-refresh'

const connection = vi.hoisted(() => ({ client: vi.fn(), connect: vi.fn(), query: vi.fn(), end: vi.fn() }))
vi.mock('pg', () => ({ Client: connection.client }))

const SECRET = 'temporary-task-secret-4a1e'

let pg: PGlite
let db: EnumerationDatabase

const articleRows: RefreshRow[] = [
  { cursor: 11, userId: 1, bookmarkId: 10 },
  { cursor: 21, userId: 2, bookmarkId: 10 },
  { cursor: 22, userId: 2, bookmarkId: 11 },
  { cursor: 23, userId: 2, bookmarkId: 12 },
  { cursor: 24, userId: 2, bookmarkId: 13 },
  { cursor: 25, userId: 1, bookmarkId: 14 }
]
const userRows = [1, 2, 3, 4].map(id => ({ cursor: id, userId: id }))
const collectionRows = [30, 31].map(id => ({ cursor: id, collectionId: id }))

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`
    CREATE TABLE sr_user(id int PRIMARY KEY, deleted_at timestamptz);
    CREATE TABLE sr_bookmark(id int PRIMARY KEY, private_user int DEFAULT 0, status text DEFAULT 'success');
    CREATE TABLE sr_user_bookmark(id int PRIMARY KEY, user_id int, bookmark_id int, deleted_at timestamptz, type int DEFAULT 0, UNIQUE(user_id, bookmark_id));
    CREATE TABLE sr_user_collection(id int PRIMARY KEY, owner_id int, status int DEFAULT 1);
    INSERT INTO sr_user(id) VALUES (1),(2),(3),(4);
    INSERT INTO sr_user(id,deleted_at) VALUES (5,now());
    INSERT INTO sr_bookmark(id) VALUES (10),(11),(12),(13),(14);
    UPDATE sr_bookmark SET private_user = 2 WHERE id = 13;
    UPDATE sr_bookmark SET private_user = 1 WHERE id = 14;
    INSERT INTO sr_user_bookmark(id,user_id,bookmark_id,deleted_at,type) VALUES
      (11,1,10,NULL,0),
      (21,2,10,NULL,0),
      (22,2,11,NULL,2),
      (23,2,12,NULL,0),
      (24,2,13,NULL,0),
      (25,1,14,NULL,0),
      (26,2,14,NULL,0),
      (27,3,10,now(),0),
      (28,5,11,NULL,0),
      (29,1,11,NULL,1);
    INSERT INTO sr_user_collection(id,owner_id,status) VALUES (30,2,1),(31,1,1),(32,1,0),(33,5,1),(34,2,0);
  `)
  db = { query: async (text, values) => ({ rows: (await pg.query<{ id: number }>(text, values)).rows }) }
})
afterAll(async () => {
  await pg.close()
})
beforeEach(async () => {
  await pg.exec('BEGIN')
  vi.clearAllMocks()
  connection.client.mockImplementation(() => connection)
  connection.connect.mockResolvedValue(undefined)
  connection.query.mockResolvedValue({ rows: [] })
  connection.end.mockResolvedValue(undefined)
})
afterEach(async () => {
  await pg.exec('ROLLBACK')
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function accepted(data: unknown = { state: 'written' }) {
  return { code: 200, data, message: 'ok' }
}

function configureMain() {
  vi.stubEnv('VECTOR_REFRESH_DATABASE_URL', 'postgres://unused.invalid/db')
  vi.stubEnv('VECTOR_REFRESH_URL', 'http://localhost:8787')
  vi.stubEnv('VECTOR_REFRESH_SECRET', SECRET)
  connection.query.mockImplementation(async (text: string, values: unknown[]) => (text.startsWith('SELECT') ? db.query(text, values) : { rows: [] }))
  return vi.spyOn(console, 'log').mockImplementation(() => {})
}

const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve()
}

describe('sequential operator enumeration', () => {
  test('article pages expose relation cursors while preserving raw user/bookmark pairs for both owners', async () => {
    const first = await enumeratePage(db, 'article', 0, parseRefreshOptions(['--batch', '2']))
    expect(first).toEqual({ cursor: 21, rows: articleRows.slice(0, 2) })
    const rest = await enumeratePage(db, 'article', first.cursor, parseRefreshOptions(['--batch', '10']))
    expect(rest).toEqual({ cursor: 25, rows: articleRows.slice(2) })
    expect(articleRows.filter(row => row.bookmarkId === 10).map(row => row.userId)).toEqual([1, 2])
  })

  test('article enumeration excludes shortcuts, deleted relations or owners and unreadable private originals', async () => {
    const page = await enumeratePage(db, 'article', 0, parseRefreshOptions([]))
    expect(page.rows).toEqual(articleRows)
    expect(page.rows.some(row => row.cursor === 26)).toBe(false)
    expect(page.rows.some(row => row.cursor === 27)).toBe(false)
    expect(page.rows.some(row => row.cursor === 28)).toBe(false)
    expect(page.rows.some(row => row.cursor === 29)).toBe(false)
  })

  test.each([
    [['--kind', 'article', '--user', '2'], articleRows.filter(row => row.userId === 2)],
    [['--kind', 'article', '--user', '3'], []],
    [['--kind', 'article', '--ids', '11,21,24'], articleRows.filter(row => [11, 21, 24].includes(row.cursor))],
    [['--kind', 'article', '--ids', '10'], []]
  ] as const)('article selection %j filters pairs, not bookmark IDs', async (args, expected) => {
    expect((await enumeratePage(db, 'article', 0, parseRefreshOptions(args))).rows).toEqual(expected)
  })

  test.each(['article-preference'] as const)('%s enumerates active users directly and includes zero-history users', async stage => {
    const options = (...extra: string[]) => parseRefreshOptions(['--kind', stage, ...extra])
    expect(await enumeratePage(db, stage, 0, options())).toEqual({ cursor: 4, rows: userRows })
    expect((await enumeratePage(db, stage, 0, options('--user', '4'))).rows).toEqual([{ cursor: 4, userId: 4 }])
    expect((await enumeratePage(db, stage, 0, options('--ids', '3,1,4'))).rows).toEqual([
      { cursor: 1, userId: 1 },
      { cursor: 3, userId: 3 },
      { cursor: 4, userId: 4 }
    ])
    expect((await enumeratePage(db, stage, 2, options('--after-id', '2'))).rows).toEqual(userRows.slice(2))
  })

  test('preference stages never consult subscription rows and deduplicate each user once', async () => {
    for (const stage of ['article-preference'] as const) {
      const query = vi.fn(async () => ({ rows: [] }))
      await enumeratePage({ query }, stage, 0, parseRefreshOptions([]))
      expect(query.mock.calls[0][0]).not.toMatch(/subscription|sr_user_bookmark/)
      expect(query.mock.calls[0][0]).toMatch(/FROM sr_user u/)
      expect(query.mock.calls[0][1]).toEqual([0, null, null, 10])
    }
    const options = parseRefreshOptions(['--kind', 'article-preference', '--batch', '50'])
    expect((await enumeratePage(db, 'article-preference', 0, options)).rows.map(row => 'userId' in row && row.userId)).toEqual([1, 2, 3, 4])
  })

  test('Collection enumeration keeps active collections by default and explicit closed cleanup IDs', async () => {
    expect(await enumeratePage(db, 'collection', 0, parseRefreshOptions([]))).toEqual({ cursor: 31, rows: collectionRows })
    expect((await enumeratePage(db, 'collection', 0, parseRefreshOptions(['--kind', 'collection', '--user', '1']))).rows).toEqual([{ cursor: 31, collectionId: 31 }])
    expect((await enumeratePage(db, 'collection', 0, parseRefreshOptions(['--kind', 'collection', '--ids', '30,31,32,33,34', '--user', '1']))).rows).toEqual([
      { cursor: 31, collectionId: 31 },
      { cursor: 32, collectionId: 32 }
    ])
    expect((await enumeratePage(db, 'collection', 0, parseRefreshOptions(['--kind', 'collection', '--ids', '30,31,32,33,34', '--user', '2']))).rows).toEqual([
      { cursor: 30, collectionId: 30 },
      { cursor: 34, collectionId: 34 }
    ])
  })

  test('deleted owners are excluded from article, Collection and preference stages', async () => {
    await pg.exec('UPDATE sr_user SET deleted_at = now() WHERE id = 3; UPDATE sr_user_collection SET owner_id = 3 WHERE id = 30')
    expect((await enumeratePage(db, 'article', 0, parseRefreshOptions([]))).rows.some(row => 'userId' in row && row.userId === 3)).toBe(false)
    expect((await enumeratePage(db, 'collection', 0, parseRefreshOptions([]))).rows).toEqual([{ cursor: 31, collectionId: 31 }])
    expect((await enumeratePage(db, 'article-preference', 0, parseRefreshOptions([]))).rows).toEqual(userRows.filter(row => row.userId !== 3))
  })

  test('enumeration is bounded, parameterized and strictly increasing', async () => {
    const options = parseRefreshOptions(['--kind', 'article', '--batch', '1', '--user', '2', '--ids', '21,22'])
    const query = vi.fn(async () => ({ rows: [] }))
    await enumeratePage({ query }, 'article', 11, options)
    expect(query.mock.calls[0]).toEqual([expect.any(String), [11, 2, [21, 22], 1]])
    for (const rows of [[{ id: 11 }, { id: 21 }], [{ id: 0 }], [{ id: 1.5 }], [{ id: Number.MAX_SAFE_INTEGER + 1 }]]) {
      await expect(enumeratePage({ query: async () => ({ rows }) }, 'article', 0, options)).rejects.toThrow('invalid_enumeration')
    }
    await expect(enumeratePage({ query: async () => ({ rows: [{ id: 11 }, { id: 11 }] }) }, 'article', 0, { ...options, batch: 2 })).rejects.toThrow('invalid_enumeration')
    await expect(enumeratePage({ query: async () => ({ rows: [{ id: 11 }] }) }, 'article', 11, options)).rejects.toThrow('invalid_enumeration')
  })

  test('dry-run enumerates every stage in order without a secret or HTTP call', async () => {
    const send = vi.fn()
    const log = vi.fn()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const options = parseRefreshOptions(['--dry-run'])
    vi.stubEnv('VECTOR_REFRESH_SECRET', undefined)
    const result = await runVectorRefresh(options, { db, send, log })
    expect(result).toEqual({ enumerated: 12, counts: { received: 0, pending: 0, failed: 0 } })
    expect(send).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    const output = log.mock.calls.map(([message]) => JSON.parse(message))
    expect(output).toEqual([
      { stage: 'article', afterId: 0, nextAfterId: 25, dryRun: true, rows: articleRows },
      { stage: 'article-preference', afterId: 0, nextAfterId: 4, dryRun: true, rows: userRows },
      { stage: 'collection', afterId: 0, nextAfterId: 31, dryRun: true, rows: collectionRows }
    ])
  })

  test('the three stages send one raw target each in order before any later stage starts', async () => {
    const send = vi.fn(async () => accepted())
    await runVectorRefresh(parseRefreshOptions([]), { db, send })
    expect(send.mock.calls).toEqual([
      ...articleRows.map(row => ['article', row]),
      ...userRows.map(row => ['article-preference', row]),
      ...collectionRows.map(row => ['collection', row])
    ])
    expect(send.mock.calls.filter(([stage]) => stage === 'article')).toHaveLength(6)
    expect(send.mock.calls.filter(([stage]) => stage === 'subscription')).toHaveLength(0)
  })

  test('a deferred target blocks the next request until it settles', async () => {
    let release: (() => void) | undefined
    const send = vi.fn(
      () =>
        new Promise(resolve => {
          release = () => resolve(accepted())
        })
    )
    const running = runVectorRefresh(parseRefreshOptions(['--kind', 'article', '--user', '1']), { db, send })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    release!()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    release!()
    await running
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('a failed or pending target does not stop later rows and the caller reports incomplete work', async () => {
    const log = vi.fn()
    const send = vi.fn(async (stage: RefreshStage, row: RefreshRow) => {
      if (stage === 'article' && 'bookmarkId' in row && row.bookmarkId === 10) throw new Error('task request failed')
      if (stage === 'article-preference' && 'userId' in row && row.userId === 2) return accepted({ state: 'pending' })
      if (stage === 'collection' && 'collectionId' in row && row.collectionId === 30) return accepted({ state: 'failed', reason: 'missing_dependency:a:2:10' })
      return accepted()
    })
    const result = await runVectorRefresh(parseRefreshOptions([]), { db, send, log })
    expect(send).toHaveBeenCalledTimes(12)
    expect(result.counts).toEqual({ received: 10, pending: 1, failed: 3 })
    const output = log.mock.calls.map(([message]) => JSON.parse(message))
    expect(output.filter(row => row.failed)).toEqual([
      { stage: 'article', cursor: 11, userId: 1, bookmarkId: 10, afterId: 0, failed: true, reason: 'refresh_request_failed' },
      { stage: 'article', cursor: 21, userId: 2, bookmarkId: 10, afterId: 11, failed: true, reason: 'refresh_request_failed' },
      { stage: 'collection', cursor: 30, collectionId: 30, afterId: 0, failed: true, pending: false, result: { state: 'failed', reason: 'missing_dependency:a:2:10' } }
    ])
    expect(output.find(row => row.pending)).toMatchObject({ stage: 'article-preference', userId: 2, pending: true, result: { state: 'pending' } })
  })

  test('interruption stops before the next row even within a page', async () => {
    let stopped = false
    const send = vi.fn(async () => {
      stopped = true
      return accepted()
    })
    await expect(runVectorRefresh(parseRefreshOptions(['--kind', 'article']), { db, send, stopped: () => stopped })).rejects.toThrow('refresh_interrupted')
    expect(send).toHaveBeenCalledOnce()
    send.mockClear()
    await expect(runVectorRefresh(parseRefreshOptions([]), { db, send, stopped: () => true })).rejects.toThrow('refresh_interrupted')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('response and option safety', () => {
  test('accepts only direct single-target states and safe reasons', () => {
    for (const payload of [null, {}, [], { code: '200', data: {} }, { code: 200 }, { status: 200, data: {} }, { code: 403, data: {} }, { results: [] }]) {
      expect(() => readRefreshResponse(payload)).toThrow('invalid_refresh_response')
    }
    for (const data of [null, {}, true, 'unrecognized', [{ state: 'written' }], { state: 'ready' }, { status: null }, { reason: 'unknown' }]) {
      expect(() => readRefreshResponse(accepted(data))).toThrow('invalid_refresh_response')
    }
    for (const state of ['written', 'deleted', 'empty', 'pending', 'failed']) {
      expect(readRefreshResponse(accepted({ state })).result).toEqual({ state })
    }
    for (const reason of [
      'missing_dependency:a:1:1',
      'missing_dependency:a:12:34:c:0',
      'missing_dependency:c:7',
      'missing_dependency:u:7:article',
      'missing_dependency:u:7:article:centered',
      'missing_dependency:u:7:collection',
      'source_not_ready'
    ])
      expect(readRefreshResponse(accepted({ state: 'failed', reason })).result).toEqual({ state: 'failed', reason })
    for (const reason of ['missing_dependency:a:0:1', 'missing_dependency:c:0', 'embedding_http_503', 'https://secret.invalid', 'bad reason!', 'Missing dependency a:1:1']) {
      const result = readRefreshResponse(accepted({ state: 'failed', reason }))
      expect(result.result).toEqual({ state: 'failed' })
      expect(JSON.stringify(result)).not.toContain('secret')
    }
  })

  test('preserves only validated numeric preference coverage', () => {
    expect(readRefreshResponse(accepted({ state: 'written', coverage: { eligible: 3, used: 2, missing: 1, token: 'secret' } }))).toEqual({
      result: { state: 'written', coverage: { eligible: 3, used: 2, missing: 1 } },
      pending: false,
      failed: false
    })
    expect(readRefreshResponse(accepted({ state: 'failed', reason: 'no_usable_preference_vectors', coverage: { eligible: 2, used: 0, missing: 2 } })).result).toEqual({
      state: 'failed',
      reason: 'no_usable_preference_vectors',
      coverage: { eligible: 2, used: 0, missing: 2 }
    })
    expect(readRefreshResponse(accepted({ state: 'deleted', coverage: { eligible: 0, used: 0, missing: 0 } })).result.coverage).toEqual({ eligible: 0, used: 0, missing: 0 })
    for (const coverage of [
      null,
      [],
      {},
      { eligible: '3', used: 2, missing: 1 },
      { eligible: 1, used: 2, missing: 0 },
      { eligible: 2, used: 2, missing: 1 },
      { eligible: 5, used: 1, missing: 1 },
      { eligible: -1, used: 0, missing: 0 },
      { eligible: 2.5, used: 2, missing: 0 },
      { eligible: Infinity, used: 0, missing: 0 },
      { eligible: 1, used: 0, missing: NaN }
    ]) {
      expect(readRefreshResponse(accepted({ state: 'written', coverage })).result).toEqual({ state: 'written' })
    }
  })

  test('keeps pending and failed flags without echoing extra fields or credentials', () => {
    const result = readRefreshResponse(
      accepted({
        state: 'written',
        token: 'secret',
        body: 'article text',
        vectors: [1, 2],
        target: { kind: 'user', id: 7, preference: 'article' },
        reason: 'https://secret.invalid'
      })
    )
    expect(result).toEqual({ result: { state: 'written' }, pending: false, failed: false })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  test('validates bounded options and rejects recovery or credential arguments', () => {
    expect(parseRefreshOptions([])).toEqual({ batch: 10, dryRun: false, afterId: 0 })
    expect(parseRefreshOptions(['--batch', '50', '--kind', 'article', '--ids', '2,1,2', '--after-id', '0']).ids).toEqual([1, 2])
    for (const args of [
      ['--batch', '0'],
      ['--batch', '51'],
      ['--batch', '1', '--batch', '2'],
      ['--ids', '1,2'],
      ['--ids', '1,'],
      ['--after-id', '0'],
      ['--after-id', '-1', '--kind', 'article'],
      ['--kind', 'all'],
      ['--kind', 'user-article'],
      ['--kind', 'user-collection'],
      ['--user'],
      ['--user', '1.5'],
      ['--user', '9007199254740992'],
      ['--resume'],
      ['--checkpoint', 'state.json'],
      ['--token', 'secret'],
      ['--auth-token', 'secret'],
      ['--url', 'https://example.invalid'],
      ['--database-url', 'postgres://secret.invalid']
    ])
      expect(() => parseRefreshOptions(args)).toThrow()
    expect(() => parseRefreshOptions(['--kind', 'article', '--ids', Array.from({ length: 1001 }, (_, i) => i + 1).join(',')])).toThrow('too_many_ids')
  })

  test('requires an origin and rejects unsafe protocols, credentials, paths, query and hash', () => {
    expect(refreshEndpoint('http://localhost:8787').href).toBe('http://localhost:8787/')
    expect(refreshEndpoint('https://reader.example').href).toBe('https://reader.example/')
    expect(() => refreshEndpoint(undefined)).toThrow('missing_vector_refresh_url')
    for (const endpoint of [
      'not a url',
      'http://example.invalid',
      'https://name:secret@example.invalid',
      'https://example.invalid/path',
      'https://example.invalid/v1/bookmark/vector/refresh',
      'https://example.invalid/internal/v1/vector-refresh',
      'https://example.invalid?token=secret',
      'https://example.invalid#secret'
    ])
      expect(() => refreshEndpoint(endpoint)).toThrow('invalid_vector_refresh_url')
  })

  test('help documents the new raw targets, stages and task secret boundary', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await main(['--help'])
    const help = log.mock.calls[0][0] as string
    for (const text of [
      'article|article-preference|collection',
      'sr_user_bookmark.id',
      'raw {user_id, bookmark_id}',
      'sr_user.id',
      'This stage enumerates every selected active user once',
      'including users with no saves',
      'VECTOR_REFRESH_SECRET',
      'X-Vector-Refresh-Secret',
      'omit Authorization and X-API-Key',
      'checks the secret before path/body parsing',
      'Reader login cannot substitute for it',
      'Edge needs no task secret configuration',
      'No Bearer compatibility, environment-file loading or credential arguments/logs',
      'nonzero exit'
    ])
      expect(help).toContain(text)
    expect(help).not.toMatch(/VECTOR_REFRESH_AUTH_TOKEN|VECTOR_BACKFILL_TOKEN|user-article|user-collection|internal\/v1|sr_user_collection_subscriber\.id/)
    expect(connection.client).not.toHaveBeenCalled()
  })

  test('requires explicit database injection instead of an application fallback', async () => {
    vi.stubEnv('VECTOR_REFRESH_DATABASE_URL', undefined)
    vi.stubEnv('HYPERDRIVE_DATABASE_URL', 'postgres://unused.invalid/db')
    await expect(main(['--dry-run'])).rejects.toThrow('missing_refresh_database_url')
    expect(connection.client).not.toHaveBeenCalled()
  })

  test('requires the task secret from the environment and never accepts a login-token fallback', async () => {
    vi.stubEnv('VECTOR_REFRESH_DATABASE_URL', 'postgres://unused.invalid/db')
    vi.stubEnv('VECTOR_REFRESH_URL', 'http://localhost:8787')
    vi.stubEnv('VECTOR_REFRESH_AUTH_TOKEN', 'existing-login-token')
    vi.stubEnv('VECTOR_BACKFILL_TOKEN', 'old-machine-token')
    for (const secret of [undefined, '', ' ', 'two words', 'tab\there']) {
      vi.stubEnv('VECTOR_REFRESH_SECRET', secret)
      await expect(main(['--kind', 'article'])).rejects.toThrow('invalid_vector_refresh_secret')
    }
    expect(connection.client).not.toHaveBeenCalled()
  })
})

describe('main HTTP execution', () => {
  test.each([{ extra: [] }, { extra: ['--dry-run'] }, { extra: ['--ids', '7'] }])('rejects the retired subscription stage before connections %j', async ({ extra }) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(main(['--kind', 'subscription', ...extra])).rejects.toThrow('subscription_preference_on_demand')
    expect(connection.client).not.toHaveBeenCalled()
    expect(connection.connect).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  test.each([
    ['article', '11', '/v1/bookmark/vector/refresh', { user_id: 1, bookmark_id: 10 }],
    ['article-preference', '2', '/v1/bookmark/preference/refresh', { user_id: 2 }],
    ['collection', '30', '/v1/collection/vector/refresh', { collection_id: 30 }]
  ] as const)('POSTs the exact %s raw target with the custom secret header only', async (stage, id, path, body) => {
    const log = configureMain()
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(accepted()), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await main(['--kind', stage, '--ids', id])
    expect(fetch).toHaveBeenCalledOnce()
    const [url, request] = fetch.mock.calls[0]
    expect(url.href).toBe(`http://localhost:8787${path}`)
    expect(request).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'X-Vector-Refresh-Secret': SECRET, 'Content-Type': 'application/json' } })
    expect(Object.keys(request.headers).sort()).toEqual(['Content-Type', 'X-Vector-Refresh-Secret'])
    expect(JSON.parse(request.body)).toEqual(body)
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/temporary-task-secret|postgres:|localhost/)
    expect(connection.end).toHaveBeenCalledOnce()
  })

  test('keeps one HTTP request outstanding until the response resolves', async () => {
    configureMain()
    let release: (() => void) | undefined
    const fetch = vi.fn(
      () =>
        new Promise<Response>(resolve => {
          release = () => resolve(new Response(JSON.stringify(accepted()), { status: 200 }))
        })
    )
    vi.stubGlobal('fetch', fetch)
    const running = main(['--kind', 'article', '--user', '1'])
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    release!()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    release!()
    await running
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(connection.end).toHaveBeenCalledOnce()
  })

  test.each([200, 207, 500])('HTTP %s without a valid success envelope reports failure and closes after the summary', async status => {
    const log = configureMain()
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status }))
    vi.stubGlobal('fetch', fetch)
    await expect(main(['--kind', 'article', '--ids', '11'])).rejects.toThrow('refresh_incomplete')
    expect(fetch).toHaveBeenCalledOnce()
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({ counts: { received: 0, pending: 0, failed: 1 }, enumerated: 1 })
    expect(connection.end).toHaveBeenCalledOnce()
  })

  test('prints a nonzero summary only after later rows and stages finish', async () => {
    const log = configureMain()
    let calls = 0
    const fetch = vi.fn(async () => {
      calls += 1
      const state = calls === 1 ? 'pending' : 'written'
      return new Response(JSON.stringify(accepted({ state })), { status: 200 })
    })
    vi.stubGlobal('fetch', fetch)
    await expect(main(['--kind', 'article-preference'])).rejects.toThrow('refresh_incomplete')
    expect(fetch.mock.calls.map(([, request]) => JSON.parse(request.body))).toEqual(userRows.map(row => ({ user_id: row.userId })))
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({ counts: { received: 4, pending: 1, failed: 0 }, enumerated: 4 })
    expect(connection.end).toHaveBeenCalledOnce()
  })

  test('opens one read-only client, and a dry-run needs neither the URL nor the secret', async () => {
    vi.stubEnv('VECTOR_REFRESH_DATABASE_URL', 'postgres://unused.invalid/db')
    vi.stubEnv('VECTOR_REFRESH_URL', undefined)
    vi.stubEnv('VECTOR_REFRESH_SECRET', undefined)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await main(['--dry-run'])
    expect(connection.client).toHaveBeenCalledExactlyOnceWith({ connectionString: 'postgres://unused.invalid/db', connectionTimeoutMillis: 10_000 })
    expect(connection.query.mock.calls[0][0]).toBe('SET default_transaction_read_only = on')
    expect(connection.query.mock.calls[1][0]).toBe("SET statement_timeout = '30s'")
    expect(fetch).not.toHaveBeenCalled()
    expect(connection.end).toHaveBeenCalledOnce()
  })

  test('closes the client even if connection or read-only session setup fails', async () => {
    vi.stubEnv('VECTOR_REFRESH_DATABASE_URL', 'postgres://unused.invalid/db')
    connection.connect.mockRejectedValueOnce(new Error('connect_failed'))
    await expect(main(['--dry-run'])).rejects.toThrow('connect_failed')
    expect(connection.end).toHaveBeenCalledOnce()
    connection.query.mockRejectedValueOnce(new Error('session_setup_failed'))
    await expect(main(['--dry-run'])).rejects.toThrow('session_setup_failed')
    expect(connection.end).toHaveBeenCalledTimes(2)
  })

  test('the script contains no internal protocol, state-file, old credential or subscription-surrogate machinery', async () => {
    const source = await readFile(new URL('../../script/vector-refresh.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(
      /node:fs|loadApiEnv|HYPERDRIVE_DATABASE_URL|--checkpoint|loadCheckpoint|writeCheckpoint|writeToken|verifyRefresh|VECTOR_BACKFILL_TOKEN|VECTOR_REFRESH_AUTH_TOKEN|user_bookmark_id|subscription_id|sr_user_collection_subscriber|X-Internal|internal\/v1|user-article|user-collection/
    )
  })
})
