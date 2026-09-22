import { container } from '@/decorators/di'
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { initializeInfrastructure, initializeCore } from '@/di/generated/dependency'
import { ContextManager } from '@/utils/context'
import { CrawlService, CrawlResult, TwitterFetched, ZhihuFetched } from '@/domain/crawl'
import type { XHSData, WeiboData } from '@/const/moreapi/base'
import type { RedditData } from '@/const/moreapi/reddit'
import { isWeixinImageShower, isWeixinLegacyImageShower } from '@/const/moreapi/weixin'
import { UrlParserHandler } from '@/domain/orchestrator/urlParser'
import { BookmarkService } from '@/domain/bookmark'
import { Hashid } from '@/utils/hashids'
import { queueStatus } from '@/infra/repository/dbBookmark'
import { parserType } from '@/utils/urlPolicie'
import { TelegramBotService } from '@/domain/telegram'
import { MultiLangError } from '@/utils/multiLangError'
import { ErrorName } from '@/const/err'
import { ContentValidationWorkflowParams } from './contentValidationWorkflow'
import { ImportService } from '@/domain/import'
import { detectRoute, isSocialMediaRoute, normalizeYoutubeUrl, type RouteKind } from '@/utils/platformDetector'
import { isProhibitedContentUrl } from '@/utils/prohibitedContentDetector'
import { OpenAIModerationClient, ModerationResult } from '@/infra/external/openaiModeration'
import { extractImageUrls } from '@/utils/htmlImages'
import { SlaxAlertBotClient } from '@/infra/external/slaxAlertBot'
import { EVENT_CONTEXT_KEY, type EventRequestContext } from '@/domain/events'

export interface CrawlWorkflowParams {
  eventContext?: EventRequestContext
  url: string
  bookmarkId: number
  userId: number
  enUserId: number
  userLang: string
  callbackChatId?: number
  callbackOriginMessageId?: number
  ignoreGenerateTag?: boolean
  inlineContent?: string
  importTaskId?: number
}

type FetchedPayload =
  | { kind: 'twitter' | 'twitter_article'; resolvedUrl: string; data: TwitterFetched; isSocialMedia: true }
  | { kind: 'xhs'; resolvedUrl: string; data: XHSData; isSocialMedia: true }
  | { kind: 'weibo'; resolvedUrl: string; data: WeiboData; isSocialMedia: true }
  | { kind: 'reddit'; resolvedUrl: string; data: RedditData; isSocialMedia: true }
  | { kind: 'zhihu'; resolvedUrl: string; data: ZhihuFetched; isSocialMedia: true }
  | { kind: 'parsed'; resolvedUrl: string; data: CrawlResult; isSocialMedia: boolean }
  | { kind: 'shortCircuit'; resolvedUrl: string; data: { title: string; textContent: string; byline: string }; isSocialMedia: false }

