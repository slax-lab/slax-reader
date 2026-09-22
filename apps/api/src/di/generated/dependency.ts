import { container, Container } from '../../decorators/di'
import { lazy } from '../../decorators/lazy'
import { ContextManager } from '@/utils/context'
import {
  PRISIMA_CLIENT,
  PRISIMA_FULLTEXT_CLIENT,
  VECTORIZE_CLIENTS,
  DATABASE_REGISTRY,
  CLIENT_REGISTRY,
  BUCKET_REGISTRY,
  MIDDLEWARES,
  CONTROLLERS,
  ROUTER,
  GEMINI_AGENT,
  GEMINI_BATCH_PROVIDER,
  PRISIMA_HYPERDRIVE_CLIENT,
  PRISMA_LOGS_CLIENT
} from '../../const/symbol'
import { BookmarkRepo } from '../../infra/repository/dbBookmark'
import { GeminiBatchProvider } from '../../infra/external/batchCompletion'
import { ApiKeyRepo } from '../../infra/repository/dbApiKey'
import { SubscriptionRepo } from '../../infra/repository/dbSubscription'
import { BookmarkSearchRepo } from '../../infra/repository/dbBookmarkSearch'
import { VectorizeRepo } from '../../infra/repository/dbVectorize'
import { MarkRepo } from '../../infra/repository/dbMark'
import { UserRepo } from '../../infra/repository/dbUser'
import { NotificationMessage } from '../../infra/message/notification'
import { CrawlService } from '../../domain/crawl'
import { LabService } from '../../domain/lab'
import { SearchService } from '../../domain/search'
import { CollectionRepo } from '../../infra/repository/dbCollection'
import { LogsService } from '../../domain/logs'
import { SlaxAlertBotClient } from '../../infra/external/slaxAlertBot'
import { YoutubeArticleRepo } from '../../infra/repository/dbYoutubeArticle'
import { LogsRepo } from '../../infra/repository/dbLogs'
import { BookmarkService } from '../../domain/bookmark'
import { LabRepo } from '../../infra/repository/dbLab'
import { GA4AnalyticsClient } from '../../infra/external/ga4Analytics'
import { ReportRepo } from '../../infra/repository/dbReport'
import { AigcService } from '../../domain/aigc'
import { TagService } from '../../domain/tag'
import { MarkService } from '../../domain/mark'
import { CollectionService } from '../../domain/collection'
import { NotificationService } from '../../domain/notification'
import { UserService } from '../../domain/user'
import { ImportService } from '../../domain/import'
import { ShareService } from '../../domain/share'
import { SubscriptionServiceMain } from '../../domain/subscriptionMain'
import { SubscriptionService } from '../../domain/subscription'
import { SubscriptionPaymentService } from '../../domain/subscriptionPayment'
import { SubscriptionTelemetryService } from '../../domain/subscriptionTelemetry'
import { DBSyncBatchOperation } from '../../infra/repository/dbSyncBatch'
import { QueueClient } from '../../infra/queue/queueClient'
import { TelegramBotService } from '../../domain/telegram'
import { MonitoringOrchestrator } from '../../domain/orchestrator/monitor'
import { AigcBatchOrchestrator } from '../../domain/orchestrator/aigc'
import { SubscriptionOrchestrator } from '../../domain/orchestrator/subscription'
import { SubscriptionAppleService } from '../../domain/subscriptionApple'
import { UserDeletionService } from '../../domain/userDeletion'
import { ApiKeyService } from '../../domain/apiKey'
import { BookmarkOrchestrator } from '../../domain/orchestrator/bookmark'
import { BookmarkAddOrchestrator } from '../../domain/orchestrator/bookmarkAdd'
import { UrlParserHandler } from '../../domain/orchestrator/urlParser'
import { CollectionOrchestrator } from '../../domain/orchestrator/collection'
import { MarkOrchestrator } from '../../domain/orchestrator/mark'
import { DashboardService } from '../../domain/dashboard'
import { ShareOrchestrator } from '../../domain/orchestrator/share'
import { SyncOrchestrator } from '../../domain/orchestrator/sync'
import { ImportOrchestrator } from '../../domain/orchestrator/import'
import { EmailService } from '../../domain/email'
import { ContentOrchestrator } from '../../domain/orchestrator/content'
import { BookmarkJob } from '../../handler/cron/bookmarkJob'
import { CollectionJob } from '../../handler/cron/collectionJob'
import { SubscriptionJob } from '../../handler/cron/subscriptionJob'
import { UserDeletionJob } from '../../handler/cron/userDeletionJob'
import { BookmarkConsumer } from '../../handler/queue/bookmarkConsumer'
import { SubscriptionConsumer } from '../../handler/queue/subscriptionConsumer'
import { UserDeletionConsumer } from '../../handler/queue/userDeletionConsumer'
import { StripeClient } from '../../infra/external/stripe'
import { BucketClient } from '../../infra/repository/bucketClient'
import { KVClient } from '../../infra/repository/KVClient'
import { RedisClient } from '../../infra/repository/redisClient'
import { AigcController } from '../../handler/http/aigcController'
import { ApiKeyController } from '../../handler/http/apiKeyController'
import { BookmarkController } from '../../handler/http/bookmarkController'
import { CallbackController } from '../../handler/http/callbackController'
import { CollectionController } from '../../handler/http/collectionController'
import { EventsController } from '../../handler/http/eventsController'
import { ImageController } from '../../handler/http/imageController'
import { MarkController } from '../../handler/http/markController'
import { McpServerController } from '../../handler/http/mcpController'
import { MetricsController } from '../../handler/http/metricsController'
import { PromotionController } from '../../handler/http/promotionController'
import { ShareController } from '../../handler/http/shareController'
import { SubscriptionController } from '../../handler/http/subscriptionController'
import { SyncController } from '../../handler/http/syncController'
import { TagController } from '../../handler/http/tagController'
import { UserController } from '../../handler/http/userController'
import { DatabaseRegistry } from '../data'

