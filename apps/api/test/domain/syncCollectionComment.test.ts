import { describe, expect, test, vi } from 'vitest'
import { MarkService } from '@/domain/mark'
import { SyncOrchestrator } from '@/domain/orchestrator/sync'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'
import { markType } from '@/infra/repository/dbMark'
import type { ContextManager } from '@/utils/context'
import type { OrderedSyncOperation, SyncChangeItem } from '@/domain/orchestrator/sync'
import { resolveCollectionPolicy } from '@/utils/collectionPolicy'

function commentChange(metadata: Record<string, unknown>): SyncChangeItem {
  return {
    table: 'sr_bookmark_comment',
    id: 'comment-uuid',
    op: 'PUT',
    data: {
      user_bookmark_uuid: 'bookmark-uuid',
      type: markType.LINE.toString(),
      source: '[]',
      comment: '',
      approx_source: '',
      content: '[]',
      metadata: JSON.stringify(metadata)
    }
  }
}

function context(userId = 7): ContextManager {
  return {
    getUserId: () => userId,
    hashIds: { decodeId: () => 100 }
  } as unknown as ContextManager
}

function collectionOperation(): OrderedSyncOperation {
  const operations: OrderedSyncOperation[] = []
  const orchestrator = Object.create(SyncOrchestrator.prototype) as SyncOrchestrator
  orchestrator.processUserBookmarkCommentChange(commentChange({ source_type: 'collection', source_id: 'bookmark-uuid' }), 7, operations)
  return operations[0]
}

describe('Collection comment source', () => {
  test('passes the local Collection source through to persistence', () => {
    expect(collectionOperation()).toMatchObject({
      type: 'create_comment',
      userId: 7,
      data: {
        sourceType: 'collection',
        sourceId: 'bookmark-uuid'
      }
    })
  })
})

describe('Collection mark validation', () => {
  function markService(allowMarks: boolean, share: Record<string, unknown> | null = {
    is_enable: true,
    show_line: true,
    show_comment: true,
    allow_line: allowMarks,
    allow_comment: allowMarks,
    show_userinfo: true
  }) {
    const bookmark = { id: 100, uuid: 'bookmark-uuid', user_id: 42, bookmark_id: 200, deleted_at: null, is_starred: true, bookmark: { moderation_result: 0 } }
    const bookmarkRepo = {
      getUserBookmarkByUuidWithDetail: vi.fn().mockResolvedValue(bookmark),
      getUserBookmarkById: vi.fn().mockResolvedValue(bookmark),
      getUserBookmark: vi.fn().mockResolvedValue(bookmark),
      getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue(share)
    }
    const collectionRepo = {
      getUserShareCollectByCode: vi.fn().mockResolvedValue({ id: 21, owner_id: 42, status: 1, collection_code: 'collection-code' }),
      getUserSubscribeCollectionRecord: vi.fn()
    }
    const service = new MarkService(bookmarkRepo as never, {} as never, collectionRepo as never, { getInfoByUserId: vi.fn().mockResolvedValue({ snapshot_sharing: true }) } as never)
    return { service, bookmarkRepo, collectionRepo }
  }

  const request = {
    type: markType.LINE,
    source: [],
    select_content: [],
    parent_id: 0,
    collection_code: 'collection-code',
    cb_id: 100
  }

  test('reads the article policy once', async () => {
    const { service, bookmarkRepo, collectionRepo } = markService(true)
    await service.assertCreateMarkSource(context(), request)

    expect(bookmarkRepo.getBookmarkShareByBookmarkId).toHaveBeenCalledOnce()
    expect(bookmarkRepo.getBookmarkShareByBookmarkId).toHaveBeenCalledWith(200, 42)
    expect(collectionRepo.getUserSubscribeCollectionRecord).not.toHaveBeenCalled()
  })

  test('rejects only the article whose policy disables marks', async () => {
    const { service } = markService(false)
    await expect(service.assertCreateMarkSource(context(), request)).rejects.toMatchObject({
      errCode: 400,
      name: 'SHARE_COLLECTION_NOT_ALLOWED'
    })
  })

  test('checks line and comment permissions independently, with replies following comments', async () => {
    const lineOnly = {
      is_enable: true,
      show_line: true,
      show_comment: true,
      allow_line: true,
      allow_comment: false,
      show_userinfo: true
    }
    const commentOnly = { ...lineOnly, allow_line: false, allow_comment: true }

    const { service: lineService } = markService(true, lineOnly)
    await expect(lineService.assertCreateMarkSource(context(), request)).resolves.toBeDefined()
    await expect(lineService.assertCreateMarkSource(context(), { ...request, type: markType.COMMENT })).rejects.toMatchObject({
      name: 'SHARE_COLLECTION_NOT_ALLOWED'
    })
    await expect(lineService.assertCreateMarkSource(context(), { ...request, type: markType.REPLY })).rejects.toMatchObject({
      name: 'SHARE_COLLECTION_NOT_ALLOWED'
    })

    const { service: commentService } = markService(true, commentOnly)
    await expect(commentService.assertCreateMarkSource(context(), request)).rejects.toMatchObject({
      name: 'SHARE_COLLECTION_NOT_ALLOWED'
    })
    await expect(commentService.assertCreateMarkSource(context(), { ...request, type: markType.COMMENT })).resolves.toBeDefined()
    await expect(commentService.assertCreateMarkSource(context(), { ...request, type: markType.REPLY })).resolves.toBeDefined()
  })

  test('rejects visitor marks when the article has no policy and global defaults are read-only', async () => {
    const { service } = markService(true, null)
    await expect(service.assertCreateMarkSource(context(), request)).rejects.toMatchObject({
      name: 'SHARE_COLLECTION_NOT_ALLOWED'
    })
  })

  test('allows the collection owner without a subscription row', async () => {
    const { service } = markService(true, null)
    await expect(service.assertCreateMarkSource(context(42), request)).resolves.toBeDefined()
  })
})

