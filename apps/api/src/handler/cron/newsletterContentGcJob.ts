import { inject, injectable } from '@/decorators/di'
import { Scheduled } from '@/decorators/scheduled'
import { NewsletterContent } from '@/domain/newsletter/content'
import { NewsletterRepo } from '@/infra/repository/dbNewsletter'
import { ContextManager } from '@/utils/context'
@injectable()
export class NewsletterContentGcJob {
  constructor(
    @inject(NewsletterContent) private content: NewsletterContent,
    @inject(NewsletterRepo) private repo: NewsletterRepo
  ) {}
  @Scheduled('0 */1 * * *')
  async collectNewsletterBodies(ctx: ContextManager) {
    await this.content.sweep(ctx, this.repo)
  }
}