container.register(AigcService, {
  useFactory: container =>
    new AigcService(
      lazy(() => container.resolve(GEMINI_AGENT)),
      lazy(() => container.resolve(BucketClient)),
      container.resolve(BookmarkRepo),
      container.resolve(GEMINI_BATCH_PROVIDER)
    )
})

container.register(ApiKeyService, {
  useFactory: container => new ApiKeyService(container.resolve(ApiKeyRepo), container.resolve(SubscriptionRepo))
})

container.register(BookmarkService, {
  useFactory: container =>
    new BookmarkService(
      container.resolve(BookmarkRepo),
      lazy(() => container.resolve(BucketClient)),
      container.resolve(BookmarkSearchRepo),
      container.resolve(VectorizeRepo),
      container.resolve(MarkRepo),
      container.resolve(UserRepo),
      lazy(() => container.resolve(QueueClient)),
      container.resolve(NotificationMessage),
      container.resolve(CrawlService),
      container.resolve(LabService),
      container.resolve(SearchService)
    )
})

container.register(CollectionService, {
  useFactory: container => new CollectionService(container.resolve(CollectionRepo), container.resolve(UserRepo), container.resolve(BookmarkRepo))
})

container.register(CrawlService, {
  useFactory: container =>
    new CrawlService(
      lazy(() => container.resolve(BucketClient)),
      container.resolve(BookmarkRepo),
      container.resolve(LogsService),
      container.resolve(SlaxAlertBotClient),
      container.resolve(YoutubeArticleRepo)
    )
})

container.register(DashboardService, {
  useFactory: container => new DashboardService(container.resolve(LogsRepo), container.resolve(BookmarkRepo))
})

container.register(EmailService, {
  useFactory: container => new EmailService(container.resolve(UserRepo))
})

