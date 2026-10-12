/**
 * snapshot bookmark_uid 兼容（bugfix）：BookmarkRepo.createBookmarkShare 失败必须 throw
 *
 * 旧实现 catch 里 `return CreateBookmarkShareUniqueFail()`，错误对象会被上层 createShare 当成 share 行，
 * 导致返回畸形 200。修复为 `throw`。这里用打桩 prisma 触发 create 抛错，验证仓储层会 reject 领域错误。
 */
import { describe, test, expect, vi } from 'vitest'

import { BookmarkRepo } from '@/infra/repository/dbBookmark'

function wire(createImpl: () => any) {
  const create = vi.fn(createImpl)
  const prismaPg = () => ({ sr_bookmark_share: { create } })
  const repo = new (BookmarkRepo as any)()
  ;(repo as any).prismaPg = prismaPg
  return { repo: repo as BookmarkRepo, create }
}

describe('BookmarkRepo.createBookmarkShare', () => {
  test('prisma create 抛错 → reject 领域错误（errCode=400），而非 return 错误对象', async () => {
    const { repo } = wire(() => Promise.reject(new Error('unique constraint')))

    const err: any = await repo.createBookmarkShare('', 10, 42, true, false, true).catch((e: any) => e)
    expect(err).toBeDefined()
    // 关键：是被 throw 出来的领域错误，不能是 resolve 出来的错误对象
    expect(err.errCode).toBe(400)
  })

  test('成功 → 返回创建的 share 行，且字段映射正确', async () => {
    const row = { id: 1, share_code: 'code', user_id: 10, bookmark_id: 42 }
    const { repo, create } = wire(() => Promise.resolve(row))

    const res = await repo.createBookmarkShare('code', 10, 42, true, false, true)
    expect(res).toBe(row)
    // show_line/show_comment 取 showCommentLine；allow_comment/allow_line 取 allowAction
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        share_code: 'code',
        user_id: 10,
        bookmark_id: 42,
        show_userinfo: false,
        show_line: true,
        show_comment: true,
        allow_comment: true,
        allow_line: true
      })
    })
  })
})
