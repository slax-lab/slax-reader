import { ContextManager } from '@/utils/context'
import { Controller } from '@/decorators/controller'
import { Get, Post } from '@/decorators/route'
import { inject } from '@/decorators/di'
import { RequestUtils } from '@/utils/requestUtils'
import { Failed, Successed } from '@/utils/responseUtils'
import { ErrorParam } from '@/const/err'
import { YoutubeArticleService } from '@/domain/youtubeArticle'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * YouTube AI article. On the anonymous whitelist so share visitors can read; every handler checks
 * the bookmark's owner/share rule itself, and only the owner can start anything.
 */
@Controller('/v1/youtube_article')
export class YoutubeArticleController {
  constructor(@inject(YoutubeArticleService) private service: YoutubeArticleService) {}

  @Get('/status')
  public async handleStatus(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.query<{ bookmark_uid: string }>(request)
    if (!req?.bookmark_uid) return Failed(ErrorParam())
    return Successed(await this.service.getStatus(ctx, req.bookmark_uid), 200, 'ok', NO_STORE)
  }

  @Get('/content')
  public async handleContent(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.query<{ bookmark_uid: string; version: string }>(request)
    if (!req?.bookmark_uid || !req.version) return Failed(ErrorParam())
    // The version never changes content, but share access can be revoked: keep the browser copy short
    return Successed(await this.service.getContent(ctx, req.bookmark_uid, req.version), 200, 'ok', { 'Cache-Control': 'private, max-age=300' })
  }

  @Post('/generate')
  public async handleGenerate(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ bookmark_uid: string }>(request)
    if (!req?.bookmark_uid) return Failed(ErrorParam())
    return Successed(await this.service.request(ctx, req.bookmark_uid, 'generate'), 200, 'ok', NO_STORE)
  }

  @Post('/retry')
  public async handleRetry(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ bookmark_uid: string }>(request)
    if (!req?.bookmark_uid) return Failed(ErrorParam())
    return Successed(await this.service.request(ctx, req.bookmark_uid, 'retry'), 200, 'ok', NO_STORE)
  }
}