container.register(ImportService, {
  useFactory: container =>
    new ImportService(
      container.resolve(BookmarkRepo),
      lazy(() => container.resolve(QueueClient)),
      lazy(() => container.resolve(KVClient)),
      lazy(() => container.resolve(BucketClient)),
      container.resolve(BookmarkService),
      lazy(() => container.resolve(RedisClient))
    )
})

container.register(LabService, {
  useFactory: container => new LabService(container.resolve(LabRepo))
})

container.register(LogsService, {
  useFactory: container => new LogsService(container.resolve(LogsRepo))
})

container.register(MarkService, {
  useFactory: container => new MarkService(container.resolve(BookmarkRepo), container.resolve(MarkRepo), container.resolve(CollectionRepo), container.resolve(UserRepo))
})

container.register(NotificationService, {
  useFactory: container =>
    new NotificationService(container.resolve(UserRepo), container.resolve(BookmarkRepo), container.resolve(CollectionRepo), container.resolve(NotificationMessage))
})

container.register(SearchService, {
  useFactory: container =>
    new SearchService(container.resolve(BookmarkRepo), container.resolve(SubscriptionRepo), container.resolve(BookmarkSearchRepo), container.resolve(VectorizeRepo))
})

container.register(ShareService, {
  useFactory: container => new ShareService(container.resolve(BookmarkRepo), container.resolve(UserRepo))
})

container.register(SubscriptionService, {
  useFactory: container =>
    new SubscriptionService(
      lazy(() => container.resolve(StripeClient)),
      container.resolve(SubscriptionRepo),
      lazy(() => container.resolve(QueueClient))
    )
})

container.register(SubscriptionAppleService, {
  useFactory: container =>
    new SubscriptionAppleService(
      container.resolve(UserRepo),
      container.resolve(SubscriptionRepo),
      container.resolve(SlaxAlertBotClient),
      container.resolve(GA4AnalyticsClient),
      container.resolve(LogsService)
    )
})

container.register(SubscriptionServiceMain, {
  useFactory: container =>
    new SubscriptionServiceMain(
      lazy(() => container.resolve(StripeClient)),
      lazy(() => container.resolve(KVClient)),
      container.resolve(UserRepo),
      container.resolve(SubscriptionRepo),
      container.resolve(SlaxAlertBotClient),
      container.resolve(GA4AnalyticsClient),
      container.resolve(LogsService)
    )
})

container.register(SubscriptionPaymentService, {
  useFactory: container =>
    new SubscriptionPaymentService(
      lazy(() => container.resolve(StripeClient)),
      container.resolve(SubscriptionRepo)
    )
})

container.register(SubscriptionTelemetryService, {
  useFactory: container => new SubscriptionTelemetryService(container.resolve(LogsService), container.resolve(SubscriptionRepo), container.resolve(GA4AnalyticsClient))
})

container.register(TagService, {
  useFactory: container => new TagService(container.resolve(BookmarkRepo))
})

container.register(TelegramBotService, {
  useFactory: container => new TelegramBotService(container.resolve(UserRepo), container.resolve(BookmarkRepo))
})

container.register(UserService, {
  useFactory: container =>
    new UserService(
      container.resolve(UserRepo),
      lazy(() => container.resolve(BucketClient)),
      container.resolve(ReportRepo),
      container.resolve(SubscriptionRepo),
      container.resolve(CollectionRepo),
      container.resolve(BookmarkRepo),
      lazy(() => container.resolve(RedisClient)),
      container.resolve(GA4AnalyticsClient),
      container.resolve(LogsService),
      container.resolve(LabService)
    )
})

container.register(UserDeletionService, {
  useFactory: container =>
    new UserDeletionService(
      lazy(() => container.resolve(PRISIMA_HYPERDRIVE_CLIENT)),
      container.resolve(UserRepo)
    )
})

