import { inject, injectable } from '@/decorators/di'
import { Scheduled } from '@/decorators/scheduled'
import { RssService } from '@/domain/rss'
import { ContextManager } from '@/utils/context'

@injectable()
export class RssJob {
  constructor(@inject(RssService) private rss: RssService) {}
  @Scheduled('*/5 * * * *')
  async refreshRss(ctx: ContextManager) {
    await this.rss.tick(ctx)
  }
}
