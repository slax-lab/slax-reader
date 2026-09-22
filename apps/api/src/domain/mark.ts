import type {
  CreateMarkRequest as markRequest,
  MarkSelectContent as markSelectContent,
  MarkInfo as MarkInfoContract,
  MarkUserInfo as markUserInfo,
  MarkCommentItem as MarkCommentItemContract
} from '@slax-reader/contracts'
import { inject, injectable } from '@/decorators/di'
import {
  BookmarkNotFoundError,
  CommentTooLongError,
  ErrorMarkCommentTypeError,
  ErrorParam,
  ServerError,
  ShareActionNotAllowedError,
  ShareCollectionNotAllowedError,
  ShareCollectionNotFoundError,
  MarkLineTooLongError,
  ShareCodeNotFoundError,
  ShareDisabledError
} from '@/const/err'
import { markDetailPO, MarkRepo, markType } from '@/infra/repository/dbMark'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { CollectionRepo } from '@/infra/repository/dbCollection'
import { UserRepo } from '@/infra/repository/dbUser'
import { ContextManager } from '@/utils/context'
import { resolveCollectionPolicy } from '@/utils/collectionPolicy'
import { resolveBookmarkReadAccess } from '@/utils/bookmarkAccess'
import { submitServerEvent } from '@/domain/events'

export type { MarkPathItem as markPathItem } from '@slax-reader/contracts'
export type { CreateMarkRequest as markRequest } from '@slax-reader/contracts'
export type { MarkApproxSource as markApproxSource } from '@slax-reader/contracts'
export type { MarkSelectContent as markSelectContent } from '@slax-reader/contracts'
export type markInfo = MarkInfoContract<Date>
export type { MarkUserInfo as markUserInfo } from '@slax-reader/contracts'
export type markCommentItem = MarkCommentItemContract<Date>

export interface markResponse {
  id: number
  root_id: number
  uuid: string
  root_uid?: string
}

export type markIdParams = { uuid: string } | { id: number }

export interface markMetadata {
  root_id?: string | null
  parent_id?: string | null
  user_id?: string
  source_id?: string
  bookmark_id?: string
}

@injectable()
export class MarkService {
  private bmDataRepo: BookmarkRepo
  private markDataRepo: MarkRepo
  private userDataRepo: UserRepo

  constructor(
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo,
    @inject(MarkRepo) private markRepo: MarkRepo,
    @inject(CollectionRepo) private collectionRepo: CollectionRepo,
    @inject(UserRepo) private userRepo: UserRepo
  ) {
    this.bmDataRepo = bookmarkRepo
    this.markDataRepo = markRepo
    this.userDataRepo = userRepo
  }

  public async getFirstComment(bmId: number, userId: number): Promise<string> {
    return await this.markRepo.getFirstComment(bmId, userId)
  }

  assertBookmarkShareCode = async (ctx: ContextManager, shareCode: string) => {
    const res = await this.bookmarkRepo.getBookmarkShareByShareCode(shareCode)
    if (!res) throw ShareCodeNotFoundError()
    // 分享关闭
    if (!res.is_enable) throw ShareDisabledError()
    // 开启评论跟划线权限
    if (res.allow_comment && res.allow_line) return res
    // 没开启评论跟划线权限，且不是本人
    if (!res.allow_comment && !res.allow_line && ctx.getUserId() !== res.user_id) throw ShareActionNotAllowedError()

    return res
  }

  protected resolveMark = async (params: markIdParams) => {
    if ('uuid' in params) {
      const mark = await this.markRepo.getByUuid(params.uuid)
      if (!mark) throw ErrorParam()
      return mark
    }
    const mark = await this.markRepo.get(params.id)
    if (!mark) throw ErrorParam()
    return mark
  }

  assertMarkBookmark = async (ctx: ContextManager, bmId: number, params: markIdParams) => {
    const mark = await this.resolveMark(params)
    if (mark.user_bookmark_id !== bmId) throw ShareActionNotAllowedError()
    if (mark.is_deleted) throw ShareActionNotAllowedError()
    return mark
  }

