import { injectable, container } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { parserType } from '@/utils/urlPolicie'
import type { EventRequestContext } from '@/utils/eventContext'

export interface parseMessage {
  targetUrl: string
  resource: string
  parserType: parserType
  bookmarkId: number
  callback?: callbackType
  ignoreGenerateTag: boolean
  callbackPayload?: any
  targetTitle?: string
}

export interface importBookmarkMessage {
  eventContext?: EventRequestContext
  type: string
  id: number
  data: any[]
  userId: number
}

export interface queueParseMessage extends parseMessage {
  userId: number
  privateUser: number
  skipParse: boolean
}

export interface queueRetryParseMessage extends parseMessage {
  retry: {
    retryCount: number
    userIds: number[]
  }
}

@injectable()
export class QueueClient {
  constructor(private env: Env) {}

  async pushStripeEvent(eventId: number): Promise<void> {
    if (!eventId) return
    await this.env.STRIPE_QUEUE.send({ eventId })
  }

  async pushParseThirdPartyMessage(ctx: ContextManager, taskInfo: queueThirdPartyMessage): Promise<void> {
    if (!taskInfo) return

    await this.env.TWITTER_PARSER.send(taskInfo)
  }

  async pushImportMessage(ctx: ContextManager, taskInfo: importBookmarkMessage): Promise<void> {
    if (!taskInfo) return

    await this.env.IMPORT_OTHER.send(taskInfo)
  }

  async pushRetryMessage(ctx: ContextManager, taskInfo: queueRetryParseMessage): Promise<void> {
    if (!taskInfo) return

    await this.env.FETCH_RETRY_PARSER.send(taskInfo)
  }
}

export enum callbackType {
  NOT_CALLBACK = 0,
  CALLBACK_TELEGRAM = 1,
  CALLBACK_EMAIL = 2
}
export interface parseMessage {
  targetUrl: string
  resource: string
  parserType: parserType
  bookmarkId: number
  callback?: callbackType
  ignoreGenerateTag: boolean
  callbackPayload?: any
  targetTitle?: string
  skipParsing?: boolean
  // Set when the parse belongs to an import task; post-processing keeps the imported save time.
  importTaskId?: number
}

export interface importBookmarkMessage {
  eventContext?: EventRequestContext
  version?: 1
  type: string
  id: number
  data: any[]
  userId: number
  idx: number
  callback?: callbackType
  callbackPayload?: any
}

export interface queueParseMessage extends parseMessage {
  userId: number
  privateUser: number
}

export interface queueThirdPartyMessage extends parseMessage {
  userId: number
}

export interface receiveParseMessage<T extends parseMessage> {
  id: string
  info: T
}

export interface queueAffiliateMessage {
  invitedUserId: number
  affCode: string
}

export interface queueReplaceMessage {
  bookmarkId: number
}

export interface userDeletionMessage {
  userId: number
}
