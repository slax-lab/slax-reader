import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { ContextManager } from '@/utils/context'
import { BookmarkService } from '@/domain/bookmark'
import { SearchService } from '@/domain/search'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { MarkRepo } from '@/infra/repository/dbMark'
import { BucketClient } from '@/infra/repository/bucketClient'

/**
 * Writes a cleaned media article (podcast episode, YouTube video) into a bookmark body. Shared by
 * the podcast and the YouTube article services so both keep the body objects, word count, search
 * index and cached overview in step.
 */
@injectable()
export class MediaBodyService {
  constructor(
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo,
    @inject(SearchService) private searchService: SearchService,
    @inject(MarkRepo) private markRepo: MarkRepo,
    @inject(BucketClient) private bucket: LazyInstance<BucketClient>
  ) {}

  /**
   * True when anyone left a highlight or comment on this bookmark. Marks are anchored to the body
   * as it is, so a body with marks must not be replaced. Deleted rows do not count; a missing user
   * bookmark counts as marked, so an unknown state never loses marks.
   */
  public async hasMarks(bookmarkId: number, userId: number): Promise<boolean> {
    const ub = await this.bookmarkRepo.getUserBookmark(bookmarkId, userId)
    if (!ub) return true
    return (await this.markRepo.list(ub.id)).some(m => !m.is_deleted)
  }

  /** The current body HTML of a bookmark, or null when it has none. */
  public async readBody(bookmarkId: number): Promise<string | null> {
    const bookmark = await this.bookmarkService.getBookmarkById(bookmarkId)
    if (!bookmark?.content_key) return null
    const obj = await this.bucket().R2Bucket.get(bookmark.content_key)
    return obj ? obj.text() : null
  }

  /**
   * Replace one bookmark's body objects in place (same keys), then its word count and search index.
   * The cached AI overview was made from the old body: it is deleted, so it is made again from the new one.
   */
  public async writeBody(ctx: ContextManager, bookmarkId: number, userId: number, body: { html: string; text: string }): Promise<boolean> {
    const bookmark = await this.bookmarkService.getBookmarkById(bookmarkId)
    if (!bookmark?.content_key || bookmark.moderation_result > 0) return false
    const bucket = this.bucket().R2Bucket
    await bucket.put(bookmark.content_key, body.html)
    if (bookmark.content_md_key) await bucket.put(bookmark.content_md_key, body.text)
    await this.bookmarkRepo.updateBookmarkWordCount(bookmarkId, body.text.length)
    await this.bookmarkRepo.deleteBookmarkSummary(bookmarkId, userId)
    const results = await this.searchService.addSearchRecord(ctx, bookmarkId, bookmark.title || '', body.text).catch(err => [{ status: 'rejected' as const, reason: err }])
    const rejected = (results ?? []).filter(r => r.status === 'rejected')
    if (rejected.length) console.error(`Media body search index failed for bookmark ${bookmarkId}: ${rejected.length} part(s)`)
    return true
  }
}
