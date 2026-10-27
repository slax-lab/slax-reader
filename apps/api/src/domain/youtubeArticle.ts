import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { ContextManager } from '@/utils/context'
import { BookmarkService } from '@/domain/bookmark'
import { LabService } from '@/domain/lab'
import { UserRepo } from '@/infra/repository/dbUser'
import { RedisClient } from '@/infra/repository/redisClient'
import { BucketClient } from '@/infra/repository/bucketClient'
import { SlaxAlertBotClient } from '@/infra/external/slaxAlertBot'
import { CrawlService } from '@/domain/crawl'
import { MediaBodyService } from '@/domain/mediaBody'
import { type LoadedMediaSnapshot, MediaSnapshotService } from '@/domain/mediaSnapshot'
import { privateMediaVersion, type MediaSnapshot } from '@/utils/mediaSnapshot'
import { HtmlBuilder, isSafeVideoId, type YoutubeCue } from '@/utils/htmlBuilder'
import { renderMediaArticle } from '@/utils/podcastArticle'
import { toCompatCues, type YoutubeCaptionDocument } from '@/utils/youtubeCaption'
import { normalizeYoutubeUrl } from '@/utils/platformDetector'
import { YoutubeArticleRepo, eligibilityDecision, isFinalError, type youtubeArticlePO, type YoutubeArticleStatus } from '@/infra/repository/dbYoutubeArticle'
import {
  YOUTUBE_ARTICLE_LIMITS,
  escapeHtml,
  renderArticleText,
  youtubeArticleChunkPrefix,
  youtubeArticleLanguage,
  youtubeArticleVersion,
  youtubeArticleWorkflowId,
  type YoutubeArticleDocument,
  type YoutubeArticleLanguage
} from '@/utils/youtubeArticle'
import { BookmarkNotFoundError, ErrorParam } from '@/const/err'

export const YOUTUBE_ARTICLE_LAB = 'youtube_article'

/** Per user per UTC day. */
export const YOUTUBE_ARTICLE_DAILY_LIMITS = { auto: 20, manual: 5 } as const

export type YoutubeArticleTrigger = 'crawl' | 'open' | 'manual' | 'retry' | 'sweep'

export interface YoutubeArticleWorkflowParams {
  articleId: number
  videoId: string
  sourceHash: string
  targetLanguage: YoutubeArticleLanguage
  promptVersion: string
  title: string
  trigger: YoutubeArticleTrigger
}

export interface YoutubeArticleContentResponse {
  version: string
  language: YoutubeArticleLanguage
  format: 'article' | 'dialogue'
  lede: string
  sections: {
    heading: string
    start_ms: number
    paragraphs: { speaker: string | null; text: string }[]
  }[]
}

export type YoutubeArticleApiStatus = 'unavailable' | 'limit_reached' | Exclude<YoutubeArticleStatus, 'stale' | 'takedown'>

export interface YoutubeArticleStatusResponse {
  /** Recovery guidance for the owner only. */
  unavailable_reason?: 'labs_disabled' | 'source_missing'
  status: YoutubeArticleApiStatus
  language: YoutubeArticleLanguage | null
  requested_language: YoutubeArticleLanguage
  eligibility: {
    decision: 'generate' | 'skip' | 'review'
    reason_codes: string[]
  } | null
  version: string | null
  format: 'article' | 'dialogue' | null
  can_generate: boolean
  can_retry: boolean
  article_url: string | null
  updated_at: string | null
  /**
   * 'article': the cleaned article is (or becomes, once ready) the bookmark body. 'transcript': the
   * body keeps the raw captions, because the bookmark has highlights or comments on them; the client
   * shows the article below the body as before.
   */
  body_mode: 'article' | 'transcript'
  /** The bookmark body holds the cleaned article now. */
  body_ready: boolean
}

/** What a body that holds a YouTube article starts with; the version follows. */
const BODY_MARKER = 'data-slax-derived="youtube-article" data-article-version="'

type StartResult = 'started' | 'locked' | 'busy' | 'over_budget' | 'not_pending' | 'failed'

interface Access {
  bookmarkUid: string
  bookmarkId: number
  ownerId: number
  isOwner: boolean
  /** Flagged by content moderation: no article is generated or shown, for anyone. */
  flagged: boolean
  title: string
}

const DAY_SECONDS = 24 * 60 * 60

/** The legacy cues in the body's <youtube-player data-cues>, or null when they cannot be read. */
export function playerCues(html: string): YoutubeCue[] | null {
  const raw = /<youtube-player\b[^>]*\sdata-cues="([^"]*)"/.exec(html)?.[1]
  if (raw === undefined) return null
  try {
    const parsed = JSON.parse(
      raw
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
    ) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter((c): c is YoutubeCue => !!c && typeof c.t === 'number' && typeof c.text === 'string')
  } catch {
    return null
  }
}

function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '')
}

/**
 * YouTube AI article, P1: who may see which article version, the three ways a generation starts,
 * the daily and budget limits, and the periodic sweep. Article rows are canonical per video; the
 * bookmark always decides visibility.
 */
