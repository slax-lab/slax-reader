import { describe, expect, test, vi } from 'vitest'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'

const request = { bookmarkId: 42, bookmarkUid: 'target-uuid', importId: 90, operationKey: 'import:90:5', savedAt: new Date('2020-01-02T03:04:05Z'), isArchive: true, isStarred: true, tags: ['topic', 'topic'] }

function setup() {
  const operation = { target_bookmark_id: 42, target_uuid: 'target-uuid', write_version: 7, write_mode: 'created', result: { bookmark_uid: 'target-uuid' } }
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 42, write_version: 7, published_version: 7 }]),
    sr_bookmark_fork_operation: { findUnique: vi.fn().mockResolvedValue(operation) },
    sr_bookmark_save_receipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    sr_user_bookmark: { update: vi.fn().mockResolvedValue({}) },
    sr_bookmark_import_relation: { create: vi.fn().mockResolvedValue({}) },
    sr_user_tag: { upsert: vi.fn().mockResolvedValue({ id: 8, tag_name: 'topic' }) },
    sr_user_bookmark_tag: { upsert: vi.fn().mockResolvedValue({}) }
  }
  const prisma = { $transaction: vi.fn(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx)) }
  const repo = Object.assign(Object.create(BookmarkRepo.prototype), { prismaPg: () => prisma }) as BookmarkRepo
  return { repo, tx, operation, prisma }
}

describe('Fork import metadata receipt', () => {
  test('commits destination metadata, imported user tags, success relation, and receipt in one transaction', async () => {
    const s = setup()
    expect(await s.repo.applyForkImportMetadata(1, request)).toBe(true)
    expect(s.prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(s.tx.sr_user_bookmark.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ created_at: request.savedAt, archive_status: 1, is_starred: true }) }))
    expect(s.tx.sr_user_tag.upsert).toHaveBeenCalledTimes(1)
    expect(s.tx.sr_user_tag.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ user_id: 1, source: 'auto' }) }))
    expect(s.tx.sr_user_bookmark_tag.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ bookmark_id: 42, user_id: 1, source: 'user' }) }))
    expect(s.tx.sr_bookmark_import_relation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ user_id: 1, bookmark_id: 42, import_id: 90, status: 1 }) })
    expect(s.tx.sr_bookmark_save_receipt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ user_id: 1, operation_key: 'import-meta:import:90:5', target_bookmark_id: 42, target_uuid: 'target-uuid', write_version: 7 }) })
  })

  test('does not replay metadata or duplicate the relation after a completed receipt', async () => {
    const s = setup()
    s.tx.sr_bookmark_save_receipt.findUnique.mockResolvedValue({ target_bookmark_id: 42, target_uuid: 'target-uuid' } as never)
    expect(await s.repo.applyForkImportMetadata(1, request)).toBe(false)
    expect(s.tx.sr_user_bookmark.update).not.toHaveBeenCalled()
    expect(s.tx.sr_user_tag.upsert).not.toHaveBeenCalled()
    expect(s.tx.sr_bookmark_import_relation.create).not.toHaveBeenCalled()
  })

  test('preserves the existing destination save time and user state on overwrite', async () => {
    const s = setup()
    s.operation.write_mode = 'overwritten'
    expect(await s.repo.applyForkImportMetadata(1, request)).toBe(true)
    expect(s.tx.sr_user_bookmark.update).not.toHaveBeenCalled()
    expect(s.tx.sr_user_tag.upsert).toHaveBeenCalledTimes(1)
  })

  test('settles a superseded copy without applying old import metadata to the newer write', async () => {
    const s = setup()
    s.tx.$queryRaw.mockResolvedValue([{ id: 42, write_version: 8, published_version: 8 }])
    expect(await s.repo.applyForkImportMetadata(1, request)).toBe(true)
    expect(s.tx.sr_user_bookmark.update).not.toHaveBeenCalled()
    expect(s.tx.sr_user_tag.upsert).not.toHaveBeenCalled()
    expect(s.tx.sr_bookmark_import_relation.create).toHaveBeenCalled()
  })

  test('does not write a receipt when an import relation write fails', async () => {
    const s = setup()
    s.tx.sr_bookmark_import_relation.create.mockRejectedValue(new Error('database unavailable'))
    await expect(s.repo.applyForkImportMetadata(1, request)).rejects.toThrow('database unavailable')
    expect(s.tx.sr_bookmark_save_receipt.create).not.toHaveBeenCalled()
  })
})
