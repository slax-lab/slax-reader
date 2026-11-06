/**
 * One podcast run end to end with fakes: the step engine (with sleep), an in-memory R2 bucket,
 * episode and article stores, the model and AssemblyAI. Covers the publisher and AssemblyAI paths,
 * every gate, moderation, the budget, quality failures and translations.
 * 来源: src/domain/podcastRunner.ts, docs/podcast-article/spec.md 第 4.2 至 4.6 节、第 9 节
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { pollDelayMs, runPodcastEpisode, type PodcastRunnerDeps, type PodcastStepLike, type PodcastWorkflowParams } from '@/domain/podcastRunner'
import type { ArticleModel } from '@/domain/youtubeArticleRunner'
import type { podcastEpisodePO } from '@/infra/repository/dbPodcastArticle'
import type { mediaArticlePO } from '@/infra/repository/dbMediaArticle'
import type { AssemblyJobState } from '@/infra/external/assemblyAI'
import { parseVtt, type PodcastTranscriptDocument } from '@/utils/podcastTranscript'
import {
  PODCAST_LIMITS,
  PODCAST_POLISH_RESPONSE_SCHEMA,
  buildPolishInstruction,
  buildPolishUserMessage,
  buildTranslationInstruction,
  buildTranslationUserMessage,
  chunkTranslationUnits,
  translationUnits,
  planPodcastChunks,
  podcastRequestSize,
  podcastChunkKey,
  type PodcastEpisodeContext
} from '@/utils/podcastArticle'
import { estimateCostUsd } from '@/utils/youtubeArticle'

const sizeOf = (args: Parameters<ArticleModel['chat']>) => podcastRequestSize(args[2].systemInstruction, (args[0][0].parts![0] as { text: string }).text, args[1].responseSchema!)
const reservationOf = (args: Parameters<ArticleModel['chat']>) => {
  const size = sizeOf(args)
  return estimateCostUsd(size.inputTokens, size.outputLimit)
}
function polishSize(transcript: PodcastTranscriptDocument, ctx: PodcastEpisodeContext, index = 0) {
  const chunks = planPodcastChunks(transcript)
  const chunk = chunks[index]
  return podcastRequestSize(
    buildPolishInstruction(transcript.language, ctx, chunk, chunks.length, null),
    buildPolishUserMessage(transcript.cues.slice(chunk.start, chunk.end)),
    PODCAST_POLISH_RESPONSE_SCHEMA
  )
}

const VTT = readFileSync(join(__dirname, '../fixtures/podcast/buzzsprout.vtt'), 'utf8')
const SOURCE = 'f'.repeat(32)
const P: PodcastWorkflowParams = { episodeId: 7, sourceId: SOURCE, trigger: 'crawl' }

function memBucket() {
  const objects = new Map<string, string>()
  return {
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
}

function episodeStore(over: Partial<podcastEpisodePO> = {}) {
  const row = {
    id: 7,
    source_id: SOURCE,
    audio_url: 'https://cdn.example.com/ep.mp3',
    title: 'Brazil data centers',
    show_name: 'Tech Won’t Save Us',
    author: '',
    cover_url: '',
    duration_sec: 180 as number | null,
    language: 'en-us' as string | null,
    shownotes: 'Paris Marx and a guest.',
    publisher_transcripts: [] as unknown,
    transcript_status: 'pending',
    transcript_source: null as string | null,
    provider_job_id: null as string | null,
    asr_cost_job_id: null as string | null,
    transcript_key: null as string | null,
    transcript_hash: null as string | null,
    speakers: false,
    cost_usd: 0,
    retry_count: 0,
    run_id: null as string | null,
    error_message: null as string | null,
    ...over
  }
  const repo = {
    row,
    findById: vi.fn(async () => ({ ...row }) as unknown as podcastEpisodePO),
    claim: vi.fn(async (_id: number, runId: string) => {
      if (row.transcript_status === 'pending') {
        Object.assign(row, { transcript_status: 'transcribing', run_id: runId })
        return true
      }
      return row.transcript_status === 'transcribing' && row.run_id === runId
    }),
    renewLease: vi.fn(async (_id: number, runId: string) => row.transcript_status === 'transcribing' && row.run_id === runId),
    setJob: vi.fn(async (_id: number, _runId: string, jobId: string) => {
      row.provider_job_id = jobId
      return true
    }),
    addAsrCost: vi.fn(async (_id: number, jobId: string, usd: number) => {
      if (row.asr_cost_job_id === jobId) return false
      row.asr_cost_job_id = jobId
      row.cost_usd += usd
      return true
    }),
    markReady: vi.fn(async (_id: number, runId: string, t: { source: string; key: string; hash: string; speakers: boolean; language: string }) => {
      if (row.transcript_status !== 'transcribing' || row.run_id !== runId) return false
      Object.assign(row, { transcript_status: 'ready', transcript_source: t.source, transcript_key: t.key, transcript_hash: t.hash, speakers: t.speakers, language: t.language })
      return true
    }),
    markRepublish: vi.fn(async () => true),
    clearRepublish: vi.fn(async () => {}),
    finish: vi.fn(async (_id: number, o: { kind: string; error: string; clearJob?: boolean }, guard: { runId?: string } = {}) => {
      if (row.transcript_status !== 'transcribing' || (guard.runId && guard.runId !== row.run_id)) return null
      if (o.kind !== 'skipped') row.retry_count++
      row.transcript_status = o.kind === 'skipped' ? 'skipped' : o.kind === 'retry' && row.retry_count < 3 ? 'pending' : 'failed'
      if (o.clearJob) row.provider_job_id = null
      row.error_message = o.error
      return row.transcript_status as any
    })
  }
  return repo
}

function articleStore() {
  const rows: (mediaArticlePO & { status: string })[] = []
  const running = (r: { status: string }) => r.status === 'generating' || r.status === 'validating'
  const byId = (id: number) => rows.find(r => r.id === id)!
  return {
    rows,
    recordEvaluation: vi.fn(async (input: { source_id: string; source_hash: string; target_language: string; status: string; caption_key: string | null }) => {
      const found = rows.find(r => r.source_id === input.source_id && r.source_hash === input.source_hash && r.target_language === input.target_language)
      if (found) {
        if (found.status === 'pending' || found.status === 'skipped') found.status = input.status
        return { ...found }
      }
      const row = {
        id: rows.length + 100,
        ...input,
        status: input.status,
        run_id: null,
        cost_usd: 0,
        retry_count: 0,
        article_key: null,
        error_message: null,
        quality_json: null
      } as unknown as mediaArticlePO
      rows.push(row)
      return { ...row }
    }),
    findById: vi.fn(async (id: number) => ({ ...byId(id) })),
    findVersion: vi.fn(async (sourceId: string, hash: string, lang: string) => {
      const r = rows.find(x => x.source_id === sourceId && x.source_hash === hash && x.target_language === lang)
      return r ? { ...r } : null
    }),
    dropRequest: vi.fn(async (id: number) => {
      const r = byId(id)
      if (r.status !== 'pending') return false
      ;(r as { next_retry_at: Date | null }).next_retry_at = null
      return true
    }),
    listForSource: vi.fn(async (sourceId: string, hash: string) => rows.filter(r => r.source_id === sourceId && r.source_hash === hash).map(r => ({ ...r }))),
    claim: vi.fn(async (id: number, runId: string) => {
      const r = byId(id)
      if (r.status === 'pending') {
        Object.assign(r, { status: 'generating', run_id: runId })
        return true
      }
      return running(r) && r.run_id === runId
    }),
    renewLease: vi.fn(async (id: number, runId: string, _ms: number, status = 'generating') => {
      const r = byId(id)
      if (!running(r) || r.run_id !== runId) return false
      r.status = status
      return true
    }),
    addCost: vi.fn(async (id: number, usd: number) => (byId(id).cost_usd += usd)),
    publish: vi.fn(async (id: number, runId: string, _hash: string, _lang: string, data: { article_key: string; quality: object }) => {
      const r = byId(id)
      if (!running(r) || r.run_id !== runId) return false
      Object.assign(r, { status: 'ready', article_key: data.article_key, quality_json: data.quality })
      return true
    }),
    finishAttempt: vi.fn(async (id: number, o: { kind: string; error: string }, guard: { runId?: string } = {}) => {
      const r = byId(id)
      if (!running(r) || (guard.runId && guard.runId !== r.run_id)) return null
      if (o.kind !== 'skipped') r.retry_count++
      r.status = o.kind === 'skipped' ? 'skipped' : o.kind === 'retry' && r.retry_count < 3 ? 'pending' : 'failed'
      r.error_message = o.error
      return r.status as any
    }),
    setRefsHash: vi.fn(async (_sourceId: string, _hash: string) => 2)
  }
}

function engine() {
  const calls: string[] = []
  const sleeps: number[] = []
  const step: PodcastStepLike = {
    async do(name, config, fn) {
      calls.push(name)
      const attempts = (config.retries?.limit ?? 0) + 1
      let last: unknown
      for (let i = 0; i < attempts; i++) {
        try {
          return await fn()
        } catch (err) {
          last = err
          if (err instanceof Error && err.name === 'PodcastStop') break
        }
      }
      throw last
    },
    async sleep(_name, ms) {
      sleeps.push(ms)
    }
  }
  return { step, calls, sleeps }
}

/** Faithful polish (one paragraph per 3 new cues) and a translation that keeps every number. */
function fakeModel(over: { summarize?: boolean; dropTranslationId?: boolean } = {}): ArticleModel & { chat: ReturnType<typeof vi.fn> } {
  return {
    chat: vi.fn(async (contents, _config, options) => {
      const user = (contents[0].parts?.[0] as { text: string }).text
      if (options.systemInstruction.includes('资深译者')) {
        const items = [...user.matchAll(/^(lede|h\d{3}|p\d{4}): (.*)$/gm)].map(m => {
          const numbers = (m[2].match(/\d[\d,]*(?:\.\d+)?%?/g) ?? []).join(' ')
          return { id: m[1], text: `${'这是中文译文'.repeat(Math.max(1, Math.round(m[2].length / 30)))}${numbers ? ` ${numbers}` : ''}。` }
        })
        if (over.dropTranslationId) items.pop()
        return { text: JSON.stringify({ items, glossary: [{ term: 'Brazil', translation: '巴西' }] }), usage: { inputTokens: 2000, outputTokens: 1500 } }
      }
      const overlap = Number(/The first (\d+) cues were cleaned/.exec(options.systemInstruction)?.[1] ?? 0)
      const cues = [...user.matchAll(/^(c\d{4}) \[[^\]]+\](?: \(([^)]+)\))? (.*)$/gm)].map(m => ({ id: m[1], speaker: m[2] ?? null, text: m[3] })).slice(overlap)
      const paragraphs = []
      for (let i = 0; i < cues.length; i += 3) {
        const group = cues.slice(i, i + 3)
        paragraphs.push({ speaker: group[0].speaker, text: over.summarize ? 'Short.' : group.map(c => c.text).join(' '), source_cue_ids: group.map(c => c.id) })
      }
      const lede = options.systemInstruction.includes('This is the first chunk') ? 'An episode about data centers in Brazil.' : ''
      return { text: JSON.stringify({ lede, sections: [{ heading: 'Data centers', paragraphs }] }), usage: { inputTokens: 3000, outputTokens: 2500 } }
    })
  }
}

