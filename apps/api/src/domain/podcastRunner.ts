import type { VertexAIConfig } from '@/infra/external/vertexAIClient'
import type { AssemblyJobState } from '@/infra/external/assemblyAI'
import type { PodcastArticleRepo, PodcastEpisodeRepo, podcastEpisodePO } from '@/infra/repository/dbPodcastArticle'
import type { ArticleModel, StepLike } from '@/domain/youtubeArticleRunner'
import { podcastLanguage, type PodcastLanguage, type PodcastTranscriptRef } from '@/utils/podcastSource'
import {
  buildTranscriptDocument,
  chooseTranscriptRef,
  detectTranscriptLanguage,
  parsePublisherTranscript,
  speechDensity,
  transcriptHash,
  transcriptPlainText,
  type PodcastTranscriptDocument,
  type TranscriptSegment
} from '@/utils/podcastTranscript'
import {
  PODCAST_ARTICLE_PROMPT_VERSION,
  PODCAST_ARTICLE_SCHEMA_VERSION,
  PODCAST_LIMITS,
  PODCAST_TRANSLATION_RESPONSE_SCHEMA,
  applyTranslation,
  articleParagraphText,
  buildPolishInstruction,
  buildPolishUserMessage,
  buildTranslationInstruction,
  buildTranslationUserMessage,
  chunkTail,
  chunkTranslationUnits,
  expectedEpisodeCostUsd,
  mergeGlossary,
  parseTranslationOutput,
  planPodcastChunks,
  podcastArticleKeys,
  podcastChunkKey,
  podcastChunkPrefix,
  podcastTranscriptKey,
  polishQualityOptions,
  renderPodcastText,
  translationQualityOptions,
  translationUnits,
  type GlossaryEntry,
  type PodcastEpisodeContext
} from '@/utils/podcastArticle'
import {
  YOUTUBE_ARTICLE_LIMITS,
  YOUTUBE_ARTICLE_MODEL,
  YOUTUBE_ARTICLE_RESPONSE_SCHEMA,
  checkArticleQuality,
  estimateCostUsd,
  estimateTokens,
  expectedChunkCostUsd,
  mergeChunkResults,
  parseChunkOutput,
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
    'recordEvaluation' | 'findById' | 'findVersion' | 'listForSource' | 'claim' | 'renewLease' | 'addCost' | 'publish' | 'finishAttempt' | 'setRefsHash' | 'dropRequest'
  >
  bucket: Pick<R2Bucket, 'get' | 'put' | 'head' | 'delete' | 'list'>
  model: ArticleModel
  asr: { submit(audioUrl: string, language: PodcastLanguage | null): Promise<string>; get(jobId: string): Promise<AssemblyJobState> }
  /** Fetch a publisher transcript file. Rejects non-public addresses and oversized files. */
  fetchTranscript(url: string): Promise<string>
  /** Content moderation of the transcript: 0 normal, 1 adult, 2 dangerous. */
  moderate(title: string, text: string): Promise<number>
  /** Moderation hit: mark every bookmark of the episode as flagged. */
  flagBookmarks(sourceId: string, result: number): Promise<number>
  /** Write the ready article into the body of every bookmark of the episode. Returns the count. */
  publishBodies(sourceId: string): Promise<number>
  /** Article languages the episode's readers need besides the original. */
  translationTargets(sourceId: string, original: PodcastLanguage): Promise<PodcastLanguage[]>
  /** Adds an estimated cost to the site-wide daily podcast spend. */
  addCost(usd: number): Promise<void>
}

export type PodcastOutcome = 'ready' | 'not_claimed' | 'gone' | 'skipped' | 'failed' | 'retry'

/** Never retried by the engine or the sweeper. */
export class PodcastStop extends Error {
  constructor(
    public readonly code: 'budget_exceeded' | 'lease_lost' | 'transcript_missing',
    message?: string
  ) {
    super(message ? `${code}: ${message}` : code)
    this.name = 'PodcastStop'
  }
}

