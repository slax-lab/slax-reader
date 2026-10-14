import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import { PrismaClient as HyperdrivePrismaClient, Prisma } from '@prisma/hyperdrive-client'

/** Prompt contract version of the AI article. Bump when the prompt or output schema changes. */
export const YOUTUBE_ARTICLE_PROMPT_VERSION = 'v1'
export const YOUTUBE_ARTICLE_SCHEMA_VERSION = 1

export type YoutubeArticleStatus = 'pending' | 'skipped' | 'generating' | 'validating' | 'ready' | 'failed' | 'stale' | 'takedown'

/** Rows that a fresh evaluation may overwrite. Anything further along keeps its state. */
const REEVALUABLE_STATUSES: YoutubeArticleStatus[] = ['pending', 'skipped']
/** Rows a workflow is working on. */
const RUNNING_STATUSES: YoutubeArticleStatus[] = ['generating', 'validating']
/**
 * Outcomes no new attempt can change: the version is too long for the budget, or spent it.
 * Such rows are never queued again and the client offers no generate or retry for them.
 */
export const FINAL_ERRORS = ['budget_exceeded', 'too_long'] as const

export function isFinalError(error: string | null | undefined): boolean {
  return FINAL_ERRORS.some(code => (error ?? '').startsWith(code))
}

/** Attempts before a row stays failed. */
export const YOUTUBE_ARTICLE_MAX_ATTEMPTS = 3

