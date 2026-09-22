import { describe, expect, test, vi } from 'vitest'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'
import { markType } from '@/infra/repository/dbMark'

function wire() {
  const bookmark = { id: 5, user_id: 10, bookmark_id: 42, deleted_at: null, bookmark: { moderation_result: 0 } }
  const parent = { id: 7, bookmark_id: 5, type: markType.COMMENT, is_deleted: false, root_id: 0 }
  const share = { is_enable: true, allow_line: true, allow_comment: true }
  const tx = {
    sr_user_bookmark: { findUnique: vi.fn().mockResolvedValue(bookmark) },
    sr_bookmark_share: { findFirst: vi.fn().mockResolvedValue(share) },
    sr_user: { findUnique: vi.fn().mockResolvedValue({ snapshot_sharing: true, deleted_at: null }) },
    sr_bookmark_comment: { findUnique: vi.fn().mockResolvedValue(parent), create: vi.fn().mockResolvedValue({ id: 8 }), update: vi.fn() }
  }
  const operation = { type: 'create_comment', userId: 20, commentUuid: 'reply', data: { userBookmarkUuid: 'bookmark', type: markType.REPLY, comment: 'reply', parentUuid: 'parent', rootUuid: 'forged-root', source: '[]', content: '[]', approxSource: 'selection', sourceType: 'bookmark' } }
  const repository = new DBSyncBatchOperation((() => undefined) as never)
  const execute = () => repository.executeCreateComment(tx as never, operation as never)
  return { tx, operation, execute, bookmark, parent, share }
}

describe('sync bookmark comments enforce snapshot reply-only permissions', () => {
  test.each([null, new Date()])('denies a missing/deleted owner even when an enabled share remains', async deletedAt => {
    const { execute, tx } = wire()
    tx.sr_user.findUnique.mockResolvedValue(deletedAt ? { snapshot_sharing: true, deleted_at: deletedAt } : null)
    await expect(execute()).rejects.toMatchObject({ name: 'SHARE_ACTION_NOT_ALLOWED' })
    expect(tx.sr_bookmark_share.findFirst).not.toHaveBeenCalled()
    expect(tx.sr_bookmark_comment.create).not.toHaveBeenCalled()
  })

  test.each([markType.LINE, markType.COMMENT, markType.ORIGIN_LINE, markType.ORIGIN_COMMENT])('rejects visitor type %s', async type => {
    const { operation, execute, tx } = wire()
    operation.data.type = type
    if (type === markType.LINE) operation.data.comment = ''
    await expect(execute()).rejects.toBeTruthy()
    expect(tx.sr_bookmark_comment.create).not.toHaveBeenCalled()
  })

  test.each(['disabled', 'no-comment', 'no-line', 'global-off', 'deleted', 'moderated', 'missing-parent', 'parent-deleted', 'foreign-parent', 'line-parent'])('rejects %s before writing', async reason => {
    const { execute, tx, operation, bookmark, share, parent } = wire()
    if (reason === 'disabled') tx.sr_bookmark_share.findFirst.mockResolvedValue({ ...share, is_enable: false })
    if (reason === 'no-comment') tx.sr_bookmark_share.findFirst.mockResolvedValue({ ...share, allow_comment: false })
    if (reason === 'no-line') tx.sr_bookmark_share.findFirst.mockResolvedValue({ ...share, allow_line: false })
    if (reason === 'global-off') {
      tx.sr_bookmark_share.findFirst.mockResolvedValue(null)
      tx.sr_user.findUnique.mockResolvedValue({ snapshot_sharing: false, deleted_at: null })
    }
    if (reason === 'deleted') tx.sr_user_bookmark.findUnique.mockResolvedValue({ ...bookmark, deleted_at: new Date() })
    if (reason === 'moderated') tx.sr_user_bookmark.findUnique.mockResolvedValue({ ...bookmark, bookmark: { moderation_result: 1 } })
    if (reason === 'missing-parent') operation.data.parentUuid = ''
    if (reason === 'parent-deleted') tx.sr_bookmark_comment.findUnique.mockResolvedValue({ ...parent, is_deleted: true })
    if (reason === 'foreign-parent') tx.sr_bookmark_comment.findUnique.mockResolvedValue({ ...parent, bookmark_id: 99 })
    if (reason === 'line-parent') tx.sr_bookmark_comment.findUnique.mockResolvedValue({ ...parent, type: markType.LINE })
    await expect(execute()).rejects.toMatchObject({ name: 'SHARE_ACTION_NOT_ALLOWED' })
    expect(tx.sr_bookmark_comment.create).not.toHaveBeenCalled()
  })

  test.each([true, false])('accepts a valid reply, explicit share=%s, deriving the root from the parent', async explicit => {
    const { execute, tx } = wire()
    if (!explicit) tx.sr_bookmark_share.findFirst.mockResolvedValue(null)
    await execute()
    expect(tx.sr_bookmark_comment.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { uuid: 'parent' } })
    expect(tx.sr_bookmark_comment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ user_id: 20, bookmark_id: 5, type: markType.REPLY, parent_id: 7, root_id: 7, source: '[]', content: '[]', approx_source: '' }) })
  })

  test('owner can still add a highlight while sharing is disabled', async () => {
    const { execute, tx, operation } = wire()
    operation.userId = 10
    operation.data.type = markType.LINE
    operation.data.comment = ''
    operation.data.rootUuid = ''
    tx.sr_bookmark_share.findFirst.mockResolvedValue({ is_enable: false, allow_comment: false, allow_line: false })
    await execute()
    expect(tx.sr_bookmark_comment.create).toHaveBeenCalledOnce()
    expect(tx.sr_bookmark_share.findFirst).not.toHaveBeenCalled()
  })
})
