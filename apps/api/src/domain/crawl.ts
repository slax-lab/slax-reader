import { SocialMediaApi } from '../infra/external/socialMedia'
import { readerBookmarkUuid } from '@slax-reader/contracts'
import { forkError } from '@/utils/bookmarkForkError'
import { MediaSnapshotService } from './mediaSnapshot'
import { BookmarkForkRepo, type MediaSnapshotRef } from '@/infra/repository/dbBookmarkFork'
import type { MediaSnapshot } from '@/utils/mediaSnapshot'
import { SlaxFetch } from '../infra/external/remoteFetcher'
import { HtmlBuilder, YoutubeCue } from '../utils/htmlBuilder'
import { extractYoutubeVideoId, shouldUseBrowserHtml } from '../utils/platformDetector'
import { captionPlainText, captionSourceHash, youtubeCaptionKeys, type YoutubeCaptionDocument } from '../utils/youtubeCaption'
import { evaluateYoutubeEligibility } from '../utils/youtubeEligibility'
import { YoutubeArticleRepo, YOUTUBE_ARTICLE_PROMPT_VERSION, YOUTUBE_ARTICLE_SCHEMA_VERSION } from '../infra/repository/dbYoutubeArticle'
import { youtubeArticleLanguage } from '@/utils/youtubeArticle'
import { PodcastArticleRepo, PodcastEpisodeRepo, type podcastEpisodePO } from '../infra/repository/dbPodcastArticle'
import { fetchPublicText } from '@/infra/external/podcastFetch'
import {
  appleLookupUrl,
  classifyPodcastUrl,
  directAudioInfo,
  enrichFromFeed,
  findFeedItem,
  latestFeedEpisode,
  parseAppleUrl,
  parsePodcastFeed,
  parseXiaoyuzhouPage,
  pickAppleEpisode,
  podcastSourceId,
  spotifyInfo,
  type PodcastEpisodeInfo
} from '@/utils/podcastSource'
import { renderPodcastText } from '@/utils/podcastArticle'
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
import { detectRoute, TWITTER_SHORT_STATUS_RE } from '../utils/platformDetector'
import { FetchThreePartyError } from '../const/err'
import { scoreArticleQuality, unavailableArticleQualityReview, type ArticleQualityReview, type ParserQualitySummary } from '../utils/articleQualityScoring'
import { bookmarkEventProperties, EVENT_CONTEXT_KEY, getEventContext, submitServerEvent } from './events'
import { isToutiaoShareUrl, parseToutiaoArticleUrl, resolveToutiaoUrl } from '../utils/toutiaoUrl'
import type { ToutiaoArticle } from '../const/moreapi/toutiao'

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

const DYNAMIC_LOADING_PLACEHOLDER_RE = /^(?:加载中|正在加载中?|loading|pleasewait|cancel|ok|确定|取消|加载中确定删除吗取消确定|确定删除吗取消确定)+$/i