function asrFake(states: AssemblyJobState[]) {
  return { submit: vi.fn(async () => 'job-1'), get: vi.fn(async () => states.shift() ?? { status: 'pending' as const }) }
}

function setup(
  o: {
    episode?: Partial<podcastEpisodePO>
    model?: ArticleModel
    asr?: ReturnType<typeof asrFake>
    moderation?: number
    targets?: ('en' | 'zh')[]
    fetch?: () => Promise<string>
  } = {}
) {
  const episodes = episodeStore(o.episode)
  const articles = articleStore()
  const bucket = memBucket()
  const deps = {
    episodes,
    articles,
    bucket,
    model: o.model ?? fakeModel(),
    asr: o.asr ?? asrFake([]),
    fetchTranscript: vi.fn(o.fetch ?? (async () => VTT)),
    moderate: vi.fn(async () => o.moderation ?? 0),
    flagBookmarks: vi.fn(async () => 2),
    publishBodies: vi.fn(async () => 2),
    settleSnapshots: vi.fn(async () => 0),
    processVectorMaintenance: vi.fn(async (_sourceId: string, _sourceHash: string) => {}),
    setRefsHash: articles.setRefsHash,
    translationTargets: vi.fn(async () => o.targets ?? []),
    addCost: vi.fn(async () => {})
  }
  return { deps: deps as unknown as PodcastRunnerDeps & typeof deps, episodes, articles, bucket }
}

const VTT_REF = [{ url: 'https://feeds.example.com/t.vtt', type: 'text/vtt', language: 'en' }]
const words = parseVtt(VTT).map(s => ({ start_ms: s.start_ms, end_ms: s.end_ms, text: s.text, speaker: s.speaker === 'SPEAKER_02' ? 'A' : 'B' }))

describe('publisher transcript path', () => {
  test('a failed private settlement does not block ready articles or translations', async () => {
    const { deps, articles } = setup({ episode: { publisher_transcripts: VTT_REF }, targets: ['zh'] })
    deps.settleSnapshots.mockRejectedValue(new Error('broken private ref'))
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-settle-failure')).toBe('ready')
    expect(articles.rows.map(r => [r.target_language, r.status])).toEqual([
      ['en', 'ready'],
      ['zh', 'ready']
    ])
    expect(deps.publishBodies).toHaveBeenCalled()
  })

  test('transcript, article, bodies and a translation; no AssemblyAI, no sleep', async () => {
    const { deps, episodes, articles, bucket } = setup({ episode: { publisher_transcripts: VTT_REF }, targets: ['zh', 'en'] })
    const { step, sleeps } = engine()
    expect(await runPodcastEpisode(deps, P, step, 'run-1')).toBe('ready')
    expect(episodes.row).toMatchObject({ transcript_status: 'ready', transcript_source: 'publisher', language: 'en', speakers: true })
    expect(bucket.objects.has(episodes.row.transcript_key!)).toBe(true)
    expect(deps.fetchTranscript).toHaveBeenCalledWith('https://feeds.example.com/t.vtt')
    expect(deps.asr.submit).not.toHaveBeenCalled()
    expect(sleeps).toEqual([])
    expect(articles.setRefsHash).toHaveBeenCalledWith(SOURCE, episodes.row.transcript_hash)
    expect(articles.rows.map(r => [r.target_language, r.status])).toEqual([
      ['en', 'ready'],
      ['zh', 'ready']
    ])
    expect(deps.publishBodies).toHaveBeenCalledTimes(1)
    // chunks are dropped once published; the article json and text stay
    expect([...bucket.objects.keys()].filter(k => k.includes('/chunks/'))).toEqual([])
    expect([...bucket.objects.keys()].filter(k => k.includes('/articles/')).length).toBe(4)
    const zh = JSON.parse(bucket.objects.get(articles.rows[1].article_key!)!)
    const en = JSON.parse(bucket.objects.get(articles.rows[0].article_key!)!)
    expect(zh.language).toBe('zh')
    expect(zh.sections[0].paragraphs.map((p: { source_cue_ids: string[] }) => p.source_cue_ids)).toEqual(
      en.sections[0].paragraphs.map((p: { source_cue_ids: string[] }) => p.source_cue_ids)
    )
  })

  test('an unusable publisher file falls back to AssemblyAI', async () => {
    const asr = asrFake([{ status: 'completed', segments: words, language: 'en', durationSec: 180, costUsd: 0.0085 }])
    const { deps, episodes } = setup({ episode: { publisher_transcripts: VTT_REF }, asr, fetch: async () => Promise.reject(new Error('404')) })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('ready')
    expect(asr.submit).toHaveBeenCalledWith('https://cdn.example.com/ep.mp3', 'en')
    expect(episodes.row.transcript_source).toBe('assemblyai')
  })
})

test('a transcript-check step retried after the ready mark committed still goes on to the article', async () => {
  const { deps, episodes } = setup({ episode: { publisher_transcripts: VTT_REF } })
  const real = episodes.markReady.getMockImplementation()!
  episodes.markReady.mockImplementationOnce(async (...args) => {
    await real(...args)
    throw new Error('connection reset')
  })
  expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('ready')
  expect(deps.publishBodies).toHaveBeenCalledTimes(1)
})

describe('AssemblyAI path', () => {
  test('submit once, poll with sleeps, count the cost', async () => {
    const asr = asrFake([{ status: 'pending' }, { status: 'pending' }, { status: 'completed', segments: words, language: 'en', durationSec: 180, costUsd: 0.0085 }])
    const { deps, episodes } = setup({ asr })
    const { step, sleeps } = engine()
    expect(await runPodcastEpisode(deps, P, step, 'run-1')).toBe('ready')
    expect(asr.submit).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([30_000, 30_000, 30_000])
    expect(episodes.row.cost_usd).toBeCloseTo(0.0085)
    expect(deps.addCost).toHaveBeenCalledWith(0.0085)
    expect(episodes.row).toMatchObject({ transcript_status: 'ready', provider_job_id: 'job-1', speakers: true })
  })

  test('a known job is polled, not submitted again', async () => {
    const asr = asrFake([{ status: 'completed', segments: words, language: 'en', durationSec: 180, costUsd: 0.0085 }])
    const { deps } = setup({ asr, episode: { provider_job_id: 'job-old' } })
    await runPodcastEpisode(deps, P, engine().step, 'run-1')
    expect(asr.submit).not.toHaveBeenCalled()
    expect(asr.get).toHaveBeenCalledWith('job-old')
  })

  test('a retry that polls an already counted job adds no cost', async () => {
    const asr = asrFake([{ status: 'completed', segments: words, language: 'en', durationSec: 180, costUsd: 0.0085 }])
    const { deps, episodes } = setup({ asr, episode: { provider_job_id: 'job-old', asr_cost_job_id: 'job-old', cost_usd: 0.0085 } })
    await runPodcastEpisode(deps, P, engine().step, 'run-1')
    expect(episodes.row.cost_usd).toBeCloseTo(0.0085)
    expect(deps.addCost).not.toHaveBeenCalledWith(0.0085)
  })

  test('a provider error goes back to pending for a retry, the job is forgotten', async () => {
    const { deps, episodes } = setup({ asr: asrFake([{ status: 'error', error: 'Download error' }]) })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('retry')
    expect(episodes.row).toMatchObject({ transcript_status: 'pending', error_message: 'asr_error:Download error', provider_job_id: null })
  })

  test('a job still pending after 2 hours fails with asr_timeout', async () => {
    const { deps, episodes } = setup({ asr: asrFake([]) })
    const { sleeps } = engine()
    const e = engine()
    expect(await runPodcastEpisode(deps, P, e.step, 'run-1')).toBe('failed')
    expect(episodes.row.error_message).toBe('asr_timeout')
    expect(e.sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000)
    expect(sleeps).toEqual([])
    expect([0, 3, 4, 9, 10].map(pollDelayMs)).toEqual([30_000, 30_000, 60_000, 60_000, 120_000])
  })

  test('an unsupported detected language is skipped after transcription', async () => {
    const asr = asrFake([{ status: 'completed', segments: words, language: 'ja', durationSec: 180, costUsd: 0.0085 }])
    const { deps, episodes } = setup({ asr, episode: { language: null } })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('skipped')
    expect(episodes.row.error_message).toBe('language_unsupported')
  })
})

describe('gates', () => {
  test.each([
    [{ duration_sec: 4 * 3600 }, 'too_long'],
    [{ language: 'ja' }, 'language_unsupported'],
    [{ audio_url: '' }, 'no_audio']
  ])('%o → skipped %s before any paid call', async (episode, reason) => {
    const { deps, episodes } = setup({ episode })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('skipped')
    expect(episodes.row.error_message).toBe(reason)
    expect(deps.asr.submit).not.toHaveBeenCalled()
    expect(deps.model.chat).not.toHaveBeenCalled()
  })

  test('too few words for the duration → no_speech, transcript deleted', async () => {
    const asr = asrFake([{ status: 'completed', segments: words.slice(0, 3), language: 'en', durationSec: 3000, costUsd: 0.14 }])
    const { deps, episodes, bucket } = setup({ asr, episode: { duration_sec: 3000 } })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('skipped')
    expect(episodes.row.error_message).toBe('no_speech')
    expect([...bucket.objects.keys()]).toEqual([])
  })

  test('moderation hit → bookmarks flagged, no article, transcript deleted', async () => {
    const { deps, episodes, bucket } = setup({ episode: { publisher_transcripts: VTT_REF }, moderation: 1 })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('skipped')
    expect(deps.flagBookmarks).toHaveBeenCalledWith(SOURCE, 1)
    expect(episodes.row.error_message).toBe('moderation')
    expect(deps.model.chat).not.toHaveBeenCalled()
    expect([...bucket.objects.keys()]).toEqual([])
  })
})

