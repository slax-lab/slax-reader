import { PrismaClient, Prisma } from '@prisma/client'
import { inject, injectable } from '@/decorators/di'
import { PRISIMA_FULLTEXT_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import { ContextManager } from '@/utils/context'

const RAW_INSERT_CHUNK_SIZE = 16
const FTS_BATCH_SIZE = 10
const MAX_RAW_ROWS = 30000

export interface bookmarkRowPO {
  id: number
  bookmark_id: number
}

@injectable()
export class BookmarkSearchRepo {
  /**
   * 这里的prisma是fulltext的prisma，专门用来操作fulltext的表
   * @param prisma
   * @param vectorize
   */
  constructor(@inject(PRISIMA_FULLTEXT_CLIENT) private prisma: LazyInstance<PrismaClient>) {}

  /**
   * 创建书签原始数据
   * 注意：底层做了触发器会自动去更新索引，不需要手动维护
   * @param shard
   * @returns
   */
  async createBookmarkRaw(ctx: ContextManager, shard: { shard_idx: number; bookmark_id: number; content: string; rawContent: string; rawTitle: string; title: string }[]) {
    if (shard.length < 1) return
    const statements = [ctx.env.DB_FULLTEXT.prepare('DELETE FROM slax_bookmark_raw WHERE bookmark_id = ?').bind(shard[0].bookmark_id)]

    for (let i = 0; i < shard.length; i += RAW_INSERT_CHUNK_SIZE) {
      const chunk = shard.slice(i, i + RAW_INSERT_CHUNK_SIZE)
      const placeholders = chunk.map(() => '(?,?,?,?,?,?)').join(',')
      const values = chunk.flatMap(item => [item.shard_idx, item.bookmark_id, item.content, item.rawContent, item.title, item.rawTitle])
      statements.push(
        ctx.env.DB_FULLTEXT.prepare(`INSERT INTO slax_bookmark_raw (shard_idx, bookmark_id, content, raw_content, title, raw_title) VALUES ${placeholders}`).bind(...values)
      )
    }

    await ctx.env.DB_FULLTEXT.batch(statements)
  }

  async deleteBookmarkRaw(bookmarkId: number) {
    return await this.prisma().$executeRaw`DELETE FROM slax_bookmark_raw WHERE bookmark_id = ${bookmarkId}`
  }

  async getUserBookmarkRawIds(userId: number) {
    try {
      const rows = await this.prisma().$queryRaw<bookmarkRowPO[]>`SELECT id, br.bookmark_id FROM slax_bookmark_raw br
        INNER JOIN (SELECT bookmark_id FROM slax_user_bookmark WHERE user_id = ${userId}) ub
        ON br.bookmark_id = ub.bookmark_id
        ORDER BY br.id DESC
        LIMIT ${MAX_RAW_ROWS};`
      if (rows.length >= MAX_RAW_ROWS) {
        console.log(`search_scope_truncated user=${userId} searched=${rows.length}`)
      }
      return rows
    } catch (e) {
      console.log(e, 'getUserBookmarkRawIds error')
      return []
    }
  }

  async seachBM25Batch(
    ctx: ContextManager,
    rowIdGroups: number[][],
    keyword: string,
    onRows?: (rows: { bookmark_id: number; score: number; content_snippet: string; title_snippet: string; raw_content: string; raw_title: string }[]) => void
  ) {
    if (rowIdGroups.length < 1) return []

    const statements = rowIdGroups.map(rowIds => {
      if (rowIds.length < 1 || rowIds.length > 50) throw new Error('fulltext groups must contain 1-50 row ids')
      const placeholders = rowIds.map(() => '?').join(',')
      const sql = `WITH filtered_ids AS (
            SELECT DISTINCT r.id, r.bookmark_id, r.raw_content, r.raw_title
            FROM slax_bookmark_raw r
            where id in (${placeholders})
        ),
        search_results AS (
            SELECT
                f.bookmark_id,
                f.raw_content,
                f.raw_title,
                bm25(slax_fts_bookmark) as score,
                snippet(slax_fts_bookmark, 0, '[highlight]', '[/highlight]', '...', 32) as content_snippet,
                snippet(slax_fts_bookmark, 1, '[highlight]', '[/highlight]', '...', 8) as title_snippet,
                raw_content,
                raw_title
            FROM filtered_ids f
            INNER JOIN slax_fts_bookmark ON slax_fts_bookmark.rowid = f.id
            WHERE slax_fts_bookmark match ?
        )
        SELECT * FROM search_results`
      return ctx.env.DB_FULLTEXT.prepare(sql).bind(...rowIds, keyword)
    })

    const rows: { bookmark_id: number; score: number; content_snippet: string; title_snippet: string; raw_content: string; raw_title: string }[] = []
    let matchCount = 0
    const started = performance.now()

    for (let i = 0; i < statements.length; i += FTS_BATCH_SIZE) {
      try {
        const results = await ctx.env.DB_FULLTEXT.batch(statements.slice(i, i + FTS_BATCH_SIZE))
        const batchRows: typeof rows = []
        for (const result of results) {
          for (const row of (result.results ?? []) as Array<Record<string, unknown>>) {
            batchRows.push({
              bookmark_id: Number(row.bookmark_id),
              score: Number(row.score),
              content_snippet: String(row.content_snippet ?? ''),
              title_snippet: String(row.title_snippet ?? ''),
              raw_content: String(row.raw_content ?? ''),
              raw_title: String(row.raw_title ?? '')
            })
          }
        }
        matchCount += batchRows.length
        if (onRows) onRows(batchRows)
        else rows.push(...batchRows)
      } catch (e) {
        console.error(`seachBM25Batch error (groups=${rowIdGroups.length}): ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    console.log(
      `seachBM25Batch time: ${performance.now() - started} ms, groups: ${rowIdGroups.length}, batches: ${Math.ceil(statements.length / FTS_BATCH_SIZE)}, matches: ${matchCount}`
    )
    return rows
  }

  async getBookmarkRaw(bookmarkIds: number[]) {
    if (bookmarkIds.length < 1) return []

    const groupCount = Math.ceil(bookmarkIds.length / 50)
    const bookmarkIdGroup = Array.from({ length: groupCount }, (_, i) => bookmarkIds.slice(i * 50, (i + 1) * 50)).filter(group => group.length > 0)

    return (
      await Promise.allSettled(
        bookmarkIdGroup.map(
          item =>
            this.prisma().$queryRaw<{ id: number; bookmark_id: number; raw_content: string; raw_title: string }[]>`
    SELECT id, bookmark_id, substr(raw_content, 0, 50) as raw_content, substr(raw_title, 0, 50) as raw_title FROM slax_bookmark_raw WHERE bookmark_id in (${Prisma.join(item)})`
        )
      )
    )
      .map(item => (item.status === 'fulfilled' ? item.value : []))
      .flat()
      .filter(item => !!item)
  }

  async upsertUserBookmark(userId: number, bookmarkId: number) {
    await this.prisma().$executeRaw`
      INSERT INTO slax_user_bookmark (user_id, bookmark_id, created_at) 
      VALUES (${userId}, ${bookmarkId}, ${new Date().toISOString()})
      ON CONFLICT (user_id, bookmark_id) DO NOTHING
    `
  }

  async deleteUserBookmark(userId: number, bookmarkId: number) {
    return await this.prisma().$executeRaw`DELETE FROM slax_user_bookmark WHERE user_id = ${userId} AND bookmark_id = ${bookmarkId}`
  }
}
