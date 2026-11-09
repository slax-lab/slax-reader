import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { enumeratePage, main, parseRefreshOptions, runVectorRefresh } from '../../script/vector-refresh'
import { VectorMaintenanceService } from '../../src/domain/vectorMaintenance'
import { memoryPreferences } from '../helpers/preferenceMemory'

const connection = vi.hoisted(() => ({ client: vi.fn(), connect: vi.fn(), query: vi.fn(), end: vi.fn() }))
vi.mock('pg', () => ({ Client: connection.client }))

const SECRET = 'temporary-task-secret-9b3d'

function accepted(data: unknown = { state: 'written' }) {
  return { code: 200, data, message: 'ok' }
}

beforeEach(() => {
  vi.clearAllMocks()
  connection.client.mockImplementation(() => connection)
  connection.connect.mockResolvedValue(undefined)
  connection.query.mockResolvedValue({ rows: [] })
  connection.end.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('direct single-target service surface', () => {
  test('the compound actor/relation wrappers and preference flag are gone', () => {
    const service = (preferences => preferences.bind(new VectorMaintenanceService({} as never, {} as never, {} as never, {} as never, preferences.client)))(
      memoryPreferences()
    ) as unknown as Record<string, unknown>
    for (const removed of ['refreshBookmark', 'refreshOwnedCollection', 'refreshSubscription']) expect(service[removed]).toBeUndefined()
    for (const direct of ['refreshArticles', 'refreshUser', 'refreshCollection']) expect(typeof service[direct]).toBe('function')
  })

  test('preference enumeration treats ids and cursors as user IDs, not relation or subscription surrogates', async () => {
    const query = vi.fn(async () => ({
      rows: [{ id: 40 }, { id: 41 }]
    }))
    const page = await enumeratePage({ query }, 'subscription', 0, parseRefreshOptions(['--kind', 'subscription', '--ids', '40,41']))
    expect(page.rows).toEqual([
      { cursor: 40, userId: 40 },
      { cursor: 41, userId: 41 }
    ])
    expect(query.mock.calls[0][1]).toEqual([0, null, [40, 41], 10])
    expect(query.mock.calls[0][0]).not.toMatch(/subscription|sr_user_bookmark/)
    expect((await enumeratePage({ query }, 'article-preference', 0, parseRefreshOptions(['--kind', 'article-preference', '--after-id', '39']))).rows).toEqual([
      { cursor: 40, userId: 40 },
      { cursor: 41, userId: 41 }
    ])
  })
})

describe('sequential caller continuation', () => {
  test('an early failed request does not suppress later users and the run ends nonzero', async () => {
    vi.stubEnv('VECTOR_REFRESH_DATABASE_URL', 'postgres://unused.invalid/db')
    vi.stubEnv('VECTOR_REFRESH_URL', 'http://localhost:8787')
    vi.stubEnv('VECTOR_REFRESH_SECRET', SECRET)
    connection.query.mockImplementation(async (text: string, values: unknown[]) => (text.startsWith('SELECT') && values[0] === 0 ? { rows: [{ id: 1 }, { id: 2 }] } : { rows: [] }))
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('task transport failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify(accepted()), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(main(['--kind', 'article-preference', '--batch', '50'])).rejects.toThrow('refresh_incomplete')

    expect(fetch.mock.calls.map(([, request]) => JSON.parse(request.body))).toEqual([{ user_id: 1 }, { user_id: 2 }])
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({ counts: { received: 1, pending: 0, failed: 1 }, enumerated: 2 })
    const rows = log.mock.calls.slice(0, -1).map(([message]) => JSON.parse(message))
    expect(rows).toEqual([
      { stage: 'article-preference', cursor: 1, userId: 1, afterId: 0, failed: true, reason: 'refresh_request_failed' },
      { stage: 'article-preference', cursor: 2, userId: 2, afterId: 1, result: { state: 'written' }, pending: false, failed: false }
    ])
    expect(connection.end).toHaveBeenCalledOnce()
  })

  test('one user target is sent once per preference stage even with several subscriptions', async () => {
    const query = vi.fn(async (_text: string, values: unknown[]) => ({ rows: values[0] === 0 ? [{ id: 3 }] : [] }))
    const send = vi.fn(async () => accepted())
    await runVectorRefresh(parseRefreshOptions(['--kind', 'subscription']), { db: { query }, send })
    expect(send).toHaveBeenCalledExactlyOnceWith('subscription', { cursor: 3, userId: 3 })
    expect(query.mock.calls[0][0]).not.toMatch(/sr_user_collection_subscriber|subscription_id/)
  })

  test('a pending preference result does not suppress the next user', async () => {
    const sent: number[] = []
    const send = vi.fn(async (stage: string, row: { userId: number }) => {
      sent.push(row.userId)
      return row.userId === 1 ? accepted({ state: 'pending' }) : accepted()
    })
    const query = async (_text: string, values: unknown[]) => ({ rows: values[0] === 0 ? [{ id: 1 }, { id: 2 }] : [] })
    const result = await runVectorRefresh(parseRefreshOptions(['--kind', 'article-preference']), { db: { query }, send })
    expect(sent).toEqual([1, 2])
    expect(result.counts).toEqual({ received: 2, pending: 1, failed: 0 })
  })
})
