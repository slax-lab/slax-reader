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
import { YOUTUBE_ARTICLE_LIMITS } from '@/utils/youtubeArticle'

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
    addCost: vi.fn(async (_id: number, usd: number) => (row.cost_usd += usd)),
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
  over: { language?: 'en' | 'zh'; outputTokens?: number; failOn?: (call: number) => string | null; finishReason?: string } = {}
): ArticleModel & { chat: ReturnType<typeof vi.fn> } {
  let call = 0
  return {
    chat: vi.fn(async (contents, _config, options) => {
      call++
      const forced = over.failOn?.(call)
      if (forced !== null && forced !== undefined) return { text: forced, usage: { inputTokens: 1000, outputTokens: 100 } }
      const user = (contents[0].parts?.[0] as { text: string }).text
      const overlap = Number(/the first (\d+) cues were already covered/.exec(options.systemInstruction)?.[1] ?? 0)
      const cues = [...user.matchAll(/^(c\d{4}) \[[^\]]+\] (.*)$/gm)].map(m => ({ id: m[1], text: m[2] })).slice(overlap)
      const paragraphs = []
      for (let i = 0; i < cues.length; i += 3) {
        const group = cues.slice(i, i + 3)
        const text = group.map(c => c.text).join(' ')
        paragraphs.push({ speaker: null, text: over.language === 'zh' ? text : text.charAt(0).toUpperCase() + text.slice(1) + '.', source_cue_ids: group.map(c => c.id) })
      }
      const isFirst = options.systemInstruction.includes('Start with a 3 to 5 sentence lede')
      const body = {
        schema_version: 1,
        language: 'en',
        lede: isFirst ? 'This talk explains attention.' : '',
        sections: [{ heading: `Part ${call}`, start_ms: 0, end_ms: 0, paragraphs }]
      }
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
  const deps: RunnerDeps = { repo, bucket: bucket as any, model, addCost, publishBodies, settleSnapshots: vi.fn(async () => 0) }
  const params: YoutubeArticleWorkflowParams = { articleId: 1, videoId: VIDEO, sourceHash: HASH, targetLanguage: 'en', promptVersion: 'v1', title: 'Attention', trigger: 'open' }
  const { step, calls } = engine({ rewrap: opts.rewrap })
  const runId = opts.runId ?? 'run-1'
  const run = (stepLike: StepLike = step) => runYoutubeArticle(deps, params, stepLike, runId)
  return { deps, bucket, repo, model, addCost, publishBodies, params, step, calls, run }
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
    expect(s.calls).toEqual(['claim', 'prepare', ...chunkSteps, 'assemble', 'publish', 'drop-chunks', 'publish-body'])
    expect(s.publishBodies).toHaveBeenCalledWith(1)
    expect(s.model.chat).toHaveBeenCalledTimes(chunkSteps.length)
    expect(s.addCost).toHaveBeenCalledTimes(chunkSteps.length)

    expect(s.repo.row.status).toBe('ready')
    expect(s.repo.row.article_key).toBe(articleKeys()[0])
    // never touches the original html/body or text/body objects
    expect(s.bucket.put.mock.calls.every(c => String(c[0]).startsWith('youtube/canonical/'))).toBe(true)
    expect(s.bucket.delete.mock.calls.flat(2).every(k => String(k).startsWith('youtube/canonical/'))).toBe(true)
    expect(s.repo.row.quality_json).toMatchObject({ passed: true, failed: [], format: 'article', chunks: chunkSteps.length, model: 'gemini-3-flash-preview' })
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

  test('uses the supported Gemini 3 thinking level', async () => {
    const s = setup()
    await s.run()
    expect(s.model.chat).toHaveBeenCalled()
    for (const call of s.model.chat.mock.calls) expect(call[1]).toMatchObject({ thinkingConfig: { thinkingLevel: 'LOW' } })
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
    expect(s.model.chat).toHaveBeenCalledTimes(1)
    expect([...s.bucket.objects.keys()].some(k => k.includes('/chunks/'))).toBe(false)
  })
})

describe('model failures', () => {
  test('invalid JSON is retried by the step, then the attempt goes back to pending', async () => {
    const s = setup({ cues: 40, model: faithfulModel({ failOn: () => '{"lede": "cut' }) })
    expect(await s.run()).toBe('retry')
    expect(s.model.chat).toHaveBeenCalledTimes(3)
    expect(s.repo.row).toMatchObject({ status: 'pending', retry_count: 1 })
    expect(s.repo.row.error_message).toContain('chunk_invalid_json')
  })

  test('a truncated reply (MAX_TOKENS) is retried like invalid output', async () => {
    const s = setup({ cues: 40, model: faithfulModel({ finishReason: 'MAX_TOKENS' }) })
    expect(await s.run()).toBe('retry')
    expect(s.repo.row.error_message).toContain('chunk_truncated')
  })

  test('one bad reply then a good one: the step retry recovers', async () => {
    const s = setup({ cues: 40, model: faithfulModel({ failOn: call => (call === 1 ? 'not json' : null) }) })
    expect(await s.run()).toBe('ready')
  })

  test('the next attempt reuses chunk results already in R2', async () => {
    let failSecondChunk = true
    const model = faithfulModel()
    const original = model.chat.getMockImplementation()!
    model.chat.mockImplementation(async (contents: any, config: any, options: any) => {
      if (failSecondChunk && options.systemInstruction.includes('This is chunk 2 of')) throw new Error('rate_limited')
      return original(contents, config, options)
    })
    const s = setup({ model })
    expect(await s.run()).toBe('retry')
    const firstRunCalls = model.chat.mock.calls.length

    failSecondChunk = false
    const again = engine()
    expect(await s.run(again.step)).toBe('ready')
    const chunk1Prompts = model.chat.mock.calls.slice(firstRunCalls).filter((c: any) => c[2].systemInstruction.includes('This is chunk 1 of'))
    expect(chunk1Prompts).toHaveLength(0)
  })
})

describe('limits and gates', () => {
  test('the per-video budget stops before the call that could cross it, not after', async () => {
    // each call reports 340,000 output tokens = $1.02 + input; the first call already crosses $1
    const s = setup({ model: faithfulModel({ outputTokens: 340_000 }) })
    expect(await s.run()).toBe('failed')
    expect(s.model.chat).toHaveBeenCalledTimes(1)
    expect(s.repo.row).toMatchObject({ status: 'failed', error_message: 'budget_exceeded' })
  })

  test('the budget counts across attempts: a version that already spent it never calls the model again', async () => {
    const s = setup({ row: { cost_usd: 0.99 } })
    expect(await s.run()).toBe('failed')
    expect(s.model.chat).not.toHaveBeenCalled()
    expect(s.repo.row.error_message).toBe('budget_exceeded')
  })

  test('money spent by earlier attempts counts before the run starts: no call if the rest cannot pay', async () => {
    const s = setup({ row: { cost_usd: 0.98 } })
    expect(await s.run()).toBe('failed')
    expect(s.repo.row.error_message).toBe('budget_exceeded')
    expect(s.model.chat).not.toHaveBeenCalled()
    expect(s.calls).not.toContain('chunk-0')
  })

  test('failed and truncated replies are counted too', async () => {
    const s = setup({ cues: 40, model: faithfulModel({ finishReason: 'MAX_TOKENS' }) })
    await s.run()
    expect(s.repo.addCost).toHaveBeenCalledTimes(3)
    expect(s.repo.row.cost_usd).toBeGreaterThan(0)
  })

  test('a long video within the duration and chunk limits starts instead of being skipped as too_long', async () => {
    // About 22 chunks: over the old $0.30 per-video budget, well inside the new $1.00 one.
    const s = setup({ cues: 3000 })
    expect(await s.run()).toBe('ready')
    expect(s.model.chat.mock.calls.length).toBeGreaterThan(1)
  })

  test('a plan over the cap is skipped with the diagnostic fields', async () => {
    const original = YOUTUBE_ARTICLE_LIMITS.maxCostUsd
    ;(YOUTUBE_ARTICLE_LIMITS as any).maxCostUsd = 0.0001
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const s = setup()
      expect(await s.run()).toBe('skipped')
      expect(s.repo.row.error_message).toBe('too_long')
      const line = logs.mock.calls.map(c => String(c[0])).find(l => l.includes('youtube_article_skipped'))
      expect(JSON.parse(line!)).toMatchObject({
        reason: 'too_long',
        chunks: expect.any(Number),
        input_chars: expect.any(Number),
        duration_ms: expect.any(Number),
        expected_cost_usd: expect.any(Number),
        max_cost_usd: 0.0001
      })
    } finally {
      ;(YOUTUBE_ARTICLE_LIMITS as any).maxCostUsd = original
      logs.mockRestore()
    }
  })

  test('the stop is still final when the engine rewraps the error', async () => {
    const s = setup({ model: faithfulModel({ outputTokens: 340_000 }), rewrap: true })
    expect(await s.run()).toBe('failed')
    expect(s.repo.row.error_message).toBe('budget_exceeded')
  })

  test('longer than 6 hours → skipped with too_long, no model call', async () => {
    const s = setup({ noCaption: true })
    const long = caption(10)
    long.cues[9].start_ms = 6 * 3600 * 1000 + 1
    s.bucket.objects.set(CAPTION_KEY, JSON.stringify(long))
    expect(await s.run()).toBe('skipped')
    expect(s.repo.row).toMatchObject({ status: 'skipped', error_message: 'too_long', retry_count: 0 })
    expect(s.model.chat).not.toHaveBeenCalled()
  })

  test('caption object missing → failed with caption_missing', async () => {
    const s = setup({ noCaption: true })
    expect(await s.run()).toBe('failed')
    expect(s.repo.row.error_message).toBe('caption_missing')
  })

  test('a bad article fails the quality check: failed with the metrics, cached chunks dropped', async () => {
    // the target is Chinese but the fake writes English
    const s = setup({ cues: 40, model: faithfulModel() })
    s.params.targetLanguage = 'zh'
    s.repo.row.target_language = 'zh'
    expect(await s.run()).toBe('failed')
    expect(s.repo.row.error_message).toContain('quality:')
    expect(s.repo.row.error_message).toContain('wrong_language')
    expect(s.repo.row.quality_json).toMatchObject({ passed: false })
    expect([...s.bucket.objects.keys()].some(k => k.includes('/chunks/'))).toBe(false)
    for (const k of articleKeys('zh')) expect(s.bucket.objects.has(k)).toBe(false)
    expect(s.publishBodies).not.toHaveBeenCalled()
  })
})

