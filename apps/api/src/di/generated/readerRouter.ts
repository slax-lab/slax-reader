import { Router } from 'itty-router'
import { auth } from '../../middleware/auth'
import { requestLog } from '../../middleware/requestLog'
import { cors } from '../../middleware/cors'
import { rateLimit } from '../../middleware/rateLimit'
import { ContextManager } from '@/utils/context'
import { Container } from '../../decorators/di'
import { NotFound, Successed } from '../../utils/responseUtils'
import { AigcController } from '../../handler/http/aigcController'
import { BookmarkController } from '../../handler/http/bookmarkController'
import { CallbackController } from '../../handler/http/callbackController'
import { CollectionController } from '../../handler/http/collectionController'
import { MarkController } from '../../handler/http/markController'
import { ShareController } from '../../handler/http/shareController'
import { SubscriptionController } from '../../handler/http/subscriptionController'
import { TagController } from '../../handler/http/tagController'
import { RssController } from '../../handler/http/rssController'
import { UserController } from '../../handler/http/userController'
import { McpServerController } from '../../handler/http/mcpController'
import { SyncController } from '../../handler/http/syncController'
import { PromotionController } from '../../handler/http/promotionController'
import { ApiKeyController } from '../../handler/http/apiKeyController'
import { EventsController } from '../../handler/http/eventsController'
import { MetricsController } from '../../handler/http/metricsController'

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
  router.get('/v1/bookmark/export', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserExportBookmarksRequest(ctx, req)
  })
  router.post('/v1/bookmark/add', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserAddBookmarkRequest(ctx, req)
  })
  router.post('/v1/bookmark/add_url', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserAddUrlBookmarkRequest(ctx, req)
  })
  router.post('/v1/bookmark/del', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserDeleteBookmarkRequest(ctx, req)
  })
  router.post('/v1/bookmark/trash', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserTrashBookmarkRequest(ctx, req)
  })
  router.post('/v1/bookmark/trash_revert', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserTrashRevertBookmarkRequest(ctx, req)
  })
  router.get('/v1/bookmark/list', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserGetBookmarksRequest(ctx, req)
  })
  router.get('/v1/bookmark/detail', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserGetBookmarkDetailRequest(ctx, req)
  })
  router.get('/v1/bookmark/metadata', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserGetBookmarkMetadataRequest(ctx, req)
  })
  router.post('/v1/bookmark/exists', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserBookmarkExistsRequest(ctx, req)
  })
  router.post('/v1/bookmark/archive', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserBookmarkArchiveRequest(ctx, req)
  })
  router.post('/v1/bookmark/star', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserBookmarkStarRequest(ctx, req)
  })
  router.post('/v1/bookmark/alias_title', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserBookmarkAliasTitleRequest(ctx, req)
  })
  router.post('/v1/bookmark/import', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserImportBookmarkRequest(ctx, req)
  })
  router.post('/v1/bookmark/import_preview', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserImportPreviewRequest(ctx, req)
  })
  router.get('/v1/bookmark/import_status', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserImportBookmarkStatusRequest(ctx, req)
  })
  router.get('/v1/bookmark/import_failed', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserImportFailedBookmarksRequest(ctx, req)
  })
  router.post('/v1/bookmark/import/batch_delete', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserBatchDeleteFailedBookmarksRequest(ctx, req)
  })
  router.get('/v1/bookmark/summaries', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserBookmarkSummariesRequest(ctx, req)
  })
  router.post('/v1/bookmark/search', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserBookmarkSearchRequest(ctx, req)
  })
  router.post('/v1/bookmark/dev_rebuild_search_index', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleDevRebuildSearchIndex(ctx, req)
  })
  router.post('/v1/bookmark/dev_clear_search_cache', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleDevClearSearchCache(ctx, req)
  })
  router.post('/v1/bookmark/add_tag', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserBookmarkAddTagRequest(ctx, req)
  })
  router.post('/v1/bookmark/add_tags', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserBookmarkAddTagsRequest(ctx, req)
  })
  router.post('/v1/bookmark/del_tag', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserBookmarkDelTagRequest(ctx, req)
  })
  router.get('/v1/bookmark/all_changes', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserGetAllBookmarkChangesRequest(ctx, req)
  })
  router.get('/v1/bookmark/partial_changes', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserGetPartialBookmarkChangesRequest(ctx, req)
  })
  router.get('/v1/bookmark/connect_changes', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserGetConnectBookmarkChangesRequest(ctx, req)
  })
  router.get('/v1/bookmark/mark_list', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserGetBookmarkMarkListRequest(ctx, req)
  })
  router.get('/v1/bookmark/brief', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserTestRequest(ctx, req)
  })
  router.post('/v1/bookmark/content', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleStreamBookmarkContent(ctx, req)
  })
  router.post('/v1/bookmark/overview', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handleUserGetBookmarkOverviewRequest(ctx, req)
  })
  router.post('/v1/bookmark/outline', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(BookmarkController)
    return await controller.handlerUserGetBookmarkOutlineRequest(ctx, req)
  })
  router.post('/callback/telegram', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CallbackController)
    return await controller.handlerTelegramCallback(ctx, req)
  })
  router.all('/callback/stripe', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CallbackController)
    return await controller.handlerStripeCallback(ctx, req)
  })
  router.all('/callback/apple_notifications', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CallbackController)
    return await controller.handlerAppleNotificationsCallback(ctx, req)
  })
  router.get('/callback/twitter', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CallbackController)
    return await controller.handlerTwitterCallback(ctx, req)
  })
  router.get('/v1/collection/', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CollectionController)
    return await controller.handleShareCollectRequest(ctx, req)
  })
  router.get('/v1/collection/owner_info', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CollectionController)
    return await controller.handleCollectionOwnerInfoRequest(ctx, req)
  })
  router.get('/v1/collection/mine', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CollectionController)
    return await controller.handleMyShareCollectRequest(ctx, req)
  })
  router.post('/v1/collection/setting', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CollectionController)
    return await controller.handleUserSettingShareCollectRequest(ctx, req)
  })
  router.post('/v1/collection/subscribe', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CollectionController)
    return await controller.handleUserCollectionSubscribeRequest(ctx, req)
  })
  router.post('/v1/collection/unsubscribe', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CollectionController)
    return await controller.handleUserCollectionUnsubscribeRequest(ctx, req)
  })
  router.post('/v1/collection/delete_subscribe', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CollectionController)
    return await controller.handleUserCollectionDeleteSubscribeRequest(ctx, req)
  })
  router.post('/v1/collection/subscribed', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CollectionController)
    return await controller.handleUserCollectionSubscribedRequest(ctx, req)
  })
  router.get('/v1/collection/subscribed_list', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CollectionController)
    return await controller.handleUserCollectionSubscribedListRequest(ctx, req)
  })
  router.get('/v1/collection/bookmark', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(CollectionController)
    return await controller.handleUserCollectionSubscribedDetailRequest(ctx, req)
  })
  router.post('/v1/mark/create', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(MarkController)
    return await controller.createMark(ctx, req)
  })
  router.post('/v1/mark/delete', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(MarkController)
    return await controller.deleteMark(ctx, req)
  })
  router.get('/v1/mark/list', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(MarkController)
    return await controller.getMarkList(ctx, req)
  })
  router.get('/v1/mark/users', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(MarkController)
    return await controller.getMarkUsers(ctx, req)
  })
  router.get('/v1/share/detail', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(ShareController)
    return await controller.getShare(ctx, req)
  })
  router.get('/v1/share/inline_detail', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(ShareController)
    return await controller.getInlineShare(ctx, req)
  })
  router.post('/v1/share/update', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(ShareController)
    return await controller.updateShare(ctx, req)
  })
  router.post('/v1/share/delete', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(ShareController)
    return await controller.deleteShare(ctx, req)
  })
  router.get('/v1/share/exists', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(ShareController)
    return await controller.existsShare(ctx, req)
  })
  router.get('/v1/share/mark_list', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(ShareController)
    return await controller.getMarkList(ctx, req)
  })
  router.post('/v1/subscription/create', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SubscriptionController)
    return await controller.createSubscription(ctx, req)
  })
  router.post('/v1/subscription/create_once', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SubscriptionController)
    return await controller.createOnceSubscription(ctx, req)
  })
  router.post('/v1/subscription/create_subscription', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SubscriptionController)
    return await controller.createSubscriptionPaymentIntent(ctx, req)
  })
  router.post('/v1/subscription/cancel', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SubscriptionController)
    return await controller.cancelSubscription(ctx, req)
  })
  router.post('/v1/subscription/redeem', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SubscriptionController)
    return await controller.redeemSubscription(ctx, req)
  })
  router.post('/v1/subscription/receive', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SubscriptionController)
    return await controller.receiveSubscription(ctx, req)
  })
  router.post('/v1/subscription/check_receive', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SubscriptionController)
    return await controller.checkReceiveStatus(ctx, req)
  })
  router.get('/v1/subscription/user_inapp_purchase', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SubscriptionController)
    return await controller.getUserIapSubscriptionInfo(ctx, req)
  })
  router.post('/v1/subscription/create_inapp_purchase', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SubscriptionController)
    return await controller.handleCreateIapOrderId(ctx, req)
  })
  router.post('/v1/subscription/check_inapp_purchase', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SubscriptionController)
    return await controller.handleCheckIapOrderPurchase(ctx, req)
  })
  router.get('/v1/subscription/apple_inapp_products', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SubscriptionController)
    return await controller.handleGetAppleIapProducts(ctx, req)
  })
  router.get('/v1/tag/list', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(TagController)
    return await controller.handleListTagsRequest(ctx, req)
  })
  router.post('/v1/tag/update', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(TagController)
    return await controller.handleUpdateTagRequest(ctx, req)
  })
  router.post('/v1/tag/create', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(TagController)
    return await controller.handleCreateTagRequest(ctx, req)
  })
  router.post('/v1/tag/promote', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(TagController)
    return await controller.handlePromoteTagRequest(ctx, req)
  })
  router.post('/v1/tag/demote', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(TagController)
    return await controller.handleDemoteTagRequest(ctx, req)
  })
  router.post('/v1/tag/delete', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(TagController)
    return await controller.handleDeleteTagRequest(ctx, req)
  })
  router.get('/v1/rss/subscriptions', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(RssController)
    return await controller.listSubscriptions(ctx, req)
  })
  router.post('/v1/rss/subscriptions', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(RssController)
    return await controller.addSubscription(ctx, req)
  })
  router.post('/v1/rss/subscriptions/:id/update', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(RssController)
    return await controller.updateSubscription(ctx, req)
  })
  router.post('/v1/rss/subscriptions/:id/delete', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(RssController)
    return await controller.deleteSubscription(ctx, req)
  })
  router.post('/v1/rss/subscriptions/:id/refresh', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(RssController)
    return await controller.refreshSubscription(ctx, req)
  })
  router.get('/v1/rss/entries', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(RssController)
    return await controller.listEntries(ctx, req)
  })
  router.get('/v1/rss/entries/:id', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(RssController)
    return await controller.entry(ctx, req)
  })
  router.post('/v1/rss/entries/:id/save', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(RssController)
    return await controller.saveEntry(ctx, req)
  })
  router.post('/v1/user/login', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserLoginRequest(ctx, req)
  })
  router.get('/v1/user/me', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserDetailRequest(ctx, req)
  })
  router.post('/v1/user/refresh', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleRefreshTokenRequest(ctx, req)
  })
  router.post('/v1/user/bind_link', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserBindLinkRequest(ctx, req)
  })
  router.post('/v1/user/report', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserReportRequest(ctx, req)
  })
  router.post('/v1/user/setting', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserSettingRequest(ctx, req)
  })
  router.post('/v1/user/setting/enable', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleEnableUserSettingRequest(ctx, req)
  })
  router.post('/v1/user/setting/disable', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleDisableUserSettingRequest(ctx, req)
  })
  router.get('/v1/user/labs', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserLabsRequest(ctx, req)
  })
  router.get('/v1/user/userinfo', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserInfoRequest(ctx, req)
  })
  router.post('/v1/user/subscribe/pushapi', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserSubscribePushApiRequest(ctx, req)
  })
  router.get('/v1/user/messages', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserMessagesRequest(ctx, req)
  })
  router.get('/v1/user/unread_count', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserUnreadCountRequest(ctx, req)
  })
  router.get('/v1/user/notifications', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserNotificationListRequest(ctx, req)
  })
  router.post('/v1/user/read_notifications', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserReadAllNotificationRequest(ctx, req)
  })
  router.post('/v1/user/read_notification', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserReadNotificationRequest(ctx, req)
  })
  router.get('/v1/user/setting/tabs_config', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUserInboxTabsConfigRequest(ctx, req)
  })
  router.get('/v1/user/share_settings', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleGetShareSettingsRequest(ctx, req)
  })
  router.post('/v1/user/share_settings', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleUpdateShareSettingsRequest(ctx, req)
  })
  router.post('/v1/user/delete_my_account', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(UserController)
    return await controller.handleDeleteUserAccountRequest(ctx, req)
  })
  router.all('/v1/mcp/*', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(McpServerController)
    return await controller.handleMcpRequest(ctx, req)
  })
  router.post('/v1/sync/token', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SyncController)
    return await controller.handleSignRequest(ctx, req)
  })
  router.post('/v1/sync/changes', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(SyncController)
    return await controller.handleSyncSaveRequest(ctx, req)
  })
  router.get('/v1/promotion/blogger_info', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(PromotionController)
    return await controller.handleGetBloggerRequest(ctx, req)
  })
  router.post('/v1/promotion/check_receive', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(PromotionController)
    return await controller.checkReceiveStatus(ctx, req)
  })
  router.post('/v1/promotion/receive', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(PromotionController)
    return await controller.handleReceiveRequest(ctx, req)
  })
  router.post('/v1/user/api_keys', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(ApiKeyController)
    return await controller.handleCreateApiKey(ctx, req)
  })
  router.post('/v1/user/roll', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(ApiKeyController)
    return await controller.handleRollApiKey(ctx, req)
  })
  router.get('/v1/user/api_keys', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(ApiKeyController)
    return await controller.handleListApiKeys(ctx, req)
  })
  router.post('/events', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(EventsController)
    return await controller.handleEvents(ctx, req)
  })
  router.get('/m', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(MetricsController)
    return await controller.handleHeartbeatRequest(ctx, req)
  })
  router.post('/m/dashboard', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(MetricsController)
    return await controller.handleDashboardAuth(ctx, req)
  })
  router.post('/m/dashboard/metrics_overall', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(MetricsController)
    return await controller.handleOverallMetrics(ctx, req)
  })
  router.post('/m/dashboard/metrics_platform', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(MetricsController)
    return await controller.handleMetricsByPlatform(ctx, req)
  })
  router.post('/m/dashboard/metrics_daily', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(MetricsController)
    return await controller.handleDailyMetrics(ctx, req)
  })
  router.post('/m/dashboard/visit_overview', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(MetricsController)
    return await controller.handleVisitOverview(ctx, req)
  })
  router.post('/m/dashboard/top_articles', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(MetricsController)
    return await controller.handleTopArticles(ctx, req)
  })
  router.post('/m/dashboard/bookmark_steps', async (req: Request, ctx: ContextManager) => {
    const controller = container.resolve(MetricsController)
    return await controller.handleBookmarkSteps(ctx, req)
  })

  router.get('/ping', () => Successed('pong'))
  router.all('*', () => NotFound('Resource not found'))

  return router
}
