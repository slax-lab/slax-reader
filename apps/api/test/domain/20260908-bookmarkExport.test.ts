import { describe, expect, test, vi } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { BookmarkController } from '@/handler/http/bookmarkController'
import { getRouter } from '@/di/generated/readerRouter'
import { Auth } from '@/utils/jwt'
import { isWhitelisted } from '@/middleware/auth'
import { createMockCtx } from '@test/helpers/mockFactory'

vi.mock('@/handler/http/mcpController', () => ({ McpServerController: class {} }))

vi.mock('@/decorators/di', () => ({ injectable: () => (target: any) => target, singleton: () => (target: any) => target, inject: () => () => undefined }))

const row = (id: number, changes = {}) => ({
  id,
  user_id: 7,
  deleted_at: null,
  alias_title: '',
  created_at: new Date('2026-09-08T00:00:00Z'),
  is_read: false,
  archive_status: 0,
  is_starred: false,
  type: 0,
  bookmark: { target_url: `https://example.test/${id}`, title: `Title ${id}`, status: 'failed' },
  sr_user_bookmark_tag: [],
  ...changes
})

function setup(initial: ReturnType<typeof row>[]) {
  let rows = initial
  const db = {
    sr_user_bookmark: {
      findFirst: vi.fn(async ({ where }: any) => rows.filter(r => r.user_id === where.user_id && r.deleted_at === null).sort((a, b) => b.id - a.id)[0] ?? null),
      findMany: vi.fn(async ({ where, take }: any) =>
        rows
          .filter(r => r.user_id === where.user_id && r.deleted_at === null && r.id > where.id.gt && r.id <= where.id.lte)
          .sort((a, b) => a.id - b.id)
          .slice(0, take)
      )
    }
  }
  const repo = new (BookmarkRepo as any)(
    () => null,
    () => db
  )
  repo.getLatestActiveUserBookmarkId = vi.fn(async (userId: number) =>
    db.sr_user_bookmark.findFirst({ where: { user_id: userId, deleted_at: null }, orderBy: { id: 'desc' }, select: { id: true } })
  )
  repo.listExportUserBookmarks = vi.fn(async (userId: number, afterId: number, upperId: number, take: number) =>
    db.sr_user_bookmark.findMany({
      where: { user_id: userId, deleted_at: null, id: { gt: afterId, lte: upperId } },
      take,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        alias_title: true,
        created_at: true,
        is_read: true,
        archive_status: true,
        is_starred: true,
        type: true,
        bookmark: { select: { target_url: true, title: true } },
        sr_user_bookmark_tag: { where: { user_id: userId, is_deleted: false }, orderBy: { id: 'asc' }, select: { tag_name: true, source: true } }
      }
    })
  )
  const service = new (BookmarkService as any)(repo) as BookmarkService
  const ctx = createMockCtx()
  ctx.getUserId = () => 7
  return {
    db,
    service,
    ctx,
    replace: (next: typeof rows) => {
      rows = next
    }
  }
}

