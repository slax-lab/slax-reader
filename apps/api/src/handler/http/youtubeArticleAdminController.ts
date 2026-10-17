import { ContextManager } from '@/utils/context'
import { Controller } from '@/decorators/controller'
import { Post } from '@/decorators/route'
import { inject } from '@/decorators/di'
import { RequestUtils } from '@/utils/requestUtils'
import { Successed } from '@/utils/responseUtils'
import { YoutubeArticleService } from '@/domain/youtubeArticle'

/** Internal YouTube article operations. Under /m/: login plus the team email allowlist (middleware/auth). */
@Controller('/')
export class YoutubeArticleAdminController {
  constructor(@inject(YoutubeArticleService) private service: YoutubeArticleService) {}

  /** Captions and refs for pre-P0 bookmarks of Labs users. Call again with next_before_id until it is null. */
  @Post('/m/youtube_article/backfill')
  public async handleBackfill(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ limit?: number; before_id?: number }>(request).catch(() => ({}) as { limit?: number; before_id?: number })
    const limit = Number.isFinite(Number(req?.limit)) ? Number(req.limit) : 20
    const before = Number.isFinite(Number(req?.before_id)) && Number(req.before_id) > 0 ? Number(req.before_id) : undefined
    return Successed(await this.service.backfill(ctx, limit, before), 200, 'ok', { 'Cache-Control': 'private, no-store' })
  }
}
