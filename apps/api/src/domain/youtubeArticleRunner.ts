import type { Content } from '@google/genai'
import type { ChatUsage, VertexAIConfig } from '@/infra/external/vertexAIClient'
import type { YoutubeArticleRepo } from '@/infra/repository/dbYoutubeArticle'
import type { YoutubeArticleWorkflowParams } from '@/domain/youtubeArticle'
import type { YoutubeCaptionDocument } from '@/utils/youtubeCaption'
import { captionPlainText } from '@/utils/youtubeCaption'
import {
  YOUTUBE_ARTICLE_LIMITS,
  YOUTUBE_ARTICLE_MODEL,
  YOUTUBE_ARTICLE_RESPONSE_SCHEMA,
  buildSystemInstruction,
  buildUserMessage,
  checkArticleQuality,
  estimateCostUsd,
  estimateTokens,
  expectedChunkCostUsd,
  mergeChunkResults,
  parseChunkOutput,
  planYoutubeArticle,
  renderArticleHtml,
  renderArticleText,
  youtubeArticleChunkKey,
  youtubeArticleChunkPrefix,
  youtubeArticleKeys,
  youtubeArticleVersion,
  type ArticleSection,
  type YoutubeArticlePlan
} from '@/utils/youtubeArticle'

/** The part of WorkflowStep the runner uses, so tests can drive it without the Workers runtime. */
export interface StepLike {
  do<T>(
    name: string,
    config: { retries?: { limit: number; delay: string | number; backoff?: 'constant' | 'linear' | 'exponential' }; timeout?: string | number },
    fn: () => Promise<T>
  ): Promise<T>
}

export interface ArticleModel {
  chat(contents: Content[], config: VertexAIConfig, options: { systemInstruction: string }): Promise<{ text: string; usage?: ChatUsage; finishReason?: string }>
}

export interface RunnerDeps {
  repo: Pick<YoutubeArticleRepo, 'claim' | 'findById' | 'renewLease' | 'publish' | 'finishAttempt' | 'addCost'>
  bucket: Pick<R2Bucket, 'get' | 'put' | 'head' | 'delete' | 'list'>
  model: ArticleModel
  /** Adds one call's estimated cost to the site-wide daily spend. */
  addCost: (usd: number) => Promise<void>
  /** Write the ready article into the body of every bookmark that takes it. Returns the count. */
  publishBodies: (articleId: number) => Promise<number>
  settleSnapshots: (sourceId: string) => Promise<number>
}

export type RunnerOutcome = 'ready' | 'not_claimed' | 'gone' | 'skipped' | 'failed' | 'retry' | 'superseded'

/** Never retried by the workflow engine and never retried by the sweeper. */
export class YoutubeArticleStop extends Error {
  constructor(
    public readonly code: 'budget_exceeded' | 'lease_lost' | 'caption_missing',
    message?: string
  ) {
    // The code leads the message: the workflow engine may rewrap the error, the message survives
    super(message ? `${code}: ${message}` : code)
    this.name = 'YoutubeArticleStop'
  }
}

interface StoredChunk {
  index: number
  lede: string
  sections: ArticleSection[]
  usage: { input_tokens: number; output_tokens: number; cost_usd: number }
}