describe('articles', () => {
  test('an episode already transcribed with a ready article: bodies only, no model call', async () => {
    const first = setup({ episode: { publisher_transcripts: VTT_REF } })
    await runPodcastEpisode(first.deps, P, engine().step, 'run-1')
    first.deps.model.chat.mockClear()
    first.deps.publishBodies.mockClear()
    expect(await runPodcastEpisode(first.deps, P, engine().step, 'run-2')).toBe('ready')
    expect(first.deps.model.chat).not.toHaveBeenCalled()
    expect(first.deps.publishBodies).toHaveBeenCalledTimes(1)
  })

  test('uses podcast output capacity with the default Gemini 3 temperature and LOW thinking', async () => {
    const { deps } = setup({ episode: { publisher_transcripts: VTT_REF } })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('ready')
    expect(deps.model.chat).toHaveBeenCalled()
    const types: unknown[] = []
    const walkSchema = (value: unknown) => {
      if (!value || typeof value !== 'object') return
      if ('type' in value) types.push(value.type)
      Object.values(value).forEach(walkSchema)
    }
    for (const call of deps.model.chat.mock.calls) {
      expect(call[1]).toMatchObject({ maxOutputTokens: sizeOf(call).outputLimit, temperature: 1.0, thinkingConfig: { thinkingLevel: 'LOW' }, abortSignal: expect.any(AbortSignal) })
      expect(call[1].responseSchema).toEqual(PODCAST_POLISH_RESPONSE_SCHEMA)
      walkSchema(call[1].responseSchema)
    }
    expect(types).toContain('OBJECT')
    expect(types).toContain('STRING')
    expect(types).not.toContain('INTEGER')
  })

  test('another run holds the episode → not_claimed', async () => {
    const { deps } = setup({ episode: { transcript_status: 'transcribing', run_id: 'other' } })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('not_claimed')
  })

  test('rejects a summary at the part gate without caching or publishing it', async () => {
    const { deps, articles, bucket } = setup({ episode: { publisher_transcripts: VTT_REF }, model: fakeModel({ summarize: true }) })
    const e = engine()
    expect(await runPodcastEpisode(deps, P, e.step, 'run-1')).toBe('retry')
    expect(articles.rows[0].error_message).toMatch(/^chunk_quality:.*length_ratio/)
    expect(deps.model.chat).toHaveBeenCalledTimes(3)
    expect(e.calls).not.toContain('polish-en-assemble')
    expect(deps.publishBodies).not.toHaveBeenCalled()
    expect([...bucket.objects.keys()].filter(k => k.includes('/chunks/'))).toEqual([])
  })

  test('the per-episode budget stops a model call before it is made', async () => {
    const { deps, articles, episodes } = setup({ episode: { publisher_transcripts: VTT_REF } })
    // Spent elsewhere after the transcript gate: only the check before the model call can stop it
    const ready = episodes.markReady.getMockImplementation()!
    episodes.markReady.mockImplementation(async (...args) => {
      const ok = await ready(...args)
      episodes.row.cost_usd = 0.999
      return ok
    })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('failed')
    expect(articles.rows[0].error_message).toBe('budget_exceeded')
    expect(deps.model.chat).not.toHaveBeenCalled()
  })

  test('a translation with a missing paragraph id is not published; the original body still is', async () => {
    const { deps, articles } = setup({ episode: { publisher_transcripts: VTT_REF }, targets: ['zh'], model: fakeModel({ dropTranslationId: true }) })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('ready')
    expect(deps.publishBodies).toHaveBeenCalledTimes(1)
    expect(articles.rows.map(r => [r.target_language, r.status, r.error_message])).toEqual([
      ['en', 'ready', null],
      ['zh', 'pending', 'chunk_invalid_json:missing_id']
    ])
  })
})

describe('review fixes', () => {
  test.each(['ready', 'failed', 'skipped'] as const)('admission failure after %s content replays without republishing or regenerating', async outcome => {
    const { deps, episodes, articles, bucket } = setup({
      episode: { publisher_transcripts: VTT_REF, ...(outcome === 'skipped' ? { audio_url: '' } : {}) },
      targets: ['zh']
    })
    if (outcome === 'failed') {
      const ready = episodes.markReady.getMockImplementation()!
      episodes.markReady.mockImplementation(async (...args) => {
        const ok = await ready(...args)
        const transcript = JSON.parse(bucket.objects.get(args[2].key)!)
        transcript.cues = []
        bucket.objects.set(args[2].key, JSON.stringify(transcript))
        return ok
      })
    }
    deps.processVectorMaintenance.mockRejectedValue(new Error('admission unavailable'))
    const completed = new Map<string, unknown>()
    const normal = engine().step
    const step: PodcastStepLike = {
      sleep: normal.sleep,
      async do(name, config, fn) {
        if (completed.has(name)) return completed.get(name) as any
        const result = await normal.do(name, config, fn)
        completed.set(name, result)
        return result
      }
    }
    await expect(runPodcastEpisode(deps, P, step, 'run-admission')).rejects.toThrow('admission unavailable')
    expect(deps.processVectorMaintenance).toHaveBeenCalledTimes(3)
    expect(deps.processVectorMaintenance).toHaveBeenLastCalledWith(SOURCE, episodes.row.transcript_hash ?? '')
    expect(deps.publishBodies).toHaveBeenCalledTimes(outcome === 'ready' ? 1 : 0)
    expect(articles.finishAttempt).toHaveBeenCalledTimes(outcome === 'failed' ? 1 : 0)
    expect(episodes.finish).toHaveBeenCalledTimes(outcome === 'skipped' ? 1 : 0)
    const modelCalls = deps.model.chat.mock.calls.length
    const settlements = deps.settleSnapshots.mock.calls.length
    deps.processVectorMaintenance.mockResolvedValue(undefined)
    expect(await runPodcastEpisode(deps, P, step, 'run-admission')).toBe(outcome)
    expect(deps.processVectorMaintenance).toHaveBeenCalledTimes(4)
    expect(deps.model.chat).toHaveBeenCalledTimes(modelCalls)
    expect(deps.settleSnapshots).toHaveBeenCalledTimes(settlements)
    expect(deps.publishBodies).toHaveBeenCalledTimes(outcome === 'ready' ? 1 : 0)
    expect(episodes.markRepublish).not.toHaveBeenCalled()
    if (outcome === 'ready')
      expect(articles.rows.map(r => [r.target_language, r.status])).toEqual([
        ['en', 'ready'],
        ['zh', 'ready']
      ])
  })

  test('a transient admission failure retries only admission after bodies and translations finish', async () => {
    const { deps, articles, episodes } = setup({ episode: { publisher_transcripts: VTT_REF }, targets: ['zh'] })
    deps.processVectorMaintenance.mockImplementationOnce(async () => {
      expect(deps.publishBodies).toHaveBeenCalledOnce()
      expect(articles.rows.map(r => r.status)).toEqual(['ready', 'ready'])
      throw new Error('admission unavailable')
    })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-admission')).toBe('ready')
    expect(deps.processVectorMaintenance).toHaveBeenCalledTimes(2)
    expect(deps.publishBodies).toHaveBeenCalledOnce()
    expect(episodes.markRepublish).not.toHaveBeenCalled()
    expect(articles.finishAttempt).not.toHaveBeenCalled()
  })

  test.each(['transcript', 'article'])('terminal %s settlement errors are not suppressed as gone', async stage => {
    const { deps, episodes, articles } = setup({
      episode: { publisher_transcripts: VTT_REF, ...(stage === 'transcript' ? { audio_url: '' } : {}) }
    })
    if (stage === 'article') {
      const ready = episodes.markReady.getMockImplementation()!
      episodes.markReady.mockImplementation(async (...args) => {
        const ok = await ready(...args)
        episodes.row.cost_usd = 0.999
        return ok
      })
    }
    deps.settleSnapshots.mockRejectedValue(new Error('settlement unavailable'))
    await expect(runPodcastEpisode(deps, P, engine().step, 'run-settlement')).rejects.toThrow('settlement unavailable')
    expect(deps.settleSnapshots).toHaveBeenCalledTimes(3)
    expect(episodes.finish).toHaveBeenCalledTimes(stage === 'transcript' ? 1 : 0)
    expect(articles.finishAttempt).toHaveBeenCalledTimes(stage === 'article' ? 1 : 0)
    expect(deps.processVectorMaintenance).not.toHaveBeenCalled()
  })

  test('lease loss does not admit stale article maintenance', async () => {
    const { deps, articles } = setup({ episode: { publisher_transcripts: VTT_REF } })
    articles.renewLease.mockResolvedValue(false)
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-stale')).toBe('gone')
    expect(deps.processVectorMaintenance).not.toHaveBeenCalled()
    expect(deps.publishBodies).not.toHaveBeenCalled()
  })

  test('saving the job id fails once: the retry saves it, no second paid job', async () => {
    const asr = asrFake([{ status: 'completed', segments: words, language: 'en', durationSec: 180, costUsd: 0.0085 }])
    const { deps, episodes } = setup({ asr })
    episodes.setJob.mockRejectedValueOnce(new Error('pg blip'))
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('ready')
    expect(asr.submit).toHaveBeenCalledTimes(1)
  })

  test('moderation down after the job finished: the next attempt polls the same job, no new submit', async () => {
    const done: AssemblyJobState = { status: 'completed', segments: words, language: 'en', durationSec: 180, costUsd: 0.0085 }
    const asr = asrFake([done, done])
    const { deps, episodes } = setup({ asr })
    deps.moderate.mockRejectedValue(new Error('moderation down'))
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('retry')
    expect(episodes.row.provider_job_id).toBe('job-1')
    deps.moderate.mockResolvedValue(0)
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-2')).toBe('ready')
    expect(asr.submit).toHaveBeenCalledTimes(1)
    expect(asr.get).toHaveBeenLastCalledWith('job-1')
  })

  test('an episode that already spent most of its budget is skipped before a new paid job', async () => {
    const { deps, episodes } = setup({ episode: { cost_usd: 0.99 } })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('skipped')
    expect(episodes.row.error_message).toBe('budget_exceeded')
    expect(deps.asr.submit).not.toHaveBeenCalled()
  })

  test('writing the bodies fails: the run still ends ready, the sweep gets a time to write them again, translations go on', async () => {
    const { deps, episodes, articles } = setup({ episode: { publisher_transcripts: VTT_REF }, targets: ['zh'] })
    deps.publishBodies.mockRejectedValue(new Error('r2 down'))
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('ready')
    expect(episodes.markRepublish).toHaveBeenCalledTimes(1)
    expect(episodes.clearRepublish).not.toHaveBeenCalled()
    expect(deps.publishBodies).toHaveBeenCalledTimes(3)
    expect(deps.processVectorMaintenance).toHaveBeenCalledOnce()
    expect(articles.finishAttempt).not.toHaveBeenCalled()
    expect(articles.rows.map(r => [r.target_language, r.status])).toEqual([
      ['en', 'ready'],
      ['zh', 'ready']
    ])
  })

  test('a pending translation nobody needs any more loses its sweep time; a skipped row stays skipped', async () => {
    const first = setup({ episode: { publisher_transcripts: VTT_REF } })
    await runPodcastEpisode(first.deps, P, engine().step, 'run-1')
    const hash = first.episodes.row.transcript_hash!
    first.articles.rows[0]!.status = 'skipped'
    const orphan = await first.articles.recordEvaluation({ source_id: SOURCE, source_hash: hash, target_language: 'zh', status: 'pending', caption_key: null })
    first.deps.model.chat.mockClear()
    expect(await runPodcastEpisode(first.deps, P, engine().step, 'run-2')).toBe('not_claimed')
    expect(first.articles.rows[0]!.status).toBe('skipped')
    first.articles.rows[0]!.status = 'ready'
    await runPodcastEpisode(first.deps, P, engine().step, 'run-3')
    expect(first.articles.dropRequest).toHaveBeenCalledWith(orphan.id)
    expect(first.deps.model.chat).not.toHaveBeenCalled()
  })
})

