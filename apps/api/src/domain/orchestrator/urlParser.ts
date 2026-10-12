import { pickTagsForBookmark, groupVocabulary } from '@/utils/tags'
import { inject, injectable } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { BookmarkService } from '@/domain/bookmark'
import { callbackType, QueueClient, queueParseMessage, queueThirdPartyMessage, receiveParseMessage, parseMessage, queueRetryParseMessage } from '@/infra/queue/queueClient'
import { BucketClient } from '@/infra/repository/bucketClient'
import { TWITTER_STATUS_RE, TWITTER_ARTICLE_RE, detectRoute } from '@/utils/platformDetector'
import { TelegramBotService } from '@/domain/telegram'
import type { LazyInstance } from '@/decorators/lazy'
import { AigcService } from '@/domain/aigc'
import { SearchService } from '@/domain/search'
import { queueStatus, bookmarkFetchRetryStatus, type bookmarkParsePO } from '@/infra/repository/dbBookmark'
import { Hashid } from '@/utils/hashids'
import { TagService } from '@/domain/tag'
import { UserService } from '@/domain/user'
import { CrawlResult, CrawlService } from '@/domain/crawl'
import { LogsService } from '@/domain/logs'
import { isProhibitedContentUrl } from '@/utils/prohibitedContentDetector'
import { parserType } from '@/utils/urlPolicie'
import { fetchResult } from '@/utils/browser'
import { SlaxFetch } from '@/infra/external/remoteFetcher'
import { ContentParser } from '@/utils/parser'
import { Imager } from '@/utils/imager'
import { HtmlBuilder } from '@/utils/htmlBuilder'
import { parseHTML } from 'linkedom'
import { TweetInfo } from '@/const/twitterapi/struct'

export type PostHandler = (meta: { parseRes: { title: string; textContent: string; byline?: string } }) => Promise<void>
export type receiveRetryParseMesaage = receiveParseMessage<queueRetryParseMessage>
export type receiveQueueParseMessage = receiveParseMessage<queueParseMessage>
export type receiveThirdPartyMessage = receiveParseMessage<queueThirdPartyMessage>

@injectable()
export class UrlParserHandler {
  private bookmarkSvc: BookmarkService
  private telegramBotSvc: TelegramBotService
  private searchSvc: SearchService
  private tagSvc: TagService
  private aigcSvc: AigcService

  constructor(
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(BucketClient) private bucketClient: LazyInstance<BucketClient>,
    @inject(AigcService) private aigcService: AigcService,
    @inject(TelegramBotService) private telegramBotService: TelegramBotService,
    @inject(SearchService) private searchService: SearchService,
    @inject(QueueClient) private queueClient: LazyInstance<QueueClient>,
    @inject(TagService) private tagService: TagService,
    @inject(UserService) private userSvc: UserService,
    @inject(CrawlService) private crawlSvc: CrawlService,
    @inject(LogsService) private logsService: LogsService
  ) {
    this.bookmarkSvc = bookmarkService
    this.searchSvc = searchService
    this.telegramBotSvc = telegramBotService
    this.aigcSvc = aigcService
    this.tagSvc = tagService
  }

  public static async fetchContent(env: Env, message: parseMessage): Promise<fetchResult> {
    const startTime = Date.now()
    const fetcher = new SlaxFetch(env)
    try {
      switch (message.parserType) {
        case parserType.SERVER_PUPPETEER_PARSE:
          return await fetcher.headless(message.targetUrl)
        case parserType.SERVER_FETCH_PARSE:
          return await fetcher.http(message.targetUrl, 'Asia/Hong_Kong')
        case parserType.CLIENT_PARSE:
          return { content: message.resource, url: message.targetUrl, title: '' }
        default:
          throw new Error('unknown parser type')
      }
    } catch (e) {
      throw e
    } finally {
      console.log(`fetch ${message.targetUrl} done, cost: ${Date.now() - startTime}ms`)
    }
  }

