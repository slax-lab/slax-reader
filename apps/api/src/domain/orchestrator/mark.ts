import { inject, injectable } from '@/decorators/di'
import { MarkService, markResponse, markRequest } from '@/domain/mark'
import { ContextManager } from '@/utils/context'
import { NotificationService } from '@/domain/notification'

@injectable()
export class MarkOrchestrator {
  constructor(
    @inject(MarkService) private markService: MarkService,
    @inject(NotificationService) private notificationService: NotificationService
  ) {}

  public async createMark(ctx: ContextManager, data: markRequest): Promise<markResponse> {
    const res = await this.markService.createMark(ctx, data)
    ctx.execution.waitUntil(this.notificationService.createMarkNotification(ctx.env, res.mark, data, res.userBookmark, res.replyComment))
    return res.response
  }
}
