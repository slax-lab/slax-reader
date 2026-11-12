import { Prisma, PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { ArticleVectorIdentity } from '@/utils/vectorMaintenanceTypes'
import type { VectorSource } from '@/utils/vectorSources'
import type { ShareGroup } from '@/utils/preferenceLedger'

export type VectorArticleRow = VectorSource & {
  id: number
  user_id: number
  private_user: number
  status: string
  updated_at: Date
  published_at: Date
}
export type VectorCollectionRow = { id: number; owner_id: number; published_at: number; sharing: boolean }
export type VectorArticleMember = { id: number; is_starred: boolean; share_group: ShareGroup }
export type VectorRelation = { id: number; user_id: number }

const readable = Prisma.sql`(b.private_user = 0 OR b.private_user = ub.user_id)`
const published = Prisma.sql`ub.is_starred AND b.moderation_result = 0 AND COALESCE(share.is_enable, owner.snapshot_sharing)
  AND EXISTS (SELECT 1 FROM sr_user_collection c WHERE c.owner_id = ub.user_id AND c.status = 1 AND c.collection_code <> '')`
const candidate = Prisma.sql`ub.is_starred AND b.moderation_result = 0`
const shareGroup = Prisma.sql`CASE WHEN NOT COALESCE(bool_or(${candidate}), false) THEN 'none'
  WHEN bool_or(share.bookmark_id IS NULL) THEN 'inherited' WHEN bool_or(share.is_enable) THEN 'shared' ELSE 'none' END`

@injectable()
export class VectorMaintenanceRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<HyperdrivePrismaClient>) {}

  findArticles(identities: ArticleVectorIdentity[]): Promise<VectorArticleRow[]> {
    return this.prismaPg().$queryRaw<VectorArticleRow[]>`
      SELECT b.*, ub.user_id
      FROM jsonb_to_recordset(${JSON.stringify(identities)}::jsonb) AS requested("userId" int, id int)
      JOIN sr_user_bookmark ub ON ub.user_id = requested."userId" AND ub.bookmark_id = requested.id
      JOIN sr_bookmark b ON b.id = ub.bookmark_id
      JOIN sr_user owner ON owner.id = ub.user_id AND owner.deleted_at IS NULL
      WHERE ub.deleted_at IS NULL AND ub.type IN (0, 2) AND ${readable}`
  }

  async findCollection(id: number): Promise<VectorCollectionRow | undefined> {
    const rows = await this.prismaPg().$queryRaw<VectorCollectionRow[]>`
      SELECT c.id, c.owner_id, owner.snapshot_sharing AS sharing, (
        SELECT (EXTRACT(EPOCH FROM MAX(GREATEST(b.published_at, b.updated_at)) AT TIME ZONE 'UTC') * 1000)::double precision
        FROM sr_user_bookmark ub JOIN sr_bookmark b ON b.id = ub.bookmark_id
        LEFT JOIN sr_bookmark_share share ON share.bookmark_id = b.id AND share.user_id = ub.user_id
        WHERE ub.user_id = c.owner_id AND ub.deleted_at IS NULL AND ub.type IN (0, 2)
          AND b.status = 'success' AND ${readable} AND ${published}
      ) AS published_at FROM sr_user_collection c
      JOIN sr_user owner ON owner.id = c.owner_id AND owner.deleted_at IS NULL
      WHERE c.id = ${id} AND c.status = 1 AND c.collection_code <> ''`
    return rows[0]
  }

  listUserArticles(userId: number, after: number, limit: number): Promise<VectorArticleMember[]> {
    return this.prismaPg().$queryRaw<VectorArticleMember[]>`
      SELECT ub.bookmark_id AS id, bool_or(ub.is_starred) AS is_starred, ${shareGroup} AS share_group
      FROM sr_user_bookmark ub JOIN sr_bookmark b ON b.id = ub.bookmark_id
      JOIN sr_user owner ON owner.id = ub.user_id AND owner.deleted_at IS NULL
      LEFT JOIN sr_bookmark_share share ON share.bookmark_id = ub.bookmark_id AND share.user_id = ub.user_id
      WHERE ub.user_id = ${userId} AND ub.deleted_at IS NULL AND ub.type IN (0, 2) AND ub.bookmark_id > ${after} AND ${readable}
        AND b.status = 'success'
      GROUP BY ub.bookmark_id ORDER BY ub.bookmark_id LIMIT ${limit}`
  }

  listRecentUserActions(userId: number, sinceDate: Date, limit: number): Promise<{ id: number; acted_at: Date }[]> {
    return this.prismaPg().$queryRaw<{ id: number; acted_at: Date }[]>`
      SELECT id, acted_at FROM (
        SELECT ub.bookmark_id AS id, ub.created_at AS acted_at
        FROM sr_user_bookmark ub JOIN sr_bookmark b ON b.id = ub.bookmark_id
        JOIN sr_user owner ON owner.id = ub.user_id AND owner.deleted_at IS NULL
        WHERE ub.user_id = ${userId} AND ub.deleted_at IS NULL AND ub.type IN (0, 2) AND ${readable}
          AND b.status = 'success' AND ub.created_at >= ${sinceDate}
        UNION ALL
        SELECT ub.bookmark_id AS id, COALESCE(ub.starred_at, ub.created_at) AS acted_at
        FROM sr_user_bookmark ub JOIN sr_bookmark b ON b.id = ub.bookmark_id
        JOIN sr_user owner ON owner.id = ub.user_id AND owner.deleted_at IS NULL
        WHERE ub.user_id = ${userId} AND ub.deleted_at IS NULL AND ub.type IN (0, 2) AND ${readable}
          AND b.status = 'success' AND ub.is_starred AND COALESCE(ub.starred_at, ub.created_at) >= ${sinceDate}
      ) actions ORDER BY acted_at DESC, id DESC LIMIT ${limit}`
  }

  findUserPreferenceRows(userId: number, ids: number[]): Promise<VectorArticleMember[]> {
    return this.prismaPg().$queryRaw<VectorArticleMember[]>`
      SELECT ub.bookmark_id AS id, bool_or(ub.is_starred) AS is_starred, ${shareGroup} AS share_group
      FROM sr_user_bookmark ub JOIN sr_bookmark b ON b.id = ub.bookmark_id
      JOIN sr_user owner ON owner.id = ub.user_id AND owner.deleted_at IS NULL
      LEFT JOIN sr_bookmark_share share ON share.bookmark_id = ub.bookmark_id AND share.user_id = ub.user_id
      WHERE ub.user_id = ${userId} AND ub.bookmark_id IN (SELECT value::int FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
        AND ub.deleted_at IS NULL AND ub.type IN (0, 2) AND ${readable} AND b.status = 'success'
      GROUP BY ub.bookmark_id`
  }

  listUserCollections(userId: number, after: number, limit: number): Promise<{ id: number }[]> {
    return this.prismaPg().$queryRaw<{ id: number }[]>`
      SELECT c.id FROM sr_user_collection_subscriber subscription
      JOIN sr_user_collection c ON c.id = subscription.collection_id
      JOIN sr_user owner ON owner.id = c.owner_id AND owner.deleted_at IS NULL
      JOIN sr_user subscriber ON subscriber.id = subscription.user_id AND subscriber.deleted_at IS NULL
      WHERE subscription.user_id = ${userId} AND c.id > ${after} AND subscription.is_deleted = false
        AND subscription.is_active = true AND subscription.subscription_end_time > now()
        AND c.status = 1 AND c.collection_code <> '' AND c.owner_id <> ${userId}
        AND EXISTS (
          SELECT 1 FROM sr_user_bookmark ub
          JOIN sr_bookmark b ON b.id = ub.bookmark_id
          LEFT JOIN sr_bookmark_share share ON share.bookmark_id = b.id AND share.user_id = ub.user_id
          WHERE ub.user_id = c.owner_id AND ub.deleted_at IS NULL AND ub.type IN (0, 2)
            AND b.status = 'success' AND ${readable} AND ${published}
        )
      GROUP BY c.id ORDER BY c.id LIMIT ${limit}`
  }

  listContentOwners(bookmarkId: number, after: number, limit: number): Promise<VectorRelation[]> {
    return this.prismaPg().$queryRaw<VectorRelation[]>`
      SELECT ub.id, ub.user_id FROM sr_user_bookmark ub
      JOIN sr_bookmark b ON b.id = ub.bookmark_id JOIN sr_user u ON u.id = ub.user_id
      WHERE ub.bookmark_id = ${bookmarkId} AND ub.id > ${after} AND u.deleted_at IS NULL
        AND ub.type IN (0, 2) AND ${readable}
      ORDER BY ub.id LIMIT ${limit}`
  }

  listSubscriberUsers(collectionId: number, after: number, limit: number): Promise<VectorRelation[]> {
    return this.prismaPg().$queryRaw<VectorRelation[]>`
      SELECT subscription.id, subscription.user_id FROM sr_user_collection_subscriber subscription
      JOIN sr_user_collection c ON c.id = subscription.collection_id
      JOIN sr_user subscriber ON subscriber.id = subscription.user_id AND subscriber.deleted_at IS NULL
      WHERE subscription.collection_id = ${collectionId} AND subscription.id > ${after}
        AND subscription.is_deleted = false AND subscription.is_active = true AND subscription.subscription_end_time > now()
        AND c.owner_id <> subscription.user_id
      ORDER BY subscription.id LIMIT ${limit}`
  }

  listUserBookmarkIds(userId: number, after: number, limit: number): Promise<{ id: number; bookmark_id: number }[]> {
    return this.prismaPg().$queryRaw<{ id: number; bookmark_id: number }[]>`
      SELECT id, bookmark_id FROM sr_user_bookmark
      WHERE user_id = ${userId} AND id > ${after} ORDER BY id LIMIT ${limit}`
  }

  listOwnerCollections(userId: number): Promise<{ id: number }[]> {
    return this.prismaPg().$queryRaw<{ id: number }[]>`SELECT id FROM sr_user_collection WHERE owner_id = ${userId}`
  }
}