const DB_STEP = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' as const }, timeout: '1 minute' }
const CHUNK_STEP = { retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' as const }, timeout: '5 minutes' }
const ASSEMBLE_STEP = { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' as const }, timeout: '3 minutes' }
const PUBLISH_STEP = { retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' as const }, timeout: '5 minutes' }

function log(event: string, p: YoutubeArticleWorkflowParams, extra: Record<string, unknown> = {}) {
  // ids, hashes and counts only; never caption or article text
  console.log(
    JSON.stringify({
      event: `youtube_article_${event}`,
      article_id: p.articleId,
      video_id: p.videoId,
      source_hash: p.sourceHash.slice(0, 12),
      lang: p.targetLanguage,
      trigger: p.trigger,
      ...extra
    })
  )
}

async function loadCaption(deps: RunnerDeps, key: string | null): Promise<YoutubeCaptionDocument | null> {
  if (!key) return null
  const obj = await deps.bucket.get(key)
  if (!obj) return null
  return JSON.parse(await obj.text()) as YoutubeCaptionDocument
}

/**
 * One generation attempt for one canonical row. Large data lives in R2; every step returns only
 * keys, counts and short states, so the persisted step results stay small (spec 4.4, rule 1).
 *
 *   claim → prepare → chunk-0..n → assemble → publish
 *
 * The claim is a compare-and-set on the row, so a duplicate start exits at once without a model
 * call. Chunk results already in R2 from an earlier attempt of the same version are reused.
 */
export async function runYoutubeArticle(deps: RunnerDeps, p: YoutubeArticleWorkflowParams, step: StepLike, runId: string): Promise<RunnerOutcome> {
  const lease = YOUTUBE_ARTICLE_LIMITS.leaseMs
  const claimed = await step.do('claim', DB_STEP, () => deps.repo.claim(p.articleId, runId, lease))
  if (!claimed) {
    log('not_claimed', p)
    return 'not_claimed'
  }
  log('claimed', p)

  const finish = async (kind: 'retry' | 'failed' | 'skipped', error: string, quality?: object): Promise<RunnerOutcome> => {
    const status = await step.do(`finish-${kind}`, DB_STEP, () => deps.repo.finishAttempt(p.articleId, { kind, error, quality }, { runId }))
    log('finished', p, { kind, error, status })
    if (status === null) return 'gone'
    if (status !== 'pending') await step.do(`settle-${kind}`, PUBLISH_STEP, () => deps.settleSnapshots(p.videoId))
    return status === 'pending' ? 'retry' : (status as RunnerOutcome)
  }

  const sameRow = async () => {
    const row = await deps.repo.findById(p.articleId)
    if (!row || row.source_hash !== p.sourceHash || row.target_language !== p.targetLanguage) return null
    return row
  }

  /** The plan is recomputed inside each step from the immutable caption: deterministic and small to return. */
  const loadPlan = async (): Promise<{ plan: YoutubeArticlePlan; caption: YoutubeCaptionDocument } | { reason: 'too_long' | 'caption_missing' }> => {
    const row = await sameRow()
    if (!row) throw new YoutubeArticleStop('lease_lost', 'row changed')
    const caption = await loadCaption(deps, row.caption_key)
    const planned = planYoutubeArticle(caption)
    if (!planned.ok) return { reason: planned.reason }
    return { plan: planned.plan, caption: caption! }
  }

  try {
    const prep = await step.do('prepare', DB_STEP, async () => {
      if (!(await deps.repo.renewLease(p.articleId, runId, lease))) throw new YoutubeArticleStop('lease_lost')
      const loaded = await loadPlan()
      if ('reason' in loaded) return { kind: 'skip' as const, reason: loaded.reason }
      const { plan } = loaded
      // A video whose expected cost does not fit the per-video budget is skipped before any call,
      // instead of spending most of the budget and failing near the end
      const expected = plan.chunks.reduce((sum, chunk) => {
        const prompt = buildSystemInstruction(p.targetLanguage, chunk, plan.chunks.length) + buildUserMessage(p.title, plan.cues.slice(chunk.start, chunk.end))
        return sum + expectedChunkCostUsd(estimateTokens(prompt))
      }, 0)
      if (expected > YOUTUBE_ARTICLE_LIMITS.maxCostUsd) return { kind: 'skip' as const, reason: 'too_long' as const }
      // Earlier attempts already spent part of the budget: do not start a run the rest cannot pay for
      const spent = (await deps.repo.findById(p.articleId))?.cost_usd ?? 0
      if (spent + expected > YOUTUBE_ARTICLE_LIMITS.maxCostUsd) return { kind: 'skip' as const, reason: 'budget_exceeded' as const }
      return { kind: 'ok' as const, chunkCount: plan.chunks.length, format: plan.format, inputChars: plan.inputChars, durationMs: plan.durationMs, expectedCostUsd: expected }
    })
    if (prep.kind === 'skip') return await finish(prep.reason === 'too_long' ? 'skipped' : 'failed', prep.reason)

    log('prepared', p, { chunks: prep.chunkCount, input_chars: prep.inputChars, format: prep.format, expected_cost_usd: Number(prep.expectedCostUsd.toFixed(5)) })

    for (let i = 0; i < prep.chunkCount; i++) {
      const res = await step.do(`chunk-${i}`, CHUNK_STEP, async () => {
        if (!(await deps.repo.renewLease(p.articleId, runId, lease))) throw new YoutubeArticleStop('lease_lost')
        const key = youtubeArticleChunkKey(p.videoId, p.sourceHash, p.targetLanguage, p.promptVersion, i)
        if (await deps.bucket.head(key)) return { key, costUsd: 0, inputTokens: 0, outputTokens: 0, reused: true }

        const loaded = await loadPlan()
        if ('reason' in loaded) throw new YoutubeArticleStop('caption_missing', 'plan changed')
        const { plan } = loaded
        const chunk = plan.chunks[i]
        const cues = plan.cues.slice(chunk.start, chunk.end)
        const system = buildSystemInstruction(p.targetLanguage, chunk, plan.chunks.length)
        const user = buildUserMessage(p.title, cues)

        // The budget is per version across all attempts and step retries: the row carries the total.
        // Stop before a call whose expected cost would cross it.
        const spent = (await deps.repo.findById(p.articleId))?.cost_usd ?? 0
        const next = expectedChunkCostUsd(estimateTokens(system + user))
        if (spent + next > YOUTUBE_ARTICLE_LIMITS.maxCostUsd) throw new YoutubeArticleStop('budget_exceeded', `spent=${spent.toFixed(4)} next=${next.toFixed(4)}`)

        const reply = await deps.model.chat(
          [{ role: 'user', parts: [{ text: user }] }],
          {
            model: YOUTUBE_ARTICLE_MODEL,
            temperature: 0.2,
            maxOutputTokens: YOUTUBE_ARTICLE_LIMITS.maxOutputTokens,
            responseMimeType: 'application/json',
            responseSchema: YOUTUBE_ARTICLE_RESPONSE_SCHEMA as unknown as VertexAIConfig['responseSchema']
          },
          { systemInstruction: system }
        )
        const inputTokens = reply.usage?.inputTokens ?? estimateTokens(system + user)
        const outputTokens = reply.usage?.outputTokens ?? estimateTokens(reply.text)
        const costUsd = estimateCostUsd(inputTokens, outputTokens)
        // Counted before the reply is checked: a truncated or invalid reply still cost money
        await deps.repo.addCost(p.articleId, costUsd)
        await deps.addCost(costUsd)

        if (reply.finishReason === 'MAX_TOKENS') throw new Error('chunk_truncated')
        const parsed = parseChunkOutput(reply.text)
        if (!parsed.ok) throw new Error(`chunk_invalid_json:${parsed.error}`)

        const stored: StoredChunk = {
          index: i,
          lede: parsed.value.lede,
          sections: parsed.value.sections,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd }
        }
        await deps.bucket.put(key, JSON.stringify(stored))
        return { key, costUsd, inputTokens, outputTokens, reused: false }
      })
      log('chunk', p, { index: i, reused: res.reused, input_tokens: res.inputTokens, output_tokens: res.outputTokens, cost_usd: Number(res.costUsd.toFixed(5)) })
    }

    const keys = youtubeArticleKeys(p.videoId, p.sourceHash, p.targetLanguage, 1, p.promptVersion)
    const assembled = await step.do('assemble', ASSEMBLE_STEP, async () => {
      if (!(await deps.repo.renewLease(p.articleId, runId, lease, 'validating'))) throw new YoutubeArticleStop('lease_lost')
      const loaded = await loadPlan()
      if ('reason' in loaded) throw new YoutubeArticleStop('caption_missing', 'plan changed')
      const { plan, caption } = loaded
      const results: { lede: string; sections: ArticleSection[] }[] = []
      for (let i = 0; i < plan.chunks.length; i++) {
        const obj = await deps.bucket.get(youtubeArticleChunkKey(p.videoId, p.sourceHash, p.targetLanguage, p.promptVersion, i))
        if (!obj) throw new Error(`chunk_missing:${i}`)
        results.push(JSON.parse(await obj.text()) as StoredChunk)
      }
      const doc = mergeChunkResults(results, plan.cues, p.targetLanguage, plan.format)
      const quality = checkArticleQuality(doc, plan.cues, captionPlainText(caption))
      const spent = (await deps.repo.findById(p.articleId))?.cost_usd ?? 0
      const summary = { ...quality, format: plan.format, chunks: plan.chunks.length, cost_usd: Number(spent.toFixed(5)), model: YOUTUBE_ARTICLE_MODEL }
      if (!quality.passed) return { kind: 'quality_failed' as const, quality: summary }

      const version = youtubeArticleVersion(p.sourceHash, p.targetLanguage, 1, p.promptVersion)
      const html = renderArticleHtml(doc, version)
      const text = renderArticleText(doc)
      await deps.bucket.put(keys.jsonKey, JSON.stringify(doc))
      await deps.bucket.put(keys.htmlKey, html)
      await deps.bucket.put(keys.textKey, text)
      // Read back before the database says ready (spec 4.4, rule 5)
      const heads = await Promise.all([deps.bucket.head(keys.jsonKey), deps.bucket.head(keys.htmlKey), deps.bucket.head(keys.textKey)])
      if (heads.some(h => !h)) throw new Error('object_missing_after_write')
      return { kind: 'ok' as const, quality: summary }
    })

    if (assembled.kind === 'quality_failed') {
      // The cached chunks produced a bad article; drop them so the next attempt asks the model again
      await step.do('drop-chunks', DB_STEP, () => deletePrefix(deps, youtubeArticleChunkPrefix(p.videoId, p.sourceHash, p.targetLanguage, p.promptVersion)))
      return await finish('failed', `quality:${assembled.quality.failed.join(',')}`, assembled.quality)
    }

    const published = await step.do('publish', DB_STEP, () =>
      deps.repo.publish(p.articleId, runId, p.sourceHash, p.targetLanguage, {
        article_key: keys.jsonKey,
        article_text_key: keys.textKey,
        model: YOUTUBE_ARTICLE_MODEL,
        quality: assembled.quality
      })
    )
    if (!published) {
      // Another writer moved the row on (re-crawl, takedown, sweep). Remove what this attempt wrote.
      await step.do('drop-unpublished', DB_STEP, async () => {
        // Article keys are the same for every run of a version: if another run published them, they are live
        const row = await deps.repo.findById(p.articleId)
        if (row?.status === 'ready' && row.article_key === keys.jsonKey) return 0
        await deps.bucket.delete([keys.jsonKey, keys.htmlKey, keys.textKey])
        return deletePrefix(deps, youtubeArticleChunkPrefix(p.videoId, p.sourceHash, p.targetLanguage, p.promptVersion))
      })
      log('superseded', p)
      return 'superseded'
    }
    await step.do('drop-chunks', DB_STEP, () => deletePrefix(deps, youtubeArticleChunkPrefix(p.videoId, p.sourceHash, p.targetLanguage, p.promptVersion)))
    log('ready', p, { cost_usd: assembled.quality.cost_usd, paragraphs: assembled.quality.metrics.paragraphs })
    try {
      const bookmarks = await step.do('publish-body', PUBLISH_STEP, () => deps.publishBodies(p.articleId))
      log('bodies_published', p, { bookmarks })
    } catch (err) {
      // The article is ready and served below the body; the owner's next status request writes the body
      log('bodies_failed', p, { error: (err instanceof Error ? err.message : String(err)).slice(0, 120) })
    }
    return 'ready'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (
      err instanceof YoutubeArticleStop ||
      (err instanceof Error && err.name === 'YoutubeArticleStop') ||
      /YoutubeArticleStop|budget_exceeded|lease_lost|caption_missing/.test(message)
    ) {
      const code =
        err instanceof YoutubeArticleStop ? err.code : (['budget_exceeded', 'lease_lost', 'caption_missing'].find(c => message.includes(c)) as YoutubeArticleStop['code'])
      if (code === 'lease_lost') {
        // Another run took the row (its chunks stay, it reuses them), or the video was taken down
        // while this run was writing: then nobody else will delete what this run wrote
        await step.do('drop-after-takedown', DB_STEP, async () => {
          if ((await deps.repo.findById(p.articleId))?.status !== 'takedown') return 0
          return deletePrefix(deps, youtubeArticleChunkPrefix(p.videoId, p.sourceHash, p.targetLanguage, p.promptVersion))
        })
        log('lease_lost', p)
        return 'gone'
      }
      return await finish('failed', code)
    }
    return await finish('retry', message.slice(0, 200))
  }
}

async function deletePrefix(deps: RunnerDeps, prefix: string): Promise<number> {
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