@injectable()
export class YoutubeArticleService {
  constructor(
    @inject(YoutubeArticleRepo) private repo: YoutubeArticleRepo,
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(LabService) private labService: LabService,
    @inject(UserRepo) private userRepo: UserRepo,
    @inject(RedisClient) private redis: LazyInstance<RedisClient>,
    @inject(BucketClient) private bucket: LazyInstance<BucketClient>,
    @inject(SlaxAlertBotClient) private alertBot: SlaxAlertBotClient,
    @inject(CrawlService) private crawlService: CrawlService,
    @inject(MediaBodyService) private bodies: MediaBodyService,
    @inject(MediaSnapshotService) private snapshots: MediaSnapshotService
  ) {}

  // ---------- access ----------

  /** Same rule as the snapshot page: the owner always; others only while the bookmark is shared. */
  private async resolveAccess(ctx: ContextManager, bookmarkUid: string): Promise<Access> {
    if (!bookmarkUid) throw ErrorParam()
    const access = await this.bookmarkService.getBookmarkReadAccess(ctx, bookmarkUid)
    if (!access) throw BookmarkNotFoundError()
    const ub = access.bookmark
    const viewerId = ctx.getUserId()
    const isOwner = viewerId > 0 && viewerId === ub.user_id
    const flagged = ub.bookmark.moderation_result > 0
    return { bookmarkUid, bookmarkId: ub.bookmark_id, ownerId: ub.user_id, isOwner, flagged, title: ub.alias_title || ub.bookmark.title || '' }
  }

  public async languageOf(userId: number): Promise<YoutubeArticleLanguage> {
    if (!userId) return 'en'
    try {
      const user = await this.userRepo.getInfoByUserId(userId)
      return youtubeArticleLanguage(user.ai_lang, user.lang)
    } catch {
      return 'en'
    }
  }

  // ---------- read ----------

  /**
   * Status of the article for the viewer. The viewer's language first; an owner without that
   * version gets one queued (and started when allowed); a visitor falls back to the owner's ready
   * version. Visitors never start anything.
   */
  public async getStatus(ctx: ContextManager, bookmarkUid: string): Promise<YoutubeArticleStatusResponse> {
    const access = await this.resolveAccess(ctx, bookmarkUid)
    const viewerId = ctx.getUserId()
    const requested = await this.languageOf(viewerId > 0 ? viewerId : access.ownerId)
    const unavailable = this.response(requested, null, access, false)

    if (access.flagged) return unavailable
    const loaded = await this.snapshots.load(access.bookmarkId)
    let snapshot = loaded?.media
    if (snapshot?.kind === 'youtube') {
      if (!(await this.snapshots.readable(snapshot))) return unavailable
      if (access.isOwner) {
        try {
          if (await this.snapshots.settle(ctx, access.bookmarkId, loaded)) snapshot = (await this.snapshots.load(access.bookmarkId))!.media!
        } catch (error) {
          console.error('Private media status catch-up failed', error)
        }
      }
      const enabled = await this.labService.isEnabled(access.ownerId, YOUTUBE_ARTICLE_LAB)
      const result = this.privateStatus(snapshot, requested, access, enabled)
      if (access.isOwner && snapshot.mode === 'capture' && !snapshot.variants[requested]) {
        if (!enabled) result.unavailable_reason = 'labs_disabled'
        else if (Object.keys(snapshot.variants).length === 0) result.unavailable_reason = 'source_missing'
      }
      // Only the pending request owned by this capture may initiate acquisition on open.
      if (enabled && access.isOwner && snapshot.mode === 'capture' && snapshot.variants[requested]?.status === 'pending') {
        const row = await this.repo.findVersion(snapshot.sourceId, snapshot.sourceHash, requested)
        if (row?.status === 'pending' && !row.next_retry_at && eligibilityDecision(row) === 'generate') {
          if (!(await this.takeDaily(viewerId, 'auto'))) return { ...result, status: 'limit_reached' }
          const started = await this.start(ctx, row, access.title, 'open')
          if (started === 'not_pending' || started === 'locked') await this.giveBackDaily(viewerId, 'auto')
        }
      }
      return result
    }
    if (!(await this.labService.isEnabled(access.ownerId, YOUTUBE_ARTICLE_LAB))) return access.isOwner ? { ...unavailable, unavailable_reason: 'labs_disabled' } : unavailable
    const ref = await this.repo.findRef(access.bookmarkId)
    if (!ref) return access.isOwner ? { ...unavailable, unavailable_reason: 'source_missing' } : unavailable

    let row = await this.repo.findVersion(ref.source_id, ref.source_hash, requested)
    if (!row && access.isOwner) {
      const base = (await this.repo.listForSource(ref.source_id, ref.source_hash))[0]
      if (base) row = await this.repo.ensureLanguageRow(base, requested)
    }

    if (access.isOwner && row && row.status === 'pending' && !row.next_retry_at && eligibilityDecision(row) === 'generate') {
      const counted = await this.takeDaily(viewerId, 'auto')
      if (!counted) return { ...this.response(requested, row, access, await this.manualLeft(viewerId)), status: 'limit_reached' }
      const started = await this.start(ctx, row, access.title, 'open')
      // Deferred starts (busy, over budget, create failed) still run later through the sweep, so they
      // keep the count. 'locked' means another start of this row is in flight and already counted.
      if (started === 'not_pending' || started === 'locked') await this.giveBackDaily(viewerId, 'auto')
      row = (await this.repo.findById(row.id)) ?? row
    }

    // Visitors only ever see a ready article: theirs, else the owner's language. They start nothing,
    // so any other state would be a spinner that never ends
    if (!access.isOwner && (!row || row.status !== 'ready')) {
      const ownerLanguage = await this.languageOf(access.ownerId)
      const fallback = ownerLanguage === requested ? null : await this.repo.findVersion(ref.source_id, ref.source_hash, ownerLanguage)
      row = fallback?.status === 'ready' ? fallback : null
    }

    if (!row) return access.isOwner ? { ...unavailable, unavailable_reason: 'source_missing' } : unavailable
    const res = this.response(requested, row, access, access.isOwner ? await this.manualLeft(viewerId) : false)
    return { ...res, ...(await this.bodyState(ctx, access, row)) }
  }

