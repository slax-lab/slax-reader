import { describe, test, expect, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))

import { ContentOrchestrator } from '@/domain/orchestrator/content'
import { resolveBookmarkReadAccess } from '@/utils/bookmarkAccess'
import { createMockCtx } from '@test/helpers/mockFactory'

const BM = {
  id: 10, uuid: 'bm-uuid', title: 'Test Article', host_url: 'example.com',
  target_url: 'https://example.com/article', site_name: 'Example', content_icon: '',
  content_cover: 'https://example.com/cover.jpg', content_key: 'html/parse/old.html',
  content_md_key: 'mk', content_word_count: 500, description: 'A test article',
  byline: 'Author', private_user: 0, status: 'success',
  created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-02'), published_at: new Date('2026-01-01')
}

const ub = (o: Record<string, any> = {}) => ({
  id: 1, uuid: 'ub-uuid', user_id: 10, bookmark_id: 10,
  is_read: false, archive_status: 0, is_starred: false,
  alias_title: '', type: 0, deleted_at: null,
  metadata: { share: null }, bookmark: BM, ...o
})

const share = (o: Record<string, any> = {}) => ({
  is_enable: true, show_line: true, show_comment: true,
  show_userinfo: true, allow_comment: false, allow_line: false, ...o
})

function wire() {
  const bs = {
    getUserBookmarkByUuidWithDetail: vi.fn(),
    getBookmarkOutline: vi.fn().mockResolvedValue(null)
  }
  const us = {
    getOwnerShareInfo: vi.fn().mockResolvedValue({ nick_name: 'Alice', avatar: '', snapshot_sharing: true })
  }
  const ts = { getBookmarkTags: vi.fn().mockResolvedValue([{ id: 't1', name: 'tech', show_name: 'tech' }]) }
  const ms = { getFirstComment: vi.fn().mockResolvedValue('我的首条评论') }
  const cs = { getBookmarkCollectionRef: vi.fn().mockResolvedValue(null) }
  const service = {
    ...bs,
    getBookmarkReadAccess: async (ctx: any, uuid: string) => {
      const row = await bs.getUserBookmarkByUuidWithDetail(uuid)
      return resolveBookmarkReadAccess({
        getUserBookmarkByUuidWithDetail: async () => row,
        getBookmarkShareByBookmarkId: async () => row?.metadata?.share ?? null
      } as any, { getInfoByUserId: () => us.getOwnerShareInfo() } as any, ctx.getUserId(), uuid)
    }
  }
  return { orch: new (ContentOrchestrator as any)(service, us, ts, ms, cs) as ContentOrchestrator, bs, us, ts, ms, cs }
}

