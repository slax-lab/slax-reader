import { describe, expect, test, vi } from 'vitest'
import { CollectionService } from '@/domain/collection'
import { CollectionOrchestrator } from '@/domain/orchestrator/collection'
import { createMockCtx } from '@test/helpers/mockFactory'

describe('Collection list policy response', () => {
  test('preserves mark display without returning policy or overview', async () => {
    const subscriptionEnd = new Date(Date.now() + 60_000)
    const collectionRepo = {
      getUserSubscribeCollection: vi.fn().mockResolvedValue({
        owner_id: 42,
        is_deleted: false,
        is_active: true,
        subscription_end_time: subscriptionEnd
      }),
      getUserShareCollectById: vi.fn().mockResolvedValue({ status: 1, owner_id: 42 })
    }
    const firstMark = { content: 'selected text', comment: 'comment', source: 'source' }
    const bookmarkRepo = {
      listUserStarBookmarksWithStatsByTargetUser: vi.fn().mockResolvedValue([
        {
          id: 100,
          title: 'Article',
          host_url: 'https://example.com',
          target_url: 'https://example.com/article',
          content_icon: '',
          content_cover: '',
          status: 'success',
          mark_count: 3,
          first_mark: firstMark
        }
      ])
    }
    Object.assign(bookmarkRepo, {
      getUserBookmarkByUuidWithDetail: vi.fn().mockResolvedValue({ user_id: 42, bookmark_id: 200, is_starred: true, bookmark: { moderation_result: 0 } }),
      getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue(null)
    })
    const service = new CollectionService(collectionRepo as never, { getInfoByUserId: vi.fn().mockResolvedValue({ snapshot_sharing: true }) } as never, bookmarkRepo as never)

    const result = await service.getUserCollectionList(createMockCtx({ userId: 7 }), 1, 20, 9)

    expect(bookmarkRepo.listUserStarBookmarksWithStatsByTargetUser).toHaveBeenCalledWith(42, 0, 20, 7)
    expect(result).toEqual([
      expect.objectContaining({
        id: 'enc_100',
        mark_count: 3,
        first_mark: firstMark
      })
    ])
    expect(result[0]).not.toHaveProperty('show_profile')
    expect(result[0]).not.toHaveProperty('overview')
  })

  test.each(['expired', 'inactive', 'deleted', 'paused', 'owner-mismatch'])('keeps %s collections out of the inbox list fetch', async reason => {
    const subscriptionEnd = new Date(Date.now() + (reason === 'expired' ? -60_000 : 60_000))
    const collectionRepo = {
      getUserSubscribeCollection: vi.fn().mockResolvedValue({
        owner_id: 42,
        is_deleted: reason === 'deleted',
        is_active: reason !== 'inactive',
        subscription_end_time: subscriptionEnd
      }),
      getUserShareCollectById: vi.fn().mockResolvedValue({ status: reason === 'paused' ? 0 : 1, owner_id: reason === 'owner-mismatch' ? 43 : 42 })
    }
    const bookmarkRepo = {
      listUserStarBookmarksWithStatsByTargetUser: vi.fn()
    }
    Object.assign(bookmarkRepo, {
      getUserBookmarkByUuidWithDetail: vi.fn().mockResolvedValue({ user_id: 42, bookmark_id: 200, is_starred: true, bookmark: { moderation_result: 0 } }),
      getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue(null)
    })
    const service = new CollectionService(collectionRepo as never, { getInfoByUserId: vi.fn().mockResolvedValue({ snapshot_sharing: true }) } as never, bookmarkRepo as never)

    await expect(service.getUserCollectionList(createMockCtx({ userId: 7 }), 1, 20, 9)).resolves.toEqual([])
    expect(bookmarkRepo.listUserStarBookmarksWithStatsByTargetUser).not.toHaveBeenCalled()
  })

  test.each([0, 1])('public free detail respects the actual enable status %s', async status => {
    const collectionRepo = {
      getUserShareCollectByCode: vi.fn().mockResolvedValue({ id: 9, owner_id: 42, status, type: 1, amount: 0 }),
      getUserSubscribeCollectionRecord: vi.fn()
    }
    const row = { id: 100, uuid: 'bookmark', user_id: 42, bookmark_id: 200, deleted_at: null, is_starred: true, bookmark: { moderation_result: 0 } }
    const bookmarkRepo = {
      getUserBookmarkByUserBmId: vi.fn().mockResolvedValue(row),
      getUserBookmarkByUuidWithDetail: vi.fn().mockResolvedValue(row),
      getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue(null)
    }
    const service = new CollectionService(collectionRepo as never, { getInfoByUserId: vi.fn().mockResolvedValue({ snapshot_sharing: true }) } as never, bookmarkRepo as never)
    if (status === 1) await expect(service.getCollectionBookmarkInfo('collection-code', 100)).resolves.toMatchObject({ bookmarkInfo: { id: 100 } })
    else await expect(service.getCollectionBookmarkInfo('collection-code', 100)).rejects.toMatchObject({ name: 'SHARE_COLLECTION_CLOSED' })
    expect(collectionRepo.getUserSubscribeCollectionRecord).not.toHaveBeenCalled()
  })
})

