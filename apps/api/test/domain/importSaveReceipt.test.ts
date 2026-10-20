import { describe, expect, test, vi } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { createMockCtx } from '@test/helpers/mockFactory'

function state() {
  let bookmark: any = null
  let relation: any = null
  let receipts: any[] = []
  let failReceipt = false
  const now = new Date('2020-01-02T03:04:05Z')
  const db: any = {
    $executeRaw: vi.fn(),
    sr_bookmark: {
      findFirst: async ({ where }: any) => bookmark?.id === where.id && bookmark?.private_user === where.private_user ? { ...bookmark } : null,
      upsert: async ({ create, update }: any) => {
        if (!bookmark) bookmark = { id: 42, write_version: 0, published_version: 0, content_key: '', content_md_key: '', ...create }
        else bookmark = { ...bookmark, ...update, write_version: bookmark.write_version + (update.write_version?.increment ?? 0) }
        return { ...bookmark }
      },
      update: async ({ data }: any) => {
        bookmark = { ...bookmark, ...data, write_version: bookmark.write_version + (data.write_version?.increment ?? 0) }
        return { ...bookmark }
      }
    },
    sr_user_bookmark: {
      findUnique: async () => relation && { ...relation },
      upsert: async ({ create, update }: any) => {
        relation = relation ? { ...relation, ...update } : { id: 9, uuid: 'destination-uuid', deleted_at: null, ...create }
        return { ...relation }
      }
    },
    sr_user_delete_bookmark: { deleteMany: vi.fn() },
    sr_bookmark_save_receipt: {
      findUnique: async ({ where }: any) => receipts.find(row => row.user_id === where.user_id_operation_key.user_id && row.operation_key === where.user_id_operation_key.operation_key) ?? null,
      create: async ({ data }: any) => {
        if (failReceipt) throw new Error('receipt storage failed')
        receipts.push({ ...data })
        return data
      }
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const previous = structuredClone({ bookmark, relation, receipts })
      try { return await fn(db) } catch (error) { bookmark = previous.bookmark; relation = previous.relation; receipts = previous.receipts; throw error }
    }
  }
  const repo = Object.assign(Object.create(BookmarkRepo.prototype), {
    prismaPg: () => db,
    createBookmarkChangeLog: vi.fn(),
    updateBookmarkVersionStatus: vi.fn()
  }) as BookmarkRepo
  const search = { upsertUserBookmark: vi.fn() }
  const notify = { sendBookmarkChange: vi.fn().mockResolvedValue(undefined) }
  const service = Object.assign(Object.create(BookmarkService.prototype), {
    bookmarkRepo: repo,
    bookmarkData: repo,
    bookmarkSearchRepo: search,
    notifyMessage: notify,
    searchService: { clearSearchCache: vi.fn() }
  }) as BookmarkService
  const save = (operationKey: string) => service.createBookmarkBase({
    ctx: createMockCtx(), targetUrl: 'https://example.com/article', hostUrl: 'example.com', title: 'Article', type: 0,
    importMetadata: { savedAt: now, starred: true }, saveOperationKey: operationKey
  } as any)
  return { save, repo, db, search, notify, bookmark: () => bookmark, relation: () => relation, receipts: () => receipts, failReceipt: () => { failReceipt = true } }
}

describe('ordinary import save receipts', () => {
  test('reuses the accepted version when a queue item is replayed', async () => {
    const s = state()
    expect(await s.save('import-save:90:5')).toMatchObject({ id: 42, private_user: 1, write_version: 1 })
    expect(await s.save('import-save:90:5')).toMatchObject({ id: 42, private_user: 1, write_version: 1 })
    expect(s.bookmark().write_version).toBe(1)
    expect(s.receipts()).toHaveLength(1)
    expect(s.notify.sendBookmarkChange).toHaveBeenCalledTimes(1)
    expect(s.relation()).toMatchObject({ is_starred: true, created_at: new Date('2020-01-02T03:04:05Z') })
  })

  test('new import tasks reserve a new version while old messages keep their accepted version', async () => {
    const s = state()
    await s.save('import-save:90:5')
    expect(await s.save('import-save:91:5')).toMatchObject({ write_version: 2 })
    expect(await s.save('import-save:90:5')).toMatchObject({ write_version: 1 })
    expect(s.bookmark().write_version).toBe(2)
    expect(s.receipts()).toHaveLength(2)
  })

  test('rolls back bookmark, relation and version when the receipt cannot be committed', async () => {
    const s = state()
    s.failReceipt()
    await expect(s.save('import-save:90:5')).rejects.toThrow('receipt storage failed')
    expect(s.bookmark()).toBeNull()
    expect(s.relation()).toBeNull()
    expect(s.receipts()).toEqual([])
    expect(s.notify.sendBookmarkChange).not.toHaveBeenCalled()
  })
})