export const isDynamicLoadingPlaceholder = (title: string, textContent: string): boolean => {
  if (title.trim()) return false

  const normalizedText = textContent
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[·…:：,，.!！？?。]/g, '')

  return normalizedText.length > 0 && normalizedText.length <= 32 && DYNAMIC_LOADING_PLACEHOLDER_RE.test(normalizedText)
}

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
    @inject(YoutubeArticleRepo) private youtubeArticleRepo: YoutubeArticleRepo,
    @inject(PodcastEpisodeRepo) private podcastEpisodeRepo: PodcastEpisodeRepo,
    @inject(PodcastArticleRepo) private podcastArticleRepo: PodcastArticleRepo,
    @inject(MediaSnapshotService) private snapshots: MediaSnapshotService,
    @inject(BookmarkForkRepo) private snapshotRepo: BookmarkForkRepo
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
    if (readerBookmarkUuid(params.url, [env.FRONT_END_URL])) throw forkError()
    const raw = await this.snapshotRepo.snapshot(params.bookmarkId)
    if (!raw) throw forkError()
    params = { ...params, captureRevision: raw.updated_at.toISOString() }
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
          await this.snapshotRepo.setCaptureStatus(params.bookmarkId, new Date(params.captureRevision!), queueStatus.FAILED)
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
    const raw = await this.snapshotRepo.snapshot(params.bookmarkId)
    if (!raw) throw forkError()
    params = { ...params, captureRevision: raw.updated_at.toISOString() }
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
          await this.snapshotRepo.setCaptureStatus(params.bookmarkId, new Date(params.captureRevision!), queueStatus.FAILED)
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
    if (parseToutiaoArticleUrl(url) || isToutiaoShareUrl(url)) return (await resolveToutiaoUrl(url)).canonicalUrl
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

  private static normalizeCandidateUrl(value: string | undefined): string | null {
    if (!value) return null
    const trimmed = value.trim().replace(/[.,;:!?，。；：！？\])}]+$/g, '')
    if (!/^https?:\/\//i.test(trimmed)) return null
    try {
      return new URL(trimmed).toString()
    } catch {
      return null
    }
  }

  private static isTwitterArticleUrl(value: string): boolean {
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
      if (hostname !== 'x.com' && hostname !== 'twitter.com') return false
      return /^\/\w+\/article\/\d+\/?$/.test(parsed.pathname)
    } catch {
      return false
    }
  }

  private static isTwitterShortLink(value: string): boolean {
    try {
      const parsed = new URL(value)
      return parsed.hostname.toLowerCase() === 't.co' && /^\/[a-z0-9]+$/i.test(parsed.pathname)
    } catch {
      return false
    }
  }

  /** Find an X Article URL without treating arbitrary article-shaped external URLs as X content. */
  private async discoverTwitterArticleUrl(ctx: ContextManager, tweetInfo: TweetInfo): Promise<string | null> {
    const candidates: string[] = []
    const seen = new Set<string>()
    const entityRawUrls = new Set<string>()
    const add = (value: string | undefined) => {
      const normalized = CrawlService.normalizeCandidateUrl(value)
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized)
        candidates.push(normalized)
      }
    }

    for (const entity of tweetInfo.entities?.urls ?? []) {
      const raw = CrawlService.normalizeCandidateUrl(entity.url)
      if (raw) entityRawUrls.add(raw)
      // An expanded destination is authoritative. Do not resolve its t.co alias again.
      add(CrawlService.normalizeCandidateUrl(entity.expanded_url) || raw || undefined)
    }

    for (const match of tweetInfo.text.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
      const normalized = CrawlService.normalizeCandidateUrl(match)
      if (normalized && !entityRawUrls.has(normalized)) add(normalized)
    }

    for (const candidate of candidates) {
      if (CrawlService.isTwitterArticleUrl(candidate)) return candidate
    }

    let attempts = 0
    for (const candidate of candidates) {
      if (!CrawlService.isTwitterShortLink(candidate) || attempts >= 5) continue
      attempts++
      try {
        const resolved = await this.resolveShortLink(ctx, candidate)
        if (CrawlService.isTwitterArticleUrl(resolved)) return resolved
      } catch (err) {
        console.log(`Failed to resolve possible X Article link ${candidate}: ${err}`)
      }
    }
    return null
  }

  private static hasUsableFxEmbedArticle(document: Document): boolean {
    const article = document.querySelector('article')
    if (!article) return false
    const content = article.cloneNode(true) as Element
    for (const element of content.querySelectorAll('script, style, noscript, template')) element.remove()
    if (content.textContent?.trim()) return true
    return [...article.querySelectorAll('img[src], video[src], video source[src], audio[src], audio source[src], iframe[src]')].some(element =>
      Boolean(element.getAttribute('src')?.trim())
    )
  }

  private static hasUsableTweetArticle(article: TweetArticleInfo | null | undefined): article is TweetArticleInfo {
    if (!article || !Array.isArray(article.contents)) return false
    return article.contents.some(block => {
      if (block.type === 'image') return Boolean(block.url?.trim())
      return Boolean(block.text?.trim())
    })
  }

  private async fetchTwitterArticleFromProviders(
    ctx: ContextManager,
    sourceUrl: string,
    statusId?: string,
    fetchUrl = sourceUrl
  ): Promise<Extract<TwitterFetched, { kind: 'article' }> | null> {
    try {
      const fxRes = await this.fetchWithFxEmbed(ctx, fetchUrl)
      if (CrawlService.hasUsableFxEmbedArticle(fxRes.document)) {
        // Workflow fetch steps must serialize strings, not Document objects.
        return { kind: 'article', sourceUrl, viaFxEmbedHtml: fxRes.document.toString(), fallbackTweetInfo: null }
      }
      console.log(`fxembed returned no usable article body for ${sourceUrl}`)
    } catch (fxErr) {
      console.log(`fxembed article capture failed for ${sourceUrl}: ${fxErr}`)
    }

    if (!statusId) return null
    try {
      const article = await SocialMediaApi.fetchTwitterArticle(ctx.env, statusId)
      if (CrawlService.hasUsableTweetArticle(article)) {
        return { kind: 'article', sourceUrl, viaFxEmbedHtml: null, fallbackTweetInfo: article }
      }
      console.log(`Twitter article API returned no usable content for ${sourceUrl}`)
    } catch (apiErr) {
      console.log(`Twitter article API failed for ${sourceUrl}: ${apiErr}`)
    }
    return null
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

    const useBrowserHtml = shouldUseBrowserHtml(url)
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

  public async setCaptureStatus(ctx: ContextManager, bookmarkId: number, status: queueStatus) {
    const revision = ctx.get('snapshotCaptureRevision') as string | undefined
    if (!revision) throw new Error('Capture revision missing')
    return this.snapshotRepo.setCaptureStatus(bookmarkId, new Date(revision), status)
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

    const saved = await this.saveYoutubeCaptionArtifacts(ctx, fetched, bookmarkId, false)
    const ref: MediaSnapshotRef = saved ?? { media_kind: 'youtube', source_id: fetched.videoId, source_hash: await captionSourceHash(fetched.caption, fetched.videoId) }
    const media = await this.snapshots.initialize(ref, ctx.getUserId())
    if (!saved) media.variants = {}
    const result = await this.parseAndSaveSocialMedia(ctx, {
      media,
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
    return result
  }

  /**
   * YouTube AI article, P0: store the normalized caption under canonical, versioned R2 keys
   * (youtube/canonical/captions/{videoId}/{sourceHash}) next to the untouched html/body + text/body
   * objects, run the eligibility rules in shadow mode, record one canonical job row per caption
   * source and point this bookmark at it. Never throws: the bookmark is already saved and its
   * status must not depend on any of this. Logs carry ids, hashes and counts only, never the transcript.
   */
  public async saveYoutubeCaptionArtifacts(ctx: ContextManager, fetched: YoutubeFetched, bookmarkId: number, link = true): Promise<MediaSnapshotRef | undefined> {
    const { videoId, caption } = fetched
    // An unavailable provider is not evidence that the video has no captions. Do not overwrite
    // the shared no-caption evaluation (or its bookmark reference) with a transient failure.
    if (fetched.captionFetchFailed) {
      console.error(JSON.stringify({ event: 'youtube_caption_save_degraded', bookmark_id: bookmarkId, video_id: videoId, reason: 'caption_fetch_failed' }))
      return
    }
    try {
      // A taken-down video never gets its captions stored again
      if (await this.youtubeArticleRepo.isTakedown(videoId)) {
        console.log(`YouTube caption artifacts skipped for bookmark ${bookmarkId}: video ${videoId} is taken down`)
        return
      }
      const sourceHash = await captionSourceHash(caption, videoId)
      // Preserve existing captures' terminal outcomes before an evaluation can change a skipped row.
      await this.snapshots.settleSource(ctx, 'youtube', videoId)
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
        source_id: videoId,
        caption_key: captionKey,
        caption_text_key: captionTextKey,
        caption_language: caption?.language ?? null,
        caption_kind: caption?.kind ?? null,
        source_hash: sourceHash,
        // Best guess from the request language; the trigger after the crawl adds the row for the
        // reader's real AI language when it differs
        target_language: youtubeArticleLanguage(null, ctx.getlang()),
        prompt_version: YOUTUBE_ARTICLE_PROMPT_VERSION,
        schema_version: YOUTUBE_ARTICLE_SCHEMA_VERSION,
        status: eligibility.decision === 'generate' ? 'pending' : 'skipped',
        eligibility
      })
      if (link) await this.youtubeArticleRepo.linkBookmark({ bookmark_id: bookmarkId, user_id: ctx.getUserId(), source_id: videoId, source_hash: sourceHash })
      console.log(
        `YouTube caption saved for bookmark ${bookmarkId}: video=${videoId} hash=${sourceHash.slice(0, 12)} cues=${caption?.cues.length ?? 0} chars=${plainText.length} decision=${eligibility.decision} reasons=${eligibility.reason_codes.join(',') || '-'}`
      )
      return { media_kind: 'youtube', source_id: videoId, source_hash: sourceHash }
    } catch (err) {
      console.error(`YouTube caption artifacts failed for bookmark ${bookmarkId} (video ${videoId}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Podcast episode data for a recognised link (spec 第 2 节). Null when the link is not a podcast
   * episode after all (a feed without audio, an Apple episode the lookup does not list): the caller
   * then saves it as a normal page. Fetch errors are thrown, so the crawl step retries.
   */
  public async fetchPodcastData(url: string): Promise<PodcastEpisodeInfo | null> {
    try {
      return await this.readPodcastEpisode(url)
    } catch (err) {
      // An error that will repeat (blocked address, too large, 4xx, unreadable answer) is not worth a
      // retry: the link is saved as a normal page, as it was before the podcast route existed.
      // Errors that can pass (5xx, timeouts, network) are thrown, so the crawl step retries.
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof SyntaxError || /^(blocked_url|too_large|too_many_redirects|http_4\d\d)/.test(message)) {
        console.warn(`Podcast fetch for ${url} gave up (${message.slice(0, 80)}); saving as a page`)
        return null
      }
      throw err
    }
  }

  private async readPodcastEpisode(url: string): Promise<PodcastEpisodeInfo | null> {
    const kind = classifyPodcastUrl(url)
    if (kind === 'xiaoyuzhou') {
      const info = parseXiaoyuzhouPage(url, await fetchPublicText(url, { maxBytes: 3 * 1024 * 1024, accept: 'text/html' }))
      return info.audioUrl ? info : null
    }
    if (kind === 'apple') {
      const ids = parseAppleUrl(url)
      if (!ids) return null
      const lookup = JSON.parse(await fetchPublicText(appleLookupUrl(ids.showId), { maxBytes: 3 * 1024 * 1024, accept: 'application/json' }))
      const picked = pickAppleEpisode(url, lookup, ids.episodeId)
      if (!picked) return null
      if (!picked.feedUrl) return picked.info
      try {
        // The feed adds transcripts, the language and fuller notes; the episode works without it
        const feed = parsePodcastFeed(await fetchPublicText(picked.feedUrl, { maxBytes: 15 * 1024 * 1024 }))
        return enrichFromFeed(picked.info, feed, findFeedItem(feed, { audioUrl: picked.info.audioUrl, title: picked.info.title }))
      } catch (err) {
        console.warn(`Podcast feed enrichment failed for ${url}: ${err instanceof Error ? err.message : String(err)}`)
        return picked.info
      }
    }
    if (kind === 'audio') return directAudioInfo(url)
    if (kind === 'feed') {
      let feed
      try {
        feed = parsePodcastFeed(await fetchPublicText(url, { maxBytes: 15 * 1024 * 1024 }))
      } catch (err) {
        if (err instanceof Error && err.message === 'not an RSS feed') return null
        throw err
      }
      return latestFeedEpisode(url, feed)
    }
    if (kind === 'spotify') {
      const oembed = await fetchPublicText(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, { maxBytes: 256 * 1024, accept: 'application/json' })
        .then(text => JSON.parse(text) as { title?: string; thumbnail_url?: string })
        .catch(() => null)
      return spotifyInfo(url, oembed)
    }
    return null
  }

  /** First body of a podcast bookmark (player and notes), the episode row and the bookmark's reference to it. */
  public async parseAndSavePodcast(ctx: ContextManager, info: PodcastEpisodeInfo, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    const html = HtmlBuilder.buildPodcast({ ...info })
    const textContent = renderPodcastText({ info })
    const ref = await this.savePodcastEpisode(ctx, info, bookmarkId, false)
    const media = ref ? await this.snapshots.initialize(ref, ctx.getUserId(), info, ref.podcastInput) : null
    const result = await this.parseAndSaveSocialMedia(ctx, {
      media,
      html,
      originalUrl: info.pageUrl,
      bookmarkId,
      userBookmarkUuid,
      meta: {
        title: info.title || info.showName || 'Podcast',
        textContent,
        excerpt: (info.shownotes || info.title).slice(0, 200),
        byline: info.author || info.showName,
        siteName: info.showName || (info.kind === 'xiaoyuzhou' ? '小宇宙' : info.kind === 'apple' ? 'Apple Podcasts' : info.kind === 'spotify' ? 'Spotify' : 'Podcast'),
        publishedTime: info.publishedAt ?? new Date()
      }
    })
    return result
  }

  /** Episode row and bookmark reference. Never throws: the bookmark is already saved. */
  public async savePodcastEpisode(
    ctx: ContextManager,
    info: PodcastEpisodeInfo,
    bookmarkId: number,
    link = true
  ): Promise<(MediaSnapshotRef & { podcastInput: podcastEpisodePO }) | undefined> {
    if (!info.audioUrl) return
    try {
      const sourceId = await podcastSourceId(info.audioUrl)
      const episode = await this.podcastEpisodeRepo.upsertFromInfo(sourceId, info)
      if (link) await this.podcastArticleRepo.linkBookmark({ bookmark_id: bookmarkId, user_id: ctx.getUserId(), source_id: sourceId, source_hash: episode.transcript_hash ?? '' })
      console.log(`Podcast episode saved for bookmark ${bookmarkId}: episode=${episode.id} source=${sourceId} kind=${info.kind} status=${episode.transcript_status}`)
      return { media_kind: 'podcast', source_id: sourceId, source_hash: episode.transcript_hash ?? '', podcastInput: structuredClone(episode) }
    } catch (err) {
      console.error(`Podcast episode save failed for bookmark ${bookmarkId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  public async parseAndSaveContent(ctx: ContextManager, fetchRes: fetchResult, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    if (detectRoute(fetchRes.url) === 'regular') {
      const selected = await this.createBestParseRes(ctx, fetchRes)
      if (isDynamicLoadingPlaceholder(selected.parseRes.title, selected.parseRes.textContent)) {
        console.warn(`Dynamic page returned a loading placeholder for ${fetchRes.url}`)
        throw FetchThreePartyError('Dynamic page returned a loading placeholder')
      }
      return await this.saveParseRes(selected.parseRes, bookmarkId, userBookmarkUuid, selected.qualityReview, ctx)
    }

    const parseRes = await this.createParseRes(ctx, fetchRes)
    return this.scoreAndSaveArticle(ctx, parseRes, fetchRes, bookmarkId, userBookmarkUuid)
  }

  public fetchToutiaoData(ctx: ContextManager, url: string): Promise<ToutiaoArticle> {
    return SocialMediaApi.fetchToutiao(ctx.env, url)
  }

  public async parseAndSaveToutiao(ctx: ContextManager, fetched: ToutiaoArticle, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
    const fetchRes = { url: fetched.canonicalUrl, content: fetched.html, title: fetched.title }
    // TikHub supplies the article body already. Generic extraction drops its lead image and some paragraphs.
    const document = ContentParser.getDocument(parseHTML(fetched.html).document.body.innerHTML)
    await new Imager(ctx.env).batchReplaceImage(new URL(fetched.canonicalUrl), document)
    const parseRes: Preparse = {
      title: fetched.title,
      byline: fetched.author,
      siteName: fetched.siteName,
      publishedTime: fetched.publishedAt ? new Date(fetched.publishedAt) : new Date(),
      contentDocument: document,
      content: document.documentElement.outerHTML,
      textContent: fetched.text,
      length: fetched.text.length,
      excerpt: fetched.text.slice(0, 200),
      dir: '',
      lang: ''
    }
    return this.scoreAndSaveArticle(ctx, parseRes, fetchRes, bookmarkId, userBookmarkUuid)
  }

  private async scoreAndSaveArticle(ctx: ContextManager, parseRes: Preparse, fetchRes: fetchResult, bookmarkId: number, userBookmarkUuid: string): Promise<CrawlResult> {
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
    return await this.saveParseRes(parseRes, bookmarkId, userBookmarkUuid, qualityReview, ctx)
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

  protected async saveParseRes(parseRes: Preparse, bookmarkId: number, userBookmarkUuid: string, qualityReview?: ArticleQualityReview, ctx?: ContextManager): Promise<CrawlResult> {
    const content = await this.snapshots.capture(
      bookmarkId,
      userBookmarkUuid,
      { html: parseRes.contentDocument.documentElement.outerHTML, text: parseRes.textContent },
      {
        title: parseRes.title,
        description: parseRes.excerpt || '',
        byline: parseRes.byline || '',
        site_name: parseRes.siteName || '',
        published_at: parseRes.publishedTime
      },
      null,
      ctx?.get('snapshotCaptureRevision')
    )
    const contentKey = content.content_key

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
    if (CrawlService.isTwitterArticleUrl(url)) {
      return await this.fetchTwitterArticleData(ctx, url)
    }

    // 普通 tweet
    const { tweetId, tweetInfo } = await this.fetchTweet(ctx.env, url)

    const articleUrl = await this.discoverTwitterArticleUrl(ctx, tweetInfo)
    if (articleUrl) {
      // Internal /i/article IDs are not tweet IDs. Explicit author/article links
      // carry their own status ID, which can refer to another author's article.
      const [, author, , linkedId] = new URL(articleUrl).pathname.split('/')
      const linkedStatusId = author.toLowerCase() === 'i' ? tweetId : linkedId
      const article = await this.fetchTwitterArticleFromProviders(ctx, url, linkedStatusId, linkedStatusId === tweetId ? url : articleUrl)
      if (article) return article
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
    const [, author, , articleId] = new URL(url).pathname.split('/')
    if (!articleId) throw FetchThreePartyError('Invalid Twitter Article URL')

    // /i/article/{id} is an internal article identifier, not a status ID.
    const fetched = await this.fetchTwitterArticleFromProviders(ctx, url, author.toLowerCase() === 'i' ? undefined : articleId)
    if (fetched) return fetched
    throw FetchThreePartyError('Failed to fetch Twitter article')
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

    const textContent = tweetInfo.text
    const cleanText = tweetInfo.text.replaceAll('\n', ' ')
    const title = `Tweet: ${cleanText.substring(0, 30)}`
    const byline = tweetInfo.author.name
    const content = await this.snapshots.capture(
      bookmarkId,
      userBookmarkUuid,
      { html: document.documentElement.outerHTML, text: textContent },
      {
        title,
        description: cleanText.substring(0, 30),
        byline,
        site_name: 'Twitter',
        published_at: new Date(tweetInfo.createdAt)
      },
      null,
      ctx.get('snapshotCaptureRevision')
    )
    const contentKey = content.content_key

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

    return await this.saveParseRes(parseRes, bookmarkId, userBookmarkUuid, undefined, ctx)
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
      media?: MediaSnapshot | null
      originalUrl: string
      bookmarkId: number
      userBookmarkUuid: string
      meta: { title: string; textContent: string; excerpt: string; byline: string; siteName: string; publishedTime: Date }
    }
  ): Promise<CrawlResult> {
    const { document } = parseHTML(opts.html)
    await new Imager(ctx.env).batchReplaceImage(new URL(opts.originalUrl), document)

    const content = await this.snapshots.capture(
      opts.bookmarkId,
      opts.userBookmarkUuid,
      { html: document.documentElement.outerHTML, text: opts.meta.textContent },
      {
        title: opts.meta.title,
        description: opts.meta.excerpt,
        byline: opts.meta.byline,
        site_name: opts.meta.siteName,
        published_at: opts.meta.publishedTime
      },
      opts.media ?? null,
      ctx.get('snapshotCaptureRevision')
    )
    const contentKey = content.content_key

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
