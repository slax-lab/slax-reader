import { ContextManager } from '@/utils/context'
import { inject, injectable } from '../../decorators/di'
import { Scheduled } from '../../decorators/scheduled'
import { CollectionService } from '../../domain/collection'

@injectable()
export class CollectionJob {
  constructor(@inject(CollectionService) private collectionService: CollectionService) {}

  @Scheduled('*/30 * * * *')
  public async recomputeCollectionSubscriberActive(ctx: ContextManager) {
    await this.collectionService.recomputeSubscriberActiveStatus()
  }
}
