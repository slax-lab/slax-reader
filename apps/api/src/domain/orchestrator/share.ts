import { inject, injectable } from '@/decorators/di'
import { ShareService, getBookmarkByShareResp } from '@/domain/share'
import { BookmarkService, markDetail } from '@/domain/bookmark'
import { ContextManager } from '@/utils/context'
import { UserService } from '@/domain/user'
import { TagService } from '@/domain/tag'
import { MarkService } from '@/domain/mark'
import { BookmarkNotFoundError } from '@/const/err'

export interface getInlineShareDetailResp {
  title: string
  target_url: string
  share_info: {
    need_login: boolean
    created_at: string
    allow_action: boolean
    share_code: string
  }
  user_info: {
    nick_name: string
    avatar: string
    show_userinfo: boolean
  }
  marks: markDetail
  owner_user_id: number
}

@injectable()
export class ShareOrchestrator {
  constructor(
    @inject(ShareService) private shareService: ShareService,
    @inject(UserService) private userService: UserService,
    @inject(TagService) private tagService: TagService,
    @inject(MarkService) private markService: MarkService,
    @inject(BookmarkService) private bookmarkService: BookmarkService
  ) {}

  private async resolveShareAccess(ctx: ContextManager, shareCode: string) {
    const share = await this.shareService.getBookmarkShareByShareCode(shareCode)
    const relation = await this.bookmarkService.getUserBookmark(share.bookmark_id, share.user_id)
    if (!relation) throw BookmarkNotFoundError()
    const access = await this.bookmarkService.getBookmarkReadAccess(ctx, relation.uuid)
    if (!access || access.bookmark.user_id !== share.user_id || access.bookmark.bookmark_id !== share.bookmark_id) throw BookmarkNotFoundError()
    return { share, userBm: access.bookmark, bookmark: access.bookmark.bookmark }
  }

  public async getInlineShareDetail(ctx: ContextManager, shareCode: string): Promise<getInlineShareDetailResp> {
    const { share, userBm, bookmark } = await this.resolveShareAccess(ctx, shareCode)
    const [userInfo, marks] = await Promise.all([
      this.userService.getUserBriefInfo(share.show_userinfo, share.user_id),
      this.markService.getBookmarkMarkList(ctx, { id: userBm.id, isShowMarks: share.show_comment && share.show_line })
    ])

    return {
      title: bookmark.title,
      target_url: bookmark.target_url,
      share_info: {
        need_login: ctx.getUserId() < 1,
        created_at: share.created_at.toISOString(),
        allow_action: share.allow_comment,
        share_code: share.share_code
      },
      owner_user_id: ctx.hashIds.encodeId(share.user_id),
      user_info: {
        ...userInfo,
        show_userinfo: share.show_userinfo
      },
      marks: share.show_userinfo ? marks : { ...marks, user_list: {} }
    }
  }

  public async getBookmarkByShareCode(ctx: ContextManager, shareCode: string): Promise<getBookmarkByShareResp> {
    const { share, bookmark } = await this.resolveShareAccess(ctx, shareCode)
    const [userInfo, tags] = await Promise.all([
      this.userService.getUserBriefInfo(share.show_userinfo, share.user_id),
      share.show_userinfo ? this.tagService.getBookmarkTags(ctx, share.user_id, share.bookmark_id) : Promise.resolve([])
    ])

    const bmContent = await this.bookmarkService.getBookmarkContent(bookmark.content_key)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, private_user, status, content_key, content_md_key, ...restProps } = bookmark

    return {
      ...restProps,
      content: bmContent || '',
      created_at: bookmark.created_at.toISOString(),
      published_at: bookmark.published_at.toISOString(),
      share_info: {
        need_login: ctx.getUserId() < 1,
        allow_action: share.allow_comment,
        created_at: share.created_at.toISOString(),
        share_code: share.share_code
      },
      user_info: {
        ...userInfo,
        show_userinfo: share.show_userinfo
      },
      user_id: ctx.hashIds.encodeId(share.user_id),
      tags
    }
  }

  public async getBookmarkShareMarkList(ctx: ContextManager, shareCode: string): Promise<markDetail> {
    const { share, userBm } = await this.resolveShareAccess(ctx, shareCode)
    const marks = await this.markService.getBookmarkMarkList(ctx, { id: userBm.id, isShowMarks: share.show_comment && share.show_line })
    return share.show_userinfo ? marks : { ...marks, user_list: {} }
  }

  public async getBookmarkShareMarkListByUid(ctx: ContextManager, bmUId: string): Promise<markDetail> {
    const empty = { mark_list: [], user_list: [] }
    const access = await this.bookmarkService.getBookmarkReadAccess(ctx, bmUId)
    if (!access) return empty
    const { bookmark: ub, share } = access
    if (ub.user_id !== ctx.getUserId() && share && (!share.allow_comment || !share.allow_line || !share.show_comment || !share.show_line)) return empty

    const marks = await this.markService.getBookmarkMarkList(ctx, { id: ub.id, isShowMarks: true })
    return ub.user_id === ctx.getUserId() || !share || share.show_userinfo !== false ? marks : { ...marks, user_list: {} }
  }
}