  public async saveBookmark(
    messageId: string,
    bookmarkId: number,
    parseRes: { title: string; textContent: string; contentDocument: Document; excerpt?: string; byline?: string; siteName?: string; publishedTime?: Date }
  ) {
    const newBookmark: bookmarkParsePO = {
      title: parseRes.title,
      description: parseRes.excerpt,
      content_word_count: parseRes.textContent.length,
      content_key: `html/parse/${messageId}.${Date.now()}.html`,
      content_md_key: `text/parse/${messageId}.${Date.now()}.txt`,
      status: queueStatus.SUCCESS,
      byline: parseRes.byline ?? '',
      site_name: parseRes.siteName ?? '',
      published_at: parseRes.publishedTime ?? new Date()
    }

    await Promise.allSettled([
      this.bucketClient().putIfKeyExists(newBookmark.content_md_key, parseRes.textContent),
      this.bucketClient().putIfKeyExists(newBookmark.content_key, parseRes.contentDocument.documentElement.outerHTML),
      this.bookmarkService.updateBookmark(bookmarkId, newBookmark)
    ])

    return newBookmark
  }

  public async parseUrl(ctx: ContextManager, messageId: string, message: parseMessage, postHandlers: PostHandler[]) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { resource, ...taskInfo } = message
    const bookmarkId = taskInfo.bookmarkId

    try {
      if (message.parserType === parserType.SERVER_PUPPETEER_PARSE) {
        const res = await this.bookmarkService.getBookmarkTitleAndTextContentTry(bookmarkId)
        if (res) {
          await Promise.allSettled(postHandlers.map(handler => handler({ parseRes: { title: res.title, textContent: res.textContent } })))
          return
        }
      }
    } catch (err) {
      console.log(`parse ${messageId} with cache failed: ${err}`)
    }

    const fetchRes = await UrlParserHandler.fetchContent(ctx.env, message)

    const uUrl = new URL(fetchRes.url)
    const parseRes = await ContentParser.parse({ url: uUrl, content: fetchRes.content, title: fetchRes.title })

    await new Imager(ctx.env).batchReplaceImage(uUrl, parseRes.contentDocument)

