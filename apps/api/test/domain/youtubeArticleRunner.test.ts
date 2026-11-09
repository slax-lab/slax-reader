import { estimateCostUsd } from '@/utils/youtubeArticle'
import { DeepSeekError } from '@/infra/external/deepseekClient'
/**
 * One generation attempt end to end, with a fake step engine, an in-memory R2 bucket, a fake row
 * store and a fake model. Covers the happy path and every way an attempt can end.
 * 来源: src/domain/youtubeArticleRunner.ts, docs/youtube-article/spec.md 4.4、8 节、13 节
 */
import { describe, expect, test, vi } from 'vitest'
import { runYoutubeArticle, type ArticleModel, type RunnerDeps, type StepLike } from '@/domain/youtubeArticleRunner'
import type { YoutubeArticleWorkflowParams } from '@/domain/youtubeArticle'
import type { youtubeArticlePO } from '@/infra/repository/dbYoutubeArticle'
import { buildYoutubeCaptionDocument, type YoutubeCaptionDocument } from '@/utils/youtubeCaption'
import { estimateTokens, outputTokenLimit, repetitionRatio } from '@/utils/youtubeArticle'

const VIDEO = 'dQw4w9WgXcQ'
const HASH = 'a'.repeat(64)
const CAPTION_KEY = `youtube/canonical/captions/${VIDEO}/${HASH}.json`

const SENTENCES = [
  'the transformer replaces recurrence with attention so every token attends to every other token',
  'training parallelizes across the sequence and long range dependencies no longer decay',
  'the cost is quadratic in sequence length which is why sparse attention variants exist',
  'positional encodings restore order because attention alone ignores order'
]

function caption(cueCount: number): YoutubeCaptionDocument {
  const events = Array.from({ length: cueCount }, (_, i) => ({ tStartMs: i * 6000, dDurationMs: 5800, segs: [{ utf8: `${SENTENCES[i % 4]} part ${i}` }] }))
  return buildYoutubeCaptionDocument(VIDEO, { language_code: 'en', language_name: 'English', kind: '', is_translatable: true, base_url: '' }, events)
}

function memBucket() {
  const objects = new Map<string, string>()
  const bucket = {
    objects,
    get: vi.fn(async (k: string) => (objects.has(k) ? { text: async () => objects.get(k)! } : null)),
    put: vi.fn(async (k: string, v: string) => {
      objects.set(k, v)
      return {}
    }),
    head: vi.fn(async (k: string) => (objects.has(k) ? { key: k } : null)),
    delete: vi.fn(async (k: string | string[]) => {
      for (const key of Array.isArray(k) ? k : [k]) objects.delete(key)
    }),
    list: vi.fn(async ({ prefix }: { prefix?: string }) => ({ objects: [...objects.keys()].filter(k => k.startsWith(prefix ?? '')).map(key => ({ key })), truncated: false }))
  }
  return bucket
}

function memRow(over: Partial<youtubeArticlePO> = {}) {
  const row = {
    id: 1,
    source_id: VIDEO,
    source_hash: HASH,
    target_language: 'en',
    caption_key: CAPTION_KEY,
    status: 'pending',
    retry_count: 0,
    run_id: null as string | null,
    cost_usd: 0,
    lifetime_cost_usd: 0,
    quality_json: null as object | null,
    article_key: null as string | null,
    error_message: null as string | null,
    ...over
  }
  const running = () => row.status === 'generating' || row.status === 'validating'
  const repo = {
    row,
    claim: vi.fn(async (_id: number, runId: string) => {
      if (row.status === 'pending') {
        Object.assign(row, { status: 'generating', run_id: runId })
        return true
      }
      return running() && row.run_id === runId
    }),
    findById: vi.fn(async () => ({ ...row }) as unknown as youtubeArticlePO),
    renewLease: vi.fn(async (_id: number, runId: string, _ms: number, status: string = 'generating') => {
      if (!running() || row.run_id !== runId) return false
      row.status = status
      return true
    }),
    addCost: vi.fn(async (_id: number, usd: number) => {
      row.lifetime_cost_usd += usd
      return (row.cost_usd += usd)
    }),
    publish: vi.fn(async (_id: number, runId: string, hash: string, lang: string, data: { article_key: string; quality: object }) => {
      if (running() && row.run_id === runId && hash === row.source_hash && lang === row.target_language) {
        Object.assign(row, { status: 'ready', article_key: data.article_key, quality_json: data.quality })
        return true
      }
      return row.status === 'ready' && row.run_id === runId && row.article_key === data.article_key
    }),
    finishAttempt: vi.fn(async (_id: number, o: { kind: string; error: string; quality?: object }, guard: { runId?: string } = {}) => {
      if (!running() || (guard.runId && guard.runId !== row.run_id)) return null
      if (o.kind !== 'skipped') row.retry_count++
      row.status = o.kind === 'skipped' ? 'skipped' : o.kind === 'retry' && row.retry_count < 3 ? 'pending' : 'failed'
      row.error_message = o.error
      if (o.quality) row.quality_json = o.quality
      return row.status as any
    })
  }
  return repo
}

/** Executes like the Workflows engine within one run: retries per config, rethrows the last error. */
function engine(opts: { rewrap?: boolean } = {}) {
  const calls: string[] = []
  const step: StepLike = {
    async do(name, config, fn) {
      calls.push(name)
      const attempts = (config.retries?.limit ?? 0) + 1
      let last: unknown
      for (let i = 0; i < attempts; i++) {
        try {
          return await fn()
        } catch (err) {
          last = err
          // the real wrapper turns stop errors into NonRetryableError: no more attempts
          if (err instanceof Error && err.name === 'YoutubeArticleStop') break
        }
      }
      throw opts.rewrap && last instanceof Error ? new Error(last.message) : last
    }
  }
  return { step, calls }
}

/** Faithful fake: one paragraph per 3 new cues, the cue text with a capital and a full stop. */
function faithfulModel(
  over: {
    language?: 'en' | 'zh'
    outputTokens?: number
    failOn?: (call: number) => string | null
    finishReason?: string
    /** The reply ends with MAX_TOKENS when the user message carries more than this many cues. */
    truncateOver?: number
  } = {}
): ArticleModel & { chat: ReturnType<typeof vi.fn> } {
  let call = 0
  return {
    chat: vi.fn(async (contents, _config, options) => {
      call++
      const forced = over.failOn?.(call)
      if (forced !== null && forced !== undefined) return { text: forced, usage: { inputTokens: 1000, outputTokens: 100 } }
      const user = (contents[0].parts?.[0] as { text: string }).text
      if (options.systemInstruction.startsWith('Write a factual'))
        return { text: JSON.stringify({ lede: 'This talk explains attention.' }), usage: { inputTokens: 100, outputTokens: 30 } }
      const passages = JSON.parse(user.split('\nPrevious source context')[0]) as Record<string, { text: string }>
      const cues = Object.values(passages).flatMap(passage => [...passage.text.matchAll(/part \d+/g)])
      if (over.truncateOver !== undefined && cues.length > over.truncateOver)
        return { text: '{"p0":', usage: { inputTokens: 3000, outputTokens: 16000, thoughtTokens: 0 }, finishReason: 'MAX_TOKENS' }
      const body = Object.fromEntries(Object.entries(passages).map(([key, value]) => [key, { text: value.text, heading: '' }]))
      return { text: JSON.stringify(body), usage: { inputTokens: 3000, outputTokens: over.outputTokens ?? 3000 }, finishReason: over.finishReason ?? 'STOP' }
    })
  }
}

