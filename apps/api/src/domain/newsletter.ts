import { NewsletterTiming } from '@/utils/newsletterTiming'
import { inject, injectable } from '@/decorators/di'
import { NewsletterRepo, type NewsletterAddressStatus } from '@/infra/repository/dbNewsletter'
import { NewsletterContent } from '@/domain/newsletterContent'
import { ContextManager } from '@/utils/context'
import { hashSHA256 } from '@/utils/strings'
import { configuredNewsletterDomain, newsletterRecipientPart, NewsletterError, parseNewsletter, readNewsletterRaw } from '@/utils/newsletter'

@injectable()
export class NewsletterService {
  constructor(
    @inject(NewsletterRepo) private repo: NewsletterRepo,
    @inject(NewsletterContent) private content: NewsletterContent
  ) {}
  async address(ctx: ContextManager, provision: boolean, confirmedAddress?: string): Promise<NewsletterAddressStatus> {
    if (!ctx.getUserId()) throw new NewsletterError('not_found', 401)
    const domain = configuredNewsletterDomain(ctx.env)
    if (!domain) {
      if (provision) throw new NewsletterError('unavailable', 503)
      return { address: null, domain: null, status: 'unavailable' }
    }
    return this.repo.address(ctx.getUserId(), domain, provision, confirmedAddress)
  }
  async receive(message: ForwardableEmailMessage, env: Env, timing = new NewsletterTiming(message.rawSize)): Promise<void> {
    const domain = configuredNewsletterDomain(env)
    const at = message.to.lastIndexOf('@'),
      part = newsletterRecipientPart(message.to.slice(0, at))
    if (!domain || at < 1 || message.to.slice(at + 1).toLowerCase() !== domain || !part) throw new NewsletterError('not_found', 404)
    const recipient = await timing.measure('recipient', () => this.repo.recipient(domain, part))
    if (!recipient) throw new NewsletterError('not_found', 404)
    const raw = await timing.measure('read', () => readNewsletterRaw(message)),
      parsed = await timing.measure('parse', () => parseNewsletter(raw))
    const source = await hashSHA256(recipient.uuid + '\n' + parsed.sender)
    const { mail } = await timing.measure('admit', () => this.repo.admit(recipient, source, parsed.messageKey, parsed.sender))
    if (mail.state !== 'pending') {
      timing.outcome = mail.state === 'ready' ? 'duplicate' : 'cancelled'
      return
    }
    const startedAt = Date.now()
    const stored = await this.content.store(env, recipient.uuid, mail.id, parsed, timing)
    // Indeterminate database outcomes retain the body rather than risking deletion of committed content.
    const result = await timing.measure('publish', () =>
      this.repo.publish(mail.id, recipient.user_id, recipient.id, {
        senderName: parsed.sourceTitle,
        title: parsed.title,
        excerpt: parsed.excerpt,
        publishedAt: parsed.publishedAt,
        contentKey: stored.key,
        truncated: stored.truncated,
        startedAt
      })
    )
    timing.outcome = result.published ? 'ready' : result.mail.state === 'ready' ? 'duplicate' : 'cancelled'
    if (!result.published && result.mail.content_key !== stored.key) await this.content.discard(stored.key)
  }
}

/** Permanent policy rejection is distinct from infrastructure failure before durable admission. */
export async function receiveNewsletterEmail(message: ForwardableEmailMessage, env: Env, service: NewsletterService, timing = new NewsletterTiming(message.rawSize)) {
  try {
    await service.receive(message, env, timing)
  } catch (error) {
    timing.outcome = 'failed'
    if (error instanceof NewsletterError && error.code !== 'unavailable') {
      timing.outcome = 'rejected'
      message.setReject('Newsletter delivery is not available for this message.')
      return
    }
    // Avoid leaking connection strings, recipient addresses or MIME data into Worker error logs.
    throw new Error('Newsletter admission unavailable')
  }
}