describe('Collection comment persistence', () => {
  function persistenceTx() {
    return {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 100, user_id: 42, bookmark_id: 200, collection_code: 'collection-code' }]),
      sr_bookmark_comment: {
        findUnique: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 300 }),
        update: vi.fn()
      }
    }
  }

  test('uses the authoritative article share policy', async () => {
    const repository = new DBSyncBatchOperation((() => undefined) as never)
    const tx = persistenceTx()

    await repository.executeCreateComment(tx as never, collectionOperation())

    expect((tx as any).$queryRaw).toHaveBeenCalledOnce()
    expect((tx as any).sr_bookmark_comment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 7,
        bookmark_id: 100,
        source_type: 'collection',
        source_id: 'collection-code/100'
      })
    })
  })

  test('uses allow_line for highlights and allow_comment for comments and replies', async () => {
    const repository = new DBSyncBatchOperation((() => undefined) as never)
    const execute = async (type: markType) => {
      const tx = persistenceTx()
      const operation = collectionOperation()
      Object.assign(operation.data, {
        type,
        comment: type === markType.LINE ? '' : 'comment',
        parentUuid: type === markType.REPLY ? 'parent' : undefined
      })
      tx.sr_bookmark_comment.findUnique.mockResolvedValue({ id: 10, bookmark_id: 100, root_id: 10, is_deleted: false })
      await repository.executeCreateComment(tx as never, operation)
      return (tx.$queryRaw.mock.calls[0][0] as { sql: string }).sql
    }

    expect(await execute(markType.LINE)).toContain('share.allow_line')
    expect(await execute(markType.COMMENT)).toContain('share.allow_comment')
    expect(await execute(markType.REPLY)).toContain('share.allow_comment')
  })

  test('rejects a Collection comment when the target article disables marks', async () => {
    const repository = new DBSyncBatchOperation((() => undefined) as never)
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      sr_bookmark_comment: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn()
      }
    } as never

    await expect(repository.executeCreateComment(tx, collectionOperation())).rejects.toMatchObject({
      errCode: 400,
      name: 'SHARE_ACTION_NOT_ALLOWED'
    })
    expect((tx as any).sr_bookmark_comment.create).not.toHaveBeenCalled()
  })
})