describe('concurrent podcast articles', () => {
  function readyLong() {
    const state = setup()
    const cues = Array.from({ length: 360 }, (_, i) => ({
      id: `c${String(i + 1).padStart(4, '0')}`,
      start_ms: i * 10_000,
      duration_ms: 10_000,
      text:
        `Topic ${i}: ` +
        'The speaker explains how local research changes the choices people make about work, education, transport, housing, public services, and their future. '.repeat(3)
    }))
    Object.assign(state.episodes.row, { transcript_status: 'ready', transcript_hash: 'long-hash', transcript_key: 'long-transcript', language: 'en' })
    state.bucket.objects.set('long-transcript', JSON.stringify({ schema_version: 1, source: 'publisher', language: 'en', speakers: false, duration_ms: 3_600_000, cues }))
    return { ...state, cues }
  }

  test('runs ten chunks together and assembles in source order', async () => {
    const { deps, articles, bucket, cues } = readyLong()
    expect(planPodcastChunks(JSON.parse(bucket.objects.get('long-transcript')!)).length).toBeGreaterThan(10)
    const original = fakeModel()
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let active = 0,
      maximum = 0,
      started = 0
    deps.model = {
      chat: async (...args) => {
        const index = started++
        maximum = Math.max(maximum, ++active)
        await gate
        await new Promise(resolve => setTimeout(resolve, (9 - (index % 10)) * 5))
        try {
          return await original.chat(...args)
        } finally {
          active--
        }
      }
    }
    const run = runPodcastEpisode(deps, P, engine().step, 'parallel')
    try {
      await vi.waitFor(() => expect(started).toBe(10), { timeout: 1000 })
      expect(active).toBe(10)
    } finally {
      release()
    }
    expect(await run).toBe('ready')
    expect(maximum).toBe(10)
    const doc = JSON.parse(bucket.objects.get(articles.rows[0].article_key!)!)
    expect(doc.sections.flatMap(s => s.paragraphs.flatMap(p => p.source_cue_ids))).toEqual(cues.map(c => c.id))
  })

  test('waits for failed-chunk siblings and reuses them on retry', async () => {
    const { deps, bucket } = readyLong()
    const original = fakeModel()
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let started = 0,
      fail = true,
      finished = false,
      failedStep = false
    const e = engine()
    const step: PodcastStepLike = {
      sleep: e.step.sleep,
      async do(name, config, fn) {
        try {
          return await e.step.do(name, config, fn)
        } catch (error) {
          if (name === 'polish-en-chunk-0') failedStep = true
          throw error
        }
      }
    }
    deps.model = {
      chat: async (...args) => {
        if (args[2].systemInstruction.includes('This is the first chunk') && fail) throw Object.assign(new Error('first chunk failed'), { status: 503 })
        started++
        await gate
        return original.chat(...args)
      }
    }
    const run = runPodcastEpisode(deps, P, step, 'failure').then(value => {
      finished = true
      return value
    })
    try {
      await vi.waitFor(
        () => {
          expect(started).toBe(9)
          expect(failedStep).toBe(true)
        },
        { timeout: 1000 }
      )
      expect(finished).toBe(false)
    } finally {
      release()
    }
    expect(await run).toBe('retry')
    expect([...bucket.objects.keys()].filter(k => k.includes('/chunks/') && !k.includes('.parts/'))).toHaveLength(9)
    fail = false
    original.chat.mockClear()
    expect(await runPodcastEpisode(deps, P, engine().step, 'retry')).toBe('ready')
    expect(original.chat.mock.calls.filter(call => /This is chunk ([2-9]|10) of/.test(call[2].systemInstruction))).toHaveLength(0)
  })

  test('reserves concurrent costs before admitting model calls', async () => {
    const { deps, articles, episodes, bucket } = readyLong()
    const transcript = JSON.parse(bucket.objects.get('long-transcript')!)
    const ctx = { title: episodes.row.title, showName: episodes.row.show_name, shownotes: episodes.row.shownotes }
    const sizes = Array.from({ length: 10 }, (_, i) => polishSize(transcript, ctx, i))
    expect(sizes.every(size => !size.oversized)).toBe(true)
    const minimum = Math.min(...sizes.map(size => estimateCostUsd(size.inputTokens, size.outputLimit)))
    episodes.row.cost_usd = PODCAST_LIMITS.maxEpisodeCostUsd - minimum * 1.25
    const original = fakeModel()
    let active = 0,
      maximum = 0
    deps.model = {
      chat: async (...args) => {
        maximum = Math.max(maximum, ++active)
        const size = sizeOf(args)
        expect(args[1].maxOutputTokens).toBe(size.outputLimit)
        await new Promise(resolve => setTimeout(resolve, 10))
        const result = await original.chat(...args)
        active--
        return { ...result, usage: { inputTokens: size.inputTokens, outputTokens: size.outputLimit } }
      }
    }
    expect(await runPodcastEpisode(deps, P, engine().step, 'budget')).toBe('failed')
    expect(maximum).toBe(1)
    expect(original.chat).toHaveBeenCalledOnce()
    expect(articles.rows[0].cost_usd).toBeCloseTo(reservationOf(original.chat.mock.calls[0]), 8)
    expect(articles.rows[0].error_message).toBe('budget_exceeded')
    expect(deps.publishBodies).not.toHaveBeenCalled()
  })

  test('reduces translation concurrency when five requested reservations no longer fit', async () => {
    const { deps, articles, episodes, bucket } = readyLong()
    deps.translationTargets.mockImplementation(async () => {
      const source = JSON.parse(bucket.objects.get(articles.rows[0].article_key!)!)
      const ctx = { title: episodes.row.title, showName: episodes.row.show_name, shownotes: episodes.row.shownotes }
      const system = buildTranslationInstruction('en', 'zh', ctx, '', [])
      const { PODCAST_TRANSLATION_RESPONSE_SCHEMA } = await import('@/utils/podcastArticle')
      const costs = chunkTranslationUnits(translationUnits(source))
        .slice(0, 5)
        .map(chunk => {
          const size = podcastRequestSize(system, buildTranslationUserMessage(chunk), PODCAST_TRANSLATION_RESPONSE_SCHEMA)
          expect(size.oversized).toBe(false)
          return estimateCostUsd(size.inputTokens, size.outputLimit)
        })
      const remaining = costs.slice(0, 4).reduce((sum, cost) => sum + cost, 0) + Math.min(...costs) / 2
      expect(remaining).toBeLessThan(costs.reduce((sum, cost) => sum + cost, 0))
      episodes.row.cost_usd = PODCAST_LIMITS.maxEpisodeCostUsd - articles.rows[0].cost_usd - remaining
      return ['zh']
    })
    const original = fakeModel()
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let started = 0,
      active = 0,
      maximum = 0
    deps.model = {
      chat: async (...args) => {
        const translation = args[2].systemInstruction.includes('资深译者')
        if (translation) {
          started++
          maximum = Math.max(maximum, ++active)
          await gate
        }
        try {
          return await original.chat(...args)
        } finally {
          if (translation) active--
        }
      }
    }
    const run = runPodcastEpisode(deps, P, engine().step, 'translation')
    try {
      await vi.waitFor(() => expect(started).toBe(4), { timeout: 1000 })
    } finally {
      release()
    }
    expect(await run).toBe('ready')
    expect(maximum).toBe(4)
    expect(articles.rows.find(r => r.target_language === 'zh')?.status).toBe('ready')
  })

  test('starts later chunks while an earlier chunk remains slow without exceeding ten calls', async () => {
    const { deps, articles, bucket } = readyLong()
    expect(planPodcastChunks(JSON.parse(bucket.objects.get('long-transcript')!)).length).toBeGreaterThan(10)
    const original = fakeModel()
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let active = 0,
      maximum = 0,
      slowFinished = false
    const started: number[] = []
    deps.model = {
      chat: async (...args) => {
        const index = Number(/This is chunk (\d+) of/.exec(args[2].systemInstruction)![1]) - 1
        started.push(index)
        maximum = Math.max(maximum, ++active)
        try {
          if (index === 0) await gate
          else await new Promise(resolve => setTimeout(resolve, 2))
          return await original.chat(...args)
        } finally {
          active--
          if (index === 0) slowFinished = true
        }
      }
    }
    const run = runPodcastEpisode(deps, P, engine().step, 'rolling-slow')
    try {
      await vi.waitFor(() => expect(started).toContain(10))
      expect(slowFinished).toBe(false)
      expect(articles.publish).not.toHaveBeenCalled()
      expect(maximum).toBeLessThanOrEqual(10)
    } finally {
      release()
    }
    expect(await run).toBe('ready')
    expect(maximum).toBeGreaterThan(1)
    expect(maximum).toBeLessThanOrEqual(10)
    expect(active).toBe(0)
  })

  test('does not start new chunks after failure and drains already running siblings', async () => {
    const { deps, articles } = readyLong()
    const original = fakeModel()
    let release!: () => void, fail!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const failureGate = new Promise<void>(resolve => {
      fail = resolve
    })
    const started: number[] = []
    let active = 0,
      finished = false,
      failedStep = false
    const step: PodcastStepLike = {
      sleep: async () => {},
      do: async (name, _config, fn) => {
        try {
          return await fn()
        } catch (error) {
          if (name === 'polish-en-chunk-0') failedStep = true
          throw error
        }
      }
    }
    deps.model = {
      chat: async (...args) => {
        const index = Number(/This is chunk (\d+) of/.exec(args[2].systemInstruction)![1]) - 1
        started.push(index)
        active++
        try {
          if (index === 0) {
            await failureGate
            throw Object.assign(new Error('unavailable'), { status: 503 })
          }
          await gate
          return await original.chat(...args)
        } finally {
          active--
        }
      }
    }
    const run = runPodcastEpisode(deps, P, step, 'rolling-failure').then(result => {
      finished = true
      return result
    })
    try {
      await vi.waitFor(() => expect(started).toHaveLength(10))
      fail()
      await vi.waitFor(() => expect(failedStep).toBe(true))
      expect(active).toBe(9)
      expect(finished).toBe(false)
      expect(articles.finishAttempt).not.toHaveBeenCalled()
    } finally {
      fail()
      release()
    }
    expect(await run).toBe('retry')
    expect(started.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i))
    expect(active).toBe(0)
    expect(articles.publish).not.toHaveBeenCalled()
  })

  function cachedEngine() {
    const e = engine()
    const results = new Map<string, unknown>()
    const step: PodcastStepLike = {
      sleep: e.step.sleep,
      async do<T>(name: string, config: Parameters<PodcastStepLike['do']>[1], fn: () => Promise<T>): Promise<T> {
        if (results.has(name)) return results.get(name) as T
        const result = await e.step.do(name, config, fn)
        results.set(name, result)
        return result
      }
    }
    return { ...e, step, results }
  }

  test('strips contextual ids from mixed paragraphs without backward paragraph starts', async () => {
    const { deps, articles, bucket, cues } = readyLong()
    const original = fakeModel()
    let mixed = 0
    deps.model = {
      chat: async (...args) => {
        const reply = await original.chat(...args)
        const overlap = Number(/The first (\d+) cues were cleaned/.exec(args[2].systemInstruction)?.[1] ?? 0)
        if (!overlap) return reply
        const value = JSON.parse(reply.text)
        const ids = [...(args[0][0].parts![0] as { text: string }).text.matchAll(/^(c\d+) /gm)].slice(0, overlap).map(m => m[1])
        value.sections[0].paragraphs[0].source_cue_ids.unshift(...ids)
        mixed++
        return { ...reply, text: JSON.stringify(value) }
      }
    }
    expect(await runPodcastEpisode(deps, P, engine().step, 'mixed-overlap')).toBe('ready')
    expect(mixed).toBeGreaterThan(0)
    const doc = JSON.parse(bucket.objects.get(articles.rows[0].article_key!)!)
    const paragraphs = doc.sections.flatMap(s => s.paragraphs)
    expect(paragraphs.flatMap(p => p.source_cue_ids)).toEqual(cues.map(c => c.id))
    const starts = paragraphs.map(p => cues.find(c => c.id === p.source_cue_ids[0])!.start_ms)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    const plan = planPodcastChunks(JSON.parse(bucket.objects.get('long-transcript')!))
    for (const chunk of plan.slice(1)) {
      const firstOwned = cues[chunk.start + chunk.overlap]
      expect(paragraphs.find(p => p.source_cue_ids.includes(firstOwned.id))!.source_cue_ids[0]).toBe(firstOwned.id)
    }
  })

  test('repairs only the later long duplicate and uses fresh workflow step names', async () => {
    const { deps, articles, bucket } = readyLong()
    const original = fakeModel()
    const calls = new Map<number, number>()
    const repeated = 'The guest explains how careful local research informs decisions about public services.'
    deps.model = {
      chat: async (...args) => {
        const index = Number(/This is chunk (\d+) of/.exec(args[2].systemInstruction)![1]) - 1
        const n = (calls.get(index) ?? 0) + 1
        calls.set(index, n)
        const reply = await original.chat(...args)
        if (index > 1 || n > 1) return reply
        const value = JSON.parse(reply.text)
        const last = value.sections[0].paragraphs.at(-1)
        value.sections[0].paragraphs.push({ speaker: null, text: repeated, source_cue_ids: [last.source_cue_ids.at(-1)] })
        return { ...reply, text: JSON.stringify(value) }
      }
    }
    const e = cachedEngine()
    expect(await runPodcastEpisode(deps, P, e.step, 'duplicate-repair')).toBe('ready')
    expect(calls.get(1)).toBe(2)
    for (const [index, count] of calls) if (index !== 1) expect(count).toBe(1)
    expect(e.calls.filter(name => /^polish-en-chunk-\d+-r1$/.test(name))).toEqual(['polish-en-chunk-1-r1'])
    expect(e.results.has('polish-en-assemble')).toBe(true)
    expect(e.results.has('polish-en-assemble-r1')).toBe(true)
    expect(e.calls).not.toContain('polish-en-assemble-r2')
    const doc = JSON.parse(bucket.objects.get(articles.rows[0].article_key!)!)
    expect(doc.sections.flatMap(s => s.paragraphs).filter(p => p.text === repeated)).toHaveLength(1)
  })

  test.each([false, true])('retries only the first part when its introduction is empty (persistent: %s)', async persistent => {
    const { deps, articles, bucket } = readyLong()
    const original = fakeModel()
    const calls = new Map<number, number>()
    deps.model = {
      chat: async (...args) => {
        const index = Number(/This is chunk (\d+) of/.exec(args[2].systemInstruction)![1]) - 1
        const n = (calls.get(index) ?? 0) + 1
        calls.set(index, n)
        const reply = await original.chat(...args)
        if (index !== 0 || (!persistent && n > 1)) return reply
        const value = JSON.parse(reply.text)
        value.lede = ''
        return { ...reply, text: JSON.stringify(value) }
      }
    }
    const count = planPodcastChunks(JSON.parse(bucket.objects.get('long-transcript')!)).length
    const e = cachedEngine()
    expect(await runPodcastEpisode(deps, P, e.step, 'missing-introduction')).toBe(persistent ? 'retry' : 'ready')
    if (!persistent) expect(calls.size).toBe(count)
    expect(calls.get(0)).toBe(persistent ? 3 : 2)
    for (const [index, attempts] of calls) if (index !== 0) expect(attempts).toBe(1)
    expect(e.calls.filter(name => /^polish-en-chunk-\d+-r1$/.test(name))).toHaveLength(0)
    expect(e.calls).not.toContain('polish-en-assemble-r1')
    expect(e.calls.some(name => name.endsWith('-r2'))).toBe(false)
    if (persistent) {
      expect(articles.rows[0].error_message).toContain('chunk_quality:empty_block')
      expect(articles.publish).not.toHaveBeenCalled()
      expect(deps.publishBodies).not.toHaveBeenCalled()
      expect([...bucket.objects.keys()].some(key => key.includes('/chunks/'))).toBe(true)
    }
  })

  test('repairs only the first chunk when a legacy cache has an empty introduction', async () => {
    const { deps, articles, bucket } = readyLong()
    const transcript = JSON.parse(bucket.objects.get('long-transcript')!)
    const plan = planPodcastChunks(transcript)
    for (const chunk of plan) {
      const cues = transcript.cues.slice(chunk.start + chunk.overlap, chunk.end)
      bucket.objects.set(
        podcastChunkKey(SOURCE, 'long-hash', 'en', chunk.index),
        JSON.stringify({
          index: chunk.index,
          lede: '',
          usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
          sections: [{ heading: `Topic ${chunk.index}`, start_ms: 0, end_ms: 0, paragraphs: cues.map(cue => ({ speaker: null, text: cue.text, source_cue_ids: [cue.id] })) }]
        })
      )
    }
    const e = cachedEngine()
    expect(await runPodcastEpisode(deps, P, e.step, 'legacy-empty-introduction')).toBe('ready')
    expect(e.calls.filter(name => /^polish-en-chunk-\d+-r1$/.test(name))).toEqual(['polish-en-chunk-0-r1'])
    expect(JSON.parse(bucket.objects.get(articles.rows[0].article_key!)!).lede).not.toBe('')
  })

  test.each([false, true])('repairs untargetable global number coverage once (persistent: %s)', async persistent => {
    const { deps, articles, bucket, cues } = readyLong()
    for (const [i, cue] of cues.entries()) {
      const label = String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26))
      cue.text = cue.text.replace(/^Topic \d+/, `Topic ${label} 50000`)
    }
    const transcript = JSON.parse(bucket.objects.get('long-transcript')!)
    transcript.cues = cues
    bucket.objects.set('long-transcript', JSON.stringify(transcript))
    const original = fakeModel()
    const calls = new Map<number, number>()
    deps.model = {
      chat: async (...args) => {
        const index = Number(/This is chunk (\d+) of/.exec(args[2].systemInstruction)![1]) - 1
        const n = (calls.get(index) ?? 0) + 1
        calls.set(index, n)
        const reply = await original.chat(...args)
        if (!persistent && n > 1) return reply
        const value = JSON.parse(reply.text)
        for (const section of value.sections) for (const paragraph of section.paragraphs) paragraph.text = paragraph.text.replaceAll('50000', '')
        return { ...reply, text: JSON.stringify(value) }
      }
    }
    const e = cachedEngine()
    expect(await runPodcastEpisode(deps, P, e.step, 'global-number-coverage')).toBe(persistent ? 'failed' : 'ready')
    const count = planPodcastChunks(transcript).length
    expect(calls.size).toBe(count)
    expect([...calls.values()]).toEqual(Array(count).fill(2))
    expect(e.calls.filter(name => /^polish-en-chunk-\d+-r1$/.test(name))).toHaveLength(count)
    expect(e.calls).toContain('polish-en-assemble-r1')
    expect(e.calls.some(name => name.endsWith('-r2'))).toBe(false)
    if (persistent) {
      expect(articles.rows[0].error_message).toBe('quality:number_coverage')
      expect(deps.publishBodies).not.toHaveBeenCalled()
      expect([...bucket.objects.keys()].some(key => key.includes('/chunks/'))).toBe(false)
    }
  })

  test('repairs all translation chunks once after an assembled translation quality failure', async () => {
    const { deps, articles, bucket } = readyLong()
    deps.translationTargets.mockResolvedValue(['zh'])
    const original = fakeModel()
    const requests = new Map<string, number>()
    deps.model = {
      chat: async (...args) => {
        const reply = await original.chat(...args)
        if (!args[2].systemInstruction.includes('资深译者')) return reply
        const user = (args[0][0].parts![0] as { text: string }).text
        const n = (requests.get(user) ?? 0) + 1
        requests.set(user, n)
        if (n > 1) return reply
        const items = [...user.matchAll(/^(lede|h\d+|p\d+): (.*)$/gm)].map(m => ({ id: m[1], text: m[2] }))
        return { ...reply, text: JSON.stringify({ items, glossary: [] }) }
      }
    }
    const e = cachedEngine()
    expect(await runPodcastEpisode(deps, P, e.step, 'translation-quality-repair')).toBe('ready')
    expect(articles.rows[1].status).toBe('ready')
    expect([...requests.values()]).toEqual(Array(requests.size).fill(2))
    const source = JSON.parse(bucket.objects.get(articles.rows[0].article_key!)!)
    const count = chunkTranslationUnits(translationUnits(source)).length
    expect(e.calls.filter(name => /^translate-zh-chunk-\d+-r1$/.test(name))).toHaveLength(count)
    expect(e.calls).toContain('translate-zh-assemble-r1')
    expect(e.calls.some(name => /^polish-en-chunk-\d+-r1$/.test(name))).toBe(false)
  })

  test('stops admitting calls after a cost write fails', async () => {
    const { deps, articles } = readyLong()
    const original = fakeModel()
    articles.addCost.mockRejectedValue(new Error('cost storage failed'))
    deps.model = original
    expect(await runPodcastEpisode(deps, P, engine().step, 'accounting')).toBe('retry')
    expect(original.chat.mock.calls.length).toBeLessThanOrEqual(10)
    expect(deps.publishBodies).not.toHaveBeenCalled()
    expect(articles.rows[0].error_message).toBe('cost storage failed')
  })
})

