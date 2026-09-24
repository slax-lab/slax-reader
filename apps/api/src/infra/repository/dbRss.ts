import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import type { PrismaClient, Prisma } from '@prisma/hyperdrive-client'
import { RssError, RSS_LIMITS, type FeedItem, type ParsedFeed } from '@/domain/rss/feed'
import type { RssSaveResponse } from '@slax-reader/contracts'
import { hashSHA256 } from '@/utils/strings'

type Tx = Prisma.TransactionClient
export interface RssFeedRow {
  id: string
  feed_url: string
  title: string
  site_url: string | null
  etag: string | null
  last_modified: string | null
  last_checked_at: Date | null
  last_success_at: Date | null
  next_fetch_at: Date
  next_allowed_at: Date
  error: string | null
  failure_count: number
  lease_token: string | null
  lease_until: Date | null
  history_url: string | null
  history_seen: string[]
  history_checked_at: Date | null
  history_retry_at: Date | null
  claimed?: boolean
}
export interface RssSubscriptionRow extends RssFeedRow {
  feed_id: string
  user_id: number
  remark: string | null
}
export type StoredFeedItem = Omit<FeedItem, 'content_html'> & { content_key: string }
export type StoredFeedResult =
  | { unchanged: true }
  | { unchanged: false; feed: Omit<ParsedFeed, 'items'> & { items: StoredFeedItem[] }; etag: string | null; lastModified: string | null }
export interface RssEntryRow {
  id: string
  feed_id: string
  subscription_id: string
  source_title: string
  title: string
  author: string | null
  summary: string
  article_url: string | null
  content_key: string
  content_truncated: boolean
  image_url: string | null
  published_at: Date | null
  first_seen_at: Date
  sort_at: Date
  updated_at: Date
  bookmark_user_uuid: string | null
}
export interface RssSaveJob {
  bookmark_id: number
  user_id: number
  target_url: string
  lang: string
  status: string
}
export interface RssCursor {
  at: Date
  id: string
}