function setup(opts: { cues?: number; model?: ArticleModel; row?: Partial<youtubeArticlePO>; rewrap?: boolean; noCaption?: boolean; runId?: string } = {}) {
  const bucket = memBucket()
  if (!opts.noCaption) bucket.objects.set(CAPTION_KEY, JSON.stringify(caption(opts.cues ?? 300)))
  const repo = memRow(opts.row)
  const model = opts.model ?? faithfulModel()
  const addCost = vi.fn(async () => {})
  const publishBodies = vi.fn(async (_articleId: number) => 2)
  const deps: RunnerDeps = {
    repo,
    bucket: bucket as any,
    model,
    addCost,
    publishBodies,
    indexBodies: vi.fn(async () => 2),
    settleSnapshots: vi.fn(async () => 0),
    processVectorMaintenance: vi.fn(async () => {})
  }
  const params: YoutubeArticleWorkflowParams = { articleId: 1, videoId: VIDEO, sourceHash: HASH, targetLanguage: 'en', promptVersion: 'v1', title: 'Attention', trigger: 'open' }
  const { step, calls } = engine({ rewrap: opts.rewrap })
  const runId = opts.runId ?? 'run-1'
  const run = (stepLike: StepLike = step) => runYoutubeArticle(deps, params, stepLike, runId)
  return { deps, bucket, repo, model, addCost, publishBodies, params, step, calls, run }
}

function requireTranslation(s: ReturnType<typeof setup>) {
  if (!s.bucket.objects.has(CAPTION_KEY)) return s
  const doc = JSON.parse(s.bucket.objects.get(CAPTION_KEY)!)
  doc.language = 'fr'
  s.bucket.objects.set(CAPTION_KEY, JSON.stringify(doc))
  return s
}

const articleKeys = (lang = 'en') => {
  const base = `youtube/canonical/articles/${VIDEO}/${HASH}-${lang}-1-v1`
  return [`${base}.json`, `${base}.html`, `${base}.txt`]
}

describe('happy path', () => {
  test('several chunks → merged, checked, rendered, written, published; chunks cleaned up', async () => {
    const s = setup()
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    const outcome = await s.run()
    expect(outcome).toBe('ready')

    const chunkSteps = s.calls.filter(c => c.startsWith('chunk-'))
    expect(chunkSteps.length).toBeGreaterThan(1)
    expect(s.calls).toEqual(['claim', 'prepare', ...chunkSteps, 'introduction', 'assemble', 'publish', 'publish-body', 'vector-maintenance', 'index-bodies', 'drop-chunks'])
    expect(s.deps.processVectorMaintenance).toHaveBeenCalledWith(VIDEO, HASH)
    expect(s.publishBodies).toHaveBeenCalledWith(1)
    expect(s.model.chat).toHaveBeenCalledTimes(chunkSteps.length + 1)
    expect(s.addCost).toHaveBeenCalledTimes(chunkSteps.length + 1)

    expect(s.repo.row.status).toBe('ready')
    expect(s.repo.row.article_key).toBe(articleKeys()[0])
    // never touches the original html/body or text/body objects
    expect(s.bucket.put.mock.calls.every(c => String(c[0]).startsWith('youtube/canonical/'))).toBe(true)
    expect(s.bucket.delete.mock.calls.flat(2).every(k => String(k).startsWith('youtube/canonical/'))).toBe(true)
    expect(s.repo.row.quality_json).toMatchObject({ passed: true, failed: [], format: 'article', chunks: chunkSteps.length, model: 'deepseek-flash' })
    for (const k of articleKeys()) expect(s.bucket.objects.has(k)).toBe(true)
    expect([...s.bucket.objects.keys()].some(k => k.includes('/chunks/'))).toBe(false)

    const html = s.bucket.objects.get(articleKeys()[1])!
    expect(html).toContain('data-article-version="aaaaaaaaaaaa-en-1-v1"')
    expect(html).toContain('<p class="slax-yt-article-lede">This talk explains attention.</p>')
    const doc = JSON.parse(s.bucket.objects.get(articleKeys()[0])!)
    const ids = doc.sections.flatMap((x: any) => x.paragraphs.flatMap((p: any) => p.source_cue_ids))
    expect(new Set(ids).size).toBe(ids.length)

    // logs carry ids and counts only, never caption or article text
    const logged = logs.mock.calls.map(c => String(c[0])).join('\n')
    expect(logged).not.toContain('transformer')
    expect(logged).not.toContain('attention')
    logs.mockRestore()
  })

  test('bounds the article model output', async () => {
    const s = setup()
    await s.run()
    expect(s.model.chat).toHaveBeenCalled()
    for (const call of s.model.chat.mock.calls) expect(call[1]).toMatchObject({ maxOutputTokens: expect.any(Number) })
  })

  test('step results stay small: no transcript or article text crosses a step boundary', async () => {
    const s = setup()
    const results: unknown[] = []
    const step: StepLike = {
      async do(name, config, fn) {
        const r = await s.step.do(name, config, fn)
        results.push(r)
        return r
      }
    }
    await s.run(step)
    for (const r of results) expect(JSON.stringify(r ?? null).length).toBeLessThan(2000)
  })
})

