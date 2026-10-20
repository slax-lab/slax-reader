import { validatePdfSources, isPdfContentKey } from '@slax-reader/contracts/pdf'
import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import { LazyInstance } from '@/decorators/lazy'
import { Prisma, PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import {
  CreateCommentData,
  OrderedSyncOperation,
  UpdateShareData,
  CreateTagData,
  CreateBookmarkData,
  UpdateBookmarkData,
  UpdateTagsData,
  DeleteCommentData
} from '@/domain/orchestrator/sync'
import { CommentTooLongError, ErrorMarkTypeError, MarkLineTooLongError, ShareActionNotAllowedError } from '@/const/err'
import { markType } from '@/infra/repository/dbMark'

export type prismaTx = Omit<HyperdrivePrismaClient<Prisma.PrismaClientOptions>, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>
export interface SyncBookmarkWrite {
  bookmarkId: number
  targetUrl: string
  userId: number
  writeVersion: number
  bookmarkUuid: string
  requestedBookmarkUuid: string
  replayed?: boolean
  replayWorkflow?: boolean
}
export type executeFunction = (tx: prismaTx, operation: OrderedSyncOperation) => Promise<SyncBookmarkWrite | null | void>

export interface SyncEntitySnapshot {
  uuid: string
  user_id: number
  type: number
  user_bookmark_uuid?: string
  archive_status?: number
  is_starred?: boolean
  deleted_at?: Date | null
  is_deleted?: boolean
  bookmark?: { target_url: string }
}

export interface CommittedSyncMutation {
  operation: OrderedSyncOperation
  before: SyncEntitySnapshot | null
  after: SyncEntitySnapshot | null
}

export type SyncCommitObserver = (mutations: CommittedSyncMutation[], committedAt: string) => Promise<void> | void

@injectable()
export class DBSyncBatchOperation {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) public prismaHyperdrive: LazyInstance<HyperdrivePrismaClient>) {}

  /** execute */
  public async executeOrderedOperations(operations: OrderedSyncOperation[], observer?: SyncCommitObserver): Promise<SyncBookmarkWrite[]> {
    if (operations.length === 0) return []

    const newBookmarks: SyncBookmarkWrite[] = []
    const mutations: CommittedSyncMutation[] = []
    const uuidRemap = new Map<string, string>()
    const executeMap: Record<string, executeFunction> = {
      create_tag: this.executeCreateTag,
      create_bookmark: this.executeCreateBookmark,
      update_bookmark: this.executeUpdateBookmark,
      update_tags: this.executeUpdateTags,
      update_share: this.executeUpdateShare,
      delete_bookmark: this.executeDeleteBookmark,
      restore_bookmark: this.executeRestoreBookmark,
      create_comment: this.executeCreateComment,
      delete_comment: this.executeDeleteComment
    }

    await this.prismaHyperdrive().$transaction(async tx => {
      for (const operation of operations) {
        const mappedOperation = this.remapOperation(operation, uuidRemap)
        const before = observer ? await this.eventSnapshot(tx, mappedOperation) : null
        const result = await executeMap[mappedOperation.type].bind(this)(tx, mappedOperation)
        if (result) newBookmarks.push(result)
        if (result?.requestedBookmarkUuid && result.bookmarkUuid && result.requestedBookmarkUuid !== result.bookmarkUuid) {
          uuidRemap.set(result.requestedBookmarkUuid, result.bookmarkUuid)
        }
        if (observer && !result?.replayed) {
          const publishedOperation = result && mappedOperation.type === 'create_bookmark' ? { ...mappedOperation, bookmarkUuid: result.bookmarkUuid } : mappedOperation
          const after = await this.eventSnapshot(tx, publishedOperation)
          if (before || after) mutations.push({ operation: publishedOperation, before, after })
        }
      }
    })

    // A rolled-back batch never reaches this observer. Telemetry cannot fail an already-committed sync.
    if (observer) {
      try {
        await observer(mutations, new Date().toISOString())
      } catch (error) {
        console.error('[events] sync observer failed:', error)
      }
    }

    return newBookmarks
  }

  private remapOperation(operation: OrderedSyncOperation, uuidRemap: Map<string, string>): OrderedSyncOperation {
    const mapUuid = (uuid: string) => uuidRemap.get(uuid) ?? uuid
    // A PUT UUID identifies the client operation; remapping it would create a new receipt on retry.
    if (operation.type === 'create_bookmark') return operation
    if (operation.type === 'create_comment') {
      return { ...operation, data: { ...operation.data, userBookmarkUuid: mapUuid(operation.data.userBookmarkUuid) } }
    }
    if ('bookmarkUuid' in operation) {
      const bookmarkUuid = mapUuid(operation.bookmarkUuid)
      return { ...operation, bookmarkUuid }
    }
    return operation
  }

  private async eventSnapshot(tx: prismaTx, operation: OrderedSyncOperation): Promise<SyncEntitySnapshot | null> {
    if (['create_bookmark', 'update_bookmark', 'delete_bookmark'].includes(operation.type) && 'bookmarkUuid' in operation) {
      return tx.sr_user_bookmark.findFirst({
        where: { uuid: operation.bookmarkUuid, user_id: operation.userId },
        select: { uuid: true, user_id: true, type: true, archive_status: true, is_starred: true, deleted_at: true, bookmark: { select: { target_url: true } } }
      })
    }
    if (operation.type === 'create_comment' || operation.type === 'delete_comment') {
      return tx.sr_bookmark_comment.findFirst({
        where: { uuid: operation.commentUuid, user_id: operation.userId },
        select: { uuid: true, user_id: true, user_bookmark_uuid: true, type: true, is_deleted: true }
      })
    }
    return null
  }

  /** create tag */
  public async executeCreateTag(tx: prismaTx, operation: OrderedSyncOperation): Promise<void> {
    if (operation.type !== 'create_tag') return

    const { tagName } = operation.data as CreateTagData
    const tagUuid = operation.tagUuid

    await tx.sr_user_tag.upsert({
      where: { user_id_tag_name: { user_id: operation.userId, tag_name: tagName } },
      create: {
        user_id: operation.userId,
        tag_name: tagName,
        display: true,
        created_at: new Date(),
        uuid: tagUuid,
        // only users create tags through sync, so the word is theirs
        source: 'mine'
      },
      update: {
        display: true,
        source: 'mine'
      }
    })
  }

  /** create bookmark */
  public async executeCreateBookmark(tx: prismaTx, operation: OrderedSyncOperation): Promise<SyncBookmarkWrite | null> {
    if (operation.type !== 'create_bookmark') return null

    const { targetUrl: rawTargetUrl, title, thumbnail, description, isArchive } = operation.data as CreateBookmarkData
    const targetUrl = new URL(rawTargetUrl).toString()
    const now = new Date()
    const receiptKey = `sync:${operation.bookmarkUuid}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bookmark-save:${operation.userId}:${receiptKey}`}, 0))`
    const receipt = await tx.sr_bookmark_save_receipt.findUnique({
      where: { user_id_operation_key: { user_id: operation.userId, operation_key: receiptKey } }
    })
    if (receipt) {
      const current = await tx.sr_bookmark.findUnique({
        where: { id: receipt.target_bookmark_id },
        select: { target_url: true, write_version: true, published_version: true }
      })
      const replayWorkflow = !!current && current.write_version === receipt.write_version && current.published_version < receipt.write_version
      return {
        bookmarkId: receipt.target_bookmark_id,
        targetUrl: current?.target_url ?? targetUrl,
        userId: operation.userId,
        writeVersion: receipt.write_version,
        bookmarkUuid: receipt.target_uuid,
        requestedBookmarkUuid: operation.bookmarkUuid,
        replayed: true,
        replayWorkflow
      }
    }

    const bookmark = await tx.sr_bookmark.upsert({
      where: { target_url_private_user: { target_url: targetUrl, private_user: operation.userId } },
      create: {
        target_url: targetUrl,
        title,
        host_url: new URL(targetUrl).origin,
        content_icon: thumbnail || '',
        content_cover: '',
        description: description || '',
        private_user: operation.userId,
        status: 'pending',
        created_at: now,
        updated_at: now,
        published_at: now,
        write_version: 1
      },
      update: {
        updated_at: now,
        write_version: { increment: 1 }
      }
    })

    const existingByUuid = await tx.sr_user_bookmark.findUnique({
      where: { uuid: operation.bookmarkUuid }
    })

    if (existingByUuid && existingByUuid.user_id !== operation.userId) {
      throw ShareActionNotAllowedError()
    }

    // re-save bumps created_at (save time, tops inbox); replay may re-top
    let relation: { uuid: string }
    if (existingByUuid) {
      relation = await tx.sr_user_bookmark.update({
        where: { uuid: operation.bookmarkUuid, user_id: operation.userId },
        data: {
          bookmark_id: bookmark.id,
          ...(isPdfContentKey(bookmark.content_key) ? { type: 2 } : {}),
          deleted_at: null,
          archive_status: isArchive ? 1 : 0,
          created_at: new Date(),
          updated_at: new Date()
        }
      })
    } else {
      relation = await tx.sr_user_bookmark.upsert({
        where: { user_id_bookmark_id: { user_id: operation.userId, bookmark_id: bookmark.id } },
        create: {
          uuid: operation.bookmarkUuid,
          user_id: operation.userId,
          bookmark_id: bookmark.id,
          type: isPdfContentKey(bookmark.content_key) ? 2 : 0,
          archive_status: isArchive ? 1 : 0,
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date()
        },
        update: {
          ...(isPdfContentKey(bookmark.content_key) ? { type: 2 } : {}),
          deleted_at: null,
          archive_status: isArchive ? 1 : 0,
          created_at: new Date(),
          updated_at: new Date()
        }
      })
    }

    await tx.sr_user_delete_bookmark.deleteMany({
      where: { user_id: operation.userId, bookmark_id: bookmark.id }
    })

    await tx.sr_bookmark_save_receipt.create({
      data: {
        user_id: operation.userId,
        operation_key: receiptKey,
        target_bookmark_id: bookmark.id,
        target_uuid: relation.uuid,
        write_version: bookmark.write_version,
        created_at: now
      }
    })

    return {
      bookmarkId: bookmark.id,
      targetUrl,
      userId: operation.userId,
      writeVersion: bookmark.write_version,
      bookmarkUuid: relation.uuid,
      requestedBookmarkUuid: operation.bookmarkUuid
    }
  }

  /** update bookmark */
  public async executeUpdateBookmark(tx: prismaTx, operation: OrderedSyncOperation): Promise<void> {
    if (operation.type !== 'update_bookmark') return

    const updateData = { ...(operation.data as UpdateBookmarkData), updated_at: new Date() }

    await tx.sr_user_bookmark.update({
      where: { uuid: operation.bookmarkUuid, user_id: operation.userId },
      data: updateData
    })
  }

  /** update bookmark tags */
  public async executeUpdateTags(tx: prismaTx, operation: OrderedSyncOperation): Promise<void> {
    if (operation.type !== 'update_tags') return

    const { tagsToAdd, tagsToDelete } = operation.data as UpdateTagsData
    const { userId, bookmarkUuid } = operation

    if (tagsToDelete.length > 0) {
      await tx.$executeRaw`
        UPDATE sr_user_bookmark_tag
        SET is_deleted = true
        WHERE bookmark_id = (SELECT bookmark_id from sr_user_bookmark where uuid = ${bookmarkUuid})
        AND tag_id IN (SELECT id FROM sr_user_tag WHERE uuid in (${Prisma.join(tagsToDelete.map(uuid => Prisma.sql`${uuid}`))})) AND user_id = ${userId}`

      // an auto tag with no live link left is hidden; a "mine" tag stays even at zero
      await tx.$executeRaw`
        UPDATE sr_user_tag t
        SET display = false
        WHERE t.uuid IN (${Prisma.join(tagsToDelete.map(uuid => Prisma.sql`${uuid}`))})
          AND t.user_id = ${userId}
          AND t.source = 'auto'
          AND NOT EXISTS (
            SELECT 1 
            FROM sr_user_bookmark_tag bt
            WHERE bt.tag_id = t.id 
              AND bt.user_id = t.user_id
              AND bt.is_deleted = false
          );`
    }

    if (tagsToAdd.length > 0) {
      await tx.$executeRaw`
        INSERT INTO sr_user_bookmark_tag(user_id, bookmark_id, tag_id, tag_name, is_deleted, created_at, source)
        SELECT 
          ${userId}, 
          (SELECT bookmark_id FROM sr_user_bookmark WHERE uuid = ${bookmarkUuid} AND user_id = ${userId}),
          ut.id,
          ut.tag_name,
          false,
          ${new Date()},
          'user'
        FROM sr_user_tag ut
        WHERE ut.user_id = ${userId}
          AND ut.uuid IN (${Prisma.join(tagsToAdd.map(uuid => Prisma.sql`${uuid}`))})
        ON CONFLICT(user_id, bookmark_id, tag_id) 
        DO UPDATE SET is_deleted = false, source = 'user'
      `

      // sync writes are user actions: show the word again and bump recency
      await tx.$executeRaw`
        UPDATE sr_user_tag 
        SET display = true, last_used_at = NOW()
        WHERE uuid IN (${Prisma.join(tagsToAdd.map(uuid => Prisma.sql`${uuid}`))})
          AND user_id = ${userId}
      `
    }
  }

  /** soft delete bookmark */
  public async executeDeleteBookmark(tx: prismaTx, operation: OrderedSyncOperation): Promise<void> {
    if (operation.type !== 'delete_bookmark') return

    await tx.sr_user_bookmark.update({
      where: { uuid: operation.bookmarkUuid, user_id: operation.userId },
      data: { deleted_at: new Date() }
    })
  }

  /** restore bookmark */
  public async executeRestoreBookmark(tx: prismaTx, operation: OrderedSyncOperation): Promise<void> {
    if (operation.type !== 'restore_bookmark') return

    await tx.sr_user_bookmark.update({
      where: { uuid: operation.bookmarkUuid, user_id: operation.userId },
      data: { deleted_at: null, archive_status: 0 }
    })
  }

  private async createBookmarkComment(tx: prismaTx, operation: OrderedSyncOperation): Promise<void> {
    if (operation.type !== 'create_comment') return

    const { userBookmarkUuid, type, source, comment, rootUuid, parentUuid, approxSource, content, sourceType, sourceId } = operation.data as CreateCommentData

    if (type === markType.LINE && comment) throw ErrorMarkTypeError()
    if (type === markType.COMMENT && (!comment || comment.length < 1)) throw ErrorMarkTypeError()
    if (type === markType.REPLY && (!comment || comment.length < 1)) throw ErrorMarkTypeError()
    if ([markType.ORIGIN_COMMENT, markType.ORIGIN_LINE].includes(type) && !approxSource) throw ErrorMarkTypeError()
    if (comment && comment.length > 1500) throw CommentTooLongError()

    // 校验 source 长度（非回复类型）
    if (type !== markType.REPLY) {
      try {
        const sourceItems = JSON.parse(source) as Array<{ type: string; start: number; end: number }>
        if (Array.isArray(sourceItems)) {
          let sourceLength = 0
          let sourceImageCount = 0
          sourceItems.forEach(item => {
            if (item.type === 'image') sourceImageCount++
            else sourceLength += (item.end || 0) - (item.start || 0)
          })
          if (sourceLength > 1000 || sourceImageCount > 3) throw MarkLineTooLongError()
        }
      } catch (e) {
        if (e instanceof Error && (e.message.includes('MarkLine') || e.message.includes('MARK_LINE'))) throw e
      }
    }

    const userBookmark = await tx.sr_user_bookmark.findUnique({
      where: { uuid: userBookmarkUuid },
      include: { bookmark: true }
    })
    if (!userBookmark?.bookmark) throw ShareActionNotAllowedError()
    if (type !== markType.REPLY) {
      let parsed: unknown
      try {
        parsed = JSON.parse(source)
      } catch {
        if (isPdfContentKey(userBookmark.bookmark.content_key)) throw ShareActionNotAllowedError()
      }
      if (parsed !== undefined)
        try {
          const documentId = (userBookmark.metadata as { pdf_document_id?: string })?.pdf_document_id
          const pdfLength = validatePdfSources(parsed, documentId || '')
          if (isPdfContentKey(userBookmark.bookmark.content_key) !== (pdfLength !== undefined)) throw ShareActionNotAllowedError()
        } catch {
          throw ShareActionNotAllowedError()
        }
    }

    const isVisitor = userBookmark.user_id !== operation.userId
    if (isVisitor) {
      if (type !== markType.REPLY || userBookmark.deleted_at || userBookmark.bookmark.moderation_result > 0) throw ShareActionNotAllowedError()
      const owner = await tx.sr_user.findUnique({ where: { id: userBookmark.user_id } })
      if (!owner || owner.deleted_at) throw ShareActionNotAllowedError()
      const share = await tx.sr_bookmark_share.findFirst({
        where: { bookmark_id: userBookmark.bookmark_id, user_id: userBookmark.user_id }
      })
      if (share) {
        if (!share.is_enable || !share.allow_comment || !share.allow_line) throw ShareActionNotAllowedError()
      } else if (!owner.snapshot_sharing) {
        throw ShareActionNotAllowedError()
      }
    }

    let rootId = 0
    let parentId = 0

    if (rootUuid && type !== markType.REPLY) {
      const rootComment = await tx.sr_bookmark_comment.findUnique({ where: { uuid: rootUuid } })
      if (!rootComment || rootComment.bookmark_id !== userBookmark.id || rootComment.is_deleted) throw ShareActionNotAllowedError()
      rootId = rootComment.id
    }

    if (type === markType.REPLY) {
      if (!parentUuid) throw ShareActionNotAllowedError()
      const parentComment = await tx.sr_bookmark_comment.findUnique({ where: { uuid: parentUuid } })
      if (!parentComment || parentComment.bookmark_id !== userBookmark.id || parentComment.is_deleted) throw ShareActionNotAllowedError()
      if (isVisitor && ![markType.COMMENT, markType.ORIGIN_COMMENT, markType.REPLY].includes(parentComment.type)) throw ShareActionNotAllowedError()
      parentId = parentComment.id
      rootId = parentComment.root_id > 0 ? parentComment.root_id : parentComment.id
    }

    const finalSourceType = sourceType || 'bookmark'
    const finalSourceId = sourceId || userBookmark.id.toString()

    const created = await tx.sr_bookmark_comment.create({
      data: {
        uuid: operation.commentUuid,
        user_id: operation.userId,
        bookmark_id: userBookmark.id,
        user_bookmark_uuid: userBookmarkUuid,
        type,
        source: isVisitor ? '[]' : source,
        comment,
        root_id: rootId,
        parent_id: parentId,
        approx_source: isVisitor ? '' : approxSource,
        content: isVisitor ? '[]' : content,
        source_type: finalSourceType,
        source_id: finalSourceId,
        is_deleted: false,
        created_at: new Date(),
        updated_at: new Date()
      }
    })

    if ([markType.COMMENT, markType.ORIGIN_COMMENT].includes(type) && rootId === 0) {
      await tx.sr_bookmark_comment.update({
        where: { id: created.id },
        data: { root_id: created.id, updated_at: new Date() }
      })
    }
  }

  /** soft delete comment */
  public async executeDeleteComment(tx: prismaTx, operation: OrderedSyncOperation): Promise<void> {
    if (operation.type !== 'delete_comment') return

    const { isDeleted } = operation.data as DeleteCommentData

    const commentRecord = await tx.sr_bookmark_comment.findUnique({
      where: { uuid: operation.commentUuid }
    })
    if (!commentRecord) return

    // 权限校验：评论作者可删除自己的评论，书签拥有者可删除其书签下的任意评论
    if (commentRecord.user_id !== operation.userId) {
      // bookmark_id 存的是 sr_user_bookmark.id，用 id 去查
      const userBookmark = await tx.sr_user_bookmark.findFirst({
        where: { id: commentRecord.bookmark_id, user_id: operation.userId }
      })
      if (!userBookmark) throw ShareActionNotAllowedError()
    }

    const isComment = [markType.COMMENT, markType.ORIGIN_COMMENT, markType.REPLY].includes(commentRecord.type)
    if (!isComment) {
      await tx.sr_bookmark_comment.deleteMany({ where: { uuid: operation.commentUuid } })
      return
    }

    const rootId = commentRecord.root_id > 0 ? commentRecord.root_id : commentRecord.id
    const liveThreadMember = await tx.sr_bookmark_comment.findFirst({
      where: {
        bookmark_id: commentRecord.bookmark_id,
        root_id: rootId,
        is_deleted: false,
        uuid: { not: operation.commentUuid }
      },
      select: { id: true }
    })

    if (liveThreadMember) {
      await tx.sr_bookmark_comment.update({
        where: { uuid: operation.commentUuid },
        data: { is_deleted: isDeleted, updated_at: new Date() }
      })
      return
    }

    await tx.sr_bookmark_comment.deleteMany({
      where: { bookmark_id: commentRecord.bookmark_id, root_id: rootId }
    })
  }

  public async executeUpdateShare(tx: prismaTx, operation: OrderedSyncOperation): Promise<void> {
    if (operation.type !== 'update_share') return

    const { isEnable } = operation.data as UpdateShareData
    if (isEnable) {
      await tx.$executeRaw`
        UPDATE sr_bookmark_share SET is_enable = ${isEnable}
        WHERE bookmark_id = (
          SELECT bookmark_id FROM sr_user_bookmark
          WHERE uuid = ${operation.bookmarkUuid} AND user_id = ${operation.userId}
        ) AND user_id = ${operation.userId}
      `
      return
    }

    await tx.$executeRaw`
      INSERT INTO sr_bookmark_share (
        share_code, user_id, bookmark_id,
        show_line, show_comment, show_userinfo,
        allow_comment, allow_line, is_enable, created_at
      )
      SELECT '', ${operation.userId}, bookmark_id,
        false, false, false,
        false, false, false, CURRENT_TIMESTAMP
      FROM sr_user_bookmark
      WHERE uuid = ${operation.bookmarkUuid}
        AND user_id = ${operation.userId}
      ON CONFLICT (bookmark_id, user_id)
      DO UPDATE SET is_enable = false
    `
  }

  public async executeCreateComment(tx: prismaTx, operation: OrderedSyncOperation): Promise<void> {
    if (operation.type !== 'create_comment') return

    const data = operation.data as CreateCommentData
    if (data.sourceType !== 'collection') return this.createBookmarkComment(tx, operation)

    const { userBookmarkUuid, type, source, comment, rootUuid, parentUuid, approxSource, content, sourceId } = data
    if (sourceId !== userBookmarkUuid) throw ShareActionNotAllowedError()
    if (type === markType.LINE && comment) throw ErrorMarkTypeError()
    if ([markType.COMMENT, markType.REPLY].includes(type) && !comment) throw ErrorMarkTypeError()
    if ([markType.ORIGIN_COMMENT, markType.ORIGIN_LINE].includes(type) && !approxSource) throw ErrorMarkTypeError()
    if (comment && comment.length > 1500) throw CommentTooLongError()

    if (type !== markType.REPLY) {
      let sourceItems: Array<{ type: string; start: number; end: number }> | null = null
      try {
        const parsed = JSON.parse(source)
        if (Array.isArray(parsed)) sourceItems = parsed
      } catch {}

      if (sourceItems) {
        const sourceLength = sourceItems.reduce((sum, item) => sum + (item.type === 'image' ? 0 : (item.end || 0) - (item.start || 0)), 0)
        const sourceImageCount = sourceItems.filter(item => item.type === 'image').length
        if (sourceLength > 1000 || sourceImageCount > 3) throw MarkLineTooLongError()
      }
    }

    const sharePermission = [markType.LINE, markType.ORIGIN_LINE].includes(type) ? Prisma.sql`share.allow_line` : Prisma.sql`share.allow_comment`

    const rows = await tx.$queryRaw<Array<{ id: number; collection_code: string; content_key: string; metadata: unknown }>>(Prisma.sql`
      SELECT bookmark.id, collection.collection_code, article.content_key, bookmark.metadata
      FROM sr_user_bookmark AS bookmark
      INNER JOIN sr_user_collection AS collection
        ON collection.owner_id = bookmark.user_id
      INNER JOIN sr_user AS owner ON owner.id = bookmark.user_id AND owner.deleted_at IS NULL
      INNER JOIN sr_bookmark AS article ON article.id = bookmark.bookmark_id
      WHERE bookmark.uuid = ${userBookmarkUuid}
        AND bookmark.deleted_at IS NULL
        AND bookmark.is_starred = true
        AND (
          bookmark.user_id = ${operation.userId}
          OR (
            article.moderation_result = 0
            AND (
              collection.status = 1
              OR (collection.status = 0 AND EXISTS (
                SELECT 1 FROM sr_user_collection_subscriber subscriber
                WHERE subscriber.collection_id = collection.id AND subscriber.user_id = ${operation.userId}
                  AND subscriber.is_deleted = false AND subscriber.subscription_end_time > CURRENT_TIMESTAMP
              ))
            )
            AND COALESCE((
              SELECT share.is_enable AND ${sharePermission}
              FROM sr_bookmark_share AS share
              WHERE share.bookmark_id = bookmark.bookmark_id
                AND share.user_id = bookmark.user_id
              LIMIT 1
            ), false)
          )
        )
      LIMIT 1
    `)
    const collectionBookmark = rows[0]
    if (!collectionBookmark) throw ShareActionNotAllowedError()
    if (type !== markType.REPLY) {
      let parsed: unknown
      try {
        parsed = JSON.parse(source)
      } catch {
        if (isPdfContentKey(collectionBookmark.content_key)) throw ShareActionNotAllowedError()
      }
      if (parsed !== undefined)
        try {
          const documentId = (collectionBookmark.metadata as { pdf_document_id?: string })?.pdf_document_id
          const pdfLength = validatePdfSources(parsed, documentId || '')
          if (isPdfContentKey(collectionBookmark.content_key) !== (pdfLength !== undefined)) throw ShareActionNotAllowedError()
        } catch {
          throw ShareActionNotAllowedError()
        }
    }

    let rootId = 0
    let parentId = 0
    if (rootUuid && type !== markType.REPLY) {
      const rootComment = await tx.sr_bookmark_comment.findUnique({ where: { uuid: rootUuid } })
      if (!rootComment || rootComment.bookmark_id !== collectionBookmark.id || rootComment.is_deleted) throw ShareActionNotAllowedError()
      rootId = rootComment.id
    }
    if (type === markType.REPLY) {
      if (!parentUuid) throw ShareActionNotAllowedError()
      const parentComment = await tx.sr_bookmark_comment.findUnique({ where: { uuid: parentUuid } })
      if (!parentComment || parentComment.bookmark_id !== collectionBookmark.id || parentComment.is_deleted) throw ShareActionNotAllowedError()
      parentId = parentComment.id
      rootId = parentComment.root_id > 0 ? parentComment.root_id : parentComment.id
    }

    const created = await tx.sr_bookmark_comment.create({
      data: {
        uuid: operation.commentUuid,
        user_id: operation.userId,
        bookmark_id: collectionBookmark.id,
        user_bookmark_uuid: userBookmarkUuid,
        type,
        source,
        comment,
        root_id: rootId,
        parent_id: parentId,
        approx_source: approxSource,
        content,
        source_type: 'collection',
        source_id: `${collectionBookmark.collection_code}/${collectionBookmark.id}`,
        is_deleted: false,
        created_at: new Date(),
        updated_at: new Date()
      }
    })

    if ([markType.COMMENT, markType.ORIGIN_COMMENT].includes(type) && rootId === 0) {
      await tx.sr_bookmark_comment.update({
        where: { id: created.id },
        data: { root_id: created.id, updated_at: new Date() }
      })
    }
  }
}
