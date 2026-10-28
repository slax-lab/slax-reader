import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { BucketClient } from '@/infra/repository/bucketClient'
import { NewsletterSaveRepo, type NewsletterSaved } from '@/infra/repository/dbNewsletterSave'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { BookmarkSearchRepo } from '@/infra/repository/dbBookmarkSearch'
import { SearchService } from '@/domain/search'
import { NotificationMessage } from '@/infra/message/notification'
import { ContextManager } from '@/utils/context'
import { SnapshotBundle } from '@/utils/snapshotBundle'
import { NewsletterError } from './parser'
import type { FeedSaveResponse } from '@slax-reader/contracts'
@injectable()
export class NewsletterSaveService {
  constructor(
    @inject(NewsletterSaveRepo) private repo: NewsletterSaveRepo,
    @inject(BucketClient) private bucket: LazyInstance<BucketClient>,
    @inject(SearchService) private search: SearchService,
    @inject(BookmarkSearchRepo) private searchRepo: BookmarkSearchRepo,
    @inject(BookmarkRepo) private bookmarks: BookmarkRepo,
    @inject(NotificationMessage) private notifications: NotificationMessage
  ) {}
  async save(ctx: ContextManager, id: bigint): Promise<FeedSaveResponse> {
    const userId = ctx.getUserId()
    if (!userId) throw new NewsletterError('not_found', 401)
    const source = await this.repo.source(userId, id),
      hint = await this.repo.existing(userId, id)
    let bundle: SnapshotBundle | undefined,
      publishing = false,
      result: Awaited<ReturnType<NewsletterSaveRepo['publish']>>
    try {
      if (hint) {
        if (
          hint.status !== 'success' ||
          !hint.content_key ||
          !hint.content_md_key ||
          !(await this.bucket().R2Bucket.head(hint.content_key)) ||
          !(await this.bucket().R2Bucket.head(hint.content_md_key))
        )
          throw new NewsletterError('unavailable', 503)
        publishing = true
        result = await this.repo.publish(userId, id, source.content_key!, undefined, hint)
      } else {
        const uuid = crypto.randomUUID()
        bundle = new SnapshotBundle(this.bucket().R2Bucket, uuid, crypto.randomUUID(), { deleteNewObjectsOnDiscard: true })
        const content = await bundle.copyHtml(source.content_key!)
        await bundle.write('media.json', JSON.stringify({ schema: 1, kind: 'html' }), 'application/json')
        await bundle.assertUnchanged()
        publishing = true
        result = await this.repo.publish(userId, id, source.content_key!, { uuid, ...content })
        if (result.relation.content_key !== content.content_key) await bundle.discard()
      }
    } catch (error) {
      if (!publishing || error instanceof NewsletterError) await bundle?.discard().catch(() => {})
      else {
        // A disconnected COMMIT may have succeeded; never delete uncertain destination keys.
        const existing = await this.repo.existing(userId, id).catch(() => null)
        if (existing && existing.status === 'success' && !existing.deleted_at && (!bundle || existing.content_key === `html/body/${bundle.uuid}.html`)) {
          await this.effects(ctx, existing, bundle ? 'created' : hint?.deleted_at ? 'restored' : 'already_saved')
          return { bookmark_user_uuid: existing.uuid, result: bundle ? 'created' : 'already_saved', processing_status: 'ready' }
        }
      }
      throw new NewsletterError(error instanceof NewsletterError ? error.code : 'unavailable', error instanceof NewsletterError ? error.status : 503)
    }
    await this.effects(ctx, result.relation, result.result)
    return { bookmark_user_uuid: result.relation.uuid, result: result.result, processing_status: 'ready' }
  }
  private async effects(ctx: ContextManager, row: NewsletterSaved, result: FeedSaveResponse['result']) {
    const tasks: Promise<unknown>[] = [
      (async () => {
        await this.searchRepo.upsertUserBookmark(ctx.getUserId(), row.bookmark_id)
        const text = await (await this.bucket().R2Bucket.get(row.content_md_key))?.text()
        if (text === undefined) throw new Error('Private snapshot text unavailable')
        const outcomes = await this.search.addSearchRecord(ctx, row.bookmark_id, row.title, text, { strictPrivate: true })
        if (outcomes.some(item => item.status === 'rejected')) throw new Error('Private snapshot indexing incomplete')
      })(),
      this.search.clearSearchCache(ctx, ctx.getUserId())
    ]
    if (result !== 'already_saved') {
      const changedAt = new Date()
      tasks.push(
        this.bookmarks.createBookmarkChangeLog(ctx.getUserId(), row.target_url, row.bookmark_id, 'add', changedAt),
        this.notifications.sendBookmarkChange(ctx.env, {
          user_id: ctx.getUserId(),
          bookmark_id: ctx.hashIds.encodeId(row.bookmark_id),
          target_url: row.target_url,
          action: 'add',
          created_at: changedAt
        })
      )
    }
    const outcomes = await Promise.allSettled(tasks)
    if (outcomes.some(item => item.status === 'rejected')) console.error('Newsletter copy committed; indexing or notification incomplete', { bookmarkId: row.bookmark_id })
  }
}
