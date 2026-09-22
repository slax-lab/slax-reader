import { container } from '@/decorators/di'
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { initializeInfrastructure, initializeCore } from '@/di/generated/dependency'
import { ContextManager } from '@/utils/context'
import { CrawlService, CrawlResult } from '@/domain/crawl'
import { UrlParserHandler } from '@/domain/orchestrator/urlParser'
import { BookmarkService } from '@/domain/bookmark'
import { ImportService } from '@/domain/import'
import { Hashid } from '@/utils/hashids'
import { queueStatus } from '@/infra/repository/dbBookmark'
import { parserType } from '@/utils/urlPolicie'
import { SlaxFetch } from '@/infra/external/remoteFetcher'
import { EVENT_CONTEXT_KEY, type EventRequestContext } from '@/domain/events'
import { publicTarget } from '@/utils/publicTargetPolicy'
import type { fetchResult } from '@/utils/browser'
import { parseHTML } from 'linkedom'

const hasImportContent = (result: fetchResult): boolean => {
  const { document } = parseHTML(result.content)
  document.querySelectorAll('script,style,noscript,template,nav,header,footer,aside,[hidden],[aria-hidden="true"]').forEach(node => node.remove())
  const text = (document.body?.textContent || '').replace(/\s+/g, ' ').trim()
  return !!text && !/^(?:please )?(?:enable javascript|turn on javascript|checking your browser|just a moment|access denied|loading)(?:[\s.!…]*)$/i.test(text)
}

export const fetchImportContent = async (env: Env, input: string): Promise<fetchResult> => {
  const url = publicTarget(input).href
  const fetcher = new SlaxFetch(env)
  const accept = (result: fetchResult) => {
    publicTarget(result.url)
    if (!hasImportContent(result)) throw new Error('Empty or placeholder import content')
    return result
  }
  try {
    return accept(await fetcher.headless(url))
  } catch {}
  const providers: Array<() => Promise<fetchResult>> = []
  if (env.ZYTE_API_KEY?.trim()) providers.push(() => fetcher.zyte(url, true))
  if (env.SCRAPING_BOT_TOKEN?.trim()) providers.push(() => fetcher.scrapingBot(url, true))
  if (!providers.length) throw new Error('Browser content is unavailable or a placeholder; configure ZYTE_API_KEY or SCRAPING_BOT_TOKEN for dynamic-page rendering')
  for (const fetch of providers) {
    try {
      return accept(await fetch())
    } catch {}
  }
  throw new Error('Browser and configured dynamic-page providers failed to return usable public content')
}

export interface ImportParseWorkflowParams {
  eventContext?: EventRequestContext
  url: string
  bookmarkId: number
  userId: number
  enUserId: number
  userLang: string
  importTaskId: number
  ignoreGenerateTag: boolean
}

/**
 * 慢速导入路径（201+ 条）：安全 headless 优先，动态页面回退到已配置的渲染供应商。
 */
