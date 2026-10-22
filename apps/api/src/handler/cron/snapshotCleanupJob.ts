import { inject, injectable } from '@/decorators/di'
import { Scheduled } from '@/decorators/scheduled'
import { SnapshotCleanupService } from '@/domain/snapshotCleanup'
import { ContextManager } from '@/utils/context'

@injectable()
export class SnapshotCleanupJob {
  constructor(@inject(SnapshotCleanupService) private service: SnapshotCleanupService) {}

  @Scheduled('*/5 * * * *')
  async sweepSnapshots(ctx: ContextManager) {
    await this.service.sweep(ctx)
  }
}
