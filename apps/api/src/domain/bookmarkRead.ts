import { isPdfContentKey } from '@slax-reader/contracts/pdf'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { BucketClient } from '@/infra/repository/bucketClient'
import { UserRepo } from '@/infra/repository/dbUser'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { ContextManager } from '@/utils/context'
import { ErrorParam, BookmarkContentNotFoundError, PdfTextUnavailableError, BookmarkNotFoundError } from '@/const/err'
import { MultiLangError } from '@/utils/multiLangError'
import { resolveBookmarkReadAccess } from '@/utils/bookmarkAccess'
import { snapshotKeys, snapshotText } from '@/utils/snapshotBundle'
import { MediaSnapshotService } from './mediaSnapshot'

export type BookmarkReference = {
  bmId?: number
  shareCode?: string
  cbId?: number
  collectionCode?: string
  bmUId?: string
  uBmId?: string
}

// Bookmark reads and AI-artifact persistence that need no capture, import or Fork machinery.
// BookmarkService extends this class, so the AI Worker can depend on it without the capture graph.
@injectable()
export class BookmarkReadService {
  constructor(
    @inject(BookmarkRepo) protected bookmarkRepo: BookmarkRepo,
    @inject(BucketClient) protected bucket: LazyInstance<BucketClient>,
    @inject(UserRepo) protected userRepo: UserRepo,
    @inject(MediaSnapshotService) protected snapshots: MediaSnapshotService
  ) {}

  public async getBookmarkReadAccess(ctx: ContextManager, uuid: string, recordTiming?: (step: string, durationMs: number) => void) {
    const access = await resolveBookmarkReadAccess(this.bookmarkRepo, this.userRepo, ctx.getUserId(), uuid, recordTiming)
    if (access) {
      const startedAt = performance.now()
      const allowed = await this.snapshots.allowsBody(access.bookmark.bookmark_id)
      recordTiming?.('access-media', performance.now() - startedAt)
      if (!allowed) return null
    }
    return access
  }

  public async getBookmarkId(ctx: ContextManager, params: BookmarkReference) {
    const { bmId, shareCode, cbId, collectionCode, bmUId, uBmId } = params
    const userId = ctx.getUserId()
    if (bmId) {
      if (userId < 1) return 0
      const bookmark = await this.bookmarkRepo.getUserBookmarkWithDetail(ctx.hashIds.decodeId(bmId), userId)
      if (!bookmark?.bookmark || (bookmark.bookmark.private_user > 0 && bookmark.bookmark.private_user !== userId)) return 0
      return bookmark.bookmark_id
    }

    if (shareCode) {
      const share = await this.bookmarkRepo.getBookmarkShareByShareCode(shareCode)
      if (!share) return 0
      const bookmark = await this.bookmarkRepo.getUserBookmark(share.bookmark_id, share.user_id)
      if (!bookmark) return 0
      const access = await this.getBookmarkReadAccess(ctx, bookmark.uuid)
      return access?.bookmark.bookmark_id ?? 0
    }
    if (cbId) {
      if (!collectionCode) return 0
      const bookmark = await this.bookmarkRepo.getCollectionBookmarkById(ctx.hashIds.decodeId(cbId), collectionCode, userId)
      if (!bookmark) return 0
      const access = await this.getBookmarkReadAccess(ctx, bookmark.uuid)
      return access?.bookmark.bookmark_id ?? 0
    }

    const uuid = bmUId || uBmId
    if (uuid && userId > 0) {
      const bookmark = await this.bookmarkRepo.getUserBookmarkByUId(uuid, userId)
      if (!bookmark?.bookmark || (bookmark.bookmark.private_user > 0 && bookmark.bookmark.private_user !== userId)) return 0
      return bookmark.bookmark_id
    }

    return 0
  }

  public async getBookmarkById(bmId: number) {
    return await this.bookmarkRepo.getBookmarkById(bmId)
  }

