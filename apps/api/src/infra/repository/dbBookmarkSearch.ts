import { PrismaClient, Prisma } from '@prisma/client'
import { inject, injectable, singleton } from '@/decorators/di'
import { PRISIMA_FULLTEXT_CLIENT, VECTORIZE_CLIENTS } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'

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

  async seachBM25(rowIds: number[], keyword: string) {
    try {
      const t1 = performance.now()
      if (rowIds.length < 1) return []

      const res = await this.prisma().$queryRaw<{ bookmark_id: number; score: number; content_snippet: string; title_snippet: string; raw_content: string; raw_title: string }[]>`
        WITH filtered_ids AS (
            SELECT DISTINCT r.id, r.bookmark_id, r.raw_content, r.raw_title
            FROM slax_bookmark_raw r
            where id in (${Prisma.join(rowIds)})
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
            WHERE slax_fts_bookmark match ${keyword}
        )
        SELECT * FROM search_results;`
      const t2 = performance.now()
      console.log(`seachBM25 time: ${t2 - t1} ms`)
      return res
    } catch (e) {
      console.error(`seachBM25 error (rowIds=${rowIds.length}, keyword=${keyword}): ${e instanceof Error ? e.message : String(e)}`)
      throw e
    }
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
