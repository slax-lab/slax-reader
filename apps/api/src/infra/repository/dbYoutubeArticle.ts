import { inject, injectable, singleton } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import { PrismaClient as HyperdrivePrismaClient, type Prisma } from '@prisma/hyperdrive-client'

/** Prompt contract version of the AI article. Bump when the prompt or output schema changes. */
export const YOUTUBE_ARTICLE_PROMPT_VERSION = 'v1'
export const YOUTUBE_ARTICLE_SCHEMA_VERSION = 1

/** pending / classifying / skipped / generating / validating / ready / failed / stale */
export type YoutubeArticleStatus = 'pending' | 'classifying' | 'skipped' | 'generating' | 'validating' | 'ready' | 'failed' | 'stale'

/** Rows that a fresh evaluation may overwrite. Anything further along keeps its state. */
const REEVALUABLE_STATUSES: YoutubeArticleStatus[] = ['pending', 'skipped']

/** Canonical row: one per (video_id, source_hash, prompt_version), shared by every bookmark of that video. */
export interface youtubeArticlePO {
  id: number
  video_id: string
  caption_key: string | null
  caption_text_key: string | null
  caption_language: string | null
  caption_kind: string | null
  source_hash: string
  eligibility_json: Prisma.JsonValue | null
  status: string
  article_key: string | null
  article_text_key: string | null
  model: string | null
  prompt_version: string
  schema_version: number
  quality_json: Prisma.JsonValue | null
  retry_count: number
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
  prompt_version: string
  schema_version: number
  status: Extract<YoutubeArticleStatus, 'pending' | 'skipped'>
  /** Plain JSON-serializable object (the eligibility result). */
  eligibility: object
}

/**
 * Job table for the derived YouTube article. Only pointers, versions, status and the gate result
 * live here; captions and articles are R2 objects under youtube/canonical/. Bookmarks point at a
 * (video_id, source_hash) through sr_youtube_article_ref; visibility is always decided by the
 * bookmark, never by these rows.
 */
@injectable()
export class YoutubeArticleRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<HyperdrivePrismaClient>) {}

  /**
   * Record the eligibility result for a caption source. Creates the row, or refreshes it while it
   * is still pending/skipped; a row that already moved on (generating, ready, ...) is returned as is.
   */
  public async recordEvaluation(input: YoutubeArticleEvaluation): Promise<youtubeArticlePO> {
    const where = {
      video_id_source_hash_prompt_version: {
        video_id: input.video_id,
        source_hash: input.source_hash,
        prompt_version: input.prompt_version
      }
    }
    const existing = await this.prismaPg().sr_youtube_article.findUnique({ where })
    if (existing && !REEVALUABLE_STATUSES.includes(existing.status as YoutubeArticleStatus)) return existing

    const data = {
      caption_key: input.caption_key,
      caption_text_key: input.caption_text_key,
      caption_language: input.caption_language,
      caption_kind: input.caption_kind,
      schema_version: input.schema_version,
      eligibility_json: input.eligibility as Prisma.InputJsonObject,
      status: input.status
    }
    return this.prismaPg().sr_youtube_article.upsert({
      where,
      create: { ...data, video_id: input.video_id, source_hash: input.source_hash, prompt_version: input.prompt_version },
      update: data
    })
  }

  /** Point a bookmark at the caption version it was crawled with. A re-crawl moves the pointer. */
  public async linkBookmark(input: { bookmark_id: number; user_id: number; video_id: string; source_hash: string }): Promise<youtubeArticleRefPO> {
    return this.prismaPg().sr_youtube_article_ref.upsert({
      where: { bookmark_id: input.bookmark_id },
      create: input,
      update: { user_id: input.user_id, video_id: input.video_id, source_hash: input.source_hash }
    })
  }

  /** The canonical row a bookmark currently points at, for the given prompt version. */
  public async findForBookmark(bookmarkId: number, promptVersion: string = YOUTUBE_ARTICLE_PROMPT_VERSION): Promise<youtubeArticlePO | null> {
    const ref = await this.prismaPg().sr_youtube_article_ref.findUnique({ where: { bookmark_id: bookmarkId } })
    if (!ref) return null
    return this.prismaPg().sr_youtube_article.findUnique({
      where: { video_id_source_hash_prompt_version: { video_id: ref.video_id, source_hash: ref.source_hash, prompt_version: promptVersion } }
    })
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