container.register(AigcBatchOrchestrator, {
  useFactory: container => new AigcBatchOrchestrator(container.resolve(AigcService), container.resolve(BookmarkService), container.resolve(TagService))
})

container.register(BookmarkOrchestrator, {
  useFactory: container =>
    new BookmarkOrchestrator(
      container.resolve(BookmarkService),
      container.resolve(TagService),
      container.resolve(MarkService),
      container.resolve(CollectionService),
      container.resolve(NotificationService),
      container.resolve(AigcService),
      container.resolve(UserService),
      lazy(() => container.resolve(BucketClient))
    )
})

container.register(BookmarkAddOrchestrator, {
  useFactory: container => new BookmarkAddOrchestrator(container.resolve(BookmarkService), container.resolve(CrawlService))
})

container.register(CollectionOrchestrator, {
  useFactory: container =>
    new CollectionOrchestrator(
      container.resolve(CollectionService),
      container.resolve(BookmarkService),
      container.resolve(MarkService),
      container.resolve(TagService),
      container.resolve(UserService),
      container.resolve(NotificationService),
      container.resolve(CollectionRepo),
      container.resolve(UserRepo),
      container.resolve(LogsService)
    )
})

container.register(ContentOrchestrator, {
  useFactory: container =>
    new ContentOrchestrator(
      container.resolve(BookmarkService),
      container.resolve(UserService),
      container.resolve(TagService),
      container.resolve(MarkService),
      container.resolve(CollectionService)
    )
})

container.register(ImportOrchestrator, {
  useFactory: container =>
    new ImportOrchestrator(
      container.resolve(ImportService),
      lazy(() => container.resolve(KVClient)),
      container.resolve(BookmarkService),
      container.resolve(CrawlService)
    )
})

container.register(MarkOrchestrator, {
  useFactory: container => new MarkOrchestrator(container.resolve(MarkService), container.resolve(NotificationService))
})

container.register(MonitoringOrchestrator, {
  useFactory: container =>
    new MonitoringOrchestrator(container.resolve(UserRepo), container.resolve(CrawlService), container.resolve(BookmarkService), container.resolve(BookmarkRepo))
})

container.register(ShareOrchestrator, {
  useFactory: container =>
    new ShareOrchestrator(
      container.resolve(ShareService),
      container.resolve(UserService),
      container.resolve(TagService),
      container.resolve(MarkService),
      container.resolve(BookmarkService)
    )
})

container.register(SubscriptionOrchestrator, {
  useFactory: container =>
    new SubscriptionOrchestrator(
      container.resolve(SubscriptionServiceMain),
      container.resolve(SubscriptionService),
      container.resolve(SubscriptionRepo),
      container.resolve(SubscriptionPaymentService),
      container.resolve(SubscriptionTelemetryService)
    )
})

container.register(SyncOrchestrator, {
  useFactory: container =>
    new SyncOrchestrator(
      container.resolve(UserService),
      container.resolve(DBSyncBatchOperation),
      container.resolve(QueueClient),
      container.resolve(SearchService),
      container.resolve(CrawlService),
      container.resolve(GA4AnalyticsClient),
      container.resolve(LogsService),
      container.resolve(CollectionRepo),
      container.resolve(BookmarkSearchRepo),
      container.resolve(BookmarkRepo),
      container.resolve(LabService)
    )
})

container.register(UrlParserHandler, {
  useFactory: container =>
    new UrlParserHandler(
      container.resolve(BookmarkService),
      lazy(() => container.resolve(BucketClient)),
      container.resolve(AigcService),
      container.resolve(TelegramBotService),
      container.resolve(SearchService),
      lazy(() => container.resolve(QueueClient)),
      container.resolve(TagService),
      container.resolve(UserService),
      container.resolve(CrawlService),
      container.resolve(LogsService)
    )
})

container.register(BookmarkJob, {
  useFactory: container =>
    new BookmarkJob(container.resolve(MonitoringOrchestrator), container.resolve(BookmarkService), container.resolve(ImportService), container.resolve(AigcBatchOrchestrator))
})

