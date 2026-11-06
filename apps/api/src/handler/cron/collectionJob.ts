import { ContextManager } from '@/utils/context'
import { inject, injectable } from '../../decorators/di'
import { Scheduled } from '../../decorators/scheduled'
import { CollectionService } from '../../domain/collection'
import { enqueueVectorMaintenanceBatch } from '../../domain/vectorMaintenanceHooks'

@injectable()
export class CollectionJob {
  constructor(@inject(CollectionService) private collectionService: CollectionService) {}

  @Scheduled('*/30 * * * *')
  public async recomputeCollectionSubscriberActive(ctx: ContextManager) {
    const changed = await this.collectionService.recomputeSubscriberActiveStatus()
    await enqueueVectorMaintenanceBatch(
      ctx.env,
      changed.map(row => ({ kind: 'user', id: row.user_id, preference: 'collection' }))
    ).catch(error => {
      console.error('[vector-maintenance] subscription expiry dispatch failed', error)
    })
  }
}
