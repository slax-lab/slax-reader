import { DeepSeekError } from '@/infra/external/deepseekClient'
import type { AssemblyJobState } from '@/infra/external/assemblyAI'
import type { PodcastArticleRepo, PodcastEpisodeRepo, podcastEpisodePO } from '@/infra/repository/dbPodcastArticle'
import type { ArticleModel, StepLike } from '@/domain/youtubeArticleRunner'
import { podcastLanguage, type PodcastLanguage, type PodcastTranscriptRef } from '@/utils/podcastSource'
import {
  buildTranscriptDocument,
  chooseTranscriptRef,
  detectTranscriptLanguage,
  parsePublisherTranscript,
  transcriptHash,
  transcriptPlainText,
  type PodcastTranscriptDocument,
  type TranscriptSegment
} from '@/utils/podcastTranscript'
import {
  PODCAST_ARTICLE_PROMPT_VERSION,
  PODCAST_ARTICLE_SCHEMA_VERSION,
  PODCAST_LIMITS,
  PODCAST_POLISH_RESPONSE_SCHEMA,
  PODCAST_TRANSLATION_RESPONSE_SCHEMA,
  applyTranslation,
  articleParagraphText,
  buildPolishInstruction,
  buildPolishUserMessage,
  buildTranslationInstruction,
  buildTranslationUserMessage,
  chunkTranslationUnits,
  expectedEpisodeCostUsd,
  mergeGlossary,
  parseTranslationOutput,
  planPodcastChunks,
  polishPartFailures,
  podcastArticleKeys,
  podcastChunkKey,
  podcastChunkPrefix,
  podcastRequestSize,
  podcastSplitIndex,
  podcastTranscriptKey,
  renderPodcastText,
  translationUnits,
  type GlossaryEntry,
  type PodcastEpisodeContext
} from '@/utils/podcastArticle'
import {
  YOUTUBE_ARTICLE_MODEL,
  checkArticleQuality,
  estimateCostUsd,
  estimateTokens,
  mergeChunkResults,
  parseChunkOutput,
  repetitionRatio,
  type ArticleSection,
  type YoutubeArticleDocument,
  type YoutubeArticleQuality
} from '@/utils/youtubeArticle'

export type PodcastTrigger = 'crawl' | 'retry' | 'sweep'

export interface PodcastWorkflowParams {
  episodeId: number
  sourceId: string
  trigger: PodcastTrigger
}

export interface PodcastStepLike extends StepLike {
  sleep(name: string, ms: number): Promise<void>
}

export interface PodcastRunnerDeps {
  episodes: Pick<PodcastEpisodeRepo, 'findById' | 'claim' | 'renewLease' | 'setJob' | 'addAsrCost' | 'markReady' | 'finish' | 'markRepublish' | 'clearRepublish'>
  articles: Pick<
    PodcastArticleRepo,
    'recordEvaluation' | 'findById' | 'findVersion' | 'listForSource' | 'claim' | 'renewLease' | 'addCost' | 'publish' | 'finishAttempt' | 'dropRequest'
  >
  bucket: Pick<R2Bucket, 'get' | 'put' | 'head' | 'delete' | 'list'>
  model: ArticleModel
  asr: {
    submit(audioUrl: string, language: PodcastLanguage | null): Promise<string>
    get(jobId: string): Promise<AssemblyJobState>
  }
  /** Fetch a publisher transcript file. Rejects non-public addresses and oversized files. */
  fetchTranscript(url: string): Promise<string>
  /** Content moderation of the transcript: 0 normal, 1 adult, 2 dangerous. */
  moderate(title: string, text: string): Promise<number>
  /** Moderation hit: mark every bookmark of the episode as flagged. */
  flagBookmarks(sourceId: string, result: number): Promise<number>
  /** Write the ready article into the body of every bookmark of the episode. Returns the count. */
  publishBodies(sourceId: string): Promise<number>
  settleSnapshots(sourceId: string): Promise<number>
  processVectorMaintenance(sourceId: string, sourceHash: string): Promise<void>
  setRefsHash(sourceId: string, sourceHash: string): Promise<number>
  /** Article languages the episode's readers need besides the original. */
  translationTargets(sourceId: string, original: PodcastLanguage): Promise<PodcastLanguage[]>
  /** Adds an estimated cost to the site-wide daily podcast spend. */
  addCost(usd: number): Promise<void>
}

export type PodcastOutcome = 'ready' | 'not_claimed' | 'gone' | 'skipped' | 'failed' | 'retry'

const STOP_CODES = ['lease_lost', 'transcript_missing', 'chunk_truncated', 'chunk_timeout', 'chunk_deadline', 'chunk_call_limit'] as const

/** Never retried by the engine or the sweeper. */
export class PodcastStop extends Error {
  constructor(
    public readonly code: (typeof STOP_CODES)[number],
    message?: string
  ) {
    super(message ? `${code}: ${message}` : code)
    this.name = 'PodcastStop'
  }
}

class ChunkIncomplete extends Error {
  constructor(
    public readonly code: 'chunk_truncated' | 'chunk_timeout',
    public readonly usage: StoredPolishChunk['usage']
  ) {
    super(code)
  }
}

