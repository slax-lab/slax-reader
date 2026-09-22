import { describe, expect, test, vi } from 'vitest'

import { MarkService } from '@/domain/mark'
import { markType } from '@/infra/repository/dbMark'
import { createMockCtx } from '@test/helpers/mockFactory'

const userBookmark = {
  id: 5,
  uuid: 'bookmark-uuid',
  user_id: 10,
  bookmark_id: 42,
  deleted_at: null,
  bookmark: { moderation_result: 0 }
}

const openShare = {
  is_enable: true,
  show_line: true,
  show_comment: true,
  allow_line: true,
  allow_comment: true
}


function replyRequest(overrides: Record<string, unknown> = {}) {
  return {
    source: [{ type: 'text', xpath: '/p', start_offet: 0, end_offset: 4 }],
    select_content: [{ type: 'text', text: 'text', src: '' }],
    parent_id: 0,
    parent_uid: 'parent-uuid',
    comment: 'reply',
    bookmark_uid: 'bookmark-uuid',
    type: markType.REPLY,
    approx_source: { exact: 'text', prefix: '', suffix: '', position_start: 0, position_end: 4 },
    ...overrides
  }
}

function wireMarkService() {
  const bookmarkRepo = {
    getUserBookmarkByUuidWithDetail: vi.fn().mockResolvedValue(userBookmark),
    getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue(openShare),
    getUserBookmark: vi.fn().mockResolvedValue(userBookmark),
    getUserBookmarkById: vi.fn().mockResolvedValue(null)
  }
  const markRepo = {
    getByUuid: vi.fn().mockResolvedValue({
      id: 7,
      uuid: 'parent-uuid',
      user_id: 10,
      user_bookmark_id: 5,
      type: markType.COMMENT,
      source: [],
      comment: 'parent',
      created_at: new Date(),
      updated_at: new Date(),
      is_deleted: false,
      parent_id: 0,
      root_id: 0
    }),
    create: vi.fn().mockResolvedValue({ id: 8, uuid: 'reply-uuid', root_id: 7, metadata: {} }),
    existsCommentMarkChildByRootUid: vi.fn().mockResolvedValue(0),
    updateCommentMarkDeletedByUid: vi.fn().mockResolvedValue(undefined)
  }
  const userRepo = { getInfoByUserId: vi.fn().mockResolvedValue({ snapshot_sharing: true }) }
  const service = new MarkService(bookmarkRepo as never, markRepo as never, {} as never, userRepo as never)
  return { service, bookmarkRepo, markRepo, userRepo }
}