    try {
      await this.saveBookmark(messageId, bookmarkId, parseRes)
      await Promise.allSettled(postHandlers.map(handler => handler({ parseRes: { title: parseRes.title, textContent: parseRes.textContent, byline: parseRes.byline || '' } })))
    } catch (err) {
      console.log(`parse ${messageId} failed: ${err}`)
      throw err
    } finally {
      console.log(`parse ${message.targetUrl} done.`)
    }
  }

  public async parseTweet(env: Env, message: receiveThirdPartyMessage, tweetInfo: TweetInfo) {
    const content = HtmlBuilder.buildTweet(tweetInfo)
    const { document } = parseHTML(content)
    await new Imager(env).batchReplaceImage(new URL(tweetInfo.url), document)

    const parseRes = {
      title: `Tweet by ${tweetInfo.author.name} (${tweetInfo.id})`,
      textContent: tweetInfo.text,
      contentDocument: document,
      excerpt: tweetInfo.text.substring(0, 20),
      byline: tweetInfo.author.name,
      siteName: 'Twitter',
      publishedTime: new Date(tweetInfo.createdAt)
    }

    try {
      await this.saveBookmark(message.id, message.info.bookmarkId, parseRes)
      if (message.info.callback === callbackType.CALLBACK_TELEGRAM) {
        const hashids = new Hashid(env, message.info.userId)
        const encodeBmId = hashids.encodeId(message.info.bookmarkId)
        await this.telegramBotService.callback(encodeBmId, message.info.callbackPayload)
      }
    } catch (err) {
      console.log(`parse tweet ${message.id} ${message.info.targetUrl} failed: ${err}`)
    }
  }

  async handleCallbackTask(ctx: ContextManager, info: { callback?: callbackType; bookmarkId: number; callbackPayload: any }): Promise<PostHandler> {
    return async () => {
      if (info.callback === callbackType.CALLBACK_TELEGRAM) {
        await this.telegramBotService.initTelegramBot(ctx.env)
        await this.telegramBotService.callback(ctx.hashIds.encodeId(info.bookmarkId), info.callbackPayload)
      }
    }
  }

  async handleTagTask(ctx: ContextManager, info: { bookmarkId: number; ignoreGenerateTag: boolean; userIds: number[]; targetUrl?: string }): Promise<PostHandler> {
    return async meta => {
      if (info.ignoreGenerateTag || !info.userIds || info.userIds.length === 0) {
        return
      }
      if (info.targetUrl && isProhibitedContentUrl(info.targetUrl)) {
        console.log(`bookmark ${info.bookmarkId} url is prohibited content, skip tags and overview generation`)
        return
      }
      // the live vocabulary, split so the prompt can prefer the user's own words
      const vocabulary = await this.tagService.listUserTags(ctx)
      const { overview, key_takeaways, tags } = await this.aigcService.generateOverviewTags(
        ctx,
        meta.parseRes.title || '',
        meta.parseRes.textContent,
        meta.parseRes.byline || '',
        groupVocabulary(vocabulary)
      )

      if (overview.length > 0) {
        await Promise.all(info.userIds.map(userId => this.bookmarkService.createBookmarkOverview(userId, info.bookmarkId, '', JSON.stringify({ overview, key_takeaways }))))
      }

      const filteredTags = pickTagsForBookmark(tags, vocabulary).map(t => t.name)

      await Promise.all(info.userIds.map(userId => this.bookmarkService.tagBookmark(ctx, userId, info.bookmarkId, filteredTags)))
    }
  }

  async handleSearchTask(ctx: ContextManager, info: { bookmarkId: number }): Promise<PostHandler> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return async ({ parseRes }) => {
      try {
        console.log(`add search record, bookmarkId: ${info.bookmarkId}`)
        await this.searchService.addSearchRecordByBmId(ctx, info.bookmarkId)
      } catch (e) {
        console.error(`add search record failed: ${e}`)
      }
    }
  }

  async processParseMessage(ctx: ContextManager, message: receiveQueueParseMessage): Promise<{ success: boolean; bookmarkId: number }> {
    const { id, info } = message
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { resource, ...logInfo } = info
    console.log(`processing message: ${id}, messageInfo: ${JSON.stringify(logInfo)}`)

    if (!info) return { success: false, bookmarkId: message.info.bookmarkId }

    message.info.parserType = parserType.SERVER_FETCH_PARSE

    const processFunc = async () => {
      const regexp = new RegExp('http[s]://(x|twitter).com/.*/status/[0-9]+')
      if (regexp.test(info.targetUrl)) {
        message.info.resource = ''
        const info = {
          ...message.info,
          encodeBmId: ctx.hashIds.encodeId(message.info.bookmarkId)
        } as queueThirdPartyMessage

        return await this.processThirdPartyMessages(ctx, [{ id, info }])
      } else if (message.info.resource !== '') {
        message.info.parserType = parserType.CLIENT_PARSE
      }

      await this.processParseTask(ctx, message)
    }

    try {
      await Promise.race([
        processFunc(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Parse timeout')), 120 * 1000)
        })
      ])
      return { success: true, bookmarkId: message.info.bookmarkId }
    } catch (err) {
      console.error(`processParseMessage ${id} failed: ${err}`)
      await this.bookmarkService.updateBookmarkStatus(info.bookmarkId, queueStatus.FAILED)
      return { success: false, bookmarkId: message.info.bookmarkId }
    }
  }

  async processParseTask(ctx: ContextManager, taskInfo: receiveQueueParseMessage) {
    const { id, info } = taskInfo

    try {
      const callbacks: PostHandler[] = [
        await this.handleCallbackTask(ctx, {
          callback: info.callback || callbackType.NOT_CALLBACK,
          bookmarkId: info.bookmarkId,
          callbackPayload: info.callbackPayload
        }),
        await this.handleTagTask(ctx, { bookmarkId: info.bookmarkId, ignoreGenerateTag: info.ignoreGenerateTag, userIds: [info.userId], targetUrl: info.targetUrl }),
        await this.handleSearchTask(ctx, { bookmarkId: info.bookmarkId })
      ]

      await this.parseUrl(ctx, id, info, callbacks)
    } catch (err) {
      await this.bookmarkService.updateBookmarkStatus(info.bookmarkId, queueStatus.PENDING_RETRY)
      await this.bookmarkService.updateBookmarkParseQueueRetry(info.bookmarkId, [info.userId], {
        status: bookmarkFetchRetryStatus.PENDING,
        retryCount: 1
      })
      console.error(`process message ${id} failed: ${err}`)
    }
  }

  async processRetryParseMessage(ctx: ContextManager, message: receiveRetryParseMesaage) {
    const { id, info } = message
    console.log(`processing retry message: ${id}, messageInfo: ${JSON.stringify(info)}`)

    await this.bookmarkService.updateBookmarkParseQueueRetry(info.bookmarkId, info.retry.userIds || [], {
      status: bookmarkFetchRetryStatus.PARSING,
      retryCount: info.retry.retryCount + 1
    })

    const retryFunc = async () => {
      const callbacks: PostHandler[] = [
        await this.handleCallbackTask(ctx, {
          callback: info.callback || callbackType.NOT_CALLBACK,
          bookmarkId: info.bookmarkId,
          callbackPayload: info.callbackPayload
        }),
        await this.handleTagTask(ctx, { bookmarkId: info.bookmarkId, ignoreGenerateTag: info.ignoreGenerateTag, userIds: info.retry.userIds || [], targetUrl: info.targetUrl })
      ]

      await this.parseUrl(ctx, id, info, callbacks)
    }

    try {
      await Promise.race([
        retryFunc(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Retry timeout')), 120 * 1000)
        })
      ])

      const bookmark = await this.bookmarkService.getBookmarkById(info.bookmarkId)
      if (bookmark && bookmark.status === queueStatus.SUCCESS) {
        await this.bookmarkService.updateBookmarkParseQueueRetry(info.bookmarkId, info.retry.userIds || [], {
          status: bookmarkFetchRetryStatus.SUCCESS
        })
      }
    } catch (err) {
      console.error(`process retry message ${id} failed: ${err}`)
      await this.bookmarkService.updateBookmarkStatus(info.bookmarkId, queueStatus.FAILED)
      await this.bookmarkService.updateBookmarkParseQueueRetry(info.bookmarkId, info.retry.userIds || [], {
        status: bookmarkFetchRetryStatus.FAILED
      })
    }
  }

  // 处理回调
  async processPostHandler(ctx: ContextManager, taskInfo: receiveQueueParseMessage | receiveThirdPartyMessage, parseRes: { title: string; textContent: string; byline?: string }) {
    const userId = taskInfo.info.userId
    const bookmarkId = taskInfo.info.bookmarkId
    const hostname = taskInfo.info.targetTitle ? new URL(taskInfo.info.targetUrl).hostname || 'unknown' : 'unknown'

    // 处理telegram回调
    const telegramCallback = async () => {
      if (taskInfo.info.callback !== callbackType.CALLBACK_TELEGRAM) return

      const hashid = new Hashid(ctx.env, userId)
      const encodeBmId = hashid.encodeId(taskInfo.info.bookmarkId)

      console.log(`telegram callback, bookmarkId: ${taskInfo.info.bookmarkId}, payload: ${JSON.stringify(taskInfo.info.callbackPayload)}`)
      await this.telegramBotSvc.callback(encodeBmId, taskInfo.info.callbackPayload)
    }

    // 处理搜索回调
    const searchCallback = async () => {
      try {
        console.log(`add search record, bookmarkId: ${taskInfo.info.bookmarkId}`)
        const results = await this.searchSvc.addSearchRecord(ctx, taskInfo.info.bookmarkId, parseRes.title, parseRes.textContent)
        const rejected = (results || []).filter((r): r is PromiseRejectedResult => r.status === 'rejected')

        if (rejected.length > 0) {
          const errMsg = rejected.map(r => (r.reason instanceof Error ? r.reason.message : String(r.reason))).join('; ')
          throw new Error(errMsg)
        }

        await this.logsService.track(userId, 'bookmark_add_step', {
          bookmark_id: bookmarkId,
          domain: hostname,
          step_name: 'embedding',
          status: 'success'
        })
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        console.error(`add search record failed: ${errMsg}`)
        await this.logsService.track(userId, 'bookmark_add_step', {
          bookmark_id: bookmarkId,
          domain: hostname,
          step_name: 'embedding',
          status: 'failed',
          error_reason: errMsg
        })
        // search/embedding 失败也告警 — 用户搜不到自己的书签是个静默的灾难
        await this.crawlSvc.pushBookmarkFailureAlert(userId, 'embedding', {
          bookmark_id: bookmarkId,
          url: taskInfo.info.targetUrl,
          domain: hostname,
          error: errMsg
        })
      }
    }

    // 处理标签和概述回调
    const tagsAndOverviewCallback = async () => {
      try {
        // check subscription and source
        if (taskInfo.info.ignoreGenerateTag) {
          console.log(`bookmark ${taskInfo.info.bookmarkId} has ignoreGenerateTag=true, skip tags and overview generation`)
          return
        }

        const subInfo = await this.userSvc.getUserSubscriptionInfo(ctx)
        if (!subInfo || !subInfo.subscription_end_at || subInfo.subscription_end_at.getTime() < new Date().getTime()) {
          console.log(`user ${ctx.getUserId()} is not subscribed, skip tags and overview callback`)
          return
        }

        if (isProhibitedContentUrl(taskInfo.info.targetUrl)) {
          console.log(`bookmark ${taskInfo.info.bookmarkId} url is prohibited content, skip tags and overview generation`)
          return
        }

        const bookmark = await this.bookmarkSvc.getBookmarkById(taskInfo.info.bookmarkId)
        if (bookmark && bookmark.moderation_result > 0) {
          console.log(`bookmark ${taskInfo.info.bookmarkId} moderation_result=${bookmark.moderation_result}, skip tags and overview generation`)
          return
        }

        // 并发获取用户信息和标签
        const [userInfo, userTags] = await Promise.all([
          this.userSvc.getUserInfo(ctx),
          this.tagSvc.listUserTags(ctx).then(tags => tags.map(item => ({ id: item.id, name: item.name, source: item.source })))
        ])

        if (!userInfo) {
          console.log(`genrate tags and overview failed, user info not found`)
          return
        }
        ctx.set('ai_lang', userInfo.ai_lang)

        const result = await this.aigcSvc.generateOverviewTag(ctx, parseRes.title, parseRes.textContent, parseRes.byline || '', userTags)

        // 写入overview
        if (result.overview.length > 0) {
          try {
            const overview = JSON.stringify({ overview: result.overview || '', key_takeaways: result.key_takeaways })
            await this.bookmarkSvc.createBookmarkOverview(userId, bookmarkId, '', overview)
          } catch (e) {
            console.log(`create bookmark overview failed: ${e}`)
          }
        }
        if (result.tags.length > 0) {
          // 写入前判断是否已经存在过Tags了，如果存在过了就跳过处理
          const bookmarkTags = await this.tagSvc.getBookmarkTags(ctx, userId, bookmarkId)
          if (bookmarkTags.length > 0) return

          // mine first, then auto, capped at 3
          const availableTags = pickTagsForBookmark(result.tags, userTags).map(tag => tag.name)
          if (availableTags.length < 1) return

          // 并发执行标签更新操作
          const updateRes = await this.tagSvc.updateUserTagsDisplay(userId, availableTags)
          if (!updateRes) return

          await this.tagSvc.upsertBookmarkTags(bookmarkId, userId, updateRes)
        }

        await this.logsService.track(userId, 'bookmark_add_step', {
          bookmark_id: bookmarkId,
          domain: hostname,
          step_name: 'generate_overview_and_tags',
          status: 'success'
        })
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        console.error(`Failed to create batch task for bookmark ${taskInfo.info.bookmarkId}: ${errMsg}`)
        await this.logsService.track(userId, 'bookmark_add_step', {
          bookmark_id: bookmarkId,
          domain: hostname,
          step_name: 'generate_overview_and_tags',
          status: 'failed',
          error_reason: errMsg
        })
        // tags/overview 是付费功能，对订阅用户来说静默失败影响很大
        await this.crawlSvc.pushBookmarkFailureAlert(userId, 'generate_overview_and_tags', {
          bookmark_id: bookmarkId,
          url: taskInfo.info.targetUrl,
          domain: hostname,
          error: errMsg
        })
      }
    }

    // 用户书签创建时间更新回调
    const updateUserBookmarkCreateAtCallback = async () => {
      try {
        await this.bookmarkSvc.updateUserBookmarkCreateAt(bookmarkId, userId, new Date())
      } catch (e) {
        console.error(`update user bookmark created at failed: ${e}`)
      }
    }

    // 处理回调；导入的书签保留导入时写入的保存时间，不再把 created_at 改成解析完成时间
    const callbacks = [telegramCallback(), searchCallback(), tagsAndOverviewCallback()]
    if (!taskInfo.info.importTaskId) callbacks.push(updateUserBookmarkCreateAtCallback())
    ctx.execution.waitUntil(Promise.allSettled(callbacks))
  }

  // 第三方 parse 失败时的统一处理：设 FAILED + 推飞书。
  // 不抛错，让批处理的下一条继续。
  private async handleThirdPartyParseError(platform: string, m: receiveThirdPartyMessage, err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`fetch ${platform} failed: ${errMsg}`)
    await this.bookmarkSvc.updateBookmarkStatus(m.info.bookmarkId, queueStatus.FAILED)
    const host = (() => {
      try {
        return new URL(m.info.targetUrl).hostname || 'unknown'
      } catch {
        return 'unknown'
      }
    })()
    await this.crawlSvc.sendAddBookmarkStepEvent(m.info.userId, m.info.bookmarkId, host, 'parsing', 'failed', `third_party:${platform}:${errMsg}`)
    await this.crawlSvc.pushBookmarkFailureAlert(m.info.userId, 'parse_third_party', {
      bookmark_id: m.info.bookmarkId,
      url: m.info.targetUrl,
      user_id: m.info.userId,
      platform,
      error: errMsg
    })
  }

  private async resolveUserBookmarkUuid(bookmarkId: number, userId: number): Promise<string> {
    const userBookmark = await this.bookmarkSvc.getUserBookmark(bookmarkId, userId)
    if (!userBookmark) throw new Error(`user_bookmark not found: bookmark=${bookmarkId} user=${userId}`)
    return userBookmark.uuid
  }

  // 🍠解析
  private parseXiaoHongshu = async (ctx: ContextManager, xhsMsgs: receiveThirdPartyMessage[]) => {
    if (xhsMsgs.length < 1) return

    for (const m of xhsMsgs) {
      try {
        const uuid = await this.resolveUserBookmarkUuid(m.info.bookmarkId, m.info.userId)
        const crawlResult = await this.crawlSvc.fetchAndSaveXiaohongshu(ctx, m.info.targetUrl, m.info.bookmarkId, uuid)
        await this.processPostHandler(ctx, m, crawlResult)
      } catch (e) {
        await this.handleThirdPartyParseError('xiaohongshu', m, e)
      }
    }
  }

  // 🐦解析
  private parseTwitter = async (ctx: ContextManager, twitterMsgs: receiveThirdPartyMessage[]) => {
    if (twitterMsgs.length < 1) return

    for (const m of twitterMsgs) {
      try {
        const resolvedUrl = m.info.targetUrl
        const bookmarkId = m.info.bookmarkId
        const uuid = await this.resolveUserBookmarkUuid(bookmarkId, m.info.userId)
        let crawlResult: CrawlResult | null = null

        if (TWITTER_STATUS_RE.test(resolvedUrl)) {
          // Twitter - 只匹配推文页面 (必须包含 /status/数字ID)
          console.log('Detected Twitter URL, using Twitter fetcher')
          crawlResult = await this.crawlSvc.fetchAndSaveTwitter(ctx, resolvedUrl, bookmarkId, uuid)
        } else if (TWITTER_ARTICLE_RE.test(resolvedUrl)) {
          // Twitter - 只匹配文章页面 (必须包含 /article/数字ID)
          console.log('Detected Twitter URL, using Twitter fetcher')
          crawlResult = await this.crawlSvc.fetchAndSaveTwitterArticle(ctx, resolvedUrl, bookmarkId, uuid)
        }

        if (!crawlResult) {
          console.error(`fetch twitter failed, url not matched: ${resolvedUrl}`)
          throw new Error('URL not matched for Twitter fetcher')
        }

        await this.processPostHandler(ctx, m, crawlResult)
      } catch (e) {
        await this.handleThirdPartyParseError('twitter', m, e)
      }
    }
  }

  // 微博解析
  private parseWeibo = async (ctx: ContextManager, weiboMsgs: receiveThirdPartyMessage[]) => {
    if (weiboMsgs.length < 1) return

    for (const m of weiboMsgs) {
      try {
        const uuid = await this.resolveUserBookmarkUuid(m.info.bookmarkId, m.info.userId)
        const crawlResult = await this.crawlSvc.fetchAndSaveWeibo(ctx, m.info.targetUrl, m.info.bookmarkId, uuid)
        await this.processPostHandler(ctx, m, crawlResult)
      } catch (e) {
        await this.handleThirdPartyParseError('weibo', m, e)
      }
    }
  }

  // Reddit解析
  private parseReddit = async (ctx: ContextManager, redditMsgs: receiveThirdPartyMessage[]) => {
    if (redditMsgs.length < 1) return

    for (const m of redditMsgs) {
      try {
        const uuid = await this.resolveUserBookmarkUuid(m.info.bookmarkId, m.info.userId)
        const crawlResult = await this.crawlSvc.fetchAndSaveReddit(ctx, m.info.targetUrl, m.info.bookmarkId, uuid)
        await this.processPostHandler(ctx, m, crawlResult)
      } catch (e) {
        await this.handleThirdPartyParseError('reddit', m, e)
      }
    }
  }

  async processThirdPartyMessages(ctx: ContextManager, messages: receiveThirdPartyMessage[]) {
    console.log(`processThirdPartyMessages: ${messages.length}`)
    if (messages.length < 1) return

    // 检查是否有已经解析过的内容
    const res = await Promise.allSettled(
      messages.map(async message => {
        try {
          const res = await this.bookmarkSvc.getBookmarkTitleAndTextContentTry(message.info.bookmarkId)
          if (!res) return message.info.targetUrl

          if (message.info.callback === callbackType.CALLBACK_TELEGRAM) {
            const hashid = new Hashid(ctx.env, message.info.userId)
            const encodeBmId = hashid.encodeId(message.info.bookmarkId)
            await this.telegramBotSvc.callback(encodeBmId, message.info.callbackPayload)
          }
        } catch (err) {
          console.log(`parse ${message.id} ${message.info.targetUrl} cache failed: ${err}`)
          return message.info.targetUrl
        }
        return null
      })
    )

    // 过滤出没解析过的内容
    const unparsedMessages = messages.filter(m => res.some(r => r.status === 'fulfilled' && r.value === m.info.targetUrl))

    // 按平台分组（使用 platformDetector 统一路由）
    const twitterMsgs: receiveThirdPartyMessage[] = []
    const xhsMsgs: receiveThirdPartyMessage[] = []
    const weiboMsgs: receiveThirdPartyMessage[] = []
    const redditMsgs: receiveThirdPartyMessage[] = []

    for (const m of unparsedMessages) {
      const route = detectRoute(m.info.targetUrl)
      switch (route) {
        case 'twitter':
        case 'twitter_article':
          twitterMsgs.push(m)
          break
        case 'xhs':
          xhsMsgs.push(m)
          break
        case 'weibo':
          weiboMsgs.push(m)
          break
        case 'reddit':
          redditMsgs.push(m)
          break
      }
    }

    console.log(`twitterMsgs: ${twitterMsgs.length}, xhsMsgs: ${xhsMsgs.length}, weiboMsgs: ${weiboMsgs.length}, redditMsgs: ${redditMsgs.length}`)

    await Promise.all([this.parseXiaoHongshu(ctx, xhsMsgs), this.parseTwitter(ctx, twitterMsgs), this.parseWeibo(ctx, weiboMsgs), this.parseReddit(ctx, redditMsgs)])
  }
}
