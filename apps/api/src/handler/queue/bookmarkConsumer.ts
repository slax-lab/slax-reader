import { ContextManager } from '@/utils/context'
import { Consumer } from '../../decorators/queue'
import { inject, injectable } from '../../decorators/di'
import { UrlParserHandler } from '../../domain/orchestrator/urlParser'
import { ImportOrchestrator } from '../../domain/orchestrator/import'
import { receiveThirdPartyMessage } from '../../domain/orchestrator/urlParser'
import { importBookmarkMessage } from '../../infra/queue/queueClient'

@injectable()
export class BookmarkConsumer {
  constructor(
    @inject(UrlParserHandler) private urlParserHandler: UrlParserHandler,
    @inject(ImportOrchestrator) private importOrchestrator: ImportOrchestrator
  ) {}
  /**
   * 解析第三方平台URL
   */
  @Consumer({ channel: 'slax-reader-parser-twitter', batch: true })
  @Consumer({ channel: 'slax-reader-parser-twitter-beta', batch: true })
  public async handleParseThirdPartyURL(ctx: ContextManager, info: receiveThirdPartyMessage[]) {
    await this.urlParserHandler.processThirdPartyMessages(ctx, info)
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
