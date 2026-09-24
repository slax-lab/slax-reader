import { Prisma, PrismaClient } from '@prisma/client'
import { inject, injectable } from '@/decorators/di'
import { PRISIMA_CLIENT, PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import { MultiLangError } from '@/utils/multiLangError'
import { DeleteImportFailedBookmarkFailError, BookmarkNotFoundError, CreateBookmarkShareUniqueFail, DeleteBookmarkFailError } from '@/const/err'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'

export enum queueStatus {
  PENDING = 'pending',
  PARSEING = 'parseing',
  RETRYING = 'retrying',
  FAILED = 'failed',
  PENDING_RETRY = 'pending_retry', // 失败后如果重新发起抓取，状态变为此状态
  SUCCESS = 'success',
  PENDING_IMPORT = 'pending_import'
}

export enum bookmarkParseStatus {
  PENDING = 'pending',
  PARSEING = 'parseing',
  FAILED = 'failed',
  SUCCESS = 'success',
  UPDATING = 'updating'
}

export enum bookmarkFetchRetryStatus {
  PENDING = 'pending',
  QUEUEING = 'queueing',
  PARSING = 'parsing',
  FAILED = 'failed',
  SUCCESS = 'success'
}

import type { UserTagSource, BookmarkTagSource } from '@slax-reader/contracts'
export type { UserTagSource, BookmarkTagSource } from '@slax-reader/contracts'

export interface bookmarkPO {
  bookmark_id?: number
  title: string
  alias_title?: string
  host_url: string
  target_url: string
  content_icon: string
  content_cover: string
  content_key?: string
  content_md_key?: string
  content_word_count?: number
  description?: string
  byline?: string
  private_user?: number
  status?: string
  created_at?: Date
  updated_at?: Date
  published_at?: Date
}

export interface bookmarkParsePO {
  title?: string
  content_icon?: string
  content_cover?: string
  content_key: string
  content_md_key?: string
  content_word_count: number
  description?: string
  byline?: string
  status: string
  published_at: Date
  site_name: string
}

export interface bookmarkSummaryPO {
  content: string
  ai_name?: string
  ai_model?: string
  created_at?: Date
  bookmark_id: number
  user_id: number
  lang: string
  updated_at?: Date
}

export interface bookmarkTitlePO {
  user_bookmark_id: number
  title: string
}

export interface bookmarkShardPO {
  id: number
  bookmark_id: number
  bucket_idx: number
  created_at: Date
}

export interface bookmarkChangePO {
  target_url: string
  bookmark_id: number
  created_at: Date
}

export interface bookmarkActionChangePO {
  user_id: number
  bookmark_id: number
  created_at: Date
  target_url: string
  action: 'add' | 'delete' | 'update'
}

export enum AigcBatchTaskStatus {
  SUBMITTED = 'submitted',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface AigcBatchTaskPO {
  id: number
  user_id: number
  bookmark_id: number
  task_type: string
  status: AigcBatchTaskStatus
  retry_count: number
  batch_request_id: string
  error_message: string
  result_data: string
  created_at: Date
  updated_at: Date
  submitted_at: Date | null
  completed_at: Date | null
}

export interface TweetMentionPO {
  tweet_id: string
  reply_tweet_id: string
  reply_tweet_name: string
  mention_twitter_id: string
  mention_twitter_name: string
  mention_content: string
  user_id: number
  mention_time: Date
}

export interface collectionBookmarkWithStatsPO extends bookmarkPO {
  id: number
  uuid: string
  site_name: string
  moderation_result: number
  bookmark_user_uuid: string
  starred_at: Date | null
  type: 'shortcut' | 'article'
  mark_count: number
  first_mark: { content: string; comment: string; source: string } | null
}

@injectable()
export class BookmarkRepo {
  private client: LazyInstance<PrismaClient>
  private clientPg: LazyInstance<HyperdrivePrismaClient>

  constructor(
    @inject(PRISIMA_CLIENT) private prisma: LazyInstance<PrismaClient>,
    @inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<HyperdrivePrismaClient>
  ) {
    this.client = prisma
    this.clientPg = prismaPg
  }

  public async deleteUserBookmark(bmId: number, userId: number): Promise<MultiLangError | null> {
    try {
      await this.prismaPg().sr_user_delete_bookmark.delete({ where: { user_id_bookmark_id: { user_id: Number(userId), bookmark_id: Number(bmId) } } })
    } catch (e) {
      const err = e as { code: string; message: string; name: string }
      if (err.code !== 'P2025') {
        console.log(`delete expired trashed bookmark failed: ${err}`)
        return DeleteBookmarkFailError()
      }

      console.log(`delete expired trashed bookmark failed: ${err}`)
    }

    try {
      await this.prismaPg().sr_user_bookmark_tag.deleteMany({ where: { bookmark_id: Number(bmId), user_id: Number(userId) } })
      await this.prismaPg().sr_user_bookmark.delete({ where: { user_id_bookmark_id: { bookmark_id: Number(bmId), user_id: Number(userId) } } })
      return null
    } catch (err) {
      console.log(`delete user bookmark failed: ${err}, userId: ${userId}, bookmarkId: ${bmId} `)
      return DeleteBookmarkFailError()
    }
  }

  public async updateBookmarkDeleteAt(bmId: number, userId: number, isDeleted: boolean) {
    const date = new Date()

    const deleteTasks = []
    if (isDeleted) {
      deleteTasks.push(
        this.prismaPg().sr_user_delete_bookmark.create({
          data: {
            user_id: userId,
            bookmark_id: bmId,
            deleted_at: date
          }
        })
      )
    } else {
      deleteTasks.push(this.prismaPg().sr_user_delete_bookmark.delete({ where: { user_id_bookmark_id: { user_id: userId, bookmark_id: bmId } } }))
    }

    deleteTasks.push(
      this.prismaPg().sr_user_bookmark.update({
        where: { user_id_bookmark_id: { user_id: userId, bookmark_id: bmId } },
        data: { deleted_at: isDeleted ? date : null, updated_at: date }
      })
    )

    deleteTasks.push(
      this.prismaPg().sr_user_bookmark_tag.updateMany({
        where: { bookmark_id: bmId, user_id: userId },
        data: { is_deleted: isDeleted }
      })
    )

    await Promise.allSettled(deleteTasks)
  }

  public async deleteBookmarkTry(bmId: number, userId: number): Promise<bookmarkPO | null> {
    try {
      const bookmark = await this.prismaPg().sr_bookmark.findUnique({ where: { id: bmId } })
      if (!bookmark || bookmark.private_user !== userId) return null

      await this.prismaPg().$executeRaw`DELETE FROM sr_bookmark WHERE id = ${bmId}`

      return { bookmark_id: bookmark.id, ...bookmark }
    } catch (e) {
      console.log(`delete bookmark failed:`, e)
      return null
    }
  }

  public async getBookmarkById(bmId: number) {
    try {
      return await this.prismaPg().sr_bookmark.findFirst({ where: { id: bmId } })
    } catch (err) {
      console.log(`get bookmark by id failed: ${err}`)
      throw BookmarkNotFoundError()
    }
  }

  public async getBookmark(targetUrl: string, privateUser: number): Promise<bookmarkPO | null> {
    const res = await this.prismaPg().sr_bookmark.findFirst({
      where: {
        target_url: targetUrl,
        private_user: privateUser
      }
    })
    if (!res) return null
    return { bookmark_id: res.id, ...res }
  }

  public async getUserBookmark(bmId: number, userId: number) {
    return await this.prismaPg().sr_user_bookmark.findFirst({ where: { bookmark_id: bmId, user_id: userId } })
  }

  public async getUserBookmarkUuidsByBmIds(userId: number, bmIds: number[]): Promise<Map<number, string>> {
    if (bmIds.length < 1) return new Map()
    const rows = await this.prismaPg().sr_user_bookmark.findMany({
      where: { user_id: userId, bookmark_id: { in: bmIds } },
      select: { bookmark_id: true, uuid: true }
    })
    return new Map(rows.map(row => [row.bookmark_id, row.uuid]))
  }

  public async getUserBookmarkById(id: number) {
    return await this.prismaPg().sr_user_bookmark.findFirst({ where: { id } })
  }

  public async getCollectionBookmarkById(id: number, collectionCode: string, viewerId = 0) {
    const db = this.prismaPg()
    const bookmark = await db.sr_user_bookmark.findFirst({ where: { id, is_starred: true, deleted_at: null }, include: { bookmark: true } })
    if (!bookmark) return null
    const collection = await db.sr_user_collection.findFirst({ where: { owner_id: bookmark.user_id, collection_code: collectionCode } })
    if (!collection) return null
    const owner = await db.sr_user.findFirst({ where: { id: bookmark.user_id, deleted_at: null } })
    if (!owner) return null
    if (viewerId === bookmark.user_id || collection.status === 1) return bookmark
    if (viewerId < 1 || collection.status !== 0) return null
    const subscription = await db.sr_user_collection_subscriber.findFirst({
      where: { collection_id: collection.id, user_id: viewerId, is_deleted: false, subscription_end_time: { gt: new Date() } }
    })
    return subscription ? bookmark : null
  }

  public async getUserBookmarkByUId(uid: string, userId: number) {
    return await this.prismaPg().sr_user_bookmark.findFirst({ where: { uuid: uid, user_id: userId }, include: { bookmark: true } })
  }

  public async getUserBookmarkByUuid(uuid: string) {
    return await this.prismaPg().sr_user_bookmark.findFirst({ where: { uuid } })
  }

  public async getUserBookmarkByUuidWithDetail(uuid: string) {
    return await this.prismaPg().sr_user_bookmark.findFirst({ where: { uuid }, include: { bookmark: true } })
  }

  public async getUserBookmarkByUserBmId(userBmId: number) {
    return await this.prismaPg().sr_user_bookmark.findFirst({ where: { id: userBmId }, include: { bookmark: true } })
  }

  public async getUserBookmarkWithDetail(bmId: number, userId: number) {
    try {
      return await this.prismaPg().sr_user_bookmark.findFirst({
        where: { bookmark_id: bmId, user_id: userId },
        include: { bookmark: true }
      })
    } catch (err) {
      console.error(`get user bookmark detail failed: ${err}`)
      throw BookmarkNotFoundError()
    }
  }

  public async createBookmark(info: bookmarkPO, status: string) {
    return await this.prismaPg().sr_bookmark.upsert({
      where: { target_url_private_user: { target_url: info.target_url, private_user: info.private_user || 0 } },
      create: { ...info, created_at: new Date(), updated_at: new Date(), published_at: new Date(), status },
      update: { ...info, updated_at: new Date() }
    })
  }

  public async createBookmarkRelation(userId: number, bmId: number, type: number, isArchive: boolean, importMetadata?: { savedAt?: Date; starred: boolean }) {
    // re-save bumps created_at (save time, tops inbox); replay may re-top
    return await this.prismaPg().sr_user_bookmark.upsert({
      where: { user_id_bookmark_id: { user_id: userId, bookmark_id: bmId } },
      create: {
        user_id: userId,
        bookmark_id: bmId,
        created_at: importMetadata?.savedAt ?? new Date(),
        updated_at: new Date(),
        type,
        archive_status: isArchive ? 1 : 0,
        is_starred: importMetadata?.starred ?? false
      },
      update: importMetadata ? {} : { created_at: new Date(), updated_at: new Date() }
    })
  }

  public async listAllUserBookmarks(userId: number) {
    return await this.prismaPg().sr_user_bookmark.findMany({ where: { user_id: userId, deleted_at: null } })
  }

  public async listUserStarBookmarksByTargetUser(userId: number, offset: number, limit: number, subscribeEndTime: Date) {
    return await this.prismaPg().sr_user_bookmark.findMany({
      where: { user_id: userId, deleted_at: null, is_starred: true, created_at: { lte: subscribeEndTime } },
      skip: offset,
      take: limit,
      include: { bookmark: true },
      orderBy: { created_at: 'desc' }
    })
  }

  public async getExportUpperId(userId: number): Promise<number> {
    const row = await this.prismaPg().sr_user_bookmark.findFirst({
      where: { user_id: userId, deleted_at: null },
      orderBy: { id: 'desc' },
      select: { id: true }
    })
    return row?.id ?? 0
  }

  public async listExportBookmarks(userId: number, afterId: number, upperId: number) {
    return this.prismaPg().sr_user_bookmark.findMany({
      where: { user_id: userId, deleted_at: null, id: { gt: afterId, lte: upperId } },
      orderBy: { id: 'asc' },
      take: 501,
      select: {
        id: true,
        alias_title: true,
        created_at: true,
        is_read: true,
        archive_status: true,
        is_starred: true,
        type: true,
        bookmark: { select: { target_url: true, title: true } },
        sr_user_bookmark_tag: {
          where: { user_id: userId, is_deleted: false },
          orderBy: { id: 'asc' },
          select: { tag_name: true, source: true }
        }
      }
    })
  }

  public async listUserBookmarks(userId: number, offset: number, limit: number, filter: string, source?: string) {
    let where: any = { user_id: userId, deleted_at: null }
    let orderBy: any = { created_at: 'desc' }

    const sourceDomain = this.normalizeSourceDomain(source)
    if (sourceDomain) {
      where.bookmark = {
        host_url: { in: [sourceDomain, `https://${sourceDomain}`, `http://${sourceDomain}`] }
      }
    }

    if (['read', 'unread'].includes(filter)) {
      where.is_read = filter === 'read'
    } else if (['archive', 'later', 'inbox'].includes(filter)) {
      // inbox: 0, archive: 1, later: 2
      const archiveStatus = filter === 'archive' ? 1 : filter === 'later' ? 2 : 0
      where.archive_status = archiveStatus
      // no nulls (backfill+trigger) → matches index
      if (filter === 'archive') orderBy = { archived_at: 'desc' }
    } else if (filter === 'starred') {
      where.is_starred = true
      orderBy = { starred_at: 'desc' }
    } else if (filter === 'trashed') {
      where.deleted_at = { not: null }
      orderBy = { deleted_at: 'desc' }
    } else if (filter === 'untagged') {
      return await this.listUntaggedUserBookmarks(userId, offset, limit)
    }

    return await this.prismaPg().sr_user_bookmark.findMany({
      where,
      skip: offset,
      take: limit,
      include: this.userBookmarkListInclude(),
      orderBy
    })
  }

  private normalizeSourceDomain(value?: string | null) {
    const source = value?.trim()
    if (!source) return ''
    try {
      const url = new URL(/^https?:\/\//i.test(source) ? source : `https://${source}`)
      return url.hostname.toLowerCase().replace(/\.$/, '')
    } catch {
      return ''
    }
  }

  /** list rows carry the live tag links so the list UI can draw chips without a second round trip */
  private userBookmarkListInclude() {
    return {
      bookmark: true,
      sr_user_bookmark_tag: { where: { is_deleted: false }, orderBy: { created_at: 'asc' as const } }
    }
  }

  /**
   * Bookmarks that carry every tag in tagIds (intersection).
   * Uses metadata.tags (uuid array kept by trigger_tag_uuid_update) with jsonb containment,
   * so one query serves n = 1 and n > 1 alike.
   */
  public async listUserBookmarksByTagIds(userId: number, tagIds: number[], offset: number, limit: number) {
    if (tagIds.length < 1) return []
    const tags = await this.prismaPg().sr_user_tag.findMany({ where: { id: { in: tagIds }, user_id: userId }, select: { uuid: true } })
    if (tags.length !== tagIds.length) return []

    return await this.prismaPg().sr_user_bookmark.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        metadata: { path: ['tags'], array_contains: tags.map(t => t.uuid) }
      },
      skip: offset,
      take: limit,
      include: this.userBookmarkListInclude(),
      orderBy: { created_at: 'desc' }
    })
  }

  /** Bookmarks with no live tag. Raw SQL so rows whose metadata lacks a tags array still count as untagged. */
  public async listUntaggedUserBookmarks(userId: number, offset: number, limit: number) {
    const rows = await this.prismaPg().$queryRaw<{ id: number }[]>`
      SELECT id FROM sr_user_bookmark
      WHERE user_id = ${userId} AND deleted_at IS NULL
        AND (jsonb_typeof(metadata->'tags') IS DISTINCT FROM 'array' OR metadata->'tags' = '[]'::jsonb)
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}`
    if (rows.length < 1) return []

    return await this.prismaPg().sr_user_bookmark.findMany({
      where: { id: { in: rows.map(r => r.id) } },
      include: this.userBookmarkListInclude(),
      orderBy: { created_at: 'desc' }
    })
  }

  /**
   * For the "+" picker on the multi-tag filter page: tags that still appear inside the
   * intersection of `uuids`, with how many bookmarks each one would leave.
   */
  public async countTagsWithinBookmarks(userId: number, uuids: string[], excludeTagIds: number[]) {
    if (uuids.length < 1) return []
    const exclude = excludeTagIds.length > 0 ? Prisma.sql`AND bt.tag_id NOT IN (${Prisma.join(excludeTagIds)})` : Prisma.empty
    return await this.prismaPg().$queryRaw<{ tag_id: number; count: number }[]>`
      SELECT bt.tag_id, COUNT(DISTINCT bt.bookmark_id)::int AS count
      FROM sr_user_bookmark_tag bt
      JOIN sr_user_bookmark ub ON ub.bookmark_id = bt.bookmark_id AND ub.user_id = bt.user_id
      WHERE bt.user_id = ${userId}
        AND bt.is_deleted = false
        AND ub.deleted_at IS NULL
        AND ub.metadata->'tags' @> ${JSON.stringify(uuids)}::jsonb
        ${exclude}
      GROUP BY bt.tag_id`
  }

  public async updateBookmark(bmId: number, info: bookmarkParsePO) {
    return await this.prismaPg().sr_bookmark.update({ where: { id: bmId }, data: { updated_at: new Date(), ...info } })
  }

  public async upsertBookmarkSummary(info: bookmarkSummaryPO) {
    const { bookmark_id, lang, user_id, ...infoWithoutIds } = info
    return await this.prismaPg().sr_bookmark_summary.upsert({
      where: { bookmark_id_lang_user_id: { bookmark_id: bookmark_id, lang: lang, user_id: user_id } },
      create: { ...info, created_at: new Date() },
      update: { ...infoWithoutIds, updated_at: new Date() }
    })
  }

  public async deleteBookmarkSummary(bmId: number, userId: number) {
    return await this.prismaPg().sr_bookmark_summary.deleteMany({ where: { bookmark_id: bmId, user_id: userId } })
  }

  public async updateBookmarkArchiveStatus(bmId: number, userId: number, status: number) {
    await this.prismaPg().sr_user_bookmark.update({
      where: { user_id_bookmark_id: { user_id: userId, bookmark_id: bmId } },
      data: { archive_status: status }
    })
  }

  public async updateBookmarkStarStatus(bmId: number, userId: number, status: boolean) {
    return await this.prismaPg().sr_user_bookmark.update({
      where: { user_id_bookmark_id: { user_id: userId, bookmark_id: bmId } },
      data: { is_starred: status }
    })
  }

  public async updateBookmarkStatus(bmId: number, status: queueStatus) {
    return await this.prismaPg().sr_bookmark.update({ where: { id: bmId }, data: { status, updated_at: new Date() } })
  }

  public async updateBookmarkAliasTitle(bmId: number, userId: number, alias_title: string) {
    return await this.prismaPg().sr_user_bookmark.update({
      where: { user_id_bookmark_id: { user_id: userId, bookmark_id: bmId } },
      data: { alias_title }
    })
  }

  public async updateUserBookmarkBookmarkId(id: number, bookmarkId: number) {
    return await this.prismaPg().sr_user_bookmark.update({ where: { id }, data: { bookmark_id: bookmarkId, updated_at: new Date() } })
  }

  public async getBookmarkShareByBookmarkId(bmId: number, userId: number) {
    return await this.prismaPg().sr_bookmark_share.findFirst({ where: { bookmark_id: bmId, user_id: userId } })
  }

  public async deleteBookmarkShare(bmId: number, userId: number) {
    try {
      await this.prismaPg().sr_bookmark_share.delete({ where: { bookmark_id_user_id: { bookmark_id: bmId, user_id: userId } } })
    } catch (err) {
      const error = err as { code: string; message: string; name: string }
      if (error.code === 'P2025') return null
      console.log(`delete bookmark share failed: ${err}`)
      return null
    }
  }

  public async updateBookmarkShareIsEnable(bmId: number, userId: number, isEnable: boolean) {
    return await this.prismaPg().sr_bookmark_share.update({
      where: { bookmark_id_user_id: { bookmark_id: bmId, user_id: userId } },
      data: { is_enable: isEnable }
    })
  }

  public async getBookmarkShareByShareCode(shareCode: string) {
    return await this.prismaPg().sr_bookmark_share.findFirst({ where: { share_code: shareCode } })
  }

  public async createBookmarkShare(shareCode: string, userId: number, bmId: number, showCommentLine: boolean, showUserinfo: boolean, allowAction: boolean) {
    try {
      return await this.prismaPg().sr_bookmark_share.create({
        data: {
          share_code: shareCode,
          user_id: userId,
          bookmark_id: bmId,
          created_at: new Date(),
          show_userinfo: showUserinfo,
          show_line: showCommentLine,
          show_comment: showCommentLine,
          allow_comment: allowAction,
          allow_line: allowAction
        }
      })
    } catch (err) {
      console.log(`create bookmark share failed: ${err}`)
      // 失败要抛出，让上层走错误响应；之前 return 错误对象会被 createShare 当成 share 行，导致返回畸形 200
      throw CreateBookmarkShareUniqueFail()
    }
  }

  public async updateBookmarkShare(bmId: number, userId: number, showCommentLine: boolean, showUserinfo: boolean, allowAction: boolean) {
    return await this.prismaPg().sr_bookmark_share.update({
      where: {
        bookmark_id_user_id: {
          bookmark_id: bmId,
          user_id: userId
        }
      },
      data: {
        show_line: showCommentLine,
        show_comment: showCommentLine,
        show_userinfo: showUserinfo,
        allow_comment: allowAction,
        allow_line: allowAction,
        is_enable: true
      }
    })
  }

  /**
   * A tag the user typed is "mine". If the name already exists as an auto tag,
   * the user has just claimed it: same row, same links, source flips to mine.
   */
  public async createUserTag(userId: number, tag: string, source: UserTagSource = 'mine') {
    if (!tag) return
    return this.prismaPg().sr_user_tag.upsert({
      where: {
        user_id_tag_name: {
          user_id: userId,
          tag_name: tag
        }
      },
      create: {
        user_id: userId,
        tag_name: tag,
        created_at: new Date(),
        display: true,
        source
      },
      // an auto write (e.g. import) never demotes a tag the user already claimed
      update: source === 'mine' ? { display: true, source } : { display: true }
    })
  }

  public async createUserTags(userId: number, tags: string[]) {
    if (!tags.length) return
    return this.prismaPg().sr_user_tag.createManyAndReturn({
      data: tags.map(tag => ({
        user_id: userId,
        tag_name: tag,
        created_at: new Date(),
        display: true,
        source: 'mine'
      })),
      skipDuplicates: true
    })
  }

  public async updateUserTagDisplay(userId: number, tagId: number, display: boolean) {
    return await this.prismaPg().sr_user_tag.update({
      where: { id: tagId, user_id: userId },
      data: { display }
    })
  }

  public async updateUserTagSource(userId: number, tagId: number, source: UserTagSource) {
    return await this.prismaPg().sr_user_tag.update({
      where: { id: tagId, user_id: userId },
      data: { source }
    })
  }

  /** the user just attached these tags by hand; AI attachments never call this */
  public async touchUserTagsLastUsed(userId: number, tagIds: number[]) {
    if (tagIds.length < 1) return 0
    return await this.prismaPg().sr_user_tag.updateMany({
      where: { id: { in: tagIds }, user_id: userId },
      data: { last_used_at: new Date() }
    })
  }

  public async createBookmarkTag(bmId: number, userId: number, tagId: number, tagName: string, source: BookmarkTagSource) {
    return await this.prismaPg().sr_user_bookmark_tag.upsert({
      where: { bookmark_id_user_id_tag_id: { bookmark_id: bmId, user_id: userId, tag_id: tagId } },
      create: { user_id: userId, bookmark_id: bmId, tag_id: tagId, tag_name: tagName, created_at: new Date(), source },
      // a link soft-deleted through PowerSync comes back alive when re-added over HTTP
      update: { is_deleted: false, source }
    })
  }

  /** soft delete, same tombstone the PowerSync path writes; the metadata trigger handles both */
  public async deleteBookmarkTag(bookmarkId: number, userId: number, tagId: number) {
    return await this.prismaPg().sr_user_bookmark_tag.updateMany({
      where: { bookmark_id: bookmarkId, user_id: userId, tag_id: tagId },
      data: { is_deleted: true }
    })
  }

  /** the tags page "delete": detach from every bookmark */
  public async softDeleteBookmarkTagsByTag(userId: number, tagId: number) {
    return await this.prismaPg().sr_user_bookmark_tag.updateMany({
      where: { tag_id: tagId, user_id: userId, is_deleted: false },
      data: { is_deleted: true }
    })
  }

  public async countBookmarksByTag(userId: number, tagId: number) {
    const [result] = await this.prismaPg().$queryRaw<[{ exists: boolean }]>`
      SELECT EXISTS (
        SELECT 1
        FROM sr_user_bookmark_tag
        WHERE user_id = ${userId} AND tag_id = ${tagId} AND is_deleted = false
      ) as "exists"`
    return result.exists
  }

  public async deleteUserTag(userId: number, tagId: number) {
    return await this.prismaPg().sr_user_tag.update({ where: { id: tagId, user_id: userId }, data: { display: false } })
  }

  public async getBookmarkTags(userId: number, bookmarkId: number) {
    return await this.prismaPg().sr_user_bookmark_tag.findMany({ where: { bookmark_id: bookmarkId, user_id: userId, is_deleted: false } })
  }

  /** the live vocabulary, mine first by recency. Serves both the tags page and the AI picker */
  public async getUserTags(userId: number) {
    return await this.prismaPg().sr_user_tag.findMany({
      where: { user_id: userId, display: true },
      orderBy: [{ last_used_at: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }]
    })
  }

  public async getUserTagById(userId: number, tagId: number) {
    return await this.prismaPg().sr_user_tag.findFirst({ where: { id: tagId, user_id: userId } })
  }

  public async getUserTagByUuid(userId: number, uuid: string) {
    return await this.prismaPg().sr_user_tag.findFirst({ where: { uuid, user_id: userId } })
  }

  public async getUserTagsByIds(userId: number, tagIds: number[]) {
    if (tagIds.length < 1) return []
    return await this.prismaPg().sr_user_tag.findMany({ where: { id: { in: tagIds }, user_id: userId } })
  }

  /** case-insensitive exact match; caller normalizes whitespace and width first */
  public async findUserTagByName(userId: number, tagName: string) {
    return await this.prismaPg().sr_user_tag.findFirst({ where: { user_id: userId, tag_name: { equals: tagName, mode: 'insensitive' } } })
  }

  public async updateUserTag(userId: number, tagId: number, tagName: string) {
    return await this.prismaPg().sr_user_tag.update({ where: { id: tagId, user_id: userId }, data: { tag_name: tagName } })
  }

  public async updateBookmarkTag(userId: number, tagId: number, tagName: string) {
    await this.prismaPg().sr_user_bookmark_tag.updateMany({ where: { tag_id: tagId, user_id: userId }, data: { tag_name: tagName } })
  }

  public async createBookmarkOverview(userId: number, bookmarkId: number, overview: string, content: string) {
    return await this.prismaPg().sr_user_bookmark_overview.upsert({
      // @ts-ignore
      where: { bookmark_id_user_id: { bookmark_id: bookmarkId, user_id: userId } },
      create: {
        user_id: userId,
        bookmark_id: bookmarkId,
        overview: overview,
        content: content,
        created_at: new Date()
      },
      update: {}
    })
  }

  public async getBookmarkListByUid(userId: number, uid: string) {
    return await this.prismaPg().$queryRaw<{ content_key: string; uuid: string }[]>(Prisma.sql`
     SELECT sb.content_key,sub.uuid  FROM sr_bookmark sb
     INNER JOIN (SELECT bookmark_id, uuid FROM sr_user_bookmark WHERE user_id = ${userId} AND uuid = ${uid}) sub ON sb.id = sub.bookmark_id;`)
  }

  public async getUserBookmarkOverview(userId: number, bookmarkId: number) {
    return await this.prismaPg().sr_user_bookmark_overview.findFirst({
      where: {
        user_id: userId,
        bookmark_id: bookmarkId
      },
      orderBy: {
        created_at: 'desc'
      }
    })
  }

  public async createBookmarkImportTask(userId: number, type: string, objectKey: string, totalCount: number, batchCount: number) {
    return await this.prismaPg().sr_bookmark_import.create({
      data: {
        user_id: userId,
        type,
        object_key: objectKey,
        created_at: new Date(),
        status: 1,
        reason: 'PENDING',
        total_count: totalCount,
        batch_count: batchCount
      }
    })
  }

  public async appendImportTaskErrLog(importId: number, errLog: string) {
    void this.prismaPg().$executeRaw`UPDATE sr_bookmark_import SET reason = reason || '\n' || ${errLog} WHERE id = ${importId}`
  }

  public async getUnfinishedImportTask() {
    return await this.prismaPg().sr_bookmark_import.findMany({ where: { status: 1 } })
  }

  public async updateBookmarkImportTask(importId: number, status: number, reason: string) {
    return await this.prismaPg().sr_bookmark_import.update({
      where: { id: importId },
      data: { status, reason }
    })
  }

  public async getUserImportTaskByType(userId: number, type: string) {
    return await this.prismaPg().sr_bookmark_import.findMany({
      where: {
        user_id: userId,
        type,
        status: {
          in: [0, 1]
        }
      }
    })
  }

  public async getExpiredTrashedBookmark() {
    return await this.prismaPg().sr_user_delete_bookmark.findMany({
      where: { deleted_at: { lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }
    })
  }

  public async batchGetBookmarkComment(commentIds: number[]) {
    return await this.prismaPg().sr_bookmark_comment.findMany({ where: { id: { in: commentIds } } })
  }

  public async batchGetBookmarkTitle(bookmarkIdList: number[]): Promise<bookmarkTitlePO[]> {
    return await this.prismaPg().$queryRaw<bookmarkTitlePO[]>(Prisma.sql`
      SELECT title, u.id as user_bookmark_id 
      FROM sr_bookmark b 
      INNER JOIN sr_user_bookmark u ON b.id = u.bookmark_id
      WHERE u.id IN (${Prisma.join(bookmarkIdList)})`)
  }

  public async getUserBookmarkSummary(bookmarkId: number, userId: number, lang: string) {
    return await this.prismaPg().sr_bookmark_summary.findFirst({
      where: {
        bookmark_id: bookmarkId,
        user_id: userId,
        lang
      }
    })
  }

  public async getBookmarkOutline(bookmarkId: number, userId: number) {
    return await this.prismaPg().sr_bookmark_summary.findFirst({
      where: { bookmark_id: bookmarkId, user_id: userId },
      orderBy: { id: 'desc' }
    })
  }

  public async getBookmarkSummariesRaw(bookmarkId: number, lang: string, userId: number, limit: number) {
    return await this.prismaPg().$queryRaw<bookmarkSummaryPO[]>`
      SELECT * FROM (SELECT * FROM sr_bookmark_summary WHERE user_id = ${userId} AND bookmark_id = ${bookmarkId} AND lang = ${lang} LIMIT ${limit})
      UNION ALL
      SELECT * FROM (SELECT * FROM sr_bookmark_summary WHERE bookmark_id = ${bookmarkId} AND lang = ${lang} LIMIT ${limit})
    `
  }

  public async createBookmarkFetchRetry(bookmarkId: number, userId: number, retryCount?: number) {
    return await this.prismaPg().sr_bookmark_fetch_retry.upsert({
      where: { bookmark_id_user_id: { bookmark_id: bookmarkId, user_id: userId } },
      create: { retry_count: retryCount || 0, bookmark_id: bookmarkId, user_id: userId },
      update: {}
    })
  }

  public async getFilterBookmarkFetchRetries(options: { status: bookmarkFetchRetryStatus }) {
    const res = await this.prismaPg().$queryRaw<{ bookmark_id: number; retry_counts: string; user_ids: string; created_at: string }[]>`
    SELECT  bookmark_id, string_agg(retry_count::text, ',') as retry_counts, string_agg(user_id::text, ',') as user_ids, created_at FROM sr_bookmark_fetch_retry 
      WHERE status = ${options.status}
      GROUP BY bookmark_id`
    return res || []
  }

  public async updateBookmarkFetchRetry(bookmarkId: number, options: { retry_count?: number; last_retry_at?: Date; status?: bookmarkFetchRetryStatus; trace_id?: string }) {
    return await this.prismaPg().sr_bookmark_fetch_retry.updateMany({
      where: { bookmark_id: bookmarkId },
      data: { ...options }
    })
  }

  public async upsertVectorShard(bookmarkId: number, shardIdx: number) {
    return await this.prismaPg().sr_bookmark_vector_shard.upsert({
      where: { bookmark_id: bookmarkId },
      create: { bookmark_id: bookmarkId, bucket_idx: shardIdx, created_at: new Date() },
      update: { created_at: new Date() }
    })
  }

  public async getVectorShard(bookmarkId: number) {
    return await this.prismaPg().sr_bookmark_vector_shard.findFirst({ where: { bookmark_id: bookmarkId } })
  }

  public async getBookmarkVectorShard(userId: number) {
    if (userId < 1) return []

    try {
      return await this.prismaPg().$queryRaw<bookmarkShardPO[]>`SELECT id, vs.bookmark_id, vs.bucket_idx, vs.created_at FROM sr_bookmark_vector_shard vs
      INNER JOIN (SELECT bookmark_id FROM sr_user_bookmark WHERE user_id = ${userId} AND deleted_at IS NULL) ub on vs.bookmark_id = ub.bookmark_id`
    } catch (e) {
      console.log(e, 'getBookmarkVectorShard error')
      return []
    }
  }

  public async getUserBookmarkIds(userId: number) {
    return await this.prismaPg().sr_user_bookmark.findMany({ where: { user_id: userId, deleted_at: null }, select: { bookmark_id: true } })
  }

  public async getAllBookmarkChanges(userId: number) {
    try {
      const res = await this.prismaPg().$queryRaw<bookmarkChangePO[]>`SELECT sb.target_url, sb.id as bookmark_id, ub.created_at 
      FROM sr_bookmark sb 
      INNER JOIN 
      (SELECT id, bookmark_id, user_id, created_at FROM sr_user_bookmark WHERE user_id = ${userId}) ub 
      ON sb.id = ub.bookmark_id 
      ORDER BY ub.created_at DESC`

      return res
    } catch (e) {
      console.log(e, 'getAllBookmarkChanges error')
      return []
    }
  }

  public async createBookmarkChangeLog(userId: number, url: string, bookmarkId: number, action: 'add' | 'delete' | 'update', time: Date) {
    try {
      return await this.prisma().slax_user_bookmark_change.create({
        data: {
          user_id: userId,
          target_url: url,
          bookmark_id: bookmarkId,
          action,
          created_at: time
        }
      })
    } catch (e) {
      console.log(e, 'createBookmarkChangeLog error')
      return
    }
  }

  public async getPartialBookmarkChanges(userId: number, time: number, limit = 5000) {
    const res = await this.prisma().slax_user_bookmark_change.findMany({
      where: {
        user_id: userId,
        created_at: {
          gt: new Date(time)
        }
      },
      orderBy: {
        created_at: 'asc'
      },
      take: limit
    })

    return res as bookmarkActionChangePO[]
  }

  /**
   * 批量贴标签。删除是软删，所以用户再贴要把 is_deleted 翻回来；
   * AI 贴的遇到已有行（含用户删过的）一律不动，尊重用户的移除。
   */
  public async upsertBookmarkTags(bmId: number, userId: number, tags: { id: number; tag_name: string }[], source: BookmarkTagSource = 'ai') {
    if (tags.length < 1) return 0
    const tagIds = tags.map(t => t.id)
    const tagNames = tags.map(t => t.tag_name)
    const onConflict = source === 'user' ? Prisma.sql`DO UPDATE SET is_deleted = false, source = 'user'` : Prisma.sql`DO NOTHING`

    return await this.prismaPg().$executeRaw`
      INSERT INTO sr_user_bookmark_tag(user_id, bookmark_id, tag_id, tag_name, created_at, source)
      SELECT ${userId}, ${bmId}, tag_id, tag_name, NOW(), ${source}
      FROM UNNEST(${tagIds}::int[], ${tagNames}::text[]) AS t(tag_id, tag_name)
      ON CONFLICT(user_id, bookmark_id, tag_id) ${onConflict};
    `
  }

  /** the live vocabulary rows for these names; misses and hidden words are dropped. AI paths use this, never an upsert */
  public async getUserTagsByNames(userId: number, names: string[]) {
    if (names.length < 1) return []
    return await this.prismaPg().sr_user_tag.findMany({ where: { user_id: userId, display: true, tag_name: { in: names } } })
  }

  /**
   * User path: resolve names to ids in one round trip, creating missing words and showing
   * hidden ones again. `createSource` says what a brand-new word is: a word the user typed is
   * "mine", an imported word is "auto". With revive=false the conflict branch leaves display alone
   * (kept for callers that only need ids; AI paths should use getUserTagsByNames instead).
   */
  public async updateUserTagsDisplay(userId: number, names: string[], revive = false, createSource: UserTagSource = 'mine') {
    if (names.length < 1) return []
    return await this.prismaPg().$queryRaw<{ id: number; tag_name: string; source: string }[]>`
      INSERT INTO sr_user_tag(user_id, tag_name, display, source)
      SELECT ${userId}, tag_name, true, ${createSource}
      FROM UNNEST(${names}::text[]) AS tag_name
      ON CONFLICT(user_id, tag_name) 
      DO UPDATE SET display = CASE WHEN ${revive} THEN true ELSE sr_user_tag.display END
      RETURNING id, tag_name, source;
    `
  }

  public async queryTitlesByUuids(uuids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    if (uuids.length === 0) return map

    const rows = await this.clientPg().sr_user_bookmark.findMany({
      where: { uuid: { in: uuids } },
      select: { uuid: true, alias_title: true, bookmark: { select: { title: true } } }
    })
    for (const r of rows) {
      const title = (r.alias_title && r.alias_title.trim()) || r.bookmark?.title || ''
      map.set(r.uuid, title)
    }
    return map
  }

  // 合集星标列表，按 starred_at 排序，排除违禁
  private readableCollectionBookmarks(userId: number, viewerId: number) {
    return Prisma.sql`
      user_bookmark.user_id = ${userId}
      AND user_bookmark.deleted_at IS NULL
      AND user_bookmark.is_starred = true
      AND bookmark.moderation_result = 0
      AND EXISTS (SELECT 1 FROM sr_user owner WHERE owner.id = user_bookmark.user_id AND owner.deleted_at IS NULL
        AND (${viewerId} = user_bookmark.user_id OR COALESCE((
          SELECT share.is_enable FROM sr_bookmark_share share
          WHERE share.bookmark_id = user_bookmark.bookmark_id AND share.user_id = user_bookmark.user_id
        ), owner.snapshot_sharing)))`
  }

  public async countReadableCollectionBookmarks(userId: number, viewerId: number): Promise<number> {
    const rows = await this.clientPg().$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS count FROM sr_user_bookmark AS user_bookmark
      INNER JOIN sr_bookmark AS bookmark ON bookmark.id = user_bookmark.bookmark_id
      WHERE ${this.readableCollectionBookmarks(userId, viewerId)}`)
    return Number(rows[0]?.count ?? 0)
  }

  public async listUserStarBookmarksWithStatsByTargetUser(userId: number, offset: number, limit: number, viewerId = 0): Promise<collectionBookmarkWithStatsPO[]> {
    return await this.clientPg().$queryRaw<collectionBookmarkWithStatsPO[]>(Prisma.sql`
      SELECT user_bookmark.id,
        bookmark.uuid,
        bookmark.title,
        user_bookmark.alias_title,
        bookmark.host_url,
        bookmark.target_url,
        bookmark.site_name,
        bookmark.content_icon,
        bookmark.content_cover,
        bookmark.content_word_count,
        bookmark.description,
        bookmark.byline,
        bookmark.status,
        bookmark.moderation_result,
        bookmark.created_at,
        bookmark.updated_at,
        bookmark.published_at,
        user_bookmark.uuid AS bookmark_user_uuid,
        user_bookmark.starred_at,
        CASE WHEN user_bookmark.type = 1 THEN 'shortcut' ELSE 'article' END AS type,
        CASE
          WHEN COALESCE((
            SELECT share.is_enable AND share.show_line AND share.show_comment
            FROM sr_bookmark_share AS share
            WHERE share.bookmark_id = user_bookmark.bookmark_id
              AND share.user_id = user_bookmark.user_id
            LIMIT 1
          ), true)
          THEN COALESCE(stats.comment_count, 0)
          ELSE 0
        END AS mark_count,
        CASE WHEN stats.first_comment IS NULL
          OR NOT COALESCE((
            SELECT share.is_enable AND share.show_line AND share.show_comment AND share.show_userinfo
            FROM sr_bookmark_share AS share
            WHERE share.bookmark_id = user_bookmark.bookmark_id
              AND share.user_id = user_bookmark.user_id
            LIMIT 1
          ), true)
        THEN NULL ELSE jsonb_build_object(
          'content', COALESCE(stats.first_comment ->> 'content', ''),
          'comment', COALESCE(stats.first_comment ->> 'comment', ''),
          'source', COALESCE(stats.first_comment ->> 'source', '')
        ) END AS first_mark
      FROM sr_user_bookmark AS user_bookmark
      INNER JOIN sr_bookmark AS bookmark ON bookmark.id = user_bookmark.bookmark_id
      LEFT JOIN sr_user_bookmark_stats AS stats ON stats.bookmark_uuid = user_bookmark.uuid
      WHERE ${this.readableCollectionBookmarks(userId, viewerId)}
      ORDER BY user_bookmark.starred_at DESC, user_bookmark.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `)
  }

  /**
   * 批量创建 Twitter mentions 记录
   */
  public async batchCreateTwitterMentionsRecords(records: TweetMentionPO[]) {
    if (records.length === 0) return []

    return await this.clientPg().sr_twitter_mentions_record.createManyAndReturn({
      data: records,
      skipDuplicates: true
    })
  }

  /**
   * 根据 Twitter ID 查询绑定的用户
   */
  public async getUserByTwitterIds(twitterId: string[]) {
    return await this.clientPg().sr_platform_bind.findMany({
      where: {
        platform: 'twitter',
        platform_id: { in: twitterId }
      }
    })
  }

  public async getLatestActiveUserBookmarkId(userId: number) {
    return await this.clientPg().sr_user_bookmark.findFirst({
      where: { user_id: userId, deleted_at: null },
      orderBy: { id: 'desc' },
      select: { id: true }
    })
  }

  public async listExportUserBookmarks(userId: number, afterId: number, upperId: number, take: number) {
    return await this.clientPg().sr_user_bookmark.findMany({
      where: { user_id: userId, deleted_at: null, id: { gt: afterId, lte: upperId } },
      take,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        alias_title: true,
        created_at: true,
        is_read: true,
        archive_status: true,
        is_starred: true,
        type: true,
        bookmark: { select: { target_url: true, title: true } },
        sr_user_bookmark_tag: {
          where: { user_id: userId, is_deleted: false },
          orderBy: { id: 'asc' },
          select: { tag_name: true, source: true }
        }
      }
    })
  }

  public async updateBookmarkModerationResult(bmId: number, moderationResult: number) {
    return await this.clientPg().sr_bookmark.update({ where: { id: bmId }, data: { moderation_result: moderationResult, updated_at: new Date() } })
  }

  public async disableBookmarkShareUpsert(bmId: number, userId: number) {
    return await this.clientPg().sr_bookmark_share.upsert({
      where: { bookmark_id_user_id: { bookmark_id: bmId, user_id: userId } },
      create: {
        share_code: '',
        user_id: userId,
        bookmark_id: bmId,
        show_line: false,
        show_comment: false,
        show_userinfo: false,
        allow_comment: false,
        allow_line: false,
        is_enable: false,
        created_at: new Date()
      },
      update: { is_enable: false }
    })
  }

  /** Newest first, capped so the status endpoint stays small for users with a long import history. */
  public async getUserImportTask(userId: number) {
    return await this.clientPg().sr_bookmark_import.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 20
    })
  }

  public async getUserProcessingImportTasks(userId: number) {
    return await this.clientPg().sr_bookmark_import.findMany({
      where: {
        user_id: userId,
        status: 1
      },
      orderBy: { created_at: 'asc' }
    })
  }

  public async createBookmarkImportRelation(userId: number, bookmarkId: number, importId: number) {
    return await this.clientPg().sr_bookmark_import_relation.create({
      data: {
        user_id: userId,
        bookmark_id: bookmarkId,
        import_id: importId,
        created_at: new Date()
      }
    })
  }

  public async updateBookmarkImportRelationStatus(userId: number, bookmarkId: number, importId: number, status: number) {
    return await this.clientPg().sr_bookmark_import_relation.updateMany({
      where: {
        user_id: userId,
        bookmark_id: bookmarkId,
        import_id: importId
      },
      data: {
        status: status
      }
    })
  }

  /** Per-status relation counts for an import task: { [status]: count }. Fallback progress source when Redis is unavailable. */
  public async countImportRelationStatus(importId: number): Promise<Record<number, number>> {
    const rows = await this.clientPg().sr_bookmark_import_relation.groupBy({
      by: ['status'],
      where: { import_id: importId },
      _count: { _all: true }
    })
    return Object.fromEntries(rows.map(row => [row.status, row._count._all]))
  }

  public async updateImportTaskCounters(importId: number, successTotal: number, failedTotal: number) {
    return await this.clientPg().sr_bookmark_import.update({
      where: { id: importId },
      data: {
        success_total: successTotal,
        failed_total: failedTotal
      }
    })
  }

  public async getImportFailedBookmarks(userId: number, importId: number, page: number = 1, limit: number = 20) {
    const offset = (page - 1) * limit
    const ids = await this.clientPg().sr_bookmark_import_relation.findMany({
      where: {
        user_id: userId,
        import_id: importId,
        status: 2
      },
      orderBy: {
        bookmark_id: 'asc'
      },
      skip: offset,
      take: limit
    })

    return await this.clientPg().sr_bookmark.findMany({
      where: {
        id: { in: ids.map(item => item.bookmark_id) }
      }
    })
  }

  public async validateImportBookmarkIds(userId: number, importId: number, bookmarkIds: number[]): Promise<number[]> {
    if (!bookmarkIds || bookmarkIds.length === 0) return []

    // 验证这些bookmark_id是否都属于指定的userId和importId的导入关系记录
    const validRelations = await this.clientPg().sr_bookmark_import_relation.findMany({
      where: {
        bookmark_id: { in: bookmarkIds },
        user_id: userId,
        import_id: importId
      },
      select: {
        bookmark_id: true
      }
    })

    const validBookmarkIds = validRelations.map(r => r.bookmark_id)

    if (validBookmarkIds.length !== bookmarkIds.length) {
      throw DeleteImportFailedBookmarkFailError()
    }

    return validBookmarkIds
  }

  public async batchDeleteBookmarksByIds(userId: number, bookmarkIds: number[]) {
    if (!bookmarkIds || bookmarkIds.length === 0) return

    await this.clientPg().sr_user_delete_bookmark.deleteMany({
      where: {
        bookmark_id: { in: bookmarkIds },
        user_id: userId
      }
    })
    await this.clientPg().sr_user_bookmark_tag.deleteMany({
      where: {
        bookmark_id: { in: bookmarkIds },
        user_id: userId
      }
    })
    await this.clientPg().sr_user_bookmark.deleteMany({
      where: {
        bookmark_id: { in: bookmarkIds },
        user_id: userId
      }
    })
    await this.clientPg().sr_bookmark_import_relation.deleteMany({
      where: {
        bookmark_id: { in: bookmarkIds },
        user_id: userId
      }
    })
  }

  public async getAllImportBookmarkIds(userId: number, importId: number): Promise<number[]> {
    const relations = await this.clientPg().sr_bookmark_import_relation.findMany({
      where: {
        user_id: userId,
        import_id: importId
      },
      select: {
        bookmark_id: true
      }
    })

    return relations.map(r => r.bookmark_id)
  }

  public async createAigcBatchTask(userId: number, bookmarkId: number, batchId: string, taskType: string) {
    try {
      await this.clientPg().sr_aigc_batch_task.create({
        data: {
          user_id: userId,
          bookmark_id: bookmarkId,
          task_type: taskType,
          status: AigcBatchTaskStatus.SUBMITTED,
          retry_count: 0,
          batch_request_id: batchId,
          created_at: new Date(),
          updated_at: new Date()
        }
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        console.log(`AIGC batch task already exists for user ${userId}, bookmark ${bookmarkId}, type ${taskType}`)
        return
      }
      throw error
    }
  }

  public async getPendingAigcBatchTasks(taskType: string, limit: number = 50): Promise<AigcBatchTaskPO[]> {
    const res = await this.clientPg().sr_aigc_batch_task.findMany({
      where: {
        task_type: taskType,
        status: AigcBatchTaskStatus.SUBMITTED
      },
      take: limit
    })

    return res.map(item => ({
      id: item.id,
      user_id: item.user_id,
      bookmark_id: item.bookmark_id,
      task_type: item.task_type,
      status: item.status as AigcBatchTaskStatus,
      retry_count: item.retry_count,
      batch_request_id: item.batch_request_id,
      error_message: item.error_message,
      result_data: item.result_data,
      created_at: item.created_at,
      updated_at: item.updated_at,
      submitted_at: item.submitted_at,
      completed_at: item.completed_at
    }))
  }

  public async updateAigcBatchTaskStatus(batchId: string, status: AigcBatchTaskStatus, result: string, errorMessage?: string) {
    await this.clientPg().sr_aigc_batch_task.update({
      where: { batch_request_id: batchId },
      data: {
        status,
        result_data: result,
        updated_at: new Date(),
        submitted_at: status === AigcBatchTaskStatus.SUBMITTED ? new Date() : undefined,
        completed_at: [AigcBatchTaskStatus.COMPLETED, AigcBatchTaskStatus.FAILED].includes(status) ? new Date() : undefined,
        error_message: status === AigcBatchTaskStatus.FAILED ? errorMessage : undefined
      }
    })
  }

  public async getUserBookmarkBatchTasks(userId: number, bookmarkId: number, taskType: string): Promise<AigcBatchTaskPO[]> {
    const res = await this.clientPg().sr_aigc_batch_task.findMany({
      where: {
        user_id: userId,
        bookmark_id: bookmarkId,
        task_type: taskType,
        status: AigcBatchTaskStatus.SUBMITTED
      }
    })

    return res.map(item => ({
      id: item.id,
      user_id: item.user_id,
      bookmark_id: item.bookmark_id,
      task_type: item.task_type,
      status: item.status as AigcBatchTaskStatus,
      retry_count: item.retry_count,
      batch_request_id: item.batch_request_id,
      error_message: item.error_message,
      result_data: item.result_data,
      created_at: item.created_at,
      updated_at: item.updated_at,
      submitted_at: item.submitted_at,
      completed_at: item.completed_at
    }))
  }

  public async updateUserBookmarkCreateAt(bmId: number, userId: number, createdAt: Date) {
    return await this.clientPg().sr_user_bookmark.update({
      where: { user_id_bookmark_id: { bookmark_id: bmId, user_id: userId } },
      data: { created_at: createdAt }
    })
  }

  public async findStuckBookmarks(opts: {
    pendingThresholdMinutes: number
    limit: number
  }): Promise<{ id: number; target_url: string; status: string; created_at: Date; user_id: number }[]> {
    const now = Date.now()

    const pendingCutoff = new Date(now - opts.pendingThresholdMinutes * 60_000)
    const dayFloor = new Date(now - 24 * 60 * 60_000)

    return await this.clientPg().$queryRaw<{ id: number; target_url: string; status: string; created_at: Date; user_id: number }[]>`
      SELECT b.id, b.target_url, b.status, b.created_at,
             (SELECT ub.user_id FROM sr_user_bookmark ub
              WHERE ub.bookmark_id = b.id LIMIT 1) AS user_id
      FROM sr_bookmark b
      WHERE b.status IN ('pending', 'pending_retry')
        AND b.created_at BETWEEN ${dayFloor} AND ${pendingCutoff}
        AND NOT EXISTS (SELECT 1 FROM sr_bookmark_import_relation bir WHERE bir.bookmark_id = b.id)
        AND NOT EXISTS (SELECT 1 FROM sr_rss_save_job rj WHERE rj.bookmark_id = b.id)
      ORDER BY b.created_at ASC
      LIMIT ${opts.limit}
    `
  }

  public async casBookmarkStatus(bmId: number, expected: queueStatus, newStatus: queueStatus): Promise<boolean> {
    const affected = await this.clientPg().$executeRaw`
      UPDATE sr_bookmark
      SET status = ${newStatus}::text, updated_at = NOW()
      WHERE id = ${bmId} AND status = ${expected}::text
    `
    return affected > 0
  }
}