container.register(CollectionJob, {
  useFactory: container => new CollectionJob(container.resolve(CollectionService))
})

container.register(SubscriptionJob, {
  useFactory: container => new SubscriptionJob(container.resolve(SubscriptionOrchestrator), container.resolve(SubscriptionAppleService), container.resolve(SubscriptionRepo))
})

container.register(UserDeletionJob, {
  useFactory: container =>
    new UserDeletionJob(
      lazy(() => container.resolve(PRISIMA_HYPERDRIVE_CLIENT)),
      container.resolve(UserDeletionService)
    )
})

container.register(BookmarkConsumer, {
  useFactory: container => new BookmarkConsumer(container.resolve(UrlParserHandler), container.resolve(ImportOrchestrator))
})

container.register(SubscriptionConsumer, {
  useFactory: container => new SubscriptionConsumer(container.resolve(SubscriptionOrchestrator))
})

container.register(UserDeletionConsumer, {
  useFactory: container => new UserDeletionConsumer(container.resolve(UserDeletionService))
})

container.register(GA4AnalyticsClient, {
  useClass: GA4AnalyticsClient
})

container.register(SlaxAlertBotClient, {
  useClass: SlaxAlertBotClient
})

container.register(StripeClient, {
  useClass: StripeClient
})

container.register(NotificationMessage, {
  useFactory: container => new NotificationMessage(container.resolve(UserRepo))
})

container.register(QueueClient, {
  useClass: QueueClient
})

container.register(BucketClient, {
  useClass: BucketClient
})

container.register(ApiKeyRepo, {
  useFactory: container => new ApiKeyRepo(lazy(() => container.resolve(PRISIMA_HYPERDRIVE_CLIENT)))
})

container.register(BookmarkRepo, {
  useFactory: container =>
    new BookmarkRepo(
      lazy(() => container.resolve(PRISIMA_CLIENT)),
      lazy(() => container.resolve(PRISIMA_HYPERDRIVE_CLIENT))
    )
})

container.register(BookmarkSearchRepo, {
  useFactory: container => new BookmarkSearchRepo(lazy(() => container.resolve(PRISIMA_FULLTEXT_CLIENT)))
})

container.register(CollectionRepo, {
  useFactory: container => new CollectionRepo(lazy(() => container.resolve(PRISIMA_HYPERDRIVE_CLIENT)))
})

container.register(LabRepo, {
  useFactory: container => new LabRepo(lazy(() => container.resolve(PRISIMA_HYPERDRIVE_CLIENT)))
})

container.register(LogsRepo, {
  useFactory: container => new LogsRepo(lazy(() => container.resolve(PRISMA_LOGS_CLIENT)))
})

container.register(MarkRepo, {
  useFactory: container =>
    new MarkRepo(
      lazy(() => container.resolve(PRISIMA_CLIENT)),
      lazy(() => container.resolve(PRISIMA_HYPERDRIVE_CLIENT))
    )
})

container.register(ReportRepo, {
  useFactory: container =>
    new ReportRepo(
      lazy(() => container.resolve(PRISIMA_CLIENT)),
      lazy(() => container.resolve(PRISIMA_HYPERDRIVE_CLIENT))
    )
})

container.register(SubscriptionRepo, {
  useFactory: container => new SubscriptionRepo(lazy(() => container.resolve(PRISIMA_HYPERDRIVE_CLIENT)))
})

container.register(DBSyncBatchOperation, {
  useFactory: container => new DBSyncBatchOperation(lazy(() => container.resolve(PRISIMA_HYPERDRIVE_CLIENT)))
})

container.register(UserRepo, {
  useFactory: container =>
    new UserRepo(
      lazy(() => container.resolve(PRISIMA_CLIENT)),
      lazy(() => container.resolve(PRISIMA_HYPERDRIVE_CLIENT))
    )
})

