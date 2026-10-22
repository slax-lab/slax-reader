import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import type { Prisma, PrismaClient } from '@prisma/hyperdrive-client'
import type { NewsletterAddressResponse } from '@slax-reader/contracts'
import { NEWSLETTER_LIMITS, NewsletterError, newsletterLocalPart } from '@/domain/newsletter/parser'

type Tx = Prisma.TransactionClient
export interface NewsletterRecipient {
  id: string
  user_id: number
  uuid: string
}
export interface NewsletterReceipt {
  id: string
  user_id: number
  address_id: string
  source_key: string
  message_key: string
  raw_key: string
  state: string
  lease_token: string | null
  attempts: number
}
export type NewsletterAddressStatus = NewsletterAddressResponse
export interface NewsletterPublication {
  sourceTitle: string
  title: string
  summary: string
  publishedAt: Date | null
  contentKey: string
  truncated: boolean
}

@injectable()
export class NewsletterRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private pg: LazyInstance<PrismaClient>) {}
  private async active(tx: Tx, userId: number) {
    const [user] = await tx.$queryRaw<{ id: number; uuid: string; account: string }[]>`SELECT id,uuid,account FROM sr_user WHERE id=${userId} AND deleted_at IS NULL FOR UPDATE`
    if (!user) throw new NewsletterError('not_found', 404)
    const [lab] = await tx.$queryRaw<{ enabled: boolean }[]>`SELECT enabled FROM sr_user_lab_feature WHERE user_id=${userId} AND feature='newsletter'`
    if (!lab?.enabled) throw new NewsletterError('lab_disabled', 403)
    return user
  }
  async address(userId: number, domain: string, provision: boolean): Promise<NewsletterAddressStatus> {
    return this.pg().$transaction(async tx => {
      const user = await this.active(tx, userId)
      const [existing] = await tx.$queryRaw<
        { local_part: string; retired_at: Date | null }[]
      >`SELECT local_part,retired_at FROM sr_newsletter_address WHERE user_id=${userId} AND domain=${domain}`
      if (existing && !existing.retired_at) return { address: existing.local_part + '@' + domain, domain, status: 'ready' }
      if (existing) throw new NewsletterError('not_found', 404)
      const part = newsletterLocalPart(user.account)
      const status = !user.account ? 'account_required' : !part ? 'invalid_account' : 'not_provisioned'
      if (!provision) return { address: null, domain, status }
      if (!part) throw new NewsletterError(status === 'account_required' ? 'account_required' : 'invalid_account')
      // Serialize same-name attempts while preserving old reservations, including deleted users.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${domain + ':' + part},0))`
      const [reserved] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sr_newsletter_address WHERE domain=${domain} AND local_part=${part}`
      if (reserved) throw new NewsletterError('address_reserved', 409)
      await tx.$executeRaw`INSERT INTO sr_newsletter_address(user_id,domain,local_part) VALUES(${userId},${domain},${part})`
      return { address: part + '@' + domain, domain, status: 'ready' }
    })
  }
  async recipient(domain: string, part: string): Promise<NewsletterRecipient | null> {
    const [row] = await this.pg().$queryRaw<NewsletterRecipient[]>`SELECT a.id,a.user_id,u.uuid FROM sr_newsletter_address a
      JOIN sr_user u ON u.id=a.user_id AND u.deleted_at IS NULL
      JOIN sr_user_lab_feature l ON l.user_id=u.id AND l.feature='newsletter' AND l.enabled
      WHERE a.domain=${domain} AND a.local_part=${part} AND a.retired_at IS NULL`
    return row || null
  }
  private async admission(tx: Tx, recipient: NewsletterRecipient, source: string, message: string): Promise<NewsletterReceipt | null> {
    await this.active(tx, recipient.user_id)
    const address = await tx.$queryRaw`SELECT id FROM sr_newsletter_address WHERE id=${recipient.id} AND user_id=${recipient.user_id} AND retired_at IS NULL`
    if (!(address as unknown[]).length) throw new NewsletterError('not_found', 404)
    const [existing] = await tx.$queryRaw<
      NewsletterReceipt[]
    >`SELECT * FROM sr_newsletter_receipt WHERE user_id=${recipient.user_id} AND source_key=${source} AND message_key=${message}`
    if (existing) return existing
    const day = new Date()
    day.setUTCHours(0, 0, 0, 0)
    const [daily] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM sr_newsletter_receipt WHERE user_id=${recipient.user_id} AND created_at>=${day}`
    if (Number(daily.count) >= NEWSLETTER_LIMITS.daily) throw new NewsletterError('limit_reached', 429)
    const [sources] = await tx.$queryRaw<{ count: bigint; present: boolean }[]>`SELECT count(*),bool_or(source_key=${source}) AS present FROM (
        SELECT substring(f.feed_url from 12) AS source_key FROM sr_rss_feed f JOIN sr_rss_subscription s ON s.feed_id=f.id WHERE s.user_id=${recipient.user_id} AND f.kind='newsletter'
        UNION SELECT source_key FROM sr_newsletter_receipt WHERE user_id=${recipient.user_id} AND state='pending'
      ) sources`
    if (!sources.present && Number(sources.count) >= NEWSLETTER_LIMITS.sources) throw new NewsletterError('limit_reached', 429)
    return null
  }
  async checkAdmission(recipient: NewsletterRecipient, source: string, message: string) {
    return this.pg().$transaction(tx => this.admission(tx, recipient, source, message))
  }
  async admit(recipient: NewsletterRecipient, source: string, message: string, rawKey: string) {
    return this.pg().$transaction(async tx => {
      const existing = await this.admission(tx, recipient, source, message)
      if (existing) return { created: false, receipt: existing }
      const [receipt] = await tx.$queryRaw<
        NewsletterReceipt[]
      >`INSERT INTO sr_newsletter_receipt(user_id,address_id,source_key,message_key,raw_key) VALUES(${recipient.user_id},${recipient.id},${source},${message},${rawKey}) RETURNING *`
      return { created: true, receipt }
    })
  }
  async claim(id: string | null = null): Promise<NewsletterReceipt[]> {
    const token = crypto.randomUUID(),
      now = new Date(),
      until = new Date(Date.now() + 90_000)
    return this.pg().$queryRaw`UPDATE sr_newsletter_receipt SET lease_token=${token},lease_until=${until},attempts=attempts+1
      WHERE id IN(SELECT id FROM sr_newsletter_receipt WHERE state='pending' AND retry_at<=${now} AND (lease_until IS NULL OR lease_until<=${now})
        AND (${id}::text IS NULL OR id=${id}) ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *`
  }
  async complete(receipt: NewsletterReceipt, item: NewsletterPublication): Promise<boolean> {
    return this.pg().$transaction(async tx => {
      await this.active(tx, receipt.user_id)
      const [row] = await tx.$queryRaw<NewsletterReceipt[]>`SELECT r.* FROM sr_newsletter_receipt r JOIN sr_newsletter_address a ON a.id=r.address_id AND a.retired_at IS NULL
        WHERE r.id=${receipt.id} AND r.user_id=${receipt.user_id} AND r.state='pending' AND r.lease_token=${receipt.lease_token} AND r.lease_until>${new Date()} FOR UPDATE OF r`
      if (!row) return false
      const now = new Date(),
        url = 'newsletter:' + row.source_key
      const [feed] = await tx.$queryRaw<
        { id: string }[]
      >`INSERT INTO sr_rss_feed(id,feed_url,title,kind,last_success_at) VALUES(${row.source_key},${url},${item.sourceTitle},'newsletter',${now})
        ON CONFLICT(feed_url) DO UPDATE SET title=EXCLUDED.title,last_success_at=EXCLUDED.last_success_at WHERE sr_rss_feed.kind='newsletter' RETURNING id`
      if (!feed) throw new NewsletterError('unavailable', 503)
      await tx.$executeRaw`INSERT INTO sr_rss_subscription(user_id,feed_id) VALUES(${receipt.user_id},${feed.id}) ON CONFLICT(user_id,feed_id) DO NOTHING`
      await tx.$executeRaw`INSERT INTO sr_rss_entry(feed_id,entry_key,title,author,summary,content_key,content_truncated,first_seen_at,sort_at,published_at)
        VALUES(${feed.id},${row.message_key},${item.title},${item.sourceTitle},${item.summary},${item.contentKey},${item.truncated},${now},${item.publishedAt || now},${item.publishedAt})
        ON CONFLICT(feed_id,entry_key) DO NOTHING`
      await tx.$executeRaw`UPDATE sr_newsletter_receipt SET state='done',lease_token=NULL,lease_until=NULL,completed_at=${now} WHERE id=${row.id}`
      return true
    })
  }
  async defer(receipt: NewsletterReceipt, cancel = false) {
    const retry = new Date(Date.now() + Math.min(3600_000, 60_000 * 2 ** Math.min(receipt.attempts, 6)))
    await this.pg().$executeRaw`UPDATE sr_newsletter_receipt SET state=${cancel ? 'cancelled' : 'pending'},retry_at=${retry},lease_token=NULL,lease_until=NULL,
      completed_at=${cancel ? new Date() : null} WHERE id=${receipt.id} AND state='pending' AND lease_token=${receipt.lease_token}`
  }
  async rawReferenced(keys: string[]): Promise<string[]> {
    if (!keys.length) return []
    const rows = await this.pg().$queryRaw<{ raw_key: string }[]>`SELECT raw_key FROM sr_newsletter_receipt WHERE state='pending' AND raw_key=ANY(${keys}::text[])`
    return rows.map(row => row.raw_key)
  }
}
