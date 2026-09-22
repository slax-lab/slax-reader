import { SocialMediaApi } from '../infra/external/socialMedia'
import { SlaxFetch } from '../infra/external/remoteFetcher'
import { HtmlBuilder, YoutubeCue } from '../utils/htmlBuilder'
import { extractYoutubeVideoId } from '../utils/platformDetector'
import { captionPlainText, captionSourceHash, youtubeCaptionKeys, type YoutubeCaptionDocument } from '../utils/youtubeCaption'
import { evaluateYoutubeEligibility } from '../utils/youtubeEligibility'
import { YoutubeArticleRepo, YOUTUBE_ARTICLE_PROMPT_VERSION, YOUTUBE_ARTICLE_SCHEMA_VERSION } from '../infra/repository/dbYoutubeArticle'
import { parseHTML } from 'linkedom'
import { Imager } from '../utils/imager'
import { ContentParser } from '../utils/parser'
import { ZyteTimeoutError } from '../const/err'
import { fetchResult } from '../utils/browser'
import { BucketClient } from '../infra/repository/bucketClient'
import { BookmarkRepo, queueStatus } from '../infra/repository/dbBookmark'
import { inject, injectable } from '@/decorators/di'
import { LazyInstance } from '@/decorators/lazy'
import { ContextManager } from '@/utils/context'
import { CrawlWorkflowParams } from '@/entry/edge/workflows/crawlWorkflow'
import { ImportParseWorkflowParams } from '@/entry/edge/workflows/importParseWorkflow'
import { Preparse } from '@/utils/parserUtils/type'
import { LogsService } from './logs'
import { SlaxAlertBotClient } from '@/infra/external/slaxAlertBot'
import type { XHSData, WeiboData } from '@/const/moreapi/base'
import type { RedditData } from '@/const/moreapi/reddit'
import { TikHubWeixinContent, isWeixinImageShower } from '@/const/moreapi/weixin'
import { ErrorName } from '../const/err'
import type { TweetInfo, TweetArticleInfo } from '@/const/twitterapi/struct'
import { MultiLangError } from '@/utils/multiLangError'
import { detectRoute, TWITTER_ARTICLE_RE, TWITTER_SHORT_STATUS_RE } from '../utils/platformDetector'
import { FetchThreePartyError } from '../const/err'
import { scoreArticleQuality, unavailableArticleQualityReview, type ArticleQualityReview, type ParserQualitySummary } from '../utils/articleQualityScoring'
import { bookmarkEventProperties, EVENT_CONTEXT_KEY, getEventContext, submitServerEvent } from './events'

export type TwitterFetched =
  | { kind: 'tweet'; tweetInfo: TweetInfo; quoteTweetHtml: string }
  | { kind: 'article'; sourceUrl: string; viaFxEmbedHtml: string | null; fallbackTweetInfo: TweetArticleInfo | null }

export type ZhihuFetched = { title: string; content: string; author: string }

export interface CrawlResult {
  title: string
  textContent: string
  excerpt?: string
  byline?: string
  siteName?: string
  publishedTime?: Date
  contentKey?: string
  qualityReview?: ArticleQualityReview
}

export type WeixinFetched = { source: 'tikhub'; content: TikHubWeixinContent } | { source: 'legacy'; fetchRes: fetchResult }

/** 微信业务终止错误：不兜底不重试 */
const isWeixinBusinessTerminal = (e: unknown): boolean => e instanceof Error && (e.name === ErrorName.WEIXIN_ENV_ABNORMAL || e.name === ErrorName.DAJIALA_ARTICLE_UNAVAILABLE)

export interface YoutubeFetched {
  videoId: string
  title: string
  author: string
  authorUrl: string
  thumbnail: string
  cues: YoutubeCue[]
  /** Normalized caption (milliseconds, duration, track, kind); null when the video has no captions. */
  caption: YoutubeCaptionDocument | null
  hasCaption: boolean
  captionFetchFailed?: boolean
}

interface YoutubeOembed {
  title?: string
  author_name?: string
  author_url?: string
  thumbnail_url?: string
}

@injectable()
export class CrawlService {
  static shortLinkDomains = ['t.cn', 'xhslink.com', 't.co', 'redd.it', 'mapp.api.weibo.cn']
  constructor(
    @inject(BucketClient) private bucketClient: LazyInstance<BucketClient>,
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo,
    @inject(LogsService) private logsService: LogsService,
    @inject(SlaxAlertBotClient) private alertBot: SlaxAlertBotClient,
    @inject(YoutubeArticleRepo) private youtubeArticleRepo: YoutubeArticleRepo
  ) {}

