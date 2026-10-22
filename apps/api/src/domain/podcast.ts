import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { ContextManager } from '@/utils/context'
import { BookmarkService } from '@/domain/bookmark'
import { LabService } from '@/domain/lab'
import { MediaBodyService } from '@/domain/mediaBody'
import { MediaSnapshotService } from '@/domain/mediaSnapshot'
import { privateMediaVersion, type MediaSnapshot } from '@/utils/mediaSnapshot'
import { UserRepo } from '@/infra/repository/dbUser'
import { RedisClient } from '@/infra/repository/redisClient'
import { BucketClient } from '@/infra/repository/bucketClient'
import { SlaxAlertBotClient } from '@/infra/external/slaxAlertBot'
import { isFinalError, type mediaArticlePO } from '@/infra/repository/dbMediaArticle'
import { PodcastArticleRepo, PodcastEpisodeRepo, isPodcastFinalError, type podcastEpisodePO } from '@/infra/repository/dbPodcastArticle'
import { podcastLanguage, type PodcastLanguage } from '@/utils/podcastSource'
import type { PodcastTranscriptDocument } from '@/utils/podcastTranscript'
import {
  PODCAST_ARTICLE_PROMPT_VERSION,
  PODCAST_ARTICLE_SCHEMA_VERSION,
  PODCAST_LIMITS,
  podcastArticleVersion,
  podcastChunkPrefix,
  podcastWorkflowId,
  renderPodcastBody,
  renderPodcastText,
  speakerDisplay,
  type PodcastPlayerInfo
} from '@/utils/podcastArticle'
import { youtubeArticleLanguage, type YoutubeArticleDocument } from '@/utils/youtubeArticle'
import type { PodcastTrigger, PodcastWorkflowParams } from '@/domain/podcastRunner'
import { BookmarkNotFoundError, ErrorParam } from '@/const/err'

export const PODCAST_LAB = 'podcast'

/** Episode workflows (transcribing or writing) that may run at once. */
export const PODCAST_MAX_CONCURRENT = 4

export type PodcastTranscriptApiStatus = 'pending' | 'transcribing' | 'ready' | 'failed' | 'skipped' | 'unavailable'
export type PodcastArticleApiStatus = 'pending' | 'generating' | 'validating' | 'ready' | 'failed' | 'skipped' | 'unavailable'

export interface PodcastStatusResponse {
  transcript: PodcastTranscriptApiStatus
  article: PodcastArticleApiStatus
  /** The bookmark body is the cleaned transcript. */
  body_ready: boolean
  /** The episode's language. */
  language: PodcastLanguage | null
  /** Why the episode or article stopped: too_long, no_speech, limit_reached, ... */
  reason: string | null
  translation: { status: PodcastArticleApiStatus; language: PodcastLanguage; version: string | null } | null
  can_retry: boolean
}

export interface PodcastTranslationResponse {
  version: string
  language: PodcastLanguage
  lede: string
  sections: { heading: string; start_ms: number; paragraphs: { speaker: string | null; text: string; start_ms: number }[] }[]
}

type StartResult = 'started' | 'locked' | 'busy' | 'over_budget' | 'failed'

interface Access {
  bookmarkId: number
  ownerId: number
  isOwner: boolean
  flagged: boolean
}

const DAY_SECONDS = 24 * 60 * 60

function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '')
}

export function playerInfo(ep: podcastEpisodePO): PodcastPlayerInfo {
  return {
    audioUrl: ep.audio_url,
    title: ep.title,
    showName: ep.show_name,
    coverUrl: ep.cover_url,
    durationSec: ep.duration_sec,
    shownotes: ep.shownotes,
    language: podcastLanguage(ep.language)
  }
}

/**
 * Podcast articles: who may see what, when an episode run starts (crawl, retry, sweep), the daily
 * and budget limits, writing the article into bookmark bodies, and cleanup. The episode and its
 * article rows are canonical (shared by every bookmark of the episode); the bookmark decides visibility.
 */
