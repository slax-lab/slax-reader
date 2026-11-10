import { inject, injectable } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { recommendationAlgorithm, type RecommendationFeedback } from '@/utils/recommendationFeedback'
import type { PreferenceKind } from '@/utils/vectorMaintenanceTypes'
import { ContentRecommendationService } from '../contentRecommendation'
import { submitServerEvent, submitServerEvents } from '../events'

@injectable()
export class ContentRecommendationOrchestrator {
  constructor(@inject(ContentRecommendationService) private recommendations: ContentRecommendationService) {}

  public async recommend(ctx: ContextManager, request: Request, kind: PreferenceKind, params: { limit: number; preferenceKind: PreferenceKind }) {
    const userId = ctx.getUserId()
    const result =
      kind === 'article'
        ? await this.recommendations.articles(userId, params.preferenceKind, params.limit)
        : await this.recommendations.collections(userId, params.preferenceKind, params.limit)
    const impressionId = crypto.randomUUID()
    const algorithm = await recommendationAlgorithm()
    submitServerEvent(ctx, request, 'recommendation_served', {
      impression_id: impressionId,
      kind,
      algorithm,
      ...(result.reason ? { reason: result.reason } : {}),
      items: result.items.map((item, position) => ({ position, item_id: 'bookmarkUuid' in item ? item.bookmarkUuid : item.code, score: item.score }))
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