  public async pushBookmarkFailureAlert(userId: number, scope: string, meta: Record<string, unknown>) {
    const headline = `🚨 **Bookmark ${scope} Failed**`
    const body = Object.entries(meta)
      .map(([k, v]) => `**${k}**: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join('\n')

    await this.alertBot.crawl.pushMessage(`${headline}\n${body}`).catch((e: unknown) => {
      console.error(`pushBookmarkFailureAlert feishu push failed (scope=${scope}): ${e}`)
    })
  }

  public async createWorkflow(env: Env, params: CrawlWorkflowParams, maxRetries: number = 3, trackingContext?: ContextManager) {
    if (trackingContext?.get(EVENT_CONTEXT_KEY)) params = { ...params, eventContext: { ...getEventContext(trackingContext) } }
    const hostname = (() => {
      try {
        return new URL(params.url).hostname || 'unknown'
      } catch {
        return 'unknown'
      }
    })()
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await env.CRAWL_WORKFLOW.create({ params })
        await this.sendAddBookmarkStepEvent(params.userId, params.bookmarkId, hostname, 'workflow_creation', 'success')
        break
      } catch (err) {
        console.log(`Failed to create workflow for bookmark ${params.bookmarkId} (attempt ${attempt}/${maxRetries}): ${err}`)

        if (attempt === maxRetries) {
          await this.bookmarkRepo.updateBookmarkStatus(params.bookmarkId, queueStatus.FAILED)
          const errMsg = err instanceof MultiLangError ? err.message : err instanceof Error ? err.message : String(err)
          await this.sendAddBookmarkStepEvent(params.userId, params.bookmarkId, hostname, 'workflow_creation', 'failed', errMsg, trackingContext)
          await this.pushBookmarkFailureAlert(params.userId, 'workflow_creation', {
            bookmark_id: params.bookmarkId,
            url: params.url,
            user_id: params.userId,
            domain: hostname,
            attempts: maxRetries,
            error: errMsg
          })
          throw err
        }

        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)))
      }
    }
  }

  public async createImportParseWorkflow(env: Env, params: ImportParseWorkflowParams, maxRetries: number = 3, trackingContext?: ContextManager) {
    if (trackingContext?.get(EVENT_CONTEXT_KEY)) params = { ...params, eventContext: { ...getEventContext(trackingContext), source: 'import' } }
    const hostname = (() => {
      try {
        return new URL(params.url).hostname || 'unknown'
      } catch {
        return 'unknown'
      }
    })()
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await env.IMPORT_PARSE_WORKFLOW.create({ params })
        await this.sendAddBookmarkStepEvent(params.userId, params.bookmarkId, hostname, 'import_parse_workflow_creation', 'success')
        break
      } catch (err) {
        console.log(`Failed to create import parse workflow for bookmark ${params.bookmarkId} (attempt ${attempt}/${maxRetries}): ${err}`)

        if (attempt === maxRetries) {
          await this.bookmarkRepo.updateBookmarkStatus(params.bookmarkId, queueStatus.FAILED)
          const errMsg = err instanceof MultiLangError ? err.message : err instanceof Error ? err.message : String(err)
          await this.sendAddBookmarkStepEvent(params.userId, params.bookmarkId, hostname, 'import_parse_workflow_creation', 'failed', errMsg, trackingContext)
          await this.pushBookmarkFailureAlert(params.userId, 'import_parse_workflow_creation', {
            bookmark_id: params.bookmarkId,
            url: params.url,
            user_id: params.userId,
            domain: hostname,
            attempts: maxRetries,
            error: errMsg
          })
          throw err
        }

        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)))
      }
    }
  }

  public async resolveShortLink(ctx: ContextManager, url: string): Promise<string> {
    const urlObj = new URL(url)
    const isShortLink = CrawlService.shortLinkDomains.includes(urlObj.hostname)
    if (!isShortLink) return url

    try {
      const fetcher = new SlaxFetch(ctx.env)
      const res = await fetcher.head(url)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.location) {
        return res.location
      }
      return url
    } catch (err) {
      console.log(`Failed to resolve short link for ${url}: ${err}`)
      return url
    }
  }

  private static extractTweetId(url: string): string {
    const match = url.match(/\/status\/([0-9]+)\??/)
    const tweetId = match?.[1]
    if (!tweetId) throw FetchThreePartyError('Invalid Twitter URL')
    return tweetId
  }

  private async fetchTweet(env: Env, url: string) {
    const tweetId = CrawlService.extractTweetId(url)
    const tweets = await SocialMediaApi.fetchTwitter(env, [tweetId])
    if (tweets.length === 0) throw FetchThreePartyError('Failed to fetch tweet')
    return { tweetId, tweetInfo: tweets[0] }
  }

  public async resolveFinalUrl(ctx: ContextManager, url: string): Promise<string> {
    if (TWITTER_SHORT_STATUS_RE.test(url)) {
      const { tweetId, tweetInfo } = await this.fetchTweet(ctx.env, url)
      return `https://x.com/${tweetInfo.author.userName}/status/${tweetId}`
    }

    return url
  }

  public async fetchAndSaveTwitter(ctx: ContextManager, url: string, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    const fetched = await this.fetchTwitterData(ctx, url)
    return await this.parseAndSaveTwitter(ctx, fetched, bookmarkId, userBookmarkUuid)
  }

  public async fetchAndSaveTwitterArticle(ctx: ContextManager, url: string, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    const fetched = await this.fetchTwitterData(ctx, url)
    return await this.parseAndSaveTwitter(ctx, fetched, bookmarkId, userBookmarkUuid)
  }

  /**
   * 抓取并保存小红书
   */
  public async fetchAndSaveXiaohongshu(ctx: ContextManager, url: string, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    const data = await this.fetchXhsData(ctx.env, url)
    return await this.parseAndSaveXhs(ctx, data, url, bookmarkId, userBookmarkUuid)
  }

