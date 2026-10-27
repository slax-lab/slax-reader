import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { ContextManager } from '@/utils/context'
import { BookmarkService } from '@/domain/bookmark'
import { SearchService } from '@/domain/search'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { MarkRepo } from '@/infra/repository/dbMark'
import { BucketClient } from '@/infra/repository/bucketClient'
import { loadEmbeddedSnapshot } from '@/utils/snapshotBundle'

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
    @inject(BucketClient) private bucket: LazyInstance<BucketClient>,
    @inject(BookmarkForkRepo) private forkRepo: BookmarkForkRepo
  ) {}

  /**
   * True when anyone left a highlight or comment on this bookmark. Marks are anchored to the body
   * as it is, so a body with marks must not be replaced. The body is shared by every reader of the
   * bookmark, so every reader's marks count. Deleted rows do not count; a missing user bookmark
   * counts as marked, so an unknown state never loses marks.
   */
  public async hasMarks(bookmarkId: number, userId: number): Promise<boolean> {
    return this.markRepo.bodyHasMarks(bookmarkId, userId)
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
   * A flagged bookmark is not written, except with `force` (the takedown restore must reach it too).
   */
  public async writeBody(ctx: ContextManager, bookmarkId: number, userId: number, body: { html: string; text: string }, opts: { force?: boolean } = {}): Promise<boolean> {
    const bookmark = await this.bookmarkService.getBookmarkById(bookmarkId)
    if (!bookmark?.content_key || (bookmark.moderation_result > 0 && !opts.force)) return false
    const bucket = this.bucket().R2Bucket
    if (!(await this.forkRepo.claimWrite(bookmarkId, bookmark.updated_at, ['success'], opts.force))) return false
    try {
      // Inspect under the shared write claim: a concurrent acquisition cannot replace this body.
      if ((await loadEmbeddedSnapshot(bucket, bookmark.content_key)).managed) {
        if (!(await this.forkRepo.releaseWrite(bookmarkId, bookmark.updated_at))) throw new Error('Media body claim changed')
        return false
      }
      const textKey = bookmark.content_md_key || bookmark.content_key.replace(/^html\//, 'text/').replace(/\.html$/, '.txt')
      if (textKey === bookmark.content_key) throw new Error('Media body text key missing')
      // HTML carries the rendered version marker; both required files precede DB success.
      if (!(await bucket.put(textKey, body.text))) throw new Error('Media text write failed')
      if (!(await bucket.put(bookmark.content_key, body.html))) throw new Error('Media HTML write failed')
      const published = await this.forkRepo.publishRevision(
        bookmarkId,
        bookmark.content_key,
        {
          content_key: bookmark.content_key,
          content_md_key: textKey,
          content_word_count: body.text.length
        },
        { expectedUpdatedAt: bookmark.updated_at, force: opts.force }
      )
      if (!published) {
        await this.forkRepo.releaseWrite(bookmarkId, bookmark.updated_at)
        return false
      }
    } catch (error) {
      // Existing fixed objects survive failed or uncertain publication acknowledgements.
      await this.forkRepo.releaseWrite(bookmarkId, bookmark.updated_at).catch(() => {})
      throw error
    }
    await this.bookmarkRepo.deleteBookmarkSummary(bookmarkId, userId)
    const results = await this.searchService.addSearchRecord(ctx, bookmarkId, bookmark.title || '', body.text).catch(err => [{ status: 'rejected' as const, reason: err }])
    const rejected = (results ?? []).filter(r => r.status === 'rejected')
    if (rejected.length) console.error(`Media body search index failed for bookmark ${bookmarkId}: ${rejected.length} part(s)`)
    return true
  }
}
