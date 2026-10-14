import type { LazyInstance } from '@/decorators/lazy'
import { PrismaClient as HyperdrivePrismaClient, Prisma } from '@prisma/hyperdrive-client'

export type MediaKind = 'youtube' | 'podcast'

export type MediaArticleStatus = 'pending' | 'skipped' | 'generating' | 'validating' | 'ready' | 'failed' | 'stale' | 'takedown'

/** Rows that a fresh evaluation may overwrite. Anything further along keeps its state. */
const REEVALUABLE_STATUSES: MediaArticleStatus[] = ['pending', 'skipped']
/** Rows a workflow is working on. */
const RUNNING_STATUSES: MediaArticleStatus[] = ['generating', 'validating']
/**
 * Outcomes no new attempt can change: the version is too long for the budget, or spent it.
 * Such rows are never queued again and the client offers no generate or retry for them.
 */
export const FINAL_ERRORS = ['budget_exceeded', 'too_long'] as const

export function isFinalError(error: string | null | undefined): boolean {
  return FINAL_ERRORS.some(code => (error ?? '').startsWith(code))
}

/** Attempts before a row stays failed. */
export const MEDIA_ARTICLE_MAX_ATTEMPTS = 3

/** Canonical row: one per (media_kind, source_id, source_hash, target_language, prompt_version), shared by every bookmark of that source. */
export interface mediaArticlePO {
  id: number
  media_kind: string
  source_id: string
  caption_key: string | null
  caption_text_key: string | null
  caption_language: string | null
  caption_kind: string | null
  source_hash: string
  target_language: string
  eligibility_json: Prisma.JsonValue | null
  status: string
  article_key: string | null
  article_text_key: string | null
  model: string | null
  prompt_version: string
  schema_version: number
  quality_json: Prisma.JsonValue | null
  retry_count: number
  run_id: string | null
  cost_usd: number
  lease_until: Date | null
  next_retry_at: Date | null
  error_message: string | null
  created_at: Date
  updated_at: Date
  started_at: Date | null
  completed_at: Date | null
}

/** Which source version a bookmark points at. One per bookmark. */
export interface mediaArticleRefPO {
  id: number
  bookmark_id: number
  user_id: number
  media_kind: string
  source_id: string
  source_hash: string
  created_at: Date
  updated_at: Date
}

export interface MediaArticleEvaluation {
  source_id: string
  caption_key: string | null
  caption_text_key: string | null
  caption_language: string | null
  caption_kind: string | null
  source_hash: string
  target_language: string
  prompt_version: string
  schema_version: number
  status: Extract<MediaArticleStatus, 'pending' | 'skipped'>
  /** Plain JSON-serializable object (the eligibility result). */
  eligibility: object
}

export interface MediaArticlePublish {
  article_key: string
  article_text_key: string
  model: string
  quality: object
}

/** The gate decision stored in eligibility_json. Missing or unreadable means "do not generate". */
export function eligibilityDecision(row: Pick<mediaArticlePO, 'eligibility_json'>): 'generate' | 'skip' | 'review' {
  const decision = (row.eligibility_json as { decision?: string } | null)?.decision
  return decision === 'generate' || decision === 'skip' ? decision : 'review'
}

/**
 * Job table for derived media articles (YouTube, podcasts). Only pointers, versions, status and the
 * gate result live here; sources and articles are R2 objects. Bookmarks point at a (source_id,
 * source_hash) through sr_media_article_ref; visibility is always decided by the bookmark, never by
 * these rows. Every state change is a conditional update on the expected current status, so two
 * workers can never both win. Each subclass is bound to one media kind and every query filters on it.
 */
export abstract class MediaArticleRepo {
  protected abstract readonly kind: MediaKind
  protected abstract readonly promptVersion: string

  constructor(protected prismaPg: LazyInstance<HyperdrivePrismaClient>) {}

  private versionKey(sourceId: string, sourceHash: string, targetLanguage: string, promptVersion: string) {
    return {
      media_kind_source_id_source_hash_target_language_prompt_version: {
        media_kind: this.kind,
        source_id: sourceId,
        source_hash: sourceHash,
        target_language: targetLanguage,
        prompt_version: promptVersion
      }
    }
  }

