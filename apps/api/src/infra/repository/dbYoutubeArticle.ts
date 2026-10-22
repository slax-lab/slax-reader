import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import { PrismaClient as HyperdrivePrismaClient, Prisma } from '@prisma/hyperdrive-client'
import { MediaArticleRepo, type MediaKind } from '@/infra/repository/dbMediaArticle'

export {
  FINAL_ERRORS,
  isFinalError,
  eligibilityDecision,
  MEDIA_ARTICLE_MAX_ATTEMPTS as YOUTUBE_ARTICLE_MAX_ATTEMPTS,
  type mediaArticlePO as youtubeArticlePO,
  type mediaArticleRefPO as youtubeArticleRefPO,
  type MediaArticleEvaluation as YoutubeArticleEvaluation,
  type MediaArticlePublish as YoutubeArticlePublish,
  type MediaArticleStatus as YoutubeArticleStatus
} from '@/infra/repository/dbMediaArticle'

/** Prompt contract version of the AI article. Bump when the prompt or output schema changes. */
export const YOUTUBE_ARTICLE_PROMPT_VERSION = 'v1'
export const YOUTUBE_ARTICLE_SCHEMA_VERSION = 1

/** YouTube rows of the media article tables: source_id is the video id. */
@injectable()
export class YoutubeArticleRepo extends MediaArticleRepo {
  protected readonly kind: MediaKind = 'youtube'
  protected readonly promptVersion = YOUTUBE_ARTICLE_PROMPT_VERSION

  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) prismaPg: LazyInstance<HyperdrivePrismaClient>) {
    super(prismaPg)
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
}
