import { inject, injectable } from '@/decorators/di'
import { BookmarkService } from '@/domain/bookmark'
import { CollectionService } from '@/domain/collection'
import { UserService } from '@/domain/user'
import { TagService } from '@/domain/tag'
import { MarkService } from '@/domain/mark'
import { ContextManager } from '@/utils/context'
import { BookmarkNotFoundError } from '@/const/err'

const EMPTY_TRACE = {
  user_info: { nick_name: '', avatar: '', show_userinfo: false },
  tags: [],
  first_comment: '',
  outline: ''
}

@injectable()
export class ContentOrchestrator {
  constructor(
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(UserService) private userService: UserService,
    @inject(TagService) private tagService: TagService,
    @inject(MarkService) private markService: MarkService,
    @inject(CollectionService) private collectionService: CollectionService
  ) {}

  private async loadBookmarkMeta(ctx: ContextManager, uuid: string) {
    const access = await this.bookmarkService.getBookmarkReadAccess(ctx, uuid)
    if (!access) throw BookmarkNotFoundError()
    const { bookmark: ub, share } = access
    const isOwner = ctx.getUserId() > 0 && ctx.getUserId() === ub.user_id
    const owner = await this.userService.getOwnerShareInfo(ub.user_id)
    const showTrace = isOwner || !share || share.show_userinfo
    const showMarks = isOwner || !share || (share.show_comment && share.show_line)
    const trace = showTrace ? await this.loadTrace(ctx, ub.bookmark_id, ub.id, ub.user_id, { nick_name: owner.nick_name, avatar: owner.avatar }, showMarks) : EMPTY_TRACE

    const { id, content_key, content_md_key, private_user, created_at, updated_at, published_at, ...bookmarkMeta } = ub.bookmark

    const base = {
      ...bookmarkMeta,
      ...trace,
      created_at: created_at.toISOString(),
      updated_at: updated_at.toISOString(),
      published_at: published_at.toISOString(),
      bookmark_uuid: ub.uuid,
      user_id: ctx.hashIds.encodeId(ub.user_id),
      content_key,
      alias_title: ub.alias_title,
      role: isOwner ? 'owner' : 'visitor'
    }

    if (!isOwner) return base

    return {
      ...base,
      archived: ub.archive_status === 1 ? 'archive' : ub.archive_status === 2 ? 'later' : 'inbox',
      starred: ub.is_starred ? 'star' : 'unstar',
      trashed_at: ub.deleted_at,
      type: ub.type === 1 ? 'shortcut' : 'article'
    }
  }

  private async loadTrace(ctx: ContextManager, bookmarkId: number, userBookmarkId: number, userId: number, owner: { nick_name: string; avatar: string }, showMarks: boolean) {
    const [tags, firstComment, outline] = await Promise.all([
      this.tagService.getBookmarkTags(ctx, userId, bookmarkId),
      showMarks ? this.markService.getFirstComment(userBookmarkId, userId) : Promise.resolve(''),
      this.bookmarkService.getBookmarkOutline(bookmarkId, userId)
    ])

    return {
      user_info: { ...owner, show_userinfo: true },
      tags,
      first_comment: (firstComment || '').slice(0, 120),
      outline: outline ?? ''
    }
  }

  public async getContentMeta(ctx: ContextManager, uuid: string, recordTiming?: (step: string, durationMs: number) => void) {
    const startedAt = performance.now()
    try {
      const meta = await this.loadBookmarkMeta(ctx, uuid)
      if (meta.role !== 'owner' && !meta.user_info.show_userinfo) return meta
      const collection = await this.collectionService.getBookmarkCollectionRef(uuid).catch(() => null)
      return collection ? { ...meta, collection } : meta
    } finally {
      recordTiming?.('orchestrator', performance.now() - startedAt)
    }
  }
}