  /**
   * Record the eligibility result for a caption source in one target language. Creates the row,
   * or refreshes it while it is still pending/skipped; a row that already moved on (generating,
   * ready, takedown, ...) is returned as is.
   */
  public async recordEvaluation(input: MediaArticleEvaluation): Promise<mediaArticlePO> {
    const where = this.versionKey(input.source_id, input.source_hash, input.target_language, input.prompt_version)
    const existing = await this.prismaPg().sr_media_article.findUnique({ where })
    // A save of this version keeps a row that moved on as it is, but marks it as used now, so the
    // orphan sweep (which only deletes rows untouched for 7 days) cannot remove it under the new ref
    if (existing && !REEVALUABLE_STATUSES.includes(existing.status as MediaArticleStatus)) {
      return this.prismaPg().sr_media_article.update({ where: { id: existing.id }, data: { updated_at: new Date() } })
    }
    if (!existing && (await this.isTakedown(input.source_id))) {
      return this.prismaPg().sr_media_article.create({
        data: {
          ...this.evaluationData(input),
          media_kind: this.kind,
          source_id: input.source_id,
          source_hash: input.source_hash,
          target_language: input.target_language,
          prompt_version: input.prompt_version,
          status: 'takedown',
          caption_key: null,
          caption_text_key: null
        }
      })
    }

    const data = this.evaluationData(input)
    return this.prismaPg().sr_media_article.upsert({
      where,
      create: {
        ...data,
        media_kind: this.kind,
        source_id: input.source_id,
        source_hash: input.source_hash,
        target_language: input.target_language,
        prompt_version: input.prompt_version
      },
      update: data
    })
  }

  private evaluationData(input: MediaArticleEvaluation) {
    return {
      caption_key: input.caption_key,
      caption_text_key: input.caption_text_key,
      caption_language: input.caption_language,
      caption_kind: input.caption_kind,
      schema_version: input.schema_version,
      eligibility_json: input.eligibility as Prisma.InputJsonObject,
      status: input.status
    }
  }

  /** Point a bookmark at the caption version it was crawled with. A re-crawl moves the pointer. */
  public async linkBookmark(input: { bookmark_id: number; user_id: number; source_id: string; source_hash: string }): Promise<mediaArticleRefPO> {
    return this.prismaPg().sr_media_article_ref.upsert({
      where: { bookmark_id: input.bookmark_id },
      create: { ...input, media_kind: this.kind },
      update: { user_id: input.user_id, media_kind: this.kind, source_id: input.source_id, source_hash: input.source_hash }
    })
  }

  /** The bookmark's ref, only if it is of this media kind. */
  public async findRef(bookmarkId: number): Promise<mediaArticleRefPO | null> {
    const ref = await this.prismaPg().sr_media_article_ref.findUnique({ where: { bookmark_id: bookmarkId } })
    return ref && ref.media_kind === this.kind ? ref : null
  }

  /** Any bookmark that points at this caption version, to borrow its title. */
  public async findAnyRef(sourceId: string, sourceHash: string): Promise<mediaArticleRefPO | null> {
    return this.prismaPg().sr_media_article_ref.findFirst({ where: { media_kind: this.kind, source_id: sourceId, source_hash: sourceHash }, orderBy: { id: 'asc' } })
  }

  /** Every bookmark that points at this source, oldest first; one caption version when `sourceHash` is given. */
  public async listRefs(sourceId: string, sourceHash?: string): Promise<mediaArticleRefPO[]> {
    return this.prismaPg().sr_media_article_ref.findMany({
      where: { media_kind: this.kind, source_id: sourceId, ...(sourceHash ? { source_hash: sourceHash } : {}) },
      orderBy: { id: 'asc' }
    })
  }

  public async findById(id: number): Promise<mediaArticlePO | null> {
    const row = await this.prismaPg().sr_media_article.findUnique({ where: { id } })
    return row && row.media_kind === this.kind ? row : null
  }

  public async findVersion(sourceId: string, sourceHash: string, targetLanguage: string, promptVersion: string = this.promptVersion): Promise<mediaArticlePO | null> {
    return this.prismaPg().sr_media_article.findUnique({ where: this.versionKey(sourceId, sourceHash, targetLanguage, promptVersion) })
  }

