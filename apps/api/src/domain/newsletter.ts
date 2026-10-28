import { inject, injectable } from '@/decorators/di'
import { NewsletterRepo, type NewsletterAddressStatus, type NewsletterReceipt } from '@/infra/repository/dbNewsletter'
import { RssContent } from '@/domain/rss/content'
import { ContextManager } from '@/utils/context'
import { hashSHA256 } from '@/utils/strings'
import { configuredNewsletterDomain, newsletterRecipientPart, NewsletterError, parseNewsletter, readNewsletterRaw, type ParsedNewsletter } from './newsletter/parser'

@injectable()
export class NewsletterService {
  constructor(
    @inject(NewsletterRepo) private repo: NewsletterRepo,
    @inject(RssContent) private content: RssContent
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
    const { receipt } = await this.repo.admit(recipient, source, parsed.messageKey)
    if (receipt.state !== 'pending') return
    const [claimed] = await this.repo.claim(receipt.id)
    if (!claimed) {
      // A concurrent processor may have completed while this delivery waited.
      const current = await this.repo.checkAdmission(recipient, source, parsed.messageKey)
      if (current && current.state !== 'pending') return
      throw new NewsletterError('unavailable', 503)
    }
    // The email event does not finish successfully before publication completes.
    await this.process(claimed, parsed, env)
  }

  private async process(row: NewsletterReceipt, parsed: ParsedNewsletter, env: Env) {
    try {
      const stored = await this.content.storeItem(env, row.source_key, { content_html: parsed.html, image_url: null, article_url: null })
      const completed = await this.repo.complete(row, {
        sourceTitle: parsed.sourceTitle,
        title: parsed.title,
        summary: parsed.summary,
        publishedAt: parsed.publishedAt,
        contentKey: stored.content_key,
        truncated: parsed.truncated || stored.content_truncated
      })
      if (!completed) throw new NewsletterError('unavailable', 503)
    } catch (error) {
      const cancelled = error instanceof NewsletterError && ['not_found', 'lab_disabled', 'invalid_message'].includes(error.code)
      await this.repo.release(row, cancelled)
      throw error
    }
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
