import { describe, expect, it, vi } from 'vitest'
import { MarkService } from '@/domain/mark'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'
import { markType } from '@/infra/repository/dbMark'
import { createMockCtx } from '../helpers/mockFactory'

const identity = 'a'.repeat(64)
const source = [{ type: 'pdf', version: 1, page: 2, document_id: identity, text: 'PDF quote', quads: [[1, 9, 8, 9, 8, 1, 1, 1]] }]
const bookmark = { id: 5, uuid: 'pdf', user_id: 1, bookmark_id: 10, metadata: { pdf_document_id: identity }, bookmark: { content_key: 'pdf/body/pdf.pdf', moderation_result: 0 } }

describe('PDF mark REST identity validation', () => {
  function wire() {
    const create = vi.fn().mockResolvedValue({ id: 8, uuid: 'comment', metadata: {} })
    const service = Object.assign(new MarkService({} as never, {} as never, {} as never, {} as never), {
      assertCreateMarkSource: vi.fn().mockResolvedValue(bookmark),
      bookmarkRepo: { getUserBookmarkByUuidWithDetail: vi.fn().mockResolvedValue(bookmark) },
      markDataRepo: { create, updateCommentRootId: vi.fn() }
    }) as MarkService
    return { service, create }
  }
  it('preserves PDF quads and thread identity in the existing comment record', async () => {
    const { service, create } = wire()
    const result = await service.createMark(createMockCtx({ userId: 1 }), { type: markType.COMMENT, source, comment: 'comment', select_content: [], parent_id: 0 } as never)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ source, user_bookmark_uuid: 'pdf' }))
    expect(result.response.uuid).toBe('comment')
  })
  it('saves a PDF selection exceeding the former character, page and quad limits through REST', async () => {
    const { service, create } = wire()
    const large = Array.from({ length: 21 }, (_, index) => ({ ...source[0], page: index + 1, text: 'x'.repeat(1001), quads: Array.from({ length: 1001 }, () => source[0]!.quads[0]) }))
    await service.assertMarkData({ type: markType.COMMENT, source: large, comment: 'comment' } as never)
    await service.createMark(createMockCtx({ userId: 1 }), { type: markType.COMMENT, source: large, comment: 'comment', select_content: [] } as never)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ source: large }))
  })
  it.each([{ document_id: 'b'.repeat(64) }, { page: 0 }, { version: 2 }, { quads: [[Infinity, 0, 0, 0, 0, 0, 0, 0]] }])('rejects invalid source %j before persistence', async patch => {
    const { service, create } = wire()
    await expect(service.createMark(createMockCtx(), { type: markType.COMMENT, source: [{ ...source[0], ...patch }], comment: 'comment', select_content: [] } as never)).rejects.toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })
})

describe.each(['bookmark', 'collection'])('PDF %s sync validation', kind => {
  function wire() {
    const tx = {
      sr_user_bookmark: { findUnique: vi.fn().mockResolvedValue(bookmark) },
      $queryRaw: vi.fn().mockResolvedValue([{ ...bookmark, collection_code: 'collection', content_key: bookmark.bookmark.content_key }]),
      sr_bookmark_comment: { create: vi.fn().mockResolvedValue({ id: 8 }), update: vi.fn() }
    }
    const repository = new DBSyncBatchOperation((() => undefined) as never)
    const execute = (value = source) => repository.executeCreateComment(tx as never, {
      type: 'create_comment', userId: 1, commentUuid: 'comment', data: { sourceType: kind, sourceId: 'pdf', userBookmarkUuid: 'pdf', type: markType.COMMENT, comment: 'comment', source: JSON.stringify(value), content: '[]' }
    } as never)
    return { tx, execute }
  }
  it('preserves geometry and comment UUID through the sync write', async () => {
    const { tx, execute } = wire()
    await execute()
    expect(tx.sr_bookmark_comment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ uuid: 'comment', source: JSON.stringify(source) }) }))
  })
  it('syncs a PDF selection exceeding the former character, page and quad limits', async () => {
    const { tx, execute } = wire()
    const large = Array.from({ length: 21 }, (_, index) => ({ ...source[0], page: index + 1, text: 'x'.repeat(1001), quads: Array.from({ length: 1001 }, () => source[0]!.quads[0]) }))
    await execute(large as never)
    expect(tx.sr_bookmark_comment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ source: JSON.stringify(large) }) }))
  })
  it.each([{ document_id: 'b'.repeat(64) }, { quads: [[null, 0, 0, 0, 0, 0, 0, 0]] }])('rejects invalid PDF source %j before persistence', async patch => {
    const { tx, execute } = wire()
    await expect(execute([{ ...source[0], ...patch }] as never)).rejects.toBeTruthy()
    expect(tx.sr_bookmark_comment.create).not.toHaveBeenCalled()
  })
})
