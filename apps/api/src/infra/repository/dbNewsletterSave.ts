import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import type { Prisma, PrismaClient } from '@prisma/hyperdrive-client'
import type { NewsletterMail } from './dbNewsletter'
import { NewsletterError } from '@/domain/newsletter/parser'
export interface NewsletterDestination {
  uuid: string
  content_key: string
  content_md_key: string
  content_word_count: number
}
export interface NewsletterSaved {
  uuid: string
  bookmark_id: number
  content_key: string
  content_md_key: string
  title: string
  target_url: string
  status: string
  deleted_at: Date | null
}
export const newsletterBookmarkTarget = (id: bigint) => `slax-newsletter://message/${id}`
@injectable()
export class NewsletterSaveRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private pg: LazyInstance<PrismaClient>) {}
  async source(userId: number, id: bigint): Promise<NewsletterMail> {
    const [row] = await this.pg().$queryRaw<
      NewsletterMail[]
    >`SELECT n.* FROM sr_newsletter_feed n JOIN sr_user u ON u.id=n.user_id AND u.deleted_at IS NULL JOIN sr_user_lab_feature l ON l.user_id=n.user_id AND l.feature='newsletter' AND l.enabled WHERE n.id=${id} AND n.user_id=${userId} AND n.state='ready'`
    if (!row) throw new NewsletterError('not_found', 404)
    return row
  }
  async existing(userId: number, id: bigint, db: Prisma.TransactionClient = this.pg()): Promise<NewsletterSaved | null> {
    const [row] = await db.$queryRaw<
      NewsletterSaved[]
    >`SELECT ub.uuid,b.id AS bookmark_id,b.content_key,b.content_md_key,b.title,b.target_url,b.status,ub.deleted_at FROM sr_bookmark b JOIN sr_user_bookmark ub ON ub.bookmark_id=b.id AND ub.user_id=${userId} WHERE b.private_user=${userId} AND b.target_url=${newsletterBookmarkTarget(id)} FOR UPDATE OF b,ub`
    return row || null
  }
  async publish(userId: number, id: bigint, expectedKey: string, destination?: NewsletterDestination, expectedExisting?: NewsletterSaved) {
    return this.pg().$transaction(async tx => {
      const users = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM sr_user WHERE id=${userId} AND deleted_at IS NULL FOR UPDATE`
      if (!users.length) throw new NewsletterError('not_found', 404)
      const [source] = await tx.$queryRaw<
        NewsletterMail[]
      >`SELECT n.* FROM sr_newsletter_feed n JOIN sr_user_lab_feature l ON l.user_id=n.user_id AND l.feature='newsletter' AND l.enabled WHERE n.id=${id} AND n.user_id=${userId} AND n.state='ready' AND n.content_key=${expectedKey} FOR UPDATE OF n`
      if (!source) throw new NewsletterError('not_found', 404)
      let existing = await this.existing(userId, id, tx)
      if (existing) {
        if (
          existing.status !== 'success' ||
          !existing.content_key ||
          !existing.content_md_key ||
          (expectedExisting && (existing.content_key !== expectedExisting.content_key || existing.content_md_key !== expectedExisting.content_md_key))
        )
          throw new NewsletterError('unavailable', 503)
        const result = existing.deleted_at ? ('restored' as const) : ('already_saved' as const)
        if (existing.deleted_at) {
          await tx.$executeRaw`DELETE FROM sr_user_delete_bookmark WHERE user_id=${userId} AND bookmark_id=${existing.bookmark_id}`
          await tx.$executeRaw`UPDATE sr_user_bookmark_tag SET is_deleted=false WHERE user_id=${userId} AND bookmark_id=${existing.bookmark_id} AND is_deleted=true`
          await tx.$executeRaw`UPDATE sr_user_bookmark SET deleted_at=NULL,archive_status=0,archived_at=NULL,updated_at=${new Date()} WHERE uuid=${existing.uuid} AND user_id=${userId}`
          existing = { ...existing, deleted_at: null }
        }
        return { relation: existing, result }
      }
      if (!destination) throw new NewsletterError('unavailable', 503)
      const now = new Date()
      const [bookmark] = await tx.$queryRaw<
        { id: number }[]
      >`INSERT INTO sr_bookmark(target_url,private_user,title,description,site_name,byline,content_key,content_md_key,content_word_count,status,created_at,updated_at,published_at) VALUES(${newsletterBookmarkTarget(id)},${userId},${source.title},${source.summary},${source.sender_name || source.sender},${source.sender},${destination.content_key},${destination.content_md_key},${destination.content_word_count},'success',${now},${now},${source.published_at || source.received_at}) RETURNING id`
      await tx.$executeRaw`INSERT INTO sr_user_bookmark(uuid,user_id,bookmark_id,type,updated_at) VALUES(${destination.uuid},${userId},${bookmark.id},0,${now})`
      const relation = await this.existing(userId, id, tx)
      if (!relation) throw new NewsletterError('unavailable', 503)
      return { relation, result: 'created' as const }
    })
  }
}
