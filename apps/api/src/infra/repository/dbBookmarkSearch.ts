import { PrismaClient, Prisma } from '@prisma/client'
import { inject, injectable, singleton } from '@/decorators/di'
import { PRISIMA_FULLTEXT_CLIENT, VECTORIZE_CLIENTS } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import type { fulltextExpressions } from '@/utils/hybridSearch/normalizer'

export interface bookmarkRowPO {
  id: number
  bookmark_id: number
}

export interface fulltextRankPO {
  row_id: number
  bookmark_id: number
  score: number
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
  async createBookmarkRaw(shard: { shard_idx: number; bookmark_id: number; content: string; rawContent: string; rawTitle: string; title: string }[]) {
    if (shard.length < 1) return
    // 删除旧数据
    await this.prisma().$executeRaw`DELETE FROM slax_bookmark_raw WHERE bookmark_id = ${shard[0].bookmark_id}`
    // 拼接values
    const values = shard.map(item => Prisma.sql`(${item.shard_idx}, ${item.bookmark_id}, ${item.content}, ${item.rawContent}, ${item.title}, ${item.rawTitle})`)
    // 插入新数据
    await this.prisma().$executeRaw`
      INSERT INTO slax_bookmark_raw (shard_idx, bookmark_id, content, raw_content, title, raw_title) 
      VALUES ${Prisma.join(values)}
    `
  }

  async deleteBookmarkRaw(bookmarkId: number) {
    return await this.prisma().$executeRaw`DELETE FROM slax_bookmark_raw WHERE bookmark_id = ${bookmarkId}`
  }

  async getUserBookmarkRawIds(userId: number) {
    try {
      return await this.prisma().$queryRaw<bookmarkRowPO[]>`SELECT id, br.bookmark_id FROM slax_bookmark_raw br
        INNER JOIN (SELECT bookmark_id FROM slax_user_bookmark WHERE user_id = ${userId}) ub
        ON br.bookmark_id = ub.bookmark_id;`
    } catch (e) {
      console.log(e, 'getUserBookmarkRawIds error')
      return []
    }
  }

  async searchCandidatePage(keyword: string, offset: number, limit: number) {
    return this.prisma().$queryRaw<{ row_id: number; bookmark_id: number; score: number; excerpt: string }[]>`
      SELECT slax_fts_bookmark.rowid AS row_id, raw.bookmark_id, bm25(slax_fts_bookmark) AS score,
        snippet(slax_fts_bookmark, 0, '', '', '...', 32) AS excerpt
      FROM slax_fts_bookmark
      JOIN slax_bookmark_raw raw ON raw.id = slax_fts_bookmark.rowid
      WHERE slax_fts_bookmark MATCH ${keyword}
      ORDER BY score ASC, raw.bookmark_id ASC, slax_fts_bookmark.rowid ASC
      LIMIT ${limit} OFFSET ${offset}
    `
  }

  /**
   * Ranks the given fulltext rows against the MATCH expression in one query. The row ids travel as a single JSON
   * parameter, so the statement size does not grow with the candidate count. Driving the join from
   * slax_bookmark_raw lets SQLite scan the FTS match once and probe the id list through a bloom filter; carrying
   * text columns here would make the planner rescan them per match.
   */
  async rankFulltextRows(rowIds: number[], expression: string) {
    if (rowIds.length < 1 || !expression) return []
    return this.prisma().$queryRaw<fulltextRankPO[]>`
      SELECT r.id AS row_id, r.bookmark_id, bm25(slax_fts_bookmark) AS score
      FROM slax_bookmark_raw r
      JOIN slax_fts_bookmark ON slax_fts_bookmark.rowid = r.id
      WHERE slax_fts_bookmark MATCH ${expression} AND r.id IN (SELECT value FROM json_each(${JSON.stringify(rowIds)}))
      ORDER BY score ASC, r.id ASC
    `
  }

  /**
   * Title and content snippets plus the raw text for a bounded set of ranked rows. Each snippet uses its
   * single-column expression because FTS5 snippet() can fail with SQLITE_CORRUPT_VTAB on the two-column
   * NEAR OR expression used for ranking.
   */
  async getFulltextHighlights(rowIds: number[], expressions: fulltextExpressions) {
    if (rowIds.length < 1) return []
    const ids = JSON.stringify(rowIds)
    const [contents, titles, raws] = await Promise.all([
      this.prisma().$queryRaw<{ row_id: number; snippet: string }[]>`
        SELECT r.id AS row_id, snippet(slax_fts_bookmark, 0, '[highlight]', '[/highlight]', '...', 32) AS snippet
        FROM slax_bookmark_raw r
        JOIN slax_fts_bookmark ON slax_fts_bookmark.rowid = r.id
        WHERE slax_fts_bookmark MATCH ${expressions.content} AND r.id IN (SELECT value FROM json_each(${ids}))
      `,
      this.prisma().$queryRaw<{ row_id: number; snippet: string }[]>`
        SELECT r.id AS row_id, snippet(slax_fts_bookmark, 1, '[highlight]', '[/highlight]', '...', 8) AS snippet
        FROM slax_bookmark_raw r
        JOIN slax_fts_bookmark ON slax_fts_bookmark.rowid = r.id
        WHERE slax_fts_bookmark MATCH ${expressions.title} AND r.id IN (SELECT value FROM json_each(${ids}))
      `,
      this.prisma().$queryRaw<{ row_id: number; raw_title: string; raw_content: string }[]>`
        SELECT id AS row_id, raw_title, raw_content FROM slax_bookmark_raw WHERE id IN (SELECT value FROM json_each(${ids}))
      `
    ])
    const contentSnippets = new Map(contents.map(row => [row.row_id, row.snippet]))
    const titleSnippets = new Map(titles.map(row => [row.row_id, row.snippet]))
    return raws.map(row => ({
      row_id: row.row_id,
      raw_title: row.raw_title,
      raw_content: row.raw_content,
      content_snippet: contentSnippets.get(row.row_id) ?? '',
      title_snippet: titleSnippets.get(row.row_id) ?? ''
    }))
  }

  /**
   * Leading raw title/content characters for ranked rows outside the highlight bound; mapHighlight shows the first
   * 60 characters when a row has no highlight, so a short prefix is all those rows need.
   */
  async getFulltextRawPrefixes(rowIds: number[]) {
    if (rowIds.length < 1) return []
    return this.prisma().$queryRaw<{ row_id: number; raw_title: string; raw_content: string }[]>`
      SELECT id AS row_id, substr(raw_title, 1, 120) AS raw_title, substr(raw_content, 1, 120) AS raw_content
      FROM slax_bookmark_raw WHERE id IN (SELECT value FROM json_each(${JSON.stringify(rowIds)}))
    `
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