  assertMarkData = async (data: markRequest) => {
    if (data.type === markType.REPLY || typeof data.source === 'number') return

    // 检查单次划线不超过1000个字符+3张图片
    let sourceLength = 0
    let sourceImageCount = 0
    data.source.forEach(item => {
      if (item.type === 'image') sourceImageCount++
      else sourceLength += item.end_offset - item.start_offet
    })
    if (sourceLength > 1000 || sourceImageCount > 3) throw MarkLineTooLongError()
    // 检查评论不能为空或者超过1500个字符
    if (data.comment && data.comment.length > 1500) throw CommentTooLongError()
  }

  private async deleteResolvedMark(ctx: ContextManager, params: markIdParams): Promise<string> {
    const mark = await this.resolveMark(params)
    if (mark.is_deleted) throw ErrorParam()

    const userId = ctx.getUserId()
    if (mark.user_id !== userId) {
      const ubm = await this.bookmarkRepo.getUserBookmarkById(mark.user_bookmark_id)
      if (!ubm || ubm.user_id !== userId) throw ShareActionNotAllowedError()
    }

    const isComment = [markType.COMMENT, markType.ORIGIN_COMMENT, markType.REPLY].includes(mark.type)

    if (isComment) {
      const childCount = mark.root_uid
        ? await this.markRepo.existsCommentMarkChildByRootUid(mark.user_bookmark_id, mark.root_uid)
        : await this.markRepo.existsCommentMarkChild(mark.user_bookmark_id, mark.root_id)
      if (childCount && childCount > 1) {
        await this.softDeleteMark(mark)
        return 'ok'
      }
    }

    try {
      if (isComment) {
        await this.hardDeleteComment(mark)
      } else {
        await this.hardDeleteLine(mark)
      }
    } catch (e) {
      console.error(`delete mark failed: ${e}`)
      throw ServerError()
    }

    return 'ok'
  }

  private async softDeleteMark(mark: markDetailPO) {
    if (mark.uuid) {
      await this.markRepo.updateCommentMarkDeletedByUid(mark.uuid)
    } else {
      await this.markRepo.updateCommentMarkDeleted(mark.id)
    }
  }

  private async hardDeleteComment(mark: markDetailPO) {
    if (mark.root_uid) {
      await this.markRepo.deleteByRootUid(mark.user_bookmark_id, mark.root_uid)
    } else {
      await this.markRepo.deleteByRootId(mark.user_bookmark_id, mark.root_id)
    }
  }

  private async hardDeleteLine(mark: markDetailPO) {
    if (mark.uuid) {
      await this.markRepo.delByUid(mark.uuid)
    } else {
      await this.markRepo.del(mark.id)
    }
  }

  public async getBookmarkMarkList(ctx: ContextManager, params: markIdParams & { isShowMarks: boolean }) {
    const defaultResult = { mark_list: [], user_list: [] }
    if (!params.isShowMarks) return defaultResult

    let userBmId: number | undefined
    if ('uuid' in params) {
      const ub = await this.bookmarkRepo.getUserBookmarkByUuid(params.uuid)
      if (!ub) return defaultResult
      userBmId = ub.id
    } else {
      userBmId = params.id
    }
    if (!userBmId) return defaultResult

    const marks = await this.markRepo.list(userBmId)
    if (marks.length === 0) return defaultResult

    const users = await this.userRepo.getUserInfoList(marks.map(m => m.user_id))
    const markList: markInfo[] = marks.map(m => {
      return {
        id: ctx.hashIds.encodeId(m.id),
        user_id: ctx.hashIds.encodeId(m.user_id),
        type: m.type,
        source: m.source,
        comment: m.comment,
        parent_id: ctx.hashIds.encodeId(m.parent_id),
        root_id: ctx.hashIds.encodeId(m.root_id),
        created_at: m.created_at,
        is_deleted: m.is_deleted,
        approx_source: m.approx_source,
        uuid: m.uuid,
        parent_uid: m.parent_uid,
        root_uid: m.root_uid
      }
    })
    const userMap: Record<number, markUserInfo> = {
      [ctx.hashIds.encodeId(0)]: {
        id: ctx.hashIds.encodeId(0),
        username: 'Deleted',
        avatar: ''
      }
    }
    users.forEach(u => {
      userMap[ctx.hashIds.encodeId(u.id)] = {
        id: ctx.hashIds.encodeId(u.id),
        username: u.name,
        avatar: u.picture
      }
    })

    return {
      mark_list: markList,
      user_list: userMap
    }
  }