  /**
   * 抓取并保存微博（thin wrapper，实际逻辑在 fetchWeiboData + parseAndSaveWeibo）
   */
  public async fetchAndSaveWeibo(ctx: ContextManager, url: string, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    const data = await this.fetchWeiboData(ctx.env, url)
    return await this.parseAndSaveWeibo(ctx, data, url, bookmarkId, userBookmarkUuid)
  }

  /**
   * 抓取并保存Reddit（thin wrapper，实际逻辑在 fetchRedditData + parseAndSaveReddit）
   */
  public async fetchAndSaveReddit(ctx: ContextManager, url: string, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    const data = await this.fetchRedditData(ctx.env, url)
    return await this.parseAndSaveReddit(ctx, data, url, bookmarkId, userBookmarkUuid)
  }

  public async fetchWithFxEmbed(ctx: ContextManager, url: string) {
    try {
      const fetchUrl = `https://slaxfxembed.workers.dev/twitter${new URL(url).pathname}`
      const tweetRes = await this.fetchWithTelegramBotHeader(ctx, fetchUrl)
      const tweetDocument = await ContentParser.getDocument(tweetRes)

      return {
        document: tweetDocument
      }
    } catch (err) {
      console.log(`Failed to fetch Twitter article with fxembed for ${url}: ${err}`)
      throw err
    }
  }

  /**
   * 抓取普通网页
   */
  public async fetchRegular(ctx: ContextManager, url: string): Promise<fetchResult> {
    const fetcher = new SlaxFetch(ctx.env)
    const urlObj = new URL(url)

    const USE_BROWSER_HTML = [
      'mp.weixin.qq.com',
      'zhihu.com',
      'infoq.cn',
      'xueqiu.com',
      'youtube.com',
      'google.com',
      'toutiao.com',
      'msn.cn',
      'imixs.org',
      'binance.com',
      'wiley.com',
      'x.com',
      'twitter.com',
      'circuitbread.com',
      'quora.com',
      'chrisrichardson.net',
      'huawei.com',
      'mowen.cn',
      'linkedin.com',
      'wallstreetcn.com'
    ]
    const useBrowserHtml = USE_BROWSER_HTML.some(h => urlObj.hostname.endsWith(h))
    console.log(`using browser html for ${url}: ${useBrowserHtml}`)

    try {
      return await fetcher.zyte(url, useBrowserHtml)
    } catch (zyteErr) {
      console.log(`Zyte fetch failed for ${url}: ${zyteErr}`)
    }
    try {
      return await fetcher.scrapingBot(url, useBrowserHtml)
    } catch (scrapingErr) {
      console.log(`ScrapingBot fetch failed for ${url}: ${scrapingErr}`)
    }
    throw ZyteTimeoutError()
  }

  public async fetchZhihuData(env: Env, url: string): Promise<ZhihuFetched> {
    const zhihu = await SocialMediaApi.fetchZhihuByUrl(env, url)
    if (!zhihu) throw FetchThreePartyError('Unsupported Zhihu URL')
    return zhihu
  }

  public async fetchDajiala(ctx: ContextManager, url: string): Promise<fetchResult> {
    const fetcher = new SlaxFetch(ctx.env)
    return await fetcher.dajiala(url)
  }

