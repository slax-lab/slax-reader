import { Controller } from '@/decorators/controller'
import { Get } from '@/decorators/route'
import { inject } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { Failed, Successed } from '@/utils/responseUtils'
import { RequestUtils } from '@/utils/requestUtils'
import { FeedService } from '@/domain/feed'
import { RssError } from '@/domain/rss/feed'
import type { FeedEntriesQuery } from '@slax-reader/contracts'

@Controller('/v1/feed')
export class FeedController {
  constructor(@inject(FeedService) private feed: FeedService) {}

  private async respond(work: () => Promise<unknown>) {
    try {
      const response = Successed(await work())
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    } catch (error) {
      const failure = error instanceof RssError ? error : new RssError('source_unavailable', 503)
      const response = Failed({ error: failure.code }, failure.status, failure.code)
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }
  }

  @Get('/subscriptions')
  async listSubscriptions(ctx: ContextManager, request: Request) {
    return this.respond(() => this.feed.subscriptions(ctx))
  }

  @Get('/entries')
  async listEntries(ctx: ContextManager, request: Request) {
    return this.respond(async () => this.feed.entries(ctx, await RequestUtils.query<FeedEntriesQuery>(request)))
  }

  @Get('/entries/:id')
  async entry(ctx: ContextManager, request: Request) {
    return this.respond(() => {
      const id = new URL(request.url).pathname.split('/')[4]
      if (!id || !/^[a-f\d-]{36}$/.test(id)) throw new RssError('not_found', 404)
      return this.feed.detail(ctx, id)
    })
  }
}
