import { ErrorParam } from '../../const/err'
import { Controller } from '../../decorators/controller'
import { Post } from '../../decorators/route'
import { inject } from '../../decorators/di'
import { ContextManager } from '@/utils/context'
import { RequestUtils } from '../../utils/requestUtils'
import { Failed, Successed } from '../../utils/responseUtils'
import { VectorMaintenanceService } from '../../domain/vectorMaintenance'
import { requireVectorRefreshSecret } from '@/utils/vectorRefreshAuth'

// Collection vector task routes served by the AI Worker (see AI_ROUTES).
@Controller('/v1/collection')
export class CollectionVectorController {
  constructor(@inject(VectorMaintenanceService) private vectorMaintenanceService: VectorMaintenanceService) {}

  @Post('/vector/refresh')
  public async handleUserCollectionVectorRefreshRequest(ctx: ContextManager, request: Request) {
    requireVectorRefreshSecret(request, ctx.env)
    if (new URL(request.url).pathname !== '/v1/collection/vector/refresh') return Failed(ErrorParam())
    const params = await RequestUtils.json<{ collection_id: number }>(request).catch(() => null)
    if (!params || Array.isArray(params) || Object.keys(params).length !== 1 || !Number.isSafeInteger(params.collection_id) || params.collection_id < 1) return Failed(ErrorParam())

    const output = await this.vectorMaintenanceService.refreshCollection(params.collection_id)
    if (output.state !== 'failed' && !(await this.vectorMaintenanceService.verifyRefresh(output))) return Successed({ ...output, state: 'pending' })
    return Successed(output)
  }

  @Post('/preference/refresh')
  public async handleUserCollectionPreferenceRefreshRequest(ctx: ContextManager, request: Request) {
    requireVectorRefreshSecret(request, ctx.env)
    if (new URL(request.url).pathname !== '/v1/collection/preference/refresh') return Failed(ErrorParam())
    const params = await RequestUtils.json<{ user_id: number }>(request).catch(() => null)
    if (!params || Array.isArray(params) || Object.keys(params).length !== 1 || !Number.isSafeInteger(params.user_id) || params.user_id < 1) return Failed(ErrorParam())

    const output = await this.vectorMaintenanceService.refreshUser(params.user_id, 'collection')
    if (output.state !== 'failed' && !(await this.vectorMaintenanceService.verifyRefresh(output))) return Successed({ ...output, state: 'pending' })
    return Successed(output)
  }
}
