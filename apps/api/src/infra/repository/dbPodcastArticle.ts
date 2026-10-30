import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import { PrismaClient as HyperdrivePrismaClient, Prisma } from '@prisma/hyperdrive-client'
import { MediaArticleRepo, type MediaKind, type mediaArticleRefPO } from '@/infra/repository/dbMediaArticle'
import { PODCAST_ARTICLE_PROMPT_VERSION } from '@/utils/podcastArticle'
import type { PodcastEpisodeInfo } from '@/utils/podcastSource'

export type InspectedPodcastRef = { bookmarkId: number; updatedAt: Date; contentKey: string }

/** Podcast rows of the media article tables: source_id is the episode's source id, source_hash its transcript hash. */
@injectable()
export class PodcastArticleRepo extends MediaArticleRepo {
  protected readonly kind: MediaKind = 'podcast'
  protected readonly promptVersion = PODCAST_ARTICLE_PROMPT_VERSION

  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) prismaPg: LazyInstance<HyperdrivePrismaClient>) {
    super(prismaPg)
  }

  /** Every bookmark of an episode, whatever transcript version it points at. */
  public async listEpisodeRefs(sourceId: string): Promise<mediaArticleRefPO[]> {
    return this.prismaPg().sr_media_article_ref.findMany({ where: { media_kind: this.kind, source_id: sourceId }, orderBy: { id: 'asc' } })
  }

  /** Advance only legacy references whose inspected bookmark is still unchanged and idle. */
  public async setRefsHash(sourceId: string, sourceHash: string, inspected: InspectedPodcastRef[]): Promise<number> {
    if (!inspected.length) return 0
    const ids = [...new Set(inspected.map(ref => ref.bookmarkId))].sort((a, b) => a - b)
    return this.prismaPg().$transaction(async db => {
      // Serialize with capture/Fork claims; object reads finish before this short transaction.
      await db.$queryRaw(Prisma.sql`SELECT id FROM sr_bookmark WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`)
      const unchanged = inspected.map(ref => Prisma.sql`(b.id = ${ref.bookmarkId} AND b.updated_at = ${ref.updatedAt} AND b.content_key = ${ref.contentKey})`)
      return db.$executeRaw(Prisma.sql`
        UPDATE sr_youtube_article_ref r SET source_hash = ${sourceHash}
        FROM sr_bookmark b WHERE b.id = r.bookmark_id AND r.media_kind = ${this.kind} AND r.video_id = ${sourceId}
          AND b.status = 'success' AND (${Prisma.join(unchanged, ' OR ')})
          AND NOT EXISTS (SELECT 1 FROM sr_user_bookmark ub WHERE ub.bookmark_id = b.id AND ub.forked_from_id IS NOT NULL)
      `)
    })
  }

  /** A pending row nobody needs any more (its reader left): the sweep must not start it again. */
  public async dropRequest(id: number): Promise<boolean> {
    const res = await this.prismaPg().sr_media_article.updateMany({ where: { id, media_kind: this.kind, status: 'pending' }, data: { next_retry_at: null } })
    return res.count === 1
  }
}

export type PodcastTranscriptStatus = 'pending' | 'transcribing' | 'ready' | 'failed' | 'skipped'

/** Outcomes a new attempt cannot change: no retry is offered for them. */
export const PODCAST_FINAL_ERRORS = ['too_long', 'budget_exceeded', 'language_unsupported', 'no_speech', 'moderation', 'no_audio'] as const

export function isPodcastFinalError(error: string | null | undefined): boolean {
  return PODCAST_FINAL_ERRORS.some(code => (error ?? '').startsWith(code))
}

export const PODCAST_EPISODE_MAX_ATTEMPTS = 3