container.register(VectorizeRepo, {
  useFactory: container => new VectorizeRepo(lazy(() => container.resolve(VECTORIZE_CLIENTS)))
})

container.register(YoutubeArticleRepo, {
  useFactory: container => new YoutubeArticleRepo(lazy(() => container.resolve(PRISIMA_HYPERDRIVE_CLIENT)))
})

container.register(KVClient, {
  useClass: KVClient
})

container.register(RedisClient, {
  useClass: RedisClient
})

container.register(AigcController, {
  useFactory: container => new AigcController(container.resolve(AigcService), container.resolve(UserService), container.resolve(BookmarkService), container.resolve(LogsService))
})

container.register(ApiKeyController, {
  useFactory: container => new ApiKeyController(container.resolve(ApiKeyService))
})

container.register(BookmarkController, {
  useFactory: container =>
    new BookmarkController(
      container.resolve(BookmarkService),
      container.resolve(CollectionService),
      container.resolve(BookmarkOrchestrator),
      container.resolve(BookmarkAddOrchestrator),
      container.resolve(ImportService),
      container.resolve(SearchService),
      container.resolve(TagService),
      container.resolve(UrlParserHandler),
      container.resolve(UserDeletionService),
      container.resolve(CrawlService),
      container.resolve(LogsService)
    )
})

container.register(CallbackController, {
  useFactory: container =>
    new CallbackController(
      container.resolve(TelegramBotService),
      container.resolve(BookmarkService),
      container.resolve(SubscriptionService),
      container.resolve(SubscriptionAppleService),
      container.resolve(SubscriptionOrchestrator),
      container.resolve(CrawlService),
      container.resolve(UserService),
      container.resolve(GA4AnalyticsClient),
      container.resolve(LogsService)
    )
})

container.register(CollectionController, {
  useFactory: container => new CollectionController(container.resolve(CollectionService), container.resolve(CollectionOrchestrator))
})

container.register(EventsController, {
  useFactory: () => new EventsController()
})

container.register(ImageController, {
  useFactory: () => new ImageController()
})

container.register(MarkController, {
  useFactory: container => new MarkController(container.resolve(MarkService), container.resolve(MarkOrchestrator))
})

container.register(McpServerController, {
  useFactory: () => new McpServerController()
})

container.register(MetricsController, {
  useFactory: container => new MetricsController(container.resolve(DashboardService), container.resolve(LogsService))
})

container.register(PromotionController, {
  useFactory: container => new PromotionController(container.resolve(SubscriptionServiceMain))
})

container.register(ShareController, {
  useFactory: container => new ShareController(container.resolve(ShareService), container.resolve(ShareOrchestrator))
})

container.register(SubscriptionController, {
  useFactory: container =>
    new SubscriptionController(
      container.resolve(SubscriptionServiceMain),
      container.resolve(SubscriptionOrchestrator),
      container.resolve(NotificationService),
      container.resolve(SubscriptionAppleService)
    )
})

container.register(SyncController, {
  useFactory: container => new SyncController(container.resolve(SyncOrchestrator), container.resolve(UserDeletionService))
})

container.register(TagController, {
  useFactory: container => new TagController(container.resolve(TagService))
})

container.register(UserController, {
  useFactory: container =>
    new UserController(
      container.resolve(UserService),
      container.resolve(BookmarkService),
      container.resolve(NotificationService),
      container.resolve(BookmarkOrchestrator),
      container.resolve(QueueClient),
      container.resolve(UserDeletionService),
      container.resolve(LabService)
    )
})

container.register(DatabaseRegistry, {
  useFactory: container => new DatabaseRegistry()
})

export function initializeInfrastructure(ctx: ContextManager, targetContainer: Container) {
  container.resolve(DatabaseRegistry).register(ctx, targetContainer)
}

export function initializeCore() {
  return {
    container
  }
}
