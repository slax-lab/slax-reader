import { Prisma, PrismaClient } from '@prisma/client'
import { inject, injectable } from '@/decorators/di'
import { PRISIMA_CLIENT, PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import { MultiLangError } from '@/utils/multiLangError'
import { DeleteImportFailedBookmarkFailError, BookmarkNotFoundError, CreateBookmarkShareUniqueFail, DeleteBookmarkFailError } from '@/const/err'
import { PrismaClient as HyperdrivePrismaClient, type Prisma as HyperdrivePrisma } from '@prisma/hyperdrive-client'
import { lockBookmarkObjects, retireBookmarkObjects, stageEmptyBookmarkDeletion } from './bookmarkObjectLifecycle'

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

export interface BookmarkForkPO {
  source_bookmark_id: number
  target_user_id: number
  source_user_id: number
  source_uuid: string
  source_url: string
  display_name?: string | null
  show_userinfo: boolean
  idempotency_key?: string | null
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

/** Committed body identity used to fence asynchronous AI-derived writes. */
export interface BookmarkContentRevision {
  writeVersion: number
  publishedVersion: number
  contentKey: string
  contentMdKey: string | null
}

export function bookmarkContentRevision(bookmark: {
  write_version?: number | null
  published_version?: number | null
  content_key?: string | null
  content_md_key?: string | null
}): BookmarkContentRevision {
  return {
    writeVersion: bookmark.write_version ?? 0,
    publishedVersion: bookmark.published_version ?? 0,
    contentKey: bookmark.content_key ?? '',
    contentMdKey: bookmark.content_md_key ?? null
  }
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
  type: 'shortcut' | 'article' | 'pdf'
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
      return await this.prismaPg().$transaction(async tx => {
        const previous = await lockBookmarkObjects(tx, bmId)
        if (!previous || previous.private_user !== userId || userId < 1) return null
        await tx.sr_bookmark_fork_operation.deleteMany({ where: { target_bookmark_id: bmId } })
        await retireBookmarkObjects(tx, previous)
        await stageEmptyBookmarkDeletion(tx, previous)
        await tx.sr_bookmark_fork.deleteMany({ where: { target_bookmark_id: bmId } })
        await tx.sr_bookmark_save_receipt.deleteMany({ where: { target_bookmark_id: bmId } })
        await tx.sr_bookmark_import_relation.deleteMany({ where: { user_id: userId, bookmark_id: bmId } })
        const [bookmark] = await tx.$queryRaw<Array<bookmarkPO & { id: number }>>`DELETE FROM sr_bookmark WHERE id = ${bmId} RETURNING *`
        return { bookmark_id: bookmark.id, ...bookmark }
      })
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
      update: info.private_user && info.private_user > 0 ? {} : { ...info, updated_at: new Date() }
    })
  }

  public async createBookmarkWithSaveReceipt(
    info: bookmarkPO,
    status: string,
    userId: number,
    type: number,
    isArchive: boolean,
    importMetadata: { savedAt?: Date; starred: boolean } | undefined,
    operationKey: string,
    tags: string[] = []
  ) {
    return await this.prismaPg().$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bookmark-save:${userId}:${operationKey}`}, 0))`
      const receipt = await tx.sr_bookmark_save_receipt.findUnique({
        where: { user_id_operation_key: { user_id: userId, operation_key: operationKey } }
      })
      if (receipt) {
        const bookmark = await tx.sr_bookmark.findFirst({ where: { id: receipt.target_bookmark_id, private_user: userId } })
        const relation = await tx.sr_user_bookmark.findUnique({
          where: { user_id_bookmark_id: { user_id: userId, bookmark_id: receipt.target_bookmark_id } }
        })
        if (!bookmark || !relation || relation.uuid !== receipt.target_uuid) throw BookmarkNotFoundError()
        return { bookmark: { ...bookmark, write_version: receipt.write_version }, relation, replayed: true, createdTarget: receipt.created_target }
      }

      const now = new Date()
      const bookmark = await tx.sr_bookmark.upsert({
        where: { target_url_private_user: { target_url: info.target_url, private_user: userId } },
        create: { ...info, private_user: userId, created_at: now, updated_at: now, published_at: now, status },
        update: {}
      })
      const write = await tx.sr_bookmark.update({
        where: { id: bookmark.id },
        data: { write_version: { increment: 1 }, updated_at: now },
        select: { id: true, write_version: true, published_version: true, content_key: true, content_md_key: true, status: true }
      })
      if (bookmark.status === queueStatus.FAILED) {
        await tx.sr_bookmark.updateMany({
          where: { id: bookmark.id, write_version: write.write_version, content_key: '' },
          data: { status: queueStatus.PENDING_RETRY, updated_at: now }
        })
      }
      const previousRelation = await tx.sr_user_bookmark.findUnique({ where: { user_id_bookmark_id: { user_id: userId, bookmark_id: bookmark.id } } })
      const createdTarget = bookmark.write_version === 0 && !previousRelation
      let relation = await tx.sr_user_bookmark.upsert({
        where: { user_id_bookmark_id: { user_id: userId, bookmark_id: bookmark.id } },
        create: {
          user_id: userId,
          bookmark_id: bookmark.id,
          created_at: importMetadata?.savedAt ?? now,
          updated_at: now,
          type,
          archive_status: isArchive ? 1 : 0,
          is_starred: importMetadata?.starred ?? false
        },
        update: importMetadata ? {} : { created_at: now, updated_at: now }
      })
      if (relation.deleted_at) {
        relation = await tx.sr_user_bookmark.update({
          where: { user_id_bookmark_id: { user_id: userId, bookmark_id: bookmark.id } },
          data: { deleted_at: null, archive_status: 0, updated_at: now }
        })
        await tx.sr_user_delete_bookmark.deleteMany({ where: { user_id: userId, bookmark_id: bookmark.id } })
        await tx.sr_user_bookmark_tag.updateMany({ where: { user_id: userId, bookmark_id: bookmark.id }, data: { is_deleted: false } })
      }
      for (const tagName of [...new Set(tags.map(tag => tag.trim()).filter(Boolean))]) {
        const tag = await tx.sr_user_tag.upsert({
          where: { user_id_tag_name: { user_id: userId, tag_name: tagName } },
          create: { user_id: userId, tag_name: tagName, display: true, source: 'auto', last_used_at: now },
          update: { display: true, last_used_at: now }
        })
        await tx.sr_user_bookmark_tag.upsert({
          where: { bookmark_id_user_id_tag_id: { bookmark_id: bookmark.id, user_id: userId, tag_id: tag.id } },
          create: { bookmark_id: bookmark.id, user_id: userId, tag_id: tag.id, tag_name: tag.tag_name, source: 'user' },
          update: { is_deleted: false, source: 'user', tag_name: tag.tag_name }
        })
      }
      await tx.sr_bookmark_save_receipt.create({
        data: {
          user_id: userId,
          operation_key: operationKey,
          target_bookmark_id: bookmark.id,
          target_uuid: relation.uuid,
          write_version: write.write_version,
          created_target: createdTarget,
          created_at: now
        }
      })
      return { bookmark: { ...bookmark, ...write }, relation, replayed: false, createdTarget }
    })
  }

  public async reserveBookmarkWrite(bookmarkId: number) {
    return await this.prismaPg().sr_bookmark.update({
      where: { id: bookmarkId },
      data: { write_version: { increment: 1 }, updated_at: new Date() },
      select: { id: true, write_version: true, published_version: true, content_key: true, content_md_key: true, status: true }
    })
  }

  public async isBookmarkVersionCurrent(bookmarkId: number, version: number) {
    const row = await this.prismaPg().sr_bookmark.findFirst({ where: { id: bookmarkId, write_version: version }, select: { id: true } })
    return !!row
  }

  public async stageBookmarkObjects(bookmarkId: number, version: number, contentKey: string, keys: string[]) {
    if (!contentKey || !keys.length) return
    await this.prismaPg().sr_bookmark_object_stage.upsert({
      where: { content_key: contentKey },
      create: { content_key: contentKey, bookmark_id: bookmarkId, write_version: version, keys, status: 'staged', updated_at: new Date() },
      update: {}
    })
  }

  public async getBookmarkUserIds(bookmarkId: number): Promise<number[]> {
    const rows = await this.prismaPg().$queryRaw<Array<{ user_id: number }>>`
      SELECT user_id FROM sr_user_bookmark
      WHERE bookmark_id = ${bookmarkId} AND deleted_at IS NULL
    `
    return rows.map(row => Number(row.user_id)).filter(userId => userId > 0)
  }

  public async markBookmarkSearchIndexPending(bookmarkId: number, contentKey?: string): Promise<void> {
    await this.prismaPg().$executeRaw`
      UPDATE sr_bookmark_object_stage
      SET indexed_at = NULL, index_attempted_at = ${new Date()}, updated_at = ${new Date()}
      WHERE bookmark_id = ${bookmarkId} AND status = 'published'
        AND content_key = COALESCE(${contentKey ?? null}::text, (SELECT content_key FROM sr_bookmark WHERE id = ${bookmarkId}))
    `
  }

  public async touchPendingBookmarkIndexStages(bookmarkId: number): Promise<void> {
    await this.prismaPg().$executeRaw`
      UPDATE sr_bookmark_object_stage
      SET updated_at = ${new Date()}
      WHERE bookmark_id = ${bookmarkId} AND status IN ('published', 'retired') AND indexed_at IS NULL
    `
  }

  public async listPendingBookmarkIndexStages(limit = 50): Promise<Array<{ bookmark_id: number }>> {
    return await this.prismaPg().$queryRaw<Array<{ bookmark_id: number }>>`
      SELECT bookmark_id FROM (
        SELECT stage.bookmark_id, stage.updated_at FROM sr_bookmark_object_stage stage
        WHERE stage.status IN ('published', 'retired') AND stage.indexed_at IS NULL
          AND EXISTS (SELECT 1 FROM sr_bookmark bookmark WHERE bookmark.id = stage.bookmark_id)
        ORDER BY stage.updated_at, stage.id LIMIT ${limit * 4}
      ) candidates
      GROUP BY bookmark_id ORDER BY MIN(updated_at), bookmark_id LIMIT ${limit}
    `
  }

  /**
   * Fence search index publication to the committed body pointer. Normalization runs before the
   * transaction; remote index writes run while the matching bookmark row is locked. The callback
   * receives a lease assertion for bounded checks before each remote mutation.
   */
  public async commitBookmarkSearchIndex<T>(
    bookmarkId: number,
    contentKey: string,
    publish: (assertLease: () => Promise<void>) => Promise<T>
  ): Promise<{ committed: boolean; value?: T }> {
    let externalWork: Promise<T> | undefined
    try {
      return await this.prismaPg().$transaction(async tx => {
        const rows = await tx.$queryRaw<Array<{ id: number; content_key: string; write_version: number; published_version: number }>>`
        SELECT id, content_key, write_version, published_version
        FROM sr_bookmark
        WHERE id = ${bookmarkId} AND content_key = ${contentKey}
        FOR UPDATE
      `
        const bookmark = rows[0]
        if (!bookmark) return { committed: false }
        const assertLease = async () => {
          await tx.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM sr_bookmark
          WHERE id = ${bookmarkId} AND content_key = ${contentKey}
          FOR UPDATE
        `
        }
        externalWork = publish(assertLease)
        const value = await externalWork
        const indexedAt = new Date()
        // Only the committed body's stage is completed immediately. A superseded in-flight attempt
        // may still have an external request settling after a transaction timeout or worker loss.
        await tx.$executeRaw`
        UPDATE sr_bookmark_object_stage
        SET indexed_at = ${indexedAt}, updated_at = ${indexedAt}
        WHERE bookmark_id = ${bookmarkId}
          AND status = 'published'
          AND indexed_at IS NULL
          AND content_key = ${contentKey}
          AND write_version = ${bookmark.published_version}
      `
        // Keep uncertain older attempts for 30 minutes (past workflow/queue execution limits).
        // The cron rebuilds the current body every cycle until this settling window has elapsed.
        const settledBefore = new Date(Date.now() - 30 * 60_000)
        await tx.$executeRaw`
        UPDATE sr_bookmark_object_stage
        SET indexed_at = ${indexedAt}, updated_at = ${indexedAt}
        WHERE bookmark_id = ${bookmarkId}
          AND status IN ('published', 'retired')
          AND indexed_at IS NULL
          AND content_key <> ${contentKey}
          AND (index_attempted_at IS NULL OR index_attempted_at < ${settledBefore})
      `
        return { committed: true, value }
      })
    } catch (error) {
      // Prisma may time out while an external request is still settling. Wait for it before
      // reopening the current body's durable work item; lease checks stop subsequent mutations.
      await externalWork?.catch(() => undefined)
      await this.markBookmarkSearchIndexPending(bookmarkId)
      throw error
    }
  }

  public async updateBookmarkVersionStatus(bookmarkId: number, version: number, status: string) {
    const res = await this.prismaPg().sr_bookmark.updateMany({
      where: { id: bookmarkId, write_version: version, content_key: '' },
      data: { status, updated_at: new Date() }
    })
    return res.count > 0
  }

  public async publishBookmarkVersion(bookmarkId: number, version: number, info: Partial<bookmarkParsePO>, fork?: BookmarkForkPO | null) {
    const now = new Date()
    const result = await this.prismaPg().$transaction(async tx => {
      const previous = await lockBookmarkObjects(tx, bookmarkId)
      if (!previous) return false
      if (info.content_key) {
        if (previous.write_version === version && previous.published_version === version && previous.content_key === info.content_key) return true
        const stage = await tx.sr_bookmark_object_stage.updateMany({
          where: { content_key: info.content_key, bookmark_id: bookmarkId, write_version: version, status: 'staged' },
          data: { status: 'published', updated_at: now }
        })
        if (stage.count !== 1) return false
      }
      const updated = await tx.sr_bookmark.updateMany({
        where: { id: bookmarkId, write_version: version, published_version: version === 0 ? 0 : { lt: version } },
        data: { ...info, moderation_result: 0, published_version: version, updated_at: now }
      })
      if (updated.count !== 1) {
        if (info.content_key)
          await tx.sr_bookmark_object_stage.updateMany({ where: { content_key: info.content_key, status: 'published' }, data: { status: 'staged', updated_at: now } })
        return false
      }
      await retireBookmarkObjects(tx, previous, info)
      await tx.sr_bookmark_summary.deleteMany({ where: { bookmark_id: bookmarkId } })
      await tx.sr_user_bookmark_overview.deleteMany({ where: { bookmark_id: bookmarkId } })
      await tx.sr_media_article_ref.deleteMany({ where: { bookmark_id: bookmarkId } })
      // A successful HTML/text publication replaces a prior PDF or other media
      // snapshot for the same private URL. Keep the relation's type and sidecar
      // metadata aligned with the committed body so readers cannot render the
      // old PDF surface after the overwrite.
      await tx.$executeRaw`
        UPDATE sr_user_bookmark SET type = 0, metadata = metadata - 'pdf_document_id'
        WHERE bookmark_id = ${bookmarkId} AND (type <> 0 OR metadata ? 'pdf_document_id')
      `
      if (fork) {
        await tx.sr_bookmark_fork.updateMany({
          where: { target_bookmark_id: bookmarkId, status: 'current' },
          data: { status: 'superseded', current_target_id: null, updated_at: now }
        })
        await tx.sr_bookmark_fork.create({
          data: { ...fork, current_target_id: bookmarkId, target_bookmark_id: bookmarkId, write_version: version, status: 'current', updated_at: now }
        })
      } else {
        await tx.sr_bookmark_fork.updateMany({
          where: { target_bookmark_id: bookmarkId, status: 'current' },
          data: { status: 'superseded', current_target_id: null, updated_at: now }
        })
      }
      return true
    })
    return result
  }

  public async getCurrentBookmarkFork(bookmarkId: number) {
    return await this.prismaPg().sr_bookmark_fork.findUnique({ where: { current_target_id: bookmarkId } })
  }

  public async getBookmarkForkForVersion(bookmarkId: number, publishedVersion: number) {
    // Keep lineage tied to the same committed snapshot the reader already loaded,
    // even if another publication supersedes it between the two reads.
    return await this.prismaPg().sr_bookmark_fork.findFirst({
      where: { target_bookmark_id: bookmarkId, write_version: publishedVersion },
      orderBy: { id: 'desc' }
    })
  }

  public async getBookmarkForkByIdempotency(userId: number, idempotencyKey: string) {
    return await this.prismaPg().sr_bookmark_fork.findFirst({ where: { target_user_id: userId, idempotency_key: idempotencyKey }, orderBy: { created_at: 'desc' } })
  }

  public async updateUserBookmarkType(userBookmarkId: number, type: number) {
    return await this.prismaPg().sr_user_bookmark.update({ where: { id: userBookmarkId }, data: { type, updated_at: new Date() } })
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
    const result = await this.prismaPg().sr_bookmark.updateMany({ where: { id: bmId, write_version: 0 }, data: { updated_at: new Date(), ...info } })
    if (result.count !== 1) throw new Error('Legacy bookmark write was superseded')
    return result
  }

  public async updatePdfMetadata(bookmarkId: number, info: { title: string; byline?: string }) {
    return await this.prismaPg().sr_bookmark.updateMany({ where: { id: bookmarkId, write_version: 0 }, data: { ...info, updated_at: new Date() } })
  }

  public async completePdfBookmark(bookmarkId: number, info: Pick<bookmarkParsePO, 'status'> & Partial<bookmarkParsePO>, documentId: string) {
    return this.prismaPg().$transaction(async tx => {
      const updated = await tx.sr_bookmark.updateMany({ where: { id: bookmarkId, write_version: 0 }, data: { ...info, updated_at: new Date() } })
      if (updated.count !== 1) return false
      const relations = await tx.sr_user_bookmark.findMany({ where: { bookmark_id: bookmarkId }, select: { id: true, metadata: true } })
      for (const relation of relations) {
        await tx.sr_user_bookmark.update({
          where: { id: relation.id },
          data: { type: 2, metadata: { ...(relation.metadata as Record<string, Prisma.JsonValue>), pdf_document_id: documentId } }
        })
      }
    })
  }

  public async completePdfBookmarkVersion(
    bookmarkId: number,
    version: number,
    info: Pick<bookmarkParsePO, 'status'> & Partial<bookmarkParsePO>,
    documentId: string,
    expectedContentKey?: string
  ) {
    return await this.prismaPg().$transaction(async tx => {
      const previous = await lockBookmarkObjects(tx, bookmarkId)
      if (!previous) return false
      if (info.content_key) {
        if (previous.write_version === version && previous.published_version === version && previous.content_key === info.content_key) return true
        const stage = await tx.sr_bookmark_object_stage.updateMany({
          where: { content_key: info.content_key, bookmark_id: bookmarkId, write_version: version, status: 'staged' },
          data: { status: 'published', updated_at: new Date() }
        })
        if (stage.count !== 1) return false
      }
      const updated = await tx.sr_bookmark.updateMany({
        where: {
          id: bookmarkId,
          write_version: version,
          published_version: version === 0 ? 0 : expectedContentKey ? { lte: version } : { lt: version },
          ...(expectedContentKey ? { content_key: expectedContentKey } : {})
        },
        data: { ...info, moderation_result: 0, published_version: version, updated_at: new Date() }
      })
      if (updated.count !== 1) {
        if (info.content_key)
          await tx.sr_bookmark_object_stage.updateMany({ where: { content_key: info.content_key, status: 'published' }, data: { status: 'staged', updated_at: new Date() } })
        return false
      }
      await retireBookmarkObjects(tx, previous, info)
      await tx.sr_bookmark_summary.deleteMany({ where: { bookmark_id: bookmarkId } })
      await tx.sr_user_bookmark_overview.deleteMany({ where: { bookmark_id: bookmarkId } })
      await tx.sr_media_article_ref.deleteMany({ where: { bookmark_id: bookmarkId } })
      await tx.$executeRaw`
        UPDATE sr_user_bookmark SET type = 2, metadata = metadata || jsonb_build_object('pdf_document_id', ${documentId}::text)
        WHERE bookmark_id = ${bookmarkId}
      `
      await tx.sr_bookmark_fork.updateMany({
        where: { target_bookmark_id: bookmarkId, status: 'current' },
        data: { status: 'superseded', current_target_id: null, updated_at: new Date() }
      })
      return true
    })
  }

  /** A media job may update its own capture, but cannot touch a newer capture or a Fork. */
  public async publishMediaBookmarkBody(
    bookmarkId: number,
    version: number,
    previousKey: string,
    info: { content_key: string; content_md_key: string; content_word_count: number }
  ) {
    return this.prismaPg().$transaction(async tx => {
      const previous = await lockBookmarkObjects(tx, bookmarkId)
      if (!previous) return false
      const stage = await tx.sr_bookmark_object_stage.updateMany({
        where: { content_key: info.content_key, bookmark_id: bookmarkId, write_version: version, status: 'staged' },
        data: { status: 'published', updated_at: new Date() }
      })
      if (stage.count !== 1) return false
      const updated = await tx.sr_bookmark.updateMany({
        where: { id: bookmarkId, write_version: version, published_version: version, content_key: previousKey, forks: { none: { status: 'current' } } },
        data: { ...info, updated_at: new Date() }
      })
      if (updated.count !== 1) {
        await tx.sr_bookmark_object_stage.updateMany({ where: { content_key: info.content_key, status: 'published' }, data: { status: 'staged' } })
        return false
      }
      await retireBookmarkObjects(tx, previous, info)
      await tx.sr_bookmark_summary.deleteMany({ where: { bookmark_id: bookmarkId } })
      await tx.sr_user_bookmark_overview.deleteMany({ where: { bookmark_id: bookmarkId } })
      return true
    })
  }

  /** The body was replaced (podcast article): keep the word count in step. */
  public async updateBookmarkWordCount(bmId: number, count: number) {
    return await this.prismaPg().sr_bookmark.update({ where: { id: bmId }, data: { content_word_count: count, updated_at: new Date() } })
  }

  /** Publication updates the same row, so the lock covers the check and derived write. */
  private async withContentRevision<T>(
    bookmarkId: number,
    revision: BookmarkContentRevision | undefined,
    write: (tx: HyperdrivePrisma.TransactionClient) => Promise<T>
  ): Promise<T | undefined> {
    if (!revision) return write(this.prismaPg())
    if (!revision.contentKey || !revision.contentMdKey) return undefined
    return this.prismaPg().$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM sr_bookmark
        WHERE id = ${bookmarkId}
          AND write_version = ${revision.writeVersion}
          AND published_version = ${revision.publishedVersion}
          AND content_key = ${revision.contentKey}
          AND content_md_key IS NOT DISTINCT FROM ${revision.contentMdKey}
        FOR UPDATE
      `
      if (rows.length === 0) return undefined
      return write(tx)
    })
  }

  public async upsertBookmarkSummary(info: bookmarkSummaryPO, revision?: BookmarkContentRevision) {
    const { bookmark_id, lang, user_id, ...infoWithoutIds } = info
    return this.withContentRevision(bookmark_id, revision, tx =>
      tx.sr_bookmark_summary.upsert({
        where: { bookmark_id_lang_user_id: { bookmark_id: bookmark_id, lang: lang, user_id: user_id } },
        create: { ...info, created_at: new Date() },
        update: { ...infoWithoutIds, updated_at: new Date() }
      })
    )
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
    // Legacy workflows must not change the status of a bookmark that already has
    // committed content. Keeping the last successful body readable is safer than
    // allowing an old failure callback to mark it failed; versioned writes use the
    // conditional method above.
    return await this.prismaPg().sr_bookmark.updateMany({ where: { id: bmId, write_version: 0, content_key: '' }, data: { status, updated_at: new Date() } })
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

  public async createBookmarkOverview(userId: number, bookmarkId: number, overview: string, content: string, revision?: BookmarkContentRevision) {
    return this.withContentRevision(bookmarkId, revision, tx =>
      tx.sr_user_bookmark_overview.upsert({
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
    )
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
  public async upsertBookmarkTags(bmId: number, userId: number, tags: { id: number; tag_name: string }[], source: BookmarkTagSource = 'ai', revision?: BookmarkContentRevision) {
    if (tags.length < 1) return 0
    const tagIds = tags.map(t => t.id)
    const tagNames = tags.map(t => t.tag_name)
    const onConflict = source === 'user' ? Prisma.sql`DO UPDATE SET is_deleted = false, source = 'user'` : Prisma.sql`DO NOTHING`

    return this.withContentRevision(
      bmId,
      revision,
      tx => tx.$executeRaw`
      INSERT INTO sr_user_bookmark_tag(user_id, bookmark_id, tag_id, tag_name, created_at, source)
      SELECT ${userId}, ${bmId}, tag_id, tag_name, NOW(), ${source}
      FROM UNNEST(${tagIds}::int[], ${tagNames}::text[]) AS t(tag_id, tag_name)
      ON CONFLICT(user_id, bookmark_id, tag_id) ${onConflict};
    `
    )
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
        CASE WHEN user_bookmark.type = 2 THEN 'pdf' WHEN user_bookmark.type = 1 THEN 'shortcut' ELSE 'article' END AS type,
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

  public async updateBookmarkModerationResult(bmId: number, moderationResult: number, writeVersion?: number) {
    const result = await this.clientPg().sr_bookmark.updateMany({
      where: { id: bmId, ...(writeVersion == null ? {} : { write_version: writeVersion }) },
      data: { moderation_result: moderationResult, updated_at: new Date() }
    })
    return result.count === 1
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

  public async createBookmarkImportRelation(userId: number, bookmarkId: number, importId: number, write?: { version: number; createdTarget: boolean }) {
    return await this.clientPg().$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`import-relation:${userId}:${importId}:${bookmarkId}`}, 0))`
      const where = { user_id: userId, bookmark_id: bookmarkId, import_id: importId, write_version: write?.version ?? null }
      const existing = await tx.sr_bookmark_import_relation.findFirst({ where })
      if (existing) return existing
      return await tx.sr_bookmark_import_relation.create({ data: { ...where, ...(write ? { created_target: write.createdTarget } : {}), created_at: new Date() } })
    })
  }

  /** Complete a pending import row once; an older workflow cannot settle another accepted version. */
  public async updateBookmarkImportRelationStatus(userId: number, bookmarkId: number, importId: number, status: number, writeVersion?: number): Promise<boolean> {
    const result = await this.clientPg().sr_bookmark_import_relation.updateMany({
      where: {
        user_id: userId,
        bookmark_id: bookmarkId,
        import_id: importId,
        status: 0,
        write_version: writeVersion ?? null
      },
      data: { status }
    })
    return result.count > 0
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

  public async batchDeleteBookmarksByIds(userId: number, bookmarkIds: number[], importId: number) {
    if (!bookmarkIds?.length) return
    await this.clientPg().$transaction(async tx => {
      const relations = await tx.sr_bookmark_import_relation.findMany({
        where: { user_id: userId, import_id: importId, bookmark_id: { in: bookmarkIds } }
      })
      const deletable: number[] = []
      for (const relation of relations.sort((a, b) => a.bookmark_id - b.bookmark_id)) {
        // Lock in bookmark order so a new save cannot race the version check and deletion.
        const [bookmark] = await tx.$queryRaw<{ id: number; private_user: number; write_version: number }[]>`
          SELECT id, private_user, write_version FROM sr_bookmark WHERE id = ${relation.bookmark_id} FOR UPDATE
        `
        if (!bookmark) continue
        const legacy = relation.created_target == null && relation.write_version == null
        if (legacy || (relation.created_target === true && bookmark.private_user === userId && bookmark.write_version === relation.write_version)) {
          deletable.push(relation.bookmark_id)
        }
      }
      if (deletable.length) {
        const where = { user_id: userId, bookmark_id: { in: [...new Set(deletable)] } }
        await tx.sr_user_delete_bookmark.deleteMany({ where })
        await tx.sr_user_bookmark_tag.deleteMany({ where })
        await tx.sr_user_bookmark.deleteMany({ where })
      }
      // Unlink only this import; another task's rollback ownership and counters remain intact.
      await tx.sr_bookmark_import_relation.deleteMany({ where: { user_id: userId, import_id: importId, bookmark_id: { in: bookmarkIds } } })
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

  public async createAigcBatchTask(userId: number, bookmarkId: number, batchId: string, taskType: string, revision?: BookmarkContentRevision) {
    try {
      await this.clientPg().sr_aigc_batch_task.create({
        data: {
          user_id: userId,
          bookmark_id: bookmarkId,
          task_type: taskType,
          status: AigcBatchTaskStatus.SUBMITTED,
          retry_count: 0,
          batch_request_id: batchId,
          result_data: revision ? JSON.stringify({ contentRevision: revision }) : '',
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
  /** Settle a published Fork import and its destination metadata once per source row. */
  public async applyForkImportMetadata(
    userId: number,
    data: {
      bookmarkId: number
      bookmarkUid: string
      importId: number
      operationKey: string
      savedAt?: Date
      isArchive: boolean
      isStarred: boolean
      tags: string[]
    }
  ): Promise<boolean> {
    const receiptKey = `import-meta:${data.operationKey}`
    return await this.prismaPg().$transaction(async tx => {
      // Serialize metadata receipts with each other and with the target publication/version lock.
      const [current] = await tx.$queryRaw<{ id: number; write_version: number; published_version: number }[]>`
        SELECT id, write_version, published_version FROM sr_bookmark
        WHERE id = ${data.bookmarkId} AND private_user = ${userId} FOR UPDATE
      `
      if (!current) throw BookmarkNotFoundError()
      const prior = await tx.sr_bookmark_save_receipt.findUnique({ where: { user_id_operation_key: { user_id: userId, operation_key: receiptKey } } })
      if (prior) return false
      const operation = await tx.sr_bookmark_fork_operation.findUnique({ where: { user_id_idempotency_key: { user_id: userId, idempotency_key: data.operationKey } } })
      if (!operation?.result || operation.target_bookmark_id !== data.bookmarkId || operation.target_uuid !== data.bookmarkUid) throw BookmarkNotFoundError()

      const isCurrent = current.write_version === operation.write_version && current.published_version === operation.write_version
      const now = new Date()
      if (isCurrent) {
        if (operation.write_mode === 'created') {
          await tx.sr_user_bookmark.update({
            where: { user_id_bookmark_id: { user_id: userId, bookmark_id: data.bookmarkId } },
            data: {
              ...(data.savedAt && Number.isFinite(data.savedAt.getTime()) ? { created_at: data.savedAt } : {}),
              archive_status: data.isArchive ? 1 : 0,
              is_starred: data.isStarred,
              updated_at: now
            }
          })
        }
        const names = [...new Set(data.tags.map(tag => tag.trim()).filter(Boolean))]
        for (const tagName of names) {
          const tag = await tx.sr_user_tag.upsert({
            where: { user_id_tag_name: { user_id: userId, tag_name: tagName } },
            create: { user_id: userId, tag_name: tagName, display: true, source: 'auto', last_used_at: now },
            update: { display: true, last_used_at: now }
          })
          await tx.sr_user_bookmark_tag.upsert({
            where: { bookmark_id_user_id_tag_id: { bookmark_id: data.bookmarkId, user_id: userId, tag_id: tag.id } },
            create: { bookmark_id: data.bookmarkId, user_id: userId, tag_id: tag.id, tag_name: tag.tag_name, source: 'user' },
            update: { is_deleted: false, source: 'user', tag_name: tag.tag_name }
          })
        }
      }
      await tx.sr_bookmark_import_relation.create({
        data: {
          user_id: userId,
          bookmark_id: data.bookmarkId,
          import_id: data.importId,
          status: 1,
          write_version: operation.write_version,
          created_target: operation.write_mode === 'created',
          created_at: now
        }
      })
      await tx.sr_bookmark_save_receipt.create({
        data: { user_id: userId, operation_key: receiptKey, target_bookmark_id: data.bookmarkId, target_uuid: data.bookmarkUid, write_version: operation.write_version }
      })
      return true
    })
  }
}
