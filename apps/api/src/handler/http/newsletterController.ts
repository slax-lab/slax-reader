import { Controller } from '@/decorators/controller'
import { Get, Post } from '@/decorators/route'
import { inject } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { NewsletterService } from '@/domain/newsletter'
import { NewsletterError } from '@/domain/newsletter/parser'
import { Failed, Successed } from '@/utils/responseUtils'

@Controller('/v1/user')
export class NewsletterController {
  constructor(@inject(NewsletterService) private newsletter: NewsletterService) {}
  private async respond(work: () => Promise<unknown>) {
    let response: Response
    try {
      response = Successed(await work())
    } catch (error) {
      if (!(error instanceof NewsletterError)) throw error
      response = Failed({ error: error.code }, error.status, error.code)
    }
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
  @Get('/newsletter_address')
  async address(ctx: ContextManager, _request: Request) {
    return this.respond(() => this.newsletter.address(ctx, false))
  }
  @Post('/newsletter_address')
  async provision(ctx: ContextManager, _request: Request) {
    return this.respond(() => this.newsletter.address(ctx, true))
  }
}
