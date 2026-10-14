/**
 * Import 全分支: processImportBookmarkSlow + processImportBookmark (fast)
 * 来源: import.ts 全文
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { ImportOrchestrator } from '@/domain/orchestrator/import'
import { createMockCtx, createMockBookmarkService, createMockCrawlService, createMockImportService } from '@test/helpers/mockFactory'

vi.mock('@/utils/hashids', () => ({
  Hashid: vi.fn().mockImplementation(() => ({ encodeId: vi.fn().mockReturnValue(100) }))
}))

function wire() {
  const is = createMockImportService()
  const bs = createMockBookmarkService()
  const cs = createMockCrawlService()
  const orch = new (ImportOrchestrator as any)()
  ;(orch as any).importService = is; ;(orch as any).bookmarkService = bs
  ;(orch as any).crawlService = cs; ;(orch as any).kvClient = vi.fn()
  return { orch: orch as ImportOrchestrator, is, bs, cs }
}

function msg(id = 1, importId = 100, type = 'import') {
  return { id, info: { id: importId, type } as any }
}

// ==================== SLOW ====================
describe('processImportBookmarkSlow', () => {
  test('正常分发 ImportParseWorkflow', async () => {
    const { orch, is, bs, cs } = wire()
    is.processImportBookmark.mockResolvedValue([{ target_url: 'https://a.com', target_title: 'A', tags: [] }])
    bs.batchAddUrlBookmark.mockResolvedValue([{ bookmarkId: 1, targetUrl: 'https://a.com', userId: 1, skipParse: false, ignoreGenerateTag: false }])
    await orch.processImportBookmarkSlow(createMockCtx(), msg())
    expect(cs.createImportParseWorkflow).toHaveBeenCalledTimes(1)
    expect(bs.createBookmarkImportRelation).toHaveBeenCalledWith(1, 1, 100)
  })

  test('skipParse=true → 跳过 workflow, status=1, 计入 skipParseCount', async () => {
    const { orch, is, bs, cs } = wire()
    is.processImportBookmark.mockResolvedValue([{ target_url: 'https://a.com', target_title: 'A', tags: [] }])
    bs.batchAddUrlBookmark.mockResolvedValue([{ bookmarkId: 1, targetUrl: 'https://a.com', userId: 1, skipParse: true, ignoreGenerateTag: false }])
    await orch.processImportBookmarkSlow(createMockCtx(), msg())
    expect(cs.createImportParseWorkflow).not.toHaveBeenCalled()
    expect(bs.updateBookmarkImportRelationStatus).toHaveBeenCalledWith(1, 1, 100, 1)
    expect(is.incrImportTask).toHaveBeenCalledWith(expect.anything(), 1, 100, 1, 0)
  })

  test('null item → 跳过', async () => {
    const { orch, is, bs, cs } = wire()
    is.processImportBookmark.mockResolvedValue([{ target_url: 'https://a.com', target_title: 'A', tags: [] }])
    bs.batchAddUrlBookmark.mockResolvedValue([null])
    await orch.processImportBookmarkSlow(createMockCtx(), msg())
    expect(cs.createImportParseWorkflow).not.toHaveBeenCalled()
    expect(bs.createBookmarkImportRelation).not.toHaveBeenCalled()
  })

  test('workflow 创建失败 → status=2 + incrImportTask(0,1)', async () => {
    const { orch, is, bs, cs } = wire()
    is.processImportBookmark.mockResolvedValue([{ target_url: 'https://a.com', target_title: 'A', tags: [] }])
    bs.batchAddUrlBookmark.mockResolvedValue([{ bookmarkId: 1, targetUrl: 'https://a.com', userId: 1, skipParse: false, ignoreGenerateTag: false }])
    cs.createImportParseWorkflow.mockRejectedValue(new Error('wf fail'))
    await orch.processImportBookmarkSlow(createMockCtx(), msg())
    expect(bs.updateBookmarkImportRelationStatus).toHaveBeenCalledWith(1, 1, 100, 2)
    expect(is.incrImportTask).toHaveBeenCalledWith(expect.anything(), 1, 100, 0, 1)
  })

  test('workflow 创建失败 + 更新状态也失败 → 静默', async () => {
    const { orch, is, bs, cs } = wire()
    is.processImportBookmark.mockResolvedValue([{ target_url: 'https://a.com', target_title: 'A', tags: [] }])
    bs.batchAddUrlBookmark.mockResolvedValue([{ bookmarkId: 1, targetUrl: 'https://a.com', userId: 1, skipParse: false, ignoreGenerateTag: false }])
    cs.createImportParseWorkflow.mockRejectedValue(new Error('wf fail'))
    bs.updateBookmarkImportRelationStatus.mockRejectedValue(new Error('db fail'))
    // 不抛异常
    await expect(orch.processImportBookmarkSlow(createMockCtx(), msg())).resolves.toBeUndefined()
  })

  test('外层异常 + undispatchedCount > 0 → incrImportTask(0, undispatched)', async () => {
    const { orch, is, bs } = wire()
    is.processImportBookmark.mockResolvedValue([{ target_url: 'https://a.com' }, { target_url: 'https://b.com' }])
    bs.batchAddUrlBookmark.mockRejectedValue(new Error('batch fail'))
    const ctx = createMockCtx()
    await orch.processImportBookmarkSlow(ctx, msg())
    // totalItems = 2 (set after processImportBookmark), dispatched=0, skip=0 → undispatched=2
    expect(is.incrImportTask).toHaveBeenCalledWith(ctx, 1, 100, 0, 2)
  })

  test('外层异常 + incr 失败 → catch 静默', async () => {
    const { orch, is, bs } = wire()
    is.processImportBookmark.mockResolvedValue([{ target_url: 'https://a.com' }])
    bs.batchAddUrlBookmark.mockRejectedValue(new Error('batch fail'))
    is.incrImportTask.mockRejectedValue(new Error('incr fail'))
    await expect(orch.processImportBookmarkSlow(createMockCtx(), msg())).resolves.toBeUndefined()
  })

  test('多项混合: 2 dispatched + 1 skip → skipParseCount=1', async () => {
    const { orch, is, bs, cs } = wire()
    is.processImportBookmark.mockResolvedValue([{}, {}, {}] as any)
    bs.batchAddUrlBookmark.mockResolvedValue([
      { bookmarkId: 1, targetUrl: 'https://a.com', userId: 1, skipParse: false, ignoreGenerateTag: false },
      { bookmarkId: 2, targetUrl: 'https://b.com', userId: 1, skipParse: true, ignoreGenerateTag: false },
      { bookmarkId: 3, targetUrl: 'https://c.com', userId: 1, skipParse: false, ignoreGenerateTag: false }
    ])
    await orch.processImportBookmarkSlow(createMockCtx(), msg())
    expect(cs.createImportParseWorkflow).toHaveBeenCalledTimes(2)
    expect(is.incrImportTask).toHaveBeenCalledWith(expect.anything(), 1, 100, 1, 0)
  })
})

// ==================== FAST ====================
describe('processImportBookmark (fast)', () => {
  test('ctx.set is_retry_task=true when type=fetch_retry', async () => {
    const { orch, is, bs } = wire()
    is.processImportBookmark.mockResolvedValue([])
    bs.batchAddUrlBookmark.mockResolvedValue([])
    const ctx = createMockCtx()
    await orch.processImportBookmark(ctx, msg(1, 100, 'fetch_retry'))
    expect(ctx.set).toHaveBeenCalledWith('is_retry_task', true)
    expect(ctx.set).toHaveBeenCalledWith('is_import_task', true)
  })

  test('ctx.set is_retry_task=false when type=import', async () => {
    const { orch, is, bs } = wire()
    is.processImportBookmark.mockResolvedValue([])
    bs.batchAddUrlBookmark.mockResolvedValue([])
    const ctx = createMockCtx()
    await orch.processImportBookmark(ctx, msg(1, 100, 'import'))
    expect(ctx.set).toHaveBeenCalledWith('is_retry_task', false)
  })

  test('正常分发 CrawlWorkflow', async () => {
    const { orch, is, bs, cs } = wire()
    is.processImportBookmark.mockResolvedValue([{ target_url: 'https://a.com', target_title: 'A', tags: [] }])
    bs.batchAddUrlBookmark.mockResolvedValue([{ bookmarkId: 1, targetUrl: 'https://a.com', userId: 1, skipParse: false, ignoreGenerateTag: false }])
    await orch.processImportBookmark(createMockCtx(), msg())
    expect(cs.createWorkflow).toHaveBeenCalledTimes(1)
    expect(cs.createWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      url: 'https://a.com', bookmarkId: 1, importTaskId: 100, ignoreGenerateTag: false
    }), 3, expect.objectContaining({ execution: expect.anything() }))
  })

  test('skipParse 和 dispatch 混合计数', async () => {
    const { orch, is, bs, cs } = wire()
    is.processImportBookmark.mockResolvedValue([{}, {}, {}] as any)
    bs.batchAddUrlBookmark.mockResolvedValue([
      { bookmarkId: 1, targetUrl: 'https://a.com', userId: 1, skipParse: true, ignoreGenerateTag: false },
      { bookmarkId: 2, targetUrl: 'https://b.com', userId: 1, skipParse: false, ignoreGenerateTag: false },
      { bookmarkId: 3, targetUrl: 'https://c.com', userId: 1, skipParse: true, ignoreGenerateTag: false }
    ])
    await orch.processImportBookmark(createMockCtx(), msg())
    expect(cs.createWorkflow).toHaveBeenCalledTimes(1)
    expect(is.incrImportTask).toHaveBeenCalledWith(expect.anything(), 1, 100, 2, 0)
  })

  test('workflow 创建失败 → status=2 + incrImportTask(0,1)', async () => {
    const { orch, is, bs, cs } = wire()
    is.processImportBookmark.mockResolvedValue([{ target_url: 'https://a.com' }] as any)
    bs.batchAddUrlBookmark.mockResolvedValue([{ bookmarkId: 1, targetUrl: 'https://a.com', userId: 1, skipParse: false, ignoreGenerateTag: false }])
    cs.createWorkflow.mockRejectedValue(new Error('wf fail'))
    await orch.processImportBookmark(createMockCtx(), msg())
    expect(bs.updateBookmarkImportRelationStatus).toHaveBeenCalledWith(1, 1, 100, 2)
    expect(is.incrImportTask).toHaveBeenCalledWith(expect.anything(), 1, 100, 0, 1)
  })

  test('batchAddUrlBookmark 失败 → undispatched 计算', async () => {
    const { orch, is, bs } = wire()
    is.processImportBookmark.mockResolvedValue([{}, {}] as any)
    bs.batchAddUrlBookmark.mockRejectedValue(new Error('batch'))
    const ctx = createMockCtx()
    await orch.processImportBookmark(ctx, msg())
    expect(is.incrImportTask).toHaveBeenCalledWith(ctx, 1, 100, 0, 2)
  })
})