describe('duplicates and races', () => {
  test('a second start of the same row exits at the claim without a model call', async () => {
    const s = setup({ row: { status: 'generating' } })
    expect(await s.run()).toBe('not_claimed')
    expect(s.model.chat).not.toHaveBeenCalled()
  })

  test('publish refused (row moved on) → written objects deleted, nothing else changed', async () => {
    const s = setup()
    s.repo.publish.mockResolvedValue(false)
    expect(await s.run()).toBe('superseded')
    for (const k of articleKeys()) expect(s.bucket.objects.has(k)).toBe(false)
    expect(s.repo.finishAttempt).not.toHaveBeenCalled()
    expect(s.publishBodies).not.toHaveBeenCalled()
  })

  test('body writes that keep failing do not undo the ready article', async () => {
    const s = setup({ cues: 40 })
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    s.publishBodies.mockRejectedValue(new Error('r2 down'))
    expect(await s.run()).toBe('publication_pending')
    expect(s.repo.row.status).toBe('ready')
    expect(s.publishBodies).toHaveBeenCalledTimes(4)
    expect(s.deps.processVectorMaintenance).toHaveBeenCalledOnce()
    expect(s.repo.finishAttempt).not.toHaveBeenCalled()
    expect(logs.mock.calls.some(c => String(c[0]).includes('youtube_article_bodies_failed'))).toBe(true)
    logs.mockRestore()
  })

  test('lease lost mid-run (swept or taken down) → stop quietly, no status write', async () => {
    const s = setup()
    s.repo.renewLease.mockResolvedValueOnce(true).mockResolvedValue(false)
    expect(await s.run()).toBe('gone')
    expect(s.repo.finishAttempt).not.toHaveBeenCalled()
    expect(s.repo.publish).not.toHaveBeenCalled()
  })
})

describe('idempotency and run ownership', () => {
  test.each(['ready', 'failed'] as const)('failed admission replays after %s publication without repeating successful steps', async status => {
    const s = setup({ cues: 40, noCaption: status === 'failed' })
    const admission = vi.mocked(s.deps.processVectorMaintenance).mockRejectedValue(new Error('admission unavailable'))
    const completed = new Map<string, unknown>()
    const step: StepLike = {
      async do(name, config, fn) {
        if (completed.has(name)) return completed.get(name) as any
        const result = await s.step.do(name, config, fn)
        completed.set(name, result)
        return result
      }
    }
    await expect(s.run(step)).rejects.toThrow('admission unavailable')
    expect(admission).toHaveBeenCalledTimes(4)
    expect(s.repo.row.status).toBe(status)
    expect(s.publishBodies).toHaveBeenCalledTimes(status === 'ready' ? 1 : 0)
    expect(s.repo.finishAttempt).toHaveBeenCalledTimes(status === 'failed' ? 1 : 0)
    const modelCalls = s.model.chat.mock.calls.length
    admission.mockResolvedValue(undefined)
    expect(await s.run(step)).toBe(status)
    expect(admission).toHaveBeenCalledTimes(5)
    expect(s.model.chat).toHaveBeenCalledTimes(modelCalls)
    expect(s.publishBodies).toHaveBeenCalledTimes(status === 'ready' ? 1 : 0)
    expect(s.deps.settleSnapshots).toHaveBeenCalledTimes(status === 'failed' ? 1 : 0)
    expect(s.repo.finishAttempt).toHaveBeenCalledTimes(status === 'failed' ? 1 : 0)
  })

  test('a transient admission failure retries only admission and keeps the article ready', async () => {
    const s = setup({ cues: 40 })
    vi.mocked(s.deps.processVectorMaintenance).mockRejectedValueOnce(new Error('admission unavailable'))
    expect(await s.run()).toBe('ready')
    expect(s.deps.processVectorMaintenance).toHaveBeenCalledTimes(2)
    expect(s.publishBodies).toHaveBeenCalledOnce()
    expect(s.repo.publish).toHaveBeenCalledOnce()
    expect(s.repo.finishAttempt).not.toHaveBeenCalled()
  })

  test('a terminal settlement failure is not converted into a second finish or gone result', async () => {
    const s = setup({ noCaption: true })
    vi.mocked(s.deps.settleSnapshots).mockRejectedValue(new Error('settlement unavailable'))
    await expect(s.run()).rejects.toThrow('settlement unavailable')
    expect(s.repo.row.status).toBe('failed')
    expect(s.repo.finishAttempt).toHaveBeenCalledOnce()
    expect(s.deps.settleSnapshots).toHaveBeenCalledTimes(4)
    expect(s.deps.processVectorMaintenance).not.toHaveBeenCalled()
  })

  test('publish committed but the step is retried → still ready, nothing deleted', async () => {
    const s = setup()
    const real = s.repo.publish.getMockImplementation()!
    s.repo.publish.mockImplementationOnce(async (...args: any[]) => {
      await (real as any)(...args)
      throw new Error('lost reply')
    })
    expect(await s.run()).toBe('ready')
    expect(s.repo.row.status).toBe('ready')
    for (const k of articleKeys()) expect(s.bucket.objects.has(k)).toBe(true)
  })

  test('claim committed but the step is retried → the same run continues', async () => {
    const s = setup({ cues: 40 })
    const real = s.repo.claim.getMockImplementation()!
    s.repo.claim.mockImplementationOnce(async (...args: any[]) => {
      await (real as any)(...args)
      throw new Error('lost reply')
    })
    expect(await s.run()).toBe('ready')
  })

  test('a stale run whose publish is refused does not delete the article another run already published', async () => {
    const s = setup({ cues: 40 })
    s.repo.publish.mockImplementation(async () => {
      Object.assign(s.repo.row, { status: 'ready', run_id: 'run-newer', article_key: articleKeys()[0] })
      return false
    })
    expect(await s.run()).toBe('superseded')
    for (const k of articleKeys()) expect(s.bucket.objects.has(k)).toBe(true)
  })

  test('a row held by another run is not claimed, renewed or finished by this one', async () => {
    const s = setup({ row: { status: 'generating', run_id: 'run-other' } })
    expect(await s.run()).toBe('not_claimed')
    expect(s.model.chat).not.toHaveBeenCalled()
    expect(await s.repo.renewLease(1, 'run-1', 1000)).toBe(false)
    expect(await s.repo.finishAttempt(1, { kind: 'failed', error: 'x' }, { runId: 'run-1' })).toBeNull()
  })

  test('the video is taken down mid-run → stop and delete the chunks this run wrote', async () => {
    const s = setup()
    let renewals = 0
    s.repo.renewLease.mockImplementation(async () => {
      renewals++
      if (renewals < 3) return true
      s.repo.row.status = 'takedown'
      return false
    })
    expect(await s.run()).toBe('gone')
    expect(s.model.chat).not.toHaveBeenCalled()
    expect([...s.bucket.objects.keys()].some(k => k.includes('/chunks/'))).toBe(false)
  })
})

