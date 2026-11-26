import { describe, expect, test, vi } from 'vitest'
import { BookmarkController } from '@/handler/http/bookmarkController'
import { SyncController } from '@/handler/http/syncController'
import { ImportService } from '@/domain/import'

describe('resource boundaries', () => {
  test('does not run the index rebuild maintenance route outside development', async () => {
    const searchService = { getUserBookmarkItem: vi.fn() }
    const controller = Object.assign(Object.create(BookmarkController.prototype), { searchService }) as BookmarkController
    const response = await controller.handleDevRebuildSearchIndex({ env: { RUN_ENV: 'prod' } } as never, new Request('https://api.example/dev', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(404)
    expect(searchService.getUserBookmarkItem).not.toHaveBeenCalled()
  })

  test.each([-1, 0, 101, 1.2, '10'])('rejects invalid development rebuild limit %s', async limit => {
    const searchService = { getUserBookmarkItem: vi.fn() }
    const controller = Object.assign(Object.create(BookmarkController.prototype), { searchService }) as BookmarkController
    await controller.handleDevRebuildSearchIndex(
      { env: { RUN_ENV: 'development' } } as never,
      new Request('https://api.example/dev', { method: 'POST', body: JSON.stringify({ limit }) })
    )
    expect(searchService.getUserBookmarkItem).not.toHaveBeenCalled()
  })

  test.each([{}, Array.from({ length: 1001 }, () => ({}))])('rejects malformed or oversized sync batches', async body => {
    const syncChanges = vi.fn()
    const controller = new SyncController({ syncChanges } as never, { ensureUserNotDeleted: vi.fn().mockResolvedValue(undefined) } as never)
    await controller.handleSyncSaveRequest({ getUserId: () => 1 } as never, new Request('https://api.example/changes', { method: 'POST', body: JSON.stringify(body) }))
    expect(syncChanges).not.toHaveBeenCalled()
  })

  test('a failed sync batch logs its cause and Ray ID without the change payload', async () => {
    const failure = Object.assign(new Error('Unique constraint failed'), { name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { target: ['uuid'] } })
    const syncChanges = vi.fn().mockRejectedValue(failure)
    const controller = new SyncController({ syncChanges } as never, { ensureUserNotDeleted: vi.fn().mockResolvedValue(undefined) } as never)
    const ctx = { getUserId: () => 7, get: (key: string) => (key === 'rayId' ? 'a5f5911d1ca2fdc2' : undefined) }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const body = [{ table: 'sr_user_bookmark', op: 'PATCH', data: { title: 'private title' } }]
    await controller.handleSyncSaveRequest(ctx as never, new Request('https://api.example/changes', { method: 'POST', body: JSON.stringify(body) }))
    expect(error).toHaveBeenCalledWith('handleSyncSaveRequest failed', {
      userId: 7,
      count: 1,
      table: 'sr_user_bookmark',
      op: 'PATCH',
      ray: 'a5f5911d1ca2fdc2',
      name: 'PrismaClientKnownRequestError',
      message: 'Unique constraint failed',
      code: 'P2002',
      meta: { target: ['uuid'] }
    })
    expect(JSON.stringify(error.mock.calls)).not.toContain('private title')
    error.mockRestore()
  })

  test('a failed multi-change sync batch omits table and op, and a request without a Ray ID omits it', async () => {
    const syncChanges = vi.fn().mockRejectedValue(new Error('boom'))
    const controller = new SyncController({ syncChanges } as never, { ensureUserNotDeleted: vi.fn().mockResolvedValue(undefined) } as never)
    const ctx = { getUserId: () => 7, get: () => undefined }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const body = [
      { table: 'sr_user_bookmark', op: 'PATCH', data: { title: 'a' } },
      { table: 'sr_mark', op: 'PUT', data: { comment: 'b' } }
    ]
    await controller.handleSyncSaveRequest(ctx as never, new Request('https://api.example/changes', { method: 'POST', body: JSON.stringify(body) }))
    expect(error).toHaveBeenCalledWith('handleSyncSaveRequest failed', { userId: 7, count: 2, name: 'Error', message: 'boom' })
    error.mockRestore()
  })

  test('legacy Omnivore imports share the 10000-record cap before storage or enqueue', async () => {
    const bucketData = vi.fn()
    const service = Object.assign(Object.create(ImportService.prototype), { bucketData }) as ImportService
    await expect(service.importBookmark({} as never, 'omnivore', 'application/json', JSON.stringify(Array.from({ length: 10001 }, () => ({}))))).rejects.toBeDefined()
    expect(bucketData).not.toHaveBeenCalled()
  })
})
