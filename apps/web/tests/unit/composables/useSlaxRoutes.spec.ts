import type { HighlightItem } from '@slax-reader/contracts/interface'
import { describe, expect, it } from 'vitest'

// fork 覆盖：统一跳 /b/
describe('useSlaxRoutes (fork override → /b/)', () => {
  const mkHighlight = (over: Partial<HighlightItem>): HighlightItem =>
    ({ id: 9, type: 'mark', content: [], created_at: '', title: '', comment: '', source_type: 'bookmark', source_id: 'x', ...over }) as HighlightItem

  describe('snapshotRoute', () => {
    it('优先用 bookmark_user_uuid 跳 /b/[id]（REST 列表形状，uuid 优先于 id）', async () => {
      const { useSlaxRoutes } = await import('~~/app/composables/useSlaxRoutes')
      expect(useSlaxRoutes().snapshotRoute({ id: 1000001, bookmark_user_uuid: 'uuid-abc' })).toBe('/b/uuid-abc')
    })

    it('无 id（搜索结果形状）时回退 bookmark_user_uuid', async () => {
      const { useSlaxRoutes } = await import('~~/app/composables/useSlaxRoutes')
      expect(useSlaxRoutes().snapshotRoute({ bookmark_id: 42, bookmark_user_uuid: 'uuid-x' })).toBe('/b/uuid-x')
    })

    it('无 id 且无 uuid：返回 null（由调用方降级）', async () => {
      const { useSlaxRoutes } = await import('~~/app/composables/useSlaxRoutes')
      expect(useSlaxRoutes().snapshotRoute({ bookmark_id: 42 })).toBeNull()
      expect(useSlaxRoutes().snapshotRoute({})).toBeNull()
    })
  })

  describe('highlightRoute', () => {
    it('所有来源统一跳 /b/{source_id}，带 highlight 查询参数', async () => {
      const { useSlaxRoutes } = await import('~~/app/composables/useSlaxRoutes')
      const { highlightRoute } = useSlaxRoutes()
      expect(highlightRoute(mkHighlight({ source_type: 'share', source_id: 's1' }))).toBe('/b/s1?highlight=9')
      expect(highlightRoute(mkHighlight({ source_type: 'collection', source_id: 'c1' }))).toBe('/b/c1?highlight=9')
      expect(highlightRoute(mkHighlight({ source_type: 'bookmark', source_id: 'b1' }))).toBe('/b/b1?highlight=9')
    })

    it('REST 列表形状：优先用 bookmark_user_uuid（source_id 为编码 id，非 uuid）', async () => {
      const { useSlaxRoutes } = await import('~~/app/composables/useSlaxRoutes')
      const { highlightRoute } = useSlaxRoutes()
      expect(highlightRoute(mkHighlight({ source_type: 'bookmark', source_id: 'encoded-id', bookmark_user_uuid: 'uuid-abc' }))).toBe('/b/uuid-abc?highlight=9')
    })
  })

  // #imports 验证 layers 覆盖
  it('Nuxt 自动导入覆盖：#imports 解析到 fork 版', async () => {
    const { useSlaxRoutes } = await import('#imports')
    expect(useSlaxRoutes().snapshotRoute({ id: 7 })).toBe('/b/7')
    expect(useSlaxRoutes().highlightRoute(mkHighlight({ source_type: 'bookmark', source_id: '7' }))).toBe('/b/7?highlight=9')
  })
})
