import { ContextManager } from '@/utils/context'
import { inject, injectable } from '@/decorators/di'
import { Scheduled } from '@/decorators/scheduled'
import { PodcastService } from '@/domain/podcast'

@injectable()
export class PodcastJob {
  constructor(@inject(PodcastService) private service: PodcastService) {}

  /** Dead runs back to pending or failed, deferred episodes started, unreferenced episodes deleted. */
  @Scheduled('*/5 * * * *')
  public async sweepPodcasts(ctx: ContextManager) {
    await this.service.sweep(ctx)
  }
}
