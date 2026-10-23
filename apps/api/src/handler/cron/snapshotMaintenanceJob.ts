import { inject, injectable } from '@/decorators/di'
import { Scheduled } from '@/decorators/scheduled'
import { SnapshotMaintenanceService } from '@/domain/snapshotMaintenance'
import { ContextManager } from '@/utils/context'

@injectable()
export class SnapshotMaintenanceJob {
  constructor(@inject(SnapshotMaintenanceService) private service: SnapshotMaintenanceService) {}

  @Scheduled('*/5 * * * *')
  async maintainSnapshots(ctx: ContextManager) {
    await this.service.maintain(ctx)
  }
}
