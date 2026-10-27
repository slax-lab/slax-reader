import { inject, injectable } from '@/decorators/di'
import { NewsletterRepo, type NewsletterAddressStatus, type NewsletterReceipt } from '@/infra/repository/dbNewsletter'
import { RssContent } from '@/domain/rss/content'
import { BucketClient } from '@/infra/repository/bucketClient'
import type { LazyInstance } from '@/decorators/lazy'
import { ContextManager } from '@/utils/context'
import { hashSHA256 } from '@/utils/strings'
import { configuredNewsletterDomain, newsletterRecipientPart, NewsletterError, parseNewsletter, readNewsletterRaw } from './newsletter/parser'

const RAW_PREFIX = 'newsletter-raw/'
const RAW_CURSOR = 'newsletter-maintenance/raw-gc-cursor'
@injectable()
export class NewsletterService {
  constructor(
    @inject(NewsletterRepo) private repo: NewsletterRepo,
    @inject(RssContent) private content: RssContent,
    @inject(BucketClient) private bucket: LazyInstance<BucketClient>
  ) {}
  async address(ctx: ContextManager, provision: boolean): Promise<NewsletterAddressStatus> {
    if (!ctx.getUserId()) throw new NewsletterError('not_found', 401)
    const domain = configuredNewsletterDomain(ctx.env)
    if (!domain) {
      if (provision) throw new NewsletterError('unavailable', 503)
      return { address: null, domain: null, status: 'unavailable' }
    }
    return this.repo.address(ctx.getUserId(), domain, provision)
  }
  async receive(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const domain = configuredNewsletterDomain(env)
    const at = message.to.lastIndexOf('@'),
      part = newsletterRecipientPart(message.to.slice(0, at))
    if (!domain || at < 1 || message.to.slice(at + 1).toLowerCase() !== domain || !part) throw new NewsletterError('not_found', 404)
    const recipient = await this.repo.recipient(domain, part)
    if (!recipient) throw new NewsletterError('not_found', 404)
    const raw = await readNewsletterRaw(message),
      parsed = await parseNewsletter(raw)
    const source = await hashSHA256(recipient.uuid + '\n' + parsed.sender)
    // A stable identity lookup avoids writing another raw object for common retries.
    if (await this.repo.checkAdmission(recipient, source, parsed.messageKey)) return
    const key = RAW_PREFIX + crypto.randomUUID()
    const stored = await this.bucket().R2Bucket.put(key, raw, { httpMetadata: { contentType: 'message/rfc822' } })
    if (!stored) throw new NewsletterError('unavailable', 503)
    let admitted
    try {
      admitted = await this.repo.admit(recipient, source, parsed.messageKey, key)
    } catch (error) {
      // No durable receipt was published. The unreferenced object is reclaimed by the raw sweep.
      throw error
    }
    if (admitted.created) {
      // Once admission commits, the raw object + pending receipt survive publication failure.
      for (const row of await this.repo.claim(admitted.receipt.id)) await this.process(row, env)
    }
  }
  private async process(row: NewsletterReceipt, env: Env) {
    try {
      const object = await this.bucket().R2Bucket.get(row.raw_key)
      if (!object) throw new Error('Raw receipt object unavailable')
      const parsed = await parseNewsletter(new Uint8Array(await object.arrayBuffer()))
      const stored = await this.content.storeItem(env, row.source_key, { content_html: parsed.html, image_url: null, article_url: null })
      await this.repo.complete(row, {
        sourceTitle: parsed.sourceTitle,
        title: parsed.title,
        summary: parsed.summary,
        publishedAt: parsed.publishedAt,
        contentKey: stored.content_key,
        truncated: parsed.truncated || stored.content_truncated
      })
    } catch (error) {
      const cancelled = error instanceof NewsletterError && ['not_found', 'lab_disabled', 'invalid_message'].includes(error.code)
      await this.repo.defer(row, cancelled)
      if (!cancelled) console.error('Newsletter publication deferred')
    }
  }
  async tick(ctx: ContextManager) {
    if (!configuredNewsletterDomain(ctx.env)) return
    for (const row of await this.repo.claim()) await this.process(row, ctx.env)
    const bucket = this.bucket().R2Bucket,
      state = await bucket.get(RAW_CURSOR),
      cursor = state ? await state.text() : ''
    const page = await bucket.list({ prefix: RAW_PREFIX, limit: 200, ...(cursor ? { cursor } : {}) })
    const keys = page.objects.filter(row => row.uploaded.valueOf() < Date.now() - 24 * 3600_000).map(row => row.key)
    const keep = new Set(await this.repo.rawReferenced(keys)),
      garbage = keys.filter(key => !keep.has(key))
    if (garbage.length) await bucket.delete(garbage)
    await bucket.put(RAW_CURSOR, page.truncated ? page.cursor : '')
  }
}

/** Permanent policy rejection is distinct from infrastructure failure before durable admission. */
export async function receiveNewsletterEmail(message: ForwardableEmailMessage, env: Env, service: NewsletterService) {
  try {
    await service.receive(message, env)
  } catch (error) {
    if (error instanceof NewsletterError && error.code !== 'unavailable') {
      message.setReject('Newsletter delivery is not available for this message.')
      return
    }
    // Avoid leaking connection strings, recipient addresses or MIME data into Worker error logs.
    throw new Error('Newsletter admission unavailable')
  }
}
