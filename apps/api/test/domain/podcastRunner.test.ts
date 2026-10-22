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
import { parseVtt } from '@/utils/podcastTranscript'

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
    translationTargets: vi.fn(async () => o.targets ?? []),
    addCost: vi.fn(async () => {})
  }
  return { deps: deps as unknown as PodcastRunnerDeps & typeof deps, episodes, articles, bucket }
}

const VTT_REF = [{ url: 'https://feeds.example.com/t.vtt', type: 'text/vtt', language: 'en' }]
const words = parseVtt(VTT).map(s => ({ start_ms: s.start_ms, end_ms: s.end_ms, text: s.text, speaker: s.speaker === 'SPEAKER_02' ? 'A' : 'B' }))

describe('publisher transcript path', () => {
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

  test('another run holds the episode → not_claimed', async () => {
    const { deps } = setup({ episode: { transcript_status: 'transcribing', run_id: 'other' } })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('not_claimed')
  })

  test('a summary instead of a cleanup fails quality: no body, chunks dropped', async () => {
    const { deps, articles, bucket } = setup({ episode: { publisher_transcripts: VTT_REF }, model: fakeModel({ summarize: true }) })
    expect(await runPodcastEpisode(deps, P, engine().step, 'run-1')).toBe('failed')
    expect(articles.rows[0].error_message).toMatch(/^quality:.*length_ratio/)
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