@injectable()
export class PodcastService {
  constructor(
    @inject(PodcastEpisodeRepo) private episodes: PodcastEpisodeRepo,
    @inject(PodcastArticleRepo) private articles: PodcastArticleRepo,
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(MediaBodyService) private bodies: MediaBodyService,
    @inject(LabService) private labService: LabService,
    @inject(UserRepo) private userRepo: UserRepo,
    @inject(RedisClient) private redis: LazyInstance<RedisClient>,
    @inject(BucketClient) private bucket: LazyInstance<BucketClient>,
    @inject(SlaxAlertBotClient) private alertBot: SlaxAlertBotClient,
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
    return { bookmarkId: ub.bookmark_id, ownerId: ub.user_id, isOwner, flagged }
  }

  /** The reader's article language: ai_lang, else lang, limited to zh/en (same rule as the summaries). */
  public async languageOf(userId: number): Promise<PodcastLanguage> {
    if (!userId) return 'en'
    try {
      const user = await this.userRepo.getInfoByUserId(userId)
      return youtubeArticleLanguage(user.ai_lang, user.lang)
    } catch {
      return 'en'
    }
  }

  private async findEpisodeFor(bookmarkId: number): Promise<podcastEpisodePO | null> {
    const ref = await this.articles.findRef(bookmarkId)
    return ref ? this.episodes.findBySourceId(ref.source_id) : null
  }

  // ---------- read ----------

  public async getStatus(ctx: ContextManager, bookmarkUid: string): Promise<PodcastStatusResponse> {
    const access = await this.resolveAccess(ctx, bookmarkUid)
    const unavailable: PodcastStatusResponse = {
      transcript: 'unavailable',
      article: 'unavailable',
      body_ready: false,
      language: null,
      reason: null,
      translation: null,
      can_retry: false
    }
    if (access.flagged) return unavailable
    let snapshot = (await this.snapshots.load(access.bookmarkId))?.media
    if (snapshot?.kind === 'podcast') {
      if (!(await this.snapshots.readable(snapshot))) return unavailable
      if (access.isOwner && (await this.snapshots.settle(ctx, access.bookmarkId))) snapshot = (await this.snapshots.load(access.bookmarkId))!.media!
      const wanted = await this.languageOf(ctx.getUserId() || access.ownerId)
      const enabled = await this.labService.isEnabled(access.ownerId, PODCAST_LAB)
      const result = this.privateStatus(snapshot, wanted, access, enabled)
      if (enabled && access.isOwner && snapshot.mode === 'capture' && snapshot.transcript === 'pending') {
        const ep = await this.findEpisodeFor(access.bookmarkId)
        if (ep?.transcript_status === 'pending' && !ep.next_retry_at) {
          result.can_retry = true
          if (!(await this.dailyLeft(access.ownerId))) result.reason = 'limit_reached'
        }
      }
      return result
    }
    if (!(await this.labService.isEnabled(access.ownerId, PODCAST_LAB))) return unavailable
    const ep = await this.findEpisodeFor(access.bookmarkId)
    if (!ep) return unavailable

    const lang = podcastLanguage(ep.language)
    const transcript = ep.transcript_status as PodcastTranscriptApiStatus
    const res: PodcastStatusResponse = { ...unavailable, transcript, language: lang }
    if (transcript === 'failed' || transcript === 'skipped') res.reason = (ep.error_message ?? '').split(':')[0] || null
    if (transcript === 'pending' && !ep.next_retry_at && access.isOwner && !(await this.dailyLeft(access.ownerId))) res.reason = 'limit_reached'
    res.can_retry = access.isOwner && ((transcript === 'failed' && !isPodcastFinalError(ep.error_message)) || (transcript === 'pending' && !ep.next_retry_at))

    // Visitors see only what will become readable: a failed or skipped episode is unavailable to them
    if (transcript !== 'ready' || !ep.transcript_hash || !lang) {
      if (access.isOwner) return res
      return transcript === 'pending' || transcript === 'transcribing' ? { ...unavailable, transcript: 'pending' } : unavailable
    }

    const rows = await this.articles.listForSource(ep.source_id, ep.transcript_hash)
    const original = rows.find(r => r.target_language === lang)
    res.article = (original?.status as PodcastArticleApiStatus) ?? 'pending'
    res.body_ready = original?.status === 'ready'
    if (original && (original.status === 'failed' || original.status === 'skipped')) res.reason = (original.error_message ?? '').split(':')[0] || null
    if (original?.status === 'failed' && access.isOwner && !isFinalError(original.error_message)) res.can_retry = true
    // Same visitor rule for the article stage: a running article is shown as running, a failed or
    // skipped one is unavailable, and no failure reason reaches a visitor
    if (!access.isOwner && original?.status !== 'ready') {
      if (original?.status === 'failed' || original?.status === 'skipped') return unavailable
      res.reason = null
    }

    const viewerId = ctx.getUserId()
    const wanted = await this.languageOf(viewerId > 0 ? viewerId : access.ownerId)
    if (wanted !== lang) {
      const tr = rows.find(r => r.target_language === wanted)
      const status = (tr?.status as PodcastArticleApiStatus) ?? 'pending'
      if (access.isOwner || status === 'ready') {
        res.translation = { status, language: wanted, version: tr?.status === 'ready' ? this.versionOf(tr) : null }
        if (tr?.status === 'failed' && access.isOwner && !isFinalError(tr.error_message) && res.body_ready) res.can_retry = true
      }
    }
    if (!access.isOwner) res.can_retry = false
    return res
  }