  /**
   * The structured article of one version the bookmark can see. Never accepts a raw object key.
   * The client renders it with escaped text bindings, so no HTML from this path is ever injected.
   */
  public async getContent(ctx: ContextManager, bookmarkUid: string, version: string): Promise<YoutubeArticleContentResponse> {
    if (!version) throw ErrorParam()
    const access = await this.resolveAccess(ctx, bookmarkUid)
    if (access.flagged) throw BookmarkNotFoundError()
    const snapshot = (await this.snapshots.load(access.bookmarkId))?.media
    if (snapshot?.kind === 'youtube') {
      if (!(await this.snapshots.readable(snapshot))) throw BookmarkNotFoundError()
      const language = (['en', 'zh'] as const).find(lang => privateMediaVersion(snapshot, lang) === version && snapshot.variants[lang]?.status === 'ready')
      if (!language) throw BookmarkNotFoundError()
      return { ...snapshot.variants[language]!.content!, version }
    }
    if (!(await this.labService.isEnabled(access.ownerId, YOUTUBE_ARTICLE_LAB))) throw BookmarkNotFoundError()
    const ref = await this.repo.findRef(access.bookmarkId)
    if (!ref) throw BookmarkNotFoundError()
    const rows = await this.repo.listForSource(ref.source_id, ref.source_hash)
    const row = rows.find(r => r.status === 'ready' && r.article_key && this.versionOf(r) === version)
    if (!row) throw BookmarkNotFoundError()
    const obj = await this.bucket().R2Bucket.get(row.article_key!)
    if (!obj) throw BookmarkNotFoundError()
    const doc = JSON.parse(await obj.text()) as YoutubeArticleDocument
    return {
      version,
      language: doc.language,
      format: doc.format === 'dialogue' ? 'dialogue' : 'article',
      lede: doc.lede,
      sections: doc.sections.map(s => ({
        heading: s.heading,
        start_ms: s.start_ms,
        paragraphs: s.paragraphs.map(p => ({ speaker: p.speaker, text: p.text }))
      }))
    }
  }

  private versionOf(row: youtubeArticlePO): string {
    return youtubeArticleVersion(row.source_hash, row.target_language, row.schema_version, row.prompt_version)
  }

  private privateStatus(snapshot: MediaSnapshot, requested: YoutubeArticleLanguage, access: Access, acquisitionEnabled: boolean): YoutubeArticleStatusResponse {
    const preferred = snapshot.variants[requested]?.status === 'ready' || (access.isOwner && snapshot.mode !== 'fork') ? requested : snapshot.defaultLanguage
    const language =
      snapshot.mode === 'fork' && snapshot.variants[preferred]?.status !== 'ready'
        ? ((['en', 'zh'] as const).find(lang => snapshot.variants[lang]?.status === 'ready') ?? preferred)
        : preferred
    const variant = snapshot.variants[language]
    const ready = variant?.status === 'ready'
    const status = !access.isOwner && !ready ? 'unavailable' : (variant?.status ?? 'unavailable')
    const version = ready ? privateMediaVersion(snapshot, language) : null
    const canRequest = acquisitionEnabled && access.isOwner && snapshot.mode === 'capture' && !isFinalError(variant?.reason)
    return {
      status,
      language: variant ? language : null,
      requested_language: requested,
      eligibility: variant?.eligibility ?? null,
      version,
      format: ready ? variant.content!.format : null,
      can_generate: canRequest && (status === 'failed' || status === 'skipped'),
      can_retry: canRequest && status === 'failed',
      article_url: version ? `/v1/youtube_article/content?bookmark_uid=${encodeURIComponent(access.bookmarkUid)}&version=${encodeURIComponent(version)}` : null,
      updated_at: null,
      body_mode: snapshot.bodyLanguage ? 'article' : 'transcript',
      body_ready: ready && snapshot.bodyLanguage === language
    }
  }

