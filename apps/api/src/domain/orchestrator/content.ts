import { bookmarkContentType, isPdfContentKey } from '@slax-reader/contracts/pdf'
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

    const bookmark = ub.bookmark
    const pdf = await this.bookmarkService.getPdfDescriptor(bookmark.content_key, ub.uuid)
    const forkInfo = await this.bookmarkService.getForkInfo(ub.bookmark_id, ctx, bookmark.published_version)
    const fork_info = forkInfo
      ? {
          bookmark_uid: forkInfo.bookmark_uid,
          ...(forkInfo.display_name !== undefined ? { display_name: forkInfo.display_name } : {}),
          ...(forkInfo.user_id !== undefined ? { user_id: forkInfo.user_id } : {})
        }
      : null

    // Explicit fields keep database publication versions and internal metadata out
    // of the response as the storage schema evolves.
    const base = {
      uuid: bookmark.uuid,
      title: bookmark.title,
      host_url: bookmark.host_url,
      target_url: bookmark.target_url,
      site_name: bookmark.site_name,
      content_icon: bookmark.content_icon,
      content_cover: bookmark.content_cover,
      content_word_count: bookmark.content_word_count,
      description: bookmark.description,
      byline: bookmark.byline,
      status: bookmark.status,
      ...trace,
      created_at: bookmark.created_at.toISOString(),
      updated_at: bookmark.updated_at.toISOString(),
      published_at: bookmark.published_at.toISOString(),
      bookmark_uuid: ub.uuid,
      user_id: ctx.hashIds.encodeId(ub.user_id),
      content_key: bookmark.content_key,
      can_fork:
        !isOwner &&
        ub.type !== 1 &&
        bookmark.status === 'success' &&
        !!bookmark.content_key &&
        !!bookmark.content_md_key &&
        (!isPdfContentKey(bookmark.content_key) || pdf?.text_status === 'ready'),
      fork_info,
      type: bookmarkContentType(ub.type),
      pdf,
      alias_title: ub.alias_title,
      role: isOwner ? 'owner' : 'visitor'
    }

    if (!isOwner) return base

    return {
      ...base,
      archived: ub.archive_status === 1 ? 'archive' : ub.archive_status === 2 ? 'later' : 'inbox',
      starred: ub.is_starred ? 'star' : 'unstar',
      trashed_at: ub.deleted_at,
      type: bookmarkContentType(ub.type)
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
