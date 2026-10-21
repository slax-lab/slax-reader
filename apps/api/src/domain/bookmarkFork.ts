import { randomUUID } from 'crypto'
import { isPdfContentKey } from '@slax-reader/contracts/pdf'
import type { BookmarkForkInfo, BookmarkForkRequest, BookmarkForkResponse } from '@slax-reader/contracts'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { BookmarkService } from '@/domain/bookmark'
import { BookmarkForkRepo, type ForkOperation } from '@/infra/repository/dbBookmarkFork'
import { BucketClient } from '@/infra/repository/bucketClient'
import { UserRepo } from '@/infra/repository/dbUser'
import { ContextManager } from '@/utils/context'
import { Hashid } from '@/utils/hashids'
import { BookmarkContentNotFoundError, BookmarkNotFoundError, ErrorParam, BookmarkWriteConflictError } from '@/const/err'
import { queueStatus } from '@/infra/repository/dbBookmark'
import { BookmarkSearchRepo } from '@/infra/repository/dbBookmarkSearch'
import { VectorizeRepo } from '@/infra/repository/dbVectorize'

export type { BookmarkForkResponse } from '@slax-reader/contracts'

@injectable()
export class BookmarkForkService {
  constructor(
    @inject(BookmarkForkRepo) private forkRepo: BookmarkForkRepo,
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(BucketClient) private bucket: LazyInstance<BucketClient>,
    @inject(UserRepo) private userRepo: UserRepo,
    @inject(BookmarkSearchRepo) private bookmarkSearchRepo: BookmarkSearchRepo,
    @inject(VectorizeRepo) private dbVectorize: VectorizeRepo
  ) {}

  public async fork(ctx: ContextManager, request: BookmarkForkRequest, idempotencyKey?: string, preferredBookmarkUid?: string): Promise<BookmarkForkResponse> {
    const userId = ctx.getUserId()
    if (!Number.isSafeInteger(userId) || userId < 1 || typeof request?.bookmark_uid !== 'string' || !request.bookmark_uid) throw ErrorParam()
    if (idempotencyKey && !/^[A-Za-z0-9_:-]{1,200}$/.test(idempotencyKey)) throw ErrorParam()
    const requestKey = idempotencyKey || randomUUID()
    const prior = await this.forkRepo.findOperation(userId, requestKey)
    if (prior) {
      if (prior.source_uuid !== request.bookmark_uid) throw ErrorParam()
      if (prior.result) return prior.result as unknown as BookmarkForkResponse
      if (!['failed', 'abandoned'].includes(prior.status)) throw BookmarkWriteConflictError()
    }

    const access = await this.bookmarkService.getBookmarkReadAccess(ctx, request.bookmark_uid)
    if (!access) throw BookmarkNotFoundError()
    const source = access.bookmark
    const article = source.bookmark
    if (source.deleted_at || source.type === 1 || article.status !== queueStatus.SUCCESS || article.moderation_result > 0 || !article.content_key || !article.content_md_key)
      throw BookmarkContentNotFoundError()
    const ownSource = source.user_id === userId
    const pdf = isPdfContentKey(article.content_key)
    let documentId: string | undefined
    if (pdf) {
      const metaKey = article.content_key.replace('pdf/body/', 'pdf/meta/').replace(/\.pdf$/, '.json')
      const metadata = await this.bucket().R2Bucket.get(metaKey)
      let state: { text_status: string; pages: number } | null = null
      try {
        const value = metadata ? await metadata.json<unknown>() : null
        if (value && typeof value === 'object') state = value as { text_status: string; pages: number }
      } catch {
        state = null
      }
      if (!state || state.text_status !== 'ready') throw BookmarkContentNotFoundError()
      const body = await this.bucket().R2Bucket.head(article.content_key)
      documentId = body?.customMetadata?.sha256
    }

    const showUserInfo = !ownSource && (!access.share || access.share.show_userinfo !== false)
    const owner = showUserInfo ? await this.userRepo.getInfoByUserId(source.user_id) : null
    const forkInfo: BookmarkForkInfo | null = ownSource
      ? null
      : {
          bookmark_uid: source.uuid,
          display_name: showUserInfo ? owner?.name || null : null,
          user_id: showUserInfo ? ctx.hashIds.encodeId(source.user_id) : null
        }
    // Preserve the complete stored URL identity. The URL may be used to find the
    // source bytes, but normalization or user scoping here would make a Fork
    // miss the same-URL overwrite target and would change the visible source.
    const operation = await this.forkRepo.begin(userId, requestKey, source.uuid, { ...article }, pdf ? 2 : 0, preferredBookmarkUid)
    if (operation.result) return operation.result as unknown as BookmarkForkResponse
    const keys = this.destinationKeys(operation.target_uuid, operation.write_version, operation.attempt_token, article.content_key, article.content_md_key)
    const stagedKeys = keys.entries.map(entry => entry.destinationKey)
    const response: BookmarkForkResponse = {
      bookmark_uid: operation.target_uuid,
      bookmark_id: ctx.hashIds.encodeId(operation.target_bookmark_id),
      write_mode: operation.write_mode === 'created' ? 'created' : 'overwritten',
      fork_info: forkInfo
    }
    let published = false
    try {
      await this.forkRepo.setStagedKeys(operation.id, operation.attempt_token, stagedKeys)
      await this.bucket().copyObjects(keys.entries)
      published = await this.forkRepo.publish(
        operation,
        {
          title: article.title,
          content_icon: article.content_icon,
          content_cover: article.content_cover,
          content_key: keys.contentKey,
          content_md_key: keys.textKey,
          content_word_count: article.content_word_count,
          description: article.description,
          byline: article.byline,
          status: queueStatus.SUCCESS,
          published_at: article.published_at,
          site_name: article.site_name
        },
        ownSource
          ? null
          : {
              source_bookmark_id: source.bookmark_id,
              target_user_id: userId,
              source_user_id: source.user_id,
              source_uuid: source.uuid,
              source_url: article.target_url,
              display_name: forkInfo?.display_name,
              show_userinfo: showUserInfo
            },
        response,
        { type: pdf ? 2 : 0, documentId }
      )
      if (!published) throw BookmarkWriteConflictError()
    } catch (error) {
      // A thrown database response can be ambiguous: check the durable operation before cleanup.
      const committed = await this.forkRepo.findOperation(userId, requestKey)
      if (committed?.result) return committed.result as unknown as BookmarkForkResponse
      await this.forkRepo.fail(operation.id, operation.attempt_token, error instanceof Error ? error.name : 'copy_failed')
      try {
        // A newly created target has no committed body, so make a failed Fork
        // visible as failed instead of letting the generic stuck-crawl rescue
        // treat it as an ordinary URL save. The conditional repository update
        // preserves an existing readable body on overwrite targets.
        await this.bookmarkService.updateBookmarkVersionStatus(operation.target_bookmark_id, operation.write_version, queueStatus.FAILED)
      } catch (statusError) {
        console.error(`Failed to mark Fork target ${operation.target_bookmark_id} as failed: ${statusError instanceof Error ? statusError.message : String(statusError)}`)
      }
      await this.bucket().deleteObjects(stagedKeys)
      throw error
    }
    await this.finishPublication(ctx, operation)
    return response
  }