  private versionOf(row: mediaArticlePO): string {
    return podcastArticleVersion(row.source_hash, row.target_language, row.schema_version, row.prompt_version)
  }

  private privateStatus(snapshot: MediaSnapshot, wanted: PodcastLanguage, access: Access, acquisitionEnabled: boolean): PodcastStatusResponse {
    const language = snapshot.player?.language ?? snapshot.defaultLanguage
    const original = snapshot.variants[language]
    const translation = wanted !== language ? snapshot.variants[wanted] : undefined
    const state = (status: string | undefined): PodcastArticleApiStatus => {
      if (!status || (!access.isOwner && (status === 'failed' || status === 'skipped'))) return 'unavailable'
      return status as PodcastArticleApiStatus
    }
    return {
      transcript: state(snapshot.transcript) as PodcastTranscriptApiStatus,
      article: state(original?.status),
      language,
      body_ready: original?.status === 'ready' && snapshot.bodyLanguage === language,
      reason: access.isOwner ? (snapshot.transcriptReason ?? original?.reason ?? null) : null,
      can_retry:
        acquisitionEnabled &&
        access.isOwner &&
        snapshot.mode === 'capture' &&
        ((snapshot.transcript === 'failed' && !isPodcastFinalError(snapshot.transcriptReason)) ||
          [original, translation].some(variant => variant?.status === 'failed' && !isFinalError(variant.reason))),
      translation: translation
        ? { status: state(translation.status), language: wanted, version: translation.status === 'ready' ? privateMediaVersion(snapshot, wanted) : null }
        : null
    }
  }