  public async getMarkList(ctx: ContextManager, page: number, size: number): Promise<markCommentItem[]> {
    const markTypeMap: Record<markType, string> = {
      [markType.COMMENT]: 'comment',
      [markType.LINE]: 'mark',
      [markType.REPLY]: 'reply',
      [markType.ORIGIN_LINE]: 'mark',
      [markType.ORIGIN_COMMENT]: 'comment'
    }
    const marks = await this.markRepo.listUserMark(ctx.getUserId(), page, size)
    if (marks.length === 0) return []

    const bookmarkIdList: number[] = []
    const bookmarkTitleMap: Record<number, string> = {}
    const parentComment: Record<number, string> = {}
    const parentCommentIdList: number[] = []
    const deletedParentCommmentIdList: Set<number> = new Set()

    for (const mark of marks) {
      if (bookmarkIdList.indexOf(mark.bookmark_id) === -1) {
        bookmarkIdList.push(mark.bookmark_id)
      }
      if (mark.type === markType.REPLY) {
        parentCommentIdList.push(mark.parent_id)
      }
    }

    // 批量查询父级评论
    const processParentComment = async () => {
      if (parentCommentIdList.length < 1) return
      ;(await this.bookmarkRepo.batchGetBookmarkComment(parentCommentIdList)).forEach(c => {
        c.is_deleted && deletedParentCommmentIdList.add(c.id)
        !c.is_deleted && (parentComment[c.id] = c.comment)
      })
    }
    // 批量查询bookmark title
    const processBookmarkTitle = async () => {
      if (bookmarkIdList.length < 1) return
      ;(await this.bookmarkRepo.batchGetBookmarkTitle(bookmarkIdList)).forEach(b => {
        bookmarkTitleMap[b.user_bookmark_id] = b.title
      })
    }

    await Promise.allSettled([processParentComment(), processBookmarkTitle()])

    const res: markCommentItem[] = []
    for (const mark of marks) {
      try {
        let sourceId = ctx.hashIds.encodeId(parseInt(mark.source_id)).toString()
        if (mark.source_type === 'share') sourceId = mark.source_id
        if (mark.source_type === 'collection') {
          const [collectionCode, cbId] = mark.source_id.split('/')
          sourceId = `${collectionCode}/${ctx.hashIds.encodeId(parseInt(cbId))}`
        }

        const metadata = mark.metadata as markMetadata

        res.push({
          id: ctx.hashIds.encodeId(mark.id),
          uuid: mark.uuid,
          type: markTypeMap[mark.type as markType],
          content: JSON.parse(mark.content) as markSelectContent[],
          created_at: mark.created_at,
          title: bookmarkTitleMap[mark.bookmark_id] || '',
          color: '',
          parent_comment: mark.type === markType.REPLY ? parentComment[mark.parent_id] || 'Deleted' : '',
          parent_comment_deleted: mark.type === markType.REPLY ? deletedParentCommmentIdList.has(mark.parent_id) : undefined,
          comment: mark.comment,
          source_type: mark.source_type as markCommentItem['source_type'],
          source_id: sourceId,
          approx_source: JSON.parse(mark.approx_source),
          parent_uid: metadata?.parent_id ?? undefined,
          root_uid: metadata?.root_id ?? undefined,
          bookmark_user_uuid: mark.user_bookmark_uuid || undefined
        })
      } catch (e) {
        console.log(`get mark list failed: ${e}, content: ${mark.content}`)
      }
    }

    return res
  }