describe('model failures', () => {
  test('invalid JSON exhausts bounded passage recovery without publishing', async () => {
    const s = requireTranslation(setup({ cues: 40, model: faithfulModel({ failOn: () => '{"lede": "cut' }) }))
    expect(await s.run()).toBe('failed')
    expect(s.model.chat).toHaveBeenCalledTimes(8)
    expect(s.repo.row).toMatchObject({ status: 'failed', retry_count: 1 })
    expect(s.repo.row.error_message).toBe('passage_repair_exhausted')
  })

  test('a truncated chunk is split in two and both halves recover it; the parts join in cue order', async () => {
    const s = requireTranslation(setup({ cues: 40, model: faithfulModel({ truncateOver: 25 }) }))
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await s.run()).toBe('ready')
    // whole chunk (truncated) + two halves
    expect(s.model.chat).toHaveBeenCalledTimes(4)
    const doc = JSON.parse(s.bucket.objects.get(articleKeys()[0])!)
    const ids = doc.sections.flatMap((x: any) => x.paragraphs.flatMap((p: any) => p.source_cue_ids))
    expect(ids).toEqual(caption(40).cues.map(c => c.id))
    expect(doc.lede).toBe('This talk explains attention.')
    const line = logs.mock.calls.map(c => String(c[0])).find(l => l.includes('youtube_article_truncated'))!
    expect(JSON.parse(line)).toMatchObject({
      article_id: 1,
      chunk: 0,
      parts: 1,
      input_tokens: 3000,
      candidate_tokens: 16000,
      thought_tokens: 0,
      repetition_ratio: expect.any(Number)
    })
    expect(line).not.toContain('transformer')
    expect(line).not.toContain('attention')
    logs.mockRestore()
  })

  test('only the first part of a split chunk carries the overlap cues; later chunks still cover every cue once', async () => {
    // 300 cues → 3 chunks of about 108 cues with overlap; the whole chunk truncates, halves pass
    const s = requireTranslation(setup({ cues: 300, model: faithfulModel({ truncateOver: 70 }) }))
    expect(await s.run()).toBe('ready')
    const doc = JSON.parse(s.bucket.objects.get(articleKeys()[0])!)
    const ids = doc.sections.flatMap((x: any) => x.paragraphs.flatMap((p: any) => p.source_cue_ids))
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids).size).toBe(300)
    const later = s.model.chat.mock.calls.filter(c => c[0][0].parts[0].text.includes('Previous source context'))
    expect(later.length).toBeGreaterThan(0)
    for (const c of later) expect(c[2].systemInstruction).toContain('Never move content between keys')
  })

  test('a chunk still truncated after bounded passage subdivision fails the version with no automatic retry', async () => {
    const s = requireTranslation(setup({ cues: 40, model: faithfulModel({ finishReason: 'MAX_TOKENS' }) }))
    expect(await s.run()).toBe('failed')
    // whole, first half, first quarter: each smaller than the last, never the same call twice
    expect(s.model.chat).toHaveBeenCalledTimes(16)
    expect(s.repo.row).toMatchObject({ status: 'failed', retry_count: 1 })
    // the stored error keeps the code first (the snapshot reason) and the split depth after it
    expect(s.repo.row.error_message).toBe('passage_repair_exhausted')
  })

  test('the output limit follows the user message size, between 4,000 and 16,000 tokens', async () => {
    const s = requireTranslation(setup({ cues: 40, model: faithfulModel({ truncateOver: 25 }) }))
    expect(await s.run()).toBe('ready')
    for (const call of s.model.chat.mock.calls) {
      const user = call[0][0].parts[0].text as string
      expect(call[1].maxOutputTokens).toBe(outputTokenLimit(estimateTokens(user)))
    }
    expect(outputTokenLimit(2500)).toBe(10_000)
    expect(outputTokenLimit(600)).toBe(4000)
    expect(outputTokenLimit(5000)).toBe(16_000)
  })

  test('one bad reply then a good one: the step retry recovers', async () => {
    const s = requireTranslation(setup({ cues: 40, model: faithfulModel({ failOn: call => (call === 1 ? 'not json' : null) }) }))
    expect(await s.run()).toBe('ready')
  })

  test('the next attempt reuses chunk results already in R2', async () => {
    let failSecondChunk = true
    const model = faithfulModel()
    const original = model.chat.getMockImplementation()!
    model.chat.mockImplementation(async (contents: any, config: any, options: any) => {
      if (failSecondChunk && contents[0].parts[0].text.includes('part 120')) throw new Error('rate_limited')
      return original(contents, config, options)
    })
    const s = requireTranslation(setup({ model }))
    expect(await s.run()).toBe('retry')
    const firstRunCalls = model.chat.mock.calls.length

    failSecondChunk = false
    const again = engine()
    expect(await s.run(again.step)).toBe('ready')
    const chunk1Prompts = model.chat.mock.calls
      .slice(firstRunCalls)
      .filter((c: any) => !c[2].systemInstruction.startsWith('Write a factual') && c[0][0].parts[0].text.split('\nPrevious source context')[0].includes('part 0 '))
    expect(chunk1Prompts).toHaveLength(0)
  })
})

