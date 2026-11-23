import { parseBookmarkSearchRequest } from '@slax-reader/contracts'
import { Failed, Successed } from '../../utils/responseUtils'
import { ContextManager } from '@/utils/context'
import { ErrorParam } from '../../const/err'
import { RequestUtils } from '../../utils/requestUtils'
import { Controller } from '../../decorators/controller'
import { Post } from '../../decorators/route'
import { inject } from '../../decorators/di'
import { BookmarkAiOrchestrator } from '../../domain/orchestrator/bookmarkAi'
import { SearchService } from '../../domain/search'
import { corsHeader } from '@/middleware/cors'
import { VectorMaintenanceService } from '../../domain/vectorMaintenance'
import { requireVectorRefreshSecret } from '@/utils/vectorRefreshAuth'
import { enqueueVectorMaintenance } from '@/domain/vectorMaintenanceHooks'
import { articleVectorId } from '@/utils/vectorMaintenanceTypes'

// Bookmark routes served by the AI Worker (see AI_ROUTES). They depend only on search, AI and vector services.
@Controller('/v1/bookmark')
export class BookmarkAiController {
  constructor(
    @inject(BookmarkAiOrchestrator) private bookmarkAiOrchestrator: BookmarkAiOrchestrator,
    @inject(SearchService) private searchService: SearchService,
    @inject(VectorMaintenanceService) private vectorMaintenanceService: VectorMaintenanceService
  ) {}

  @Post('/vector/refresh')
  public async handleUserBookmarkVectorRefreshRequest(ctx: ContextManager, request: Request) {
    requireVectorRefreshSecret(request, ctx.env)
    if (new URL(request.url).pathname !== '/v1/bookmark/vector/refresh') return Failed(ErrorParam())
    const params = await RequestUtils.json<{ user_id: number; bookmark_id: number }>(request).catch(() => null)
    if (
      !params ||
      Array.isArray(params) ||
      Object.keys(params).length !== 2 ||
      !Number.isSafeInteger(params.user_id) ||
      params.user_id < 1 ||
      !Number.isSafeInteger(params.bookmark_id) ||
      params.bookmark_id < 1
    )
      return Failed(ErrorParam())

    const identity = { userId: params.user_id, id: params.bookmark_id }
    const {
      results: [output],
      previous
    } = await this.vectorMaintenanceService.refreshArticlesWithPrevious([identity])
    if (output.state !== 'failed') {
      await enqueueVectorMaintenance(ctx.env, { kind: 'article', ...identity }, output, previous[articleVectorId(identity)])
      if (!(await this.vectorMaintenanceService.verifyRefresh(output))) return Successed({ ...output, state: 'pending' })
    }
    return Successed(output)
  }

  @Post('/preference/refresh')
  public async handleUserBookmarkPreferenceRefreshRequest(ctx: ContextManager, request: Request) {
    requireVectorRefreshSecret(request, ctx.env)
    if (new URL(request.url).pathname !== '/v1/bookmark/preference/refresh') return Failed(ErrorParam())
    const params = await RequestUtils.json<{ user_id: number }>(request).catch(() => null)
    if (!params || Array.isArray(params) || Object.keys(params).length !== 1 || !Number.isSafeInteger(params.user_id) || params.user_id < 1) return Failed(ErrorParam())

    const output = await this.vectorMaintenanceService.refreshUser(params.user_id, 'article')
    if (output.state !== 'failed' && !(await this.vectorMaintenanceService.verifyRefresh(output))) return Successed({ ...output, state: 'pending' })
    return Successed(output)
  }

  @Post('/search')
  public async handleUserBookmarkSearchRequest(ctx: ContextManager, request: Request) {
    const params = parseBookmarkSearchRequest(await RequestUtils.json<unknown>(request))
    if (!params) return Failed(ErrorParam())

    const searchResult = await this.searchService.hybridSearch(ctx, params.keyword, [], params.tag_uuids)
    return Successed(
      searchResult.map(item => {
        item.bookmark_id = ctx.hashIds.encodeId(item.bookmark_id)
        return item
      })
    )
  }

  @Post('/overview')
  public async handleUserGetBookmarkOverviewRequest(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ bookmark_id: number; bookmark_uid: string }>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid)) return Failed(ErrorParam())

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    ctx.execution.waitUntil(
      this.bookmarkAiOrchestrator
        .generateBookmarkOverviewStream(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid, writer, encoder, isForce: false })
        .catch(async error => {
          if (!error) return
          try {
            await writer.write(
              encoder.encode(
                JSON.stringify({
                  type: 'error',
                  message: error instanceof Error ? error.message : 'Unknown error'
                }) + '\n'
              )
            )
          } catch {}
        })
        .finally(() => writer.close().catch(() => {}))
    )
    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', ...corsHeader }
    })
  }

  @Post('/outline')
  public async handlerUserGetBookmarkOutlineRequest(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ bookmark_id: number; bookmark_uid: string }>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid)) return Failed(ErrorParam())

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    ctx.execution.waitUntil(
      this.bookmarkAiOrchestrator
        .generateBookmarkOutlineStream(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid, writer, encoder, isForce: false })
        .catch(async error => {
          if (!error) return
          try {
            await writer.write(
              encoder.encode(
                JSON.stringify({
                  type: 'error',
                  message: error instanceof Error ? error.message : 'Unknown error'
                }) + '\n'
              )
            )
          } catch {}
        })
        .finally(() => writer.close().catch(() => {}))
    )

    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', ...corsHeader }
    })
  }
}
