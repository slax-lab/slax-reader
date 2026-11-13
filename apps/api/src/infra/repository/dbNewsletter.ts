import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import type { Prisma, PrismaClient } from '@prisma/hyperdrive-client'
import { isNewsletterAccount, type NewsletterAddressResponse } from '@slax-reader/contracts'
import { NEWSLETTER_LIMITS, NEWSLETTER_LOCAL_PREFIX, NewsletterError, newsletterLocalPart } from '@/utils/newsletter'

type Tx = Prisma.TransactionClient
export interface NewsletterRecipient {
  id: number
  user_id: number
  uuid: string
}
export interface NewsletterMail {
  id: bigint
  user_id: number
  source_key: string
  sender: string
  sender_name: string
  message_key: string
  state: 'pending' | 'ready' | 'cancelled'
  title: string
  excerpt: string
  content_key: string | null
  content_truncated: boolean
  published_at: Date | null
  received_at: Date
}
export type NewsletterAddressStatus = NewsletterAddressResponse
export interface NewsletterPublication {
  senderName: string
  title: string
  excerpt: string
  publishedAt: Date | null
  contentKey: string
  truncated: boolean
  startedAt: number
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
  async address(userId: number, domain: string, provision: boolean, confirmedAddress?: string): Promise<NewsletterAddressStatus> {
    return this.pg().$transaction(async tx => {
      const user = await this.active(tx, userId)
      const [existing] = await tx.$queryRaw<{ platform_id: string }[]>`
        SELECT platform_id FROM sr_platform_bind WHERE user_id=${userId} AND platform='newsletter'`
      if (existing) {
        const address = existing.platform_id
        if (provision && confirmedAddress !== undefined && confirmedAddress !== address) throw new NewsletterError('address_changed', 409)
        const at = address.lastIndexOf('@')
        if (address.slice(at + 1) !== domain) throw new NewsletterError('unavailable', 503)
        const part = address.startsWith(NEWSLETTER_LOCAL_PREFIX) ? newsletterLocalPart(address.slice(NEWSLETTER_LOCAL_PREFIX.length, at)) : null
        if (!part) throw new NewsletterError('invalid_account')
        return { address, domain, status: 'ready' }
      }
      const part = isNewsletterAccount(user.account) ? user.account : null
      const status = !user.account ? 'account_required' : !part ? 'invalid_account' : 'not_provisioned'
      if (!part) {
        if (provision) throw new NewsletterError(status === 'account_required' ? 'account_required' : 'invalid_account')
        return { address: null, domain, status }
      }
      const address = NEWSLETTER_LOCAL_PREFIX + part + '@' + domain
      if (provision && confirmedAddress !== undefined && confirmedAddress !== address) throw new NewsletterError('address_changed', 409)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${address},0))`
      const reserved = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM sr_platform_bind WHERE platform='newsletter' AND platform_id=${address}`
      if (reserved.length) {
        if (provision) throw new NewsletterError('address_reserved', 409)
        return { address: null, domain, status: 'address_reserved' }
      }
      if (!provision) return { address: null, domain, status }
      // Dedicated first binding: generic platform upsert must never replace an issued mailbox.
      await tx.$executeRaw`INSERT INTO sr_platform_bind(user_id,platform,platform_id,user_name) VALUES(${userId},'newsletter',${address},${address})`
      return { address, domain, status: 'ready' }
    })
  }
  async recipient(domain: string, part: string): Promise<NewsletterRecipient | null> {
    const address = NEWSLETTER_LOCAL_PREFIX + part + '@' + domain
    const [row] = await this.pg().$queryRaw<NewsletterRecipient[]>`SELECT a.id,a.user_id,u.uuid FROM sr_platform_bind a
      JOIN sr_user u ON u.id=a.user_id AND u.deleted_at IS NULL
      JOIN sr_user_lab_feature l ON l.user_id=u.id AND l.feature='newsletter' AND l.enabled
      WHERE a.platform='newsletter' AND a.platform_id=${address}`
    return row || null
  }

  private async binding(tx: Tx, userId: number, bindingId: number) {
    await this.active(tx, userId)
    const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM sr_platform_bind WHERE id=${bindingId} AND user_id=${userId} AND platform='newsletter'`
    if (!rows.length) throw new NewsletterError('not_found', 404)
  }
  async admit(recipient: NewsletterRecipient, source: string, message: string, sender: string): Promise<{ created: boolean; mail: NewsletterMail }> {
    return this.pg().$transaction(async tx => {
      await this.binding(tx, recipient.user_id, recipient.id)
      const [existing] = await tx.$queryRaw<
        NewsletterMail[]
      >`SELECT * FROM sr_newsletter_feed WHERE user_id=${recipient.user_id} AND source_key=${source} AND message_key=${message}`
      if (existing) return { created: false, mail: existing }
      const day = new Date()
      day.setUTCHours(0, 0, 0, 0)
      const [daily] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM sr_newsletter_feed WHERE user_id=${recipient.user_id} AND received_at>=${day}`
      if (Number(daily.count) >= NEWSLETTER_LIMITS.daily) throw new NewsletterError('limit_reached', 429)
      const [sources] = await tx.$queryRaw<
        { count: bigint; present: boolean }[]
      >`SELECT count(*),bool_or(source_key=${source}) AS present FROM (SELECT DISTINCT source_key FROM sr_newsletter_feed WHERE user_id=${recipient.user_id} AND state IN ('pending','ready')) s`
      if (!sources.present && Number(sources.count) >= NEWSLETTER_LIMITS.sources) throw new NewsletterError('limit_reached', 429)
      const [mail] = await tx.$queryRaw<
        NewsletterMail[]
      >`INSERT INTO sr_newsletter_feed(user_id,source_key,message_key,sender) VALUES(${recipient.user_id},${source},${message},${sender}) RETURNING *`
      return { created: true, mail }
    })
  }
  async publish(id: bigint, userId: number, bindingId: number, item: NewsletterPublication): Promise<{ mail: NewsletterMail; published: boolean }> {
    if (!/^newsletter-content\/[^\s]+$/.test(item.contentKey) || item.contentKey.split('/').some(part => part === '.' || part === '..'))
      throw new NewsletterError('unavailable', 503)
    if (!Number.isFinite(item.startedAt) || Date.now() - item.startedAt >= 5 * 60_000) throw new NewsletterError('unavailable', 503)
    return this.pg().$transaction(async tx => {
      await this.binding(tx, userId, bindingId)
      const [row] = await tx.$queryRaw<NewsletterMail[]>`SELECT * FROM sr_newsletter_feed WHERE id=${id} AND user_id=${userId} FOR UPDATE`
      if (!row) throw new NewsletterError('not_found', 404)
      if (row.state !== 'pending') return { mail: row, published: false }
      if (Date.now() - item.startedAt >= 5 * 60_000) throw new NewsletterError('unavailable', 503)
      const [mail] = await tx.$queryRaw<
        NewsletterMail[]
      >`UPDATE sr_newsletter_feed SET state='ready',sender_name=${item.senderName},title=${item.title},excerpt=${item.excerpt},published_at=${item.publishedAt},content_key=${item.contentKey},content_truncated=${item.truncated} WHERE id=${id} AND user_id=${userId} RETURNING *`
      return { mail, published: true }
    })
  }
}
