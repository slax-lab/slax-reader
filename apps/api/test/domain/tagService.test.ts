/**
 * TagService: vocabulary ownership (mine / auto), claim by name, tag-page delete,
 * user vs AI attachment bookkeeping, and the "+" picker candidates.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))

import { TagService } from '@/domain/tag'
import { createMockBookmarkRepo, createMockCtx } from '@test/helpers/mockFactory'

function wire() {
  const repo = createMockBookmarkRepo()
  const svc = new (TagService as any)(repo) as TagService
  const ctx = createMockCtx()
  return { repo, svc, ctx }
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 7,
  uuid: 'uuid-7',
  user_id: 1,
  tag_name: '创业',
  display: true,
  source: 'auto',
  last_used_at: null,
  created_at: new Date('2026-01-01'),
  ...over
})

describe('listUserTags', () => {
  test('maps source and last_used_at, keeps repo order', async () => {
    const { repo, svc, ctx } = wire()
    repo.getUserTags.mockResolvedValue([row({ id: 1, tag_name: 'a', source: 'mine' }), row({ id: 2, tag_name: 'b' })])

    const res = await svc.listUserTags(ctx)

    expect(res.map(t => t.name)).toEqual(['a', 'b'])
    expect(res[0].source).toBe('mine')
    expect(res[1].source).toBe('auto')
  })
})

describe('resolveTagId', () => {
  test('tag_uuid looks the row up, never touches decodeId', async () => {
    const { repo, svc, ctx } = wire()
    repo.getUserTagByUuid.mockResolvedValue(row({ id: 9 }))

    expect(await svc.resolveTagId(ctx, { tag_uuid: 'uuid-9' })).toBe(9)
    expect(ctx.hashIds.decodeId).not.toHaveBeenCalled()
  })

  test('tag_id goes through decodeId', async () => {
    const { svc, ctx } = wire()
    ctx.hashIds.decodeId.mockReturnValue(5)

    expect(await svc.resolveTagId(ctx, { tag_id: 123 })).toBe(5)
  })

  test('neither given resolves to 0', async () => {
    const { svc, ctx } = wire()
    expect(await svc.resolveTagId(ctx, {})).toBe(0)
  })
})

describe('promoteTag', () => {
  test('by name: normalized match claims the existing auto tag instead of creating one', async () => {
    const { repo, svc, ctx } = wire()
    repo.findUserTagByName.mockResolvedValue(row({ id: 7, source: 'auto', display: false }))

    const res = await svc.promoteTag(ctx, { tag_name: '　创业 ' })

    expect(repo.findUserTagByName).toHaveBeenCalledWith(1, '创业')
    expect(repo.updateUserTagSource).toHaveBeenCalledWith(1, 7, 'mine')
    expect(repo.updateUserTagDisplay).toHaveBeenCalledWith(1, 7, true)
    expect(repo.createUserTag).not.toHaveBeenCalled()
    expect(res.source).toBe('mine')
  })

  test('by name: no match creates a mine tag', async () => {
    const { repo, svc, ctx } = wire()
    repo.findUserTagByName.mockResolvedValue(null)
    repo.createUserTag.mockResolvedValue(row({ id: 11, tag_name: '新词', source: 'mine' }))

    const res = await svc.promoteTag(ctx, { tag_name: '新词' })

    expect(repo.createUserTag).toHaveBeenCalledWith(1, '新词')
    expect(res.name).toBe('新词')
    expect(res.source).toBe('mine')
  })

  test('by uuid flips source to mine', async () => {
    const { repo, svc, ctx } = wire()
    repo.getUserTagByUuid.mockResolvedValue(row({ id: 7 }))
    repo.getUserTagById.mockResolvedValue(row({ id: 7 }))

    const res = await svc.promoteTag(ctx, { tag_uuid: 'uuid-7' })

    expect(repo.updateUserTagSource).toHaveBeenCalledWith(1, 7, 'mine')
    expect(res.source).toBe('mine')
  })

  test('blank name is rejected', async () => {
    const { svc, ctx } = wire()
    await expect(svc.promoteTag(ctx, { tag_name: '   ' })).rejects.toBeTruthy()
  })

  test('nothing to resolve is rejected', async () => {
    const { svc, ctx } = wire()
    await expect(svc.promoteTag(ctx, {})).rejects.toBeTruthy()
  })
})

describe('demoteTag', () => {
  test('mine goes back to auto, links untouched', async () => {
    const { repo, svc, ctx } = wire()
    ctx.hashIds.decodeId.mockReturnValue(7)
    repo.getUserTagById.mockResolvedValue(row({ id: 7, source: 'mine' }))

    const res = await svc.demoteTag(ctx, { tag_id: 77 })

    expect(repo.updateUserTagSource).toHaveBeenCalledWith(1, 7, 'auto')
    expect(repo.softDeleteBookmarkTagsByTag).not.toHaveBeenCalled()
    expect(res.source).toBe('auto')
  })
})

describe('deleteTag (tags page)', () => {
  test('detaches everywhere and hides the word', async () => {
    const { repo, svc, ctx } = wire()
    ctx.hashIds.decodeId.mockReturnValue(7)
    repo.getUserTagById.mockResolvedValue(row({ id: 7 }))

    await svc.deleteTag(ctx, { tag_id: 77 })

    expect(repo.softDeleteBookmarkTagsByTag).toHaveBeenCalledWith(1, 7)
    expect(repo.deleteUserTag).toHaveBeenCalledWith(1, 7)
  })
})

describe('deleteBookmarkTag (article page)', () => {
  test('orphaned auto tag is hidden', async () => {
    const { repo, svc, ctx } = wire()
    repo.countBookmarksByTag.mockResolvedValue(false)
    repo.getUserTagById.mockResolvedValue(row({ id: 7, source: 'auto' }))

    await svc.deleteBookmarkTag(ctx, 42, 7)

    expect(repo.deleteBookmarkTag).toHaveBeenCalledWith(42, 1, 7)
    expect(repo.deleteUserTag).toHaveBeenCalledWith(1, 7)
  })

  test('orphaned mine tag stays in the vocabulary', async () => {
    const { repo, svc, ctx } = wire()
    repo.countBookmarksByTag.mockResolvedValue(false)
    repo.getUserTagById.mockResolvedValue(row({ id: 7, source: 'mine' }))

    await svc.deleteBookmarkTag(ctx, 42, 7)

    expect(repo.deleteUserTag).not.toHaveBeenCalled()
  })
})

describe('user attachments', () => {
  test('addBookmarkTag by id writes source user and bumps recency', async () => {
    const { repo, svc, ctx } = wire()
    ctx.hashIds.decodeId.mockReturnValue(7)
    repo.getUserTagById.mockResolvedValue(row({ id: 7 }))

    const res = await svc.addBookmarkTag(ctx, 42, undefined, 77)

    expect(repo.createBookmarkTag).toHaveBeenCalledWith(42, 1, 7, '创业', 'user')
    expect(repo.touchUserTagsLastUsed).toHaveBeenCalledWith(1, [7])
    expect(res.added_by).toBe('user')
  })

  test('addBookmarkTags revives hidden words, writes source user, bumps recency for all', async () => {
    const { repo, svc, ctx } = wire()
    ctx.hashIds.decodeId.mockReturnValue(2)
    repo.createUserTags.mockResolvedValue([{ id: 3, tag_name: '新词' }])
    repo.updateUserTagsDisplay.mockResolvedValue([
      { id: 2, tag_name: '创业', source: 'mine' },
      { id: 3, tag_name: '新词', source: 'mine' }
    ])

    const res = await svc.addBookmarkTags(ctx, 42, [{ name: '创业', id: 22 }, { name: '新词' }])

    expect(repo.updateUserTagsDisplay).toHaveBeenCalledWith(1, ['新词', '创业'], true)
    expect(repo.upsertBookmarkTags).toHaveBeenCalledWith(42, 1, expect.any(Array), 'user')
    expect(repo.touchUserTagsLastUsed).toHaveBeenCalledWith(1, [2, 3])
    expect(res.every(t => t.added_by === 'user')).toBe(true)
  })
})

describe('listCandidateTags', () => {
  test('returns tags inside the intersection with counts, excluding the selected ones', async () => {
    const { repo, svc, ctx } = wire()
    repo.getUserTagsByIds
      .mockResolvedValueOnce([row({ id: 1, uuid: 'u1' }), row({ id: 2, uuid: 'u2' })])
      .mockResolvedValueOnce([row({ id: 3, tag_name: '播客' }), row({ id: 4, tag_name: '效率' }), row({ id: 5, tag_name: '隐藏', display: false })])
    repo.countTagsWithinBookmarks.mockResolvedValue([
      { tag_id: 3, count: 1 },
      { tag_id: 4, count: 3 },
      { tag_id: 5, count: 2 }
    ])

    const res = await svc.listCandidateTags(ctx, [1, 2])

    expect(repo.countTagsWithinBookmarks).toHaveBeenCalledWith(1, ['u1', 'u2'], [1, 2])
    expect(res.map(t => [t.name, t.count])).toEqual([
      ['效率', 3],
      ['播客', 1]
    ])
  })

  test('unknown selected id is rejected', async () => {
    const { repo, svc, ctx } = wire()
    repo.getUserTagsByIds.mockResolvedValueOnce([row({ id: 1 })])

    await expect(svc.listCandidateTags(ctx, [1, 2])).rejects.toBeTruthy()
  })
})

describe('getBookmarkTags', () => {
  test('exposes who attached each tag', async () => {
    const { repo, svc, ctx } = wire()
    repo.getBookmarkTags.mockResolvedValue([
      { tag_id: 1, tag_name: 'a', source: 'ai' },
      { tag_id: 2, tag_name: 'b', source: 'user' },
      { tag_id: 3, tag_name: 'c', source: '' }
    ])

    const res = await svc.getBookmarkTags(ctx, 1, 42)

    expect(res.map(t => t.added_by)).toEqual(['ai', 'user', ''])
  })
})