describe('saved-link export', () => {
  test('exports exact text, sources, custom titles, shortcuts, failed fetches and independent states', async () => {
    const title = '=SUM(1,2)\n中文,"hi"'
    const { service, ctx, db } = setup([
      row(1, {
        alias_title: title,
        is_read: false,
        archive_status: 1,
        is_starred: true,
        sr_user_bookmark_tag: [
          { tag_name: '自动', source: 'ai' },
          { tag_name: 'old', source: '' },
          { tag_name: '手动', source: 'user' }
        ]
      }),
      row(2, { type: 1, is_read: true, archive_status: 2, bookmark: { target_url: 'https://shortcut.test/', title: '', status: 'pending' } }),
      row(3, { user_id: 8 }),
      row(4, { deleted_at: new Date() })
    ])
    const result = await service.exportBookmarks(ctx, null)
    expect(result.next_cursor).toBeNull()
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toEqual({
      url: 'https://example.test/1',
      title,
      tags: [
        { name: '自动', source: 'ai' },
        { name: 'old', source: '' },
        { name: '手动', source: 'user' }
      ],
      saved_at: '2026-09-08T00:00:00.000Z',
      is_read: false,
      is_archived: true,
      is_starred: true,
      type: 'article'
    })
    expect(result.items[1]).toMatchObject({ title: 'https://shortcut.test/', type: 'shortcut', is_read: true, is_archived: false, is_starred: false })
    expect(db.sr_user_bookmark.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 7, deleted_at: null, id: { gt: 0, lte: 2 } },
        take: 501,
        orderBy: { id: 'asc' },
        select: expect.objectContaining({ sr_user_bookmark_tag: { where: { user_id: 7, is_deleted: false }, orderBy: { id: 'asc' }, select: { tag_name: true, source: true } } })
      })
    )
  })

  test('keyset pages exclude later additions and survive earlier and future deletions', async () => {
    const initial = Array.from({ length: 1002 }, (_, i) => row(i + 1))
    const { service, ctx, db, replace } = setup(initial)
    const first = await service.exportBookmarks(ctx, null)
    expect(first.items).toHaveLength(500)
    replace([...initial.filter(r => r.id !== 1 && r.id !== 501), row(1003)])
    const second = await service.exportBookmarks(ctx, first.next_cursor)
    const third = await service.exportBookmarks(ctx, second.next_cursor)
    expect(second.items).toHaveLength(500)
    expect(third.items.map(r => r.url)).toEqual(['https://example.test/1002'])
    expect(third.next_cursor).toBeNull()
    expect(new Set([...first.items, ...second.items, ...third.items].map(r => r.url)).size).toBe(1001)
    expect(db.sr_user_bookmark.findFirst).toHaveBeenCalledTimes(1)
  })

  test('later pages reflect metadata at page read time', async () => {
    const initial = Array.from({ length: 501 }, (_, i) => row(i + 1))
    const { service, ctx, replace } = setup(initial)
    const first = await service.exportBookmarks(ctx, null)
    replace([...initial.slice(0, 500), row(501, { alias_title: 'Edited after page one', is_read: true, archive_status: 1, is_starred: true })])
    const second = await service.exportBookmarks(ctx, first.next_cursor)
    expect(second.items[0]).toMatchObject({ title: 'Edited after page one', is_read: true, is_archived: true, is_starred: true })
  })

  test.each(['missing', 'expired'])('generated export route rejects %s sessions before resolving a controller or querying', async session => {
    const { ctx, db } = setup([row(1)])
    Object.assign(ctx.env, { JWT_SECRET_TEXT: 'test-export-session-secret', JWT_ISSUER: 'reader-test', JWT_EXPIRES: '60', JWT_ALGORITHMS: 'HS256' })
    const resolve = vi.fn()
    const router = getRouter({ resolve } as any)
    const headers: Record<string, string> = {}
    if (session === 'expired') {
      const now = Date.now()
      try {
        vi.useFakeTimers()
        vi.setSystemTime(now - 120000)
        headers.Authorization = `Bearer ${await new Auth(ctx.env).sign({ id: '100', email: 'test@example.test', lang: 'en' })}`
      } finally {
        vi.useRealTimers()
      }
    }
    expect(isWhitelisted('/v1/bookmark/export')).toBe(false)
    await expect(router.fetch(new Request('https://reader.test/v1/bookmark/export', { headers }), ctx)).rejects.toMatchObject({ errCode: 401 })
    expect(resolve).not.toHaveBeenCalled()
    expect(db.sr_user_bookmark.findFirst).not.toHaveBeenCalled()
    expect(db.sr_user_bookmark.findMany).not.toHaveBeenCalled()
  })

  test('empty library returns no cursor; foreign or invalid cursors fail before querying', async () => {
    const { service, ctx, db } = setup([])
    expect(await service.exportBookmarks(ctx, null)).toEqual({ items: [], next_cursor: null })
    const invalid = [
      '',
      'bad!',
      btoa(JSON.stringify({ v: 1, user: 8, after: 1, upper: 2 })).replace(/=+$/, ''),
      btoa(JSON.stringify({ v: 1, user: 7, after: 3, upper: 2 })).replace(/=+$/, '')
    ]
    for (const cursor of invalid) await expect(service.exportBookmarks(ctx, cursor)).rejects.toMatchObject({ name: 'ERROR_PARAM', errCode: 400 })
    expect(db.sr_user_bookmark.findMany).not.toHaveBeenCalled()
  })

  test('page failure and orphaned records reject rather than returning a partial page', async () => {
    const { service, ctx, db, replace } = setup([row(1)])
    db.sr_user_bookmark.findMany.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(service.exportBookmarks(ctx, null)).rejects.toThrow('Database unavailable')
    replace([row(1, { bookmark: null })])
    await expect(service.exportBookmarks(ctx, null)).rejects.toThrow('Saved link has no bookmark record')
    replace([row(1)])
    expect((await service.exportBookmarks(ctx, null)).items).toHaveLength(1)
  })

  test('controller uses session context, ignores account/filter query fields and disables caching', async () => {
    const controller = new (BookmarkController as any)()
    const ctx = createMockCtx()
    const exportBookmarks = vi.fn().mockResolvedValue({ items: [], next_cursor: null })
    controller.bookmarkService = { exportBookmarks }
    const response = await controller.handleUserExportBookmarksRequest(ctx, new Request('https://reader.test/v1/bookmark/export?user_id=99&filter=read&cursor=abc'))
    expect(exportBookmarks).toHaveBeenCalledWith(ctx, 'abc')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ data: { items: [], next_cursor: null }, code: 200 })
  })
})