  assertCreateMarkSource = async (ctx: ContextManager, data: markRequest) => {
    // 来源检测
    let bmId = 0
    let userId = 0

    const bookmarkHandle = async () => {
      if (data.bm_id) {
        bmId = ctx.hashIds.decodeId(data.bm_id || 0)
        userId = ctx.getUserId()
      } else if (data.bookmark_uid) {
        const bm = await this.bmDataRepo.getUserBookmarkByUuidWithDetail(data.bookmark_uid)
        if (!bm || !bm.bookmark) throw BookmarkNotFoundError()

        const isOwner = bm.user_id === ctx.getUserId()
        if (!isOwner) {
          if (data.type !== markType.REPLY) throw ShareActionNotAllowedError()
          if (bm.deleted_at || bm.bookmark.moderation_result > 0) throw ShareActionNotAllowedError()

          const access = await resolveBookmarkReadAccess(this.bmDataRepo, this.userDataRepo, ctx.getUserId(), bm.uuid)
          if (!access) throw ShareActionNotAllowedError()
          const share = access.share
          const traceEnabled = !share || (share.allow_comment && share.allow_line)
          if (!traceEnabled) throw ShareActionNotAllowedError()
        }

        bmId = bm.bookmark_id
        userId = bm.user_id
      }

      if (bmId < 1) throw BookmarkNotFoundError()
    }

    const shareHandle = async () => {
      const res = await this.assertBookmarkShareCode(ctx, data.share_code || '')
      const relation = await this.bmDataRepo.getUserBookmark(res.bookmark_id, res.user_id)
      if (!relation) throw BookmarkNotFoundError()
      const access = await resolveBookmarkReadAccess(this.bmDataRepo, this.userDataRepo, ctx.getUserId(), relation.uuid)
      if (!access) throw ShareActionNotAllowedError()
      const allowAction = [markType.LINE, markType.ORIGIN_LINE].includes(data.type) ? res.allow_line : res.allow_comment
      if (ctx.getUserId() !== res.user_id && !allowAction) throw ShareActionNotAllowedError()
      userId = res.user_id
      bmId = res.bookmark_id
    }

    const collectionHandle = async () => {
      const cbId = ctx.hashIds.decodeId(data.cb_id || 0)
      if (cbId < 1) throw BookmarkNotFoundError()
      const res = await this.bmDataRepo.getUserBookmarkById(cbId)
      if (!res || res.deleted_at || !res.is_starred) throw BookmarkNotFoundError()

      const collection = await this.collectionRepo.getUserShareCollectByCode(data.collection_code || '')
      if (!collection || collection.owner_id !== res.user_id) throw ShareCollectionNotFoundError()

      if (ctx.getUserId() !== res.user_id) {
        if (collection.status !== 1) {
          const subscription = await this.collectionRepo.getUserSubscribeCollectionRecord(ctx.getUserId(), collection.id)
          if (collection.status !== 0 || !subscription || subscription.is_deleted || subscription.subscription_end_time <= new Date()) throw ShareCollectionNotAllowedError()
        }
        const access = await resolveBookmarkReadAccess(this.bmDataRepo, this.userDataRepo, ctx.getUserId(), res.uuid)
        if (!access) throw ShareCollectionNotAllowedError()
        const policy = resolveCollectionPolicy(access.share)
        const allowAction = [markType.LINE, markType.ORIGIN_LINE].includes(data.type) ? policy.allowLine : policy.allowComment
        if (!allowAction) throw ShareCollectionNotAllowedError()
      }

      userId = res.user_id
      bmId = res.bookmark_id
    }

    if (data.bm_id || data.bookmark_uid) {
      await bookmarkHandle()
    } else if (data.share_code) {
      await shareHandle()
    } else if (data.collection_code && data.cb_id) {
      await collectionHandle()
    } else {
      throw ErrorMarkCommentTypeError()
    }

    const userBookmark = await this.bmDataRepo.getUserBookmark(bmId, userId)
    if (!userBookmark) throw ErrorParam()
    return userBookmark
  }

