/**
 * BookmarkService.tagBookmark (AI attachment): looks names up in this user's live vocabulary,
 * never creates words, writes links as "ai", never bumps last_used_at.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))

import { BookmarkService } from '@/domain/bookmark'
import { createMockBookmarkRepo, createMockCtx } from '@test/helpers/mockFactory'

function wire() {
  const repo = createMockBookmarkRepo()
  const svc = new (BookmarkService as any)() as BookmarkService
  ;(svc as any).bookmarkRepo = repo
  return { repo, svc, ctx: createMockCtx() }
}

describe('tagBookmark', () => {
  test('attaches only vocabulary hits, as ai, without touching recency', async () => {
    const { repo, svc, ctx } = wire()
    repo.getUserTagsByNames.mockResolvedValue([{ id: 3, tag_name: '创业' }])

    await svc.tagBookmark(ctx, 7, 42, ['创业', '无关'])

    expect(repo.getUserTagsByNames).toHaveBeenCalledWith(7, ['创业', '无关'])
    expect(repo.upsertBookmarkTags).toHaveBeenCalledWith(42, 7, [{ id: 3, tag_name: '创业' }], 'ai')
    expect(repo.updateUserTagsDisplay).not.toHaveBeenCalled()
    expect(repo.createUserTag).not.toHaveBeenCalled()
    expect(repo.touchUserTagsLastUsed).not.toHaveBeenCalled()
  })

  test('nothing in the vocabulary → no write', async () => {
    const { repo, svc, ctx } = wire()
    repo.getUserTagsByNames.mockResolvedValue([])

    await svc.tagBookmark(ctx, 7, 42, ['无关'])

    expect(repo.upsertBookmarkTags).not.toHaveBeenCalled()
  })
})
