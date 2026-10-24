import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import type { PrismaClient } from '@prisma/hyperdrive-client'
import type { FeedKind } from '@slax-reader/contracts'
import { RssError } from '@/domain/rss/feed'
import type { RssCursor, RssEntryRow, RssFeedRow, RssSubscriptionRow } from './dbRss'

export interface FeedSubscriptionRow extends RssSubscriptionRow {
  kind: FeedKind
}
export interface FeedEntryRow extends RssEntryRow {
  kind: FeedKind
}

/** Read facade only. RSS fetching and newsletter ingestion retain separate write boundaries. */
@injectable()
export class FeedRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<PrismaClient>) {}

  async enabledKinds(userId: number): Promise<FeedKind[]> {
    const rows = await this.prismaPg().$queryRaw<{ kind: FeedKind }[]>`SELECT l.feature AS kind
      FROM sr_user_lab_feature l JOIN sr_user u ON u.id=l.user_id AND u.deleted_at IS NULL
      WHERE l.user_id=${userId} AND l.enabled AND l.feature IN ('rss','newsletter') ORDER BY l.feature`
    return rows.map(row => row.kind)
  }

  async subscriptions(userId: number, kinds: FeedKind[]): Promise<FeedSubscriptionRow[]> {
    return this.prismaPg().$queryRaw`SELECT f.*,s.id,s.feed_id,s.user_id,s.remark
      FROM sr_rss_subscription s JOIN sr_rss_feed f ON f.id=s.feed_id
      JOIN sr_user u ON u.id=s.user_id AND u.deleted_at IS NULL
      JOIN sr_user_lab_feature l ON l.user_id=s.user_id AND l.feature=f.kind AND l.enabled
      WHERE s.user_id=${userId} AND f.kind=ANY(${kinds}::text[]) ORDER BY s.created_at,s.id`
  }

  async entries(userId: number, kinds: FeedKind[], subscription: string | null, cursor: RssCursor | null, limit: number, withHistory = false): Promise<FeedEntryRow[]> {
    return this.prismaPg().$queryRaw`SELECT e.*,f.kind,s.id AS subscription_id,COALESCE(NULLIF(s.remark,''),f.title) AS source_title,ub.uuid AS bookmark_user_uuid
      FROM sr_rss_entry e JOIN sr_rss_feed f ON f.id=e.feed_id JOIN sr_rss_subscription s ON s.feed_id=e.feed_id
      JOIN sr_user u ON u.id=s.user_id AND u.deleted_at IS NULL
      JOIN sr_user_lab_feature l ON l.user_id=s.user_id AND l.feature=f.kind AND l.enabled
      LEFT JOIN sr_bookmark b ON f.kind='rss' AND b.target_url=e.article_url AND b.private_user=${userId}
      LEFT JOIN sr_user_bookmark ub ON ub.bookmark_id=b.id AND ub.user_id=${userId} AND ub.deleted_at IS NULL
      WHERE s.user_id=${userId} AND f.kind=ANY(${kinds}::text[]) AND (${subscription}::text IS NULL OR s.id=${subscription})
        AND (${cursor?.at || null}::timestamp IS NULL OR (e.sort_at,e.id)<(${cursor?.at || null}::timestamp,${cursor?.id || ''}::text) OR (${withHistory} AND f.kind='rss' AND e.is_history))
      ORDER BY e.sort_at DESC,e.id DESC LIMIT ${limit}`
  }

  async entry(userId: number, id: string, kinds: FeedKind[]): Promise<FeedEntryRow> {
    const [row] = await this.prismaPg().$queryRaw<
      FeedEntryRow[]
    >`SELECT e.*,f.kind,s.id AS subscription_id,COALESCE(NULLIF(s.remark,''),f.title) AS source_title,ub.uuid AS bookmark_user_uuid
      FROM sr_rss_entry e JOIN sr_rss_feed f ON f.id=e.feed_id JOIN sr_rss_subscription s ON s.feed_id=e.feed_id
      JOIN sr_user u ON u.id=s.user_id AND u.deleted_at IS NULL
      JOIN sr_user_lab_feature l ON l.user_id=s.user_id AND l.feature=f.kind AND l.enabled
      LEFT JOIN sr_bookmark b ON f.kind='rss' AND b.target_url=e.article_url AND b.private_user=${userId}
      LEFT JOIN sr_user_bookmark ub ON ub.bookmark_id=b.id AND ub.user_id=${userId} AND ub.deleted_at IS NULL
      WHERE s.user_id=${userId} AND f.kind=ANY(${kinds}::text[]) AND e.id=${id}`
    if (!row) throw new RssError('not_found', 404)
    return row
  }

  async historyFeeds(userId: number, subscription: string | null): Promise<RssFeedRow[]> {
    return this.prismaPg().$queryRaw`SELECT f.* FROM sr_rss_feed f JOIN sr_rss_subscription s ON s.feed_id=f.id
      JOIN sr_user u ON u.id=s.user_id AND u.deleted_at IS NULL
      JOIN sr_user_lab_feature l ON l.user_id=s.user_id AND l.feature='rss' AND l.enabled
      WHERE f.kind='rss' AND s.user_id=${userId} AND (${subscription}::text IS NULL OR s.id=${subscription})
      ORDER BY f.history_checked_at ASC NULLS FIRST,f.id`
  }
}