  public async createMark(ctx: ContextManager, data: markRequest) {
    // 数据检测
    if (data.type === markType.REPLY && data.comment && data.comment.length > 1500) throw CommentTooLongError()
    await this.assertMarkData(data)

    // 回复对象检测
    const userBookmark = await this.assertCreateMarkSource(ctx, data)

    // 防止通过回复来绕过评论限制
    let rootId = 0
    let parentId = 0
    let replyComment: markDetailPO | undefined = undefined
    if (data.type === markType.REPLY) {
      const parentParams: markIdParams = data.parent_uid ? { uuid: data.parent_uid } : { id: ctx.hashIds.decodeId(data.parent_id) }
      const res = await this.assertMarkBookmark(ctx, userBookmark.id, parentParams)
      if (userBookmark.user_id !== ctx.getUserId() && ![markType.COMMENT, markType.ORIGIN_COMMENT, markType.REPLY].includes(res.type)) throw ShareActionNotAllowedError()
      replyComment = res
      rootId = res.root_id > 0 ? res.root_id : res.id
      parentId = res.id
      data.source = []
      data.select_content = []
      data.approx_source = undefined
    }

    let sourceType = ''
    let sourceId: string | number = ''
    if (data.share_code) {
      sourceType = 'share'
      sourceId = data.share_code
    } else if (data.cb_id) {
      sourceType = 'collection'
      const cbId = ctx.hashIds.decodeId(data.cb_id || 0)
      if (cbId < 1) throw ErrorParam()
      sourceId = `${data.collection_code!}/${cbId}`
    } else {
      sourceType = 'bookmark'
      sourceId = data.bm_id ? ctx.hashIds.decodeId(data.bm_id) : userBookmark.bookmark_id
    }

    // 创建实体
    const res = await this.markDataRepo.create({
      user_bookmark_id: userBookmark.id,
      user_bookmark_uuid: userBookmark.uuid,
      user_id: ctx.getUserId(),
      type: data.type,
      source: data.source,
      source_type: sourceType,
      source_id: sourceId.toString(),
      content: data.select_content,
      comment: data.comment || '',
      created_at: new Date(),
      parent_id: parentId,
      root_id: rootId,
      approx_source: data.approx_source
    })

    if (!res) throw ServerError()

    if (data.type === markType.LINE) {
      submitServerEvent(ctx, undefined, 'highlight_created', { highlight_id: res.uuid, bookmark_id: userBookmark.uuid })
    }

    // 如果是父级评论，多update一次追加root_id，后续delete的时候不需要重新查询
    const callback = async () => {
      if ([markType.COMMENT, markType.ORIGIN_COMMENT].indexOf(data.type) !== -1) await this.markDataRepo.updateCommentRootId(res.id, res.id)
    }
    ctx.execution.waitUntil(callback())

    const metadata = res.metadata as markMetadata

    return {
      response: {
        id: ctx.hashIds.encodeId(res.id),
        root_id: ctx.hashIds.encodeId(res.root_id > 0 ? res.root_id : res.id),
        uuid: res.uuid,
        root_uid: metadata.root_id ?? undefined
      },
      mark: res,
      userBookmark,
      replyComment
    }
  }

  public async deleteMark(ctx: ContextManager, params: markIdParams): Promise<string> {
    const previous = 'uuid' in params ? await this.markDataRepo.getByUuid(params.uuid) : await this.markDataRepo.get(params.id)
    const bookmark =
      previous?.type === markType.LINE && !previous.is_deleted && previous.user_id === ctx.getUserId()
        ? await this.bmDataRepo.getUserBookmarkByUserBmId(previous.user_bookmark_id)
        : null
    const result = await this.deleteResolvedMark(ctx, params)
    if (previous && bookmark) submitServerEvent(ctx, undefined, 'highlight_deleted', { highlight_id: previous.uuid, bookmark_id: bookmark.uuid })
    return result
  }

  public async getUserHasHighlight(ctx: ContextManager): Promise<boolean> {
    return await this.markDataRepo.userHasHighlight(ctx.getUserId())
  }

  public async getMarkUsersByUserBookmarkUuid(ctx: ContextManager, userBookmarkUuid: string): Promise<{ uuid: string; nick_name: string; avatar: string }[]> {
    const access = await resolveBookmarkReadAccess(this.bmDataRepo, this.userDataRepo, ctx.getUserId(), userBookmarkUuid)
    if (!access) throw BookmarkNotFoundError()

    if (access.bookmark.user_id !== ctx.getUserId()) {
      const policy = resolveCollectionPolicy(access.share)

      if (!policy.showMarks) return []
      if (!policy.showProfile) return []
    }

    const userIds = await this.markDataRepo.getDistinctUserIdsByUserBookmarkUuid(userBookmarkUuid)
    if (userIds.length === 0) return []

    const users = await this.userDataRepo.getUserInfoList(userIds)
    return users.map(u => ({
      uuid: u.uuid,
      nick_name: u.name,
      avatar: u.picture
    }))
  }
}