describe('Collection detail policy response', () => {
  function wire(policy: {
    showMarks: boolean
    allowMarks: boolean
    allowLine?: boolean
    allowComment?: boolean
    showProfile: boolean
  }) {
    const marks = policy.showMarks
      ? { mark_list: [{ id: 1, content: 'mark' }], user_list: { '42': { id: 42, username: 'Owner', avatar: 'avatar' } } }
      : { mark_list: [], user_list: {} }
    const collectionService = {
      getCollectionBookmarkInfo: vi.fn().mockResolvedValue({
        collectionInfo: { owner_id: 42 },
        bookmarkInfo: {
          id: 100,
          uuid: 'bookmark-uuid',
          user_id: 42,
          bookmark_id: 200,
          alias_title: '',
          type: 0,
          bookmark: {
            id: 200,
            uuid: 'article-uuid',
            title: 'Article',
            host_url: 'https://example.com',
            target_url: 'https://example.com/article',
            content_icon: '',
            content_cover: '',
            status: 'success',
            content_key: 'content-key',
            content_md_key: '',
            private_user: 0
          }
        }
      })
    }
    const bookmarkService = {
      getBookmarkContent: vi.fn().mockResolvedValue('<p>content</p>'),
      getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue({
        is_enable: true,
        show_line: policy.showMarks,
        show_comment: policy.showMarks,
        allow_line: policy.allowLine ?? policy.allowMarks,
        allow_comment: policy.allowComment ?? policy.allowMarks,
        show_userinfo: policy.showProfile
      })
    }
    const markService = { getBookmarkMarkList: vi.fn().mockResolvedValue(marks) }
    const tagService = { getBookmarkTags: vi.fn().mockResolvedValue([]) }
    const userService = {
      getUserBriefInfo: vi.fn().mockResolvedValue(policy.showProfile ? { nick_name: 'Owner', avatar: 'avatar' } : { nick_name: '', avatar: '' })
    }
    const orchestrator = new CollectionOrchestrator(
      collectionService as never,
      bookmarkService as never,
      markService as never,
      tagService as never,
      userService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    )
    return { orchestrator, bookmarkService, markService, userService, marks }
  }

  test('returns article marks and profile without overview when enabled', async () => {
    const { orchestrator, bookmarkService, markService, userService, marks } = wire({ showMarks: true, allowMarks: true, showProfile: true })

    const result = await orchestrator.getCollectionBookmarkDetail(createMockCtx({ userId: 7 }), 'collection-code', 100)

    expect(bookmarkService.getBookmarkShareByBookmarkId).toHaveBeenCalledWith(200, 42)
    expect(markService.getBookmarkMarkList).toHaveBeenCalledWith(expect.anything(), { id: 100, isShowMarks: true })
    expect(userService.getUserBriefInfo).toHaveBeenCalledWith(true, 42)
    expect(result).toMatchObject({
      marks,
      collection_info: { allow_action: true, allow_line: true, allow_comment: true },
      user_info: { nick_name: 'Owner', avatar: 'avatar', show_userinfo: true }
    })
    expect(result).not.toHaveProperty('overview')
  })

  test('returns hidden marks/profile state without overview', async () => {
    const { orchestrator, markService, userService } = wire({ showMarks: false, allowMarks: false, showProfile: false })

    const result = await orchestrator.getCollectionBookmarkDetail(createMockCtx({ userId: 7 }), 'collection-code', 100)

    expect(markService.getBookmarkMarkList).toHaveBeenCalledWith(expect.anything(), { id: 100, isShowMarks: false })
    expect(userService.getUserBriefInfo).toHaveBeenCalledWith(false, 42)
    expect(result).toMatchObject({
      marks: { mark_list: [], user_list: {} },
      collection_info: { allow_action: false, allow_line: false, allow_comment: false },
      user_info: { nick_name: '', avatar: '', show_userinfo: false }
    })
    expect(result).not.toHaveProperty('overview')
  })

  test('preserves independent line and comment permissions in collection_info', async () => {
    const { orchestrator } = wire({
      showMarks: true,
      allowMarks: false,
      allowLine: true,
      allowComment: false,
      showProfile: true
    })

    const result = await orchestrator.getCollectionBookmarkDetail(createMockCtx({ userId: 7 }), 'collection-code', 100)

    expect(result.collection_info).toMatchObject({
      allow_action: true,
      allow_line: true,
      allow_comment: false
    })
  })
})
