/** Disposable PostgreSQL and HTTP provider exercise. Provider text is controlled, not a live-model quality result. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/hyperdrive-client'
import { LocalResources } from './localResources'
import { PodcastEpisodeRepo, PodcastArticleRepo } from '../../src/infra/repository/dbPodcastArticle'
import { YoutubeArticleRepo, YOUTUBE_ARTICLE_PROMPT_VERSION } from '../../src/infra/repository/dbYoutubeArticle'
import { DeepSeekClient } from '../../src/infra/external/deepseekClient'
import { runPodcastEpisode, type PodcastStepLike, type PodcastRunnerDeps } from '../../src/domain/podcastRunner'
import { runYoutubeArticle, type RunnerDeps } from '../../src/domain/youtubeArticleRunner'
import { planYoutubeArticle } from '../../src/utils/youtubeArticle'
import { evaluateYoutubeEligibility } from '../../src/utils/youtubeEligibility'
import { planPodcastChunks } from '../../src/utils/podcastArticle'
import type { YoutubeCaptionDocument } from '../../src/utils/youtubeCaption'
import type { PodcastEpisodeInfo } from '../../src/utils/podcastSource'

const resources = new LocalResources()
if (process.env.DOCKER_HOST) {
  assert.ok(process.env.DOCKER_HOST.startsWith('unix://'), 'Only a local Docker socket is allowed')
  resources.env.DOCKER_HOST = process.env.DOCKER_HOST
}
const results: Record<string, unknown> = {}
const objects = new Map<string, string>()
const bucket = {
  get: async (key: string) => (objects.has(key) ? { text: async () => objects.get(key)! } : null),
  put: async (key: string, value: string) => {
    objects.set(key, value)
  },
  head: async (key: string) => (objects.has(key) ? { key } : null),
  delete: async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
  },
  list: async ({ prefix }: { prefix: string }) => ({ objects: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false })
} as unknown as RunnerDeps['bucket']
const step: PodcastStepLike = { do: (_name, _config, fn) => fn(), sleep: async () => {} }
const cues = Array.from({ length: 2000 }, (_, index) => ({
  id: `c${String(index + 1).padStart(4, '0')}`,
  start_ms: index * 5970,
  duration_ms: 5970,
  text:
    `Example ${index}. ` +
    'Engineering teams measure the airflow and motor efficiency before adjusting their prototype. The interview explains how repeated experiments improved manufacturing and product reliability. '.repeat(
      4
    )
}))
let calls = 0,
  active = 0,
  peak = 0,
  counted = 0
const server = createServer(async (req, res) => {
  try {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    assert.equal(body.model, 'deepseek-flash')
    const system: string = body.messages[0].content
    const user: string = body.messages[1].content
    calls++
    peak = Math.max(peak, ++active)
    await new Promise(resolve => setTimeout(resolve, 5))
    let output: unknown
    if (system.startsWith('Write a factual')) output = { lede: 'The interview discusses engineering experiments and product development.' }
    else if (user.startsWith('{')) {
      output = Object.fromEntries(
        Object.entries(JSON.parse(user.split('\nPrevious source context')[0]) as Record<string, { text: string }>).map(([key, value]) => [key, { text: value.text, heading: '' }])
      )
    } else {
      const overlap = Number(/The first (\d+) cues were cleaned/.exec(system)?.[1] ?? 0)
      const entries = [...user.matchAll(/^(c\d+) \[[^\]]+\](?: \(([^)]+)\))? (.*)$/gm)].slice(overlap)
      const paragraphs = []
      for (let i = 0; i < entries.length; i += 3) {
        const group = entries.slice(i, i + 3)
        paragraphs.push({ speaker: null, text: group.map(item => item[3]).join(' '), source_cue_ids: group.map(item => item[1]) })
      }
      output = {
        lede: system.includes('This is the first chunk') ? 'The interview discusses engineering experiments and product development.' : '',
        sections: [{ heading: 'Engineering experiments', paragraphs }]
      }
    }
    active--
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 3000, completion_tokens: 2500 } }))
  } catch (error) {
    res.statusCode = 500
    res.end(String(error))
  }
})
const nativeFetch = globalThis.fetch
let pg: PrismaClient | undefined
async function main() {
  try {
    const container = await resources.container('postgres:17-alpine')
    resources.sql(container.id, 'postgres', 'CREATE DATABASE media_caps;')
    const url = `postgresql://postgres@127.0.0.1:${container.port}/media_caps`
    assert.equal(await resources.migrate('media-caps-migrations', url, 'pgsql'), 0)
    assert.equal(
      await resources.run(
        'media-repositories',
        'pnpm',
        ['exec', 'vitest', 'run', '--config', 'vitest.config.ts', 'test/infra/youtubeArticleRepo.integration.test.ts', 'test/infra/podcastRepo.integration.test.ts'],
        { RUN_PG_INTEGRATION_TESTS: '1', HYPERDRIVE_DATABASE_URL: url }
      ),
      0
    )
    results.repositoryTests = 'passed'
    pg = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    const episodes = new PodcastEpisodeRepo(() => pg!)
    const articles = new PodcastArticleRepo(() => pg!)
    const youtube = new YoutubeArticleRepo(() => pg!)
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const port = (server.address() as { port: number }).port
    globalThis.fetch = (input, init) => {
      assert.equal(String(input), 'https://api.deepseek.com/chat/completions')
      return nativeFetch(`http://127.0.0.1:${port}/chat/completions`, init)
    }
    const model = new DeepSeekClient({ DEEPSEEK_API_KEY: 'local-fixture-only' } as Env)
    const sourceId = 'caps-smoke-podcast'
    const info: PodcastEpisodeInfo = {
      kind: 'feed',
      pageUrl: 'https://example.test/episode',
      audioUrl: 'https://example.test/audio.m4a',
      embedUrl: '',
      title: 'Engineering interview',
      showName: 'Smoke',
      author: '',
      coverUrl: '',
      durationSec: 11940,
      language: 'en',
      languageTag: 'en',
      shownotes: '',
      publishedAt: null,
      transcripts: []
    }
    const episode = await episodes.upsertFromInfo(sourceId, info)
    await pg.sr_podcast_episode.update({ where: { id: episode.id }, data: { cost_usd: 10 } })
    let publications = 0,
      submits = 0
    const podcastDeps: PodcastRunnerDeps = {
      episodes,
      articles,
      bucket,
      model,
      asr: {
        submit: async () => {
          submits++
          return 'controlled-asr-job'
        },
        get: async () => ({
          status: 'completed',
          language: 'en',
          durationSec: 11940,
          costUsd: 2,
          segments: cues.map(c => ({ start_ms: c.start_ms, end_ms: c.start_ms + c.duration_ms, text: c.text, speaker: null }))
        })
      },
      fetchTranscript: async () => {
        throw new Error('Unexpected publisher request')
      },
      moderate: async () => 0,
      flagBookmarks: async () => 0,
      publishBodies: async () => ++publications,
      settleSnapshots: async () => 0,
      processVectorMaintenance: async () => {},
      setRefsHash: async () => 0,
      translationTargets: async () => [],
      addCost: async usd => {
        counted += usd
      }
    }
    const start = performance.now()
    assert.equal(await runPodcastEpisode(podcastDeps, { episodeId: episode.id, sourceId, trigger: 'crawl' }, step, 'podcast-smoke'), 'ready')
    const savedEpisode = await episodes.findById(episode.id)
    const transcript = JSON.parse(objects.get(savedEpisode!.transcript_key!)!)
    const chunkCount = planPodcastChunks(transcript).length
    assert.ok(chunkCount > 80)
    assert.equal(savedEpisode!.cost_usd, 12)
    assert.equal(submits, 1)
    assert.equal(publications, 1)
    const article = (await articles.listForSource(sourceId, savedEpisode!.transcript_hash!))[0]
    assert.equal(article.status, 'ready')
    const doc = JSON.parse(objects.get(article.article_key!)!)
    assert.deepEqual(
      doc.sections.flatMap((s: any) => s.paragraphs.flatMap((p: any) => p.source_cue_ids)),
      transcript.cues.map((c: { id: string }) => c.id)
    )
    assert.equal(doc.sections.flatMap((s: any) => s.paragraphs.map((p: any) => p.text)).join(' '), transcript.cues.map((c: { text: string }) => c.text).join(' '))
    results.podcast = {
      durationSec: 11940,
      chunks: chunkCount,
      calls,
      peak,
      elapsedMs: Math.round(performance.now() - start),
      priorCostUsd: 10,
      episodeCostUsd: savedEpisode!.cost_usd,
      articleCostUsd: article.cost_usd,
      status: article.status
    }
    assert.ok(peak <= 10)
    calls = active = peak = 0
    const caption: YoutubeCaptionDocument = {
      schema_version: 1,
      video_id: 'dQw4w9WgXcQ',
      source_hash: 'caps-source',
      language: 'en',
      language_name: 'English',
      kind: 'manual',
      cues: cues.map((c, index) => ({ ...c, start_ms: index * 15000 }))
    } as YoutubeCaptionDocument
    const eligibility = evaluateYoutubeEligibility({ title: info.title, language: 'en', kind: 'manual', cues: caption.cues, plainText: caption.cues.map(c => c.text).join(' ') })
    assert.equal(eligibility.decision, 'generate')
    assert.ok(!eligibility.reason_codes.includes('very_long_video'))
    const plan = planYoutubeArticle(caption)
    assert.ok(plan.ok)
    assert.ok(plan.plan.chunks.length > 40 && plan.plan.inputChars > 400000 && plan.plan.durationMs > 6 * 3600000)
    objects.set('caption.json', JSON.stringify(caption))
    const row = await youtube.recordEvaluation({
      source_id: caption.video_id,
      source_hash: caption.source_hash,
      target_language: 'en',
      caption_key: 'caption.json',
      caption_text_key: null,
      caption_language: 'en',
      caption_kind: 'manual',
      schema_version: 1,
      prompt_version: YOUTUBE_ARTICLE_PROMPT_VERSION,
      status: 'pending',
      eligibility
    })
    await pg.sr_media_article.update({ where: { id: row.id }, data: { cost_usd: 10, lifetime_cost_usd: 20 } })
    const youtubeStart = performance.now()
    const youtubeDeps: RunnerDeps = {
      repo: youtube,
      bucket,
      model,
      addCost: async usd => {
        counted += usd
      },
      publishBodies: async () => 1,
      indexBodies: async () => 1,
      settleSnapshots: async () => 0,
      processVectorMaintenance: async () => {}
    }
    assert.equal(
      await runYoutubeArticle(
        youtubeDeps,
        { articleId: row.id, videoId: row.source_id, sourceHash: row.source_hash, targetLanguage: 'en', promptVersion: row.prompt_version, title: info.title, trigger: 'crawl' },
        step,
        'youtube-smoke'
      ),
      'ready'
    )
    const saved = await youtube.findById(row.id)
    assert.equal(saved!.status, 'ready')
    assert.ok(saved!.cost_usd > 10 && saved!.lifetime_cost_usd > 20)
    const youtubeDoc = JSON.parse(objects.get(saved!.article_key!)!)
    assert.deepEqual(
      youtubeDoc.sections.flatMap((s: any) => s.paragraphs.flatMap((p: any) => p.source_cue_ids)),
      cues.map(c => c.id)
    )
    assert.ok(peak <= 5)
    results.youtube = {
      durationMs: plan.plan.durationMs,
      inputChars: plan.plan.inputChars,
      chunks: plan.plan.chunks.length,
      calls,
      peak,
      elapsedMs: Math.round(performance.now() - youtubeStart),
      costUsd: saved!.cost_usd,
      lifetimeCostUsd: saved!.lifetime_cost_usd,
      status: saved!.status
    }
    results.accountedUsd = counted
  } finally {
    globalThis.fetch = nativeFetch
    await new Promise<void>(done => server.close(() => done()))
    await pg?.$disconnect()
    resources.cleanup()
    writeFileSync(resolve(resources.workspace, 'media-caps-results.json'), JSON.stringify(results, null, 2))
    console.log(JSON.stringify(results, null, 2))
  }
}
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