describe('visitor reply-only create', () => {
  test('writes a reply into the creator user bookmark and strips selection payload', async () => {
    const { service, bookmarkRepo, markRepo } = wireMarkService()
    const data = replyRequest()

    const result = await service.createMark(createMockCtx({ userId: 20 }), data as never)

    expect(bookmarkRepo.getUserBookmark).toHaveBeenCalledWith(42, 10)
    expect(markRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_bookmark_id: 5,
        user_bookmark_uuid: 'bookmark-uuid',
        user_id: 20,
        type: markType.REPLY,
        parent_id: 7,
        root_id: 7,
        source: [],
        content: [],
        approx_source: undefined
      })
    )
    expect(result.replyComment?.id).toBe(7)
  })

  test.each([markType.COMMENT, markType.LINE, markType.ORIGIN_COMMENT, markType.ORIGIN_LINE])('rejects visitor mark type %s even when traces are visible', async type => {
    const { service, markRepo } = wireMarkService()
    await expect(service.createMark(createMockCtx({ userId: 20 }), replyRequest({ type }) as never)).rejects.toMatchObject({ name: 'SHARE_ACTION_NOT_ALLOWED' })
    expect(markRepo.create).not.toHaveBeenCalled()
  })

  test('does not narrow owner reply behavior', async () => {
    const { service, markRepo } = wireMarkService()
    markRepo.getByUuid.mockResolvedValue({
      id: 7,
      uuid: 'parent-uuid',
      user_id: 10,
      user_bookmark_id: 5,
      type: markType.LINE,
      source: [],
      comment: '',
      created_at: new Date(),
      updated_at: new Date(),
      is_deleted: false,
      parent_id: 0,
      root_id: 7
    })

    await expect(service.createMark(createMockCtx({ userId: 10 }), replyRequest() as never)).resolves.toBeTruthy()
    expect(markRepo.create).toHaveBeenCalledOnce()
  })

  test('rejects replies when the creator hides traces', async () => {
    const { service, bookmarkRepo, markRepo } = wireMarkService()
    bookmarkRepo.getBookmarkShareByBookmarkId.mockResolvedValue({ ...openShare, show_comment: false, allow_comment: false })
    await expect(service.createMark(createMockCtx({ userId: 20 }), replyRequest() as never)).rejects.toBeTruthy()
    expect(markRepo.create).not.toHaveBeenCalled()
  })

  test('allows replies through the existing global snapshot setting when there is no explicit share', async () => {
    const { service, bookmarkRepo, markRepo, userRepo } = wireMarkService()
    bookmarkRepo.getBookmarkShareByBookmarkId.mockResolvedValue(null)
    userRepo.getInfoByUserId.mockResolvedValue({ snapshot_sharing: true })

    await expect(service.createMark(createMockCtx({ userId: 20 }), replyRequest() as never)).resolves.toBeTruthy()
    expect(markRepo.create).toHaveBeenCalledOnce()
  })

  test('rejects replies when the creator global snapshot sharing is disabled', async () => {
    const { service, bookmarkRepo, markRepo, userRepo } = wireMarkService()
    bookmarkRepo.getBookmarkShareByBookmarkId.mockResolvedValue(null)
    userRepo.getInfoByUserId.mockResolvedValue({ snapshot_sharing: false })

    await expect(service.createMark(createMockCtx({ userId: 20 }), replyRequest() as never)).rejects.toBeTruthy()
    expect(markRepo.create).not.toHaveBeenCalled()
  })

  test('rejects replying to a line', async () => {
    const { service, markRepo } = wireMarkService()
    markRepo.getByUuid.mockResolvedValue({
      id: 7,
      user_bookmark_id: 5,
      type: markType.LINE,
      is_deleted: false
    })
    await expect(service.createMark(createMockCtx({ userId: 20 }), replyRequest() as never)).rejects.toBeTruthy()
    expect(markRepo.create).not.toHaveBeenCalled()
  })

  test('applies the 1500 character limit to replies', async () => {
    const { service, markRepo } = wireMarkService()
    await expect(service.createMark(createMockCtx({ userId: 20 }), replyRequest({ comment: 'x'.repeat(1501) }) as never)).rejects.toBeTruthy()
    expect(markRepo.create).not.toHaveBeenCalled()
  })
})

describe('visitor reply deletion', () => {
  test('allows the reply author to delete their own reply', async () => {
    const { service, markRepo } = wireMarkService()
    markRepo.getByUuid.mockResolvedValue({
      id: 8,
      uuid: 'reply-uuid',
      user_id: 20,
      user_bookmark_id: 5,
      type: markType.REPLY,
      is_deleted: false,
      root_uid: 'root-uuid'
    })
    markRepo.existsCommentMarkChildByRootUid.mockResolvedValue(2)

    await expect(service.deleteMark(createMockCtx({ userId: 20 }), { uuid: 'reply-uuid' })).resolves.toBe('ok')
    expect(markRepo.updateCommentMarkDeletedByUid).toHaveBeenCalledWith('reply-uuid')
  })

  test('rejects deleting another user\'s reply', async () => {
    const { service, markRepo } = wireMarkService()
    markRepo.getByUuid.mockResolvedValue({
      id: 8,
      uuid: 'reply-uuid',
      user_id: 30,
      user_bookmark_id: 5,
      type: markType.REPLY,
      is_deleted: false,
      root_uid: 'root-uuid'
    })

    await expect(service.deleteMark(createMockCtx({ userId: 20 }), { uuid: 'reply-uuid' })).rejects.toMatchObject({ name: 'SHARE_ACTION_NOT_ALLOWED' })
  })
})
