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

  /** Stage media output, then publish only while its capture and body pointer remain current. */
  public async writeBody(
    ctx: ContextManager,
    bookmarkId: number,
    userId: number,
    body: { html: string; text: string },
    opts: { force?: boolean; captureVersion?: number } = {}
  ): Promise<boolean> {
    const bookmark = await this.bookmarkService.getBookmarkById(bookmarkId)
    const version = opts.captureVersion ?? 0
    if (!bookmark?.content_key || (bookmark.moderation_result > 0 && !opts.force)) return false
    if ((bookmark.write_version ?? 0) !== version || (bookmark.published_version ?? 0) !== version) return false
    if (await this.bookmarkRepo.getCurrentBookmarkFork(bookmarkId)) return false
    const suffix = `${bookmarkId}/${version}/${crypto.randomUUID()}`
    const contentKey = `html/body/media/${suffix}.html`
    const textKey = `text/body/media/${suffix}.txt`
    const bucket = this.bucket().R2Bucket
    await this.bookmarkRepo.stageBookmarkObjects(bookmarkId, version, contentKey, [contentKey, textKey])
    const writes = await Promise.allSettled([bucket.put(textKey, body.text), bucket.put(contentKey, body.html)])
    const failed = writes.find(r => r.status === 'rejected')
    if (failed?.status === 'rejected') {
      await bucket.delete([contentKey, textKey]).catch(() => {})
      throw failed.reason
    }
    const published = await this.bookmarkRepo.publishMediaBookmarkBody(bookmarkId, version, bookmark.content_key, {
      content_key: contentKey,
      content_md_key: textKey,
      content_word_count: body.text.length
    })
    if (!published) {
      await bucket.delete([contentKey, textKey])
      return false
    }
    const results = await this.searchService.addSearchRecordByBmId(ctx, bookmarkId).catch(err => [{ status: 'rejected' as const, reason: err }])
    const rejected = (results ?? []).filter(r => r.status === 'rejected')
    if (rejected.length) console.error(`Media body search index failed for bookmark ${bookmarkId}: ${rejected.length} part(s)`)
    return true
  }
}
