import { Container } from '../../decorators/di'
import { ContextManager } from '@/utils/context'
import { BookmarkJob } from '../../handler/cron/bookmarkJob'
import { CollectionJob } from '../../handler/cron/collectionJob'
import { SubscriptionJob } from '../../handler/cron/subscriptionJob'
import { UserDeletionJob } from '../../handler/cron/userDeletionJob'

export const handleCronjob = async (container: Container, event: any, env: Env, exec: ExecutionContext) => {
  const clearExpiredTrashedBookmark = async () => {
    const controller = container.resolve(BookmarkJob)
    exec.waitUntil(controller.clearExpiredTrashedBookmark(new ContextManager(exec, env)))
  }
  const checkImportProgress = async () => {
    const controller = container.resolve(BookmarkJob)
    exec.waitUntil(controller.checkImportProgress(new ContextManager(exec, env)))
  }
  const monitorTwitterBookmarks = async () => {
    const controller = container.resolve(BookmarkJob)
    exec.waitUntil(controller.monitorTwitterBookmarks(new ContextManager(exec, env)))
  }
  const detectStuckAndRetry = async () => {
    const controller = container.resolve(BookmarkJob)
    exec.waitUntil(controller.detectStuckAndRetry(new ContextManager(exec, env)))
  }
  const recomputeCollectionSubscriberActive = async () => {
    const controller = container.resolve(CollectionJob)
    exec.waitUntil(controller.recomputeCollectionSubscriberActive(new ContextManager(exec, env)))
  }
  const recoverPayments = async () => {
    const controller = container.resolve(SubscriptionJob)
    exec.waitUntil(controller.recoverPayments(new ContextManager(exec, env)))
  }
  const recoverDeletedUsers = async () => {
    const controller = container.resolve(UserDeletionJob)
    exec.waitUntil(controller.recoverDeletedUsers(new ContextManager(exec, env)))
  }

  const cronTasks: Array<[string, () => Promise<void>]> = [
    ['0 */1 * * *', clearExpiredTrashedBookmark],
    ['*/5 * * * *', checkImportProgress],
    ['*/2 * * * *', monitorTwitterBookmarks],
    ['*/1 * * * *', detectStuckAndRetry],
    ['*/30 * * * *', recomputeCollectionSubscriberActive],
    ['*/5 * * * *', recoverPayments],
    ['*/5 * * * *', recoverDeletedUsers]
  ]

  const matching = cronTasks.filter(([expression]) => expression === event.cron)
  if (matching.length === 0) {
    console.log(`${event.scheduledTime} cron ${event.cron} not found`)
    return
  }
  for (const [, handler] of matching) exec.waitUntil(Promise.resolve().then(handler))
}