describe('limits and gates', () => {
  test('usage above the former per-video budget is recorded and generation completes', async () => {
    // Synthetic reported usage exercises accounting independently of the request token ceiling.
    const s = requireTranslation(setup({ model: faithfulModel({ outputTokens: 340_000 }) }))
    expect(await s.run()).toBe('ready')
    expect(s.model.chat.mock.calls.length).toBeGreaterThan(0)
    expect(s.repo.row).toMatchObject({ status: 'ready', error_message: null })
  })

  test('prior spend does not prevent further model calls', async () => {
    const s = requireTranslation(setup({ row: { cost_usd: 0.99 } }))
    expect(await s.run()).toBe('ready')
    expect(s.model.chat).toHaveBeenCalled()
    expect(s.repo.row.error_message).toBeNull()
  })

  test('prior spend does not reject the prepared plan', async () => {
    const s = requireTranslation(setup({ row: { cost_usd: 0.98 } }))
    expect(await s.run()).toBe('ready')
    expect(s.repo.row.error_message).toBeNull()
    expect(s.model.chat).toHaveBeenCalled()
    expect(s.calls).toContain('chunk-0')
  })

  test('failed and truncated replies are counted too', async () => {
    const s = requireTranslation(setup({ cues: 40, model: faithfulModel({ finishReason: 'MAX_TOKENS' }) }))
    await s.run()
    expect(s.repo.addCost).toHaveBeenCalledTimes(s.model.chat.mock.calls.length)
    expect(s.repo.row.cost_usd).toBeGreaterThan(0)
  })

  test('prior lifetime spend does not block translation', async () => {
    // Prior recorded spend no longer constrains admission.
    const s = requireTranslation(setup({ row: { cost_usd: 0, lifetime_cost_usd: 1.99 } }))
    expect(await s.run()).toBe('ready')
    expect(s.model.chat).toHaveBeenCalled()
    expect(s.repo.row.error_message).toBeNull()
  })

  test('lifetime spend may cross the former cap during generation', async () => {
    // the plan fits at the start; the first call's spend pushes the lifetime over the cap
    const s = requireTranslation(setup({ cues: 300, row: { lifetime_cost_usd: 1.5 }, model: faithfulModel({ outputTokens: 200_000 }) }))
    expect(await s.run()).toBe('ready')
    expect(s.model.chat.mock.calls.length).toBeGreaterThan(0)
    expect(s.repo.row.error_message).toBeNull()
    expect(s.repo.row.lifetime_cost_usd).toBeGreaterThan(1.5)
  })

  test('a long video within the duration and chunk limits starts instead of being skipped as too_long', async () => {
    // A multi-chunk translation still completes.
    const s = requireTranslation(setup({ cues: 3000 }))
    expect(await s.run()).toBe('ready')
    expect(s.model.chat.mock.calls.length).toBeGreaterThan(1)
  })

  test('a large translation plan exceeds the old chunk count and completes', async () => {
    const s = requireTranslation(setup({ cues: 7000 }))
    expect(await s.run()).toBe('ready')
    expect(s.calls.filter(name => /^chunk-\d+$/.test(name)).length).toBeGreaterThan(40)
    expect(s.repo.row.error_message).toBeNull()
  })

  test('high spend completes under an error-wrapping step engine', async () => {
    const s = requireTranslation(setup({ model: faithfulModel({ outputTokens: 340_000 }), rewrap: true }))
    expect(await s.run()).toBe('ready')
    expect(s.repo.row.error_message).toBeNull()
  })

  test('longer than 6 hours is processed', async () => {
    const s = requireTranslation(setup({ noCaption: true }))
    const long = caption(10)
    long.cues[9].start_ms = 6 * 3600 * 1000 + 1
    s.bucket.objects.set(CAPTION_KEY, JSON.stringify(long))
    expect(await s.run()).toBe('ready')
    expect(s.repo.row).toMatchObject({ status: 'ready', error_message: null, retry_count: 0 })
    expect(s.model.chat).toHaveBeenCalled()
  })

  test('caption object missing → failed with caption_missing', async () => {
    const s = requireTranslation(setup({ noCaption: true }))
    expect(await s.run()).toBe('failed')
    expect(s.repo.row.error_message).toBe('caption_missing')
  })

  test('publishes nonempty output without language scoring', async () => {
    const s = requireTranslation(setup({ cues: 40, model: faithfulModel() }))
    s.params.targetLanguage = 'zh'
    s.repo.row.target_language = 'zh'
    expect(await s.run()).toBe('ready')
    expect(s.publishBodies).toHaveBeenCalled()
  })
})