  private async finishPublication(ctx: ContextManager, operation: ForkOperation) {
    try {
      if (ctx.getUserId() !== operation.user_id || !ctx.hashIds) {
        const userContext = new ContextManager(ctx.execution, ctx.env)
        userContext.setUserInfo(operation.user_id, new Hashid(ctx.env).encodeId(operation.user_id), '', 'en')
        userContext.setHashIds(new Hashid(ctx.env, operation.user_id))
        ctx = userContext
      }
      await this.bookmarkService.refreshBookmarkPublication(ctx, operation.target_bookmark_id, operation.user_id)
      await this.forkRepo.complete(operation.id, operation.attempt_token)
    } catch (error) {
      await this.forkRepo.touchIndexing(operation.id, operation.attempt_token).catch(touchError => {
        console.error(`Failed to rotate Fork publication retry ${operation.id}: ${touchError instanceof Error ? touchError.message : String(touchError)}`)
      })
      console.error(`Fork publication side effects pending for operation ${operation.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  public async repairPending(ctx: ContextManager) {
    for (const operation of await this.forkRepo.listPending()) {
      if (operation.status === 'indexing') {
        await this.finishPublication(ctx, operation)
      } else {
        const cleanupToken = await this.forkRepo.claimCleanup(operation)
        if (!cleanupToken) continue
        try {
          await this.bucket().deleteObjects(operation.staged_keys)
          await this.forkRepo.fail(operation.id, operation.attempt_token, 'abandoned_copy', true, cleanupToken)
        } catch (error) {
          console.error(`Fork object cleanup failed for operation ${operation.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    for (const stage of await this.forkRepo.claimStaleStages()) {
      const token = stage.cleanup_token
      try {
        // Account deletion removes the bookmark row before external search/vector
        // stores can be cleaned. The stage remains as a durable retry marker.
        const bookmark = await this.bookmarkService.getBookmarkById(stage.bookmark_id).catch(() => null)
        if (!bookmark) {
          await this.bookmarkSearchRepo.deleteBookmarkRaw(stage.bookmark_id)
          const bucketIdx = await this.forkRepo.getVectorBucket(stage.bookmark_id)
          if (bucketIdx !== null) {
            await this.dbVectorize.deleteVector(stage.bookmark_id, bucketIdx)
            await this.forkRepo.deleteVectorShard(stage.bookmark_id)
          }
        }
        const unreferencedKeys = await this.forkRepo.getUnreferencedStageKeys(stage.keys)
        await this.bucket().deleteObjects(unreferencedKeys)
        await this.forkRepo.completeStageCleanup(stage.id, token, 'deleted')
      } catch (error) {
        await this.forkRepo.completeStageCleanup(stage.id, token, 'cleaning').catch(() => {})
        console.error(`Bookmark object stage cleanup failed for ${stage.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private destinationKeys(uuid: string, version: number, attemptToken: string, sourceKey: string, sourceTextKey: string) {
    const suffix = `${uuid}.v${version}.${attemptToken}`
    const textKey = `text/body/fork/${suffix}.txt`
    if (isPdfContentKey(sourceKey)) {
      const contentKey = `pdf/body/fork/${suffix}.pdf`
      const metaKey = contentKey.replace('pdf/body/', 'pdf/meta/').replace(/\.pdf$/, '.json')
      const sourceMeta = sourceKey.replace('pdf/body/', 'pdf/meta/').replace(/\.pdf$/, '.json')
      return {
        contentKey,
        textKey,
        entries: [
          { sourceKey, destinationKey: contentKey },
          { sourceKey: sourceMeta, destinationKey: metaKey },
          { sourceKey: sourceTextKey, destinationKey: textKey }
        ]
      }
    }
    const contentKey = `html/body/fork/${suffix}.html`
    return {
      contentKey,
      textKey,
      entries: [
        { sourceKey, destinationKey: contentKey },
        { sourceKey: sourceTextKey, destinationKey: textKey }
      ]
    }
  }
}
