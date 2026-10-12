import type { CreateApiKeyRequest, RollApiKeyRequest } from '@slax-reader/contracts'
import { ContextManager } from '@/utils/context'
import { Successed } from '../../utils/responseUtils'
import { Controller } from '../../decorators/controller'
import { Get, Post } from '../../decorators/route'
import { inject } from '../../decorators/di'
import { ApiKeyService } from '../../domain/apiKey'
import { RequestUtils } from '../../utils/requestUtils'

@Controller('/v1/user')
export class ApiKeyController {
  constructor(@inject(ApiKeyService) private apiKeyService: ApiKeyService) {}

  @Post('/api_keys')
  public async handleCreateApiKey(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<CreateApiKeyRequest>(request)
    const result = await this.apiKeyService.createApiKey(ctx, req.name || 'Default')
    return Successed(result)
  }

  @Post('/roll')
  public async handleRollApiKey(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<RollApiKeyRequest>(request)
    const result = await this.apiKeyService.rollApiKey(ctx, req.name)
    return Successed(result)
  }

  @Get('/api_keys')
  public async handleListApiKeys(ctx: ContextManager, request: Request) {
    const result = await this.apiKeyService.listApiKeys(ctx)
    return Successed(result)
  }
}