  /**
   * One ready translation the bookmark can see, as structured text. Each paragraph carries the start
   * of its first cue, so the translation seeks like the original. Never accepts a raw object key.
   */
  public async getTranslation(ctx: ContextManager, bookmarkUid: string, version: string): Promise<PodcastTranslationResponse> {
    if (!version) throw ErrorParam()
    const access = await this.resolveAccess(ctx, bookmarkUid)
    if (access.flagged) throw BookmarkNotFoundError()
    const snapshot = (await this.snapshots.load(access.bookmarkId))?.media
    if (snapshot?.kind === 'podcast') {
      if (!(await this.snapshots.readable(snapshot))) throw BookmarkNotFoundError()
      const language = (['en', 'zh'] as const).find(
        lang => lang !== snapshot.player?.language && privateMediaVersion(snapshot, lang) === version && snapshot.variants[lang]?.status === 'ready'
      )
      if (!language) throw BookmarkNotFoundError()
      const content = snapshot.variants[language]!.content!
      return {
        ...content,
        version,
        sections: content.sections.map(section => ({
          ...section,
          paragraphs: section.paragraphs.map(p => ({ ...p, speaker: p.speaker ? speakerDisplay(p.speaker, language) : null }))
        }))
      }
    }
    if (!(await this.labService.isEnabled(access.ownerId, PODCAST_LAB))) throw BookmarkNotFoundError()
    const ep = await this.findEpisodeFor(access.bookmarkId)
    if (!ep?.transcript_hash || ep.transcript_status !== 'ready') throw BookmarkNotFoundError()
    const row = (await this.articles.listForSource(ep.source_id, ep.transcript_hash)).find(r => r.status === 'ready' && r.article_key && this.versionOf(r) === version)
    if (!row || row.target_language === podcastLanguage(ep.language)) throw BookmarkNotFoundError()
    const [docObj, transcriptObj] = await Promise.all([this.bucket().R2Bucket.get(row.article_key!), ep.transcript_key ? this.bucket().R2Bucket.get(ep.transcript_key) : null])
    if (!docObj || !transcriptObj) throw BookmarkNotFoundError()
    const doc = JSON.parse(await docObj.text()) as YoutubeArticleDocument
    const cues = (JSON.parse(await transcriptObj.text()) as PodcastTranscriptDocument).cues
    const startOf = new Map(cues.map(c => [c.id, c.start_ms]))
    const lang: PodcastLanguage = doc.language === 'zh' ? 'zh' : 'en'
    return {
      version,
      language: lang,
      lede: doc.lede,
      sections: doc.sections.map(s => ({
        heading: s.heading,
        start_ms: s.start_ms,
        paragraphs: s.paragraphs.map(p => {
          const starts = p.source_cue_ids.map(id => startOf.get(id)).filter((n): n is number => n !== undefined)
          return { speaker: p.speaker ? speakerDisplay(p.speaker, lang) : null, text: p.text, start_ms: starts.length ? Math.min(...starts) : s.start_ms }
        })
      }))
    }
  }

  // ---------- write ----------

  /** Owner retry: a failed transcript, a failed article, a failed translation, or an episode held back by the daily limit. */
  public async retry(ctx: ContextManager, bookmarkUid: string): Promise<PodcastStatusResponse> {
    const access = await this.resolveAccess(ctx, bookmarkUid)
    if (!access.isOwner || access.flagged) throw BookmarkNotFoundError()
    if ((await this.snapshots.load(access.bookmarkId))?.media?.mode === 'fork') throw BookmarkNotFoundError()
    if (!(await this.labService.isEnabled(access.ownerId, PODCAST_LAB))) throw this.labService.disabledError(PODCAST_LAB)
    const ep = await this.findEpisodeFor(access.bookmarkId)
    if (!ep) throw BookmarkNotFoundError()
    await this.snapshots.settleSource(ctx, 'podcast', ep.source_id)
    let requestedLanguage = await this.languageOf(access.ownerId)

    if (ep.transcript_status === 'failed') {
      if (!(await this.episodes.requeue(ep.id))) throw ErrorParam()
    } else if (ep.transcript_status === 'pending' && !ep.next_retry_at) {
      if (!(await this.takeDaily(access.ownerId))) return { ...(await this.getStatus(ctx, bookmarkUid)), reason: 'limit_reached', can_retry: false }
      await this.episodes.defer(ep.id, new Date())
    } else if (ep.transcript_status === 'ready' && ep.transcript_hash) {
      const rows = await this.articles.listForSource(ep.source_id, ep.transcript_hash)
      const lang = podcastLanguage(ep.language)
      const wanted = await this.languageOf(access.ownerId)
      const snapshot = (await this.snapshots.load(access.bookmarkId))?.media
      if (snapshot?.mode === 'capture') {
        const retryLanguage = [lang, wanted].find(language => language && snapshot.variants[language]?.status === 'failed' && !isFinalError(snapshot.variants[language]?.reason))
        const reusable = rows.find(row => row.target_language === retryLanguage && row.status === 'ready')
        if (retryLanguage && reusable) {
          await this.snapshots.openRequest(access.bookmarkId, retryLanguage)
          return this.getStatus(ctx, bookmarkUid)
        }
      }
      const failed = rows.find(r => r.target_language === lang && r.status === 'failed') ?? rows.find(r => r.target_language === wanted && r.status === 'failed')
      if (!failed || !(await this.articles.requeue(failed.id, true))) throw ErrorParam()
      requestedLanguage = failed.target_language as PodcastLanguage
    } else {
      throw ErrorParam()
    }
    const fresh = (await this.episodes.findById(ep.id)) ?? ep
    await this.snapshots.openRequest(access.bookmarkId, requestedLanguage, ep.transcript_status !== 'ready')
    await this.start(ctx, fresh, 'retry')
    return this.getStatus(ctx, bookmarkUid)
  }

