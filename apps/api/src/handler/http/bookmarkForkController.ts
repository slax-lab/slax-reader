import { Controller } from '@/decorators/controller'
import { Get, Post } from '@/decorators/route'
import { inject } from '@/decorators/di'
import { BookmarkForkService } from '@/domain/bookmarkFork'
import { ContextManager } from '@/utils/context'
import { ErrorParam } from '@/const/err'
import { ErrorName } from '@slax-reader/contracts'
import { MultiLangError } from '@/utils/multiLangError'
import { forkError } from '@/utils/bookmarkForkError'
import { createResponse } from '@/utils/responseUtils'
import { corsHeader } from '@/middleware/cors'

@Controller('/v1/bookmark')
export class BookmarkForkController {
  constructor(@inject(BookmarkForkService) private service: BookmarkForkService) {}

  @Post('/fork')
  async fork(ctx: ContextManager, request: Request) {
    return this.respond(async () => {
      let body: { source_user_bookmark_uuid: string }
      try {
        body = await request.json()
      } catch {
        throw ErrorParam()
      }
      if (!body || typeof body !== 'object') throw ErrorParam()
      const result = await this.service.fork(ctx, body.source_user_bookmark_uuid)
      return { bookmark_uid: result.bookmark_uid, disposition: result.disposition }
    })
  }

  @Get('/fork_metadata')
  async metadata(ctx: ContextManager, request: Request) {
    return this.respond(() => this.service.metadata(ctx, new URL(request.url).searchParams.get('bookmark_uid') || ''))
  }

  private async respond(action: () => Promise<unknown>) {
    const headers = { ...corsHeader, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
    try {
      return createResponse('json', { data: await action(), status: 200, headers })
    } catch (error) {
      const failure = error instanceof MultiLangError ? error : forkError(ErrorName.FORK_STORAGE_UNAVAILABLE)
      if (!(error instanceof MultiLangError)) console.error('Fork request failed', error)
      return createResponse('json', { data: failure, status: failure.errCode, headers })
    }
  }
}