export class ImportParseWorkflow extends WorkflowEntrypoint<Env, ImportParseWorkflowParams> {
  async run(event: WorkflowEvent<ImportParseWorkflowParams>, step: WorkflowStep) {
    initializeCore()
    const currentContainer = container.clone()
    const ctxManager = new ContextManager(this.ctx, this.env)

    const hashids = new Hashid(this.env, event.payload.userId)
    ctxManager.setUserInfo(event.payload.userId, event.payload.enUserId, '', event.payload.userLang)
    ctxManager.setHashIds(hashids)
    if (event.payload.eventContext) ctxManager.set(EVENT_CONTEXT_KEY, event.payload.eventContext)
    initializeInfrastructure(ctxManager, currentContainer)

    const bookmarkService = currentContainer.resolve(BookmarkService)
    const crawlService = currentContainer.resolve(CrawlService)
    const urlParserHandler = currentContainer.resolve(UrlParserHandler)
    const importService = currentContainer.resolve(ImportService)

    const { url, bookmarkId, userId, importTaskId, ignoreGenerateTag } = event.payload
    const userBookmark = await bookmarkService.getUserBookmark(bookmarkId, userId)
    if (!userBookmark) throw new Error(`user_bookmark not found: bookmark=${bookmarkId} user=${userId}`)
    const userBookmarkUuid = userBookmark.uuid
    const hostname = (() => {
      try {
        return new URL(url).hostname || 'unknown'
      } catch {
        return 'unknown'
      }
    })()

    console.log(`ImportParse workflow started for bookmark ${bookmarkId} with URL: ${url}`)

    const markImportFailed = async () => {
      await bookmarkService.updateBookmarkImportRelationStatus(userId, bookmarkId, importTaskId, 2).catch(e => console.error(`import relation update failed: ${e}`))
      await importService.incrImportTask(ctxManager, userId, importTaskId, 0, 1).catch(e => console.error(`import incr failed: ${e}`))
    }

    // Step 1: Fetch — 检查缓存，然后 headless browser 抓取
    let crawlResult: CrawlResult | undefined
    try {
      crawlResult = await step.do(
        'fetch',
        {
          retries: { limit: 1, delay: '30 seconds' as const, backoff: 'constant' as const },
          timeout: '2 minutes'
        },
        async (): Promise<CrawlResult> => {
          publicTarget(url)
          // 缓存命中检查
          const existingData = await bookmarkService.getBookmarkTitleAndTextContentTry(bookmarkId)
          if (existingData?.privateUser === 0) {
            await crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, 'content_fetch_cached', 'success')
            return {
              title: existingData.title,
              textContent: existingData.textContent,
              byline: existingData.byline
            }
          }

          await bookmarkService.updateBookmarkStatus(bookmarkId, queueStatus.PARSEING)

          const fetchRes = await fetchImportContent(this.env, url)
          return await crawlService.parseAndSaveContent(ctxManager, fetchRes, bookmarkId, userBookmarkUuid)
        }
      )
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`ImportParse workflow fetch failed for bookmark ${bookmarkId}: ${errMsg}`)
      await bookmarkService.updateBookmarkStatus(bookmarkId, queueStatus.FAILED)
      await crawlService.pushBookmarkFailureAlert(userId, 'import_parse_workflow.fetch', {
        bookmark_id: bookmarkId,
        url,
        user_id: userId,
        error: errMsg
      })
      await crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, 'fetching', 'failed', errMsg, ctxManager)
      await markImportFailed()
      throw err
    }

    // Step 2: Post-processing（搜索索引、标签生成、概览、Telegram 回调）
    try {
      await step.do(
        'post-processing',
        {
          retries: { limit: 2, delay: '5 seconds' as const, backoff: 'constant' as const },
          timeout: '10 minutes'
        },
        async () => {
          if (!crawlResult) return
          await urlParserHandler.processPostHandler(
            ctxManager,
            {
              id: `import_workflow_${bookmarkId}`,
              info: {
                userId,
                bookmarkId,
                targetUrl: url,
                callback: 0,
                callbackPayload: {},
                ignoreGenerateTag,
                parserType: parserType.SERVER_PUPPETEER_PARSE,
                privateUser: 0,
                resource: '',
                targetTitle: '',
                importTaskId
              }
            },
            {
              title: crawlResult.title,
              textContent: crawlResult.textContent,
              byline: crawlResult.byline
            }
          )
        }
      )
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`ImportParse post-processing failed for bookmark ${bookmarkId}: ${errMsg}`)
      await crawlService.pushBookmarkFailureAlert(userId, 'import_parse_workflow.post_processing', {
        bookmark_id: bookmarkId,
        url,
        user_id: userId,
        error: errMsg
      })
      await crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, 'post_processing', 'failed', errMsg, ctxManager)
    }

    // Step 3: 更新导入进度
    try {
      await step.do('update-import', { retries: { limit: 2, delay: '3 seconds' as const, backoff: 'constant' as const }, timeout: '1 minute' }, async () => {
        await bookmarkService.updateBookmarkImportRelationStatus(userId, bookmarkId, importTaskId, 1)
        await importService.incrImportTask(ctxManager, userId, importTaskId, 1, 0)
      })
    } catch (err) {
      console.error(`Import tracking failed for bookmark ${bookmarkId}: ${err}`)
    }

    console.log(`ImportParse workflow completed for bookmark ${bookmarkId}`)
  }
}
