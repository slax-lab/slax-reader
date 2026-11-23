import { Router } from 'itty-router'
import { auth } from '../../../middleware/auth'
import { requestLog } from '../../../middleware/requestLog'
import { cors } from '../../../middleware/cors'
import { rateLimit } from '../../../middleware/rateLimit'
import { ContextManager } from '@/utils/context'
import { Container } from '../../../decorators/di'
import { NotFound, Successed } from '../../../utils/responseUtils'
import { AigcController } from '../../../handler/http/aigcController'
import { BookmarkAiController } from '../../../handler/http/bookmarkAiController'
import { CollectionVectorController } from '../../../handler/http/collectionVectorController'
import { ContentRecommendationController } from '../../../handler/http/contentRecommendationController'
import { SearchController } from '../../../handler/http/searchController'

export function getRouter(container: Container) {
  const router = Router()

  router.all('*', cors)
  router.all('*', (req: Request, ctx: ContextManager) => auth(req, ctx, container))
  router.all('*', (req: Request, ctx: ContextManager) => requestLog(req, ctx))
  router.all('*', (req: Request, ctx: ContextManager) => rateLimit(req, ctx))

  router.post('/v1/aigc/summaries', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(AigcController)
    return await controller.handleSummariesRequest(ctx, req)
  })
  router.post('/v1/aigc/chat', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(AigcController)
    return await controller.handleCompletionsRequest(ctx, req)
  })
  router.post('/v1/bookmark/vector/refresh', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkAiController)
    return await controller.handleUserBookmarkVectorRefreshRequest(ctx, req)
  })
  router.post('/v1/bookmark/preference/refresh', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkAiController)
    return await controller.handleUserBookmarkPreferenceRefreshRequest(ctx, req)
  })
  router.post('/v1/bookmark/search', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkAiController)
    return await controller.handleUserBookmarkSearchRequest(ctx, req)
  })
  router.post('/v1/bookmark/overview', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkAiController)
    return await controller.handleUserGetBookmarkOverviewRequest(ctx, req)
  })
  router.post('/v1/bookmark/outline', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkAiController)
    return await controller.handlerUserGetBookmarkOutlineRequest(ctx, req)
  })
  router.post('/v1/collection/vector/refresh', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CollectionVectorController)
    return await controller.handleUserCollectionVectorRefreshRequest(ctx, req)
  })
  router.post('/v1/collection/preference/refresh', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CollectionVectorController)
    return await controller.handleUserCollectionPreferenceRefreshRequest(ctx, req)
  })
  router.get('/v1/recommendations/articles', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(ContentRecommendationController)
    return await controller.articles(ctx, req)
  })
  router.get('/v1/recommendations/collections', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(ContentRecommendationController)
    return await controller.collections(ctx, req)
  })
  router.post('/v1/recommendations/feedback', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(ContentRecommendationController)
    return await controller.feedback(ctx, req)
  })
  router.post('/v1/search', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SearchController)
    return await controller.searchStream(ctx, req)
  })

  router.get('/ping', () => Successed('pong'))
  router.all('*', () => NotFound('Resource not found'))

  return router
}