  public async fetchWithTelegramBotHeader(ctx: ContextManager, url: string) {
    try {
      const resp = await ctx.env.SlaxTwitterFxembed.fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'TelegramBot (like TwitterBot)'
        }
      })

      if (!resp.ok) {
        throw FetchThreePartyError(`Failed to fetch ${url} with TelegramBot header, status: ${resp.status}`)
      }

      const respData = await resp.text()
      return respData
    } catch (err) {
      console.log(`Failed to fetch ${url} with TelegramBot header: ${err}`)
      throw err
    }
  }

  private static contentKeys(userBookmarkUuid: string) {
    return {
      contentKey: `html/body/${userBookmarkUuid}.html`,
      textKey: `text/body/${userBookmarkUuid}.txt`
    }
  }

  /**
   * 抓取 YouTube 视频数据：oembed 直连拿元信息（省 zyte 费用）+ TikHub 抓字幕（原语言优先，用户语言兜底）。
   * 字幕抓取整段降级：失败 / 无字幕 → cues=[], caption=null, hasCaption=false，不抛错。
   */
  public async fetchYoutubeData(ctx: ContextManager, url: string): Promise<YoutubeFetched> {
    const videoId = extractYoutubeVideoId(url)
    if (!videoId) throw FetchThreePartyError(`Invalid YouTube URL: ${url}`)

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`

    // oembed：限制不高，普通 fetch 直连，不走 zyte
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`
    const oembedResp = await fetch(oembedUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SlaxReaderBot/1.0)' } })
    if (!oembedResp.ok) {
      throw FetchThreePartyError(`YouTube oembed failed: ${oembedResp.status} for ${watchUrl}`)
    }
    const oembed = (await oembedResp.json()) as YoutubeOembed

    // 字幕：TikHub 列轨道 → 原语言优先选轨 → json3 解析；整段降级
    let cues: YoutubeCue[] = []
    let caption: YoutubeCaptionDocument | null = null
    let captionFetchFailed = false
    try {
      ;({ cues, caption } = await SocialMediaApi.fetchYoutubeCaption(ctx.env, videoId, ctx.getlang()))
    } catch (err) {
      captionFetchFailed = true
      console.error(
        JSON.stringify({ event: 'youtube_caption_fetch_failed', video_id: videoId, reason: 'caption_fetch_failed', error: err instanceof Error ? err.message : String(err) })
      )
    }

    return {
      videoId,
      title: oembed.title || 'YouTube',
      author: oembed.author_name || '',
      authorUrl: oembed.author_url || '',
      thumbnail: oembed.thumbnail_url || '',
      cues,
      caption,
      captionFetchFailed,
      hasCaption: cues.length > 0
    }
  }

  public async parseAndSaveYoutube(ctx: ContextManager, fetched: YoutubeFetched, originalUrl: string, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    const html = HtmlBuilder.buildYoutube(fetched.videoId, fetched.cues)
    const textContent = fetched.cues.length > 0 ? fetched.cues.map(c => c.text).join(' ') : fetched.title

    const result = await this.parseAndSaveSocialMedia(ctx, {
      html,
      originalUrl,
      bookmarkId,
      userBookmarkUuid,
      meta: {
        title: fetched.title,
        textContent,
        excerpt: fetched.title.substring(0, 50),
        byline: fetched.author,
        siteName: 'YouTube',
        publishedTime: new Date()
      }
    })
    await this.saveYoutubeCaptionArtifacts(ctx, fetched, bookmarkId)
    return result
  }

  /**
   * YouTube AI article, P0: store the normalized caption under canonical, versioned R2 keys
   * (youtube/canonical/captions/{videoId}/{sourceHash}) next to the untouched html/body + text/body
   * objects, run the eligibility rules in shadow mode, record one canonical job row per caption
   * source and point this bookmark at it. Never throws: the bookmark is already saved and its
   * status must not depend on any of this. Logs carry ids, hashes and counts only, never the transcript.
   */
  private async saveYoutubeCaptionArtifacts(ctx: ContextManager, fetched: YoutubeFetched, bookmarkId: number): Promise<void> {
    const { videoId, caption } = fetched
    // An unavailable provider is not evidence that the video has no captions. Do not overwrite
    // the shared no-caption evaluation (or its bookmark reference) with a transient failure.
    if (fetched.captionFetchFailed) {
      console.error(JSON.stringify({ event: 'youtube_caption_save_degraded', bookmark_id: bookmarkId, video_id: videoId, reason: 'caption_fetch_failed' }))
      return
    }
    try {
      const sourceHash = await captionSourceHash(caption, videoId)
      const plainText = caption ? captionPlainText(caption) : ''
      let captionKey: string | null = null
      let captionTextKey: string | null = null
      if (caption) {
        const keys = youtubeCaptionKeys(videoId, sourceHash)
        await Promise.all([this.bucketClient().putIfKeyExists(keys.captionKey, JSON.stringify(caption)), this.bucketClient().putIfKeyExists(keys.captionTextKey, plainText)])
        captionKey = keys.captionKey
        captionTextKey = keys.captionTextKey
      }

      const eligibility = evaluateYoutubeEligibility({
        title: fetched.title,
        language: caption?.language ?? '',
        kind: caption?.kind ?? 'unknown',
        cues: caption?.cues ?? [],
        plainText
      })
      await this.youtubeArticleRepo.recordEvaluation({
        video_id: videoId,
        caption_key: captionKey,
        caption_text_key: captionTextKey,
        caption_language: caption?.language ?? null,
        caption_kind: caption?.kind ?? null,
        source_hash: sourceHash,
        prompt_version: YOUTUBE_ARTICLE_PROMPT_VERSION,
        schema_version: YOUTUBE_ARTICLE_SCHEMA_VERSION,
        status: eligibility.decision === 'generate' ? 'pending' : 'skipped',
        eligibility
      })
      await this.youtubeArticleRepo.linkBookmark({ bookmark_id: bookmarkId, user_id: ctx.getUserId(), video_id: videoId, source_hash: sourceHash })
      console.log(
        `YouTube caption saved for bookmark ${bookmarkId}: video=${videoId} hash=${sourceHash.slice(0, 12)} cues=${caption?.cues.length ?? 0} chars=${plainText.length} decision=${eligibility.decision} reasons=${eligibility.reason_codes.join(',') || '-'}`
      )
    } catch (err) {
      console.error(`YouTube caption artifacts failed for bookmark ${bookmarkId} (video ${videoId}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  public async parseAndSaveContent(ctx: ContextManager, fetchRes: fetchResult, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    if (detectRoute(fetchRes.url) === 'regular') {
      const selected = await this.createBestParseRes(ctx, fetchRes)
      return await this.saveParseRes(selected.parseRes, bookmarkId, userBookmarkUuid, selected.qualityReview)
    }

    const parseRes = await this.createParseRes(ctx, fetchRes)
    let qualityReview: ArticleQualityReview
    try {
      qualityReview = scoreArticleQuality({
        sourceHtml: fetchRes.content,
        candidateHtml: parseRes.contentDocument.documentElement.outerHTML,
        url: fetchRes.url
      })
    } catch (error) {
      console.warn(`Article quality scoring failed for ${fetchRes.url}: ${error instanceof Error ? error.message : String(error)}`)
      qualityReview = unavailableArticleQualityReview()
    }
    return await this.saveParseRes(parseRes, bookmarkId, userBookmarkUuid, qualityReview)
  }

  private async createBestParseRes(ctx: ContextManager, fetchRes: fetchResult): Promise<{ parseRes: Preparse; qualityReview: ArticleQualityReview }> {
    const candidates = await ContentParser.parseCandidates({ url: new URL(fetchRes.url), content: fetchRes.content, title: fetchRes.title })
    const reviews: ParserQualitySummary[] = []
    const evaluated = candidates.flatMap(candidate => {
      if (!candidate.parseRes) {
        reviews.push({ parser: candidate.parser, review: unavailableArticleQualityReview(), error: candidate.error })
        return []
      }

      let review: ArticleQualityReview
      try {
        review = scoreArticleQuality({
          sourceHtml: fetchRes.content,
          candidateHtml: candidate.parseRes.contentDocument.documentElement.outerHTML,
          url: fetchRes.url
        })
      } catch (error) {
        review = unavailableArticleQualityReview()
        candidate.error = error instanceof Error ? error.message : String(error)
      }

      reviews.push({ parser: candidate.parser, review, error: candidate.error })
      return [{ ...candidate, review }]
    })

    const priority: Record<string, number> = { readability: 0, defuddle: 1 }
    const ranked = evaluated
      .filter(candidate => candidate.review.score !== null)
      .sort((left, right) => {
        const leftEmpty = left.review.hardFailures.includes('candidate_empty') ? 1 : 0
        const rightEmpty = right.review.hardFailures.includes('candidate_empty') ? 1 : 0
        return (
          leftEmpty - rightEmpty ||
          (right.review.score || 0) - (left.review.score || 0) ||
          (right.review.textF2 || 0) - (left.review.textF2 || 0) ||
          (right.review.structure || 0) - (left.review.structure || 0) ||
          left.review.hardFailures.length - right.review.hardFailures.length ||
          priority[left.parser] - priority[right.parser]
        )
      })

    if (!ranked.length) {
      const fallback = await this.createParseRes(ctx, fetchRes)
      return { parseRes: fallback, qualityReview: unavailableArticleQualityReview() }
    }

    const winner = ranked[0]
    const qualityReview: ArticleQualityReview = {
      ...winner.review,
      selectedParser: winner.parser,
      parserReviews: reviews
    }
    await new Imager(ctx.env).batchReplaceImage(new URL(fetchRes.url), winner.parseRes!.contentDocument)
    return { parseRes: winner.parseRes!, qualityReview }
  }

  protected async createParseRes(ctx: ContextManager, fetchRes: fetchResult) {
    const uUrl = new URL(fetchRes.url)
    const parseRes = await ContentParser.parse({ url: uUrl, content: fetchRes.content, title: fetchRes.title })
    await new Imager(ctx.env).batchReplaceImage(uUrl, parseRes.contentDocument)

    return parseRes
  }

  protected async saveParseRes(parseRes: Preparse, bookmarkId: number, userBookmarkUuid: string, qualityReview?: ArticleQualityReview): Promise<CrawlResult> {
    const { contentKey, textKey } = CrawlService.contentKeys(userBookmarkUuid)

    await Promise.all([
      this.bucketClient().putIfKeyExists(textKey, parseRes.textContent),
      this.bucketClient().putIfKeyExists(contentKey, parseRes.contentDocument.documentElement.outerHTML)
    ])
    await this.bookmarkRepo.updateBookmark(bookmarkId, {
      title: parseRes.title,
      description: parseRes.excerpt || '',
      content_word_count: parseRes.textContent.length,
      content_key: contentKey,
      content_md_key: textKey,
      status: queueStatus.SUCCESS,
      byline: parseRes.byline || '',
      site_name: parseRes.siteName || '',
      published_at: parseRes.publishedTime
    })

    return {
      title: parseRes.title,
      textContent: parseRes.textContent,
      excerpt: parseRes.excerpt,
      byline: parseRes.byline,
      siteName: parseRes.siteName,
      publishedTime: parseRes.publishedTime,
      contentKey,
      qualityReview
    }
  }

  public async fetchTwitterData(ctx: ContextManager, url: string): Promise<TwitterFetched> {
    // /article/数字 — 直接走 article 路径
    if (TWITTER_ARTICLE_RE.test(url)) {
      return await this.fetchTwitterArticleData(ctx, url)
    }

    // 普通 tweet
    const { tweetId, tweetInfo } = await this.fetchTweet(ctx.env, url)

    // /i/article/ 使用内部 ID，但 article API 必须传原始 status ID。
    if (/^https:\/\/t\.co\/[a-zA-Z0-9]+$/.test(tweetInfo.text.trim())) {
      const resolvedUrl = await this.resolveShortLink(ctx, tweetInfo.text.trim())
      if (/\/(?:i\/)?article\/\d+/i.test(resolvedUrl)) {
        const articleUrl = `https://x.com/${tweetInfo.author.userName}/article/${tweetId}`
        try {
          const article = await SocialMediaApi.fetchTwitterArticle(ctx.env, tweetId)
          return { kind: 'article', sourceUrl: articleUrl, viaFxEmbedHtml: null, fallbackTweetInfo: article }
        } catch (articleErr) {
          console.log(`Failed to fetch Twitter article for ${url}, falling back to tweet: ${articleErr}`)
        }
      }
    }

    // 普通 tweet，可能带 quoted_tweet
    let quoteTweetHtml = ''
    if (tweetInfo.quoted_tweet) {
      try {
        const { document: quoteDoc } = await this.fetchWithFxEmbed(ctx, tweetInfo.quoted_tweet.url)
        // quote tweet 的图片代理替换 + html 构建必须在 fetch 阶段完成，
        // 因为 Document 对象无法通过 step.do 序列化。最终产出 quoteTweetHtml 是纯 string，可序列化。
        await new Imager(ctx.env).replaceHeadImage(new URL(tweetInfo.url), quoteDoc)
        await new Imager(ctx.env).batchReplaceImage(new URL(tweetInfo.url), quoteDoc)
        quoteTweetHtml = HtmlBuilder.buildQuoteTweet(quoteDoc)
      } catch (err) {
        console.log(`Failed to fetch quote tweet content for ${tweetInfo.quoted_tweet.url}: ${err}`)
      }
    }

    return { kind: 'tweet', tweetInfo, quoteTweetHtml }
  }

  private async fetchTwitterArticleData(ctx: ContextManager, url: string): Promise<TwitterFetched> {
    try {
      const fxRes = await this.fetchWithFxEmbed(ctx, url)
      // 序列化为 HTML string 以通过 Workflow step 的 structured-clone 序列化；
      // parse 阶段再 parseHTML 还原 Document。
      const html = fxRes.document.toString()
      return { kind: 'article', sourceUrl: url, viaFxEmbedHtml: html, fallbackTweetInfo: null }
    } catch (fxErr) {
      console.log(`fetchWithFxEmbed failed for ${url}, falling back to fetchTwitterArticle: ${fxErr}`)
      // article URL 格式: /article/数字ID，用独立正则提取（不能复用 extractTweetId，那个匹配 /status/）
      const match = url.match(/\/article\/([0-9]+)/)
      const articleId = match?.[1]
      if (!articleId) throw FetchThreePartyError('Invalid Twitter Article URL')
      const tweetInfo = await SocialMediaApi.fetchTwitterArticle(ctx.env, articleId)
      return { kind: 'article', sourceUrl: url, viaFxEmbedHtml: null, fallbackTweetInfo: tweetInfo }
    }
  }

  /**
   * parse 阶段：拿 TwitterFetched 构建 html + Imager + R2 + DB。
   */
  public async parseAndSaveTwitter(ctx: ContextManager, fetched: TwitterFetched, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    if (fetched.kind === 'article') {
      return await this.parseAndSaveTwitterArticleFromFetched(ctx, fetched, bookmarkId, userBookmarkUuid)
    }

    const { tweetInfo, quoteTweetHtml } = fetched
    const xHtml = HtmlBuilder.buildTweet(tweetInfo, quoteTweetHtml)
    const { document } = parseHTML(xHtml)
    await new Imager(ctx.env).batchReplaceImage(new URL(tweetInfo.url), document)

    const { contentKey, textKey } = CrawlService.contentKeys(userBookmarkUuid)
    const textContent = tweetInfo.text
    const cleanText = tweetInfo.text.replaceAll('\n', ' ')
    const title = `Tweet: ${cleanText.substring(0, 30)}`
    const byline = tweetInfo.author.name

    await Promise.all([this.bucketClient().putIfKeyExists(textKey, textContent), this.bucketClient().putIfKeyExists(contentKey, document.documentElement.outerHTML)])
    await this.bookmarkRepo.updateBookmark(bookmarkId, {
      title,
      description: cleanText.substring(0, 30),
      content_word_count: textContent.length,
      content_key: contentKey,
      content_md_key: textKey,
      status: queueStatus.SUCCESS,
      byline,
      site_name: 'Twitter',
      published_at: new Date(tweetInfo.createdAt)
    })

    return {
      title,
      textContent,
      excerpt: cleanText.substring(0, 20),
      byline,
      siteName: 'Twitter',
      publishedTime: new Date(tweetInfo.createdAt),
      contentKey
    }
  }

  private async parseAndSaveTwitterArticleFromFetched(
    ctx: ContextManager,
    fetched: Extract<TwitterFetched, { kind: 'article' }>,
    bookmarkId: number,
    userBookmarkUuid: string
  ): Promise<CrawlResult> {
    const { sourceUrl, viaFxEmbedHtml, fallbackTweetInfo } = fetched
    let parseRes: Preparse

    if (viaFxEmbedHtml) {
      // fetch 阶段序列化为 HTML string，这里还原为 Document
      const { document: tweetDocument } = parseHTML(viaFxEmbedHtml)
      await new Imager(ctx.env).replaceHeadImage(new URL(sourceUrl), tweetDocument)
      await new Imager(ctx.env).batchReplaceImage(new URL(sourceUrl), tweetDocument)
      const content = HtmlBuilder.buildTweetArticleWithDocument(tweetDocument)
      parseRes = await this.createParseRes(ctx, {
        url: sourceUrl,
        title: tweetDocument.querySelector('meta[property="og:title"]')?.getAttribute('content') || tweetDocument.querySelector('title')?.textContent || '',
        content
      })
    } else if (fallbackTweetInfo) {
      parseRes = await this.createParseRes(ctx, {
        url: sourceUrl,
        title: fallbackTweetInfo.title,
        content: HtmlBuilder.buildTweetArticle(fallbackTweetInfo)
      })
      const docContent = parseRes.contentDocument.documentElement.innerHTML
      const headerImageElement = fallbackTweetInfo.cover_media_img_url
        ? `<div class="tweet-media"><img src="${fallbackTweetInfo.cover_media_img_url}" alt="Tweet Media"></div>`
        : ''
      parseRes.contentDocument.documentElement.outerHTML = `<div class="tweet">${headerImageElement}<div class="tweet-content">${docContent}</div></div>`
      parseRes.title = fallbackTweetInfo.title
    } else {
      throw FetchThreePartyError('parseAndSaveTwitterArticle: neither fxembed nor fallback present')
    }

    return await this.saveParseRes(parseRes, bookmarkId, userBookmarkUuid)
  }

  // ---------------- 社交媒体通用 parse + save ----------------

  /**
   * 通用的社交媒体 parse + save 流程：
   * 1. 构建 HTML → 2. 解析 DOM → 3. 替换图片 → 4. 写 R2 → 5. 更新 DB
   */
  private async parseAndSaveSocialMedia(
    ctx: ContextManager,
    opts: {
      html: string
      originalUrl: string
      bookmarkId: number
      userBookmarkUuid: string
      meta: { title: string; textContent: string; excerpt: string; byline: string; siteName: string; publishedTime: Date }
    }
  ): Promise<CrawlResult> {
    const { document } = parseHTML(opts.html)
    await new Imager(ctx.env).batchReplaceImage(new URL(opts.originalUrl), document)

    const { contentKey, textKey } = CrawlService.contentKeys(opts.userBookmarkUuid)

    await Promise.all([this.bucketClient().putIfKeyExists(textKey, opts.meta.textContent), this.bucketClient().putIfKeyExists(contentKey, document.documentElement.outerHTML)])
    await this.bookmarkRepo.updateBookmark(opts.bookmarkId, {
      title: opts.meta.title,
      description: opts.meta.excerpt,
      content_word_count: opts.meta.textContent.length,
      content_key: contentKey,
      content_md_key: textKey,
      status: queueStatus.SUCCESS,
      byline: opts.meta.byline,
      site_name: opts.meta.siteName,
      published_at: opts.meta.publishedTime
    })

    return {
      title: opts.meta.title,
      textContent: opts.meta.textContent,
      excerpt: opts.meta.excerpt,
      byline: opts.meta.byline,
      siteName: opts.meta.siteName,
      publishedTime: opts.meta.publishedTime,
      contentKey
    }
  }

  // ---------------- 小红书 ----------------
  public async fetchXhsData(env: Env, url: string): Promise<XHSData> {
    const xhsData = await SocialMediaApi.fetchXhsByUrl(env, url)
    if (!xhsData) throw FetchThreePartyError('Failed to fetch xiaohongshu note')
    return xhsData
  }

  public async parseAndSaveXhs(ctx: ContextManager, xhsData: XHSData, originalUrl: string, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    return this.parseAndSaveSocialMedia(ctx, {
      html: HtmlBuilder.buildXhs(xhsData),
      originalUrl,
      bookmarkId,
      userBookmarkUuid,
      meta: {
        title: `RedNote By: ${xhsData.title}`,
        textContent: xhsData.desc,
        excerpt: xhsData.desc?.slice(0, 50) ?? '',
        byline: xhsData.user?.nickname ?? '',
        siteName: 'RedNote',
        publishedTime: xhsData.time ? new Date(xhsData.time) : new Date()
      }
    })
  }

  // ---------------- 微博 ----------------
  public async fetchWeiboData(env: Env, url: string): Promise<WeiboData> {
    const weiboData = await SocialMediaApi.fetchWeiboByUrl(env, url)
    if (!weiboData) throw FetchThreePartyError('Failed to fetch weibo post')
    return weiboData
  }

  public async parseAndSaveWeibo(ctx: ContextManager, weiboData: WeiboData, originalUrl: string, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    return this.parseAndSaveSocialMedia(ctx, {
      html: HtmlBuilder.buildWeibo(weiboData),
      originalUrl,
      bookmarkId,
      userBookmarkUuid,
      meta: {
        title: `Weibo by ${weiboData.user?.screen_name} (${weiboData.id})`,
        textContent: weiboData.text_raw || weiboData.text || '',
        excerpt: weiboData.text_raw?.substring(0, 20) ?? '',
        byline: weiboData.user?.screen_name ?? '',
        siteName: 'Weibo',
        publishedTime: weiboData.created_at ? new Date(weiboData.created_at) : new Date()
      }
    })
  }

  // ---------------- Reddit ----------------
  public async fetchRedditData(env: Env, url: string): Promise<RedditData> {
    const redditData = await SocialMediaApi.fetchReddit(env, url)
    if (!redditData) throw FetchThreePartyError('Failed to fetch reddit post')
    return redditData
  }

  public async parseAndSaveReddit(ctx: ContextManager, redditData: RedditData, originalUrl: string, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    return this.parseAndSaveSocialMedia(ctx, {
      html: HtmlBuilder.buildReddit(redditData),
      originalUrl,
      bookmarkId,
      userBookmarkUuid,
      meta: {
        title: redditData.title,
        textContent: `${redditData.title}\n\n${redditData.content}`,
        excerpt: redditData.content.substring(0, 50),
        byline: `u/${redditData.author.name}`,
        siteName: `r/${redditData.subreddit.name}`,
        publishedTime: new Date(redditData.createdAt)
      }
    })
  }

  public async parseAndSaveZhihu(ctx: ContextManager, data: ZhihuFetched, originalUrl: string, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    const { document } = parseHTML(data.content)
    document.querySelectorAll('noscript').forEach(node => node.remove())
    document.querySelectorAll('img').forEach(img => {
      img.setAttribute('srcset', '')

      const realSrc = img.getAttribute('data-actualsrc') || img.getAttribute('data-original') || img.getAttribute('data-src')
      if (realSrc) img.setAttribute('src', realSrc)
      img.removeAttribute('data-actualsrc')
      img.removeAttribute('data-original')
      img.removeAttribute('data-src')
      img.classList.remove('lazy')
    })
    const textContent = document.querySelector('article')?.textContent || ''
    return this.parseAndSaveSocialMedia(ctx, {
      html: document.documentElement.outerHTML,
      originalUrl,
      bookmarkId,
      userBookmarkUuid,
      meta: {
        title: data.title,
        textContent,
        excerpt: textContent.slice(0, 50),
        byline: data.author,
        siteName: 'Zhihu',
        publishedTime: new Date()
      }
    })
  }

  // ---------------- 微信公众号 ----------------

  /** fetch：TikHub 优先，失败兜底 legacy（业务终止仅再试一次，失败则保留原错误） */
  public async fetchWeixin(ctx: ContextManager, url: string): Promise<WeixinFetched> {
    try {
      const content = await SocialMediaApi.fetchWeixinArticle(ctx.env, url)
      return { source: 'tikhub', content }
    } catch (tikhubErr) {
      if (isWeixinBusinessTerminal(tikhubErr)) {
        try {
          return { source: 'legacy', fetchRes: await this.fetchWeixinLegacyRaw(ctx, url) }
        } catch {
          throw tikhubErr
        }
      }
      console.log(`tikhub weixin transient failed for ${url}, fallback to legacy: ${tikhubErr}`)
      return { source: 'legacy', fetchRes: await this.fetchWeixinLegacyRaw(ctx, url) }
    }
  }

  /** 旧抓取：带 __biz 优先 dajiala，否则 zyte */
  private async fetchWeixinLegacyRaw(ctx: ContextManager, url: string): Promise<fetchResult> {
    const hasBiz = /[?&]__biz=/.test(url)
    if (hasBiz) {
      try {
        return await this.fetchDajiala(ctx, url)
      } catch (e) {
        if (isWeixinBusinessTerminal(e)) throw e
        console.log(`dajiala fallback failed for ${url}, fallback to zyte: ${e}`)
        return await this.fetchRegular(ctx, url)
      }
    }
    return await this.fetchRegular(ctx, url)
  }

  /** parse：legacy 用 HTML；tikhub 合成 swiper/文章页后走 parseAndSaveContent */
  public async parseAndSaveWeixin(ctx: ContextManager, fetched: WeixinFetched, url: string, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    if (fetched.source === 'legacy') {
      return await this.parseAndSaveContent(ctx, fetched.fetchRes, bookmarkId, userBookmarkUuid)
    }

    const content = fetched.content
    const html = isWeixinImageShower(content) ? HtmlBuilder.buildWeixinShowerPage(content) : HtmlBuilder.buildWeixinArticlePage(content)
    return await this.parseAndSaveContent(ctx, { content: html, url, title: content.title }, bookmarkId, userBookmarkUuid)
  }

  public async sendAddBookmarkStepEvent(
    userId: number,
    bookmarkId: number,
    hostname: string,
    stepName: string,
    status: 'success' | 'failed',
    errorReason?: string,
    ctx?: ContextManager
  ) {
    await this.logsService.track(userId, 'bookmark_add_step', {
      bookmark_id: bookmarkId,
      domain: hostname,
      step_name: stepName,
      status,
      error_reason: errorReason
    })
    // Background maintenance and pre-upgrade jobs have no originating client; retain their legacy logs only.
    if (status === 'failed' && ctx?.get(EVENT_CONTEXT_KEY)) {
      try {
        const relation = await this.bookmarkRepo.getUserBookmarkWithDetail(bookmarkId, userId)
        if (relation?.bookmark)
          submitServerEvent(ctx, undefined, 'bookmark_save_failed', { ...bookmarkEventProperties(relation, getEventContext(ctx).source), error_class: stepName }, { userId })
      } catch (error) {
        console.error('[events] failed to report bookmark step:', error)
      }
    }
  }
}
