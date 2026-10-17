import { ContextManager } from '@/utils/context'
import { inject, injectable } from '@/decorators/di'
import { Scheduled } from '@/decorators/scheduled'
import { YoutubeArticleService } from '@/domain/youtubeArticle'

@injectable()
export class YoutubeArticleJob {
  constructor(@inject(YoutubeArticleService) private service: YoutubeArticleService) {}

  /** Dead workflows back to pending or failed, deferred requests started, unreferenced rows deleted. */
  @Scheduled('*/5 * * * *')
  public async sweepYoutubeArticles(ctx: ContextManager) {
    await this.service.sweep(ctx)
  }
}
