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

  test('legacy Omnivore imports share the 10000-record cap before storage or enqueue', async () => {
    const bucketData = vi.fn()
    const service = Object.assign(Object.create(ImportService.prototype), { bucketData }) as ImportService
    await expect(service.importBookmark({} as never, 'omnivore', 'application/json', JSON.stringify(Array.from({ length: 10001 }, () => ({}))))).rejects.toBeDefined()
    expect(bucketData).not.toHaveBeenCalled()
  })
})
