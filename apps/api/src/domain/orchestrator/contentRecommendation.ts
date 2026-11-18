import { isWhiteEmail } from '@/utils/internalEmail'
import { inject, injectable } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { recommendationAlgorithm, type RecommendationFeedback } from '@/utils/recommendationFeedback'
import type { PreferenceKind } from '@/utils/vectorMaintenanceTypes'
import { ContentRecommendationService, type RankTrace } from '../contentRecommendation'
import { submitServerEvent, submitServerEvents } from '../events'

@injectable()
export class ContentRecommendationOrchestrator {
  constructor(@inject(ContentRecommendationService) private recommendations: ContentRecommendationService) {}

  public async recommend(ctx: ContextManager, request: Request, kind: PreferenceKind, params: { limit: number; preferenceKind: PreferenceKind; discovery?: boolean }) {
    const userId = ctx.getUserId()
    const impressionId = crypto.randomUUID()
    const algorithm = await recommendationAlgorithm(params.discovery)
    let evaluate: (() => Promise<RankTrace>) | undefined
    const traceRequested = kind === 'collection' && request.headers.get('Prefer') === 'slax-rank-trace' && isWhiteEmail(ctx.env, ctx.getUserEmail())
    const result =
      kind === 'article'
        ? await this.recommendations.articles(userId, params.preferenceKind, params.limit)
        : traceRequested
          ? await this.recommendations.collections(
              userId,
              params.preferenceKind,
              params.limit,
              compare => {
                evaluate = compare
              },
              params.discovery
            )
          : params.discovery
            ? await this.recommendations.collections(userId, params.preferenceKind, params.limit, undefined, true)
            : await this.recommendations.collections(userId, params.preferenceKind, params.limit)
    if (traceRequested) {
      let expectedCollections = 0
      let status: 'complete' | 'empty' | 'failed' = 'empty'
      try {
        if (evaluate) {
          const trace = await evaluate()
          expectedCollections = trace.collections.length
          submitServerEvents(
            ctx,
            request,
            trace.collections.map(collection => ({
              eventName: 'recommendation_collection_comparison',
              properties: { impression_id: impressionId, trace_version: 1, preference: trace.preference, scored_at: trace.scored_at, ...collection }
            }))
          )
          status = 'complete'
        }
      } catch {
        status = 'failed'
      }
      submitServerEvent(ctx, request, 'recommendation_comparison_finished', {
        impression_id: impressionId,
        trace_version: 1,
        status,
        expected_collections: expectedCollections
      })
    }
    submitServerEvent(ctx, request, 'recommendation_served', {
      impression_id: impressionId,
      kind,
      algorithm,
      ...(params.discovery ? { representation: 'discovery_cards' } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      items: result.items.map((item, position) => ({
        position,
        item_id: 'bookmarkUuid' in item ? item.bookmarkUuid : item.code,
        score: item.score,
        ...(params.discovery && 'articles' in item ? { members: item.articles.map(article => article.bookmarkUuid) } : {})
      }))
    })
    return { ...result, impressionId, algorithm }
  }

  public feedback(ctx: ContextManager, request: Request, feedback: RecommendationFeedback) {
    submitServerEvents(
      ctx,
      request,
      feedback.events.map(event => ({
        eventName: 'recommendation_feedback',
        properties: { impression_id: feedback.impression_id, kind: feedback.kind, item_id: event.item_id, position: event.position, action: event.action },
        options: { occurredAt: event.occurred_at }
      }))
    )
    return { received: feedback.events.length }
  }
}
