import { inject, injectable } from '../../decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '../../const/symbol'
import type { LazyInstance } from '../../decorators/lazy'
import { Prisma, type PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import type { ArticleVectorIdentity } from '../../utils/vectorMaintenanceTypes'

export interface ArticleRecommendationRow {
  id: number
  user_id: number
  uuid: string
  title: string
  target_url: string
  published_at: Date | string
  collection_id: number
}

export interface CollectionRecommendationRow {
  id: number
  owner_id: number
  collection_code: string
  display_name: string
  description: string
}

const PUBLIC_MEMBER = Prisma.sql`ub.deleted_at IS NULL AND ub.is_starred = true AND ub.type IN (0, 2)
  AND (b.private_user = 0 OR b.private_user = ub.user_id)
  AND b.status = 'success' AND b.moderation_result = 0
  AND owner.deleted_at IS NULL AND c.status = 1 AND c.collection_code <> ''
  AND COALESCE(share.is_enable, owner.snapshot_sharing) = true`

function publicCandidate(viewerId: number) {
  return Prisma.sql`${PUBLIC_MEMBER} AND ub.user_id <> ${viewerId}
    AND NOT EXISTS (SELECT 1 FROM sr_user_bookmark saved JOIN sr_bookmark saved_b ON saved_b.id = saved.bookmark_id
      WHERE saved.user_id = ${viewerId} AND saved.deleted_at IS NULL
      AND (saved.bookmark_id = b.id OR saved_b.target_url = b.target_url))`
}

@injectable()
export class ContentRecommendationRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<HyperdrivePrismaClient>) {}

  async getArticleCandidates(pairs: ArticleVectorIdentity[], viewerId: number): Promise<ArticleRecommendationRow[]> {
    if (!pairs.length) return []
    return this.prismaPg().$queryRaw<ArticleRecommendationRow[]>(Prisma.sql`
      WITH candidates(user_id, bookmark_id) AS (
        VALUES ${Prisma.join(pairs.map(pair => Prisma.sql`(${pair.userId}::int, ${pair.id}::int)`))}
      )
      SELECT b.id, ub.user_id, ub.uuid, COALESCE(NULLIF(ub.alias_title, ''), b.title) AS title,
        b.target_url, b.published_at, c.id AS collection_id
      FROM candidates candidate
      JOIN sr_user_bookmark ub ON ub.user_id = candidate.user_id AND ub.bookmark_id = candidate.bookmark_id
      JOIN sr_bookmark b ON b.id = ub.bookmark_id
      JOIN sr_user owner ON owner.id = ub.user_id
      JOIN sr_user_collection c ON c.owner_id = owner.id
      LEFT JOIN sr_bookmark_share share ON share.user_id = ub.user_id AND share.bookmark_id = b.id
      WHERE ${publicCandidate(viewerId)}
    `)
  }

  async getLatestCandidates(viewerId: number, limit: number): Promise<ArticleVectorIdentity[]> {
    return this.prismaPg().$queryRaw<ArticleVectorIdentity[]>(Prisma.sql`
      SELECT ub.user_id AS "userId", b.id
      FROM sr_user_bookmark ub
      JOIN sr_bookmark b ON b.id = ub.bookmark_id
      JOIN sr_user owner ON owner.id = ub.user_id
      JOIN sr_user_collection c ON c.owner_id = owner.id
      LEFT JOIN sr_bookmark_share share ON share.user_id = ub.user_id AND share.bookmark_id = b.id
      WHERE ${publicCandidate(viewerId)}
      ORDER BY b.published_at DESC, ub.user_id, b.id LIMIT ${limit}
    `)
  }

  async getPopularCandidates(viewerId: number, windowHours: number, limit: number): Promise<ArticleVectorIdentity[]> {
    return this.prismaPg().$queryRaw<ArticleVectorIdentity[]>(Prisma.sql`
      SELECT ub.user_id AS "userId", b.id
      FROM sr_user_bookmark ub
      JOIN sr_bookmark b ON b.id = ub.bookmark_id
      JOIN sr_user owner ON owner.id = ub.user_id
      JOIN sr_user_collection c ON c.owner_id = owner.id
      LEFT JOIN sr_bookmark_share share ON share.user_id = ub.user_id AND share.bookmark_id = b.id
      CROSS JOIN LATERAL (
        SELECT COUNT(DISTINCT s.user_id) AS popularity
        FROM sr_user_bookmark s JOIN sr_bookmark sb ON sb.id = s.bookmark_id
        WHERE s.deleted_at IS NULL AND sb.target_url = b.target_url
      ) counts
      WHERE ${publicCandidate(viewerId)} AND b.published_at >= now() - ${windowHours} * interval '1 hour'
      ORDER BY counts.popularity DESC, b.published_at DESC, ub.user_id, b.id LIMIT ${limit}
    `)
  }

  async getCollectionCandidates(ids: number[], viewerId: number): Promise<CollectionRecommendationRow[]> {
    if (!ids.length) return []
    return this.prismaPg().$queryRaw<CollectionRecommendationRow[]>(Prisma.sql`
      SELECT c.id, c.owner_id, c.collection_code, c.display_name, c.description
      FROM sr_user_collection c JOIN sr_user owner ON owner.id = c.owner_id
      WHERE c.id IN (${Prisma.join(ids)}) AND c.status = 1 AND c.collection_code <> ''
        AND owner.deleted_at IS NULL AND c.owner_id <> ${viewerId}
        AND NOT EXISTS (SELECT 1 FROM sr_user_collection_subscriber sub
          WHERE sub.collection_id = c.id AND sub.user_id = ${viewerId} AND NOT sub.is_deleted
          AND sub.is_active AND sub.subscription_end_time > now())
    `)
  }

  async getRecentMembers(ids: number[], limit: number): Promise<ArticleRecommendationRow[]> {
    if (!ids.length) return []
    return this.prismaPg().$queryRaw<ArticleRecommendationRow[]>(Prisma.sql`
      SELECT id, user_id, uuid, title, target_url, published_at, collection_id FROM (
        SELECT b.id, ub.user_id, ub.uuid, COALESCE(NULLIF(ub.alias_title, ''), b.title) AS title,
          b.target_url, b.published_at, c.id AS collection_id,
          row_number() OVER (PARTITION BY c.id ORDER BY COALESCE(ub.starred_at, ub.created_at) DESC, ub.id DESC) AS member_rank
        FROM sr_user_collection c
        JOIN sr_user owner ON owner.id = c.owner_id
        JOIN sr_user_bookmark ub ON ub.user_id = owner.id
        JOIN sr_bookmark b ON b.id = ub.bookmark_id
        LEFT JOIN sr_bookmark_share share ON share.user_id = ub.user_id AND share.bookmark_id = b.id
        WHERE c.id IN (${Prisma.join(ids)}) AND ${PUBLIC_MEMBER}
      ) members WHERE member_rank <= ${limit} ORDER BY collection_id, member_rank
    `)
  }
}