export class CrawlWorkflow extends WorkflowEntrypoint<Env, CrawlWorkflowParams> {
  async run(event: WorkflowEvent<CrawlWorkflowParams>, step: WorkflowStep) {
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
    const telegramBotSvc = currentContainer.resolve(TelegramBotService)
    const alertBot = currentContainer.resolve(SlaxAlertBotClient)

    const { url, bookmarkId, userId, callbackChatId, callbackOriginMessageId, ignoreGenerateTag, inlineContent } = event.payload
    const hostname = (() => {
      try {
        return new URL(url).hostname || 'unknown'
      } catch {
        return 'unknown'
      }
    })()

    const userBookmark = await bookmarkService.getUserBookmark(bookmarkId, userId)
    if (!userBookmark) throw new NonRetryableError(`user_bookmark not found: bookmark=${bookmarkId} user=${userId}`)
    const userBookmarkUuid = userBookmark.uuid

    const alertFailure = (scope: string, meta: Record<string, unknown>) =>
      crawlService.pushBookmarkFailureAlert(userId, scope, meta).catch(e => console.error(`alertFailure ${scope} failed: ${e}`))

    const trackStep = async <T>(stepName: string, fn: () => Promise<T>): Promise<T> => {
      try {
        const result = await fn()
        await crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, stepName, 'success')
        return result
      } catch (err) {
        await crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, stepName, 'failed', err instanceof Error ? err.message : String(err), ctxManager)
        throw err
      }
    }

    console.log(`Crawl workflow started for bookmark ${bookmarkId} with URL: ${url}`)

    // 预解析/抓取/保存内容
    let fetched: FetchedPayload | undefined
    try {
      fetched = await step.do(
        'fetch',
        {
          retries: { limit: 2, delay: '1 minute' as const, backoff: 'constant' as const },
          timeout: '5 minutes'
        },
        async (): Promise<FetchedPayload> => {
          // 检查是否已有内容
          const existingData = await bookmarkService.getBookmarkTitleAndTextContentTry(bookmarkId)
          if (existingData?.privateUser === 0) {
            await crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, 'content_fetch_cached', 'success')
            return {
              kind: 'shortCircuit',
              resolvedUrl: url,
              data: { title: existingData.title, textContent: existingData.textContent, byline: existingData.byline },
              isSocialMedia: false
            }
          }

          await bookmarkService.updateBookmarkStatus(bookmarkId, queueStatus.PARSEING)

          const resolvedUrl = await crawlService.resolveShortLink(ctxManager, url)
          if (resolvedUrl !== url) {
            console.log(`Resolved short link: ${url} -> ${resolvedUrl}`)
          }

          const route = detectRoute(resolvedUrl)
          if (inlineContent && route === 'regular') {
            const fetchRes = { content: inlineContent, url: resolvedUrl, title: '' }
            const result = await trackStep('inline_content', () => crawlService.parseAndSaveContent(ctxManager, fetchRes, bookmarkId, userBookmarkUuid))
            return { kind: 'parsed', resolvedUrl, data: result, isSocialMedia: false }
          }

          switch (route) {
            case 'twitter':
            case 'twitter_article': {
              const data = await trackStep('twitter_fetching', () => crawlService.fetchTwitterData(ctxManager, resolvedUrl))
              return { kind: data.kind === 'article' ? 'twitter_article' : 'twitter', resolvedUrl, data, isSocialMedia: true }
            }
            case 'xhs': {
              const data = await trackStep('xiaohongshu_fetching', () => crawlService.fetchXhsData(this.env, resolvedUrl))
              return { kind: 'xhs', resolvedUrl, data, isSocialMedia: true }
            }
            case 'weibo': {
              const data = await trackStep('weibo_fetching', () => crawlService.fetchWeiboData(this.env, resolvedUrl))
              return { kind: 'weibo', resolvedUrl, data, isSocialMedia: true }
            }
            case 'reddit': {
              const data = await trackStep('reddit_fetching', () => crawlService.fetchRedditData(this.env, resolvedUrl))
              return { kind: 'reddit', resolvedUrl, data, isSocialMedia: true }
            }
            case 'zhihu': {
              const data = await trackStep('zhihu_fetching', () => crawlService.fetchZhihuData(this.env, resolvedUrl))
              return { kind: 'zhihu', resolvedUrl, data, isSocialMedia: true }
            }
            case 'weixin': {
              const data = await trackStep('weixin_fetching', () => crawlService.fetchWeixin(ctxManager, resolvedUrl)).catch(err => {
                if (err instanceof MultiLangError) {
                  if (err.name === ErrorName.WEIXIN_ENV_ABNORMAL || err.name === ErrorName.DAJIALA_ARTICLE_UNAVAILABLE) {
                    throw new NonRetryableError(`weixin_business_terminal:${err.name}:${err.message}`)
                  }
                }
                throw err
              })

              // 图片流视为社媒：跳过 soft404 与内容校验（tikhub 用字段、legacy 用原始 HTML 特征）
              const isImageShower = data.source === 'tikhub' ? isWeixinImageShower(data.content) : isWeixinLegacyImageShower(data.fetchRes.content)
              const result = await trackStep('parsing', () => crawlService.parseAndSaveWeixin(ctxManager, data, resolvedUrl, bookmarkId, userBookmarkUuid))
              return { kind: 'parsed', resolvedUrl, data: result, isSocialMedia: isImageShower }
            }
            case 'youtube': {
              const normalized = normalizeYoutubeUrl(resolvedUrl)
              const fetched = await trackStep('youtube_fetching', () => crawlService.fetchYoutubeData(ctxManager, normalized))
              const result = await trackStep('youtube_parsing', () => crawlService.parseAndSaveYoutube(ctxManager, fetched, normalized, bookmarkId, userBookmarkUuid))
              return { kind: 'parsed', resolvedUrl: normalized, data: result, isSocialMedia: true }
            }
            default: {
              const fetchRes = await trackStep('zyte_fetching', () => crawlService.fetchRegular(ctxManager, resolvedUrl))
              const result = await trackStep('parsing', () => crawlService.parseAndSaveContent(ctxManager, fetchRes, bookmarkId, userBookmarkUuid))
              return { kind: 'parsed', resolvedUrl, data: result, isSocialMedia: false }
            }
          }
        }
      )
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`Crawl workflow fetch failed for bookmark ${bookmarkId}: ${errMsg}`)

      await bookmarkService.updateBookmarkStatus(bookmarkId, queueStatus.FAILED)

      const scope = err instanceof NonRetryableError ? 'workflow_fetch.business_terminal' : 'workflow_fetch.exhausted'
      await alertFailure(scope, {
        bookmark_id: bookmarkId,
        url,
        domain: hostname,
        user_id: userId,
        error: errMsg
      })
      // 导入追踪：fetch 失败
      if (event.payload.importTaskId) {
        await bookmarkService.updateBookmarkImportRelationStatus(userId, bookmarkId, event.payload.importTaskId, 2).catch(e => console.error(`import relation update failed: ${e}`))
        const importService = currentContainer.resolve(ImportService)
        await importService.incrImportTask(ctxManager, userId, event.payload.importTaskId, 0, 1).catch(e => console.error(`import incr failed: ${e}`))
      }

      throw err
    }

    let crawlResult: CrawlResult | undefined

    if (fetched.kind === 'shortCircuit') {
      // bookmark 已有内容，跳过 parse
      crawlResult = {
        title: fetched.data.title,
        textContent: fetched.data.textContent,
        byline: fetched.data.byline,
        siteName: ''
      }
    } else if (fetched.kind === 'parsed') {
      // dajiala/regular 已在 fetch step 内完成 parse+save
      crawlResult = fetched.data
    } else {
      // 社交媒体路由：数据体积小，安全拆步
      try {
        crawlResult = await step.do(
          'parse',
          {
            retries: { limit: 1, delay: '1 second' as const },
            timeout: '3 minutes'
          },
          async (): Promise<CrawlResult> => {
            if (!fetched) throw new NonRetryableError('fetch payload missing')
            try {
              switch (fetched.kind) {
                case 'twitter':
                case 'twitter_article':
                  return await crawlService.parseAndSaveTwitter(ctxManager, fetched.data, bookmarkId, userBookmarkUuid)
                case 'xhs':
                  return await crawlService.parseAndSaveXhs(ctxManager, fetched.data, fetched.resolvedUrl, bookmarkId, userBookmarkUuid)
                case 'weibo':
                  return await crawlService.parseAndSaveWeibo(ctxManager, fetched.data, fetched.resolvedUrl, bookmarkId, userBookmarkUuid)
                case 'reddit':
                  return await crawlService.parseAndSaveReddit(ctxManager, fetched.data, fetched.resolvedUrl, bookmarkId, userBookmarkUuid)
                case 'zhihu':
                  return await crawlService.parseAndSaveZhihu(ctxManager, fetched.data, fetched.resolvedUrl, bookmarkId, userBookmarkUuid)
                default:
                  throw new NonRetryableError(`unexpected kind in parse step: ${(fetched as any).kind}`)
              }
            } catch (err) {
              if (err instanceof NonRetryableError) throw err
              const errMsg = err instanceof Error ? err.message : String(err)
              await crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, 'parsing', 'failed', errMsg, ctxManager)
              throw new NonRetryableError(`parse_failed:${errMsg}`)
            }
          }
        )
        await crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, 'parsing', 'success')
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`Crawl workflow parse failed for bookmark ${bookmarkId}: ${errMsg}`)

        await bookmarkService.updateBookmarkStatus(bookmarkId, queueStatus.FAILED)
        await alertFailure('workflow_parse.error', {
          bookmark_id: bookmarkId,
          url,
          domain: hostname,
          user_id: userId,
          error: errMsg
        })

        // 导入追踪：parse 失败
        if (event.payload.importTaskId) {
          await bookmarkService
            .updateBookmarkImportRelationStatus(userId, bookmarkId, event.payload.importTaskId, 2)
            .catch(e => console.error(`import relation update failed: ${e}`))
          const importService = currentContainer.resolve(ImportService)
          await importService.incrImportTask(ctxManager, userId, event.payload.importTaskId, 0, 1).catch(e => console.error(`import incr failed: ${e}`))
        }

        throw err
      }
    }
    // 软404检测（仅非社交媒体来源）
    const isSocialMedia = fetched.isSocialMedia
    let isSoft404 = false
    if (crawlResult && crawlResult.textContent && crawlResult.textContent.length < 15 && !isSocialMedia) {
      isSoft404 = true
      console.log(`Soft 404 detected for bookmark ${bookmarkId}: textContent length = ${crawlResult.textContent.length}`)
      await crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, 'parsing', 'failed', `soft_404:len=${crawlResult.textContent.length}`, ctxManager)
      await alertFailure('workflow_parse.soft_404', { bookmark_id: bookmarkId, url, domain: hostname, text_content_length: crawlResult.textContent.length })
    }

    // 内容审核（omni-moderation）：前置到主流程，post-processing 必须等待其完成。
    // 命中黄网域名直接标记为色情；否则投递「标题 + 正文文本 + 前 20 张图片 URL」做分级并落库。
    // 命中（>0）：关闭分享 + 推飞书告警；审核失败不阻塞后续（默认 moderation_result=0）。
    let moderationResult: ModerationResult = ModerationResult.NORMAL
    if (crawlResult && !isSoft404) {
      try {
        moderationResult = await step.do(
          'content-moderation',
          {
            retries: { limit: 2, delay: '30 seconds' as const, backoff: 'constant' as const },
            timeout: '3 minutes'
          },
          async (): Promise<ModerationResult> => {
            let result: ModerationResult
            if (isProhibitedContentUrl(url)) {
              result = ModerationResult.PORN
              console.log(`bookmark ${bookmarkId} url is prohibited content, mark as porn (1)`)
            } else {
              // 从 HTML 内容里提取前 20 张图片 URL（已是公网可访问的代理地址）
              let imageUrls: string[] = []
              if (crawlResult!.contentKey) {
                const htmlObj = await this.env.OSS.get(crawlResult!.contentKey)
                if (htmlObj) imageUrls = extractImageUrls(await htmlObj.text(), 20)
              }
              const moderation = new OpenAIModerationClient(this.env)
              result = await moderation.moderateContent({ title: crawlResult!.title, text: crawlResult!.textContent, imageUrls })
              console.log(`Moderation result for bookmark ${bookmarkId}: ${result} (images=${imageUrls.length})`)
            }

            await bookmarkService.updateBookmarkModerationResult(bookmarkId, result)

            if (result !== ModerationResult.NORMAL) {
              // 命中审核内容：关闭分享（无记录则创建全关闭记录），并推飞书。=1 色情=提醒(蓝)，=2 极度危险=警告(橙)
              await bookmarkService.disableBookmarkShare(bookmarkId, userId)
              const isDanger = result === ModerationResult.DANGEROUS
              const header = isDanger ? '⚠️ **Content Moderation 警告**' : '🔍 **Content Moderation 提醒**'
              const label = isDanger ? '极度危险内容(2)' : '色情内容(1)'
              await alertBot.crawl.pushMessage(
                `${header}\n**级别**: ${label}\n**Title**: ${crawlResult!.title}\n**URL**: ${url}\n**处理**: 已禁止分享、仅创建者可访问` +
                  (isDanger ? '（危险内容待人工确认是否删除）' : '')
              )
            }
            return result
          }
        )
      } catch (moderationErr) {
        const errMsg = moderationErr instanceof Error ? moderationErr.message : String(moderationErr)
        console.error(`Content moderation failed for bookmark ${bookmarkId}: ${errMsg}`)
        await crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, 'content_moderation', 'failed', errMsg, ctxManager)
      }
    }

    // 触发内容验证 workflow（fire-and-forget）；命中审核（>0）的内容跳过截图与质量校验
    if (crawlResult && !isSoft404 && crawlResult.contentKey && moderationResult === ModerationResult.NORMAL) {
      try {
        await this.env.CONTENT_VALIDATION_WORKFLOW.create({
          params: {
            bookmarkId,
            userId,
            enUserId: event.payload.enUserId,
            userLang: event.payload.userLang,
            url,
            title: crawlResult.title,
            contentKey: crawlResult.contentKey,
            eventContext: event.payload.eventContext,
            ...(crawlResult.qualityReview ? { qualityReview: crawlResult.qualityReview } : {})
          } as ContentValidationWorkflowParams
        })
        console.log(`Content validation workflow triggered for bookmark ${bookmarkId}`)
      } catch (triggerErr) {
        const errMsg = triggerErr instanceof Error ? triggerErr.message : String(triggerErr)
        console.error(`Failed to trigger content validation workflow for bookmark ${bookmarkId}: ${errMsg}`)
        await alertFailure('post_processing.content_validation', { bookmark_id: bookmarkId, url, domain: hostname, error: errMsg })
      }
    }

    try {
      await step.do(
        'post-processing',
        {
          retries: { limit: 2, delay: '5 seconds' as const, backoff: 'constant' },
          timeout: '10 minutes'
        },
        async () => {
          if (!crawlResult) {
            console.error(`No crawl result available for post-processing of bookmark ${bookmarkId}`)
            return
          }

          console.log(`Crawl workflow post-processing for bookmark ${bookmarkId}`)

          !!callbackChatId && (await telegramBotSvc.initTelegramBot(ctxManager.env))
          await urlParserHandler.processPostHandler(
            ctxManager,
            {
              id: `workflow_${bookmarkId}`,
              info: {
                userId,
                bookmarkId,
                targetUrl: url,
                callback: callbackChatId ? 1 : 0,
                callbackPayload: {
                  chat_id: callbackChatId,
                  origin_message_id: callbackOriginMessageId
                },
                ignoreGenerateTag: ignoreGenerateTag || isSoft404,
                parserType: parserType.SERVER_PUPPETEER_PARSE,
                privateUser: 0,
                resource: '',
                targetTitle: '',
                importTaskId: event.payload.importTaskId
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
      await crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, 'post_processing', 'success')
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`Post-processing failed for bookmark ${bookmarkId}: ${errMsg}`)
      await alertFailure('post_processing.failed', { bookmark_id: bookmarkId, url, domain: hostname, error: errMsg })
      await crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, 'post_processing', 'failed', errMsg, ctxManager)
    }

    if (crawlResult) {
      crawlService.sendAddBookmarkStepEvent(userId, bookmarkId, hostname, 'complete', 'success').catch(e => console.error(`track bookmark_add_complete failed: ${e}`))
    }

    // 导入追踪：成功
    if (event.payload.importTaskId) {
      try {
        await step.do('update-import', { retries: { limit: 2, delay: '3 seconds' as const, backoff: 'constant' }, timeout: '1 minute' }, async () => {
          const importService = currentContainer.resolve(ImportService)
          await bookmarkService.updateBookmarkImportRelationStatus(userId, bookmarkId, event.payload.importTaskId!, 1)
          await importService.incrImportTask(ctxManager, userId, event.payload.importTaskId!, 1, 0)
        })
      } catch (err) {
        console.error(`Import tracking failed for bookmark ${bookmarkId}: ${err}`)
      }
    }

    console.log(`Crawl workflow completed successfully for bookmark ${bookmarkId}`)
  }
}
