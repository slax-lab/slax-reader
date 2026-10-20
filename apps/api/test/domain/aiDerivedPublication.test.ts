import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '@prisma/client'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { BookmarkService } from '@/domain/bookmark'
import { UrlParserHandler } from '@/domain/orchestrator/urlParser'
import { BookmarkOrchestrator } from '@/domain/orchestrator/bookmark'
import { AigcBatchOrchestrator } from '@/domain/orchestrator/aigc'
import { AigcController } from '@/handler/http/aigcController'
import { BatchJobStatus } from '@/infra/external/batchCompletion'
import { createMockCtx } from '@test/helpers/mockFactory'

vi.mock('@/decorators/di', () => ({ injectable: () => (target: any) => target, singleton: () => (target: any) => target, inject: () => () => undefined }))
vi.mock('@/decorators/controller', () => ({ Controller: () => (target: any) => target }))
vi.mock('@/decorators/route', () => ({ Post: () => (_target: any, _key: string, descriptor: any) => descriptor }))

let db: PGlite
let repo: BookmarkRepo
const revision = { writeVersion: 1, publishedVersion: 1, contentKey: 'body-a', contentMdKey: 'text-a' }
const lockQueries: string[] = []

function adapter(connection: any): any {
  const query = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = Prisma.sql(parts, ...values)
    if (/FOR UPDATE/.test(sql.text)) lockQueries.push(sql.text)
    return connection.query(sql.text, sql.values)
  }
  const upsert = async (table: string, create: any, conflict: string[], update: any) => {
    const fields = Object.keys(create)
    const changed = Object.keys(update)
    const sql = 'INSERT INTO ' + table + '(' + fields.join(',') + ') VALUES (' + fields.map((_, i) => '$' + (i + 1)).join(',') + ')' +
      ' ON CONFLICT (' + conflict.join(',') + ') DO ' + (changed.length ? 'UPDATE SET ' + changed.map(k => k + '=EXCLUDED.' + k).join(',') : 'NOTHING') + ' RETURNING *'
    return (await connection.query(sql, Object.values(create))).rows[0] || {}
  }
  return {
    $queryRaw: async (...args: any[]) => (await query(args[0], ...args.slice(1))).rows,
    $executeRaw: async (...args: any[]) => (await query(args[0], ...args.slice(1))).affectedRows,
    $transaction: (fn: any) => connection.transaction((tx: any) => fn(adapter(tx))),
    sr_bookmark: { findFirst: async () => ({ ...(await connection.query('SELECT * FROM sr_bookmark WHERE id=42')).rows[0], title: 'A', target_url: 'https://example.com/article', byline: '', moderation_result: 0 }) },
    sr_user_tag: { findMany: async () => [{ id: 3, tag_name: 'old tag' }] },
    sr_bookmark_summary: { upsert: ({ create, update }: any) => upsert('sr_bookmark_summary', create, ['bookmark_id', 'lang', 'user_id'], update) },
    sr_user_bookmark_overview: { upsert: ({ create, update }: any) => upsert('sr_user_bookmark_overview', create, ['bookmark_id', 'user_id'], update) }
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    CREATE TABLE sr_bookmark(id INT PRIMARY KEY,write_version INT,published_version INT,content_key TEXT,content_md_key TEXT);
    CREATE TABLE sr_bookmark_summary(bookmark_id INT,user_id INT,lang TEXT,content TEXT,ai_name TEXT,ai_model TEXT,created_at TIMESTAMP,updated_at TIMESTAMP,UNIQUE(bookmark_id,lang,user_id));
    CREATE TABLE sr_user_bookmark_overview(bookmark_id INT,user_id INT,overview TEXT,content TEXT,created_at TIMESTAMP,UNIQUE(bookmark_id,user_id));
    CREATE TABLE sr_user_bookmark_tag(user_id INT,bookmark_id INT,tag_id INT,tag_name TEXT,created_at TIMESTAMP,source TEXT,is_deleted BOOLEAN DEFAULT false,UNIQUE(user_id,bookmark_id,tag_id));
  `)
  repo = new BookmarkRepo(() => null as any, () => adapter(db))
}, 30_000)
beforeEach(async () => {
  lockQueries.length = 0
  await db.exec(`TRUNCATE sr_bookmark,sr_bookmark_summary,sr_user_bookmark_overview,sr_user_bookmark_tag;
    INSERT INTO sr_bookmark VALUES(42,1,1,'body-a','text-a');`)
})
afterAll(async () => { await db?.close() })

async function writeAll(source = revision) {
  await (repo.upsertBookmarkSummary as any)({ bookmark_id: 42, user_id: 7, lang: 'en', content: 'old outline' }, source)
  await (repo.createBookmarkOverview as any)(7, 42, '', 'old overview', source)
  await (repo.upsertBookmarkTags as any)(42, 7, [{ id: 3, tag_name: 'old tag' }], 'ai', source)
}
async function counts() {
  const result: number[] = []
  for (const table of ['sr_bookmark_summary', 'sr_user_bookmark_overview', 'sr_user_bookmark_tag']) {
    result.push(Number((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM ' + table)).rows[0].count))
  }
  return result
}

describe('AI derived writes use their committed source body', () => {
  it('rejects AI finishing after a newer direct or Fork publication', async () => {
    await db.exec("UPDATE sr_bookmark SET write_version=2,published_version=2,content_key='body-b',content_md_key='text-b'")
    await writeAll()
    expect(await counts()).toEqual([0, 0, 0])
  })
  it('rejects AI after media replaces the body in the same write version', async () => {
    await db.exec("UPDATE sr_bookmark SET content_key='media-body',content_md_key='media-text'")
    await writeAll()
    expect(await counts()).toEqual([0, 0, 0])
  })
  it('rejects AI for the old source after a newer save is reserved', async () => {
    await db.exec('UPDATE sr_bookmark SET write_version=2')
    await writeAll()
    expect(await counts()).toEqual([0, 0, 0])
  })
  it('rejects an old text identity even if the HTML key has not changed', async () => {
    await db.exec("UPDATE sr_bookmark SET content_md_key='new-text'")
    await writeAll()
    expect(await counts()).toEqual([0, 0, 0])
  })
  it('accepts current results while holding the bookmark row lock through each write', async () => {
    await writeAll()
    expect(await counts()).toEqual([1, 1, 1])
    expect(lockQueries).toHaveLength(3)
    expect(lockQueries.every(sql => /FOR UPDATE/.test(sql))).toBe(true)
  })
  it('fences legacy version-zero AI with the body keys too', async () => {
    await db.exec('UPDATE sr_bookmark SET write_version=0,published_version=0')
    const legacy = { ...revision, writeVersion: 0, publishedVersion: 0 }
    await writeAll(legacy)
    expect(await counts()).toEqual([1, 1, 1])
    await db.exec("TRUNCATE sr_bookmark_summary,sr_user_bookmark_overview,sr_user_bookmark_tag; UPDATE sr_bookmark SET content_key='new-legacy-body'")
    await writeAll(legacy)
    expect(await counts()).toEqual([0, 0, 0])
  })
  it('keeps manual user tag operations available without an AI source revision', async () => {
    await repo.upsertBookmarkTags(42, 7, [{ id: 3, tag_name: 'manual' }], 'user')
    expect(await counts()).toEqual([0, 0, 1])
    expect(lockQueries).toEqual([])
  })
})


function services() {
  const svc = new (BookmarkService as any)() as BookmarkService
  Object.assign(svc, { bookmarkRepo: repo, bookmarkData: repo })
  const ctx = createMockCtx({ userId: 7 })
  ctx.get.mockReturnValue('en')
  const tags = { listUserTags: vi.fn().mockResolvedValue([{ id: 3, name: 'old tag', source: 'mine' }]), getBookmarkTags: vi.fn().mockResolvedValue([]) }
  return { svc, ctx, tags }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
async function replaceBody() {
  await db.exec("UPDATE sr_bookmark SET write_version=2,published_version=2,content_key='body-b',content_md_key='text-b'; TRUNCATE sr_bookmark_summary,sr_user_bookmark_overview")
}

describe('AI entrypoints preserve the source revision across asynchronous generation', () => {
  it('normal crawl overview and tags cannot commit after replacement during generation', async () => {
    const { svc, ctx, tags } = services()
    const started = deferred<void>()
    const generated = deferred<any>()
    const handler = new (UrlParserHandler as any)() as UrlParserHandler
    Object.assign(handler, { bookmarkSvc: svc, userSvc: { getUserInfo: async () => ({ ai_lang: 'en' }), getUserSubscriptionInfo: async () => ({ subscription_end_at: new Date('2099-01-01') }) },
      tagSvc: tags, aigcSvc: { generateOverviewTag: () => { started.resolve(); return generated.promise } },
      searchSvc: { addSearchRecordByBmId: async () => [] }, telegramBotSvc: {}, logsService: { track: async () => {} },
      crawlSvc: { pushBookmarkFailureAlert: async () => {} } })
    vi.spyOn(svc, 'isBookmarkVersionCurrent').mockResolvedValue(true)
    vi.spyOn(svc, 'updateUserBookmarkCreateAt').mockResolvedValue(undefined)
    await handler.processPostHandler(ctx, { id: 'capture', info: { userId: 7, bookmarkId: 42, writeVersion: 1, targetUrl: 'https://example.com/article', ignoreGenerateTag: false } } as any,
      { title: 'A', textContent: 'body A', contentKey: 'body-a' })
    await started.promise
    await replaceBody()
    generated.resolve({ overview: 'old overview', key_takeaways: [], tags: ['old tag'] })
    await ctx.execution.waitUntil.mock.calls[0][0]
    expect(await counts()).toEqual([0, 0, 0])
  })

  it('legacy parse callback uses the captured body identity instead of the latest row', async () => {
    const { svc, ctx, tags } = services()
    const handler = new (UrlParserHandler as any)() as UrlParserHandler
    Object.assign(handler, { bookmarkService: svc, tagService: tags, aigcService: { generateOverviewTags: async () => {
      await replaceBody()
      return { overview: 'old overview', key_takeaways: [], tags: ['old tag'] }
    } } })
    const callback = await handler.handleTagTask(ctx, { bookmarkId: 42, userIds: [7], ignoreGenerateTag: false })
    await callback({ parseRes: { title: 'A', textContent: 'body A' }, contentRevision: revision })
    expect(await counts()).toEqual([0, 0, 0])
  })

  it('summary streaming callback cannot cache output generated from the replaced body', async () => {
    const { svc, ctx } = services()
    vi.spyOn(svc, 'getBookmarkId').mockResolvedValue(42)
    vi.spyOn(svc, 'getBookmarkContent').mockResolvedValue('body A')
    const controller = new (AigcController as any)() as AigcController
    Object.assign(controller, { bookmarkService: svc, userService: { getUserInfo: async () => ({ ai_lang: 'en' }) }, aigcService: {
      recordChunks: () => {}, bookmarkSummary: async (_ctx: any, content: string, _writer: any, callback: any) => {
        expect(content).toBe('body A')
        await replaceBody()
        await callback({ provider: 'test', model: 'test', response: 'old summary' })
      }
    } })
    const request = new Request('https://reader.test/v1/aigc/summaries', { method: 'POST', body: JSON.stringify({ bm_id: 42, force: true }), headers: { 'Content-Type': 'application/json' } })
    await controller.handleSummariesRequest(ctx, request)
    await ctx.execution.waitUntil.mock.calls[0][0]
    expect(await counts()).toEqual([0, 0, 0])
  })

  it('interactive outline cannot cache a result after the source body changes', async () => {
    const { svc, ctx } = services()
    vi.spyOn(svc, 'getUserBookmark').mockResolvedValue({ id: 1 } as any)
    vi.spyOn(svc, 'getBookmarkContent').mockResolvedValue('body A')
    const handler = new (BookmarkOrchestrator as any)() as any
    Object.assign(handler, { bookmarkSvc: svc, userSvc: { getUserInfo: async () => ({ ai_lang: 'en' }) }, aigcSvc: {
      generateOutline: async (_ctx: any, _body: string, callback: any) => {
        await callback({ content: 'old outline' })
        await replaceBody()
        return { model: 'test' }
      }
    } })
    await handler.generateOutlineStream(ctx, { writer: { write: async () => {} }, encoder: new TextEncoder(), userId: 7, bmId: 42 })
    expect(await counts()).toEqual([0, 0, 0])
  })

  it('interactive overview rejects stale output without emitting completed overview or tag data', async () => {
    const { svc, ctx, tags } = services()
    vi.spyOn(svc, 'getUserBookmark').mockResolvedValue({ id: 1 } as any)
    vi.spyOn(svc, 'getBookmarkContent').mockResolvedValue('body A')
    const handler = new (BookmarkOrchestrator as any)() as any
    const writes: Uint8Array[] = []
    Object.assign(handler, { bookmarkSvc: svc, tagSvc: tags, userSvc: { getUserInfo: async () => ({ ai_lang: 'en' }) }, aigcSvc: {
      generateOverviewTag: async () => {
        await replaceBody()
        return { overview: 'old overview', key_takeaways: [], tags: ['old tag'] }
      }
    } })
    await handler.generateOverviewStream(ctx, { writer: { write: async (value: Uint8Array) => { writes.push(value) } }, encoder: new TextEncoder(), userId: 7, bmId: 42, bookmarkTags: [] })
    expect(await counts()).toEqual([0, 0, 0])
    expect(writes.map(value => new TextDecoder().decode(value)).join('')).not.toContain('old overview')
  })

  it.each(['', JSON.stringify({ contentRevision: { ...revision, contentKey: 'obsolete-body' } })])('discards unversioned or already superseded batch results (%s)', async metadata => {
    const { svc, ctx, tags } = services()
    vi.spyOn(svc, 'getUnfinishedAigcBatchTasks').mockResolvedValue([{ user_id: 7, bookmark_id: 42, batch_request_id: 'batch', result_data: metadata } as any])
    const update = vi.spyOn(svc, 'updateAigcBatchTaskStatus').mockResolvedValue(undefined)
    const aigc = { getBatchTask: async () => ({ metadata: { state: BatchJobStatus.SUCCEEDED }, response: { inlinedResponses: { inlinedResponses: [{ response: { candidates: [{ content: { parts: [{ text: JSON.stringify({ overview: 'old overview', tags: ['old tag'] }) }] } }] } }] } } }) }
    const handler = new AigcBatchOrchestrator(aigc as any, svc, tags as any)
    await handler.processBatchTask(ctx)
    expect(await counts()).toEqual([0, 0, 0])
    expect(update).toHaveBeenCalledWith('batch', 'failed', '', 'stale or unversioned content revision')
  })
})