  /** Rows of one source version in every language, oldest first. */
  public async listForSource(sourceId: string, sourceHash: string, promptVersion: string = this.promptVersion): Promise<mediaArticlePO[]> {
    return this.prismaPg().sr_media_article.findMany({
      where: { media_kind: this.kind, source_id: sourceId, source_hash: sourceHash, prompt_version: promptVersion },
      orderBy: { id: 'asc' }
    })
  }

  /** The canonical row a bookmark currently points at, for one language and prompt version. */
  public async findForBookmark(bookmarkId: number, targetLanguage: string, promptVersion: string = this.promptVersion): Promise<mediaArticlePO | null> {
    const ref = await this.findRef(bookmarkId)
    if (!ref) return null
    return this.findVersion(ref.source_id, ref.source_hash, targetLanguage, promptVersion)
  }

  /**
   * The row for a language that has none yet. The gate result belongs to the captions, not to the
   * language, so it is copied from a sibling row. A concurrent insert wins and is returned as is.
   */
  public async ensureLanguageRow(base: mediaArticlePO, targetLanguage: string): Promise<mediaArticlePO> {
    const where = this.versionKey(base.source_id, base.source_hash, targetLanguage, base.prompt_version)
    const status: MediaArticleStatus = base.status === 'takedown' ? 'takedown' : eligibilityDecision(base) === 'generate' ? 'pending' : 'skipped'
    return this.prismaPg().sr_media_article.upsert({
      where,
      create: {
        media_kind: this.kind,
        source_id: base.source_id,
        source_hash: base.source_hash,
        target_language: targetLanguage,
        prompt_version: base.prompt_version,
        schema_version: base.schema_version,
        caption_key: base.caption_key,
        caption_text_key: base.caption_text_key,
        caption_language: base.caption_language,
        caption_kind: base.caption_kind,
        eligibility_json: (base.eligibility_json ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        status
      },
      update: {}
    })
  }

  /**
   * pending → generating for the run `runId` (the workflow instance id). Idempotent for the same run:
   * if the update committed but the step is retried, the row already carries this run id.
   */
  public async claim(id: number, runId: string, leaseMs: number): Promise<boolean> {
    const now = new Date()
    const res = await this.prismaPg().sr_media_article.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'generating', run_id: runId, lease_until: new Date(now.getTime() + leaseMs), started_at: now, error_message: null, next_retry_at: null }
    })
    if (res.count === 1) return true
    const row = await this.findById(id)
    return !!row && RUNNING_STATUSES.includes(row.status as MediaArticleStatus) && row.run_id === runId
  }

  /** Extend the lease of this run. False when another run holds the row, or it left the running states. */
  public async renewLease(id: number, runId: string, leaseMs: number, status: Extract<MediaArticleStatus, 'generating' | 'validating'> = 'generating'): Promise<boolean> {
    const res = await this.prismaPg().sr_media_article.updateMany({
      where: { id, run_id: runId, status: { in: RUNNING_STATUSES } },
      data: { status, lease_until: new Date(Date.now() + leaseMs) }
    })
    return res.count === 1
  }

  /** Add one model call's estimated cost to this version's total. Returns the new total. */
  public async addCost(id: number, usd: number): Promise<number> {
    const row = await this.prismaPg().sr_media_article.update({ where: { id }, data: { cost_usd: { increment: usd } }, select: { cost_usd: true } })
    return row.cost_usd
  }

  /**
   * Running → ready, only for this run, this caption version and language. Idempotent: if the update
   * committed and the step is retried, the row is already ready with these keys from this run.
   * False means another writer moved the row on; the caller deletes what it wrote.
   */
  public async publish(id: number, runId: string, sourceHash: string, targetLanguage: string, data: MediaArticlePublish): Promise<boolean> {
    const res = await this.prismaPg().sr_media_article.updateMany({
      where: { id, run_id: runId, source_hash: sourceHash, target_language: targetLanguage, status: { in: RUNNING_STATUSES } },
      data: {
        status: 'ready',
        article_key: data.article_key,
        article_text_key: data.article_text_key,
        model: data.model,
        quality_json: data.quality as Prisma.InputJsonObject,
        lease_until: null,
        error_message: null,
        completed_at: new Date()
      }
    })
    if (res.count === 1) return true
    const row = await this.findById(id)
    return !!row && row.status === 'ready' && row.run_id === runId && row.article_key === data.article_key
  }

  /**
   * A running attempt ended without an article. Retryable errors go back to pending with a delay
   * until the attempts run out; everything else stays failed. `runId` limits it to that run;
   * `expiredBefore` limits it to a lease that really ran out (the sweep). Returns the new status,
   * or null when the row was not in that state any more.
   */
  public async finishAttempt(
    id: number,
    outcome: { kind: 'retry' | 'failed' | 'skipped'; error: string; quality?: object; retryDelayMs?: number },
    guard: { runId?: string; expiredBefore?: Date } = {}
  ): Promise<MediaArticleStatus | null> {
    const row = await this.findById(id)
    if (!row || !RUNNING_STATUSES.includes(row.status as MediaArticleStatus)) return null
    const attempts = row.retry_count + 1
    let status: MediaArticleStatus = outcome.kind === 'skipped' ? 'skipped' : 'failed'
    if (outcome.kind === 'retry' && attempts < MEDIA_ARTICLE_MAX_ATTEMPTS) status = 'pending'
    const res = await this.prismaPg().sr_media_article.updateMany({
      where: {
        id,
        status: { in: RUNNING_STATUSES },
        retry_count: row.retry_count,
        ...(guard.runId ? { run_id: guard.runId } : {}),
        ...(guard.expiredBefore ? { OR: [{ lease_until: null }, { lease_until: { lt: guard.expiredBefore } }] } : {})
      },
      data: {
        status,
        retry_count: outcome.kind === 'skipped' ? row.retry_count : attempts,
        lease_until: null,
        next_retry_at: status === 'pending' ? new Date(Date.now() + (outcome.retryDelayMs ?? 10 * 60 * 1000)) : null,
        error_message: outcome.error.slice(0, 500),
        ...(outcome.quality ? { quality_json: outcome.quality as Prisma.InputJsonObject } : {})
      }
    })
    return res.count === 1 ? status : null
  }

  /**
   * Owner asked for an article: skipped/failed → pending. `resetAttempts` is the explicit retry,
   * which starts the attempt count again. next_retry_at is set to now: the row is a real request,
   * so the sweep starts it if the immediate start does not happen. A version that ran out of
   * budget is never queued again. False when the row is in any other state.
   */
  public async requeue(id: number, resetAttempts: boolean): Promise<boolean> {
    const res = await this.prismaPg().sr_media_article.updateMany({
      where: {
        id,
        status: { in: resetAttempts ? ['failed'] : ['skipped', 'failed'] },
        // NOT LIKE alone would drop rows whose error_message is NULL (SQL three-valued logic)
        OR: [{ error_message: null }, { AND: FINAL_ERRORS.map(code => ({ NOT: { error_message: { startsWith: code } } })) }]
      },
      data: { status: 'pending', next_retry_at: new Date(), error_message: null, ...(resetAttempts ? { retry_count: 0 } : {}) }
    })
    return res.count === 1
  }

  /** Rows a workflow is working on and whose lease has not run out. */
  public async countRunning(now: Date = new Date()): Promise<number> {
    return this.prismaPg().sr_media_article.count({ where: { media_kind: this.kind, status: { in: RUNNING_STATUSES }, lease_until: { gt: now } } })
  }

  /**
   * Pending rows someone asked for whose start was put off (retry delay, busy, over budget), oldest
   * first. A pending row without next_retry_at was only judged eligible and nobody asked for it yet:
   * the sweeper must never start those, or every eligible video ever saved would be generated.
   */
  public async listRunnable(limit: number, now: Date = new Date()): Promise<mediaArticlePO[]> {
    return this.prismaPg().sr_media_article.findMany({
      where: { media_kind: this.kind, status: 'pending', next_retry_at: { lte: now } },
      orderBy: { next_retry_at: 'asc' },
      take: limit
    })
  }

  /** Put off the start of a requested pending row; the sweeper picks it up after `at`. */
  public async defer(id: number, at: Date): Promise<boolean> {
    const res = await this.prismaPg().sr_media_article.updateMany({ where: { id, status: 'pending' }, data: { next_retry_at: at } })
    return res.count === 1
  }

  /** Running rows whose lease ran out: the workflow died or hung. */
  public async listExpiredLeases(limit: number, now: Date = new Date()): Promise<mediaArticlePO[]> {
    return this.prismaPg().sr_media_article.findMany({
      where: { media_kind: this.kind, status: { in: RUNNING_STATUSES }, OR: [{ lease_until: null }, { lease_until: { lt: now } }] },
      orderBy: { id: 'asc' },
      take: limit
    })
  }

  // Raw SQL uses the table and column names in the database: sr_media_article(_ref) map to
  // sr_youtube_article(_ref), and source_id maps to video_id (see pgsql.prisma).

  /** Rows of caption versions no bookmark points at any more, untouched for a while. */
  public async listOrphans(olderThan: Date, limit: number): Promise<mediaArticlePO[]> {
    return this.prismaPg().$queryRaw<mediaArticlePO[]>(Prisma.sql`
      SELECT a.*, a."video_id" AS "source_id" FROM "sr_youtube_article" a
      WHERE a."media_kind" = ${this.kind}
        AND a."updated_at" < ${olderThan}
        AND a."status" NOT IN ('generating', 'validating', 'takedown')
        AND NOT EXISTS (
          SELECT 1 FROM "sr_youtube_article_ref" r
          WHERE r."media_kind" = a."media_kind" AND r."video_id" = a."video_id" AND r."source_hash" = a."source_hash"
        )
      ORDER BY a."id" ASC
      LIMIT ${limit}
    `)
  }

  /** Delete a swept row, only if it is still unreferenced, idle and untouched since the cutoff. */
  public async deleteOrphan(id: number, olderThan: Date): Promise<boolean> {
    const count = await this.prismaPg().$executeRaw(Prisma.sql`
      DELETE FROM "sr_youtube_article" a
      WHERE a."id" = ${id}
        AND a."updated_at" < ${olderThan}
        AND a."media_kind" = ${this.kind}
        AND a."status" NOT IN ('generating', 'validating', 'takedown')
        AND NOT EXISTS (
          SELECT 1 FROM "sr_youtube_article_ref" r
          WHERE r."media_kind" = a."media_kind" AND r."video_id" = a."video_id" AND r."source_hash" = a."source_hash"
        )
    `)
    return count === 1
  }

  /** Other rows still pointing at the same R2 object (a caption is shared by every language). */
  public async countRowsUsingKey(column: 'caption_key' | 'caption_text_key', key: string): Promise<number> {
    return this.prismaPg().sr_media_article.count({ where: { media_kind: this.kind, [column]: key } })
  }

  public async isTakedown(sourceId: string): Promise<boolean> {
    return (await this.prismaPg().sr_media_article.count({ where: { media_kind: this.kind, source_id: sourceId, status: 'takedown' } })) > 0
  }

  public async listForVideo(sourceId: string): Promise<mediaArticlePO[]> {
    return this.prismaPg().sr_media_article.findMany({ where: { media_kind: this.kind, source_id: sourceId }, orderBy: { id: 'asc' } })
  }

  /** Videos marked taken down whose objects are not deleted yet (the marker keeps its keys until then). */
  public async listTakedownsToClean(limit: number): Promise<string[]> {
    const rows = await this.prismaPg().sr_media_article.findMany({
      where: {
        media_kind: this.kind,
        status: 'takedown',
        OR: [{ caption_key: { not: null } }, { caption_text_key: { not: null } }, { article_key: { not: null } }, { article_text_key: { not: null } }]
      },
      select: { source_id: true },
      distinct: ['source_id'],
      take: limit
    })
    return rows.map(r => r.source_id)
  }

  /** Takedown: every row of the video stops serving and can never be generated again. */
  public async takedownVideo(sourceId: string): Promise<number> {
    const res = await this.prismaPg().sr_media_article.updateMany({
      where: { media_kind: this.kind, source_id: sourceId },
      data: { status: 'takedown', article_key: null, article_text_key: null, caption_key: null, caption_text_key: null, lease_until: null, next_retry_at: null }
    })
    return res.count
  }

  /** Called when a bookmark is deleted. Canonical rows with no refs left are swept separately. */
  public async unlinkBookmark(bookmarkId: number): Promise<number> {
    const res = await this.prismaPg().sr_media_article_ref.deleteMany({ where: { bookmark_id: bookmarkId, media_kind: this.kind } })
    return res.count
  }

  public async countRefs(sourceId: string, sourceHash?: string): Promise<number> {
    return this.prismaPg().sr_media_article_ref.count({ where: { media_kind: this.kind, source_id: sourceId, ...(sourceHash ? { source_hash: sourceHash } : {}) } })
  }
}