@injectable()
export class RssRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<PrismaClient>) {}

  private async active(tx: Tx, userId: number) {
    const user = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM sr_user WHERE id=${userId} AND deleted_at IS NULL FOR UPDATE`
    if (!user.length) throw new RssError('not_found', 404)
    const enabled = await tx.$queryRaw<{ enabled: boolean }[]>`SELECT enabled FROM sr_user_lab_feature WHERE user_id=${userId} AND feature='rss'`
    if (!enabled[0]?.enabled) throw new RssError('lab_disabled', 403)
  }
  private async subscription(tx: Tx, userId: number, id: string): Promise<RssSubscriptionRow> {
    const [row] = await tx.$queryRaw<
      RssSubscriptionRow[]
    >`SELECT f.*,s.id,s.feed_id,s.user_id,s.remark FROM sr_rss_subscription s JOIN sr_rss_feed f ON f.id=s.feed_id WHERE s.id=${id} AND s.user_id=${userId}`
    if (!row) throw new RssError('not_found', 404)
    return row
  }
  async subscriptions(userId: number): Promise<RssSubscriptionRow[]> {
    return this.prismaPg()
      .$queryRaw`SELECT f.*,s.id,s.feed_id,s.user_id,s.remark FROM sr_rss_subscription s JOIN sr_rss_feed f ON f.id=s.feed_id WHERE s.user_id=${userId} AND EXISTS(SELECT 1 FROM sr_user u WHERE u.id=s.user_id AND u.deleted_at IS NULL) ORDER BY s.created_at,s.id`
  }
  private async quota(tx: Tx, userId: number) {
    const [row] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM sr_rss_subscription WHERE user_id=${userId}`
    if (Number(row.count) >= RSS_LIMITS.subscriptions) throw new RssError('limit_reached', 409)
  }
  private async attach(tx: Tx, userId: number, feedId: string, remark: string | null) {
    await this.quota(tx, userId)
    const [sub] = await tx.$queryRaw<
      { id: string }[]
    >`INSERT INTO sr_rss_subscription(user_id,feed_id,remark) VALUES(${userId},${feedId},${remark}) ON CONFLICT(user_id,feed_id) DO UPDATE SET feed_id=EXCLUDED.feed_id RETURNING id`
    return this.subscription(tx, userId, sub.id)
  }
  /** Reuse successful feeds and check quota without persisting an unvalidated URL. */
  async reuseForAdd(userId: number, url: string, remark: string | null): Promise<RssSubscriptionRow | null> {
    return this.prismaPg().$transaction(async tx => {
      await this.active(tx, userId)
      const [existing] = await tx.$queryRaw<
        { id: string }[]
      >`SELECT s.id FROM sr_rss_subscription s JOIN sr_rss_feed f ON f.id=s.feed_id WHERE s.user_id=${userId} AND f.feed_url=${url}`
      if (existing) return this.subscription(tx, userId, existing.id)
      await this.quota(tx, userId)
      const [feed] = await tx.$queryRaw<RssFeedRow[]>`SELECT * FROM sr_rss_feed WHERE feed_url=${url} FOR UPDATE`
      if (feed?.last_success_at) return this.attach(tx, userId, feed.id, remark)
      if (feed?.lease_until && feed.lease_until > new Date()) throw new RssError('refresh_limited', 429, feed.lease_until)
      return null
    })
  }
  /** Reserve a validated shared URL before publishing its R2 content and entries. */
  async beginAdd(userId: number, url: string, remark: string | null): Promise<{ subscription?: RssSubscriptionRow; feed?: RssFeedRow }> {
    return this.prismaPg().$transaction(async tx => {
      await this.active(tx, userId)
      const [existing] = await tx.$queryRaw<
        { id: string }[]
      >`SELECT s.id FROM sr_rss_subscription s JOIN sr_rss_feed f ON f.id=s.feed_id WHERE s.user_id=${userId} AND f.feed_url=${url}`
      if (existing) return { subscription: await this.subscription(tx, userId, existing.id) }
      await this.quota(tx, userId)
      await tx.$executeRaw`INSERT INTO sr_rss_feed(feed_url) VALUES(${url}) ON CONFLICT(feed_url) DO UPDATE SET feed_url=EXCLUDED.feed_url`
      const [feed] = await tx.$queryRaw<RssFeedRow[]>`SELECT * FROM sr_rss_feed WHERE feed_url=${url} FOR UPDATE`
      if (feed.last_success_at) return { subscription: await this.attach(tx, userId, feed.id, remark) }
      const now = new Date()
      if (feed.lease_until && feed.lease_until > now) throw new RssError('refresh_limited', 429, feed.lease_until)
      if (feed.next_allowed_at > now) throw new RssError('refresh_limited', 429, feed.next_allowed_at)
      return { feed: await this.lease(tx, feed.id) }
    })
  }
  async finishAdd(userId: number, row: RssFeedRow, result: Exclude<StoredFeedResult, { unchanged: true }>, remark: string | null) {
    return this.prismaPg().$transaction(
      async tx => {
        await this.active(tx, userId)
        if (!(await this.lockLease(tx, row))) throw new RssError('source_unavailable', 503)
        await this.writeFeed(tx, row.id, result)
        return this.attach(tx, userId, row.id, remark)
      },
      { timeout: 30_000 }
    )
  }
  async updateRemark(userId: number, id: string, remark: string | null) {
    return this.prismaPg().$transaction(async tx => {
      await this.active(tx, userId)
      await tx.$executeRaw`UPDATE sr_rss_subscription SET remark=${remark} WHERE id=${id} AND user_id=${userId}`
      return this.subscription(tx, userId, id)
    })
  }
  async remove(userId: number, id: string) {
    await this.prismaPg().$transaction(async tx => {
      await this.active(tx, userId)
      const [feed] = await tx.$queryRaw<
        RssFeedRow[]
      >`SELECT f.* FROM sr_rss_feed f JOIN sr_rss_subscription s ON s.feed_id=f.id WHERE s.id=${id} AND s.user_id=${userId} FOR UPDATE OF f`
      if (!feed) return
      await tx.$executeRaw`DELETE FROM sr_rss_subscription WHERE id=${id} AND user_id=${userId}`
      await tx.$executeRaw`UPDATE sr_rss_feed f SET lease_token=NULL,lease_until=NULL WHERE f.id=${feed.id} AND NOT EXISTS (SELECT 1 FROM sr_rss_subscription s JOIN sr_user u ON u.id=s.user_id AND u.deleted_at IS NULL JOIN sr_user_lab_feature l ON l.user_id=s.user_id AND l.feature='rss' AND l.enabled WHERE s.feed_id=f.id)`
    })
  }
  private async lease(tx: Tx, id: string, history = false) {
    const token = crypto.randomUUID(),
      until = new Date(Date.now() + 90_000),
      next = new Date(Date.now() + RSS_LIMITS.cooldownMs)
    const [row] = await tx.$queryRaw<
      RssFeedRow[]
    >`UPDATE sr_rss_feed SET lease_token=${token},lease_until=${until},next_allowed_at=CASE WHEN ${history} THEN next_allowed_at ELSE ${next} END WHERE id=${id} RETURNING *`
    return { ...row, claimed: true }
  }
  async claim(userId: number, id: string): Promise<RssFeedRow> {
    return this.prismaPg().$transaction(async tx => {
      await this.active(tx, userId)
      const [row] = await tx.$queryRaw<
        RssFeedRow[]
      >`SELECT f.* FROM sr_rss_feed f JOIN sr_rss_subscription s ON s.feed_id=f.id WHERE s.user_id=${userId} AND s.id=${id} FOR UPDATE OF f`
      if (!row) throw new RssError('not_found', 404)
      const now = new Date()
      if (row.lease_token && row.lease_until && row.lease_until > now) return { ...row, claimed: false }
      if (row.next_allowed_at > now) throw new RssError('refresh_limited', 429, row.next_allowed_at)
      return this.lease(tx, row.id)
    })
  }
  async hasActiveSubscribers(id: string, tx: Tx = this.prismaPg()): Promise<boolean> {
    const [row] = await tx.$queryRaw<
      { active: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM sr_rss_subscription s JOIN sr_user u ON u.id=s.user_id AND u.deleted_at IS NULL JOIN sr_user_lab_feature l ON l.user_id=s.user_id AND l.feature='rss' AND l.enabled WHERE s.feed_id=${id}) AS active`
    return row.active
  }
  async historyFeeds(userId: number, subscription: string | null): Promise<RssFeedRow[]> {
    return this.prismaPg().$queryRaw`SELECT f.* FROM sr_rss_feed f JOIN sr_rss_subscription s ON s.feed_id=f.id
      WHERE s.user_id=${userId} AND (${subscription}::text IS NULL OR s.id=${subscription})
        AND EXISTS(SELECT 1 FROM sr_user u WHERE u.id=s.user_id AND u.deleted_at IS NULL)
      ORDER BY f.history_checked_at ASC NULLS FIRST,f.id`
  }
  async claimHistory(userId: number, feedId: string): Promise<RssFeedRow | null> {
    return this.prismaPg().$transaction(async tx => {
      await this.active(tx, userId)
      const [row] = await tx.$queryRaw<RssFeedRow[]>`SELECT f.* FROM sr_rss_feed f JOIN sr_rss_subscription s ON s.feed_id=f.id
        WHERE s.user_id=${userId} AND f.id=${feedId} FOR UPDATE OF f`
      if (!row) throw new RssError('not_found', 404)
      const now = new Date()
      if (row.history_checked_at && !row.history_url) return null
      if ((row.lease_until && row.lease_until > now) || (row.history_retry_at && row.history_retry_at > now) || (row.error && row.next_allowed_at > now)) return null
      return this.lease(tx, row.id, true)
    })
  }
  async finishHistory(row: RssFeedRow, url: string, result: StoredFeedResult | RssError): Promise<boolean> {
    return this.prismaPg().$transaction(
      async tx => {
        if (!(await this.lockLease(tx, row))) return false
        if (!(await this.hasActiveSubscribers(row.id, tx))) {
          await tx.$executeRaw`UPDATE sr_rss_feed SET lease_token=NULL,lease_until=NULL WHERE id=${row.id}`
          return false
        }
        if (result instanceof RssError || result.unchanged) {
          const retry = new Date(Math.max(Date.now() + 60_000, result instanceof RssError ? result.nextAllowedAt?.valueOf() || 0 : 0))
          await tx.$executeRaw`UPDATE sr_rss_feed SET history_retry_at=${retry},lease_token=NULL,lease_until=NULL WHERE id=${row.id}`
          return false
        }
        const [oldest] = await tx.$queryRaw<{ at: Date | null }[]>`SELECT min(sort_at) AS at FROM sr_rss_entry WHERE feed_id=${row.id}`
        // Unknown dates in an archive belong behind the previously known entries.
        await this.writeItems(tx, row.id, result.feed.items, row.history_checked_at && oldest.at ? new Date(oldest.at.valueOf() - 1) : undefined, true)
        const seen = [...new Set([...(row.history_seen || []), await hashSHA256(url)])]
        const nextUrl = result.feed.next_url || null
        const next = nextUrl && seen.length < RSS_LIMITS.historyPages && !seen.includes(await hashSHA256(nextUrl)) ? nextUrl : null
        await tx.$executeRaw`UPDATE sr_rss_feed SET history_url=${next},history_seen=${seen}::text[],history_checked_at=${new Date()},history_retry_at=NULL,lease_token=NULL,lease_until=NULL WHERE id=${row.id}`
        return true
      },
      { timeout: 30_000 }
    )
  }
  async claimDue(): Promise<RssFeedRow[]> {
    const now = new Date(),
      until = new Date(now.valueOf() + 90_000),
      next = new Date(now.valueOf() + RSS_LIMITS.cooldownMs)
    return this.prismaPg().$queryRaw`UPDATE sr_rss_feed SET lease_token=gen_random_uuid()::text,lease_until=${until},next_allowed_at=${next}
      WHERE id IN (SELECT f.id FROM sr_rss_feed f WHERE f.next_fetch_at<=${now} AND f.next_allowed_at<=${now} AND (f.lease_until IS NULL OR f.lease_until<=${now})
        AND EXISTS (SELECT 1 FROM sr_rss_subscription s JOIN sr_user u ON u.id=s.user_id AND u.deleted_at IS NULL JOIN sr_user_lab_feature l ON l.user_id=s.user_id AND l.feature='rss' AND l.enabled WHERE s.feed_id=f.id)
        ORDER BY f.next_fetch_at LIMIT 10 FOR UPDATE OF f SKIP LOCKED) RETURNING *`
  }
  private async lockLease(tx: Tx, row: RssFeedRow) {
    const locked = await tx.$queryRaw`SELECT id FROM sr_rss_feed WHERE id=${row.id} AND lease_token=${row.lease_token} AND lease_until>${new Date()} FOR UPDATE`
    return (locked as unknown[]).length > 0
  }
  async failAdd(row: RssFeedRow, error: RssError) {
    await this.prismaPg().$transaction(async tx => {
      // A failed initial write can outlive its lease. Clean it only if no new owner took over.
      const owned = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sr_rss_feed WHERE id=${row.id} AND lease_token=${row.lease_token} FOR UPDATE`
      if (!owned.length) return
      const deleted = await tx.$queryRaw<{ id: string }[]>`DELETE FROM sr_rss_feed f WHERE f.id=${row.id}
        AND f.last_success_at IS NULL AND NOT EXISTS(SELECT 1 FROM sr_rss_subscription s WHERE s.feed_id=f.id)
        AND NOT EXISTS(SELECT 1 FROM sr_rss_entry e WHERE e.feed_id=f.id) RETURNING id`
      if (deleted.length) return
      if (['lab_disabled', 'not_found', 'limit_reached'].includes(error.code)) {
        // A caller losing access or quota is not a failure of the shared source.
        await tx.$executeRaw`UPDATE sr_rss_feed SET lease_token=NULL,lease_until=NULL,next_allowed_at=${new Date()} WHERE id=${row.id}`
      } else await this.writeFailure(tx, row, error)
    })
  }
  private async writeFailure(tx: Tx, row: RssFeedRow, error: RssError) {
    const now = new Date(),
      backoff = Math.min(24 * 3600_000, RSS_LIMITS.intervalMs * 2 ** Math.min(row.failure_count, 6))
    const next = new Date(Math.max(now.valueOf() + backoff, error.nextAllowedAt?.valueOf() || 0))
    await tx.$executeRaw`UPDATE sr_rss_feed SET error=${error.code},failure_count=failure_count+1,last_checked_at=${now},next_fetch_at=${next},next_allowed_at=${next},lease_token=NULL,lease_until=NULL WHERE id=${row.id}`
  }
  async finish(row: RssFeedRow, result: StoredFeedResult | RssError): Promise<boolean> {
    return this.prismaPg().$transaction(
      async tx => {
        if (!(await this.lockLease(tx, row))) return false
        if (!(await this.hasActiveSubscribers(row.id, tx))) {
          await tx.$executeRaw`UPDATE sr_rss_feed SET lease_token=NULL,lease_until=NULL WHERE id=${row.id}`
          return false
        }
        if (result instanceof RssError) await this.writeFailure(tx, row, result)
        else await this.writeFeed(tx, row.id, result)
        return true
      },
      { timeout: 30_000 }
    )
  }
  private async writeItems(tx: Tx, id: string, items: StoredFeedItem[], undated?: Date, history = false) {
    const now = new Date()
    for (const item of items) {
      await tx.$executeRaw`INSERT INTO sr_rss_entry(feed_id,entry_key,article_url,title,author,summary,content_key,content_truncated,image_url,published_at,first_seen_at,sort_at)
        VALUES(${id},${item.entry_key},${item.article_url},${item.title},${item.author},${item.summary},${item.content_key},${item.content_truncated},${item.image_url},${item.published_at},${now},${item.published_at || undated || now})
        ON CONFLICT(feed_id,entry_key) DO UPDATE SET article_url=EXCLUDED.article_url,title=EXCLUDED.title,author=EXCLUDED.author,summary=EXCLUDED.summary,content_key=EXCLUDED.content_key,content_truncated=EXCLUDED.content_truncated,image_url=EXCLUDED.image_url,published_at=EXCLUDED.published_at,sort_at=COALESCE(EXCLUDED.published_at,sr_rss_entry.sort_at),updated_at=${now} WHERE NOT ${history}`
    }
  }
  private async writeFeed(tx: Tx, id: string, result: StoredFeedResult) {
    const now = new Date(),
      next = new Date(now.valueOf() + RSS_LIMITS.intervalMs)
    if (!result.unchanged) {
      await this.writeItems(tx, id, result.feed.items)
      await tx.$executeRaw`UPDATE sr_rss_feed SET title=${result.feed.title},site_url=${result.feed.site_url},etag=${result.etag},last_modified=${result.lastModified} WHERE id=${id}`
      const [feed] = await tx.$queryRaw<RssFeedRow[]>`SELECT * FROM sr_rss_feed WHERE id=${id}`
      if (!feed.history_checked_at || (!feed.history_url && feed.history_seen.length <= 1)) {
        const seen = [await hashSHA256(feed.feed_url)]
        const candidate = result.feed.next_url || null
        const nextUrl = candidate && !seen.includes(await hashSHA256(candidate)) ? candidate : null
        await tx.$executeRaw`UPDATE sr_rss_feed SET history_url=${nextUrl},history_seen=${seen}::text[],history_checked_at=${now},history_retry_at=NULL WHERE id=${id}`
      }
    }
    await tx.$executeRaw`UPDATE sr_rss_feed SET error=NULL,failure_count=0,last_checked_at=${now},last_success_at=${now},next_fetch_at=${next},lease_token=NULL,lease_until=NULL WHERE id=${id}`
  }
  async prune() {
    const before = new Date(Date.now() - RSS_LIMITS.retentionDays * 24 * 3600_000),
      orphanBefore = new Date(Date.now() - 3600_000)
    await this.prismaPg().$transaction(async tx => {
      // Lock orphan feeds to serialize cleanup against adding a new subscriber.
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT f.id FROM sr_rss_feed f WHERE f.created_at<${orphanBefore} AND NOT EXISTS(SELECT 1 FROM sr_rss_subscription s WHERE s.feed_id=f.id) AND (f.lease_until IS NULL OR f.lease_until<${new Date()}) LIMIT 100 FOR UPDATE OF f SKIP LOCKED`
      for (const row of rows) {
        // Recheck after locking: an attach might have committed while the SELECT waited.
        await tx.$executeRaw`DELETE FROM sr_rss_entry WHERE feed_id=${row.id} AND NOT EXISTS(SELECT 1 FROM sr_rss_subscription WHERE feed_id=${row.id})`
        await tx.$executeRaw`DELETE FROM sr_rss_feed WHERE id=${row.id} AND NOT EXISTS(SELECT 1 FROM sr_rss_subscription WHERE feed_id=${row.id})`
      }
      await tx.$executeRaw`UPDATE sr_rss_feed SET history_url=NULL,history_seen=ARRAY[]::text[],history_checked_at=NULL,history_retry_at=NULL
        WHERE (history_checked_at<${before} OR id IN (SELECT feed_id FROM sr_rss_entry WHERE first_seen_at<${before}))
          AND (lease_until IS NULL OR lease_until<=${new Date()})`
      await tx.$executeRaw`DELETE FROM sr_rss_entry e USING sr_rss_feed f WHERE f.id=e.feed_id AND e.first_seen_at<${before}
        AND (f.lease_until IS NULL OR f.lease_until<=${new Date()})`
      await tx.$executeRaw`DELETE FROM sr_rss_save_job j WHERE NOT EXISTS(SELECT 1 FROM sr_bookmark b JOIN sr_user u ON u.id=j.user_id AND u.deleted_at IS NULL WHERE b.id=j.bookmark_id)`
    })
  }
  async entries(userId: number, subscription: string | null, cursor: RssCursor | null, limit: number): Promise<RssEntryRow[]> {
    return this.prismaPg().$queryRaw`SELECT e.*,s.id AS subscription_id,COALESCE(NULLIF(s.remark,''),f.title) AS source_title,ub.uuid AS bookmark_user_uuid
      FROM sr_rss_entry e JOIN sr_rss_feed f ON f.id=e.feed_id JOIN sr_rss_subscription s ON s.feed_id=e.feed_id
      LEFT JOIN sr_bookmark b ON b.target_url=e.article_url AND b.private_user=${userId}
      LEFT JOIN sr_user_bookmark ub ON ub.bookmark_id=b.id AND ub.user_id=${userId} AND ub.deleted_at IS NULL
      WHERE s.user_id=${userId} AND EXISTS(SELECT 1 FROM sr_user u WHERE u.id=s.user_id AND u.deleted_at IS NULL) AND (${subscription}::text IS NULL OR s.id=${subscription})
        AND (${cursor?.at || null}::timestamp IS NULL OR (e.sort_at,e.id)<(${cursor?.at || null}::timestamp,${cursor?.id || ''}::text))
      ORDER BY e.sort_at DESC,e.id DESC LIMIT ${limit}`
  }
  async entry(userId: number, id: string): Promise<RssEntryRow> {
    const [row] = await this.prismaPg().$queryRaw<
      RssEntryRow[]
    >`SELECT e.*,s.id AS subscription_id,COALESCE(NULLIF(s.remark,''),f.title) AS source_title,ub.uuid AS bookmark_user_uuid
      FROM sr_rss_entry e JOIN sr_rss_feed f ON f.id=e.feed_id JOIN sr_rss_subscription s ON s.feed_id=e.feed_id
      LEFT JOIN sr_bookmark b ON b.target_url=e.article_url AND b.private_user=${userId}
      LEFT JOIN sr_user_bookmark ub ON ub.bookmark_id=b.id AND ub.user_id=${userId} AND ub.deleted_at IS NULL WHERE s.user_id=${userId} AND EXISTS(SELECT 1 FROM sr_user u WHERE u.id=s.user_id AND u.deleted_at IS NULL) AND e.id=${id}`
    if (!row) throw new RssError('not_found', 404)
    return row
  }
  async contentKeys(feedId: string): Promise<Map<string, string>> {
    const rows = await this.prismaPg().$queryRaw<{ entry_key: string; content_key: string }[]>`SELECT entry_key,content_key FROM sr_rss_entry WHERE feed_id=${feedId}`
    return new Map(rows.map(row => [row.entry_key, row.content_key]))
  }
  async referencedContent(keys: string[]): Promise<string[]> {
    if (!keys.length) return []
    // An active lease may still be reusing the previous revision while retention
    // removes an old entry. Keep its objects until the lease has finished.
    const rows = await this.prismaPg().$queryRaw<
      { key: string }[]
    >`SELECT key FROM unnest(${keys}::text[]) AS key WHERE EXISTS(SELECT 1 FROM sr_rss_entry e WHERE e.content_key=key) OR EXISTS(SELECT 1 FROM sr_rss_feed f WHERE f.id=split_part(key,'/',2) AND f.lease_until>${new Date()})`
    return rows.map(row => row.key)
  }
  async save(userId: number, id: string, targetUrl: string): Promise<RssSaveResponse> {
    return this.prismaPg().$transaction(async tx => {
      await this.active(tx, userId)
      const [entry] = await tx.$queryRaw<RssEntryRow[]>`SELECT e.* FROM sr_rss_entry e JOIN sr_rss_subscription s ON s.feed_id=e.feed_id
        WHERE e.id=${id} AND s.user_id=${userId} AND e.article_url=${targetUrl} FOR SHARE OF e,s`
      if (!entry) throw new RssError('not_found', 404)
      const now = new Date()
      const bookmark = await tx.sr_bookmark.upsert({
        where: { target_url_private_user: { target_url: targetUrl, private_user: userId } },
        update: {},
        create: {
          target_url: targetUrl,
          host_url: new URL(targetUrl).host,
          private_user: userId,
          title: entry.title,
          description: entry.summary,
          created_at: now,
          updated_at: now,
          published_at: entry.published_at || now,
          status: 'pending'
        }
      })
      let relation = await tx.sr_user_bookmark.findUnique({ where: { user_id_bookmark_id: { user_id: userId, bookmark_id: bookmark.id } } })
      let result: RssSaveResponse['result'] = 'already_saved'
      if (!relation) {
        result = 'created'
        relation = await tx.sr_user_bookmark.create({ data: { user_id: userId, bookmark_id: bookmark.id, updated_at: now } })
      } else if (relation.deleted_at) {
        result = 'restored'
        await tx.sr_user_delete_bookmark.deleteMany({ where: { user_id: userId, bookmark_id: bookmark.id } })
        relation = await tx.sr_user_bookmark.update({ where: { id: relation.id }, data: { deleted_at: null, archive_status: 0, archived_at: null, updated_at: now } })
      }
      if (result !== 'already_saved') {
        await tx.$executeRaw`INSERT INTO sr_rss_save_job(bookmark_id,user_id) VALUES(${bookmark.id},${userId}) ON CONFLICT DO NOTHING`
      }
      return { bookmark_user_uuid: relation.uuid, result, processing_status: bookmark.status === 'success' ? 'ready' : bookmark.status === 'failed' ? 'failed' : 'pending' }
    })
  }
  async saveJobs(userId?: number): Promise<RssSaveJob[]> {
    return this.prismaPg().$queryRaw`SELECT j.bookmark_id,j.user_id,b.target_url,u.lang,b.status FROM sr_rss_save_job j
      JOIN sr_user u ON u.id=j.user_id AND u.deleted_at IS NULL JOIN sr_bookmark b ON b.id=j.bookmark_id
      JOIN sr_user_bookmark ub ON ub.bookmark_id=b.id AND ub.user_id=j.user_id AND ub.deleted_at IS NULL
      WHERE (${userId || null}::integer IS NULL OR j.user_id=${userId || null}) ORDER BY j.created_at LIMIT 100`
  }
  async ackSave(bookmarkId: number) {
    await this.prismaPg().$executeRaw`DELETE FROM sr_rss_save_job WHERE bookmark_id=${bookmarkId}`
  }
}