  private response(requested: YoutubeArticleLanguage, row: youtubeArticlePO | null, access: Access, canManual: boolean): YoutubeArticleStatusResponse {
    if (!row || row.status === 'takedown' || row.status === 'stale') {
      return {
        status: 'unavailable',
        language: null,
        requested_language: requested,
        eligibility: null,
        version: null,
        format: null,
        can_generate: false,
        can_retry: false,
        article_url: null,
        updated_at: null,
        body_mode: 'transcript',
        body_ready: false
      }
    }
    const eligibility = row.eligibility_json as {
      decision?: string
      reason_codes?: string[]
    } | null
    const status = row.status as YoutubeArticleApiStatus
    const version = this.versionOf(row)
    const ready = status === 'ready'
    const format = (row.quality_json as { format?: string } | null)?.format === 'dialogue' ? 'dialogue' : 'article'
    return {
      status,
      language: row.target_language as YoutubeArticleLanguage,
      requested_language: requested,
      eligibility: eligibility ? { decision: eligibilityDecision(row), reason_codes: eligibility.reason_codes ?? [] } : null,
      version: ready ? version : null,
      format: ready ? format : null,
      can_generate: access.isOwner && canManual && (status === 'skipped' || status === 'failed') && !isFinalError(row.error_message),
      can_retry: access.isOwner && status === 'failed' && !isFinalError(row.error_message),
      article_url: ready ? `/v1/youtube_article/content?bookmark_uid=${encodeURIComponent(access.bookmarkUid)}&version=${encodeURIComponent(version)}` : null,
      updated_at: row.updated_at.toISOString(),
      body_mode: 'article',
      body_ready: false
    }
  }

  // ---------- write ----------

  /**
   * Owner actions. `generate` runs a skipped or failed version and counts against the daily manual
   * limit; `retry` runs a failed version again from zero attempts and does not count.
   */
  public async request(ctx: ContextManager, bookmarkUid: string, mode: 'generate' | 'retry'): Promise<YoutubeArticleStatusResponse> {
    const access = await this.resolveAccess(ctx, bookmarkUid)
    if (!access.isOwner || access.flagged) throw BookmarkNotFoundError()
    if ((await this.snapshots.load(access.bookmarkId))?.media?.mode === 'fork') throw BookmarkNotFoundError()
    if (!(await this.labService.isEnabled(access.ownerId, YOUTUBE_ARTICLE_LAB))) throw this.labService.disabledError(YOUTUBE_ARTICLE_LAB)
    const ref = await this.repo.findRef(access.bookmarkId)
    if (!ref) throw BookmarkNotFoundError()
    const language = await this.languageOf(access.ownerId)
    let row = await this.repo.findVersion(ref.source_id, ref.source_hash, language)
    if (!row) {
      const base = (await this.repo.listForSource(ref.source_id, ref.source_hash))[0]
      if (!base) throw BookmarkNotFoundError()
      const created = await this.repo.ensureLanguageRow(base, language)
      if (!created) throw BookmarkNotFoundError()
      row = created
    }
    if (row.status === 'takedown') throw BookmarkNotFoundError()
    await this.snapshots.settleSource(ctx, 'youtube', ref.source_id)
    const snapshot = (await this.snapshots.load(access.bookmarkId))?.media
    const privateVariant = snapshot?.variants[language]
    if (snapshot?.mode === 'capture' && row.status !== 'failed' && row.status !== 'skipped') {
      const eligible = privateVariant?.status === 'failed' || (mode === 'generate' && privateVariant?.status === 'skipped')
      if (!eligible || isFinalError(privateVariant?.reason)) throw ErrorParam()
      await this.snapshots.openRequest(access.bookmarkId, language)
      return this.getStatus(ctx, bookmarkUid)
    }

    if (mode === 'retry') {
      if (row.status !== 'failed') throw ErrorParam()
      if (!(await this.repo.requeue(row.id, true))) throw ErrorParam()
    } else {
      if (row.status !== 'skipped' && row.status !== 'failed') return this.getStatus(ctx, bookmarkUid)
      if (!(await this.takeDaily(access.ownerId, 'manual'))) return { ...(await this.getStatus(ctx, bookmarkUid)), status: 'limit_reached', can_generate: false }
      if (!(await this.repo.requeue(row.id, false))) {
        await this.giveBackDaily(access.ownerId, 'manual')
        return this.getStatus(ctx, bookmarkUid)
      }
    }
    const fresh = (await this.repo.findById(row.id)) ?? row
    await this.snapshots.openRequest(access.bookmarkId, language)
    await this.start(ctx, fresh, access.title, mode === 'retry' ? 'retry' : 'manual')
    return this.getStatus(ctx, bookmarkUid)
  }