describe('getContentMeta', () => {
  test.each([0, 20, 10])('hidden profile does not expose collection identity to viewer %s; owner retains footer', async userId => {
    const { orch, bs, cs } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ metadata: { share: share({ show_userinfo: false }) } }))
    cs.getBookmarkCollectionRef.mockResolvedValue({ name: 'Owner collection', code: 'identifying-code' })
    const result = await orch.getContentMeta(createMockCtx({ userId }), 'ub-uuid')
    if (userId === 10) expect(result).toHaveProperty('collection.code', 'identifying-code')
    else {
      expect(result).not.toHaveProperty('collection')
      expect(cs.getBookmarkCollectionRef).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toContain('identifying-code')
    }
  })

  test('Owner → role=owner, content_key', async () => {
    const { orch, bs } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub())
    const res = await orch.getContentMeta(createMockCtx({ userId: 10 }), 'ub-uuid')
    expect(res.role).toBe('owner')
    expect(res.content_key).toBe('html/parse/old.html')
    expect(res).toHaveProperty('archived')
  })

  test('Visitor + Personal Share → role=visitor, 带首条评论', async () => {
    const { orch, bs, ms, ts } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ metadata: { share: share() } }))
    const res = await orch.getContentMeta(createMockCtx({ userId: 0 }), 'x')
    expect(res.role).toBe('visitor')
    expect(res.user_info?.nick_name).toBe('Alice')
    expect(res.user_info?.show_userinfo).toBe(true)
    expect(res.tags).toHaveLength(1)
    expect(res.first_comment).toBe('我的首条评论')
    // 首条评论按 user_bookmark.id 查询（sr_bookmark_comment.bookmark_id 存的是 user_bookmark.id），
    // 而非全局 bookmark_id；标签/outline 才用全局 bookmark_id。
    expect(ms.getFirstComment).toHaveBeenCalledWith(1, 10)
    expect(ts.getBookmarkTags).toHaveBeenCalledWith(expect.anything(), 10, 10)
  })

  test('Visitor + 手动关闭 show_userinfo → 不查首条评论, first_comment 为空', async () => {
    const { orch, bs, ms } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ metadata: { share: share({ show_userinfo: false }) } }))
    const res = await orch.getContentMeta(createMockCtx({ userId: 0 }), 'x')
    expect(res.first_comment).toBe('')
    expect(res.user_info?.show_userinfo).toBe(false)
    expect(ms.getFirstComment).not.toHaveBeenCalled()
  })

  test('share.is_enable=false → 404', async () => {
    const { orch, bs } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ metadata: { share: share({ is_enable: false }) } }))
    await expect(orch.getContentMeta(createMockCtx({ userId: 0 }), 'x')).rejects.toThrow()
  })

  test('share 为 null（全局 snapshot）→ visitor 默认展示痕迹', async () => {
    const { orch, bs } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ metadata: { share: null } }))
    const res = await orch.getContentMeta(createMockCtx({ userId: 0 }), 'x')
    expect(res.role).toBe('visitor')
    // show_userinfo 默认开启：无显式 share 配置时也展示昵称/标签/首条评论
    expect(res.user_info?.show_userinfo).toBe(true)
    expect(res.user_info?.nick_name).toBe('Alice')
    expect(res.tags).toHaveLength(1)
    expect(res.first_comment).toBe('我的首条评论')
  })

  test('share=null + 全局 snapshot 关 → 404', async () => {
    const { orch, bs, us } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ metadata: { share: null } }))
    us.getOwnerShareInfo.mockResolvedValue({ nick_name: 'Alice', avatar: '', snapshot_sharing: false })
    await expect(orch.getContentMeta(createMockCtx({ userId: 0 }), 'x')).rejects.toThrow()
  })

  test('文章显式开启 + 全局 snapshot 关 → 允许（文章覆盖全局）', async () => {
    const { orch, bs, us } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ metadata: { share: share() } }))
    us.getOwnerShareInfo.mockResolvedValue({ nick_name: 'Alice', avatar: '', snapshot_sharing: false })
    const res = await orch.getContentMeta(createMockCtx({ userId: 0 }), 'x')
    expect(res.role).toBe('visitor')
    expect(res.user_info?.nick_name).toBe('Alice')
  })

  test('Visitor + moderated content is rejected before loading private traces', async () => {
    const { orch, bs, ms, ts } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ bookmark: { ...BM, moderation_result: 1 } }))
    await expect(orch.getContentMeta(createMockCtx({ userId: 0 }), 'x')).rejects.toThrow()
    expect(ms.getFirstComment).not.toHaveBeenCalled()
    expect(ts.getBookmarkTags).not.toHaveBeenCalled()
  })

  test('Visitor + deleted → 404', async () => {
    const { orch, bs } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ deleted_at: new Date() }))
    await expect(orch.getContentMeta(createMockCtx({ userId: 0 }), 'x')).rejects.toThrow()
  })

  test('Owner + deleted → 仍可访问', async () => {
    const { orch, bs } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ deleted_at: new Date() }))
    const res = await orch.getContentMeta(createMockCtx({ userId: 10 }), 'ub-uuid')
    expect(res.role).toBe('owner')
  })

  test('找不到 → 404', async () => {
    const { orch, bs } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(null)
    await expect(orch.getContentMeta(createMockCtx({ userId: 0 }), 'bad')).rejects.toThrow()
  })

  test('已生成 outline → 返回 outline 字段', async () => {
    const { orch, bs } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub())
    bs.getBookmarkOutline.mockResolvedValue('## 文章大纲\n- 要点一')
    const res = await orch.getContentMeta(createMockCtx({ userId: 10 }), 'ub-uuid')
    expect((res as any).outline).toBe('## 文章大纲\n- 要点一')
    expect(bs.getBookmarkOutline).toHaveBeenCalledWith(10, 10)
  })

  test('未生成 outline → outline 为空串', async () => {
    const { orch, bs } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub())
    bs.getBookmarkOutline.mockResolvedValue(null)
    const res = await orch.getContentMeta(createMockCtx({ userId: 10 }), 'ub-uuid')
    expect((res as any).outline).toBe('')
  })

  test('visitor 看到的 outline 取 owner 的', async () => {
    const { orch, bs } = wire()
    bs.getUserBookmarkByUuidWithDetail.mockResolvedValue(ub({ metadata: { share: share() } }))
    bs.getBookmarkOutline.mockResolvedValue('owner 的大纲')
    const res = await orch.getContentMeta(createMockCtx({ userId: 0 }), 'x')
    expect((res as any).outline).toBe('owner 的大纲')
    expect(bs.getBookmarkOutline).toHaveBeenCalledWith(10, 10)
  })
})