describe('Local-first mark deletion persistence', () => {
  const repository = new DBSyncBatchOperation((() => undefined) as never)
  const operation: OrderedSyncOperation = {
    type: 'delete_comment',
    commentUuid: 'comment-uuid',
    userId: 7,
    data: { isDeleted: true }
  }

  function deletionTx(record: { id: number; type: markType; root_id: number; is_deleted?: boolean }) {
    return {
      sr_user_bookmark: { findFirst: vi.fn() },
      sr_bookmark_comment: {
        findUnique: vi.fn().mockResolvedValue({
          uuid: operation.commentUuid,
          user_id: operation.userId,
          bookmark_id: 100,
          is_deleted: false,
          ...record
        }),
        findFirst: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn()
      }
    }
  }

  test('hard-deletes a highlight', async () => {
    const tx = deletionTx({ id: 10, type: markType.LINE, root_id: 0 })

    await repository.executeDeleteComment(tx as never, operation)

    expect(tx.sr_bookmark_comment.deleteMany).toHaveBeenCalledWith({ where: { uuid: operation.commentUuid } })
    expect(tx.sr_bookmark_comment.findFirst).not.toHaveBeenCalled()
  })

  test('keeps a deleted comment as a tombstone while the thread has a live reply', async () => {
    const tx = deletionTx({ id: 10, type: markType.COMMENT, root_id: 10 })
    tx.sr_bookmark_comment.findFirst.mockResolvedValue({ id: 11 })

    await repository.executeDeleteComment(tx as never, operation)

    expect(tx.sr_bookmark_comment.findFirst).toHaveBeenCalledWith({
      where: {
        bookmark_id: 100,
        root_id: 10,
        is_deleted: false,
        uuid: { not: operation.commentUuid }
      },
      select: { id: true }
    })
    expect(tx.sr_bookmark_comment.update).toHaveBeenCalledWith({
      where: { uuid: operation.commentUuid },
      data: { is_deleted: true, updated_at: expect.any(Date) }
    })
    expect(tx.sr_bookmark_comment.deleteMany).not.toHaveBeenCalled()
  })

  test('hard-deletes the thread when its last live comment is deleted', async () => {
    const tx = deletionTx({ id: 11, type: markType.REPLY, root_id: 10 })
    tx.sr_bookmark_comment.findFirst.mockResolvedValue(null)

    await repository.executeDeleteComment(tx as never, operation)

    expect(tx.sr_bookmark_comment.deleteMany).toHaveBeenCalledWith({
      where: { bookmark_id: 100, root_id: 10 }
    })
    expect(tx.sr_bookmark_comment.update).not.toHaveBeenCalled()
  })

  test('does not remove a live reply when a soft-delete operation is replayed', async () => {
    const tx = deletionTx({ id: 10, type: markType.COMMENT, root_id: 10, is_deleted: true })
    tx.sr_bookmark_comment.findFirst.mockResolvedValue({ id: 11 })

    await repository.executeDeleteComment(tx as never, operation)

    expect(tx.sr_bookmark_comment.update).toHaveBeenCalledOnce()
    expect(tx.sr_bookmark_comment.deleteMany).not.toHaveBeenCalled()
  })
})

// 这些上限原先被 catch 里的 error.message.includes('MarkLine') 吞掉而完全不生效：
// MultiLangError 的 message 是英文文案 'Mark line too long'，错误名在 .name 上，两个匹配都命中不了。
describe('Collection mark length limits', () => {
  function operationWithSource(source: string): OrderedSyncOperation {
    const operation = collectionOperation()
    ;(operation.data as { source: string }).source = source
    return operation
  }

  function tx() {
    return {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 100, user_id: 42, bookmark_id: 200, collection_code: 'collection-code' }]),
      sr_bookmark_comment: {
        findUnique: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 300 }),
        update: vi.fn()
      }
    }
  }

  test('rejects a highlight longer than 1000 characters before touching the database', async () => {
    const repository = new DBSyncBatchOperation((() => undefined) as never)
    const target = tx()

    await expect(repository.executeCreateComment(target as never, operationWithSource(JSON.stringify([{ type: 'text', start: 0, end: 1001 }])))).rejects.toMatchObject({
      errCode: 400,
      name: 'MARK_LINE_TOO_LONG'
    })
    // 校验必须早于任何 DB 访问
    expect(target.$queryRaw).not.toHaveBeenCalled()
    expect(target.sr_bookmark_comment.create).not.toHaveBeenCalled()
  })

  test('rejects more than 3 images', async () => {
    const repository = new DBSyncBatchOperation((() => undefined) as never)
    const target = tx()
    const images = JSON.stringify(Array.from({ length: 4 }, () => ({ type: 'image', start: 0, end: 0 })))

    await expect(repository.executeCreateComment(target as never, operationWithSource(images))).rejects.toMatchObject({
      errCode: 400,
      name: 'MARK_LINE_TOO_LONG'
    })
    expect(target.sr_bookmark_comment.create).not.toHaveBeenCalled()
  })

  test('accepts a highlight at the limit, and ignores images when measuring length', async () => {
    const repository = new DBSyncBatchOperation((() => undefined) as never)
    const target = tx()
    const source = JSON.stringify([
      { type: 'text', start: 0, end: 1000 },
      { type: 'image', start: 0, end: 9999 }
    ])

    await repository.executeCreateComment(target as never, operationWithSource(source))

    expect(target.sr_bookmark_comment.create).toHaveBeenCalledOnce()
  })

  test('skips the length check when source is not valid JSON instead of failing the sync', async () => {
    const repository = new DBSyncBatchOperation((() => undefined) as never)
    const target = tx()

    await repository.executeCreateComment(target as never, operationWithSource('not-json'))

    expect(target.sr_bookmark_comment.create).toHaveBeenCalledOnce()
  })
})