  /**
   * After a YouTube save passed moderation: queue the saver's language version and start it when
   * the gate says generate. Never throws; the bookmark is already saved.
   */
  public async triggerAfterCrawl(ctx: ContextManager, bookmarkId: number, userId: number, title: string): Promise<void> {
    try {
      const snapshot = (await this.snapshots.load(bookmarkId))?.media
      if (snapshot && (snapshot.mode === 'fork' || !Object.values(snapshot.variants).some(variant => variant.status === 'pending'))) return
      if (!(await this.labService.isEnabled(userId, YOUTUBE_ARTICLE_LAB))) return
      const ref = await this.repo.findRef(bookmarkId)
      if (!ref) return
      const language = await this.languageOf(userId)
      let row = await this.repo.findVersion(ref.source_id, ref.source_hash, language)
      if (!row) {
        const base = (await this.repo.listForSource(ref.source_id, ref.source_hash))[0]
        if (!base) return
        const created = await this.repo.ensureLanguageRow(base, language)
        if (!created) return
        row = created
      }
      // Already made for an earlier save of this video: this bookmark gets the article at once, no model call
      if (row.status === 'ready') {
        const written = await this.publishBodyFor(ctx, bookmarkId, userId, row)
        console.log(`YouTube article trigger after crawl: bookmark=${bookmarkId} article=${row.id} lang=${language} result=${written ? 'body_written' : 'body_kept'}`)
        return
      }
      if (row.status !== 'pending' || row.next_retry_at || eligibilityDecision(row) !== 'generate') return
      // A save-triggered start is an automatic start and counts against the same daily limit
      if (!(await this.takeDaily(userId, 'auto'))) {
        console.log(`YouTube article trigger after crawl: bookmark=${bookmarkId} article=${row.id} lang=${language} result=limit_reached`)
        return
      }
      const result = await this.start(ctx, row, title, 'crawl')
      if (result === 'not_pending' || result === 'locked') await this.giveBackDaily(userId, 'auto')
      console.log(`YouTube article trigger after crawl: bookmark=${bookmarkId} article=${row.id} lang=${language} result=${result}`)
    } catch (err) {
      console.error(`YouTube article trigger after crawl failed for bookmark ${bookmarkId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ---------- bodies ----------

  /**
   * Body state for the status response: whether the body holds `row`, the version this viewer gets
   * (theirs, or the owner's for a visitor). A body that already holds it is 'article' even when it
   * has marks (marks on the article keep it). Otherwise marks keep the body as it is
   * ('transcript'). A visitor in another language gets body_ready false and the article below the
   * body at once. The owner's read writes a ready article that is not in the body yet (made before
   * this rule, or a failed write); a failed write is logged and answers body_ready false, so the page
   * falls back instead of failing. Visitors only read.
   */
  private async bodyState(ctx: ContextManager, access: Access, row: youtubeArticlePO): Promise<Pick<YoutubeArticleStatusResponse, 'body_mode' | 'body_ready'>> {
    const html = row.status === 'ready' ? await this.bodies.readBody(access.bookmarkId) : null
    if (html?.includes(this.bodyMarker(row))) return { body_mode: 'article', body_ready: true }
    if (await this.bodies.hasMarks(access.bookmarkId, access.ownerId)) return { body_mode: 'transcript', body_ready: false }
    if (row.status !== 'ready' || !access.isOwner || html === null) return { body_mode: 'article', body_ready: false }
    try {
      return { body_mode: 'article', body_ready: await this.publishBodyFor(ctx, access.bookmarkId, access.ownerId, row) }
    } catch (err) {
      console.error(`YouTube article body write failed for bookmark ${access.bookmarkId}: ${err instanceof Error ? err.message : String(err)}`)
      return { body_mode: 'article', body_ready: false }
    }
  }

  private bodyMarker(row: youtubeArticlePO): string {
    return `${BODY_MARKER}${escapeHtml(this.versionOf(row))}"`
  }

  /**
   * A version just became ready: write it into the body of every bookmark of this caption version
   * whose owner reads that language and has the switch on. Bookmarks with marks keep their body.
   */
  public async publishBodies(ctx: ContextManager, articleId: number): Promise<number> {
    const row = await this.repo.findById(articleId)
    if (!row) return 0
    const failures: unknown[] = []
    const complete = (count: number) => {
      if (failures.length) throw new AggregateError(failures, 'Media body publication incomplete')
      return count
    }
    const loaded = new Map<number, LoadedMediaSnapshot | null>()
    const settled = await this.snapshots.settleSource(ctx, 'youtube', row.source_id, loaded, failures)
    if (row.status !== 'ready') return complete(settled)
    let rendered: { html: string; text: string } | null | undefined
    let count = settled
    for (const ref of await this.repo.listRefs(row.source_id, row.source_hash)) {
      try {
        if (!(await this.wantsBody(ref.bookmark_id, ref.user_id, row, loaded.has(ref.bookmark_id) ? loaded.get(ref.bookmark_id) : undefined))) continue
        // Rendered once for all bookmarks, and only when one of them takes it
        if (rendered === undefined) rendered = await this.renderBody(row)
        if (!rendered) throw new Error('YouTube publication artifacts missing')
        if (await this.bodies.writeBody(ctx, ref.bookmark_id, ref.user_id, rendered)) count++
      } catch (error) {
        failures.push(error)
        console.error(`YouTube article publication failed for bookmark ${ref.bookmark_id}`)
      }
    }
    return complete(count)
  }

  public async settleSnapshots(ctx: ContextManager, sourceId: string) {
    return this.snapshots.settleSource(ctx, 'youtube', sourceId)
  }

  private async publishBodyFor(ctx: ContextManager, bookmarkId: number, userId: number, row: youtubeArticlePO): Promise<boolean> {
    const loaded = await this.snapshots.load(bookmarkId)
    if (loaded?.managed) return this.snapshots.settle(ctx, bookmarkId, loaded)
    if (!(await this.wantsBody(bookmarkId, userId, row, loaded))) return false
    const rendered = await this.renderBody(row)
    return rendered ? this.bodies.writeBody(ctx, bookmarkId, userId, rendered) : false
  }

  /** The owner has the switch on and reads this language, and nobody marked the body. Marks are checked last, closest to the write. */
  private async wantsBody(bookmarkId: number, userId: number, row: youtubeArticlePO, loaded?: LoadedMediaSnapshot | null): Promise<boolean> {
    if ((loaded === undefined ? await this.snapshots.load(bookmarkId) : loaded)?.managed) return false
    if (!(await this.labService.isEnabled(userId, YOUTUBE_ARTICLE_LAB))) return false
    if ((await this.languageOf(userId)) !== row.target_language) return false
    return !(await this.bodies.hasMarks(bookmarkId, userId))
  }

  /** Player (same cues as the crawl wrote, for the side transcript panel) plus the article. Null when an object is gone. */
  private async renderBody(row: youtubeArticlePO): Promise<{ html: string; text: string } | null> {
    if (!row.article_key || !row.caption_key || !isSafeVideoId(row.source_id)) return null
    const bucket = this.bucket().R2Bucket
    const [docObj, captionObj] = await Promise.all([bucket.get(row.article_key), bucket.get(row.caption_key)])
    if (!docObj || !captionObj) return null
    const doc = JSON.parse(await docObj.text()) as YoutubeArticleDocument
    const caption = JSON.parse(await captionObj.text()) as YoutubeCaptionDocument
    const article = renderMediaArticle(doc, this.versionOf(row), caption.cues, 'youtube')
    return { html: HtmlBuilder.buildYoutubeArticleBody(row.source_id, toCompatCues(caption.cues), article), text: renderArticleText(doc) }
  }

  /**
   * Takedown: put the raw captions back into every body that holds the article, rebuilt from the
   * player's own cues (the caption objects are deleted with the article). This is a legal path,
   * so it also writes flagged bookmarks, and a body whose cues can not be read gets the player only:
   * the article text must not survive. Bodies that could not be written are logged by id.
   */
  private async restoreRawBodies(ctx: ContextManager, videoId: string): Promise<number> {
    // Same guard as renderBody: the id goes into the player markup
    if (!isSafeVideoId(videoId)) {
      console.error(`YouTube article takedown: invalid video id, bodies not restored`)
      return 0
    }
    let count = 0
    const failed: number[] = []
    for (const ref of await this.repo.listRefs(videoId)) {
      const html = await this.bodies.readBody(ref.bookmark_id)
      const managed = (await this.snapshots.load(ref.bookmark_id))?.managed
      if (!managed && !html?.includes(BODY_MARKER)) continue
      const cues = html ? (playerCues(html) ?? []) : []
      // Same text the crawl writes: the caption lines joined
      const body = { html: HtmlBuilder.buildYoutube(videoId, cues), text: cues.map(c => c.text).join(' ') }
      const written = await (managed ? this.snapshots.stripDerived(ref.bookmark_id, body) : this.bodies.writeBody(ctx, ref.bookmark_id, ref.user_id, body, { force: true })).catch(
        () => false
      )
      if (written) count++
      else failed.push(ref.bookmark_id)
    }
    if (failed.length) throw new Error(`YouTube article takedown: bodies not restored for bookmarks ${failed.join(',')}`)
    return count
  }

  // ---------- start ----------

  /**
   * Start the workflow for a pending row, or put it off for the sweeper. Over budget or too many
   * running rows → deferred. The short lock stops parallel callers from starting the same row; the
   * claim inside the workflow is what finally guarantees a single run.
   */
  private async start(ctx: ContextManager, row: youtubeArticlePO, title: string, trigger: YoutubeArticleTrigger): Promise<StartResult> {
    if (row.status !== 'pending') return 'not_pending'

    if (await this.overBudget()) {
      await this.repo.defer(row.id, new Date(Date.now() + 60 * 60 * 1000))
      return 'over_budget'
    }
    // debt: count-then-start is not atomic, so a burst can briefly run a few more than maxConcurrent.
    // Upgrade to a Durable Object semaphore if bursts ever matter for cost or rate limits.
    if ((await this.repo.countRunning()) >= YOUTUBE_ARTICLE_LIMITS.maxConcurrent) {
      await this.repo.defer(row.id, new Date(Date.now() + 60 * 1000))
      return 'busy'
    }
    if (!(await this.redis().youtubeArticleStartLock(row.id).setIfAbsent(1, 30))) {
      // Someone else is starting it right now. Defer, so the sweep starts it if that start fails;
      // when it succeeds the row is no longer pending and the deferral does nothing
      await this.repo.defer(row.id, new Date(Date.now() + 60 * 1000))
      return 'locked'
    }

    const params: YoutubeArticleWorkflowParams = {
      articleId: row.id,
      videoId: row.source_id,
      sourceHash: row.source_hash,
      targetLanguage: row.target_language as YoutubeArticleLanguage,
      promptVersion: row.prompt_version,
      title,
      trigger
    }
    try {
      await ctx.env.YOUTUBE_ARTICLE_WORKFLOW.create({ id: youtubeArticleWorkflowId(row.source_id, row.source_hash, row.target_language, row.prompt_version), params })
      return 'started'
    } catch (err) {
      console.error(`YouTube article workflow create failed for article ${row.id}: ${err instanceof Error ? err.message : String(err)}`)
      await this.repo.defer(row.id, new Date(Date.now() + 5 * 60 * 1000))
      return 'failed'
    }
  }

  // ---------- limits ----------

  private async takeDaily(userId: number, kind: 'auto' | 'manual'): Promise<boolean> {
    const counter = this.redis().youtubeArticleDaily(userId, utcDay(), kind)
    const count = await counter.incrWithExpire(2 * DAY_SECONDS)
    if (count > YOUTUBE_ARTICLE_DAILY_LIMITS[kind]) {
      await counter.incrBy(-1)
      return false
    }
    return true
  }

  private async giveBackDaily(userId: number, kind: 'auto' | 'manual'): Promise<void> {
    await this.redis().youtubeArticleDaily(userId, utcDay(), kind).incrBy(-1)
  }

  private async manualLeft(userId: number): Promise<boolean> {
    const used = Number((await this.redis().youtubeArticleDaily(userId, utcDay(), 'manual').get()) ?? 0)
    return used < YOUTUBE_ARTICLE_DAILY_LIMITS.manual
  }

  private async overBudget(): Promise<boolean> {
    const day = utcDay()
    const spentMicro = Number((await this.redis().youtubeArticleCost(day).get()) ?? 0)
    if (spentMicro < YOUTUBE_ARTICLE_LIMITS.dailyCostUsd * 1_000_000) return false
    if (
      await this.redis()
        .youtubeArticleBudgetAlert(day)
        .setIfAbsent(1, 2 * DAY_SECONDS)
    ) {
      await this.alertBot.crawl
        .pushMessage(`⚠️ **YouTube article budget reached**\n**Day (UTC)**: ${day}\n**Spent**: ${(spentMicro / 1_000_000).toFixed(2)} USD\n**处理**: 新任务已暂停，次日自动恢复`)
        .catch((e: unknown) => console.error(`budget alert push failed: ${e}`))
    }
    return true
  }

  /** Add the estimated cost of one model call to today's site-wide spend. */
  public async addCost(usd: number): Promise<void> {
    if (!(usd > 0)) return
    const counter = this.redis().youtubeArticleCost(utcDay())
    await counter.incrBy(Math.ceil(usd * 1_000_000))
    await counter.expire(2 * DAY_SECONDS)
  }

  // ---------- sweep ----------

  /**
   * Every 5 minutes: dead workflows back to pending (or failed), deferred requests started,
   * unreferenced rows older than 7 days deleted together with their objects, and the objects of
   * newly taken-down videos deleted.
   */
  public async sweep(ctx: ContextManager): Promise<{
    expired: number
    started: number
    deleted: number
    takenDown: number
  }> {
    const now = new Date()
    let expired = 0
    for (const row of await this.repo.listExpiredLeases(50, now)) {
      // expiredBefore re-checks the lease inside the update: a run that renewed meanwhile keeps its row
      if (await this.repo.finishAttempt(row.id, { kind: 'retry', error: 'lease_expired', retryDelayMs: 60 * 1000 }, { expiredBefore: now })) expired++
    }

    // A just-created workflow has not claimed its row yet, so countRunning cannot see it; the sweep
    // therefore starts at most the free slots it saw at the beginning
    let slots = YOUTUBE_ARTICLE_LIMITS.maxConcurrent - (await this.repo.countRunning())
    let started = 0
    for (const row of slots > 0 ? await this.repo.listRunnable(slots) : []) {
      if (slots <= 0) break
      const ref = await this.repo.findAnyRef(row.source_id, row.source_hash)
      const title = ref ? (((await this.bookmarkService.getBookmarkById(ref.bookmark_id).catch(() => null)) as { title?: string } | null)?.title ?? '') : ''
      const result = await this.start(ctx, row, title, 'sweep')
      if (result === 'started') {
        started++
        slots--
      }
      if (result === 'busy' || result === 'over_budget') break
    }

    let deleted = 0
    const cutoff = new Date(Date.now() - 7 * DAY_SECONDS * 1000)
    for (const row of await this.repo.listOrphans(cutoff, 200)) {
      if (await this.deleteRowWithObjects(row, cutoff)) deleted++
    }

    // Takedowns marked by the script: the objects can only be listed and deleted from the Worker
    let takenDown = 0
    for (const videoId of await this.repo.listTakedownsToClean(20)) {
      const res = await this.takedown(ctx, videoId)
      takenDown++
      console.log(`YouTube article takedown cleaned: video=${videoId} rows=${res.rows} objects=${res.objects} bodies=${res.bodies}`)
    }
    if (expired || started || deleted || takenDown) console.log(`YouTube article sweep: expired=${expired} started=${started} deleted=${deleted} takedowns=${takenDown}`)
    return { expired, started, deleted, takenDown }
  }

  private async deleteRowWithObjects(row: youtubeArticlePO, cutoff: Date): Promise<boolean> {
    const bucket = this.bucket().R2Bucket
    const keys: string[] = []
    if (row.article_key) keys.push(row.article_key, row.article_key.replace(/\.json$/, '.html'))
    if (row.article_text_key) keys.push(row.article_text_key)
    // Captions are shared by every language row of the same source; delete them with the last row
    for (const column of ['caption_key', 'caption_text_key'] as const) {
      const key = row[column]
      if (key && (await this.repo.countRowsUsingKey(column, key)) === 1) keys.push(key)
    }
    if (!(await this.repo.deleteOrphan(row.id, cutoff))) return false
    if (keys.length) await bucket.delete(keys)
    await this.deletePrefix(youtubeArticleChunkPrefix(row.source_id, row.source_hash, row.target_language, row.prompt_version))
    return true
  }

  /** Delete every object under a prefix (chunk intermediates). */
  public async deletePrefix(prefix: string): Promise<number> {
    const bucket = this.bucket().R2Bucket
    let cursor: string | undefined
    let count = 0
    do {
      const page = await bucket.list({ prefix, cursor })
      const keys = page.objects.map(o => o.key)
      if (keys.length) await bucket.delete(keys)
      count += keys.length
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    return count
  }

  // ---------- backfill ----------

  /**
   * Captions, gate rows and refs for YouTube bookmarks saved before P0, only for users with the
   * article switch on. Generates no article (that happens when the owner opens the bookmark) and
   * never touches html/body or text/body. Small batches: every bookmark is a caption fetch.
   */
  public async backfill(
    ctx: ContextManager,
    limit: number,
    beforeId?: number
  ): Promise<{
    processed: number
    linked: number
    failed: number
    next_before_id: number | null
  }> {
    const rows = await this.repo.listBackfillCandidates(Math.min(Math.max(1, limit), 50), beforeId)
    let linked = 0
    let failed = 0
    for (const row of rows) {
      const itemCtx = new ContextManager(ctx.execution, ctx.env)
      itemCtx.setUserInfo(row.user_id, 0, '', row.lang || 'en')
      try {
        if ((await this.snapshots.load(row.bookmark_id))?.managed) continue
        const fetched = await this.crawlService.fetchYoutubeData(itemCtx, normalizeYoutubeUrl(row.target_url))
        await this.crawlService.saveYoutubeCaptionArtifacts(itemCtx, fetched, row.bookmark_id)
        if (await this.repo.findRef(row.bookmark_id)) linked++
        else failed++
      } catch (err) {
        failed++
        console.error(`YouTube caption backfill failed for bookmark ${row.bookmark_id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const last = rows[rows.length - 1]
    return { processed: rows.length, linked, failed, next_before_id: rows.length === Math.min(Math.max(1, limit), 50) && last ? last.user_bookmark_id : null }
  }

  // ---------- takedown ----------

  /** Stop serving and generating every article of a video: bodies back to the raw captions, then delete its objects. */
  public async takedown(ctx: ContextManager, videoId: string): Promise<{ rows: number; objects: number; bodies: number }> {
    await this.snapshots.denyYoutube(videoId)
    const bodies = await this.restoreRawBodies(ctx, videoId)
    const rows = await this.repo.listForVideo(videoId)
    const keys = new Set<string>()
    for (const row of rows) {
      for (const key of [row.caption_key, row.caption_text_key, row.article_key, row.article_key?.replace(/\.json$/, '.html'), row.article_text_key]) if (key) keys.add(key)
    }
    // Objects first, keys last: if a delete throws, the keys stay and the next sweep tries again
    if (keys.size) await this.bucket().R2Bucket.delete([...keys])
    let objects = keys.size
    objects += await this.deletePrefix(`youtube/canonical/captions/${videoId}/`)
    objects += await this.deletePrefix(`youtube/canonical/articles/${videoId}/`)
    objects += await this.deletePrefix(`youtube/canonical/chunks/${videoId}/`)
    const count = await this.repo.takedownVideo(videoId)
    return { rows: count, objects, bodies }
  }

  /** Called from the bookmark deletion path when the bookmark row itself is gone. */
  public async unlinkBookmark(bookmarkId: number): Promise<void> {
    await this.repo.unlinkBookmark(bookmarkId)
  }
}
