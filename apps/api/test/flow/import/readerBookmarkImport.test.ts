import { describe, expect, test, vi } from 'vitest'
import { ImportOrchestrator } from '@/domain/orchestrator/import'
import { parseImport } from '@/utils/importFormats'
import { createMockCtx, createMockBookmarkService, createMockCrawlService, createMockImportService } from '@test/helpers/mockFactory'

const origin = 'https://reader.example.com'
const uid = '123e4567-e89b-42d3-a456-426614174000'
const targetUid = '123e4567-e89b-42d3-a456-426614174001'
const sourceUrl = `${origin}/b/${uid}`
const imported = (target_url = sourceUrl) => ({ target_url, tags: ['topic'], saved_at: '2020-01-02T03:04:05Z', is_archive: true, is_starred: true, import_only: true })

function setup() {
  const ctx = createMockCtx({ hashIds: { encodeId: (id: number) => id * 10, decodeId: (id: number) => id / 10 } })
  ctx.env.FRONT_END_URL = origin
  const importService = createMockImportService()
  const bookmarkService = { ...createMockBookmarkService(), applyForkImportMetadata: vi.fn().mockResolvedValue(true) }
  bookmarkService.batchAddUrlBookmark.mockResolvedValue([])
  const crawlService = createMockCrawlService()
  const bookmarkForkService = { fork: vi.fn().mockResolvedValue({ bookmark_id: 420, bookmark_uid: targetUid, write_mode: 'created', fork_info: { bookmark_uid: uid } }) }
  const orchestrator = Object.assign(Object.create(ImportOrchestrator.prototype), { importService, bookmarkService, crawlService, bookmarkForkService }) as ImportOrchestrator
  const message = { id: 10, info: { id: 90, idx: 5, userId: 1, type: 'pinboard', data: [imported()], version: 1 as const } }
  const run = (slow: boolean) => slow ? orchestrator.processImportBookmarkSlow(ctx, message) : orchestrator.processImportBookmark(ctx, message)
  return { ctx, importService, bookmarkService, crawlService, bookmarkForkService, message, run }
}

for (const slow of [false, true]) {
  describe(slow ? 'slow Reader import' : 'fast Reader import', () => {
    test('copies a canonical Reader source and commits import metadata without crawl', async () => {
      const s = setup()
      s.importService.processImportBookmark.mockResolvedValue([imported()])
      await s.run(slow)
      expect(s.bookmarkForkService.fork).toHaveBeenCalledWith(s.ctx, { bookmark_uid: uid }, 'import:90:5')
      expect(s.bookmarkService.applyForkImportMetadata).toHaveBeenCalledWith(s.ctx, expect.objectContaining({ bookmarkId: 42, bookmarkUid: targetUid, importId: 90, operationKey: 'import:90:5', savedAt: new Date('2020-01-02T03:04:05Z'), isArchive: true, isStarred: true, tags: ['topic'] }))
      expect(s.bookmarkService.batchAddUrlBookmark).not.toHaveBeenCalled()
      expect(s.crawlService.createWorkflow).not.toHaveBeenCalled()
      expect(s.crawlService.createImportParseWorkflow).not.toHaveBeenCalled()
      expect(s.importService.incrImportTask).toHaveBeenCalledWith(s.ctx, 1, 90, 1, 0)
    })

    test('does not repeat import metadata or counters when the same queue item is replayed', async () => {
      const s = setup()
      s.importService.processImportBookmark.mockResolvedValue([imported()])
      s.bookmarkService.applyForkImportMetadata.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      await s.run(slow)
      await s.run(slow)
      expect(s.bookmarkForkService.fork.mock.calls.map(args => args[2])).toEqual(['import:90:5', 'import:90:5'])
      expect(s.importService.incrImportTask).toHaveBeenCalledTimes(1)
    })

    test('counts an inaccessible Reader source as failed and still dispatches an ordinary row', async () => {
      const s = setup()
      const normal = imported('https://example.com/article')
      s.importService.processImportBookmark.mockResolvedValue([imported(), normal])
      s.bookmarkForkService.fork.mockRejectedValue(new Error('source unavailable'))
      s.bookmarkService.batchAddUrlBookmark.mockResolvedValue([{ bookmarkId: 9, targetUrl: normal.target_url, userId: 1, skipParse: false, ignoreGenerateTag: true, writeVersion: 3 }])
      await s.run(slow)
      expect(s.bookmarkService.batchAddUrlBookmark).toHaveBeenCalledWith(s.ctx, [{ ...normal, saveOperationKey: 'import-save:90:6' }])
      expect(s.importService.incrImportTask).toHaveBeenCalledWith(s.ctx, 1, 90, 0, 1)
      expect(slow ? s.crawlService.createImportParseWorkflow : s.crawlService.createWorkflow).toHaveBeenCalledTimes(1)
      expect(s.bookmarkService.applyForkImportMetadata).not.toHaveBeenCalled()
    })

    test('keeps a completed Fork out of the failed total if a later ordinary batch fails', async () => {
      const s = setup()
      s.importService.processImportBookmark.mockResolvedValue([imported(), imported('https://example.com/article')])
      s.bookmarkService.batchAddUrlBookmark.mockRejectedValue(new Error('batch unavailable'))
      await s.run(slow)
      expect(s.importService.incrImportTask).toHaveBeenCalledWith(s.ctx, 1, 90, 1, 0)
      expect(s.importService.incrImportTask).toHaveBeenCalledWith(s.ctx, 1, 90, 0, 1)
      expect(s.importService.incrImportTask).not.toHaveBeenCalledWith(s.ctx, 1, 90, 0, 2)
    })

    test.each([`${origin}/other/%2e%2e/b/${uid}`, `https://%72eader.example.com/b/${uid}`, `https://READER.example.com/b/${uid}`, `${sourceUrl}?`, `${sourceUrl}#`, `${sourceUrl}?source=share`, `${sourceUrl}/`, ` ${sourceUrl}`])('does not turn an imported noncanonical URL into a Reader source: %s', async raw => {
      const s = setup()
      const records = parseImport('pinboard', JSON.stringify([{ href: raw, tags: '' }])).records
      s.importService.processImportBookmark.mockResolvedValue(records)
      await s.run(slow)
      expect(s.bookmarkForkService.fork).not.toHaveBeenCalled()
      expect(s.bookmarkService.batchAddUrlBookmark).toHaveBeenCalledWith(s.ctx, records.map((record, index) => ({ ...record, saveOperationKey: `import-save:90:${5 + index}` })))
    })
  })
}
