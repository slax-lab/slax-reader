import { Controller } from '../../decorators/controller'
import { inject } from '../../decorators/di'
import { Get, Post } from '../../decorators/route'
import { ErrorParam, UnauthorizedError } from '../../const/err'
import { ContentRecommendationOrchestrator } from '../../domain/orchestrator/contentRecommendation'
import { ContextManager } from '../../utils/context'
import { parseRecommendationFeedback } from '../../utils/recommendationFeedback'
import { Failed, Successed } from '../../utils/responseUtils'
import type { PreferenceKind } from '../../utils/vectorMaintenanceTypes'

const MAX_FEEDBACK_BODY_BYTES = 100 * 1024

export function parseRecommendationQuery(request: Request, defaultKind: PreferenceKind): { limit: number; preferenceKind: PreferenceKind } | null {
  const params = new URL(request.url).searchParams
  if ([...params.keys()].some(key => key !== 'limit' && key !== 'preference_kind')) return null
  if (params.getAll('limit').length > 1 || params.getAll('preference_kind').length > 1) return null
  const rawLimit = params.get('limit') ?? '10'
  const preferenceKind = params.get('preference_kind') ?? defaultKind
  if (!/^\d+$/.test(rawLimit)) return null
  const limit = Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || preferenceKind !== defaultKind) return null
  return { limit, preferenceKind }
}

@Controller('/v1/recommendations')
export class ContentRecommendationController {
  constructor(@inject(ContentRecommendationOrchestrator) private recommendations: ContentRecommendationOrchestrator) {}

  @Get('/articles')
  public async articles(ctx: ContextManager, request: Request) {
    return this.recommend(ctx, request, 'article')
  }

  @Get('/collections')
  public async collections(ctx: ContextManager, request: Request) {
    return this.recommend(ctx, request, 'collection')
  }

  @Post('/feedback')
  public async feedback(ctx: ContextManager, request: Request) {
    const userId = ctx.getUserId()
    if (!Number.isSafeInteger(userId) || userId <= 0) return Failed(UnauthorizedError())
    if (Number(request.headers.get('content-length') || 0) > MAX_FEEDBACK_BODY_BYTES) return Failed(ErrorParam())
    let body: unknown
    try {
      const raw = await request.text()
      if (new TextEncoder().encode(raw).byteLength > MAX_FEEDBACK_BODY_BYTES) return Failed(ErrorParam())
      body = JSON.parse(raw)
    } catch {
      return Failed(ErrorParam())
    }
    const feedback = parseRecommendationFeedback(body)
    if (!feedback) return Failed(ErrorParam())
    return Successed(this.recommendations.feedback(ctx, request, feedback))
  }

  private async recommend(ctx: ContextManager, request: Request, kind: PreferenceKind) {
    const userId = ctx.getUserId()
    if (!Number.isSafeInteger(userId) || userId <= 0) return Failed(UnauthorizedError())
    const params = parseRecommendationQuery(request, kind)
    if (!params) return Failed(ErrorParam())
    const response = Successed(await this.recommendations.recommend(ctx, request, kind, params))
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
}
