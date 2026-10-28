import { NewsletterSaveService } from '@/domain/newsletter/save'
import { NewsletterError } from '@/domain/newsletter/parser'
import { Controller } from '@/decorators/controller'
import { Get, Post } from '@/decorators/route'
import { inject } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { Failed, Successed } from '@/utils/responseUtils'
import { RequestUtils } from '@/utils/requestUtils'
import { FeedService, validFeedId, newsletterEntryId } from '@/domain/feed'
import { RssError } from '@/domain/rss/feed'
import type { FeedEntriesQuery } from '@slax-reader/contracts'

@Controller('/v1/feed')
export class FeedController {
  constructor(
    @inject(FeedService) private feed: FeedService,
    @inject(NewsletterSaveService) private saves: NewsletterSaveService
  ) {}

  private async respond(work: () => Promise<unknown>) {
    try {
      const response = Successed(await work())
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    } catch (error) {
      if (!(error instanceof RssError) && !(error instanceof NewsletterError)) console.error('Feed request failed', { category: 'unexpected_infrastructure_failure' })
      const failure = error instanceof RssError || error instanceof NewsletterError ? error : new RssError('source_unavailable', 503)
      const response = Failed({ error: failure.code }, failure.status, failure.code)
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }
  }

  private entryId(request: Request) {
    try {
      return decodeURIComponent(new URL(request.url).pathname.split('/')[4] || '')
    } catch {
      throw new RssError('not_found', 404)
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
      const id = this.entryId(request)
      if (!id || !validFeedId(id)) throw new RssError('not_found', 404)
      return this.feed.detail(ctx, id)
    })
  }
  @Post('/entries/:id/save')
  async save(ctx: ContextManager, request: Request) {
    return this.respond(() => {
      const id = newsletterEntryId(this.entryId(request))
      if (id === null) throw new RssError('not_found', 404)
      return this.saves.save(ctx, id)
    })
  }
}
