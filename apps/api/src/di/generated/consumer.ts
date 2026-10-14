import { queueChannel } from '../../utils/queueChannel'
import { Container } from '../../decorators/di'
import { ContextManager } from '@/utils/context'
import { BookmarkConsumer } from '../../handler/queue/bookmarkConsumer'
import { SubscriptionConsumer } from '../../handler/queue/subscriptionConsumer'
import { UserDeletionConsumer } from '../../handler/queue/userDeletionConsumer'

const handleMessages = async (exec: ExecutionContext, env: Env, messages: readonly Message[], processFunction: (ctx: ContextManager, body: any) => Promise<void>) => {
  for (const item of messages) {
    const param = { id: item.id, info: item.body }
    const ctx = new ContextManager(exec, env)
    await processFunction(ctx, param)
    item.ack()
  }
}

const handleBatchMessages = async (exec: ExecutionContext, env: Env, messages: readonly Message[], processFunction: (ctx: ContextManager, body: any) => Promise<void>) => {
  const processParams = []
  for (const item of messages) {
    const param = { id: item.id, info: item.body }
    processParams.push(param)
  }
  await processFunction(new ContextManager(exec, env), processParams)
  for (const item of messages) {
    item.ack()
  }
}

export const handleMessage = async (container: Container, batch: MessageBatch, env: Env, exec: ExecutionContext) => {
  switch (queueChannel(batch.queue, env.API_QUEUE_CHANNELS)) {
    case 'slax-reader-parser-twitter': {
      const consumer = container.resolve(BookmarkConsumer)
      await handleBatchMessages(exec, env, batch.messages, consumer.handleParseThirdPartyURL.bind(consumer))
      break
    }
    case 'slax-reader-parser-twitter-beta': {
      const consumer = container.resolve(BookmarkConsumer)
      await handleBatchMessages(exec, env, batch.messages, consumer.handleParseThirdPartyURL.bind(consumer))
      break
    }
    case 'slax-reader-import-other': {
      const consumer = container.resolve(BookmarkConsumer)
      await handleMessages(exec, env, batch.messages, consumer.handleImportOther.bind(consumer))
      break
    }
    case 'slax-reader-migrate-from-other': {
      const consumer = container.resolve(BookmarkConsumer)
      await handleMessages(exec, env, batch.messages, consumer.handleImportOther.bind(consumer))
      break
    }
    case 'slax-reader-migrate-from-other-beta': {
      const consumer = container.resolve(BookmarkConsumer)
      await handleMessages(exec, env, batch.messages, consumer.handleImportOther.bind(consumer))
      break
    }
    case 'slax-reader-parser-fetch-retry-prod': {
      const consumer = container.resolve(BookmarkConsumer)
      await handleMessages(exec, env, batch.messages, consumer.handleImportOther.bind(consumer))
      break
    }
    case 'slax-reader-import-other-slow': {
      const consumer = container.resolve(BookmarkConsumer)
      await handleMessages(exec, env, batch.messages, consumer.handleImportOtherSlow.bind(consumer))
      break
    }
    case 'slax-reader-import-other-dql': {
      const consumer = container.resolve(BookmarkConsumer)
      await handleMessages(exec, env, batch.messages, consumer.handleImportOtherDQL.bind(consumer))
      break
    }
    case 'slax-reader-parser-stripe': {
      const consumer = container.resolve(SubscriptionConsumer)
      await handleMessages(exec, env, batch.messages, consumer.handleStripeEvent.bind(consumer))
      break
    }
    case 'slax-reader-parser-stripe-beta': {
      const consumer = container.resolve(SubscriptionConsumer)
      await handleMessages(exec, env, batch.messages, consumer.handleStripeEvent.bind(consumer))
      break
    }
    case 'slax-reader-user-deletion': {
      const consumer = container.resolve(UserDeletionConsumer)
      await handleMessages(exec, env, batch.messages, consumer.handleUserDeletion.bind(consumer))
      break
    }
    case 'slax-reader-user-deletion-beta': {
      const consumer = container.resolve(UserDeletionConsumer)
      await handleMessages(exec, env, batch.messages, consumer.handleUserDeletion.bind(consumer))
      break
    }
    default:
      throw new Error(`Unknown queue: ${batch.queue}`)
  }

  console.log(`handle ${batch.queue} ${batch.messages.length} messages`)
}
