import { ContextManager } from '@/utils/context'
import { inject, injectable } from '../../decorators/di'
import { Scheduled } from '../../decorators/scheduled'
import { BookmarkService } from '../../domain/bookmark'
import { ImportService } from '../../domain/import'
import { AigcBatchOrchestrator } from '@/domain/orchestrator/aigc'
import { MonitoringOrchestrator } from '@/domain/orchestrator/monitor'

@injectable()
export class BookmarkJob {
  constructor(
    @inject(MonitoringOrchestrator) private monitoringOrchestrator: MonitoringOrchestrator,
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(ImportService) private importService: ImportService,
    @inject(AigcBatchOrchestrator) private aigcBatchOrchestrator: AigcBatchOrchestrator
  ) {}

  /**
   * 清理过期垃圾书签
   */
  @Scheduled('0 */1 * * *')
  public async clearExpiredTrashedBookmark(ctx: ContextManager) {
    await this.bookmarkService.clearExpiredTrashedBookmarkTask(ctx)
  }

  /**
   * 检查导入进度
   */
  @Scheduled('*/5 * * * *')
  public async checkImportProgress(ctx: ContextManager) {
    await this.importService.checkImportTaskProcess(ctx)
  }

  @Scheduled('*/2 * * * *')
  public async monitorTwitterBookmarks(ctx: ContextManager) {
    // await this.monitoringOrchestrator.monitorTwitterMention(ctx)
  }

  @Scheduled('*/1 * * * *')
  public async detectStuckAndRetry(ctx: ContextManager) {
    await this.bookmarkService.detectStuckAndRetry(ctx)
  }
}
