import { Hashid } from '@/utils/hashids'
import { ContextManager } from '@/utils/context'
import { Consumer } from '../../decorators/queue'
import { inject, injectable } from '../../decorators/di'
import { CrawlService } from '../../domain/crawl'
import { ImportOrchestrator } from '../../domain/orchestrator/import'
import { receiveThirdPartyMessage } from '../../domain/orchestrator/urlParser'
import { importBookmarkMessage } from '../../infra/queue/queueClient'

@injectable()
export class BookmarkConsumer {
  constructor(
    @inject(CrawlService) private crawlService: CrawlService,
    @inject(ImportOrchestrator) private importOrchestrator: ImportOrchestrator
  ) {}
  /**
   * 解析第三方平台URL
   */
  @Consumer({ channel: 'slax-reader-parser-twitter', batch: true })
  @Consumer({ channel: 'slax-reader-parser-twitter-beta', batch: true })
  public async handleParseThirdPartyURL(ctx: ContextManager, info: receiveThirdPartyMessage[]) {
    // Failed deliveries use the queue's configured retry policy, never a success ack.
    const retryIds: string[] = []
    for (const { id, info: message } of info) {
      const messageCtx = new ContextManager(ctx.execution, ctx.env)
      const enUserId = new Hashid(ctx.env).encodeId(message.userId)
      messageCtx.setHashIds(new Hashid(ctx.env, message.userId))
      messageCtx.setUserInfo(message.userId, enUserId, '', 'en')
      try {
        await this.crawlService.createWorkflow(
          ctx.env,
          {
            url: message.targetUrl,
            bookmarkId: message.bookmarkId,
            userId: message.userId,
            enUserId,
            userLang: messageCtx.getlang(),
            captureRevision: message.captureRevision,
            callbackChatId: message.callback === 1 ? message.callbackPayload?.chat_id : undefined,
            callbackOriginMessageId: message.callback === 1 ? message.callbackPayload?.origin_message_id : undefined,
            ignoreGenerateTag: message.ignoreGenerateTag
          },
          3,
          messageCtx
        )
      } catch (error) {
        console.error('Legacy capture dispatch failed', { messageId: id, bookmarkId: message.bookmarkId, error })
        retryIds.push(String(id))
      }
    }
    return retryIds
  }

  /**
   * 导入其他平台书签
   */
  @Consumer({ channel: 'slax-reader-import-other' })
  @Consumer({ channel: 'slax-reader-migrate-from-other' })
  @Consumer({ channel: 'slax-reader-migrate-from-other-beta' })
  @Consumer({ channel: 'slax-reader-parser-fetch-retry-prod' })
  public async handleImportOther(ctx: ContextManager, info: { id: number; info: importBookmarkMessage }) {
    await this.importOrchestrator.processImportBookmark(ctx, info)
  }

  /**
   * 导入其他平台书签（慢队列）
   */
  @Consumer({ channel: 'slax-reader-import-other-slow' })
  public async handleImportOtherSlow(ctx: ContextManager, info: { id: number; info: importBookmarkMessage }) {
    await this.importOrchestrator.processImportBookmarkSlow(ctx, info)
  }

  @Consumer({ channel: 'slax-reader-import-other-dql' })
  public async handleImportOtherDQL(ctx: ContextManager, info: { id: number; info: importBookmarkMessage }) {
    console.log(`handleImportOtherDQL ${info.id} ${JSON.stringify(info.info)}`)
  }
}