describe('source-owned transcript generation', () => {
  function editedModel() {
    const model = faithfulModel()
    model.chat.mockImplementation(async (contents, _config, options) => {
      if (options.systemInstruction.startsWith('Write a factual'))
        return { text: JSON.stringify({ lede: 'This talk explains attention.' }), usage: { inputTokens: 100, outputTokens: 30 } }
      const source: Record<string, { text: string; heading?: string; startsChunk?: boolean }> = JSON.parse(contents[0].parts[0].text.split('\nPrevious source context')[0])
      const translating = options.systemInstruction.startsWith('Translate each keyed')
      const sentences = [
        'Transformer 用注意力替代循环，因此每个词元都能关注其他词元。',
        '训练在序列上并行执行，长距离依赖关系不再衰减。',
        '计算成本随序列长度的平方增长，因此出现了稀疏注意力变体。',
        '位置编码恢复顺序，因为注意力本身忽略顺序。'
      ]
      const result = Object.fromEntries(
        Object.entries(source).map(([key, passage]) => [
          key,
          {
            heading: passage.startsChunk ? (translating ? '注意力机制' : 'Attention') : '',
            text: translating ? [...passage.text.matchAll(/part (\d+)/g)].map(match => sentences[Number(match[1]) % 4] + `第 ${match[1]} 部分。`).join('') : passage.text
          }
        ])
      )
      return { text: JSON.stringify(result), usage: { inputTokens: 100, outputTokens: 100 } }
    })
    return model
  }

  function translated(cues = 40, model = editedModel()) {
    const s = setup({ cues, model })
    s.params.promptVersion = 'v2'
    s.params.targetLanguage = 'zh'
    s.repo.row.target_language = 'zh'
    return s
  }

  const input = (call: any) => JSON.parse(call[0][0].parts[0].text.split('\nPrevious source context')[0])
  const translations = (model: any) => model.chat.mock.calls.filter((c: any) => c[2].systemInstruction.startsWith('Translate each keyed'))

  test('translates five chunks concurrently directly from source, with complete references', async () => {
    const model = editedModel()
    const original = model.chat.getMockImplementation()!
    let active = 0
    let peak = 0
    model.chat.mockImplementation(async (...args) => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      const result = await original(...args)
      active--
      return result
    })
    const s = translated(650, model)
    expect(await s.run()).toBe('ready')
    expect(peak).toBe(5)
    expect(model.chat.mock.calls.filter(c => c[2].systemInstruction.startsWith('Edit each keyed'))).toHaveLength(0)
    expect(model.chat.mock.calls.length).toBe(s.calls.filter(c => c.startsWith('chunk-')).length + 1)
    const doc = JSON.parse(s.bucket.objects.get(articleKeys('zh')[0].replace('v1', 'v2'))!)
    expect(doc.sections.flatMap((section: any) => section.paragraphs.flatMap((p: any) => p.source_cue_ids))).toEqual(caption(650).cues.map(cue => cue.id))
    for (const call of model.chat.mock.calls) expect(call[1].abortSignal).toBeInstanceOf(AbortSignal)
    expect(translations(model)[1][0][0].parts[0].text).toContain('Previous source context')
  })

  test('a missing translation is repaired once, with accepted passages kept', async () => {
    const model = editedModel()
    const original = model.chat.getMockImplementation()!
    let missing = true
    model.chat.mockImplementation(async (...args) => {
      const result = await original(...args)
      if (missing && args[2].systemInstruction.startsWith('Translate each keyed')) {
        missing = false
        const values = JSON.parse(result.text)
        delete values.p0
        return { ...result, text: JSON.stringify(values) }
      }
      return result
    })
    const s = translated(40, model)
    expect(await s.run()).toBe('ready')
    expect(Object.keys(input(translations(model)[1]))).toEqual(['p0'])
    expect(input(translations(model)[1]).p0.repair).toBe('missing')
  })

  test('nonempty wrong-language output is published without repair', async () => {
    const model = editedModel()
    const original = model.chat.getMockImplementation()!
    let corrupt = true
    model.chat.mockImplementation(async (...args) => {
      const result = await original(...args)
      if (corrupt && args[2].systemInstruction.startsWith('Translate each keyed')) {
        corrupt = false
        const values = JSON.parse(result.text)
        values.p0.text = input(args).p0.text
        return { ...result, text: JSON.stringify(values) }
      }
      return result
    })
    const s = translated(40, model)
    expect(await s.run()).toBe('ready')
    expect(translations(model)).toHaveLength(1)
  })

  test.each([new DeepSeekError('http', 401), new Error('private-provider-message')])('records safe provider failure diagnostics', async error => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const model = editedModel()
      model.chat.mockRejectedValue(error)
      const s = translated(40, model)
      expect(await s.run()).toBe('retry')
      const entries = logs.mock.calls.map(call => JSON.parse(String(call[0])))
      expect(entries).toContainEqual(
        expect.objectContaining({
          event: 'youtube_article_model_error',
          code: error instanceof DeepSeekError ? 'http' : 'unknown',
          provider_status: error instanceof DeepSeekError ? 401 : null
        })
      )
      expect(JSON.stringify(entries)).not.toContain('private-provider-message')
    } finally {
      logs.mockRestore()
    }
  })

  test('a provider outage preserves accepted paragraphs and resumes after recovery', async () => {
    const model = editedModel()
    const original = model.chat.getMockImplementation()!
    let first = true
    let down = true
    model.chat.mockImplementation(async (...args) => {
      if (!args[2].systemInstruction.startsWith('Translate each keyed')) return original(...args)
      if (!first && down) throw new Error('provider_timeout')
      const result = await original(...args)
      if (first) {
        first = false
        const value = JSON.parse(result.text)
        delete value.p0
        return { ...result, text: JSON.stringify(value) }
      }
      return result
    })
    const s = translated(40, model)
    expect(await s.run()).toBe('retry')
    expect(s.repo.row.error_message).toBe('model_request_failed')
    const calls = translations(model).length
    down = false
    expect(await s.run(engine().step)).toBe('ready')
    expect(
      translations(model)
        .slice(calls)
        .map((c: any) => Object.keys(input(c)))
    ).toEqual([['p0']])
  })

  test('persistently invalid content stops after three replies and retains successful work for a new run', async () => {
    const model = editedModel()
    const original = model.chat.getMockImplementation()!
    let missing = true
    model.chat.mockImplementation(async (...args) => {
      const result = await original(...args)
      if (missing && args[2].systemInstruction.startsWith('Translate each keyed')) {
        const value = JSON.parse(result.text)
        delete value.p0
        return { ...result, text: JSON.stringify(value) }
      }
      return result
    })
    const s = translated(40, model)
    expect(await s.run()).toBe('failed')
    expect(s.repo.row.error_message).toBe('passage_repair_exhausted')
    expect(translations(model)).toHaveLength(3)
    expect([...s.bucket.objects.keys()].some(k => k.endsWith('.passages'))).toBe(true)
    expect(s.publishBodies).not.toHaveBeenCalled()
    missing = false
    s.repo.row.status = 'pending'
    expect(await runYoutubeArticle(s.deps, s.params, engine().step, 'run-2')).toBe('ready')
    expect(Object.keys(input(translations(model).at(-1)))).toEqual(['p0'])
  })

  test.each(['timeout', 'malformed', 'empty', 'truncated', 'wrong-language'])('publishes accepted body with an extractive introduction on %s', async mode => {
    const model = editedModel()
    const original = model.chat.getMockImplementation()!
    model.chat.mockImplementation(async (...args) => {
      if (!args[2].systemInstruction.startsWith('Write a factual')) return original(...args)
      if (mode === 'timeout') throw new Error('provider_timeout')
      return {
        text: mode === 'empty' ? '{"lede":""}' : mode === 'wrong-language' ? '{"lede":"This introduction is in the wrong language."}' : 'invalid',
        finishReason: mode === 'truncated' ? 'MAX_TOKENS' : 'STOP'
      }
    })
    const s = translated(40, model)
    expect(await s.run()).toBe('ready')
    const doc = JSON.parse(s.bucket.objects.get(articleKeys('zh')[0].replace('v1', 'v2'))!)
    if (mode === 'wrong-language') expect(doc.lede).toBe('This introduction is in the wrong language.')
    else expect(doc.lede).toContain('Transformer')
    expect(doc.lede).not.toBe('invalid')
    expect(model.chat.mock.calls.filter(c => c[2].systemInstruction.startsWith('Write a factual'))).toHaveLength(1)
  })

  test('an optional same-language editor outage preserves complete source wording', async () => {
    const model = editedModel()
    model.chat.mockRejectedValue(new Error('provider_timeout'))
    const s = setup({ cues: 40, model })
    s.params.promptVersion = 'v2'
    expect(await s.run()).toBe('ready')
    const doc = JSON.parse(s.bucket.objects.get(articleKeys()[0].replace('v1', 'v2'))!)
    expect(doc.sections.flatMap((section: any) => section.paragraphs.map((p: any) => p.text)).join(' ')).toBe(
      caption(40)
        .cues.map(c => c.text)
        .join(' ')
    )
  })

  test.each([
    { cost_usd: 1, lifetime_cost_usd: 1 },
    { cost_usd: 0, lifetime_cost_usd: 2 }
  ])('same-language editing continues despite prior spend: %j', async cap => {
    const s = setup({ cues: 40, model: editedModel() })
    s.params.promptVersion = 'v2'
    Object.assign(s.repo.row, cap)
    expect(await s.run()).toBe('ready')
    expect(s.model.chat).toHaveBeenCalled()
    expect(s.repo.addCost).toHaveBeenCalled()
    const doc = JSON.parse(s.bucket.objects.get(articleKeys()[0].replace('v1', 'v2'))!)
    const paragraphs = doc.sections.flatMap((section: any) => section.paragraphs)
    expect(paragraphs.length).toBeGreaterThan(0)
    expect(paragraphs.flatMap((p: any) => p.source_cue_ids)).toEqual(caption(40).cues.map(c => c.id))
    expect(doc.lede).toBeTruthy()
  })

  test('a truncated batch splits its request and preserves original reference order', async () => {
    const model = editedModel()
    const original = model.chat.getMockImplementation()!
    model.chat.mockImplementation(async (...args) => {
      if (args[2].systemInstruction.startsWith('Translate each keyed') && Object.keys(input(args)).length > 3)
        return { text: 'truncated', finishReason: 'MAX_TOKENS', usage: { inputTokens: 100, outputTokens: 4000 } }
      return original(...args)
    })
    const s = translated(40, model)
    expect(await s.run()).toBe('ready')
    expect(translations(model).length).toBeGreaterThan(1)
    const doc = JSON.parse(s.bucket.objects.get(articleKeys('zh')[0].replace('v1', 'v2'))!)
    expect(doc.sections.flatMap((section: any) => section.paragraphs.flatMap((p: any) => p.source_cue_ids))).toEqual(caption(40).cues.map(c => c.id))
  })

  test('assembled nonempty text does not trigger regeneration', async () => {
    const model = editedModel()
    const s = translated(40, model)
    const step: StepLike = {
      do: async (name, config, fn) => {
        if (name === 'assemble') {
          const key = [...s.bucket.objects.keys()].find(k => k.includes('/chunks/') && /\/0\.json$/.test(k))!
          const chunk = JSON.parse(s.bucket.objects.get(key)!)
          chunk.sections[0].paragraphs[0].text = 'Wrong language.'
          s.bucket.objects.set(key, JSON.stringify(chunk))
        }
        return s.step.do(name, config, fn)
      }
    }
    expect(await s.run(step)).toBe('ready')
    expect(translations(model)).toHaveLength(1)
    expect(s.calls).not.toContain('repair-chunk-0')
    expect(s.calls).not.toContain('assemble-repaired')
  })

  test('unknown source references do not block publication', async () => {
    const s = translated()
    const step: StepLike = {
      do: async (name, config, fn) => {
        if (name === 'assemble') {
          const key = [...s.bucket.objects.keys()].find(k => k.includes('/chunks/') && /\/0\.json$/.test(k))!
          const chunk = JSON.parse(s.bucket.objects.get(key)!)
          chunk.sections[0].paragraphs[0].source_cue_ids = ['c9999']
          s.bucket.objects.set(key, JSON.stringify(chunk))
        }
        return s.step.do(name, config, fn)
      }
    }
    expect(await s.run(step)).toBe('ready')
    expect(s.publishBodies).toHaveBeenCalled()
  })

  test('resume estimates only unfinished work and completes remaining work despite prior spend', async () => {
    const s = translated()
    const step: StepLike = {
      do: async (name, config, fn) => {
        if (name === 'introduction') throw new Error('worker_interrupted')
        return s.step.do(name, config, fn)
      }
    }
    expect(await s.run(step)).toBe('retry')
    const calls = s.model.chat.mock.calls.length
    s.repo.row.cost_usd = 1
    s.repo.row.lifetime_cost_usd = 2
    expect(await s.run(engine().step)).toBe('ready')
    expect(s.model.chat.mock.calls.length).toBeGreaterThanOrEqual(calls)
    expect(s.repo.row.cost_usd).toBeGreaterThanOrEqual(1)
  })

  test('unfinished translation resumes beyond the former lifetime budget', async () => {
    const s = translated()
    const step: StepLike = {
      do: async (name, config, fn) => {
        if (name === 'introduction') throw new Error('worker_interrupted')
        return s.step.do(name, config, fn)
      }
    }
    expect(await s.run(step)).toBe('retry')
    const key = [...s.bucket.objects.keys()].find(key => key.endsWith('.passages'))!
    const progress = JSON.parse(s.bucket.objects.get(key)!)
    delete progress.items[0].result
    s.bucket.objects.set(key, JSON.stringify(progress))
    s.repo.row.cost_usd = 1
    s.repo.row.lifetime_cost_usd = 2
    const calls = s.model.chat.mock.calls.length
    expect(await s.run(engine().step)).toBe('ready')
    expect(s.repo.row.status).toBe('ready')
    expect(s.model.chat.mock.calls.length).toBeGreaterThan(calls)
    expect(s.repo.row.cost_usd).toBeGreaterThan(1)
    expect(s.publishBodies).toHaveBeenCalled()
  })

  test('accounting errors are never swallowed by optional generation fallback', async () => {
    const s = translated()
    s.repo.addCost.mockRejectedValue(new Error('accounting_unavailable'))
    expect(await s.run()).toBe('retry')
    expect(s.publishBodies).not.toHaveBeenCalled()
    expect(s.repo.row.error_message).toBe('accounting_unavailable')
  })

  test('storage errors while saving an introduction stop publication', async () => {
    const s = translated()
    const original = s.bucket.put.getMockImplementation()!
    s.bucket.put.mockImplementation(async (key, value) => {
      if (key.endsWith('introduction.json')) throw new Error('storage_unavailable')
      return original(key, value)
    })
    expect(await s.run()).toBe('retry')
    expect(s.publishBodies).not.toHaveBeenCalled()
    expect(s.repo.row.error_message).toBe('storage_unavailable')
  })

  test('lease loss after body completion cannot be converted into a presentation fallback', async () => {
    const s = translated()
    const step: StepLike = {
      do: async (name, config, fn) => {
        if (name === 'introduction') s.repo.row.run_id = 'another-run'
        return s.step.do(name, config, fn)
      }
    }
    expect(await s.run(step)).toBe('gone')
    expect(s.publishBodies).not.toHaveBeenCalled()
  })
})

