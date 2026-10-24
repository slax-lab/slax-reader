import { inject, injectable } from '@/decorators/di'
import { Scheduled } from '@/decorators/scheduled'
import { NewsletterService } from '@/domain/newsletter'
import { ContextManager } from '@/utils/context'

@injectable()
export class NewsletterJob {
  constructor(@inject(NewsletterService) private newsletter: NewsletterService) {}
  @Scheduled('*/5 * * * *')
  async recoverNewsletter(ctx: ContextManager) {
    await this.newsletter.tick(ctx)
  }
}
