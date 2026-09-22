import { Controller } from '@/decorators/controller'
import { Post } from '@/decorators/route'
import { ContextManager } from '@/utils/context'
import { inject } from '@/decorators/di'
import { Successed } from '@/utils/responseUtils'
import { SyncOrchestrator } from '@/domain/orchestrator/sync'
import { RequestUtils } from '@/utils/requestUtils'
import { SyncChangeItem } from '@/domain/orchestrator/sync'
import { Failed } from '@/utils/responseUtils'
import { ErrorParam } from '@/const/err'
import { UserDeletionService } from '@/domain/userDeletion'

@Controller('/v1/sync')
export class SyncController {
  constructor(
    @inject(SyncOrchestrator) private syncOrchestrator: SyncOrchestrator,
    @inject(UserDeletionService) private userDeletionService: UserDeletionService
  ) {}

  @Post('/token')
  public async handleSignRequest(ctx: ContextManager, request: Request) {
    await this.userDeletionService.ensureUserNotDeleted(ctx.getUserId())

    const { token, endpoint } = await this.syncOrchestrator.signToken(ctx)
    return Successed({ token, endpoint })
  }

  @Post('/changes')
  public async handleSyncSaveRequest(ctx: ContextManager, request: Request) {
    await this.userDeletionService.ensureUserNotDeleted(ctx.getUserId())

    const req = await RequestUtils.json<SyncChangeItem[]>(request)
    if (!Array.isArray(req) || req.length > 1000) return Failed(ErrorParam())

    try {
      await this.syncOrchestrator.syncChanges(ctx, req)
    } catch (error) {
      console.error('handleSyncSaveRequest failed', { userId: ctx.getUserId(), count: req.length })
      return Failed(ErrorParam())
    }
    return Successed({ status: true })
  }
}