describe('repetition ratio', () => {
  test('a looping tail scores near 1 and ordinary prose near 0', () => {
    expect(repetitionRatio('{"text": "the same sentence again", '.repeat(300))).toBeGreaterThan(0.9)
    const prose = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} says something new about topic ${i * 7}.`).join(' ')
    expect(repetitionRatio(prose)).toBeLessThan(0.1)
    expect(repetitionRatio('')).toBe(0)
  })
})

describe('concurrent chunks', () => {
  test('runs five chunks together and preserves source order', async () => {
    const base = faithfulModel()
    let active = 0
    let peak = 0
    const model: ArticleModel = {
      chat: async (...args) => {
        active++
        peak = Math.max(peak, active)
        const reply = await base.chat(...args)
        await new Promise(resolve => setTimeout(resolve, active === 1 ? 30 : 5))
        active--
        return reply
      }
    }
    const s = setup({ cues: 650, model })
    expect(await s.run()).toBe('ready')
    expect(peak).toBe(5)
    const doc = JSON.parse(s.bucket.objects.get(articleKeys()[0])!)
    const ids = doc.sections.flatMap((section: any) => section.paragraphs.flatMap((p: any) => p.source_cue_ids))
    expect(ids).toEqual(caption(650).cues.map(cue => cue.id))
  })
})

describe('concurrent failure safety', () => {
  test('retains the five-call concurrency bound without budget reservations', async () => {
    const base = faithfulModel()
    let active = 0
    let peak = 0
    const s = requireTranslation(
      setup({
        cues: 650,
        model: {
          chat: async (...args) => {
            active++
            peak = Math.max(peak, active)
            await new Promise(resolve => setTimeout(resolve, 5))
            const result = await base.chat(...args)
            active--
            return result
          }
        }
      })
    )
    const step: StepLike = {
      do: async (name, config, fn) => {
        const result = await s.step.do(name, config, fn)
        if (name === 'prepare') s.repo.row.cost_usd = 10
        return result
      }
    }
    expect(await s.run(step)).toBe('ready')
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(5)
    expect(s.repo.row.cost_usd).toBeGreaterThan(10)
  })

  test('settles siblings and caches successes before reporting a failed batch', async () => {
    const base = faithfulModel()
    let active = 0
    const s = requireTranslation(
      setup({
        cues: 900,
        model: {
          chat: async (...args) => {
            if (args[0][0].parts[0].text.includes('part 0 ')) throw new Error('provider_unavailable')
            active++
            await new Promise(resolve => setTimeout(resolve, 10))
            const result = await base.chat(...args)
            active--
            return result
          }
        }
      })
    )
    const finish = s.repo.finishAttempt.getMockImplementation()!
    s.repo.finishAttempt.mockImplementation(async (...args) => {
      expect(active).toBe(0)
      return finish(...args)
    })
    expect(await s.run()).toBe('retry')
    expect(s.calls).toContain('chunk-5')
    expect([...s.bucket.objects.keys()].filter(key => key.includes('/chunks/') && key.endsWith('.json'))).toHaveLength(s.calls.filter(c => c.startsWith('chunk-')).length - 1)
    expect(s.repo.publish).not.toHaveBeenCalled()
  })

  test.each(['article', 'daily'])('stops admissions after %s accounting fails', async kind => {
    const s = requireTranslation(setup({ cues: 900 }))
    if (kind === 'article') s.repo.addCost.mockRejectedValue(new Error('accounting_unavailable'))
    else s.addCost.mockRejectedValue(new Error('accounting_unavailable'))
    expect(await s.run()).toBe('retry')
    expect(s.model.chat.mock.calls.length).toBeLessThanOrEqual(5)
    expect(s.calls).toContain('chunk-5')
    expect(s.repo.publish).not.toHaveBeenCalled()
  })

  test('does not regenerate or charge completed durable steps on replay', async () => {
    const s = requireTranslation(setup({ cues: 650 }))
    const completed = new Map<string, unknown>()
    let interrupt = true
    const step: StepLike = {
      do: async (name, config, fn) => {
        if (completed.has(name)) return completed.get(name) as any
        if (name === 'assemble' && interrupt) throw new Error('interrupted')
        const result = await s.step.do(name, config, fn)
        if (!name.startsWith('finish-')) completed.set(name, result)
        return result
      }
    }
    expect(await s.run(step)).toBe('retry')
    const calls = s.model.chat.mock.calls.length
    const spend = s.repo.row.cost_usd
    interrupt = false
    s.repo.row.status = 'generating'
    expect(await s.run(step)).toBe('ready')
    expect(s.model.chat).toHaveBeenCalledTimes(calls)
    expect(s.repo.row.cost_usd).toBe(spend)
  })
})

describe('concurrent lifecycle', () => {
  test('aborts provider requests and settles them before finishing', async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    const signals = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(5))
    let active = 0
    const s = requireTranslation(
      setup({
        cues: 650,
        model: {
          chat: async (_contents, config) => {
            active++
            try {
              return await new Promise<never>((_resolve, reject) => config.abortSignal!.addEventListener('abort', () => reject(new Error('provider_timeout')), { once: true }))
            } finally {
              active--
            }
          }
        }
      })
    )
    try {
      expect(await s.run()).toBe('retry')
      expect(active).toBe(0)
      expect(signals).toHaveBeenCalledWith(90_000)
      expect(s.repo.publish).not.toHaveBeenCalled()
      expect(s.calls).toContain('chunk-5')
    } finally {
      signals.mockRestore()
    }
  })

  test('records active call costs but stops new calls after ownership changes', async () => {
    const base = faithfulModel()
    let active = 0
    let started = 0
    const s = requireTranslation(
      setup({
        cues: 650,
        model: {
          chat: async (...args) => {
            active++
            started++
            if (started === 5) s.repo.row.run_id = 'new-owner'
            await new Promise(resolve => setTimeout(resolve, 5))
            const result = await base.chat(...args)
            active--
            return result
          }
        }
      })
    )
    expect(await s.run()).toBe('gone')
    expect(started).toBe(5)
    expect(active).toBe(0)
    expect(s.repo.addCost).toHaveBeenCalledTimes(5)
    expect(s.repo.publish).not.toHaveBeenCalled()
  })

  test('replays a partially completed batch without charging its saved step again', async () => {
    const s = requireTranslation(setup({ cues: 650 }))
    const saved = new Map<string, unknown>()
    let interrupted = true
    const step: StepLike = {
      do: async (name, config, fn) => {
        if (saved.has(name)) return saved.get(name) as any
        if (interrupted && name.startsWith('chunk-') && name !== 'chunk-0') throw new Error('worker_interrupted')
        const result = await s.step.do(name, config, fn)
        if (name === 'claim' || name === 'prepare' || name === 'chunk-0') saved.set(name, result)
        return result
      }
    }
    expect(await s.run(step)).toBe('retry')
    expect(s.model.chat).toHaveBeenCalledTimes(1)
    const spent = s.repo.row.cost_usd
    interrupted = false
    s.repo.row.status = 'generating'
    expect(await s.run(step)).toBe('ready')
    expect(s.model.chat).toHaveBeenCalledTimes(8)
    expect(s.repo.row.cost_usd).toBeCloseTo(spent * 7 + estimateCostUsd(100, 30))
  })
})

describe('independent publication work', () => {
  test('publishes a readable body before attempting indexing', async () => {
    const s = setup({ cues: 40 })
    s.deps.indexBodies = vi.fn(async () => {
      expect(s.publishBodies).toHaveBeenCalledOnce()
      expect(s.repo.row.status).toBe('ready')
      throw new Error('index unavailable')
    })
    expect(await s.run()).toBe('indexing_pending')
    expect(s.repo.row.status).toBe('ready')
    expect(s.repo.finishAttempt).not.toHaveBeenCalled()
    expect(s.deps.indexBodies).toHaveBeenCalledTimes(4)
    expect(s.calls).not.toContain('drop-chunks')
  })

  test('cleanup failure cannot turn a published article back into a failed generation', async () => {
    const s = setup({ cues: 40 })
    s.bucket.delete.mockRejectedValue(new Error('cleanup unavailable'))
    expect(await s.run()).toBe('cleanup_pending')
    expect(s.publishBodies).toHaveBeenCalledOnce()
    expect(s.deps.indexBodies).toHaveBeenCalledOnce()
    expect(s.repo.row.status).toBe('ready')
    expect(s.repo.finishAttempt).not.toHaveBeenCalled()
  })
})