  public async getUserBookmark(bmId: number, userId: number) {
    return await this.bookmarkRepo.getUserBookmark(bmId, userId)
  }

  public async getBookmarkContent(bmKey: string) {
    if (!bmKey || isPdfContentKey(bmKey)) return
    const target = await this.bucket().R2Bucket.get(bmKey)
    if (target) {
      const content = await target.text()
      const snapshot = !content && /^text\/body\/([^/]+)\.txt$/.exec(bmKey)
      if (snapshot) {
        const html = await this.bucket().R2Bucket.get(snapshotKeys(snapshot[1]).content_key)
        if (html) return snapshotText(await html.text())
      }
      return content
    }
    throw new Error('Stored bookmark content is unavailable')
  }

  public async getBookmarkTitleContent(
    ctx: ContextManager,
    params: {
      bmId?: number
      shareCode?: string
      cbId?: number
      collectionCode?: string
      title?: string
      content?: string
      bmUId?: string
    }
  ): Promise<{
    title: string
    content: string
    bmId: number
    targetUrl: string
    moderationResult: number
  }> {
    const { bmId, shareCode, cbId, collectionCode, title, content, bmUId } = params

    const emptyId = !bmId && !shareCode && !cbId && !bmUId
    if (emptyId && !title && !content) throw ErrorParam()
    if (emptyId && title && content) {
      return { title, content, bmId: 0, targetUrl: '', moderationResult: 0 }
    }

    const bookmarkId = await this.getBookmarkId(ctx, { bmId, shareCode, cbId, collectionCode, bmUId })
    if (!bookmarkId || bookmarkId < 1) throw ErrorParam()

    const bookmark = await this.getBookmarkById(bookmarkId)
    if (bookmark && !(bookmark instanceof MultiLangError) && isPdfContentKey(bookmark.content_key) && !bookmark.content_md_key) throw PdfTextUnavailableError()
    if (!bookmark || bookmark instanceof MultiLangError || !bookmark.content_md_key) {
      throw BookmarkNotFoundError()
    }

    const body = await this.getBookmarkContent(bookmark.content_md_key)

    if (!body) throw BookmarkContentNotFoundError()

    return { title: bookmark.title, content: body, bmId: bookmarkId, targetUrl: bookmark.target_url, moderationResult: bookmark.moderation_result }
  }

  public async getUserBookmarkSummary(ctx: ContextManager, params: Omit<BookmarkReference, 'uBmId'>) {
    const bookmarkId = await this.getBookmarkId(ctx, params)
    if (!bookmarkId || bookmarkId < 1) throw ErrorParam()

    return await this.bookmarkRepo.getUserBookmarkSummary(bookmarkId, ctx.getUserId(), ctx.get('ai_lang'))
  }

  public async getBookmarkOutline(bookmarkId: number, userId: number): Promise<string | null> {
    const summary = await this.bookmarkRepo.getBookmarkOutline(bookmarkId, userId)
    return summary?.content.trim() ? summary.content : null
  }

  async saveSummary(ctx: ContextManager, bmId: number, provider: string, content: string, model: string) {
    const info = { content: content, ai_name: provider || '', ai_model: model || '', bookmark_id: bmId, user_id: ctx.getUserId(), lang: ctx.get('ai_lang') }
    await this.bookmarkRepo.upsertBookmarkSummary(info)
  }

  public async createBookmarkOverview(userId: number, bookmarkId: number, overview: string, content: string) {
    return await this.bookmarkRepo.createBookmarkOverview(userId, bookmarkId, overview, content)
  }

  public async getUserBookmarkOverview(userId: number, bookmarkId: number) {
    return await this.bookmarkRepo.getUserBookmarkOverview(userId, bookmarkId)
  }

  public async getUserBookmarkBatchTasks(userId: number, bookmarkId: number, taskType: string) {
    return this.bookmarkRepo.getUserBookmarkBatchTasks(userId, bookmarkId, taskType)
  }
}