describe('versioned transcript editing', () => {
  function editedModel() {
    const model = faithfulModel()
    const original = model.chat.getMockImplementation()!
    model.chat.mockImplementation(async (contents, config, options) => {
      if (options.systemInstruction.startsWith('Write a factual')) return { text: JSON.stringify({ lede: 'This talk explains attention.' }), usage: { inputTokens: 100, outputTokens: 30 } }
      if (options.systemInstruction.startsWith('Translate the edited')) {
        const source = JSON.parse(contents[0].parts[0].text.split('\nPrevious translation')[0])
        const sentences = [
          'Transformer 用注意力替代循环，因此每个词元都能关注其他词元。',
          '训练在序列上并行执行，长距离依赖关系不再衰减。',
          '计算成本随序列长度的平方增长，因此出现了稀疏注意力变体。',
          '位置编码恢复顺序，因为注意力本身忽略顺序。'
        ]
        for (const section of source.sections) section.paragraphs = section.paragraphs.map((text: string) => [...text.matchAll(/part (\d+)/g)].map(match => sentences[Number(match[1]) % 4] + `第 ${match[1]} 部分。`).join(''))
        return { text: JSON.stringify(source), usage: { inputTokens: 100, outputTokens: 100 } }
      }
      return original(contents, config, options)
    })
    return model
  }

  test('edits all chunks before the complete introduction and preserves every cue', async () => {
    const s = setup({ model: editedModel() })
    s.params.promptVersion = 'v2'
    expect(await s.run()).toBe('ready')
    const prompts = s.model.chat.mock.calls
    const intro = prompts.find(c => c[2].systemInstruction.startsWith('Write a factual'))!
    expect(intro[0][0].parts[0].text).toContain('part 299')
    expect(prompts.filter(c => c[2].systemInstruction.startsWith('Edit this transcript')).length).toBeGreaterThan(1)
    expect(prompts[1][0][0].parts[0].text).toContain('Previous edited context')
    const doc = JSON.parse(s.bucket.objects.get(articleKeys()[0].replace('v1', 'v2'))!)
    expect(new Set(doc.sections.flatMap((s: any) => s.paragraphs.flatMap((p: any) => p.source_cue_ids))).size).toBe(300)
  })

  test('translation changes text while the application retains source references', async () => {
    const s = setup({ cues: 40, model: editedModel() })
    s.params.promptVersion = 'v2'
    s.params.targetLanguage = 'zh'
    s.repo.row.target_language = 'zh'
    expect(await s.run()).toBe('ready')
    const translated = JSON.parse(s.bucket.objects.get(articleKeys('zh')[0].replace('v1', 'v2'))!)
    const ids = translated.sections.flatMap((section: any) => section.paragraphs.flatMap((p: any) => p.source_cue_ids))
    expect(ids).toEqual(caption(40).cues.map(c => c.id))
    const call = s.model.chat.mock.calls.find(c => c[2].systemInstruction.startsWith('Translate the edited'))!
    expect(call[0][0].parts[0].text).not.toContain('source_cue_ids')
  })

  test('translation receives the edited source, and changed paragraph counts fail', async () => {
    const model = editedModel()
    const original = model.chat.getMockImplementation()!
    model.chat.mockImplementation(async (contents, config, options) => {
      const result = await original(contents, config, options)
      if (options.systemInstruction.startsWith('Translate the edited')) {
        const doc = JSON.parse(result.text)
        doc.sections[0].paragraphs.pop()
        return { ...result, text: JSON.stringify(doc) }
      }
      return result
    })
    const s = setup({ cues: 40, model })
    s.params.promptVersion = 'v2'
    s.params.targetLanguage = 'zh'
    s.repo.row.target_language = 'zh'
    expect(await s.run()).toBe('retry')
    expect(s.repo.row.error_message).toContain('translation_structure_changed')
    expect(s.publishBodies).not.toHaveBeenCalled()
    expect(model.chat.mock.calls.filter(c => c[2].systemInstruction.startsWith('Edit this transcript'))).toHaveLength(1)
  })

  test('rejects condensed text even when every source cue is listed', async () => {
    const model = editedModel()
    const original = model.chat.getMockImplementation()!
    model.chat.mockImplementation(async (contents, config, options) => {
      const result = await original(contents, config, options)
      const doc = JSON.parse(result.text)
      for (const section of doc.sections) for (const p of section.paragraphs) p.text = 'A short summary.'
      return { ...result, text: JSON.stringify(doc) }
    })
    const s = setup({ cues: 40, model })
    s.params.promptVersion = 'v2'
    expect(await s.run()).toBe('retry')
    expect(s.repo.row.error_message).toContain('edited_length_ratio')
    expect(s.publishBodies).not.toHaveBeenCalled()
  })

  test('a same-language edit inside the chunk band also passes the article check', async () => {
    const model = editedModel()
    const original = model.chat.getMockImplementation()!
    model.chat.mockImplementation(async (contents, config, options) => {
      const result = await original(contents, config, options)
      if (!options.systemInstruction.startsWith('Edit this transcript')) return result
      // Each paragraph grows to about 1.13 of its cue text: inside the chunk band, over the generic article cap
      const doc = JSON.parse(result.text)
      for (const section of doc.sections)
        for (const p of section.paragraphs) {
          const sourceLength = p.text.replace(/\s+/g, '').length
          p.text += ' ' + 'x'.repeat(Math.round(sourceLength * 0.12))
        }
      return { ...result, text: JSON.stringify(doc) }
    })
    const s = setup({ cues: 40, model })
    s.params.promptVersion = 'v2'
    expect(await s.run()).toBe('ready')
    const ratio = (s.repo.row.quality_json as { metrics: { length_ratio: number } }).metrics.length_ratio
    expect(ratio).toBeGreaterThan(1.1)
    expect(ratio).toBeLessThanOrEqual(1.15)
  })

  test('rejects source references in a changed order', async () => {
    const model = editedModel()
    const original = model.chat.getMockImplementation()!
    model.chat.mockImplementation(async (contents, config, options) => {
      const result = await original(contents, config, options)
      const doc = JSON.parse(result.text)
      doc.sections[0].paragraphs.reverse()
      return { ...result, text: JSON.stringify(doc) }
    })
    const s = setup({ cues: 40, model })
    s.params.promptVersion = 'v2'
    expect(await s.run()).toBe('retry')
    expect(s.repo.row.error_message).toContain('chunk_incomplete_coverage')
    expect(s.publishBodies).not.toHaveBeenCalled()
  })

  test('rejects an omitted passage before caching or translating it', async () => {
    const model = editedModel()
    const original = model.chat.getMockImplementation()!
    model.chat.mockImplementation(async (contents, config, options) => {
      const result = await original(contents, config, options)
      const doc = JSON.parse(result.text)
      doc.sections[0].paragraphs.pop()
      return { ...result, text: JSON.stringify(doc) }
    })
    const s = setup({ cues: 40, model })
    s.params.promptVersion = 'v2'
    expect(await s.run()).toBe('retry')
    expect(s.repo.row.error_message).toContain('chunk_incomplete_coverage')
    expect(s.publishBodies).not.toHaveBeenCalled()
  })
})