const DB_STEP = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' as const }, timeout: '1 minute' }
const FETCH_STEP = { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' as const }, timeout: '2 minutes' }
/** Maximum concurrently processed chunks per episode. */
const CHUNK_CONCURRENCY = 10
const CHUNK_STEP = { retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' as const }, timeout: '10 minutes' }
const ASSEMBLE_STEP = { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' as const }, timeout: '3 minutes' }
const PUBLISH_STEP = { retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' as const }, timeout: '10 minutes' }

/** Poll delays of a transcription job: 30 s at first, then 1 and 2 minutes. */
export function pollDelayMs(n: number): number {
  return n < 4 ? 30_000 : n < 10 ? 60_000 : 120_000
}

function log(event: string, p: PodcastWorkflowParams, extra: Record<string, unknown> = {}) {
  // ids, hashes and counts only; never transcript or article text
  console.log(JSON.stringify({ event: `podcast_${event}`, episode_id: p.episodeId, source_id: p.sourceId, trigger: p.trigger, ...extra }))
}

function stopCode(err: unknown): PodcastStop['code'] | null {
  if (err instanceof PodcastStop) return err.code
  const message = err instanceof Error ? err.message : String(err)
  return STOP_CODES.find(c => message.includes(c)) ?? null
}

async function readJson<T>(deps: PodcastRunnerDeps, key: string | null | undefined): Promise<T | null> {
  if (!key) return null
  const obj = await deps.bucket.get(key)
  return obj ? (JSON.parse(await obj.text()) as T) : null
}

async function deletePrefix(deps: PodcastRunnerDeps, prefix: string): Promise<number> {
  let cursor: string | undefined
  let count = 0
  do {
    const page = await deps.bucket.list({ prefix, cursor })
    const keys = page.objects.map(o => o.key)
    if (keys.length) await deps.bucket.delete(keys)
    count += keys.length
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return count
}

function contextOf(ep: podcastEpisodePO): PodcastEpisodeContext {
  return { title: ep.title, showName: ep.show_name, shownotes: ep.shownotes }
}

/**
 * One run for one episode (spec 4.2):
 *
 *   episode claim → transcript (publisher file, else AssemblyAI with polling) → speech and moderation
 *   checks → original-language article → body of every bookmark → translations
 *
 * An episode whose transcript is already ready goes straight to the articles; an article row that is
 * ready is not generated again. Every step returns keys, counts and short states only.
 */
export async function runPodcastEpisode(deps: PodcastRunnerDeps, p: PodcastWorkflowParams, step: PodcastStepLike, runId: string): Promise<PodcastOutcome> {
  const start = await step.do('episode', DB_STEP, async () => {
    const row = await deps.episodes.findById(p.episodeId)
    if (!row) return { kind: 'gone' as const }
    if (row.transcript_status === 'ready') return { kind: 'ready' as const }
    if (row.transcript_status !== 'pending' && !(row.transcript_status === 'transcribing' && row.run_id === runId)) return { kind: 'busy' as const }
    return (await deps.episodes.claim(row.id, runId, PODCAST_LIMITS.leaseMs)) ? { kind: 'claimed' as const, hash: row.transcript_hash ?? '' } : { kind: 'busy' as const }
  })
  if (start.kind === 'gone') return 'gone'
  if (start.kind === 'busy') {
    log('not_claimed', p)
    return 'not_claimed'
  }
  if (start.kind === 'claimed') {
    const transcribed = await transcribe(deps, p, step, runId)
    if (transcribed !== 'ready') {
      if (transcribed === 'failed' || transcribed === 'skipped')
        await step.do('episode-vector-maintenance', PUBLISH_STEP, () => deps.processVectorMaintenance(p.sourceId, start.hash))
      return transcribed
    }
  }
  return writeArticles(deps, p, step, runId)
}

// ---------- transcript ----------

interface StoredTranscript {
  key: string
  hash: string
  language: PodcastLanguage
  speakers: boolean
  source: 'publisher' | 'assemblyai'
  durationSec: number | null
}

async function storeTranscript(deps: PodcastRunnerDeps, sourceId: string, doc: PodcastTranscriptDocument): Promise<StoredTranscript> {
  const hash = await transcriptHash(doc)
  const key = podcastTranscriptKey(sourceId, hash)
  await deps.bucket.put(key, JSON.stringify(doc))
  if (!(await deps.bucket.head(key))) throw new Error('object_missing_after_write')
  return { key, hash, language: doc.language, speakers: doc.speakers, source: doc.source, durationSec: Math.round(doc.duration_ms / 1000) || null }
}

async function transcribe(deps: PodcastRunnerDeps, p: PodcastWorkflowParams, step: PodcastStepLike, runId: string): Promise<PodcastOutcome> {
  const lease = PODCAST_LIMITS.leaseMs
  const renew = async () => {
    if (!(await deps.episodes.renewLease(p.episodeId, runId, lease))) throw new PodcastStop('lease_lost')
    const row = await deps.episodes.findById(p.episodeId)
    if (!row) throw new PodcastStop('lease_lost')
    return row
  }
  const finish = async (kind: 'retry' | 'failed' | 'skipped', error: string, clearJob = false): Promise<PodcastOutcome> => {
    const status = await step.do(`episode-finish-${kind}`, DB_STEP, () => deps.episodes.finish(p.episodeId, { kind, error, clearJob }, { runId }))
    log('transcript_finished', p, { kind, error, status })
    if (status === null) return 'gone'
    if (status !== 'pending') await step.do(`episode-settle-${kind}`, PUBLISH_STEP, () => deps.settleSnapshots(p.sourceId))
    return status === 'pending' ? 'retry' : (status as PodcastOutcome)
  }

  try {
    const gate = await step.do('gate', DB_STEP, async () => {
      const row = await renew()
      if (!row.audio_url) return { kind: 'skip' as const, reason: 'no_audio' }
      const language = podcastLanguage(row.language)
      if (row.language && !language) return { kind: 'skip' as const, reason: 'language_unsupported' }
      const choice = chooseTranscriptRef((row.publisher_transcripts as unknown as PodcastTranscriptRef[] | null) ?? [])
      const expected = expectedEpisodeCostUsd({ durationSec: row.duration_sec ?? 3600, language, needsTranscription: !choice && !row.provider_job_id, translations: 1 })
      return { kind: 'ok' as const, ref: choice?.ref.url ?? null, format: choice?.format ?? null, language, expected }
    })
    if (gate.kind === 'skip') return finish('skipped', gate.reason)
    log('gate', p, { publisher: !!gate.ref, expected_cost_usd: Number(gate.expected.toFixed(4)) })

    let transcript: StoredTranscript | null = null
    if (gate.ref && gate.format) {
      const pub = await step.do('publisher-transcript', FETCH_STEP, async () => {
        const row = await renew()
        let segments: TranscriptSegment[]
        try {
          segments = parsePublisherTranscript(gate.format!, await deps.fetchTranscript(gate.ref!))
        } catch (err) {
          // A broken publisher file is not the end: the audio can still be transcribed
          log('publisher_transcript_unusable', p, { error: err instanceof Error ? err.message.slice(0, 120) : 'error' })
          return { kind: 'none' as const }
        }
        if (segments.length < 3) return { kind: 'none' as const }
        const language = gate.language ?? detectTranscriptLanguage(segments.map(s => s.text).join(' '))
        if (!language) return { kind: 'unsupported' as const }
        const doc = buildTranscriptDocument('publisher', language, segments, row.duration_sec ? row.duration_sec * 1000 : undefined)
        return { kind: 'ok' as const, transcript: await storeTranscript(deps, p.sourceId, doc) }
      })
      if (pub.kind === 'unsupported') return finish('skipped', 'language_unsupported')
      if (pub.kind === 'ok') transcript = pub.transcript
    }

    if (!transcript) {
      // Submit and save are two steps: when saving fails, the retry saves the id the engine kept
      // instead of submitting (and paying for) a second job
      const submitted = await step.do('asr-submit', FETCH_STEP, async () => {
        const row = await renew()
        return { jobId: row.provider_job_id || (await deps.asr.submit(row.audio_url, podcastLanguage(row.language))), known: !!row.provider_job_id }
      })
      const jobId = submitted.jobId
      if (!submitted.known)
        await step.do('asr-job', DB_STEP, async () => {
          if (!(await deps.episodes.setJob(p.episodeId, runId, jobId))) throw new PodcastStop('lease_lost')
        })
      log('asr_submitted', p)
      let waited = 0
      for (let n = 0; ; n++) {
        const delay = pollDelayMs(n)
        await step.sleep(`asr-wait-${n}`, delay)
        waited += delay
        const res = await step.do(`asr-poll-${n}`, FETCH_STEP, async () => {
          const row = await renew()
          const state = await deps.asr.get(jobId)
          if (state.status === 'pending') return { kind: 'pending' as const }
          if (state.status === 'error') return { kind: 'error' as const, error: state.error.slice(0, 120) }
          // Paid once the job is done, whatever happens next; a later attempt with the same job adds nothing
          if (await deps.episodes.addAsrCost(p.episodeId, jobId, state.costUsd)) await deps.addCost(state.costUsd)
          const language = podcastLanguage(state.language) ?? podcastLanguage(row.language)
          if (!language) return { kind: 'unsupported' as const }
          const doc = buildTranscriptDocument('assemblyai', language, state.segments, state.durationSec * 1000 || undefined)
          return { kind: 'done' as const, transcript: await storeTranscript(deps, p.sourceId, doc) }
        })
        if (res.kind === 'done') {
          transcript = res.transcript
          break
        }
        if (res.kind === 'error') return finish('retry', `asr_error:${res.error}`, true)
        if (res.kind === 'unsupported') return finish('skipped', 'language_unsupported')
        if (waited >= PODCAST_LIMITS.maxPollMs) return finish('failed', 'asr_timeout')
      }
    }

    const t = transcript!
    const checked = await step.do('transcript-check', FETCH_STEP, async () => {
      // A retry after markReady committed: the work is done
      const before = await deps.episodes.findById(p.episodeId)
      if (before?.transcript_status === 'ready' && before.run_id === runId && before.transcript_hash === t.hash) return { kind: 'ok' as const }
      const row = await renew()
      const doc = await readJson<PodcastTranscriptDocument>(deps, t.key)
      if (!doc) throw new PodcastStop('transcript_missing')
      if (!transcriptPlainText(doc).trim()) {
        await deps.bucket.delete(t.key)
        return { kind: 'skip' as const, reason: 'no_speech' }
      }
      const result = await deps.moderate(row.title, transcriptPlainText(doc))
      if (result > 0) {
        await deps.flagBookmarks(p.sourceId, result)
        await deps.bucket.delete(t.key)
        return { kind: 'skip' as const, reason: 'moderation' }
      }
      // Refs first: if markReady then fails, the refs only point at a transcript that is not ready yet
      await deps.setRefsHash(p.sourceId, t.hash)
      if (!(await deps.episodes.markReady(p.episodeId, runId, t))) throw new PodcastStop('lease_lost')
      return { kind: 'ok' as const }
    })
    if (checked.kind === 'skip') return finish('skipped', checked.reason)
    log('transcript_ready', p, { source: t.source, language: t.language, speakers: t.speakers, hash: t.hash.slice(0, 12) })
    return 'ready'
  } catch (err) {
    const code = stopCode(err)
    if (code === 'lease_lost') {
      log('lease_lost', p)
      return 'gone'
    }
    if (code) return finish('failed', code)
    return finish('retry', (err instanceof Error ? err.message : String(err)).slice(0, 200))
  }
}

// ---------- articles ----------

async function writeArticles(deps: PodcastRunnerDeps, p: PodcastWorkflowParams, step: PodcastStepLike, runId: string): Promise<PodcastOutcome> {
  const base = await step.do('article-row', DB_STEP, async () => {
    const ep = await deps.episodes.findById(p.episodeId)
    const lang = podcastLanguage(ep?.language)
    if (!ep || ep.transcript_status !== 'ready' || !ep.transcript_hash || !lang) return null
    // Create only when missing: a new save must not turn a skipped row back into pending
    const existing = await deps.articles.findVersion(ep.source_id, ep.transcript_hash, lang)
    if (existing) return { articleId: existing.id, status: existing.status, lang, hash: ep.transcript_hash }
    const row = await deps.articles.recordEvaluation({
      source_id: ep.source_id,
      caption_key: ep.transcript_key,
      caption_text_key: null,
      caption_language: lang,
      caption_kind: ep.transcript_source,
      source_hash: ep.transcript_hash,
      target_language: lang,
      prompt_version: PODCAST_ARTICLE_PROMPT_VERSION,
      schema_version: PODCAST_ARTICLE_SCHEMA_VERSION,
      status: 'pending',
      eligibility: { decision: 'generate', reason_codes: [] }
    })
    return { articleId: row.id, status: row.status, lang, hash: ep.transcript_hash }
  })
  if (!base) return 'gone'

  let outcome: PodcastOutcome = base.status === 'ready' ? 'ready' : 'not_claimed'
  if (base.status === 'pending') outcome = await runArticle(deps, p, step, runId, { mode: 'polish', articleId: base.articleId, lang: base.lang, hash: base.hash })
  if (outcome !== 'ready') {
    if (outcome === 'failed' || outcome === 'skipped') await step.do('article-vector-maintenance', PUBLISH_STEP, () => deps.processVectorMaintenance(p.sourceId, base.hash))
    return outcome
  }

  try {
    const published = await step.do('publish-body', PUBLISH_STEP, async () => {
      const count = await deps.publishBodies(p.sourceId)
      await deps.episodes.clearRepublish(p.episodeId)
      return count
    })
    log('bodies_published', p, { bookmarks: published })
  } catch (err) {
    // The article is ready but some bodies are not written: the sweep runs the bodies again later
    log('bodies_failed', p, { error: (err instanceof Error ? err.message : String(err)).slice(0, 120) })
    await step.do('republish-later', DB_STEP, () => deps.episodes.markRepublish(p.episodeId, new Date(Date.now() + 10 * 60 * 1000)))
  }

  let targets: PodcastLanguage[] = []
  try {
    targets = await step.do('translation-targets', DB_STEP, async () => {
      const wanted = await deps.translationTargets(p.sourceId, base.lang)
      // Pending translations nobody needs any more (the reader left) must not be started by the sweep forever
      for (const row of await deps.articles.listForSource(p.sourceId, base.hash))
        if (row.status === 'pending' && row.target_language !== base.lang && !wanted.includes(row.target_language as PodcastLanguage)) await deps.articles.dropRequest(row.id)
      return wanted
    })
  } catch (err) {
    log('translation_targets_failed', p, { error: (err instanceof Error ? err.message : String(err)).slice(0, 120) })
  }
  for (const lang of targets) {
    if (lang === base.lang) continue
    const row = await step.do(`translation-row-${lang}`, DB_STEP, async () => {
      const ep = await deps.episodes.findById(p.episodeId)
      if (!ep || ep.transcript_hash !== base.hash) return null
      const existing = await deps.articles.findVersion(ep.source_id, base.hash, lang)
      if (existing) return { articleId: existing.id, status: existing.status }
      const r = await deps.articles.recordEvaluation({
        source_id: ep.source_id,
        caption_key: ep.transcript_key,
        caption_text_key: null,
        caption_language: base.lang,
        caption_kind: ep.transcript_source,
        source_hash: base.hash,
        target_language: lang,
        prompt_version: PODCAST_ARTICLE_PROMPT_VERSION,
        schema_version: PODCAST_ARTICLE_SCHEMA_VERSION,
        status: 'pending',
        eligibility: { decision: 'generate', reason_codes: [] }
      })
      return { articleId: r.id, status: r.status }
    })
    if (row?.status === 'pending') await runArticle(deps, p, step, runId, { mode: 'translate', articleId: row.articleId, lang, hash: base.hash, from: base.lang })
  }
  await step.do('vector-maintenance', PUBLISH_STEP, () => deps.processVectorMaintenance(p.sourceId, base.hash))
  return 'ready'
}

interface ArticleJob {
  mode: 'polish' | 'translate'
  articleId: number
  lang: PodcastLanguage
  hash: string
  /** Translation only: the original language. */
  from?: PodcastLanguage
}

interface StoredPolishChunk {
  index: number
  lede: string
  sections: ArticleSection[]
  usage: { input_tokens: number; output_tokens: number; cost_usd: number }
}

interface StoredTranslationChunk {
  index: number
  texts: Record<string, string>
  /** Glossary for this chunk. */
  glossary: GlossaryEntry[]
  usage: { input_tokens: number; output_tokens: number; cost_usd: number }
}

interface Loaded {
  ep: podcastEpisodePO
  transcript: PodcastTranscriptDocument
  /** Translation only: the ready original-language article. */
  source: YoutubeArticleDocument | null
}

/**
 * One generation attempt of one article row: the original-language cleanup (polish) or one
 * translation. Same contract as the YouTube runner: claim with run_id, renew the lease in every
 * step, account for every model call, keep chunk results in R2 so a retry
 * reuses them, read objects back before the row says ready.
 */
async function runArticle(deps: PodcastRunnerDeps, p: PodcastWorkflowParams, step: PodcastStepLike, runId: string, job: ArticleJob): Promise<PodcastOutcome> {
  const lease = PODCAST_LIMITS.leaseMs
  const prefix = `${job.mode === 'polish' ? 'polish' : 'translate'}-${job.lang}`
  const chunkKey = (i: number) => podcastChunkKey(p.sourceId, job.hash, job.lang, i)
  const chunkPrefix = podcastChunkPrefix(p.sourceId, job.hash, job.lang)
  const keys = podcastArticleKeys(p.sourceId, job.hash, job.lang)

  const claimed = await step.do(`${prefix}-claim`, DB_STEP, () => deps.articles.claim(job.articleId, runId, lease))
  if (!claimed) return 'not_claimed'

  const finish = async (kind: 'retry' | 'failed' | 'skipped', error: string, quality?: object): Promise<PodcastOutcome> => {
    const status = await step.do(`${prefix}-finish-${kind}`, DB_STEP, () => deps.articles.finishAttempt(job.articleId, { kind, error, quality }, { runId }))
    log('article_finished', p, { mode: job.mode, lang: job.lang, kind, error, status })
    if (status === null) return 'gone'
    if (status !== 'pending') await step.do(`${prefix}-settle-${kind}`, PUBLISH_STEP, () => deps.settleSnapshots(p.sourceId))
    return status === 'pending' ? 'retry' : (status as PodcastOutcome)
  }

  const load = async (validating = false): Promise<Loaded> => {
    if (!(await deps.articles.renewLease(job.articleId, runId, lease, validating ? 'validating' : 'generating'))) throw new PodcastStop('lease_lost')
    const ep = await deps.episodes.findById(p.episodeId)
    if (!ep || ep.transcript_hash !== job.hash) throw new PodcastStop('lease_lost', 'transcript changed')
    const transcript = await readJson<PodcastTranscriptDocument>(deps, ep.transcript_key)
    if (!transcript) throw new PodcastStop('transcript_missing')
    let source: YoutubeArticleDocument | null = null
    if (job.mode === 'translate') {
      const original = (await deps.articles.listForSource(p.sourceId, job.hash)).find(r => r.target_language === job.from && r.status === 'ready')
      source = await readJson<YoutubeArticleDocument>(deps, original?.article_key)
      if (!source) throw new PodcastStop('transcript_missing', 'original article missing')
    }
    return { ep, transcript, source }
  }

  // Serialize usage accounting while provider requests run concurrently.
  let accounting: Promise<unknown> = Promise.resolve()
  let accountingError: unknown
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = accounting.then(fn)
    accounting = result.catch(() => {})
    return result
  }

  const checkDeadline = (deadline: number) => {
    if (Date.now() >= deadline) throw new PodcastStop('chunk_deadline')
  }

  const call = async (
    system: string,
    user: string,
    schema: object,
    attempt: { deadline: number; calls: number },
    index: number
  ): Promise<{ text: string; usage: StoredPolishChunk['usage'] }> => {
    const size = podcastRequestSize(system, user, schema)
    const next = estimateCostUsd(size.inputTokens, size.outputLimit)
    checkDeadline(attempt.deadline)
    if (attempt.calls >= PODCAST_LIMITS.maxChunkCalls) throw new PodcastStop('chunk_call_limit')
    await exclusive(async () => {
      checkDeadline(attempt.deadline)
      if (accountingError) throw accountingError
      const row = await deps.articles.findById(job.articleId)
      if (!row || row.run_id !== runId || row.status !== 'generating') throw new PodcastStop('lease_lost')
    })
    const charge = (cost: number) =>
      exclusive(async () => {
        try {
          await deps.articles.addCost(job.articleId, cost)
          await deps.addCost(cost)
        } catch (error) {
          accountingError = error
          throw error
        }
      })
    const startedAt = Date.now()
    const outcome: Record<string, unknown> = { outcome: 'error' }
    try {
      if (!(await deps.articles.renewLease(job.articleId, runId, lease))) throw new PodcastStop('lease_lost')
      const current = await deps.episodes.findById(p.episodeId)
      if (!current || current.transcript_hash !== job.hash) throw new PodcastStop('lease_lost')
      checkDeadline(attempt.deadline)
      if (accountingError) throw accountingError
      const signal = AbortSignal.timeout(Math.min(PODCAST_LIMITS.modelTimeoutMs, attempt.deadline - Date.now()))
      attempt.calls++
      let reply: Awaited<ReturnType<ArticleModel['chat']>>
      try {
        reply = await deps.model.chat(
          [{ role: 'user', parts: [{ text: user }] }],
          {
            abortSignal: signal,
            temperature: 0.2,
            maxOutputTokens: size.outputLimit,
            responseSchema: schema
          },
          { systemInstruction: system }
        )
      } catch (error) {
        const failure = error instanceof DeepSeekError ? error : undefined
        const rejected = failure?.providerStatus !== undefined && failure?.providerStatus >= 400 && failure?.providerStatus < 600
        const notConnected = failure?.code === 'configuration'
        Object.assign(outcome, { outcome: rejected ? 'rejected' : signal.aborted ? 'timeout' : 'lost', provider_status: failure?.providerStatus ?? null })
        if (rejected || notConnected) {
          checkDeadline(attempt.deadline)
          throw error
        }
        // No rejection or usage response: generation may have run before the connection was lost.
        await charge(next)
        log('usage_unknown', p, { mode: job.mode, lang: job.lang, index, cost_usd: next, timed_out: signal.aborted })
        checkDeadline(attempt.deadline)
        if (signal.aborted) throw new ChunkIncomplete('chunk_timeout', { input_tokens: size.inputTokens, output_tokens: size.outputLimit, cost_usd: next })
        throw error
      }
      const input = Number.isFinite(reply.usage?.inputTokens) && reply.usage!.inputTokens >= 0 ? reply.usage!.inputTokens : size.inputTokens
      const output = Number.isFinite(reply.usage?.outputTokens) && reply.usage!.outputTokens >= 0 ? reply.usage!.outputTokens : size.outputLimit
      const cost = estimateCostUsd(input, output)
      await charge(cost)
      const usage = { input_tokens: input, output_tokens: output, cost_usd: cost }
      Object.assign(outcome, {
        outcome: reply.finishReason === 'MAX_TOKENS' ? 'truncated' : 'ok',
        finish_reason: reply.finishReason ?? null,
        output_tokens: output,
        thought_tokens: reply.usage?.thoughtTokens ?? 0,
        response_chars: reply.text.length,
        repetition_ratio: Number(repetitionRatio(reply.text).toFixed(3))
      })
      if (reply.finishReason === 'MAX_TOKENS') {
        log('truncated', p, { mode: job.mode, lang: job.lang, index, input_tokens: input, output_tokens: output, thought_tokens: reply.usage?.thoughtTokens ?? 0 })
        throw new ChunkIncomplete('chunk_truncated', usage)
      }
      checkDeadline(attempt.deadline)
      if (signal.aborted) throw new ChunkIncomplete('chunk_timeout', usage)
      return { text: reply.text, usage }
    } finally {
      log('call', p, {
        mode: job.mode,
        lang: job.lang,
        index,
        system_tokens: size.systemTokens,
        user_tokens: size.userTokens,
        input_tokens: size.inputTokens,
        max_output_tokens: size.outputLimit,
        elapsed_ms: Date.now() - startedAt,
        ...outcome
      })
    }
  }

  try {
    const prep = await step.do(`${prefix}-prepare`, DB_STEP, async () => {
      const { transcript, source } = await load()
      const count = job.mode === 'polish' ? planPodcastChunks(transcript).length : chunkTranslationUnits(translationUnits(source!)).length
      if (count === 0) return { kind: 'skip' as const, reason: 'transcript_missing' }
      return { kind: 'ok' as const, count }
    })
    if (prep.kind === 'skip') return finish('failed', prep.reason)

    const processChunk = async (i: number) => {
      const res = await step.do(`${prefix}-chunk-${i}`, CHUNK_STEP, async () => {
        const attempt = { deadline: Date.now() + PODCAST_LIMITS.chunkAttemptMs, calls: 0 }
        const key = chunkKey(i)
        const { ep, transcript, source } = await load()
        if (await deps.bucket.head(key)) return { reused: true, cost: 0 }
        const usage: StoredPolishChunk['usage'] = { input_tokens: 0, output_tokens: 0, cost_usd: 0 }
        const count = (used: StoredPolishChunk['usage']) => {
          usage.input_tokens += used.input_tokens
          usage.output_tokens += used.output_tokens
          usage.cost_usd += used.cost_usd
        }
        const inParts = async <I, T>(
          items: I[],
          request: (part: I[], offset: number) => { system: string; user: string; schema: object },
          weight: (item: I) => number,
          parse: (text: string, part: I[], offset: number) => T,
          offset = 0
        ): Promise<T[]> => {
          checkDeadline(attempt.deadline)
          if (accountingError) throw accountingError
          const { system, user, schema } = request(items, offset)
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([items, system, user, schema])))
          const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
          const partKey = `${key}.parts/${offset}-${offset + items.length}-${hash}.json`
          type Part = { kind: 'done'; value: T; usage: StoredPolishChunk['usage'] } | { kind: 'split'; at: number | null; usage: StoredPolishChunk['usage'] }
          let cached = await readJson<Part>(deps, partKey)
          if (cached?.kind === 'done') {
            count(cached.usage)
            return [cached.value]
          }
          if (cached?.at === null) {
            await deps.bucket.delete(partKey)
            cached = null
          }
          if (!cached) {
            const at = podcastSplitIndex(items.map(weight))
            const size = podcastRequestSize(system, user, schema)
            let reason = 'request_size'
            if (size.oversized && at !== null) {
              cached = { kind: 'split', at, usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 } }
            } else {
              // An indivisible part cannot split further; its stalls and runaway replies are intermittent,
              // so it is asked again a few times before the attempt gives up as retryable.
              for (let tries = 1; ; tries++) {
                try {
                  const reply = await call(system, user, schema, attempt, i)
                  const value = parse(reply.text, items, offset)
                  await deps.bucket.put(partKey, JSON.stringify({ kind: 'done', value, usage: reply.usage } satisfies Part))
                  count(reply.usage)
                  return [value]
                } catch (error) {
                  if (!(error instanceof ChunkIncomplete)) throw error
                  if (at === null) {
                    count(error.usage)
                    log('singleton_incomplete', p, { mode: job.mode, lang: job.lang, index: i, offset, reason: error.code, tries })
                    if (tries < PODCAST_LIMITS.singletonTries) continue
                    throw new Error(`singleton_incomplete:${error.code === 'chunk_timeout' ? 'stall' : 'runaway'}`)
                  }
                  reason = error.code
                  cached = { kind: 'split', at, usage: error.usage }
                  break
                }
              }
            }
            await deps.bucket.put(partKey, JSON.stringify(cached))
            log('split', p, { mode: job.mode, lang: job.lang, index: i, offset, units: items.length, at, reason, input_tokens: size.inputTokens })
          }
          count(cached.usage)
          if (cached.at === null || !Number.isInteger(cached.at) || cached.at < 1 || cached.at >= items.length) throw new Error('chunk_split_invalid')
          const left = await inParts(items.slice(0, cached.at), request, weight, parse, offset)
          const right = await inParts(items.slice(cached.at), request, weight, parse, offset + cached.at)
          return [...left, ...right]
        }
        let stored: StoredPolishChunk | StoredTranslationChunk
        if (job.mode === 'polish') {
          const chunks = planPodcastChunks(transcript)
          const chunk = chunks[i]
          const overlap = transcript.cues.slice(chunk.start, chunk.start + chunk.overlap)
          const overlapIds = new Set(overlap.map(c => c.id))
          const parts = await inParts(
            transcript.cues.slice(chunk.start + chunk.overlap, chunk.end),
            (cues, offset) => ({
              system: buildPolishInstruction(job.lang, contextOf(ep), { ...chunk, overlap: offset === 0 ? overlap.length : 0 }, chunks.length, null, offset > 0),
              user: buildPolishUserMessage(offset === 0 ? [...overlap, ...cues] : cues),
              schema: PODCAST_POLISH_RESPONSE_SCHEMA
            }),
            cue => estimateTokens(buildPolishUserMessage([cue])),
            (text, cues, offset) => {
              const parsed = parseChunkOutput(text)
              if (!parsed.ok) throw new Error(`chunk_invalid_json:${parsed.error}`)
              // Overlap cues were cleaned by the previous chunk: drop paragraphs made only of them, and drop
              // them from mixed paragraphs, so a paragraph's start time is one of this part's own cues
              const sections = parsed.value.sections
                .map(s => ({
                  ...s,
                  paragraphs: s.paragraphs
                    .filter(para => !para.source_cue_ids.length || !para.source_cue_ids.every(id => overlapIds.has(id)))
                    .map(para => ({ ...para, source_cue_ids: para.source_cue_ids.filter(id => !overlapIds.has(id)) }))
                }))
                .filter(s => s.paragraphs.length)
              const failed = polishPartFailures(sections, i === 0 && offset === 0 ? parsed.value.lede : '-')
              if (failed.length) {
                log('part_rejected', p, { mode: job.mode, lang: job.lang, index: i, offset, units: cues.length, failed })
                throw new Error(`chunk_quality:${failed.join(',')}`)
              }
              return { lede: i === 0 && offset === 0 ? parsed.value.lede : '', sections }
            }
          )
          stored = { index: i, lede: parts[0]?.lede ?? '', sections: parts.flatMap(part => part.sections), usage }
        } else {
          const chunk = chunkTranslationUnits(translationUnits(source!))[i]
          const system = buildTranslationInstruction(job.from!, job.lang, contextOf(ep), '', [])
          const parts = await inParts(
            chunk.units,
            units => ({ system, user: buildTranslationUserMessage({ index: i, units }), schema: PODCAST_TRANSLATION_RESPONSE_SCHEMA }),
            unit => estimateTokens(buildTranslationUserMessage({ index: i, units: [unit] })),
            (text, units) => {
              const parsed = parseTranslationOutput(
                text,
                units.map(u => u.id)
              )
              if (!parsed.ok) throw new Error(`chunk_invalid_json:${parsed.error}`)
              return { texts: Object.fromEntries(parsed.texts), glossary: parsed.glossary }
            }
          )
          stored = {
            index: i,
            texts: Object.assign({}, ...parts.map(part => part.texts)),
            glossary: parts.reduce((glossary, part) => mergeGlossary(glossary, part.glossary), [] as GlossaryEntry[]),
            usage
          }
        }
        checkDeadline(attempt.deadline)
        if (!(await deps.articles.renewLease(job.articleId, runId, lease))) throw new PodcastStop('lease_lost')
        await deps.bucket.put(key, JSON.stringify(stored))
        return { reused: false, cost: usage.cost_usd }
      })
      log('chunk', p, { mode: job.mode, lang: job.lang, index: i, reused: res.reused, cost_usd: Number(res.cost.toFixed(5)) })
    }

    // A rolling pool of CHUNK_CONCURRENCY: one slow chunk no longer holds back the rest of a batch.
    // After a failure no new chunk starts; chunks already running are awaited before it is thrown.
    const runChunks = async (indices: number[]) => {
      let next = 0
      let failure: { reason: unknown } | null = null
      const worker = async () => {
        while (!failure && next < indices.length) {
          const i = indices[next++]
          try {
            await processChunk(i)
          } catch (reason) {
            failure ??= { reason }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, indices.length) }, worker))
      if (failure) throw (failure as { reason: unknown }).reason
    }
    await runChunks(Array.from({ length: prep.count }, (_, i) => i))

    const assemble = () =>
      step.do(`${prefix}-assemble`, ASSEMBLE_STEP, async () => {
        const { ep, transcript, source } = await load(true)
        let doc: YoutubeArticleDocument
        let quality: YoutubeArticleQuality
        if (job.mode === 'polish') {
          const results: StoredPolishChunk[] = []
          for (let i = 0; i < prep.count; i++) {
            const c = await readJson<StoredPolishChunk>(deps, chunkKey(i))
            if (!c) throw new Error(`chunk_missing:${i}`)
            results.push(c)
          }
          doc = mergeChunkResults(results, transcript.cues, job.lang, transcript.speakers ? 'dialogue' : 'article')
          quality = checkArticleQuality(doc, transcriptPlainText(transcript))
        } else {
          const texts = new Map<string, string>()
          for (let i = 0; i < prep.count; i++) {
            const c = await readJson<StoredTranslationChunk>(deps, chunkKey(i))
            if (!c) throw new Error(`chunk_missing:${i}`)
            Object.entries(c.texts).forEach(([id, text]) => texts.set(id, text))
          }
          doc = applyTranslation(source!, translationUnits(source!), texts, job.lang)
          quality = checkArticleQuality(doc, articleParagraphText(source!))
        }
        const spent = (await deps.articles.findById(job.articleId))?.cost_usd ?? 0
        const summary = { ...quality, mode: job.mode, chunks: prep.count, cost_usd: Number(spent.toFixed(5)), model: YOUTUBE_ARTICLE_MODEL }
        if (!quality.passed) return { kind: 'quality_failed' as const, quality: summary }
        await deps.bucket.put(keys.jsonKey, JSON.stringify(doc))
        await deps.bucket.put(
          keys.textKey,
          renderPodcastText({
            info: {
              audioUrl: ep.audio_url,
              title: ep.title,
              showName: ep.show_name,
              coverUrl: ep.cover_url,
              durationSec: ep.duration_sec,
              shownotes: ep.shownotes,
              language: job.lang
            },
            doc
          })
        )
        const heads = await Promise.all([deps.bucket.head(keys.jsonKey), deps.bucket.head(keys.textKey)])
        if (heads.some(h => !h)) throw new Error('object_missing_after_write')
        return { kind: 'ok' as const, quality: summary }
      })

    const assembled = await assemble()
    if (assembled.kind === 'quality_failed') {
      // Empty cached output must not be reused by a later owner retry.
      await step.do(`${prefix}-drop-chunks`, DB_STEP, () => deletePrefix(deps, chunkPrefix))
      return finish('failed', `quality:${assembled.quality.failed.join(',')}`, assembled.quality)
    }

    const published = await step.do(`${prefix}-publish`, DB_STEP, () =>
      deps.articles.publish(job.articleId, runId, job.hash, job.lang, {
        article_key: keys.jsonKey,
        article_text_key: keys.textKey,
        model: YOUTUBE_ARTICLE_MODEL,
        quality: assembled.quality
      })
    )
    // Article keys are the same for every run of a version; a row that moved on keeps them only if it published them
    if (!published) return 'gone'
    await step
      .do(`${prefix}-settle-private`, PUBLISH_STEP, () => deps.settleSnapshots(p.sourceId))
      .catch(() => {
        log('private_settlement_failed', p, { mode: job.mode, lang: job.lang })
      })
    await step.do(`${prefix}-drop-chunks`, DB_STEP, () => deletePrefix(deps, chunkPrefix))
    log('article_ready', p, { mode: job.mode, lang: job.lang, cost_usd: assembled.quality.cost_usd, paragraphs: assembled.quality.metrics.paragraphs })
    return 'ready'
  } catch (err) {
    const code = stopCode(err)
    if (code === 'lease_lost') {
      log('lease_lost', p, { mode: job.mode, lang: job.lang })
      return 'gone'
    }
    if (code) return finish('failed', code)
    return finish('retry', (err instanceof Error ? err.message : String(err)).slice(0, 200))
  }
}
