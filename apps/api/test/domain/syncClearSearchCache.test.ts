// local-first 同步需补清缓存
import { describe, expect, test, vi } from 'vitest'
import { SyncOrchestrator } from '@/domain/orchestrator/sync'
import { createMockCtx } from '@test/helpers/mockFactory'
import type { SyncChangeItem } from '@/domain/orchestrator/sync'

function buildOrchestrator() {
  const userService = { getUserInfo: vi.fn().mockResolvedValue({ uuid: 'user-uuid' }) }
  const dbSyncBatch = { executeOrderedOperations: vi.fn().mockResolvedValue([]) }
  const searchService = { clearSearchCache: vi.fn().mockResolvedValue(undefined) }
  const logsService = { track: vi.fn().mockResolvedValue(undefined) }
  const orchestrator = Object.create(SyncOrchestrator.prototype) as SyncOrchestrator
  Object.assign(orchestrator, { userService, dbSyncBatch, searchService, logsService })
  return { orchestrator, searchService }
}

function bookmarkChange(data: Record<string, string | null>): SyncChangeItem {
  return { table: 'sr_user_bookmark', id: 'bookmark-uuid', op: 'PATCH', data: data as never }
}

describe('syncChanges clears search cache for local-first trash/restore', () => {
  test('delete_bookmark triggers clearSearchCache', async () => {
    const { orchestrator, searchService } = buildOrchestrator()
    const ctx = createMockCtx({ userId: 7 })

    await orchestrator.syncChanges(ctx, [bookmarkChange({ deleted_at: '2026-08-07T00:00:00Z' })])

    expect(searchService.clearSearchCache).toHaveBeenCalledWith(ctx, 7)
  })

  test('restore_bookmark (deleted_at=null) triggers clearSearchCache', async () => {
    const { orchestrator, searchService } = buildOrchestrator()
    const ctx = createMockCtx({ userId: 7 })

    await orchestrator.syncChanges(ctx, [bookmarkChange({ deleted_at: null })])

    expect(searchService.clearSearchCache).toHaveBeenCalledWith(ctx, 7)
  })

  test('unrelated update does not touch search cache', async () => {
    const { orchestrator, searchService } = buildOrchestrator()
    const ctx = createMockCtx({ userId: 7 })

    await orchestrator.syncChanges(ctx, [bookmarkChange({ alias_title: 'new title' })])

    expect(searchService.clearSearchCache).not.toHaveBeenCalled()
  })
})
