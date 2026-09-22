import { inject, injectable } from '@/decorators/di'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { ContextManager } from '@/utils/context'
import { BookmarkNotFoundError, ErrorParam, ServerError, ShareContentNotSupportedError } from '@/const/err'
import { hashMD5 } from '@/utils/strings'
import { BookmarkTag } from '@/domain/tag'
import { UserRepo } from '@/infra/repository/dbUser'
import { resolveBookmarkReadAccess } from '@/utils/bookmarkAccess'

export interface createBookmarkShareResp {
  share_code: string
  show_comment_line: boolean
  show_userinfo: boolean
  allow_action: boolean
}

export interface updateBookmarkShareReq {
  show_comment_line: boolean
  show_userinfo: boolean
  allow_action: boolean
  bookmark_id?: number
  bookmark_uid?: string
}

export interface getBookmarkByShareResp {
  byline: string
  content: string
  content_cover: string
  content_icon: string
  content_word_count: number
  created_at: string
  description: string
  host_url: string
  published_at: string
  site_name: string
  target_url: string
  title: string
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
  user_id: number
  tags: BookmarkTag[]
}

@injectable()
export class ShareService {
  constructor(
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo,
    @inject(UserRepo) private userRepo: UserRepo
  ) {}

  public async checkBookmarkShareExists(ctx: ContextManager, params: { bmId?: number; bmUId?: string }): Promise<createBookmarkShareResp> {
    let uuid = params.bmUId
    if (!uuid) {
      const bmId = ctx.hashIds.decodeId(params.bmId ?? 0)
      if (bmId < 1 || ctx.getUserId() < 1) throw ErrorParam()
      const relation = await this.bookmarkRepo.getUserBookmark(bmId, ctx.getUserId())
      if (!relation || relation.user_id !== ctx.getUserId()) throw BookmarkNotFoundError()
      uuid = relation.uuid
    }
    const access = await resolveBookmarkReadAccess(this.bookmarkRepo, this.userRepo, ctx.getUserId(), uuid)
    if (!access) throw BookmarkNotFoundError()
    const isOwner = access.bookmark.user_id === ctx.getUserId()
    const res = isOwner ? await this.bookmarkRepo.getBookmarkShareByBookmarkId(access.bookmark.bookmark_id, access.bookmark.user_id) : access.share
    if (!res) {
      return { allow_action: true, show_comment_line: true, show_userinfo: true, share_code: '' }
    }
    const isEnable = res.is_enable
    return {
      allow_action: isEnable ? res.allow_comment : false,
      show_comment_line: isEnable ? res.show_comment : false,
      show_userinfo: isEnable ? res.show_userinfo : false,
      share_code: isEnable ? res.share_code : ''
    }
  }

  public async deleteBookmarkShare(ctx: ContextManager, bmId: number): Promise<undefined> {
    bmId = ctx.hashIds.decodeId(bmId)
    if (bmId < 1) throw ErrorParam()

    await this.bookmarkRepo.updateBookmarkShareIsEnable(bmId, ctx.getUserId(), false)
    return
  }

  public async updateBookmarkShare(ctx: ContextManager, req: updateBookmarkShareReq): Promise<createBookmarkShareResp> {
    const userId = ctx.getUserId()

    let bmId: number
    const viaUid = !!req.bookmark_uid
    if (req.bookmark_uid) {
      const ub = await this.bookmarkRepo.getUserBookmarkByUId(req.bookmark_uid, userId)
      if (!ub) throw BookmarkNotFoundError()
      bmId = ub.bookmark_id
    } else {
      bmId = ctx.hashIds.decodeId(req.bookmark_id ?? 0)
      if (bmId < 1 || !bmId) throw ErrorParam()
    }

    const bookmark = await this.bookmarkRepo.getUserBookmark(bmId, userId)
    if (!bookmark) throw BookmarkNotFoundError()

    // 命中内容审核（色情/危险内容）的书签不支持分享
    const bmDetail = await this.bookmarkRepo.getBookmarkById(bmId)
    if (bmDetail && bmDetail.moderation_result > 0) throw ShareContentNotSupportedError()

    const share = await this.bookmarkRepo.getBookmarkShareByBookmarkId(bmId, userId)

    let res: any
    if (share && share.user_id !== userId) throw BookmarkNotFoundError()
    const updateShare = async () => {
      try {
        res = await this.bookmarkRepo.updateBookmarkShare(bmId, userId, req.show_comment_line, req.show_userinfo, req.allow_action)
      } catch (err) {
        console.log(`update bookmark share failed: ${err}`)
        // 必须抛出：之前 return 的错误对象会被丢弃，导致 res 为 undefined，下方取 res.allow_comment 抛 500
        throw BookmarkNotFoundError()
      }
    }
    const createShare = async () => {
      for (let i = 0; i < 3; i++) {
        let code = ''
        if (!viaUid) {
          const timeCode = ctx.hashIds.generateTimeCode()
          const hash = (await hashMD5(`${bmId}-${userId}-${Date.now()}`)).slice(0, 7)
          code = `${timeCode}${hash}`
        }
        const shareRes = await this.bookmarkRepo.createBookmarkShare(code, userId, bmId, req.show_comment_line, req.show_userinfo, req.allow_action)
        if (!shareRes) throw ServerError()
        res = shareRes
        return
      }
      throw ServerError()
    }
    if (share) {
      await updateShare()
    } else {
      await createShare()
    }

    return {
      allow_action: res.allow_comment,
      show_comment_line: res.show_comment,
      show_userinfo: res.show_userinfo,
      share_code: res.share_code
    }
  }

  public async getBookmarkShareByShareCode(shareCode: string) {
    const res = await this.bookmarkRepo.getBookmarkShareByShareCode(shareCode)
    if (!res || !res.is_enable) throw BookmarkNotFoundError()
    return res
  }
}
