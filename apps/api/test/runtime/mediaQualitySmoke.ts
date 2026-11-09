/** Exercise real repositories and runners with PostgreSQL and a controlled HTTP model. No paid providers. */
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
import { evaluateYoutubeEligibility } from '../../src/utils/youtubeEligibility'
import type { PodcastEpisodeInfo } from '../../src/utils/podcastSource'

const resources = new LocalResources()
if (process.env.DOCKER_HOST) {
  assert.ok(process.env.DOCKER_HOST.startsWith('unix://'), 'Only a local Docker socket is allowed')
  resources.env.DOCKER_HOST = process.env.DOCKER_HOST
}
const results: object[] = []
const objects = new Map<string, string>()
let mode = 'nonempty',
  calls = 0,
  publications = 0
const bodyText = 'Changed wording 999. This is not Chinese.'
const bucket = {
  get: async (key: string) => (objects.has(key) ? { text: async () => objects.get(key)! } : null),
  put: async (key: string, value: string) => {
    objects.set(key, value)
  },
  head: async (key: string) => (mode === 'missing-write' && key.includes('/articles/') ? null : objects.has(key) ? { key } : null),
  delete: async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
  },
  list: async ({ prefix }: { prefix: string }) => ({ objects: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false })
} as unknown as RunnerDeps['bucket']
const step: PodcastStepLike = { do: (_name, _config, fn) => fn(), sleep: async () => {} }
const cues = Array.from({ length: 12 }, (_, i) => ({
  id: `c${String(i + 1).padStart(4, '0')}`,
  start_ms: i * 60000,
  duration_ms: 60000,
  text: `我们讨论第 ${i + 1} 个例子和 50000 元、2023 年、40 人、35%、12 个月。`
}))
const server = createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const request = JSON.parse(raw)
  assert.equal(request.model, 'deepseek-flash')
  const system: string = request.messages[0].content
  const user: string = request.messages[1].content
  calls++
  if (mode === 'http') {
    res.statusCode = 503
    res.end('{}')
    return
  }
  const text = mode === 'empty' ? '' : bodyText
  let output: unknown
  if (system.startsWith('Write a factual')) output = { lede: text }
  else if (user.startsWith('{')) output = Object.fromEntries(Object.keys(JSON.parse(user.split('\nPrevious source context')[0])).map(key => [key, { text, heading: 'Heading' }]))
  else if (/^(lede|h\d+|p\d+): /m.test(user)) output = { items: [...user.matchAll(/^(lede|h\d+|p\d+): /gm)].map(m => ({ id: m[1], text })), glossary: [] }
  else
    output = {
      lede: text,
      sections: [{ heading: 'Heading', paragraphs: [...user.matchAll(/^(c\d+) /gm)].map(m => ({ text, speaker: 'Model speaker', source_cue_ids: [m[1]] })) }]
    }
  res.setHeader('Content-Type', 'application/json')
  res.end(
    JSON.stringify({
      choices: [{ message: { content: mode === 'malformed' ? 'not json' : JSON.stringify(output) }, finish_reason: mode === 'truncated' ? 'length' : 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 100 }
    })
  )
})
const nativeFetch = globalThis.fetch
let pg: PrismaClient | undefined
async function main() {
  try {
    const container = await resources.container('postgres:17-alpine')
    resources.sql(container.id, 'postgres', 'CREATE DATABASE media_quality;')
    const url = `postgresql://postgres@127.0.0.1:${container.port}/media_quality`
    assert.equal(await resources.migrate('media-quality-migrations', url, 'pgsql'), 0)
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
    for (const scenario of ['nonempty', 'empty', 'malformed', 'http', 'truncated', 'missing-write']) {
      for (const kind of ['podcast', 'youtube']) {
        mode = scenario
        calls = 0
        publications = 0
        const sourceId = `${kind}-${scenario}`
        const publish = async () => ++publications
        let outcome: string, rows: Array<{ status: string; article_key: string | null }>
        const started = performance.now()
        if (kind === 'podcast') {
          const info: PodcastEpisodeInfo = {
            kind: 'feed',
            pageUrl: 'https://example.test/episode',
            audioUrl: 'https://example.test/audio.m4a',
            embedUrl: '',
            title: 'Interview',
            showName: 'Smoke',
            author: '',
            coverUrl: '',
            durationSec: 11940,
            language: 'zh',
            languageTag: 'zh',
            shownotes: '',
            publishedAt: null,
            transcripts: []
          }
          const episode = await episodes.upsertFromInfo(sourceId, info)
          const deps: PodcastRunnerDeps = {
            episodes,
            articles,
            bucket,
            model,
            asr: {
              submit: async () => 'controlled-job',
              get: async () => ({
                status: 'completed',
                language: 'zh',
                durationSec: 11940,
                costUsd: 0,
                segments: cues.map(c => ({ start_ms: c.start_ms, end_ms: c.start_ms + c.duration_ms, text: c.text, speaker: null }))
              })
            },
            fetchTranscript: async () => {
              throw new Error('Unexpected transcript request')
            },
            moderate: async () => 0,
            flagBookmarks: async () => 0,
            publishBodies: publish,
            settleSnapshots: async () => 0,
            processVectorMaintenance: async () => {},
            setRefsHash: async () => 0,
            translationTargets: async () => ['en'],
            addCost: async () => {}
          }
          outcome = await runPodcastEpisode(deps, { episodeId: episode.id, sourceId, trigger: 'crawl' }, step, sourceId)
          const saved = await episodes.findById(episode.id)
          rows = await articles.listForSource(sourceId, saved!.transcript_hash!)
        } else {
          const caption = { schema_version: 1, video_id: sourceId, source_hash: 'source', language: 'fr', language_name: 'French', kind: 'manual', cues }
          const key = sourceId + '.json'
          objects.set(key, JSON.stringify(caption))
          const eligibility = evaluateYoutubeEligibility({ title: '4K walking tour vlog', language: 'fr', kind: 'manual', cues, plainText: cues.map(c => c.text).join(' ') })
          assert.equal(eligibility.decision, 'generate')
          const row = await youtube.recordEvaluation({
            source_id: sourceId,
            source_hash: 'source',
            target_language: 'zh',
            caption_key: key,
            caption_text_key: null,
            caption_language: 'fr',
            caption_kind: 'manual',
            schema_version: 1,
            prompt_version: YOUTUBE_ARTICLE_PROMPT_VERSION,
            status: 'pending',
            eligibility
          })
          const deps: RunnerDeps = {
            repo: youtube,
            bucket,
            model,
            addCost: async () => {},
            publishBodies: publish,
            indexBodies: async () => 0,
            settleSnapshots: async () => 0,
            processVectorMaintenance: async () => {}
          }
          outcome = await runYoutubeArticle(
            deps,
            { articleId: row.id, videoId: sourceId, sourceHash: 'source', targetLanguage: 'zh', promptVersion: row.prompt_version, title: 'Smoke', trigger: 'crawl' },
            step,
            sourceId
          )
          rows = [(await youtube.findById(row.id))!]
        }
        if (scenario === 'nonempty') {
          assert.equal(outcome, 'ready')
          assert.equal(calls, 2, 'One body request plus one translation/introduction; no quality retries')
          assert.ok(publications > 0)
          for (const row of rows) {
            assert.equal(row.status, 'ready')
            const doc = JSON.parse(objects.get(row.article_key!)!)
            assert.ok(doc.sections.length)
            assert.ok(doc.sections.flatMap((s: any) => s.paragraphs).every((p: any) => p.text === bodyText))
          }
        } else {
          assert.notEqual(outcome, 'ready', `${kind}/${scenario} must not publish incomplete output`)
          assert.equal(publications, 0)
          assert.ok(rows.every(row => row.status !== 'ready'))
        }
        results.push({ kind, scenario, outcome, calls, publications, elapsedMs: Math.round(performance.now() - started) })
      }
    }
  } finally {
    globalThis.fetch = nativeFetch
    await new Promise<void>(done => server.close(() => done()))
    await pg?.$disconnect()
    resources.cleanup()
    writeFileSync(resolve(resources.workspace, 'media-quality-results.json'), JSON.stringify(results, null, 2))
    console.log(JSON.stringify(results, null, 2))
  }
}
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
