/**
 * PowerSync 通道的 star / unstar / trash 埋点
 * 来源: src/domain/orchestrator/sync.ts
 *
 * dweb 是 local-first，加星/回收站不走 REST /star、/trash，只经 connect_changes 批量通道。
 * 埋点不自己判断变更列，而是复用上游 processUserBookmarkChange 产出的 operations，
 * 避免与上游解析口径分叉。本测试钉住「哪些变更该埋、哪些不该埋」。
 */
import { describe, expect, test, vi } from 'vitest'
import { SyncOrchestrator } from '@/domain/orchestrator/sync'
import { createMockCtx } from '@test/helpers/mockFactory'
import type { SyncChangeItem } from '@/domain/orchestrator/sync'

const BOOKMARK_UUID = 'bookmark-uuid'

function track(changes: SyncChangeItem[], userId = 7) {
  const logsService = { track: vi.fn().mockResolvedValue(undefined) }
  const orchestrator = Object.create(SyncOrchestrator.prototype) as SyncOrchestrator
  Object.assign(orchestrator, { logsService })
  const ctx = createMockCtx({ userId })
  ;(orchestrator as unknown as { trackBookmarkChanges: (c: unknown, ch: SyncChangeItem[]) => void }).trackBookmarkChanges(ctx, changes)
  return logsService.track
}

function bookmarkChange(data: Record<string, string>, op: SyncChangeItem['op'] = 'PATCH'): SyncChangeItem {
  return { table: 'sr_user_bookmark', id: BOOKMARK_UUID, op, data }
}

function createChange(extra: Record<string, string> = {}): SyncChangeItem {
  return bookmarkChange(
    {
      is_starred: '0',
      archive_status: '0',
      metadata: JSON.stringify({ tags: [], share: null, bookmark: { target_url: 'https://a.com', title: 'a', content_icon: '', description: '' } }),
      ...extra
    },
    'PUT'
  )
}

function operationsFor(change: SyncChangeItem) {
  const operations: any[] = []
  const orchestrator = Object.create(SyncOrchestrator.prototype) as SyncOrchestrator
  orchestrator.processUserBookmarkChange(change, 7, operations)
  return operations
}

describe('PowerSync bookmark operation routing', () => {
  test('APP PUT with deleted_at=null is a create', () => {
    expect(operationsFor(createChange({ deleted_at: null } as never))).toMatchObject([{ type: 'create_bookmark' }])
  })

  test('web PUT without deleted_at is a create', () => {
    expect(operationsFor(createChange())).toMatchObject([{ type: 'create_bookmark' }])
  })

  test('ordinary PATCH remains an update', () => {
    expect(operationsFor(bookmarkChange({ alias_title: 'new title' }))).toMatchObject([{ type: 'update_bookmark', data: { alias_title: 'new title' } }])
  })

  test('PATCH with deleted_at remains a delete', () => {
    expect(operationsFor(bookmarkChange({ deleted_at: '2026-08-07T00:00:00Z' }))).toMatchObject([{ type: 'delete_bookmark' }])
  })

  test('PATCH with deleted_at=null is a restore, not a delete', () => {
    expect(operationsFor(bookmarkChange({ deleted_at: null } as never))).toMatchObject([{ type: 'restore_bookmark' }])
  })

  test('PATCH with deleted_at="" is a restore, not a delete', () => {
    expect(operationsFor(bookmarkChange({ deleted_at: '' }))).toMatchObject([{ type: 'restore_bookmark' }])
  })
})

describe('PowerSync 加星埋点', () => {
  test('加星 → star', () => {
    const t = track([bookmarkChange({ is_starred: '1', starred_at: '2026-08-07T00:00:00Z' })])
    expect(t).toHaveBeenCalledTimes(1)
    expect(t).toHaveBeenCalledWith(7, 'star', { bookmark_uuid: BOOKMARK_UUID, channel: 'powersync' })
  })

  test('取消加星 → unstar，两个方向都埋才看得见 churn', () => {
    const t = track([bookmarkChange({ is_starred: '0' })])
    expect(t).toHaveBeenCalledTimes(1)
    expect(t).toHaveBeenCalledWith(7, 'unstar', { bookmark_uuid: BOOKMARK_UUID, channel: 'powersync' })
  })
})

describe('PowerSync 回收站埋点', () => {
  test('移入回收站 → trash', () => {
    const t = track([bookmarkChange({ deleted_at: '2026-08-07T00:00:00Z' })])
    expect(t).toHaveBeenCalledTimes(1)
    expect(t).toHaveBeenCalledWith(7, 'trash', { bookmark_uuid: BOOKMARK_UUID, channel: 'powersync' })
  })

  test('deleted_at 优先于其它列，与上游判定顺序一致', () => {
    const t = track([bookmarkChange({ deleted_at: '2026-08-07T00:00:00Z', is_starred: '1' })])
    expect(t).toHaveBeenCalledTimes(1)
    expect(t).toHaveBeenCalledWith(7, 'trash', expect.anything())
  })
})

describe('不该埋的情形', () => {
  test('新建书签带 is_starred=0，不能记成 unstar', () => {
    expect(track([createChange()])).not.toHaveBeenCalled()
  })

  test('只改别名，不埋', () => {
    expect(track([bookmarkChange({ alias_title: 'new title' })])).not.toHaveBeenCalled()
  })

  test('只改已读，不埋', () => {
    expect(track([bookmarkChange({ is_read: '1' })])).not.toHaveBeenCalled()
  })

  test('只改归档，不埋（归档由 REST /archive 端点负责）', () => {
    expect(track([bookmarkChange({ archive_status: '1', archived_at: '2026-08-07T00:00:00Z' })])).not.toHaveBeenCalled()
  })

  test('非书签表，不埋', () => {
    expect(track([{ table: 'sr_user_tag', id: 'tag-uuid', op: 'PUT', data: { tag_name: 'x' } }])).not.toHaveBeenCalled()
  })

  test('metadata 解析失败被吞掉，不影响主流程', () => {
    expect(() => track([bookmarkChange({ metadata: '{ broken' }, 'PUT')])).not.toThrow()
  })
})

describe('批量变更', () => {
  test('一批里多条书签变更逐条埋', () => {
    const t = track([
      { table: 'sr_user_bookmark', id: 'a', op: 'PATCH', data: { is_starred: '1' } },
      { table: 'sr_user_bookmark', id: 'b', op: 'PATCH', data: { deleted_at: '2026-08-07T00:00:00Z' } },
      { table: 'sr_user_bookmark', id: 'c', op: 'PATCH', data: { alias_title: 'x' } }
    ])
    expect(t).toHaveBeenCalledTimes(2)
    expect(t).toHaveBeenCalledWith(7, 'star', { bookmark_uuid: 'a', channel: 'powersync' })
    expect(t).toHaveBeenCalledWith(7, 'trash', { bookmark_uuid: 'b', channel: 'powersync' })
  })
})