export interface podcastEpisodePO {
  id: number
  source_id: string
  audio_url: string
  title: string
  show_name: string
  author: string
  cover_url: string
  duration_sec: number | null
  /** As the source states it ("zh", "en-us", "ja"); the transcript's language once it is ready. */
  language: string | null
  shownotes: string
  publisher_transcripts: Prisma.JsonValue | null
  transcript_status: string
  transcript_source: string | null
  provider_job_id: string | null
  transcript_key: string | null
  transcript_hash: string | null
  speakers: boolean
  cost_usd: number
  retry_count: number
  run_id: string | null
  lease_until: Date | null
  next_retry_at: Date | null
  error_message: string | null
  created_at: Date
  updated_at: Date
  completed_at: Date | null
}

/**
 * One row per episode (per normalized audio URL), shared by every bookmark of it. Holds the episode
 * metadata and the transcription job. Same rules as the article rows: every state change is a
 * conditional update, a run owns the row through run_id and a lease, the sweeper recovers dead runs.
 */
@injectable()
export class PodcastEpisodeRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<HyperdrivePrismaClient>) {}

  /** Create the episode, or refresh its metadata. Transcript fields are never touched here. */
  public async upsertFromInfo(sourceId: string, info: PodcastEpisodeInfo): Promise<podcastEpisodePO> {
    const meta = {
      title: info.title.slice(0, 1000),
      show_name: info.showName.slice(0, 500),
      author: info.author.slice(0, 500),
      cover_url: info.coverUrl.slice(0, 2000),
      duration_sec: info.durationSec,
      shownotes: info.shownotes,
      publisher_transcripts: info.transcripts as unknown as Prisma.InputJsonArray
    }
    return this.prismaPg().sr_podcast_episode.upsert({
      where: { source_id: sourceId },
      create: { source_id: sourceId, audio_url: info.audioUrl, language: (info.languageTag ?? info.language)?.slice(0, 20) ?? null, ...meta },
      update: meta
    })
  }

  public async findById(id: number): Promise<podcastEpisodePO | null> {
    return this.prismaPg().sr_podcast_episode.findUnique({ where: { id } })
  }

  public async findBySourceId(sourceId: string): Promise<podcastEpisodePO | null> {
    return this.prismaPg().sr_podcast_episode.findUnique({ where: { source_id: sourceId } })
  }

  /** pending → transcribing for this run. Idempotent for the same run. */
  public async claim(id: number, runId: string, leaseMs: number): Promise<boolean> {
    const res = await this.prismaPg().sr_podcast_episode.updateMany({
      where: { id, transcript_status: 'pending' },
      data: { transcript_status: 'transcribing', run_id: runId, lease_until: new Date(Date.now() + leaseMs), error_message: null, next_retry_at: null }
    })
    if (res.count === 1) return true
    const row = await this.findById(id)
    return !!row && row.transcript_status === 'transcribing' && row.run_id === runId
  }

  public async renewLease(id: number, runId: string, leaseMs: number): Promise<boolean> {
    const res = await this.prismaPg().sr_podcast_episode.updateMany({
      where: { id, run_id: runId, transcript_status: 'transcribing' },
      data: { lease_until: new Date(Date.now() + leaseMs) }
    })
    return res.count === 1
  }

  /** Remember the provider job, so a retried step polls it instead of paying for a second job. */
  public async setJob(id: number, runId: string, jobId: string): Promise<boolean> {
    const res = await this.prismaPg().sr_podcast_episode.updateMany({ where: { id, run_id: runId, transcript_status: 'transcribing' }, data: { provider_job_id: jobId } })
    return res.count === 1
  }

  /**
   * Add the cost of a finished AssemblyAI job once. False when this job was already counted: a retry
   * that holds the same job polls it again, but the provider bills it once.
   */
  public async addAsrCost(id: number, jobId: string, usd: number): Promise<boolean> {
    const res = await this.prismaPg().sr_podcast_episode.updateMany({
      where: { id, OR: [{ asr_cost_job_id: null }, { asr_cost_job_id: { not: jobId } }] },
      data: { asr_cost_job_id: jobId, cost_usd: { increment: usd } }
    })
    return res.count === 1
  }

  public async addCost(id: number, usd: number): Promise<number> {
    const row = await this.prismaPg().sr_podcast_episode.update({ where: { id }, data: { cost_usd: { increment: usd } }, select: { cost_usd: true } })
    return row.cost_usd
  }

  /** transcribing → ready for this run, with the stored transcript. */
  public async markReady(
    id: number,
    runId: string,
    t: {
      source: 'publisher' | 'assemblyai'
      key: string
      hash: string
      speakers: boolean
      language: string
      durationSec: number | null
    }
  ): Promise<boolean> {
    const res = await this.prismaPg().sr_podcast_episode.updateMany({
      where: { id, run_id: runId, transcript_status: 'transcribing' },
      data: {
        transcript_status: 'ready',
        transcript_source: t.source,
        transcript_key: t.key,
        transcript_hash: t.hash,
        speakers: t.speakers,
        language: t.language,
        ...(t.durationSec ? { duration_sec: t.durationSec } : {}),
        lease_until: null,
        error_message: null,
        completed_at: new Date()
      }
    })
    if (res.count === 1) return true
    const row = await this.findById(id)
    return !!row && row.transcript_status === 'ready' && row.run_id === runId && row.transcript_hash === t.hash
  }

  /**
   * A transcription attempt ended without a transcript. Retryable errors go back to pending with a
   * delay until the attempts run out (the provider job is forgotten, the next attempt submits again).
   * Returns the new status, or null when the row was not transcribing any more.
   */
  public async finish(
    id: number,
    outcome: {
      kind: 'retry' | 'failed' | 'skipped'
      error: string
      retryDelayMs?: number
      clearJob?: boolean
    },
    guard: { runId?: string; expiredBefore?: Date } = {}
  ): Promise<PodcastTranscriptStatus | null> {
    const row = await this.findById(id)
    if (!row || row.transcript_status !== 'transcribing') return null
    const attempts = row.retry_count + 1
    let status: PodcastTranscriptStatus = outcome.kind === 'skipped' ? 'skipped' : 'failed'
    if (outcome.kind === 'retry' && attempts < PODCAST_EPISODE_MAX_ATTEMPTS) status = 'pending'
    const res = await this.prismaPg().sr_podcast_episode.updateMany({
      where: {
        id,
        transcript_status: 'transcribing',
        retry_count: row.retry_count,
        ...(guard.runId ? { run_id: guard.runId } : {}),
        ...(guard.expiredBefore ? { OR: [{ lease_until: null }, { lease_until: { lt: guard.expiredBefore } }] } : {})
      },
      data: {
        transcript_status: status,
        retry_count: outcome.kind === 'skipped' ? row.retry_count : attempts,
        lease_until: null,
        // The job is kept unless the provider itself failed it: a retry polls it again instead of paying twice
        provider_job_id: outcome.clearJob ? null : row.provider_job_id,
        next_retry_at: status === 'pending' ? new Date(Date.now() + (outcome.retryDelayMs ?? 10 * 60 * 1000)) : null,
        error_message: outcome.error.slice(0, 500)
      }
    })
    return res.count === 1 ? status : null
  }

  /** A pending episode that is not requested yet becomes requested: the sweep starts it after `at`. */
  public async defer(id: number, at: Date): Promise<boolean> {
    const res = await this.prismaPg().sr_podcast_episode.updateMany({ where: { id, transcript_status: 'pending' }, data: { next_retry_at: at } })
    return res.count === 1
  }

  /** Owner retry: failed → pending with fresh attempts. Never for a final error. The provider job is kept (see finish). */
  public async requeue(id: number): Promise<boolean> {
    const res = await this.prismaPg().sr_podcast_episode.updateMany({
      where: {
        id,
        transcript_status: 'failed',
        OR: [{ error_message: null }, { AND: PODCAST_FINAL_ERRORS.map(code => ({ NOT: { error_message: { startsWith: code } } })) }]
      },
      data: { transcript_status: 'pending', retry_count: 0, next_retry_at: new Date(), error_message: null }
    })
    return res.count === 1
  }

  public async countRunning(now: Date = new Date()): Promise<number> {
    return this.prismaPg().sr_podcast_episode.count({ where: { transcript_status: 'transcribing', lease_until: { gt: now } } })
  }

  /** Requested pending episodes whose start was put off, oldest first. */
  public async listRunnable(limit: number, now: Date = new Date()): Promise<podcastEpisodePO[]> {
    return this.prismaPg().sr_podcast_episode.findMany({ where: { transcript_status: 'pending', next_retry_at: { lte: now } }, orderBy: { next_retry_at: 'asc' }, take: limit })
  }

  public async listExpiredLeases(limit: number, now: Date = new Date()): Promise<podcastEpisodePO[]> {
    return this.prismaPg().sr_podcast_episode.findMany({
      where: { transcript_status: 'transcribing', OR: [{ lease_until: null }, { lease_until: { lt: now } }] },
      orderBy: { id: 'asc' },
      take: limit
    })
  }

  /**
   * Writing the article into the bookmark bodies failed: a ready episode gets a time for the sweep to
   * run it again (bodies only, no model calls). At most `max` times, counted in error_message.
   */
  public async markRepublish(id: number, at: Date, max = 5): Promise<boolean> {
    const row = await this.findById(id)
    if (!row || row.transcript_status !== 'ready') return false
    const done = Number(/^republish:(\d+)$/.exec(row.error_message ?? '')?.[1] ?? 0)
    if (done >= max) return false
    const res = await this.prismaPg().sr_podcast_episode.updateMany({
      where: { id, transcript_status: 'ready' },
      data: { next_retry_at: at, error_message: `republish:${done + 1}` }
    })
    return res.count === 1
  }

  /** Bodies written: nothing left for the sweep. */
  public async clearRepublish(id: number): Promise<void> {
    await this.prismaPg().sr_podcast_episode.updateMany({
      where: { id, transcript_status: 'ready', next_retry_at: { not: null } },
      data: { next_retry_at: null, error_message: null }
    })
  }

  /** Ready episodes whose bodies must be written again. */
  public async listRepublish(limit: number, now: Date = new Date()): Promise<podcastEpisodePO[]> {
    return this.prismaPg().sr_podcast_episode.findMany({ where: { transcript_status: 'ready', next_retry_at: { lte: now } }, orderBy: { next_retry_at: 'asc' }, take: limit })
  }

  /** Episodes no bookmark points at any more, untouched for a while and not running. */
  public async listOrphans(olderThan: Date, limit: number): Promise<podcastEpisodePO[]> {
    return this.prismaPg().$queryRaw<podcastEpisodePO[]>(Prisma.sql`
      SELECT e.* FROM "sr_podcast_episode" e
      WHERE e."updated_at" < ${olderThan}
        AND e."transcript_status" <> 'transcribing'
        AND NOT EXISTS (SELECT 1 FROM "sr_youtube_article_ref" r WHERE r."media_kind" = 'podcast' AND r."video_id" = e."source_id")
      ORDER BY e."id" ASC
      LIMIT ${limit}
    `)
  }

  public async deleteOrphan(id: number, olderThan: Date): Promise<boolean> {
    const count = await this.prismaPg().$executeRaw(Prisma.sql`
      DELETE FROM "sr_podcast_episode" e
      WHERE e."id" = ${id}
        AND e."updated_at" < ${olderThan}
        AND e."transcript_status" <> 'transcribing'
        AND NOT EXISTS (SELECT 1 FROM "sr_youtube_article_ref" r WHERE r."media_kind" = 'podcast' AND r."video_id" = e."source_id")
    `)
    return count === 1
  }
}
