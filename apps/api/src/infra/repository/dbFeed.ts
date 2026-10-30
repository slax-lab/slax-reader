import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import type { PrismaClient } from '@prisma/hyperdrive-client'
import type { FeedKind, FeedSubscription } from '@slax-reader/contracts'
import { RssError } from '@/domain/rss/feed'
import type { RssEntryRow, RssFeedRow } from './dbRss'
export interface FeedEntryRow {
  id: string
  kind: FeedKind
  subscription_id: string
  source_title: string
  title: string
  author: string | null
  summary: string
  article_url: string | null
  image_url: string | null
  published_at: Date | null
  first_seen_at: Date
  sort_at: Date
  bookmark_user_uuid: string | null
  content_key: string
  content_truncated: boolean
}
export interface FeedCursor {
  at: Date
  kind: FeedKind
  id: string
}
@injectable()
export class FeedRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private pg: LazyInstance<PrismaClient>) {}
  async enabledKinds(userId: number): Promise<FeedKind[]> {
    const rows = await this.pg().$queryRaw<
      { kind: FeedKind }[]
    >`SELECT l.feature AS kind FROM sr_user_lab_feature l JOIN sr_user u ON u.id=l.user_id AND u.deleted_at IS NULL WHERE l.user_id=${userId} AND l.enabled AND l.feature IN ('rss','newsletter') ORDER BY l.feature`
    return rows.map(row => row.kind)
  }
  async newsletterSources(userId: number): Promise<FeedSubscription[]> {
    return this.pg()
      .$queryRaw`SELECT DISTINCT ON (n.source_key) 'newsletter:'||n.source_key AS id,'newsletter' AS kind,COALESCE(NULLIF(n.sender_name,''),n.sender) AS title,n.sender
   FROM sr_newsletter_feed n JOIN sr_user u ON u.id=n.user_id AND u.deleted_at IS NULL JOIN sr_user_lab_feature l ON l.user_id=n.user_id AND l.feature='newsletter' AND l.enabled
   WHERE n.user_id=${userId} AND n.state='ready' ORDER BY n.source_key,n.received_at DESC,n.id DESC`
  }
  private async rows(userId: number, kinds: FeedKind[], subscription: string | null, cursor: FeedCursor | null, limit: number, id: string | null = null): Promise<FeedEntryRow[]> {
    return this.pg().$queryRaw`WITH items AS (
   SELECT e.id,'rss'::text AS kind,s.id AS subscription_id,COALESCE(NULLIF(s.remark,''),f.title) AS source_title,e.title,e.author,e.summary,e.article_url,e.image_url,e.published_at,e.first_seen_at,e.sort_at,ub.uuid AS bookmark_user_uuid,e.content_key,e.content_truncated,e.id AS rss_id,NULL::bigint AS mail_id
   FROM sr_rss_entry e JOIN sr_rss_feed f ON f.id=e.feed_id JOIN sr_rss_subscription s ON s.feed_id=e.feed_id
   JOIN sr_user u ON u.id=s.user_id AND u.deleted_at IS NULL JOIN sr_user_lab_feature l ON l.user_id=s.user_id AND l.feature='rss' AND l.enabled
   LEFT JOIN sr_bookmark b ON b.target_url=e.article_url AND b.private_user=${userId} LEFT JOIN sr_user_bookmark ub ON ub.bookmark_id=b.id AND ub.user_id=${userId} AND ub.deleted_at IS NULL
   WHERE s.user_id=${userId} AND 'rss'=ANY(${kinds}::text[])
   UNION ALL
   SELECT 'newsletter:'||n.id::text,'newsletter','newsletter:'||n.source_key,COALESCE(NULLIF(n.sender_name,''),n.sender),n.title,n.sender_name,n.excerpt AS summary,NULL::text,NULL::text,n.published_at,n.received_at,n.received_at,ub.uuid,n.content_key,n.content_truncated,NULL::text,n.id
   FROM sr_newsletter_feed n JOIN sr_user u ON u.id=n.user_id AND u.deleted_at IS NULL JOIN sr_user_lab_feature l ON l.user_id=n.user_id AND l.feature='newsletter' AND l.enabled
   LEFT JOIN sr_bookmark b ON b.target_url='slax-newsletter://message/'||n.id::text AND b.private_user=${userId} AND b.status='success' LEFT JOIN sr_user_bookmark ub ON ub.bookmark_id=b.id AND ub.user_id=${userId} AND ub.deleted_at IS NULL
   WHERE n.user_id=${userId} AND n.state='ready' AND 'newsletter'=ANY(${kinds}::text[])
  ) SELECT * FROM items WHERE (${subscription}::text IS NULL OR subscription_id=${subscription}) AND (${id}::text IS NULL OR id=${id})
   AND (${cursor?.at || null}::timestamp IS NULL OR sort_at<${cursor?.at || null}::timestamp OR (sort_at=${cursor?.at || null}::timestamp AND (kind<${cursor?.kind || ''} OR (kind=${cursor?.kind || ''} AND ((kind='rss' AND rss_id<${cursor?.id || ''}) OR (kind='newsletter' AND mail_id<${cursor?.kind === 'newsletter' ? cursor.id.slice(11) : null}::bigint))))))
  ORDER BY sort_at DESC,kind DESC,rss_id DESC NULLS LAST,mail_id DESC NULLS LAST LIMIT ${limit}`
  }
  entries(userId: number, kinds: FeedKind[], subscription: string | null, cursor: FeedCursor | null, limit: number) {
    return this.rows(userId, kinds, subscription, cursor, limit)
  }
  async entry(userId: number, id: string, kinds: FeedKind[]) {
    const [row] = await this.rows(userId, kinds, null, null, 1, id)
    if (!row) throw new RssError('not_found', 404)
    return row
  }
  async historyFeeds(userId: number, subscription: string | null): Promise<RssFeedRow[]> {
    return this.pg()
      .$queryRaw`SELECT f.* FROM sr_rss_feed f JOIN sr_rss_subscription s ON s.feed_id=f.id JOIN sr_user u ON u.id=s.user_id AND u.deleted_at IS NULL JOIN sr_user_lab_feature l ON l.user_id=s.user_id AND l.feature='rss' AND l.enabled WHERE s.user_id=${userId} AND (${subscription}::text IS NULL OR s.id=${subscription}) ORDER BY f.id`
  }
  async oldestRssEntry(userId: number, subscription: string | null): Promise<RssEntryRow | null> {
    const [row] = await this.pg().$queryRaw<
      RssEntryRow[]
    >`SELECT e.*,s.id AS subscription_id,COALESCE(NULLIF(s.remark,''),f.title) AS source_title,NULL::text AS bookmark_user_uuid FROM sr_rss_entry e JOIN sr_rss_feed f ON f.id=e.feed_id JOIN sr_rss_subscription s ON s.feed_id=e.feed_id JOIN sr_user u ON u.id=s.user_id AND u.deleted_at IS NULL JOIN sr_user_lab_feature l ON l.user_id=s.user_id AND l.feature='rss' AND l.enabled WHERE s.user_id=${userId} AND (${subscription}::text IS NULL OR s.id=${subscription}) ORDER BY e.sort_at,e.id LIMIT 1`
    return row || null
  }
}