describe('podcast truncation recovery', () => {
  function ready(count = 16, text = 'The speaker explains local research and choices about education and public services.') {
    const state = setup()
    const cues = Array.from({ length: count }, (_, i) => ({
      id: `c${String(i + 1).padStart(4, '0')}`,
      start_ms: i * 10_000,
      duration_ms: 10_000,
      text: `Topic ${i}: ${text}`
    }))
    const transcript: PodcastTranscriptDocument = { schema_version: 1, source: 'publisher', language: 'en', speakers: false, duration_ms: count * 10_000, cues }
    Object.assign(state.episodes.row, { transcript_status: 'ready', transcript_hash: 'recovery-hash', transcript_key: 'recovery-transcript', language: 'en' })
    state.bucket.objects.set('recovery-transcript', JSON.stringify(transcript))
    const size = polishSize(transcript, { title: state.episodes.row.title, showName: state.episodes.row.show_name, shownotes: state.episodes.row.shownotes })
    return { ...state, cues, transcript, size, reservation: estimateCostUsd(size.inputTokens, size.outputLimit) }
  }

  const once: PodcastStepLike = { do: (_name, _config, fn) => fn(), sleep: async () => {} }
  const userOf = (args: Parameters<ArticleModel['chat']>) => (args[0][0].parts![0] as { text: string }).text
  const ownedIds = (args: Parameters<ArticleModel['chat']>) => {
    const overlap = Number(/The first (\d+) cues were cleaned/.exec(args[2].systemInstruction)?.[1] ?? 0)
    return [...userOf(args).matchAll(/^(c\d+) /gm)].map(m => m[1]).slice(overlap)
  }
  const truncated = () => ({ text: '{incomplete', finishReason: 'MAX_TOKENS', usage: { inputTokens: 100, outputTokens: 100 } })

  test('retries only a bad child part while reusing the successful child and split', async () => {
    const state = ready()
    const model = fakeModel()
    const calls = new Map<string, number>()
    let rejected = false
    let badKey = ''
    state.deps.model = {
      chat: async (...args) => {
        const ids = ownedIds(args)
        const key = ids.join(',')
        calls.set(key, (calls.get(key) ?? 0) + 1)
        if (ids.length === state.cues.length) return truncated()
        const reply = await model.chat(...args)
        if (!rejected && ids.includes(state.cues.at(-1)!.id)) {
          rejected = true
          badKey = key
          const value = JSON.parse(reply.text)
          value.sections[0].paragraphs[0].source_cue_ids.push('c9999')
          return { ...reply, text: JSON.stringify(value) }
        }
        return reply
      }
    }
    const e = engine()
    expect(await runPodcastEpisode(state.deps, P, e.step, 'part-quality-retry')).toBe('ready')
    expect(rejected).toBe(true)
    expect(calls.get(badKey)).toBe(2)
    for (const [key, n] of calls) if (key !== badKey) expect(n).toBe(1)
    expect(e.calls).not.toContain('polish-en-assemble-r1')
    for (const [key, value] of state.bucket.put.mock.calls) if (key.includes('.parts/')) expect(value).not.toContain('c9999')
    const doc = JSON.parse(state.bucket.objects.get(state.articles.rows[0].article_key!)!)
    expect(doc.sections.flatMap(s => s.paragraphs.flatMap(p => p.source_cue_ids))).toEqual(state.cues.map(c => c.id))
  })

  test('retries a hallucinated cue reference without caching or publishing it', async () => {
    const state = ready()
    const model = fakeModel()
    state.deps.model = {
      chat: async (...args) => {
        const reply = await model.chat(...args)
        const value = JSON.parse(reply.text)
        value.sections[0].paragraphs[0].source_cue_ids = ['c9999']
        return { ...reply, text: JSON.stringify(value) }
      }
    }
    expect(await runPodcastEpisode(state.deps, P, engine().step, 'hallucinated-cue')).toBe('retry')
    expect(model.chat).toHaveBeenCalledTimes(3)
    expect(state.articles.rows[0].error_message).toContain('chunk_quality:cue_reference')
    expect([...state.bucket.objects.keys()].filter(key => key.includes('/chunks/'))).toEqual([])
    expect(state.articles.publish).not.toHaveBeenCalled()
  })

  test('keeps multiple paragraphs that reference the same source cues', async () => {
    const state = ready()
    const model = fakeModel()
    state.deps.model = {
      chat: async (...args) => {
        const reply = await model.chat(...args)
        const value = JSON.parse(reply.text)
        value.sections.forEach(section => {
          section.paragraphs = section.paragraphs.flatMap(paragraph => {
            const split = paragraph.text.lastIndexOf(' ', Math.floor(paragraph.text.length / 2))
            return [
              { ...paragraph, text: paragraph.text.slice(0, split) },
              { ...paragraph, text: paragraph.text.slice(split + 1) }
            ]
          })
        })
        return { ...reply, text: JSON.stringify(value) }
      }
    }
    expect(await runPodcastEpisode(state.deps, P, once, 'shared-cue')).toBe('ready')
    const doc = JSON.parse(state.bucket.objects.get(state.articles.rows[0].article_key!)!)
    const ids = doc.sections.flatMap(section => section.paragraphs.flatMap(paragraph => paragraph.source_cue_ids))
    expect([...new Set(ids)]).toEqual(state.cues.map(cue => cue.id))
    expect(ids.length).toBeGreaterThan(state.cues.length)
  })

  test('pre-splits serialized cue metadata without changing top-level cache boundaries', async () => {
    const state = ready(260, 'Short sentence.')
    state.cues.forEach(cue => Object.assign(cue, { speaker: 'Speaker label' }))
    state.bucket.objects.set('recovery-transcript', JSON.stringify(state.transcript))
    const { planPodcastChunks, PODCAST_LIMITS } = await import('@/utils/podcastArticle')
    const { estimateTokens } = await import('@/utils/youtubeArticle')
    const chunks = planPodcastChunks(state.transcript as any)
    expect(chunks).toHaveLength(1)
    const model = fakeModel()
    state.deps.model = model
    expect(await runPodcastEpisode(state.deps, P, once, 'presplit')).toBe('ready')
    expect(model.chat.mock.calls.length).toBeGreaterThan(1)
    expect(model.chat.mock.calls.flatMap(args => ownedIds(args as any))).toEqual(state.cues.map(c => c.id))
    for (const args of model.chat.mock.calls) expect(estimateTokens(userOf(args as any))).toBeLessThanOrEqual(PODCAST_LIMITS.chunkTargetTokens)
  })

  test.each([1, 2])('recovers nested editing splits in chunk %i with exact overlap ownership and one lede', async chunkNumber => {
    const state = ready(100, 'The speaker explains local research and choices about education and public services. '.repeat(3))
    const model = fakeModel()
    const successful: Parameters<ArticleModel['chat']>[] = []
    const failed: string[][] = []
    state.deps.model = {
      chat: async (...args) => {
        const ids = ownedIds(args)
        if (args[2].systemInstruction.includes(`This is chunk ${chunkNumber} of`) && ids.length > 2) {
          failed.push(ids)
          return truncated()
        }
        successful.push(args)
        return { ...(await model.chat(...args)), usage: { inputTokens: 100, outputTokens: 100 } }
      }
    }
    expect(await runPodcastEpisode(state.deps, P, once, `nested-${chunkNumber}`)).toBe('ready')
    expect(failed.length).toBeGreaterThan(3)
    expect(new Set(failed.map(ids => ids.join(','))).size).toBe(failed.length)
    expect(successful.filter(args => args[2].systemInstruction.includes('This is the first chunk'))).toHaveLength(1)
    const doc = JSON.parse(state.bucket.objects.get(state.articles.rows[0].article_key!)!)
    expect(doc.sections.flatMap(s => s.paragraphs.flatMap(p => p.source_cue_ids))).toEqual(state.cues.map(c => c.id))
    expect(doc.lede).toBe('An episode about data centers in Brazil.')
    expect(doc.sections[0].start_ms).toBe(0)
    expect(doc.sections.at(-1).end_ms).toBe(state.transcript.duration_ms)
    expect(state.deps.addCost).toHaveBeenCalledTimes(successful.length + failed.length)
  })

  test('recovers nested translations while preserving every original unit id and cue reference', async () => {
    const state = ready(48)
    state.deps.translationTargets.mockResolvedValue(['zh'])
    const model = fakeModel()
    const translated: string[] = []
    let splits = 0
    state.deps.model = {
      chat: async (...args) => {
        if (args[2].systemInstruction.includes('资深译者')) {
          const ids = [...userOf(args).matchAll(/^(lede|h\d+|p\d+):/gm)].map(m => m[1])
          if (ids.length > 2) {
            splits++
            return truncated()
          }
          translated.push(...ids)
        }
        return { ...(await model.chat(...args)), usage: { inputTokens: 100, outputTokens: 100 } }
      }
    }
    expect(await runPodcastEpisode(state.deps, P, once, 'translation-split')).toBe('ready')
    expect(splits).toBeGreaterThan(3)
    expect(state.articles.rows[1].status).toBe('ready')
    const en = JSON.parse(state.bucket.objects.get(state.articles.rows[0].article_key!)!)
    const zh = JSON.parse(state.bucket.objects.get(state.articles.rows[1].article_key!)!)
    const { translationUnits } = await import('@/utils/podcastArticle')
    expect(translated).toEqual(translationUnits(en).map(u => u.id))
    expect(zh.sections.map(s => [s.start_ms, s.end_ms, s.paragraphs.map(p => p.source_cue_ids)])).toEqual(
      en.sections.map(s => [s.start_ms, s.end_ms, s.paragraphs.map(p => p.source_cue_ids)])
    )
  })

  test.each(['polish', 'translate'])('resumes %s children without retrying the truncated parent or completed sibling', async mode => {
    const state = ready()
    if (mode === 'translate') state.deps.translationTargets.mockResolvedValue(['zh'])
    const model = fakeModel()
    const seen: string[][] = []
    let fail = true
    let root: string[] | undefined
    state.deps.model = {
      chat: async (...args) => {
        const translation = args[2].systemInstruction.includes('资深译者')
        if (translation === (mode === 'translate')) {
          const ids = translation ? [...userOf(args).matchAll(/^(lede|h\d+|p\d+):/gm)].map(m => m[1]) : ownedIds(args)
          root ??= ids
          seen.push(ids)
          if (ids.length === root.length) return truncated()
          if (fail && ids.includes(root.at(-1)!)) throw new Error('temporary sibling failure')
        }
        return model.chat(...args)
      }
    }
    expect(await runPodcastEpisode(state.deps, P, once, 'resume-first')).toBe(mode === 'polish' ? 'retry' : 'ready')
    expect(seen).toHaveLength(3)
    const firstChild = seen[1]
    const lastChild = seen[2]
    expect(state.articles.rows.at(-1)!.status).toBe('pending')
    fail = false
    seen.length = 0
    expect(await runPodcastEpisode(state.deps, P, once, 'resume-second')).toBe('ready')
    expect(seen).toEqual([lastChild])
    expect(seen).not.toContainEqual(firstChild)
    expect(state.articles.rows.at(-1)!.status).toBe('ready')
  })

  test('reuses the old whole-chunk cache before applying a new internal plan', async () => {
    const state = ready(260, 'Short sentence.')
    const { podcastChunkKey } = await import('@/utils/podcastArticle')
    state.bucket.objects.set(
      podcastChunkKey(SOURCE, 'recovery-hash', 'en', 0),
      JSON.stringify({
        index: 0,
        lede: 'Cached introduction.',
        sections: [{ heading: 'Topic', paragraphs: state.cues.map(c => ({ speaker: null, text: c.text, source_cue_ids: [c.id] })) }],
        usage: { input_tokens: 10, output_tokens: 10, cost_usd: 0.001 }
      })
    )
    expect(await runPodcastEpisode(state.deps, P, once, 'legacy')).toBe('ready')
    expect(state.deps.model.chat).not.toHaveBeenCalled()
  })

  test('a truncated singleton is asked again, then ends the attempt as retryable and never publishes', async () => {
    const state = ready(1, 'An oversized source sentence. '.repeat(1000))
    const model = vi.fn(async () => truncated())
    state.deps.model = { chat: model }
    expect(await runPodcastEpisode(state.deps, P, once, 'singleton')).toBe('retry')
    expect(model).toHaveBeenCalledTimes(3)
    expect(state.articles.rows[0].status).toBe('pending')
    expect(state.articles.rows[0].error_message).toBe('singleton_incomplete:runaway')
    expect(state.deps.addCost).toHaveBeenCalledTimes(3)
    expect(state.deps.publishBodies).not.toHaveBeenCalled()
    expect(state.articles.publish).not.toHaveBeenCalled()
  })

  test('reserves the full requested output ceiling, including when it prevents any call', async () => {
    const state = ready()
    state.episodes.row.cost_usd = PODCAST_LIMITS.maxEpisodeCostUsd - state.reservation * 0.9
    expect(state.size.outputLimit).toBeLessThan(PODCAST_LIMITS.maxOutputTokens)
    expect(await runPodcastEpisode(state.deps, P, once, 'full-reservation')).toBe('failed')
    expect(state.articles.rows[0].error_message).toBe('budget_exceeded')
    expect(state.deps.model.chat).not.toHaveBeenCalled()
    expect(state.deps.addCost).not.toHaveBeenCalled()
  })

  test('charges a full truncated response before admitting its children', async () => {
    const state = ready()
    state.episodes.row.cost_usd = PODCAST_LIMITS.maxEpisodeCostUsd - state.reservation * 1.1
    const model = vi.fn(async (...args: Parameters<ArticleModel['chat']>) => {
      const size = sizeOf(args)
      expect(args[1].maxOutputTokens).toBe(size.outputLimit)
      return { ...truncated(), usage: { inputTokens: size.inputTokens, outputTokens: size.outputLimit } }
    })
    state.deps.model = { chat: model }
    expect(await runPodcastEpisode(state.deps, P, once, 'split-budget')).toBe('failed')
    expect(model).toHaveBeenCalledOnce()
    expect(state.articles.rows[0].cost_usd).toBeCloseTo(state.reservation, 8)
    expect(state.deps.addCost).toHaveBeenCalledWith(state.reservation)
    expect(state.articles.rows[0].error_message).toBe('budget_exceeded')
    expect(state.deps.publishBodies).not.toHaveBeenCalled()
  })

  test('renews the lease between recovery calls and stops before a child on ownership loss', async () => {
    const state = ready()
    const model = vi.fn(async () => {
      state.articles.renewLease.mockResolvedValue(false)
      return truncated()
    })
    state.deps.model = { chat: model }
    expect(await runPodcastEpisode(state.deps, P, once, 'lease')).toBe('gone')
    expect(model).toHaveBeenCalledOnce()
    expect(state.deps.publishBodies).not.toHaveBeenCalled()
  })

  test('stops recovery when the attempt deadline expires without starting children', async () => {
    const state = ready()
    let now = 1_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const model = vi.fn(async () => {
      now += 11 * 60_000
      return truncated()
    })
    state.deps.model = { chat: model }
    try {
      expect(await runPodcastEpisode(state.deps, P, engine().step, 'deadline')).toBe('failed')
      expect(model).toHaveBeenCalledOnce()
      expect(state.articles.rows[0].error_message).toBe('chunk_deadline')
      expect(state.deps.publishBodies).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
    }
  })

  test.each([400, 401, 403, 429, 500, 502, 503])('does not bill or split a rejected HTTP %i model request', async status => {
    const state = ready()
    const rejected = Object.assign(new Error(`provider rejected ${status}`), { status })
    const model = vi.fn(async () => {
      throw rejected
    })
    state.deps.model = { chat: model }
    expect(await runPodcastEpisode(state.deps, P, engine().step, `reject-${status}`)).toBe('retry')
    expect(model).toHaveBeenCalledTimes(3)
    expect(state.articles.rows[0].cost_usd).toBe(0)
    expect(state.articles.rows[0].error_message).toBe(rejected.message)
    expect(state.articles.addCost).not.toHaveBeenCalled()
    expect(state.deps.addCost).not.toHaveBeenCalled()
    expect([...state.bucket.objects.keys()].filter(key => key.includes('/chunks/'))).toEqual([])
    expect(state.articles.publish).not.toHaveBeenCalled()
  })

  test('recognizes wrapped Vertex rejections and definite preconnection failures without billing', async () => {
    const { AIProviderError } = await import('@/infra/external/vertexAIClient')
    for (const error of [
      new AIProviderError('wrapped rate limit', { providerStatus: 429, timedOut: false }),
      new AIProviderError('wrapped unavailable', { providerStatus: 503, timedOut: false }),
      Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('DNS resolution failed'), { code: 'ENOTFOUND' })
    ]) {
      const state = ready()
      state.deps.model = {
        chat: async () => {
          throw error
        }
      }
      expect(await runPodcastEpisode(state.deps, P, once, 'definite-rejection')).toBe('retry')
      expect(state.articles.rows[0].cost_usd).toBe(0)
      expect(state.deps.addCost).not.toHaveBeenCalled()
    }
  })

  test.each(['polish', 'translate'])('persists an aborted %s parent split and reuses children on the next attempt', async mode => {
    const state = ready()
    if (mode === 'translate') state.deps.translationTargets.mockResolvedValue(['zh'])
    const model = fakeModel()
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => nativeTimeout(10))
    const seen: string[][] = []
    let root: string[] | undefined
    let fail = true,
      aborted = 0,
      expectedCost = 0
    state.deps.model = {
      chat: async (...args) => {
        const translation = args[2].systemInstruction.includes('资深译者')
        const target = translation === (mode === 'translate')
        if (target) {
          const ids = translation ? [...userOf(args).matchAll(/^(lede|h\d+|p\d+):/gm)].map(m => m[1]) : ownedIds(args)
          root ??= ids
          seen.push(ids)
          if (ids.length === root.length) {
            expectedCost += reservationOf(args)
            expect(args[1].maxOutputTokens).toBe(sizeOf(args).outputLimit)
            await new Promise<void>((_resolve, reject) =>
              args[1].abortSignal!.addEventListener(
                'abort',
                () => {
                  aborted++
                  reject(new DOMException('Generation aborted', 'AbortError'))
                },
                { once: true }
              )
            )
          }
          if (fail && ids.includes(root.at(-1)!)) throw Object.assign(new Error('temporary unavailable'), { status: 503 })
        }
        const reply = await model.chat(...args)
        if (target) expectedCost += estimateCostUsd(reply.usage.inputTokens, reply.usage.outputTokens)
        return reply
      }
    }
    try {
      expect(await runPodcastEpisode(state.deps, P, once, 'timeout-first')).toBe(mode === 'polish' ? 'retry' : 'ready')
      expect(aborted).toBe(1)
      expect(seen).toHaveLength(3)
      const retryIds = seen[2]
      expect(state.articles.rows.at(-1)!.cost_usd).toBeCloseTo(expectedCost, 8)
      expect(state.articles.rows.at(-1)!.status).toBe('pending')
      fail = false
      seen.length = 0
      expect(await runPodcastEpisode(state.deps, P, once, 'timeout-second')).toBe('ready')
      expect(seen).toEqual([retryIds])
      expect(aborted).toBe(1)
      expect(state.articles.rows.at(-1)!.status).toBe('ready')
      const doc = JSON.parse(state.bucket.objects.get(state.articles.rows.at(-1)!.article_key!)!)
      expect(doc.sections.flatMap(s => s.paragraphs.flatMap(p => p.source_cue_ids))).toEqual(state.cues.map(c => c.id))
    } finally {
      timeout.mockRestore()
    }
  })

  test.each([false, true])('owner retries regenerate only failed singletons and preserve known splits (legacy marker: %s)', async legacy => {
    const state = ready(4)
    const model = fakeModel()
    const seen: string[][] = []
    let fail = true
    state.deps.model = {
      chat: async (...args) => {
        const ids = ownedIds(args)
        seen.push(ids)
        if (ids.length === 4 || (ids.length === 2 && ids[0] === 'c0003') || (fail && ids[0] === 'c0003')) return truncated()
        return model.chat(...args)
      }
    }
    expect(await runPodcastEpisode(state.deps, P, once, 'singleton-first')).toBe('retry')
    expect(state.articles.rows[0].error_message).toBe('singleton_incomplete:runaway')
    const savedCost = state.articles.rows[0].cost_usd
    const singletonKey = state.bucket.get.mock.calls.find(([key]) => key.includes('.parts/2-3-'))![0]
    expect(state.bucket.objects.has(singletonKey)).toBe(false)
    if (legacy) state.bucket.objects.set(singletonKey, JSON.stringify({ kind: 'split', at: null, usage: { input_tokens: 100, output_tokens: 100, cost_usd: 0.00035 } }))
    state.articles.rows[0].status = 'pending'
    fail = false
    seen.length = 0
    expect(await runPodcastEpisode(state.deps, P, engine().step, 'owner-retry')).toBe('ready')
    expect(seen).toEqual([['c0003'], ['c0004']])
    expect(state.articles.rows[0].cost_usd).toBeGreaterThan(savedCost)
  })

  test('a stalled singleton aborts, is asked again, and ends the attempt as retryable', async () => {
    const state = ready(1)
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => nativeTimeout(10))
    let aborted = false
    state.deps.model = {
      chat: async (_contents, config) => {
        if (!config.abortSignal) throw new Error('missing abort signal')
        await new Promise<void>((_resolve, reject) => {
          config.abortSignal!.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(new Error('aborted'))
            },
            { once: true }
          )
        })
        throw new Error('unreachable')
      }
    }
    try {
      expect(await runPodcastEpisode(state.deps, P, once, 'abort')).toBe('retry')
      expect(aborted).toBe(true)
      expect(state.articles.rows[0].error_message).toBe('singleton_incomplete:stall')
      expect(state.articles.rows[0].cost_usd).toBeCloseTo(PODCAST_LIMITS.singletonTries * state.reservation, 8)
      expect(state.deps.addCost).toHaveBeenCalledTimes(3)
      expect(state.deps.publishBodies).not.toHaveBeenCalled()
      expect([...state.bucket.objects.keys()].filter(key => key.includes('/chunks/'))).toEqual([])
      state.articles.rows[0].status = 'pending'
      const model = fakeModel()
      state.deps.model = model
      expect(await runPodcastEpisode(state.deps, P, once, 'timeout-owner-retry')).toBe('ready')
      expect(model.chat).toHaveBeenCalledOnce()
    } finally {
      timeout.mockRestore()
    }
  })

  test('keeps concurrent recursive calls within ten and publishes only complete results', async () => {
    const state = ready(480, 'The speaker explains local research and choices about education and public services. '.repeat(3))
    expect(planPodcastChunks(state.transcript).length).toBeGreaterThan(10)
    const model = fakeModel()
    let active = 0,
      maximum = 0,
      splits = 0
    state.deps.model = {
      chat: async (...args) => {
        maximum = Math.max(maximum, ++active)
        try {
          await new Promise(resolve => setTimeout(resolve, 2))
          expect(state.articles.publish).not.toHaveBeenCalled()
          if (ownedIds(args).length > 6) {
            splits++
            return truncated()
          }
          return { ...(await model.chat(...args)), usage: { inputTokens: 100, outputTokens: 100 } }
        } finally {
          active--
        }
      }
    }
    expect(await runPodcastEpisode(state.deps, P, once, 'concurrent-splits')).toBe('ready')
    expect(maximum).toBeGreaterThan(1)
    expect(maximum).toBeLessThanOrEqual(10)
    expect(active).toBe(0)
    expect(splits).toBeGreaterThan(10)
    const doc = JSON.parse(state.bucket.objects.get(state.articles.rows[0].article_key!)!)
    expect(doc.sections.flatMap(s => s.paragraphs.flatMap(p => p.source_cue_ids))).toEqual(state.cues.map(c => c.id))
    expect(state.deps.addCost).toHaveBeenCalledTimes(model.chat.mock.calls.length + splits)
  })

  test('pre-splits translation requests from the escaped serialized input, preserving unit ids', async () => {
    const state = ready(72, 'The speaker says \"hello\" about local choices. '.repeat(3))
    state.deps.translationTargets.mockResolvedValue(['zh'])
    state.episodes.row.title = 'Episode '.repeat(3000)
    const model = fakeModel()
    state.deps.model = { chat: async (...args) => ({ ...(await model.chat(...args)), usage: { inputTokens: 100, outputTokens: 100 } }) }
    expect(await runPodcastEpisode(state.deps, P, once, 'translation-presplit')).toBe('ready')
    expect(state.articles.rows[1].status).toBe('ready')
    const en = JSON.parse(state.bucket.objects.get(state.articles.rows[0].article_key!)!)
    const { chunkTranslationUnits, translationUnits } = await import('@/utils/podcastArticle')
    const units = translationUnits(en)
    const calls = model.chat.mock.calls.filter(args => args[2].systemInstruction.includes('资深译者'))
    expect(calls.length).toBeGreaterThan(chunkTranslationUnits(units).length)
    expect(calls.flatMap(args => [...userOf(args as any).matchAll(/^(lede|h\d+|p\d+):/gm)].map(m => m[1])).sort()).toEqual(units.map(u => u.id).sort())
    const zh = JSON.parse(state.bucket.objects.get(state.articles.rows[1].article_key!)!)
    expect(zh.sections.map(s => s.paragraphs.map(p => p.source_cue_ids))).toEqual(en.sections.map(s => s.paragraphs.map(p => p.source_cue_ids)))
  })

  test('part cache keys include source content, not just indices or split paths', async () => {
    const state = ready()
    const model = fakeModel()
    let fail = true
    let leftCalls = 0
    state.deps.model = {
      chat: async (...args) => {
        const ids = ownedIds(args)
        if (ids.length === state.cues.length) return truncated()
        if (ids[0] === state.cues[0].id) leftCalls++
        if (fail && ids.includes(state.cues.at(-1)!.id)) throw new Error('sibling unavailable')
        return model.chat(...args)
      }
    }
    expect(await runPodcastEpisode(state.deps, P, once, 'hash-first')).toBe('retry')
    expect(leftCalls).toBe(1)
    state.cues[0].text = state.cues[0].text.replace('speaker', 'reader')
    state.bucket.objects.set('recovery-transcript', JSON.stringify(state.transcript))
    fail = false
    expect(await runPodcastEpisode(state.deps, P, once, 'hash-second')).toBe('ready')
    expect(leftCalls).toBe(2)
    const doc = JSON.parse(state.bucket.objects.get(state.articles.rows[0].article_key!)!)
    expect(doc.sections[0].paragraphs[0].text).toContain('reader')
  })

  test('bounds total provider calls without an arbitrary shallow recursion limit', async () => {
    const state = ready(128, 'Short sentence.')
    const model = fakeModel()
    const calls = vi.fn(async (...args: Parameters<ArticleModel['chat']>) =>
      ownedIds(args).length > 1 ? truncated() : { ...(await model.chat(...args)), usage: { inputTokens: 100, outputTokens: 100 } }
    )
    state.deps.model = { chat: calls }
    const { PODCAST_LIMITS } = await import('@/utils/podcastArticle')
    expect(await runPodcastEpisode(state.deps, P, engine().step, 'call-limit')).toBe('failed')
    expect(calls).toHaveBeenCalledTimes(PODCAST_LIMITS.maxChunkCalls)
    expect(state.articles.rows[0].error_message).toBe('chunk_call_limit')
    expect(state.articles.publish).not.toHaveBeenCalled()
    expect(model.chat.mock.calls.length).toBeGreaterThan(4)
  })

  test('does not undercount truncation when provider usage is absent', async () => {
    const state = ready(1)
    state.deps.model = { chat: async () => ({ text: 'tiny truncated output', finishReason: 'MAX_TOKENS' }) }
    expect(await runPodcastEpisode(state.deps, P, once, 'missing-usage')).toBe('retry')
    expect(state.articles.rows[0].error_message).toBe('singleton_incomplete:runaway')
    expect(state.articles.rows[0].cost_usd).toBeCloseTo(PODCAST_LIMITS.singletonTries * state.reservation, 8)
    expect(state.deps.addCost).toHaveBeenCalledTimes(3)
  })

  test('keeps lost connection usage conservative without treating it as a generation timeout', async () => {
    const state = ready()
    const error = Object.assign(new Error('connection reset after request'), { code: 'ECONNRESET' })
    state.deps.model = {
      chat: async () => {
        throw error
      }
    }
    expect(await runPodcastEpisode(state.deps, P, once, 'unknown-usage')).toBe('retry')
    expect(state.articles.rows[0].cost_usd).toBeCloseTo(state.reservation, 8)
    expect(state.articles.rows[0].error_message).toBe(error.message)
    expect(state.deps.addCost).toHaveBeenCalledExactlyOnceWith(state.reservation)
    expect([...state.bucket.objects.keys()].filter(key => key.includes('/chunks/'))).toEqual([])
  })

  test.each(['deadline', 'budget'])('timeout recovery never starts children after the %s is exhausted', async boundary => {
    const state = ready()
    if (boundary === 'budget') state.episodes.row.cost_usd = PODCAST_LIMITS.maxEpisodeCostUsd - state.reservation * 1.1
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => nativeTimeout(10))
    let now = 1_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const model = vi.fn(async (_contents, config) => {
      await new Promise<void>((_resolve, reject) =>
        config.abortSignal.addEventListener(
          'abort',
          () => {
            if (boundary === 'deadline') now += 11 * 60_000
            reject(new DOMException('aborted', 'AbortError'))
          },
          { once: true }
        )
      )
      throw new Error('unreachable')
    })
    state.deps.model = { chat: model }
    try {
      expect(await runPodcastEpisode(state.deps, P, engine().step, `timeout-${boundary}`)).toBe('failed')
      expect(model).toHaveBeenCalledOnce()
      expect(state.articles.rows[0].error_message).toBe(boundary === 'deadline' ? 'chunk_deadline' : 'budget_exceeded')
      expect(state.deps.addCost).toHaveBeenCalledOnce()
      expect(state.articles.publish).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
      timeout.mockRestore()
    }
  })

  test('uses reported usage when a complete provider response arrives after its abort signal', async () => {
    const state = ready()
    const model = fakeModel()
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => nativeTimeout(10))
    let late = 0
    state.deps.model = {
      chat: async (...args) => {
        if (ownedIds(args).length === state.cues.length) {
          await new Promise<void>(resolve => args[1].abortSignal!.addEventListener('abort', () => resolve(), { once: true }))
          late++
        }
        return { ...(await model.chat(...args)), usage: { inputTokens: 100, outputTokens: 100 } }
      }
    }
    try {
      expect(await runPodcastEpisode(state.deps, P, once, 'known-late-usage')).toBe('ready')
      expect(late).toBe(1)
      expect(model.chat).toHaveBeenCalledTimes(3)
      expect(state.articles.rows[0].cost_usd).toBeCloseTo(0.00105, 6)
    } finally {
      timeout.mockRestore()
    }
  })

  test.each(['episode', 'daily'])('closes recovery admission when %s accounting fails', async ledger => {
    const state = ready()
    const calls = vi.fn(async () => truncated())
    state.deps.model = { chat: calls }
    if (ledger === 'episode') state.articles.addCost.mockRejectedValue(new Error('accounting unavailable'))
    else state.deps.addCost.mockRejectedValue(new Error('accounting unavailable'))
    expect(await runPodcastEpisode(state.deps, P, engine().step, 'accounting-failure')).toBe('retry')
    expect(calls).toHaveBeenCalledOnce()
    expect(state.articles.rows[0].error_message).toBe('accounting unavailable')
    expect(state.articles.publish).not.toHaveBeenCalled()
    expect([...state.bucket.objects.keys()].filter(key => key.includes('/chunks/'))).toEqual([])
  })
})
