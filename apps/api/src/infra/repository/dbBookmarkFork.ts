import { randomUUID } from 'crypto'
import { Prisma, PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import type { BookmarkForkPO, bookmarkParsePO } from '@/infra/repository/dbBookmark'
import type { BookmarkForkResponse } from '@slax-reader/contracts'
import { BookmarkWriteConflictError, ErrorParam } from '@/const/err'
import { lockBookmarkObjects, retireBookmarkObjects } from './bookmarkObjectLifecycle'

export interface ForkOperation {
  id: number
  user_id: number
  source_uuid: string
  target_bookmark_id: number
  target_uuid: string
  write_version: number
  attempt_token: string
  write_mode: string
  status: string
  staged_keys: string[]
  cleanup_token?: string | null
  result?: unknown
}

type SourceArticle = {
  target_url: string
  title: string
  host_url: string
  site_name: string
  content_icon: string
  content_cover: string
  description: string
}

@injectable()
export class BookmarkForkRepo {
  constructor(
    @inject(PRISIMA_HYPERDRIVE_CLIENT)
    private prisma: LazyInstance<HyperdrivePrismaClient>
  ) {}

  public async findOperation(userId: number, idempotencyKey: string): Promise<ForkOperation | null> {
    const row = await this.prisma().sr_bookmark_fork_operation.findUnique({
      where: {
        user_id_idempotency_key: {
          user_id: userId,
          idempotency_key: idempotencyKey
        }
      }
    })
    return row ? this.decode(row) : null
  }

  public async begin(userId: number, idempotencyKey: string, sourceUuid: string, article: SourceArticle, type: number, preferredBookmarkUid?: string): Promise<ForkOperation> {
    return await this.prisma().$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bookmark-fork:${userId}:${idempotencyKey}`}, 0))`
      const previous = await tx.sr_bookmark_fork_operation.findUnique({
        where: {
          user_id_idempotency_key: {
            user_id: userId,
            idempotency_key: idempotencyKey
          }
        }
      })
      if (previous) {
        if (previous.source_uuid !== sourceUuid) throw ErrorParam()
        if (previous.result) return this.decode(previous)
        if (!['failed', 'abandoned'].includes(previous.status)) throw BookmarkWriteConflictError()
      }
      const [existing] = await tx.$queryRaw<Array<{ id: number; write_version: number; published_version: number }>>`
        SELECT id, write_version, published_version FROM sr_bookmark
        WHERE target_url = ${article.target_url} AND private_user = ${userId} FOR UPDATE
      `
      if (previous) {
        // Follow the target -> operation -> stage lock order used by deletion/publication.
        const fenced = await tx.sr_bookmark_fork_operation.updateMany({
          where: { id: previous.id, attempt_token: previous.attempt_token, status: { in: ['failed', 'abandoned'] } },
          data: { status: 'abandoned', cleanup_token: null, updated_at: new Date() }
        })
        if (fenced.count !== 1) throw BookmarkWriteConflictError()
      }
      const retryVersion = previous?.write_version
      if (previous && (!existing || existing.id !== previous.target_bookmark_id || existing.write_version !== retryVersion || existing.published_version >= previous.write_version))
        throw BookmarkWriteConflictError()
      const target =
        existing ??
        (await tx.sr_bookmark.upsert({
          where: {
            target_url_private_user: {
              target_url: article.target_url,
              private_user: userId
            }
          },
          create: {
            title: article.title,
            host_url: article.host_url,
            target_url: article.target_url,
            site_name: article.site_name,
            content_icon: article.content_icon,
            content_cover: article.content_cover,
            description: article.description,
            private_user: userId,
            status: 'pending',
            created_at: new Date(),
            updated_at: new Date(),
            published_at: new Date()
          },
          update: {},
          select: { id: true }
        }))
      const versioned =
        retryVersion != null
          ? { write_version: retryVersion }
          : await tx.sr_bookmark.update({
              where: { id: target.id },
              data: { write_version: { increment: 1 }, updated_at: new Date() },
              select: { write_version: true }
            })
      const relation = await tx.sr_user_bookmark.upsert({
        where: {
          user_id_bookmark_id: { user_id: userId, bookmark_id: target.id }
        },
        create: {
          ...(preferredBookmarkUid ? { uuid: preferredBookmarkUid } : {}),
          user_id: userId,
          bookmark_id: target.id,
          type,
          created_at: new Date(),
          updated_at: new Date()
        },
        update: {},
        select: { uuid: true }
      })
      const attemptToken = randomUUID()
      const operation = {
        user_id: userId,
        idempotency_key: idempotencyKey,
        source_uuid: sourceUuid,
        target_bookmark_id: target.id,
        target_uuid: relation.uuid,
        write_version: versioned.write_version,
        attempt_token: attemptToken,
        write_mode: previous?.write_mode ?? (existing ? 'overwritten' : 'created'),
        status: 'copying',
        staged_keys: [] as string[],
        cleanup_token: null,
        error_code: null,
        updated_at: new Date()
      }
      const row = previous
        ? await tx.sr_bookmark_fork_operation.update({
            where: { id: previous.id },
            data: operation
          })
        : await tx.sr_bookmark_fork_operation.create({ data: operation })
      return this.decode(row)
    })
  }

  public async setStagedKeys(operationId: number, attemptToken: string, keys: string[]) {
    await this.prisma().$transaction(async tx => {
      const [row] = await tx.$queryRaw<Array<{ target_bookmark_id: number; write_version: number }>>`
        UPDATE sr_bookmark_fork_operation SET staged_keys = ${keys}::text[], updated_at = NOW()
        WHERE id = ${operationId} AND attempt_token = ${attemptToken} AND status = 'copying'
        RETURNING target_bookmark_id, write_version
      `
      if (!row) throw BookmarkWriteConflictError()
      await tx.sr_bookmark_object_stage.upsert({
        where: {
          content_key: keys[0] || `fork-stage/${operationId}/${attemptToken}`
        },
        create: {
          content_key: keys[0] || `fork-stage/${operationId}/${attemptToken}`,
          bookmark_id: row.target_bookmark_id,
          write_version: row.write_version,
          keys,
          status: 'staged',
          updated_at: new Date()
        },
        update: {}
      })
    })
  }

  public async publish(
    operation: ForkOperation,
    info: bookmarkParsePO,
    fork: BookmarkForkPO | null,
    result: BookmarkForkResponse,
    relation: { type: number; documentId?: string }
  ) {
    return await this.prisma().$transaction(async tx => {
      const previous = await lockBookmarkObjects(tx, operation.target_bookmark_id)
      if (!previous) return false
      const claimed = await tx.sr_bookmark_fork_operation.updateMany({
        where: {
          id: operation.id,
          write_version: operation.write_version,
          attempt_token: operation.attempt_token,
          status: 'copying'
        },
        data: { status: 'publishing', updated_at: new Date() }
      })
      if (claimed.count !== 1) return false
      const stage = await tx.sr_bookmark_object_stage.updateMany({
        where: {
          content_key: info.content_key,
          bookmark_id: operation.target_bookmark_id,
          write_version: operation.write_version,
          status: 'staged'
        },
        data: { status: 'published', updated_at: new Date() }
      })
      if (stage.count !== 1) {
        await tx.sr_bookmark_fork_operation.update({
          where: { id: operation.id },
          data: {
            status: 'failed',
            error_code: 'stage_unavailable',
            updated_at: new Date()
          }
        })
        return false
      }
      const updated = await tx.sr_bookmark.updateMany({
        where: {
          id: operation.target_bookmark_id,
          write_version: operation.write_version,
          published_version: { lt: operation.write_version }
        },
        data: {
          ...info,
          // Fork accepts only unmoderated source snapshots. Its verdict belongs
          // to the new body and must replace any verdict on the previous body.
          moderation_result: 0,
          published_version: operation.write_version,
          updated_at: new Date()
        }
      })
      if (updated.count !== 1) {
        await tx.sr_bookmark_object_stage.updateMany({
          where: { content_key: info.content_key, status: 'published' },
          data: { status: 'staged', updated_at: new Date() }
        })
        await tx.sr_bookmark_fork_operation.updateMany({
          where: {
            id: operation.id,
            attempt_token: operation.attempt_token,
            status: 'publishing'
          },
          data: {
            status: 'failed',
            error_code: 'superseded',
            updated_at: new Date()
          }
        })
        return false
      }
      await retireBookmarkObjects(tx, previous, info)
      await tx.sr_bookmark_summary.deleteMany({
        where: { bookmark_id: operation.target_bookmark_id }
      })
      await tx.sr_user_bookmark_overview.deleteMany({
        where: { bookmark_id: operation.target_bookmark_id }
      })
      await tx.sr_media_article_ref.deleteMany({
        where: { bookmark_id: operation.target_bookmark_id }
      })
      await tx.sr_bookmark_fork.updateMany({
        where: {
          target_bookmark_id: operation.target_bookmark_id,
          status: 'current'
        },
        data: {
          status: 'superseded',
          current_target_id: null,
          updated_at: new Date()
        }
      })
      if (fork) {
        await tx.sr_bookmark_fork.create({
          data: {
            ...fork,
            current_target_id: operation.target_bookmark_id,
            target_bookmark_id: operation.target_bookmark_id,
            write_version: operation.write_version,
            status: 'current',
            updated_at: new Date()
          }
        })
      }
      const relationUpdated = await tx.$executeRaw`
        UPDATE sr_user_bookmark SET type = ${relation.type},
          metadata = CASE WHEN ${relation.documentId ?? null}::text IS NULL THEN metadata - 'pdf_document_id'
            ELSE metadata || jsonb_build_object('pdf_document_id', ${relation.documentId ?? null}::text) END,
          deleted_at = NULL, created_at = NOW(), updated_at = NOW()
        WHERE user_id = ${operation.user_id} AND bookmark_id = ${operation.target_bookmark_id}
      `
      if (relationUpdated !== 1) throw BookmarkWriteConflictError()
      await tx.sr_user_delete_bookmark.deleteMany({
        where: {
          user_id: operation.user_id,
          bookmark_id: operation.target_bookmark_id
        }
      })
      await tx.sr_bookmark_fork_operation.update({
        where: { id: operation.id },
        data: {
          status: 'indexing',
          result: result as unknown as Prisma.InputJsonValue,
          updated_at: new Date()
        }
      })
      return true
    })
  }

  public async complete(operationId: number, attemptToken: string) {
    await this.prisma().sr_bookmark_fork_operation.updateMany({
      where: {
        id: operationId,
        attempt_token: attemptToken,
        status: 'indexing'
      },
      data: { status: 'complete', updated_at: new Date() }
    })
  }

  /**
   * Rotate a failed indexing attempt behind newer work without changing its
   * durable state. The scheduled repair query orders by updated_at, so leaving
   * a repeatedly failing operation at its original timestamp can starve newer
   * operations from the bounded repair window.
   */
  public async touchIndexing(operationId: number, attemptToken: string) {
    await this.prisma().sr_bookmark_fork_operation.updateMany({
      where: {
        id: operationId,
        attempt_token: attemptToken,
        status: 'indexing'
      },
      data: { updated_at: new Date() }
    })
  }

  public async fail(operationId: number, attemptToken: string, errorCode: string, abandoned = false, cleanupToken?: string) {
    await this.prisma().sr_bookmark_fork_operation.updateMany({
      where: {
        id: operationId,
        attempt_token: attemptToken,
        ...(cleanupToken ? { cleanup_token: cleanupToken } : {}),
        status: { in: ['copying', 'publishing', 'failed', 'cleaning'] }
      },
      data: {
        status: abandoned ? 'abandoned' : 'failed',
        cleanup_token: null,
        error_code: errorCode,
        updated_at: new Date()
      }
    })
  }

  public async listPending() {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000)
    const indexingRetryCutoff = new Date(Date.now() - 5 * 60 * 1000)
    return (
      await this.prisma().sr_bookmark_fork_operation.findMany({
        where: {
          OR: [
            { status: 'indexing', updated_at: { lt: indexingRetryCutoff } },
            {
              status: { in: ['copying', 'failed', 'cleaning'] },
              updated_at: { lt: cutoff }
            }
          ]
        },
        take: 100,
        orderBy: { updated_at: 'asc' }
      })
    ).map(row => this.decode(row))
  }

  public async claimCleanup(operation: Pick<ForkOperation, 'id' | 'attempt_token' | 'cleanup_token'>) {
    const cleanupToken = randomUUID()
    const result = await this.prisma().sr_bookmark_fork_operation.updateMany({
      where: {
        id: operation.id,
        attempt_token: operation.attempt_token,
        ...(operation.cleanup_token ? { cleanup_token: operation.cleanup_token } : {}),
        status: { in: ['copying', 'failed', 'cleaning'] },
        updated_at: { lt: new Date(Date.now() - 60 * 60 * 1000) }
      },
      data: {
        status: 'cleaning',
        cleanup_token: cleanupToken,
        updated_at: new Date()
      }
    })
    return result.count === 1 ? cleanupToken : null
  }

  /** One indexed, bounded claim replaces list + one read/write round trip per object set. */
  public async claimStaleStages(limit = 100) {
    const token = randomUUID()
    return this.prisma().$queryRaw<Array<{ id: string; bookmark_id: number; keys: string[]; cleanup_token: string }>>`
      WITH candidates AS MATERIALIZED (
        SELECT candidate.id, candidate.cleanup_after
        FROM unnest(ARRAY['staged', 'retired', 'cleaning', 'deleted']) AS statuses(status)
        CROSS JOIN LATERAL (
          SELECT stage.id, stage.cleanup_after FROM sr_bookmark_object_stage stage
          WHERE stage.status = statuses.status AND stage.cleanup_after < NOW()
            -- Never collect a stage while any object in its key set is still
            -- referenced by the committed bookmark. The text key can be
            -- shared by legacy rows even when the body key has changed; PDF
            -- metadata is derived from the committed body key.
            AND (
              NOT EXISTS (SELECT 1 FROM sr_bookmark owner WHERE owner.id = stage.bookmark_id)
              OR NOT EXISTS (
                SELECT 1 FROM sr_bookmark b
                WHERE b.content_key = stage.content_key
                  OR b.content_md_key = stage.content_key
                  OR b.content_key = ANY(COALESCE(stage.keys, ARRAY[]::text[]))
                  OR b.content_md_key = ANY(COALESCE(stage.keys, ARRAY[]::text[]))
                  OR (
                    b.content_key LIKE 'pdf/body/%'
                    AND regexp_replace(replace(b.content_key, 'pdf/body/', 'pdf/meta/'), '\.pdf$', '.json') = ANY(COALESCE(stage.keys, ARRAY[]::text[]))
                  )
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM sr_bookmark_fork_operation operation
              WHERE operation.target_bookmark_id = stage.bookmark_id
                AND operation.status IN ('copying', 'publishing', 'indexing')
                AND stage.content_key = ANY(COALESCE(operation.staged_keys, ARRAY[]::text[]))
            )
            AND (stage.status <> 'retired' OR stage.indexed_at IS NOT NULL
              OR NOT EXISTS (SELECT 1 FROM sr_bookmark b WHERE b.id = stage.bookmark_id))
          ORDER BY stage.cleanup_after LIMIT ${limit} FOR UPDATE SKIP LOCKED
        ) candidate
      ), chosen AS (
        SELECT id FROM candidates ORDER BY cleanup_after LIMIT ${limit}
      )
      UPDATE sr_bookmark_object_stage stage
      SET status = 'cleaning', cleanup_token = ${token}, updated_at = NOW(), cleanup_after = NOW() + interval '1 hour'
      FROM chosen WHERE stage.id = chosen.id
      RETURNING stage.id, stage.bookmark_id, stage.keys, stage.cleanup_token
    `
  }

  /**
   * Backwards-compatible single-stage lease for older callers and recovery tests.
   * New workers should use claimStaleStages so one indexed query can claim a batch.
   */
  public async claimStageCleanup(stageId: string) {
    const cleanupToken = randomUUID()
    const rows = await this.prisma().$queryRaw<Array<{ id: string }>>`
      UPDATE sr_bookmark_object_stage stage
      SET status = 'cleaning', cleanup_token = ${cleanupToken}, updated_at = NOW(), cleanup_after = NOW() + interval '1 hour'
      WHERE stage.id = ${stageId}
        AND stage.status IN ('staged', 'retired', 'cleaning', 'deleted')
        AND stage.cleanup_after < NOW()
        AND stage.updated_at < NOW() - interval '1 hour'
        AND (
          NOT EXISTS (SELECT 1 FROM sr_bookmark owner WHERE owner.id = stage.bookmark_id)
          OR NOT EXISTS (
            SELECT 1 FROM sr_bookmark bookmark
            WHERE bookmark.content_key = stage.content_key
              OR bookmark.content_md_key = stage.content_key
              OR bookmark.content_key = ANY(COALESCE(stage.keys, ARRAY[]::text[]))
              OR bookmark.content_md_key = ANY(COALESCE(stage.keys, ARRAY[]::text[]))
              OR (
                bookmark.content_key LIKE 'pdf/body/%'
                AND regexp_replace(replace(bookmark.content_key, 'pdf/body/', 'pdf/meta/'), '\.pdf$', '.json') = ANY(COALESCE(stage.keys, ARRAY[]::text[]))
              )
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM sr_bookmark_fork_operation operation
          WHERE operation.target_bookmark_id = stage.bookmark_id
            AND operation.status IN ('copying', 'publishing', 'indexing')
            AND stage.content_key = ANY(COALESCE(operation.staged_keys, ARRAY[]::text[]))
        )
        AND (stage.status <> 'retired' OR stage.indexed_at IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM sr_bookmark bookmark WHERE bookmark.id = stage.bookmark_id))
      RETURNING stage.id
    `
    return rows.length === 1 ? cleanupToken : null
  }

  public async completeStageCleanup(stageId: string, cleanupToken: string, status: 'deleted' | 'cleaning' = 'deleted') {
    // Re-delete for one day after the FIRST successful cleanup, then discard the
    // tombstone. Keep DELETE and UPDATE as separate statements: PostgreSQL data
    // modifying CTEs share one snapshot, and updating the same row from the
    // outer statement would make the winning mutation undefined.
    if (status === 'deleted') {
      const purged = await this.prisma().$executeRaw`
        DELETE FROM sr_bookmark_object_stage
        WHERE id = ${stageId} AND status = 'cleaning' AND cleanup_token = ${cleanupToken}
          AND cleanup_completed_at < NOW() - interval '1 day'
      `
      if (purged > 0) return
    }
    await this.prisma().$executeRaw`
      UPDATE sr_bookmark_object_stage
      SET status = ${status}, cleanup_token = NULL,
        cleanup_completed_at = CASE WHEN ${status} = 'deleted' THEN COALESCE(cleanup_completed_at, NOW()) ELSE cleanup_completed_at END,
        updated_at = NOW(), cleanup_after = NOW() + interval '1 hour'
      WHERE id = ${stageId} AND status = 'cleaning' AND cleanup_token = ${cleanupToken}
    `
  }

  public async getVectorBucket(bookmarkId: number): Promise<number | null> {
    const row = await this.prisma().sr_bookmark_vector_shard.findUnique({ where: { bookmark_id: bookmarkId }, select: { bucket_idx: true } })
    return row?.bucket_idx ?? null
  }

  public async getUnreferencedStageKeys(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return []
    const rows = await this.prisma().$queryRaw<Array<{ key: string }>>`
      SELECT key
      FROM unnest(${keys}::text[]) AS key
      WHERE NOT EXISTS (
        SELECT 1 FROM sr_bookmark bookmark
        WHERE bookmark.content_key = key
          OR bookmark.content_md_key = key
          OR (
            bookmark.content_key LIKE 'pdf/body/%'
            AND regexp_replace(replace(bookmark.content_key, 'pdf/body/', 'pdf/meta/'), '\.pdf$', '.json') = key
          )
      )
    `
    return rows.map(row => row.key)
  }

  public async deleteVectorShard(bookmarkId: number) {
    await this.prisma().sr_bookmark_vector_shard.deleteMany({ where: { bookmark_id: bookmarkId } })
  }

  private decode(row: { staged_keys: string[]; result: Prisma.JsonValue; [key: string]: unknown }): ForkOperation {
    return {
      ...row,
      staged_keys: row.staged_keys,
      result: row.result ?? undefined
    } as ForkOperation
  }
}
