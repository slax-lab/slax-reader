import { inject, injectable } from '@/decorators/di'
import { NewsletterRepo, type NewsletterAddressStatus } from '@/infra/repository/dbNewsletter'
import { NewsletterContent } from '@/domain/newsletter/content'
import { ContextManager } from '@/utils/context'
import { hashSHA256 } from '@/utils/strings'
import { configuredNewsletterDomain, newsletterRecipientPart, NewsletterError, parseNewsletter, readNewsletterRaw } from './newsletter/parser'

@injectable()
export class NewsletterService {
  constructor(
    @inject(NewsletterRepo) private repo: NewsletterRepo,
    @inject(NewsletterContent) private content: NewsletterContent
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
    const { mail } = await this.repo.admit(recipient, source, parsed.messageKey, parsed.sender)
    if (mail.state !== 'pending') return
    const startedAt = Date.now()
    const stored = await this.content.store(env, recipient.uuid, mail.id, parsed)
    // Indeterminate database outcomes retain the body; GC checks authoritative references later.
    const result = await this.repo.publish(mail.id, recipient.user_id, recipient.id, {
      senderName: parsed.sourceTitle,
      title: parsed.title,
      summary: parsed.summary,
      publishedAt: parsed.publishedAt,
      contentKey: stored.key,
      truncated: stored.truncated,
      startedAt
    })
    if (!result.published && result.mail.content_key !== stored.key) await this.content.discard(stored.key)
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