  /**
   * After a podcast save passed moderation. A new episode counts against the daily limit and starts
   * transcription; an episode that is already done gets its article copied into this bookmark at once,
   * and a missing translation for this reader is queued. Never throws: the bookmark is already saved.
   */
  public async triggerAfterCrawl(ctx: ContextManager, bookmarkId: number, userId: number): Promise<void> {
    try {
      const snapshot = (await this.snapshots.load(bookmarkId))?.media
      if (snapshot && (snapshot.mode === 'fork' || (snapshot.transcript !== 'pending' && !Object.values(snapshot.variants).some(variant => variant.status === 'pending')))) return
      if (!(await this.labService.isEnabled(userId, PODCAST_LAB))) return
      const ep = await this.findEpisodeFor(bookmarkId)
      if (!ep) return
      if (ep.transcript_status === 'pending') {
        // Already requested (deferred): the sweep starts it
        if (ep.next_retry_at) return
        if (!(await this.takeDaily(userId))) {
          console.log(`Podcast trigger after crawl: bookmark=${bookmarkId} episode=${ep.id} daily limit reached`)
          return
        }
        const result = await this.start(ctx, ep, 'crawl')
        // Deferred starts (busy, over budget, create failed) still run later through the sweep, so they
        // keep the count. 'locked' means another start of this episode is in flight and already counted.
        if (result === 'locked') await this.giveBackDaily(userId)
        console.log(`Podcast trigger after crawl: bookmark=${bookmarkId} episode=${ep.id} result=${result}`)
        return
      }
      const lang = podcastLanguage(ep.language)
      if (ep.transcript_status !== 'ready' || !lang) return
      const original = await this.ensureArticleRow(ep, lang)
      if (original.status === 'ready') await this.publishBodyFor(ctx, bookmarkId, userId, ep, original)
      let needed = original.status === 'pending'
      const wanted = await this.languageOf(userId)
      if (wanted !== lang) needed = (await this.ensureArticleRow(ep, wanted)).status === 'pending' || needed
      if (needed) console.log(`Podcast trigger after crawl: bookmark=${bookmarkId} episode=${ep.id} result=${await this.start(ctx, ep, 'crawl')}`)
    } catch (err) {
      console.error(`Podcast trigger after crawl failed for bookmark ${bookmarkId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Create the row only when missing: a new save must not turn a skipped row back into pending. */
  private async ensureArticleRow(ep: podcastEpisodePO, lang: PodcastLanguage): Promise<mediaArticlePO> {
    const existing = await this.articles.findVersion(ep.source_id, ep.transcript_hash!, lang)
    if (existing) return existing
    return this.articles.recordEvaluation({
      source_id: ep.source_id,
      caption_key: ep.transcript_key,
      caption_text_key: null,
      caption_language: podcastLanguage(ep.language),
      caption_kind: ep.transcript_source,
      source_hash: ep.transcript_hash!,
      target_language: lang,
      prompt_version: PODCAST_ARTICLE_PROMPT_VERSION,
      schema_version: PODCAST_ARTICLE_SCHEMA_VERSION,
      status: 'pending',
      eligibility: { decision: 'generate', reason_codes: [] }
    })
  }

  // ---------- bodies ----------

  /**
   * Write the ready original-language article into the body of every bookmark of the episode.
   * Unlike YouTube, marks do not keep the old body: the podcast's first body is only the player and
   * show notes, the transcript exists nowhere else on the page, and the page has no "article below
   * the body" fallback. Marks on the show notes lose their anchor; that is the accepted trade-off.
   */
  public async publishBodies(ctx: ContextManager, sourceId: string): Promise<number> {
    const settled = await this.snapshots.settleSource(ctx, 'podcast', sourceId)
    const ep = await this.episodes.findBySourceId(sourceId)
    const lang = podcastLanguage(ep?.language)
    if (!ep || ep.transcript_status !== 'ready' || !ep.transcript_hash || !lang) return settled
    const row = await this.articles.findVersion(sourceId, ep.transcript_hash, lang)
    if (row?.status !== 'ready') return settled
    const rendered = await this.renderBody(ep, row)
    if (!rendered) return 0
    let count = settled
    for (const ref of await this.articles.listEpisodeRefs(sourceId)) {
      if ((await this.snapshots.load(ref.bookmark_id))?.managed) continue
      if (ref.source_hash !== ep.transcript_hash) continue
      if (await this.writeBody(ctx, ref.bookmark_id, ref.user_id, rendered)) count++
    }
    return count
  }

  public async settleSnapshots(ctx: ContextManager, sourceId: string) {
    return this.snapshots.settleSource(ctx, 'podcast', sourceId)
  }

  private async publishBodyFor(ctx: ContextManager, bookmarkId: number, userId: number, ep: podcastEpisodePO, row: mediaArticlePO): Promise<boolean> {
    if ((await this.snapshots.load(bookmarkId))?.managed) return this.snapshots.settle(ctx, bookmarkId)
    const rendered = await this.renderBody(ep, row)
    return rendered ? this.writeBody(ctx, bookmarkId, userId, rendered) : false
  }

  private async renderBody(ep: podcastEpisodePO, row: mediaArticlePO): Promise<{ html: string; text: string } | null> {
    if (!row.article_key || !ep.transcript_key) return null
    const bucket = this.bucket().R2Bucket
    const [docObj, transcriptObj] = await Promise.all([bucket.get(row.article_key), bucket.get(ep.transcript_key)])
    if (!docObj || !transcriptObj) return null
    const doc = JSON.parse(await docObj.text()) as YoutubeArticleDocument
    const transcript = JSON.parse(await transcriptObj.text()) as PodcastTranscriptDocument
    const info = playerInfo(ep)
    return { html: renderPodcastBody({ info, article: { doc, version: this.versionOf(row), cues: transcript.cues } }), text: renderPodcastText({ info, doc }) }
  }

  /** The cached AI overview was made from the show notes: writeBody deletes it, so it is made again from the article. */
  private async writeBody(ctx: ContextManager, bookmarkId: number, userId: number, body: { html: string; text: string }): Promise<boolean> {
    return this.bodies.writeBody(ctx, bookmarkId, userId, body)
  }

  /** Transcript moderation hit: every bookmark of the episode is flagged and loses its share, like a crawl hit. */
  public async flagBookmarks(sourceId: string, result: number): Promise<number> {
    await this.snapshots.denyPodcast(sourceId)
    const refs = await this.articles.listEpisodeRefs(sourceId)
    for (const ref of refs) {
      await this.bookmarkService.updateBookmarkModerationResult(ref.bookmark_id, result)
      await this.bookmarkService.disableBookmarkShare(ref.bookmark_id, ref.user_id)
    }
    await this.alertBot.crawl
      .pushMessage(`🔍 **Podcast transcript moderation**\n**Level**: ${result}\n**Episode**: ${sourceId}\n**Bookmarks**: ${refs.length}\n**处理**: 已禁止分享、不生成整理稿`)
      .catch((e: unknown) => console.error(`podcast moderation alert failed: ${e}`))
    return refs.length
  }

  /** Languages the episode's readers (with the switch on) need besides the original. */
  public async translationTargets(sourceId: string, original: PodcastLanguage): Promise<PodcastLanguage[]> {
    const out = new Set<PodcastLanguage>()
    const users = new Set<number>()
    for (const ref of await this.articles.listEpisodeRefs(sourceId)) {
      const loaded = await this.snapshots.load(ref.bookmark_id)
      if (!loaded?.managed) {
        users.add(ref.user_id)
        continue
      }
      const snapshot = loaded.media
      if (snapshot?.mode !== 'capture' || !(await this.labService.isEnabled(ref.user_id, PODCAST_LAB))) continue
      for (const lang of ['en', 'zh'] as const) if (lang !== original && snapshot.variants[lang]?.status === 'pending') out.add(lang)
    }
    for (const userId of users) {
      if (!(await this.labService.isEnabled(userId, PODCAST_LAB))) continue
      const lang = await this.languageOf(userId)
      if (lang !== original) out.add(lang)
    }
    return [...out]
  }

  // ---------- start ----------

  /**
   * Start the episode workflow, or put it off for the sweeper: over budget, too many runs, or another
   * start in flight. The claims inside the workflow guarantee a single run per episode and row.
   */
  private async start(ctx: ContextManager, ep: podcastEpisodePO, trigger: PodcastTrigger): Promise<StartResult> {
    const defer = async (ms: number) => {
      const at = new Date(Date.now() + ms)
      if (ep.transcript_status === 'pending') await this.episodes.defer(ep.id, at)
      else if (ep.transcript_hash)
        for (const r of await this.articles.listForSource(ep.source_id, ep.transcript_hash)) if (r.status === 'pending') await this.articles.defer(r.id, at)
    }
    if (await this.overBudget()) {
      await defer(60 * 60 * 1000)
      return 'over_budget'
    }
    // debt: count-then-start is not atomic; a burst can briefly run a few more than the limit.
    // Upgrade to a Durable Object semaphore if bursts ever matter for cost or provider limits.
    if ((await this.episodes.countRunning()) + (await this.articles.countRunning()) >= PODCAST_MAX_CONCURRENT) {
      await defer(60 * 1000)
      return 'busy'
    }
    if (!(await this.redis().podcastStartLock(ep.id).setIfAbsent(1, 30))) {
      await defer(60 * 1000)
      return 'locked'
    }
    const params: PodcastWorkflowParams = { episodeId: ep.id, sourceId: ep.source_id, trigger }
    try {
      await ctx.env.PODCAST_WORKFLOW.create({ id: podcastWorkflowId(ep.source_id), params })
      return 'started'
    } catch (err) {
      console.error(`Podcast workflow create failed for episode ${ep.id}: ${err instanceof Error ? err.message : String(err)}`)
      await defer(5 * 60 * 1000)
      return 'failed'
    }
  }

  // ---------- limits ----------

  private async takeDaily(userId: number): Promise<boolean> {
    const counter = this.redis().podcastDaily(userId, utcDay())
    if ((await counter.incrWithExpire(2 * DAY_SECONDS)) > PODCAST_LIMITS.userDailyEpisodes) {
      await counter.incrBy(-1)
      return false
    }
    return true
  }

  private async giveBackDaily(userId: number): Promise<void> {
    await this.redis().podcastDaily(userId, utcDay()).incrBy(-1)
  }

  private async dailyLeft(userId: number): Promise<boolean> {
    return Number((await this.redis().podcastDaily(userId, utcDay()).get()) ?? 0) < PODCAST_LIMITS.userDailyEpisodes
  }

  private async overBudget(): Promise<boolean> {
    const day = utcDay()
    const spentMicro = Number((await this.redis().podcastCost(day).get()) ?? 0)
    if (spentMicro < PODCAST_LIMITS.dailyCostUsd * 1_000_000) return false
    if (
      await this.redis()
        .podcastBudgetAlert(day)
        .setIfAbsent(1, 2 * DAY_SECONDS)
    ) {
      await this.alertBot.crawl
        .pushMessage(`⚠️ **Podcast budget reached**\n**Day (UTC)**: ${day}\n**Spent**: ${(spentMicro / 1_000_000).toFixed(2)} USD\n**处理**: 新任务已暂停，次日自动恢复`)
        .catch((e: unknown) => console.error(`podcast budget alert failed: ${e}`))
    }
    return true
  }

  /** Add an estimated cost (transcription or model) to today's site-wide podcast spend. */
  public async addCost(usd: number): Promise<void> {
    if (!(usd > 0)) return
    const counter = this.redis().podcastCost(utcDay())
    await counter.incrBy(Math.ceil(usd * 1_000_000))
    await counter.expire(2 * DAY_SECONDS)
  }

  // ---------- sweep ----------

  /**
   * Every 5 minutes: dead runs back to pending (or failed), deferred episodes and article rows
   * started, and episodes and article rows no bookmark points at for 7 days deleted with their objects.
   */
  public async sweep(ctx: ContextManager): Promise<{ expired: number; started: number; deleted: number }> {
    const now = new Date()
    let expired = 0
    for (const ep of await this.episodes.listExpiredLeases(50, now)) {
      if (await this.episodes.finish(ep.id, { kind: 'retry', error: 'lease_expired', retryDelayMs: 60 * 1000 }, { expiredBefore: now })) expired++
    }
    for (const row of await this.articles.listExpiredLeases(50, now)) {
      if (await this.articles.finishAttempt(row.id, { kind: 'retry', error: 'lease_expired', retryDelayMs: 60 * 1000 }, { expiredBefore: now })) expired++
    }

    let slots = PODCAST_MAX_CONCURRENT - (await this.episodes.countRunning()) - (await this.articles.countRunning())
    let started = 0
    const candidates: podcastEpisodePO[] = []
    if (slots > 0) {
      candidates.push(...(await this.episodes.listRunnable(slots)))
      for (const ep of await this.episodes.listRepublish(slots)) if (!candidates.some(c => c.id === ep.id)) candidates.push(ep)
      for (const row of await this.articles.listRunnable(slots)) {
        const ep = await this.episodes.findBySourceId(row.source_id)
        if (ep && !candidates.some(c => c.id === ep.id)) candidates.push(ep)
      }
    }
    for (const ep of candidates) {
      if (slots <= 0) break
      const result = await this.start(ctx, ep, 'sweep')
      if (result === 'started') {
        started++
        slots--
      }
      if (result === 'busy' || result === 'over_budget') break
    }

    let deleted = 0
    const cutoff = new Date(Date.now() - 7 * DAY_SECONDS * 1000)
    const bucket = this.bucket().R2Bucket
    for (const row of await this.articles.listOrphans(cutoff, 200)) {
      const keys = [row.article_key, row.article_text_key].filter((k): k is string => !!k)
      if (!(await this.articles.deleteOrphan(row.id, cutoff))) continue
      if (keys.length) await bucket.delete(keys)
      await this.deletePrefix(podcastChunkPrefix(row.source_id, row.source_hash, row.target_language, row.prompt_version, row.schema_version))
      deleted++
    }
    for (const ep of await this.episodes.listOrphans(cutoff, 100)) {
      if (!(await this.episodes.deleteOrphan(ep.id, cutoff))) continue
      await this.deletePrefix(`podcast/canonical/transcripts/${ep.source_id}/`)
      deleted++
    }
    if (expired || started || deleted) console.log(`Podcast sweep: expired=${expired} started=${started} deleted=${deleted}`)
    return { expired, started, deleted }
  }

  private async deletePrefix(prefix: string): Promise<number> {
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
}