describe('Collection mark user policy', () => {
  test('uses the global snapshot default when share is missing instead of checking subscription', async () => {
    const bookmarkRepo = {
      getUserBookmarkByUuidWithDetail: vi.fn().mockResolvedValue({ user_id: 42, bookmark_id: 200, bookmark: { moderation_result: 0 } }),
      getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue(null)
    }
    const markRepo = {
      getDistinctUserIdsByUserBookmarkUuid: vi.fn().mockResolvedValue([42, 7])
    }
    const userRepo = {
      getInfoByUserId: vi.fn().mockResolvedValue({ snapshot_sharing: true }),
      getUserInfoList: vi.fn().mockResolvedValue([
        { uuid: 'owner-uuid', name: 'Owner', picture: 'owner-avatar' },
        { uuid: 'user-uuid', name: 'User', picture: 'user-avatar' }
      ])
    }
    const collectionRepo = {
      getUserShareCollect: vi.fn(),
      getUserSubscribeCollectionRecord: vi.fn()
    }
    const service = new MarkService(bookmarkRepo as never, markRepo as never, collectionRepo as never, userRepo as never)

    await expect(service.getMarkUsersByUserBookmarkUuid(context(), 'bookmark-uuid')).resolves.toEqual([
      { uuid: 'owner-uuid', nick_name: 'Owner', avatar: 'owner-avatar' },
      { uuid: 'user-uuid', nick_name: 'User', avatar: 'user-avatar' }
    ])
    expect(collectionRepo.getUserShareCollect).not.toHaveBeenCalled()
    expect(collectionRepo.getUserSubscribeCollectionRecord).not.toHaveBeenCalled()
  })
})

describe('article policy sync', () => {
  test('maps article share fields to the Collection policy snapshot', () => {
    expect(resolveCollectionPolicy(null)).toEqual({
      showMarks: true,
      allowMarks: false,
      allowLine: false,
      allowComment: false,
      showProfile: true
    })
    expect(
      resolveCollectionPolicy({
        is_enable: true,
        show_line: true,
        show_comment: false,
        allow_line: true,
        allow_comment: true,
        show_userinfo: false
      })
    ).toEqual({
      showMarks: false,
      allowMarks: true,
      allowLine: true,
      allowComment: true,
      showProfile: false
    })
  })

  test('accepts both legacy booleans and object share payloads', () => {
    const orchestrator = Object.create(SyncOrchestrator.prototype) as SyncOrchestrator
    const process = (value: string) => {
      const operations: OrderedSyncOperation[] = []
      orchestrator.processShareChange(
        {
          table: 'sr_user_bookmark',
          id: 'bookmark-uuid',
          op: 'PATCH',
          data: { 'metadata.share.is_enable': value }
        },
        42,
        operations
      )
      return operations
    }

    expect(process('false')).toEqual([
      {
        type: 'update_share',
        bookmarkUuid: 'bookmark-uuid',
        userId: 42,
        data: { isEnable: false }
      }
    ])
    expect(process('{"is_enable":true}')).toEqual([
      {
        type: 'update_share',
        bookmarkUuid: 'bookmark-uuid',
        userId: 42,
        data: { isEnable: true }
      }
    ])
    expect(process('{"is_enable":"false"}')).toEqual([])
  })

  test('ignores unsupported share field changes instead of failing sync', () => {
    const orchestrator = Object.create(SyncOrchestrator.prototype) as SyncOrchestrator
    const operations: OrderedSyncOperation[] = []

    expect(() =>
      orchestrator.processShareChange(
        {
          table: 'sr_user_bookmark',
          id: 'bookmark-uuid',
          op: 'PATCH',
          data: { 'metadata.share.show_line': 'false' }
        },
        42,
        operations
      )
    ).not.toThrow()
    expect(operations).toEqual([])
  })

  test('upserts a disabled share row when local-first closes sharing', async () => {
    const repository = new DBSyncBatchOperation((() => undefined) as never)
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) } as never

    await repository.executeUpdateShare(tx, {
      type: 'update_share',
      bookmarkUuid: 'bookmark-uuid',
      userId: 42,
      data: { isEnable: false }
    })

    expect((tx as any).$executeRaw).toHaveBeenCalledOnce()
    const [strings, ...params] = (tx as any).$executeRaw.mock.calls[0]
    expect(strings.join(' ')).toContain('INSERT INTO sr_bookmark_share')
    expect(strings.join(' ')).toContain('ON CONFLICT (bookmark_id, user_id)')
    expect(params).toEqual([42, 'bookmark-uuid', 42])
  })
})
