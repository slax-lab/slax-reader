/**
 * /v1/bookmark/list topic filtering and /v1/tag/* id resolution at the controller edge.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))

import { decodeIdList, TagController } from '@/handler/http/tagController'
import { BookmarkController } from '@/handler/http/bookmarkController'
import { createMockCtx } from '@test/helpers/mockFactory'

const jsonReq = (body: unknown) => new Request('http://x/', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('decodeIdList', () => {
  test('splits, decodes, dedupes', () => {
    const ctx = createMockCtx()
    ctx.hashIds.decodeId.mockImplementation((v: string) => ({ a: 1, b: 2 })[v] || 0)

    expect(decodeIdList(ctx, 'a,b,a')).toEqual([1, 2])
  })

  test('any bad part empties the list', () => {
    const ctx = createMockCtx()
    ctx.hashIds.decodeId.mockImplementation((v: string) => ({ a: 1 })[v] || 0)

    expect(decodeIdList(ctx, 'a,zzz')).toEqual([])
    expect(decodeIdList(ctx, '')).toEqual([])
    expect(decodeIdList(ctx, undefined)).toEqual([])
  })
})

describe('GET /v1/bookmark/list', () => {
  function wire() {
    const bookmarkService = { bookmarkListByTopics: vi.fn().mockResolvedValue([]), bookmarkList: vi.fn().mockResolvedValue([]) }
    const controller = new (BookmarkController as any)()
    ;(controller as any).bookmarkService = bookmarkService
    return { controller: controller as BookmarkController, bookmarkService }
  }

  test('topic_ids=a,b filters by intersection', async () => {
    const { controller, bookmarkService } = wire()
    const ctx = createMockCtx()
    ctx.hashIds.decodeId.mockImplementation((v: string) => ({ a: 1, b: 2 })[v] || 0)

    await controller.handleUserGetBookmarksRequest(ctx, new Request('http://x/v1/bookmark/list?page=1&size=20&filter=topics&topic_ids=a,b'))

    expect(bookmarkService.bookmarkListByTopics).toHaveBeenCalledWith(ctx, 1, 20, [1, 2])
  })

  test('legacy topic_id still works', async () => {
    const { controller, bookmarkService } = wire()
    const ctx = createMockCtx()
    ctx.hashIds.decodeId.mockImplementation((v: string) => ({ a: 1 })[v] || 0)

    await controller.handleUserGetBookmarksRequest(ctx, new Request('http://x/v1/bookmark/list?page=1&size=20&filter=topics&topic_id=a'))

    expect(bookmarkService.bookmarkListByTopics).toHaveBeenCalledWith(ctx, 1, 20, [1])
  })

  test('undecodable topic id fails', async () => {
    const { controller, bookmarkService } = wire()
    const ctx = createMockCtx()
    ctx.hashIds.decodeId.mockReturnValue(0)

    const res = await controller.handleUserGetBookmarksRequest(ctx, new Request('http://x/v1/bookmark/list?page=1&size=20&filter=topics&topic_ids=zzz'))

    expect(bookmarkService.bookmarkListByTopics).not.toHaveBeenCalled()
    expect(res.status).not.toBe(200)
  })

  test('filter=untagged goes through the plain list', async () => {
    const { controller, bookmarkService } = wire()
    const ctx = createMockCtx()

    await controller.handleUserGetBookmarksRequest(ctx, new Request('http://x/v1/bookmark/list?page=2&size=10&filter=untagged'))

    expect(bookmarkService.bookmarkList).toHaveBeenCalledWith(ctx, 2, 10, 'untagged', undefined)
  })

  test('source is forwarded to the plain bookmark list query', async () => {
    const { controller, bookmarkService } = wire()
    const ctx = createMockCtx()

    await controller.handleUserGetBookmarksRequest(ctx, new Request('http://x/v1/bookmark/list?page=1&size=20&filter=inbox&source=example.com'))

    expect(bookmarkService.bookmarkList).toHaveBeenCalledWith(ctx, 1, 20, 'inbox', 'example.com')
  })
})

describe('/v1/tag/* id resolution', () => {
  function wire() {
    const tagService = {
      resolveTagId: vi.fn().mockResolvedValue(0),
      editTag: vi.fn().mockResolvedValue(null),
      promoteTag: vi.fn().mockResolvedValue({}),
      demoteTag: vi.fn().mockResolvedValue({}),
      deleteTag: vi.fn().mockResolvedValue(null),
      listCandidateTags: vi.fn().mockResolvedValue([]),
      listUserTags: vi.fn().mockResolvedValue([])
    }
    const controller = new (TagController as any)(tagService) as TagController
    return { controller, tagService }
  }

  test('update accepts tag_uuid', async () => {
    const { controller, tagService } = wire()
    tagService.resolveTagId.mockResolvedValue(7)
    const ctx = createMockCtx()

    await controller.handleUpdateTagRequest(ctx, jsonReq({ tag_uuid: 'u-7', tag_name: '新名' }))

    expect(tagService.resolveTagId).toHaveBeenCalledWith(ctx, expect.objectContaining({ tag_uuid: 'u-7' }))
    expect(tagService.editTag).toHaveBeenCalledWith(ctx, 7, '新名')
  })

  test('update with an unresolvable id fails before editing', async () => {
    const { controller, tagService } = wire()
    const ctx = createMockCtx()

    const res = await controller.handleUpdateTagRequest(ctx, jsonReq({ tag_id: 'bad', tag_name: '新名' }))

    expect(tagService.editTag).not.toHaveBeenCalled()
    expect(res.status).not.toBe(200)
  })

  test('promote needs one of tag_id / tag_uuid / tag_name', async () => {
    const { controller, tagService } = wire()
    const ctx = createMockCtx()

    const res = await controller.handlePromoteTagRequest(ctx, jsonReq({}))

    expect(tagService.promoteTag).not.toHaveBeenCalled()
    expect(res.status).not.toBe(200)
  })

  test('list?within=a,b returns candidates', async () => {
    const { controller, tagService } = wire()
    const ctx = createMockCtx()
    ctx.hashIds.decodeId.mockImplementation((v: string) => ({ a: 1, b: 2 })[v] || 0)

    await controller.handleListTagsRequest(ctx, new Request('http://x/v1/tag/list?within=a,b'))

    expect(tagService.listCandidateTags).toHaveBeenCalledWith(ctx, [1, 2])
    expect(tagService.listUserTags).not.toHaveBeenCalled()
  })
})
