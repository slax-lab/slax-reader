import { ContextManager } from '@/utils/context'
import { Controller } from '@/decorators/controller'
import { Get, Post } from '@/decorators/route'
import { inject } from '@/decorators/di'
import { RequestUtils } from '@/utils/requestUtils'
import { Failed, Successed } from '@/utils/responseUtils'
import { ErrorParam } from '@/const/err'
import { PodcastService } from '@/domain/podcast'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Podcast articles. Status and translation are on the anonymous whitelist so share visitors can
 * read; every handler checks the bookmark's owner/share rule itself, and only the owner can retry.
 */
@Controller('/v1/podcast')
export class PodcastController {
  constructor(@inject(PodcastService) private service: PodcastService) {}

  @Get('/status')
  public async handleStatus(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.query<{ bookmark_uid: string }>(request)
    if (!req?.bookmark_uid) return Failed(ErrorParam())
    return Successed(await this.service.getStatus(ctx, req.bookmark_uid), 200, 'ok', NO_STORE)
  }

  @Get('/translation')
  public async handleTranslation(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.query<{ bookmark_uid: string; version: string }>(request)
    if (!req?.bookmark_uid || !req.version) return Failed(ErrorParam())
    // The version never changes content, but share access can be revoked: no browser copy
    return Successed(await this.service.getTranslation(ctx, req.bookmark_uid, req.version), 200, 'ok', { 'Cache-Control': 'private, no-store' })
  }

  @Post('/retry')
  public async handleRetry(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ bookmark_uid: string }>(request)
    if (!req?.bookmark_uid) return Failed(ErrorParam())
    return Successed(await this.service.retry(ctx, req.bookmark_uid), 200, 'ok', NO_STORE)
  }
}
