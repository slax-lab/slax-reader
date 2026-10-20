import { ContextManager } from '@/utils/context'
import { inject, injectable } from '@/decorators/di'
import { Scheduled } from '@/decorators/scheduled'
import { BookmarkForkService } from '@/domain/bookmarkFork'

@injectable()
export class BookmarkForkJob {
  constructor(@inject(BookmarkForkService) private forks: BookmarkForkService) {}

  @Scheduled('*/5 * * * *')
  public async repairForkOperations(ctx: ContextManager) {
    await this.forks.repairPending(ctx)
  }
}