/** Canonical row: one per (video_id, source_hash, target_language, prompt_version), shared by every bookmark of that video. */
export interface youtubeArticlePO {
  id: number
  video_id: string
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

/** Which caption version a bookmark saw when it was crawled. One per bookmark. */
export interface youtubeArticleRefPO {
  id: number
  bookmark_id: number
  user_id: number
  video_id: string
  source_hash: string
  created_at: Date
  updated_at: Date
}

export interface YoutubeArticleEvaluation {
  video_id: string
  caption_key: string | null
  caption_text_key: string | null
  caption_language: string | null
  caption_kind: string | null
  source_hash: string
  target_language: string
  prompt_version: string
  schema_version: number
  status: Extract<YoutubeArticleStatus, 'pending' | 'skipped'>
  /** Plain JSON-serializable object (the eligibility result). */
  eligibility: object
}

export interface YoutubeArticlePublish {
  article_key: string
  article_text_key: string
  model: string
  quality: object
}

/** The gate decision stored in eligibility_json. Missing or unreadable means "do not generate". */
export function eligibilityDecision(row: Pick<youtubeArticlePO, 'eligibility_json'>): 'generate' | 'skip' | 'review' {
  const decision = (row.eligibility_json as { decision?: string } | null)?.decision
  return decision === 'generate' || decision === 'skip' ? decision : 'review'
}

/**
 * Job table for the derived YouTube article. Only pointers, versions, status and the gate result
 * live here; captions and articles are R2 objects under youtube/canonical/. Bookmarks point at a
 * (video_id, source_hash) through sr_youtube_article_ref; visibility is always decided by the
 * bookmark, never by these rows. Every state change is a conditional update on the expected
 * current status, so two workers can never both win.
 */
@injectable()
export class YoutubeArticleRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<HyperdrivePrismaClient>) {}

  private static versionKey(videoId: string, sourceHash: string, targetLanguage: string, promptVersion: string) {
    return {
      video_id_source_hash_target_language_prompt_version: {
        video_id: videoId,
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
  public async recordEvaluation(input: YoutubeArticleEvaluation): Promise<youtubeArticlePO> {
    const where = YoutubeArticleRepo.versionKey(input.video_id, input.source_hash, input.target_language, input.prompt_version)
    const existing = await this.prismaPg().sr_youtube_article.findUnique({ where })
    // A save of this version keeps a row that moved on as it is, but marks it as used now, so the
    // orphan sweep (which only deletes rows untouched for 7 days) cannot remove it under the new ref
    if (existing && !REEVALUABLE_STATUSES.includes(existing.status as YoutubeArticleStatus)) {
      return this.prismaPg().sr_youtube_article.update({ where: { id: existing.id }, data: { updated_at: new Date() } })
    }
    if (!existing && (await this.isTakedown(input.video_id))) {
      return this.prismaPg().sr_youtube_article.create({
        data: {
          ...this.evaluationData(input),
          video_id: input.video_id,
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
    return this.prismaPg().sr_youtube_article.upsert({
      where,
      create: { ...data, video_id: input.video_id, source_hash: input.source_hash, target_language: input.target_language, prompt_version: input.prompt_version },
      update: data
    })
  }

  private evaluationData(input: YoutubeArticleEvaluation) {
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
  public async linkBookmark(input: { bookmark_id: number; user_id: number; video_id: string; source_hash: string }): Promise<youtubeArticleRefPO> {
    return this.prismaPg().sr_youtube_article_ref.upsert({
      where: { bookmark_id: input.bookmark_id },
      create: input,
      update: { user_id: input.user_id, video_id: input.video_id, source_hash: input.source_hash }
    })
  }

  public async findRef(bookmarkId: number): Promise<youtubeArticleRefPO | null> {
    return this.prismaPg().sr_youtube_article_ref.findUnique({ where: { bookmark_id: bookmarkId } })
  }

  /** Any bookmark that points at this caption version, to borrow its title. */
  public async findAnyRef(videoId: string, sourceHash: string): Promise<youtubeArticleRefPO | null> {
    return this.prismaPg().sr_youtube_article_ref.findFirst({ where: { video_id: videoId, source_hash: sourceHash }, orderBy: { id: 'asc' } })
  }

  public async findById(id: number): Promise<youtubeArticlePO | null> {
    return this.prismaPg().sr_youtube_article.findUnique({ where: { id } })
  }

  public async findVersion(videoId: string, sourceHash: string, targetLanguage: string, promptVersion: string = YOUTUBE_ARTICLE_PROMPT_VERSION): Promise<youtubeArticlePO | null> {
    return this.prismaPg().sr_youtube_article.findUnique({ where: YoutubeArticleRepo.versionKey(videoId, sourceHash, targetLanguage, promptVersion) })
  }

  /** Rows of one caption version in every language, oldest first. */
  public async listForSource(videoId: string, sourceHash: string, promptVersion: string = YOUTUBE_ARTICLE_PROMPT_VERSION): Promise<youtubeArticlePO[]> {
    return this.prismaPg().sr_youtube_article.findMany({ where: { video_id: videoId, source_hash: sourceHash, prompt_version: promptVersion }, orderBy: { id: 'asc' } })
  }

  /** The canonical row a bookmark currently points at, for one language and prompt version. */
  public async findForBookmark(bookmarkId: number, targetLanguage: string, promptVersion: string = YOUTUBE_ARTICLE_PROMPT_VERSION): Promise<youtubeArticlePO | null> {
    const ref = await this.findRef(bookmarkId)
    if (!ref) return null
    return this.findVersion(ref.video_id, ref.source_hash, targetLanguage, promptVersion)
  }

  /**
   * The row for a language that has none yet. The gate result belongs to the captions, not to the
   * language, so it is copied from a sibling row. A concurrent insert wins and is returned as is.
   */
  public async ensureLanguageRow(base: youtubeArticlePO, targetLanguage: string): Promise<youtubeArticlePO> {
    const where = YoutubeArticleRepo.versionKey(base.video_id, base.source_hash, targetLanguage, base.prompt_version)
    const status: YoutubeArticleStatus = base.status === 'takedown' ? 'takedown' : eligibilityDecision(base) === 'generate' ? 'pending' : 'skipped'
    return this.prismaPg().sr_youtube_article.upsert({
      where,
      create: {
        video_id: base.video_id,
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
    const res = await this.prismaPg().sr_youtube_article.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'generating', run_id: runId, lease_until: new Date(now.getTime() + leaseMs), started_at: now, error_message: null, next_retry_at: null }
    })
    if (res.count === 1) return true
    const row = await this.findById(id)
    return !!row && RUNNING_STATUSES.includes(row.status as YoutubeArticleStatus) && row.run_id === runId
  }

  /** Extend the lease of this run. False when another run holds the row, or it left the running states. */
  public async renewLease(id: number, runId: string, leaseMs: number, status: Extract<YoutubeArticleStatus, 'generating' | 'validating'> = 'generating'): Promise<boolean> {
    const res = await this.prismaPg().sr_youtube_article.updateMany({
      where: { id, run_id: runId, status: { in: RUNNING_STATUSES } },
      data: { status, lease_until: new Date(Date.now() + leaseMs) }
    })
    return res.count === 1
  }

  /** Add one model call's estimated cost to this version's total. Returns the new total. */
  public async addCost(id: number, usd: number): Promise<number> {
    const row = await this.prismaPg().sr_youtube_article.update({ where: { id }, data: { cost_usd: { increment: usd } }, select: { cost_usd: true } })
    return row.cost_usd
  }

  /**
   * Running → ready, only for this run, this caption version and language. Idempotent: if the update
   * committed and the step is retried, the row is already ready with these keys from this run.
   * False means another writer moved the row on; the caller deletes what it wrote.
   */
  public async publish(id: number, runId: string, sourceHash: string, targetLanguage: string, data: YoutubeArticlePublish): Promise<boolean> {
    const res = await this.prismaPg().sr_youtube_article.updateMany({
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
  ): Promise<YoutubeArticleStatus | null> {
    const row = await this.findById(id)
    if (!row || !RUNNING_STATUSES.includes(row.status as YoutubeArticleStatus)) return null
    const attempts = row.retry_count + 1
    let status: YoutubeArticleStatus = outcome.kind === 'skipped' ? 'skipped' : 'failed'
    if (outcome.kind === 'retry' && attempts < YOUTUBE_ARTICLE_MAX_ATTEMPTS) status = 'pending'
    const res = await this.prismaPg().sr_youtube_article.updateMany({
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
    const res = await this.prismaPg().sr_youtube_article.updateMany({
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
    return this.prismaPg().sr_youtube_article.count({ where: { status: { in: RUNNING_STATUSES }, lease_until: { gt: now } } })
  }

  /**
   * Pending rows someone asked for whose start was put off (retry delay, busy, over budget), oldest
   * first. A pending row without next_retry_at was only judged eligible and nobody asked for it yet:
   * the sweeper must never start those, or every eligible video ever saved would be generated.
   */
  public async listRunnable(limit: number, now: Date = new Date()): Promise<youtubeArticlePO[]> {
    return this.prismaPg().sr_youtube_article.findMany({
      where: { status: 'pending', next_retry_at: { lte: now } },
      orderBy: { next_retry_at: 'asc' },
      take: limit
    })
  }

  /** Put off the start of a requested pending row; the sweeper picks it up after `at`. */
  public async defer(id: number, at: Date): Promise<boolean> {
    const res = await this.prismaPg().sr_youtube_article.updateMany({ where: { id, status: 'pending' }, data: { next_retry_at: at } })
    return res.count === 1
  }

  /** Running rows whose lease ran out: the workflow died or hung. */
  public async listExpiredLeases(limit: number, now: Date = new Date()): Promise<youtubeArticlePO[]> {
    return this.prismaPg().sr_youtube_article.findMany({
      where: { status: { in: RUNNING_STATUSES }, OR: [{ lease_until: null }, { lease_until: { lt: now } }] },
      orderBy: { id: 'asc' },
      take: limit
    })
  }

  /** Rows of caption versions no bookmark points at any more, untouched for a while. */
  public async listOrphans(olderThan: Date, limit: number): Promise<youtubeArticlePO[]> {
    return this.prismaPg().$queryRaw<youtubeArticlePO[]>(Prisma.sql`
      SELECT a.* FROM "sr_youtube_article" a
      WHERE a."updated_at" < ${olderThan}
        AND a."status" NOT IN ('generating', 'validating', 'takedown')
        AND NOT EXISTS (
          SELECT 1 FROM "sr_youtube_article_ref" r WHERE r."video_id" = a."video_id" AND r."source_hash" = a."source_hash"
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
        AND a."status" NOT IN ('generating', 'validating', 'takedown')
        AND NOT EXISTS (
          SELECT 1 FROM "sr_youtube_article_ref" r WHERE r."video_id" = a."video_id" AND r."source_hash" = a."source_hash"
        )
    `)
    return count === 1
  }

  /** Other rows still pointing at the same R2 object (a caption is shared by every language). */
  public async countRowsUsingKey(column: 'caption_key' | 'caption_text_key', key: string): Promise<number> {
    return this.prismaPg().sr_youtube_article.count({ where: { [column]: key } })
  }

  public async isTakedown(videoId: string): Promise<boolean> {
    return (await this.prismaPg().sr_youtube_article.count({ where: { video_id: videoId, status: 'takedown' } })) > 0
  }

  public async listForVideo(videoId: string): Promise<youtubeArticlePO[]> {
    return this.prismaPg().sr_youtube_article.findMany({ where: { video_id: videoId }, orderBy: { id: 'asc' } })
  }

  /**
   * YouTube bookmarks saved before P0 (no ref yet) of users who turned the article Labs switch on,
   * newest first. `beforeId` is the user-bookmark id cursor, so bookmarks whose captions could not be
   * fetched are passed over instead of being picked again on every call.
   */
  public async listBackfillCandidates(
    limit: number,
    beforeId?: number
  ): Promise<{ user_bookmark_id: number; bookmark_id: number; user_id: number; target_url: string; lang: string; ai_lang: string }[]> {
    return this.prismaPg().$queryRaw(Prisma.sql`
      SELECT ub."id" AS user_bookmark_id, ub."bookmark_id", ub."user_id", b."target_url", u."lang", u."ai_lang"
      FROM "sr_user_bookmark" ub
      JOIN "sr_bookmark" b ON b."id" = ub."bookmark_id"
      JOIN "sr_user" u ON u."id" = ub."user_id"
      JOIN "sr_user_lab_feature" l ON l."user_id" = ub."user_id" AND l."feature" = 'youtube_article' AND l."enabled" = true
      WHERE ub."deleted_at" IS NULL
        AND (b."site_name" = 'YouTube' OR b."target_url" ~ 'youtu\.be/|youtube\.com/(watch|shorts|live|embed)')
        AND NOT EXISTS (SELECT 1 FROM "sr_youtube_article_ref" r WHERE r."bookmark_id" = ub."bookmark_id")
        ${beforeId ? Prisma.sql`AND ub."id" < ${beforeId}` : Prisma.empty}
      ORDER BY ub."id" DESC
      LIMIT ${limit}
    `)
  }

  /** Videos marked taken down whose objects are not deleted yet (the marker keeps its keys until then). */
  public async listTakedownsToClean(limit: number): Promise<string[]> {
    const rows = await this.prismaPg().sr_youtube_article.findMany({
      where: { status: 'takedown', OR: [{ caption_key: { not: null } }, { caption_text_key: { not: null } }, { article_key: { not: null } }, { article_text_key: { not: null } }] },
      select: { video_id: true },
      distinct: ['video_id'],
      take: limit
    })
    return rows.map(r => r.video_id)
  }

  /** Takedown: every row of the video stops serving and can never be generated again. */
  public async takedownVideo(videoId: string): Promise<number> {
    const res = await this.prismaPg().sr_youtube_article.updateMany({
      where: { video_id: videoId },
      data: { status: 'takedown', article_key: null, article_text_key: null, caption_key: null, caption_text_key: null, lease_until: null, next_retry_at: null }
    })
    return res.count
  }

  /** Called when a bookmark is deleted. Canonical rows with no refs left are swept separately. */
  public async unlinkBookmark(bookmarkId: number): Promise<number> {
    const res = await this.prismaPg().sr_youtube_article_ref.deleteMany({ where: { bookmark_id: bookmarkId } })
    return res.count
  }

  public async countRefs(videoId: string, sourceHash?: string): Promise<number> {
    return this.prismaPg().sr_youtube_article_ref.count({ where: { video_id: videoId, ...(sourceHash ? { source_hash: sourceHash } : {}) } })
  }
}