const DB_STEP = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' as const }, timeout: '1 minute' }
const FETCH_STEP = { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' as const }, timeout: '2 minutes' }
const CHUNK_STEP = { retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' as const }, timeout: '5 minutes' }
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
  return (['budget_exceeded', 'lease_lost', 'transcript_missing'] as const).find(c => message.includes(c)) ?? null
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

/** Everything spent on the episode so far: transcription plus every article version of the transcript. */
async function episodeSpent(deps: PodcastRunnerDeps, ep: podcastEpisodePO): Promise<number> {
  const rows = ep.transcript_hash ? await deps.articles.listForSource(ep.source_id, ep.transcript_hash) : []
  return ep.cost_usd + rows.reduce((sum, r) => sum + r.cost_usd, 0)
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
    return (await deps.episodes.claim(row.id, runId, PODCAST_LIMITS.leaseMs)) ? { kind: 'claimed' as const } : { kind: 'busy' as const }
  })
  if (start.kind === 'gone') return 'gone'
  if (start.kind === 'busy') {
    log('not_claimed', p)
    return 'not_claimed'
  }
  if (start.kind === 'claimed') {
    const transcribed = await transcribe(deps, p, step, runId)
    if (transcribed !== 'ready') return transcribed
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
    return status === 'pending' ? 'retry' : (status as PodcastOutcome)
  }

  try {
    const gate = await step.do('gate', DB_STEP, async () => {
      const row = await renew()
      if (!row.audio_url) return { kind: 'skip' as const, reason: 'no_audio' }
      if (row.duration_sec && row.duration_sec > PODCAST_LIMITS.maxDurationSec) return { kind: 'skip' as const, reason: 'too_long' }
      const language = podcastLanguage(row.language)
      if (row.language && !language) return { kind: 'skip' as const, reason: 'language_unsupported' }
      const choice = chooseTranscriptRef((row.publisher_transcripts as unknown as PodcastTranscriptRef[] | null) ?? [])
      // Unknown duration: assume an hour, the transcription result enforces the real limit
      const expected = expectedEpisodeCostUsd({ durationSec: row.duration_sec ?? 3600, language, needsTranscription: !choice && !row.provider_job_id, translations: 1 })
      if (expected > PODCAST_LIMITS.maxEpisodeCostUsd) return { kind: 'skip' as const, reason: 'too_long' }
      // Earlier attempts already spent part of the episode's budget
      if (row.cost_usd + expected > PODCAST_LIMITS.maxEpisodeCostUsd) return { kind: 'skip' as const, reason: 'budget_exceeded' }
      return { kind: 'ok' as const, ref: choice?.ref.url ?? null, format: choice?.format ?? null, language, expected }
    })
    if (gate.kind === 'skip') return await finish('skipped', gate.reason)
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
      if (pub.kind === 'unsupported') return await finish('skipped', 'language_unsupported')
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
          if (state.durationSec > PODCAST_LIMITS.maxDurationSec) return { kind: 'too_long' as const }
          const doc = buildTranscriptDocument('assemblyai', language, state.segments, state.durationSec * 1000 || undefined)
          return { kind: 'done' as const, transcript: await storeTranscript(deps, p.sourceId, doc) }
        })
        if (res.kind === 'done') {
          transcript = res.transcript
          break
        }
        if (res.kind === 'error') return await finish('retry', `asr_error:${res.error}`, true)
        if (res.kind === 'unsupported') return await finish('skipped', 'language_unsupported')
        if (res.kind === 'too_long') return await finish('skipped', 'too_long')
        if (waited >= PODCAST_LIMITS.maxPollMs) return await finish('failed', 'asr_timeout')
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
      if (!speechDensity(doc).enough) {
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
      await deps.articles.setRefsHash(p.sourceId, t.hash)
      if (!(await deps.episodes.markReady(p.episodeId, runId, t))) throw new PodcastStop('lease_lost')
      return { kind: 'ok' as const }
    })
    if (checked.kind === 'skip') return await finish('skipped', checked.reason)
    log('transcript_ready', p, { source: t.source, language: t.language, speakers: t.speakers, hash: t.hash.slice(0, 12) })
    return 'ready'
  } catch (err) {
    const code = stopCode(err)
    if (code === 'lease_lost') {
      log('lease_lost', p)
      return 'gone'
    }
    if (code) return await finish('failed', code)
    return await finish('retry', (err instanceof Error ? err.message : String(err)).slice(0, 200))
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
  if (outcome !== 'ready') return outcome

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
  /** Glossary after this chunk (rolling). */
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
 * step, check the per-episode budget before every model call, keep chunk results in R2 so a retry
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

  /** Call the model once, count the cost first, return the text. */
  const call = async (ep: podcastEpisodePO, system: string, user: string, schema: object): Promise<{ text: string; usage: StoredPolishChunk['usage'] }> => {
    const next = expectedChunkCostUsd(estimateTokens(system + user))
    const spent = await episodeSpent(deps, ep)
    if (spent + next > PODCAST_LIMITS.maxEpisodeCostUsd) throw new PodcastStop('budget_exceeded', `spent=${spent.toFixed(4)} next=${next.toFixed(4)}`)
    const reply = await deps.model.chat(
      [{ role: 'user', parts: [{ text: user }] }],
      {
        model: YOUTUBE_ARTICLE_MODEL,
        temperature: 0.2,
        maxOutputTokens: YOUTUBE_ARTICLE_LIMITS.maxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema: schema as unknown as VertexAIConfig['responseSchema']
      },
      { systemInstruction: system }
    )
    const input = reply.usage?.inputTokens ?? estimateTokens(system + user)
    const output = reply.usage?.outputTokens ?? estimateTokens(reply.text)
    const cost = estimateCostUsd(input, output)
    // Counted before the reply is checked: a truncated or invalid reply still cost money
    await deps.articles.addCost(job.articleId, cost)
    await deps.addCost(cost)
    if (reply.finishReason === 'MAX_TOKENS') throw new Error('chunk_truncated')
    return { text: reply.text, usage: { input_tokens: input, output_tokens: output, cost_usd: cost } }
  }

  try {
    const prep = await step.do(`${prefix}-prepare`, DB_STEP, async () => {
      const { transcript, source } = await load()
      const count = job.mode === 'polish' ? planPodcastChunks(transcript).length : chunkTranslationUnits(translationUnits(source!)).length
      if (count === 0) return { kind: 'skip' as const, reason: 'transcript_missing' }
      if (count > PODCAST_LIMITS.maxChunks) return { kind: 'skip' as const, reason: 'too_long' }
      return { kind: 'ok' as const, count }
    })
    if (prep.kind === 'skip') return await finish(prep.reason === 'too_long' ? 'skipped' : 'failed', prep.reason)

    for (let i = 0; i < prep.count; i++) {
      const res = await step.do(`${prefix}-chunk-${i}`, CHUNK_STEP, async () => {
        const key = chunkKey(i)
        const { ep, transcript, source } = await load()
        if (await deps.bucket.head(key)) return { reused: true, cost: 0 }
        if (job.mode === 'polish') {
          const chunks = planPodcastChunks(transcript)
          const chunk = chunks[i]
          const prev = i > 0 ? await readJson<StoredPolishChunk>(deps, chunkKey(i - 1)) : null
          if (i > 0 && !prev) throw new Error(`chunk_missing:${i - 1}`)
          const system = buildPolishInstruction(job.lang, contextOf(ep), chunk, chunks.length, prev ? chunkTail(prev) : null)
          const reply = await call(ep, system, buildPolishUserMessage(transcript.cues.slice(chunk.start, chunk.end)), YOUTUBE_ARTICLE_RESPONSE_SCHEMA)
          const parsed = parseChunkOutput(reply.text)
          if (!parsed.ok) throw new Error(`chunk_invalid_json:${parsed.error}`)
          const stored: StoredPolishChunk = { index: i, lede: parsed.value.lede, sections: parsed.value.sections, usage: reply.usage }
          await deps.bucket.put(key, JSON.stringify(stored))
          return { reused: false, cost: reply.usage.cost_usd }
        }
        const chunks = chunkTranslationUnits(translationUnits(source!))
        const chunk = chunks[i]
        const prev = i > 0 ? await readJson<StoredTranslationChunk>(deps, chunkKey(i - 1)) : null
        if (i > 0 && !prev) throw new Error(`chunk_missing:${i - 1}`)
        const prevTail = prev ? Object.values(prev.texts).slice(-2).join('\n') : ''
        const glossary = prev?.glossary ?? []
        const system = buildTranslationInstruction(job.from!, job.lang, contextOf(ep), prevTail, glossary)
        const reply = await call(ep, system, buildTranslationUserMessage(chunk), PODCAST_TRANSLATION_RESPONSE_SCHEMA)
        const parsed = parseTranslationOutput(
          reply.text,
          chunk.units.map(u => u.id)
        )
        if (!parsed.ok) throw new Error(`chunk_invalid_json:${parsed.error}`)
        const stored: StoredTranslationChunk = { index: i, texts: Object.fromEntries(parsed.texts), glossary: mergeGlossary(glossary, parsed.glossary), usage: reply.usage }
        await deps.bucket.put(key, JSON.stringify(stored))
        return { reused: false, cost: reply.usage.cost_usd }
      })
      log('chunk', p, { mode: job.mode, lang: job.lang, index: i, reused: res.reused, cost_usd: Number(res.cost.toFixed(5)) })
    }

    const assembled = await step.do(`${prefix}-assemble`, ASSEMBLE_STEP, async () => {
      const { ep, transcript, source } = await load(true)
      const ctx = contextOf(ep)
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
        quality = checkArticleQuality(doc, transcript.cues, transcriptPlainText(transcript), polishQualityOptions(transcript, ctx))
      } else {
        const texts = new Map<string, string>()
        for (let i = 0; i < prep.count; i++) {
          const c = await readJson<StoredTranslationChunk>(deps, chunkKey(i))
          if (!c) throw new Error(`chunk_missing:${i}`)
          Object.entries(c.texts).forEach(([id, text]) => texts.set(id, text))
        }
        doc = applyTranslation(source!, translationUnits(source!), texts, job.lang)
        quality = checkArticleQuality(doc, transcript.cues, articleParagraphText(source!), translationQualityOptions(job.from!, job.lang, source!))
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

    if (assembled.kind === 'quality_failed') {
      // The cached chunks produced a bad article; drop them so the next attempt asks the model again
      await step.do(`${prefix}-drop-chunks`, DB_STEP, () => deletePrefix(deps, chunkPrefix))
      return await finish('failed', `quality:${assembled.quality.failed.join(',')}`, assembled.quality)
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
    await step.do(`${prefix}-drop-chunks`, DB_STEP, () => deletePrefix(deps, chunkPrefix))
    log('article_ready', p, { mode: job.mode, lang: job.lang, cost_usd: assembled.quality.cost_usd, paragraphs: assembled.quality.metrics.paragraphs })
    return 'ready'
  } catch (err) {
    const code = stopCode(err)
    if (code === 'lease_lost') {
      log('lease_lost', p, { mode: job.mode, lang: job.lang })
      return 'gone'
    }
    if (code) return await finish('failed', code)
    return await finish('retry', (err instanceof Error ? err.message : String(err)).slice(0, 200))
  }
}
