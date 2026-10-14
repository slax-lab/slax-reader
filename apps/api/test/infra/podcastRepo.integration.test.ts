/**
 * Real Postgres through PodcastEpisodeRepo and PodcastArticleRepo: the episode state machine
 * (claim, lease, job, ready, retry, requeue), the sweep queries, and that podcast and YouTube rows
 * never see each other. Runs only with RUN_PG_INTEGRATION_TESTS=1 after migrations.
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))

import { PodcastArticleRepo, PodcastEpisodeRepo } from '@/infra/repository/dbPodcastArticle'
import { YoutubeArticleRepo } from '@/infra/repository/dbYoutubeArticle'
import type { PodcastEpisodeInfo } from '@/utils/podcastSource'

const describePg = process.env.RUN_PG_INTEGRATION_TESTS === '1' ? describe : describe.skip

describePg('podcast repositories on Postgres', () => {
  let pg: HyperdrivePrismaClient
  let episodes: PodcastEpisodeRepo
  let articles: PodcastArticleRepo
  let youtube: YoutubeArticleRepo
  const token = randomUUID().slice(0, 8)
  let n = 0
  let source = ''
  const bookmarkBase = 910_000_000 + Math.floor(Math.random() * 1_000_000)

  const info = (over: Partial<PodcastEpisodeInfo> = {}): PodcastEpisodeInfo => ({
    kind: 'feed',
    pageUrl: 'https://feeds.example.com/x.rss',
    audioUrl: 'https://cdn.example.com/ep.mp3',
    embedUrl: '',
    title: 'Ep',
    showName: 'Show',
    author: 'Host',
    coverUrl: '',
    durationSec: 600,
    language: 'en',
    languageTag: 'en-us',
    shownotes: 'Notes',
    publishedAt: null,
    transcripts: [{ url: 'https://x/t.vtt', type: 'text/vtt', language: 'en' }],
    ...over
  })

  beforeAll(async () => {
    pg = new HyperdrivePrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.HYPERDRIVE_DATABASE_URL, max: 1 })) })
    episodes = new (PodcastEpisodeRepo as any)(() => pg) as PodcastEpisodeRepo
    articles = new (PodcastArticleRepo as any)(() => pg) as PodcastArticleRepo
    youtube = new (YoutubeArticleRepo as any)(() => pg) as YoutubeArticleRepo
  })

  beforeEach(() => {
    source = `p${token}${++n}`
  })

  afterAll(async () => {
    await pg.sr_podcast_episode.deleteMany({ where: { source_id: { startsWith: `p${token}` } } })
    await pg.sr_media_article.deleteMany({ where: { source_id: { startsWith: `p${token}` } } })
    await pg.sr_media_article_ref.deleteMany({ where: { source_id: { startsWith: `p${token}` } } })
    await pg.$disconnect()
  })

  test('upsert creates once; a second save refreshes metadata but never the transcript or language', async () => {
    const a = await episodes.upsertFromInfo(source, info())
    expect(a).toMatchObject({ source_id: source, language: 'en-us', transcript_status: 'pending', duration_sec: 600, title: 'Ep' })
    expect(a.publisher_transcripts).toEqual([{ url: 'https://x/t.vtt', type: 'text/vtt', language: 'en' }])
    await pg.sr_podcast_episode.update({ where: { id: a.id }, data: { transcript_status: 'ready', transcript_hash: 'h', language: 'en' } })
    const b = await episodes.upsertFromInfo(source, info({ title: 'Ep (renamed)', languageTag: 'ja' }))
    expect(b).toMatchObject({ id: a.id, title: 'Ep (renamed)', transcript_status: 'ready', transcript_hash: 'h', language: 'en' })
  })

  test('claim, lease, job, ready: only the owning run, idempotent for it', async () => {
    const ep = await episodes.upsertFromInfo(source, info())
    expect(await episodes.claim(ep.id, 'run-a', 60_000)).toBe(true)
    expect(await episodes.claim(ep.id, 'run-a', 60_000)).toBe(true)
    expect(await episodes.claim(ep.id, 'run-b', 60_000)).toBe(false)
    expect(await episodes.renewLease(ep.id, 'run-b', 60_000)).toBe(false)
    expect(await episodes.setJob(ep.id, 'run-a', 'job-1')).toBe(true)
    expect(await episodes.countRunning()).toBeGreaterThanOrEqual(1)
    const t = { source: 'assemblyai' as const, key: 'k', hash: 'h1', speakers: true, language: 'en', durationSec: 610 }
    expect(await episodes.markReady(ep.id, 'run-b', t)).toBe(false)
    expect(await episodes.markReady(ep.id, 'run-a', t)).toBe(true)
    expect(await episodes.markReady(ep.id, 'run-a', t)).toBe(true)
    expect(await episodes.findById(ep.id)).toMatchObject({
      transcript_status: 'ready',
      transcript_hash: 'h1',
      duration_sec: 610,
      speakers: true,
      provider_job_id: 'job-1',
      lease_until: null
    })
    expect(await episodes.addCost(ep.id, 0.1)).toBeCloseTo(0.1)
  })

  test('retry clears the job and waits; the third attempt fails; requeue refuses final errors', async () => {
    const ep = await episodes.upsertFromInfo(source, info())
    for (let attempt = 1; attempt <= 3; attempt++) {
      await episodes.claim(ep.id, `run-${attempt}`, 60_000)
      await episodes.setJob(ep.id, `run-${attempt}`, `job-${attempt}`)
      const status = await episodes.finish(ep.id, { kind: 'retry', error: 'asr_error:x' }, { runId: `run-${attempt}` })
      expect(status).toBe(attempt < 3 ? 'pending' : 'failed')
      if (attempt < 3) {
        await pg.sr_podcast_episode.update({ where: { id: ep.id }, data: { next_retry_at: new Date(Date.now() - 1000) } })
        expect((await episodes.listRunnable(500)).some(r => r.id === ep.id)).toBe(true)
      }
    }
    // A plain retry keeps the job (it is polled again, not paid again)
    expect(await episodes.findById(ep.id)).toMatchObject({ transcript_status: 'failed', provider_job_id: 'job-3', retry_count: 3 })
    expect(await episodes.requeue(ep.id)).toBe(true)
    expect(await episodes.findById(ep.id)).toMatchObject({ transcript_status: 'pending', retry_count: 0 })

    await episodes.claim(ep.id, 'run-x', 60_000)
    expect(await episodes.finish(ep.id, { kind: 'skipped', error: 'too_long' }, { runId: 'run-x' })).toBe('skipped')
    await pg.sr_podcast_episode.update({ where: { id: ep.id }, data: { transcript_status: 'failed' } })
    expect(await episodes.requeue(ep.id)).toBe(false)
  })

  test('a provider error clears the job; an owner retry keeps it', async () => {
    const ep = await episodes.upsertFromInfo(source, info())
    await episodes.claim(ep.id, 'run-a', 60_000)
    await episodes.setJob(ep.id, 'run-a', 'job-a')
    await episodes.finish(ep.id, { kind: 'retry', error: 'asr_error:x', clearJob: true }, { runId: 'run-a' })
    expect((await episodes.findById(ep.id))?.provider_job_id).toBeNull()
    await episodes.claim(ep.id, 'run-b', 60_000)
    await episodes.setJob(ep.id, 'run-b', 'job-b')
    await episodes.finish(ep.id, { kind: 'failed', error: 'asr_timeout' }, { runId: 'run-b' })
    expect(await episodes.requeue(ep.id)).toBe(true)
    expect((await episodes.findById(ep.id))?.provider_job_id).toBe('job-b')
  })

  test('republish: only ready episodes, at most 5 times, cleared when the bodies are written', async () => {
    const ep = await episodes.upsertFromInfo(source, info())
    expect(await episodes.markRepublish(ep.id, new Date(Date.now() - 1000))).toBe(false)
    await pg.sr_podcast_episode.update({ where: { id: ep.id }, data: { transcript_status: 'ready' } })
    for (let i = 0; i < 5; i++) expect(await episodes.markRepublish(ep.id, new Date(Date.now() - 1000))).toBe(true)
    expect(await episodes.markRepublish(ep.id, new Date(Date.now() - 1000))).toBe(false)
    expect((await episodes.listRepublish(500)).some(r => r.id === ep.id)).toBe(true)
    await episodes.clearRepublish(ep.id)
    expect(await episodes.findById(ep.id)).toMatchObject({ next_retry_at: null, error_message: null })
    expect((await episodes.listRepublish(500)).some(r => r.id === ep.id)).toBe(false)
  })

  test('dropRequest clears the sweep time of a pending article row only', async () => {
    const row = await articles.recordEvaluation({
      source_id: source,
      caption_key: 'k',
      caption_text_key: null,
      caption_language: 'en',
      caption_kind: 'publisher',
      source_hash: 'hx',
      target_language: 'zh',
      prompt_version: 'v1',
      schema_version: 1,
      status: 'pending',
      eligibility: { decision: 'generate', reason_codes: [] }
    })
    await articles.defer(row.id, new Date(Date.now() - 1000))
    expect(await articles.dropRequest(row.id)).toBe(true)
    expect((await articles.findById(row.id))?.next_retry_at).toBeNull()
  })

  test('the sweep recovers only a lease that really ran out; defer makes a pending episode requested', async () => {
    const ep = await episodes.upsertFromInfo(source, info())
    expect((await episodes.listRunnable(500)).some(r => r.id === ep.id)).toBe(false)
    expect(await episodes.defer(ep.id, new Date(Date.now() - 1000))).toBe(true)
    expect((await episodes.listRunnable(500)).some(r => r.id === ep.id)).toBe(true)
    await episodes.claim(ep.id, 'run-a', 60_000)
    const now = new Date()
    expect(await episodes.finish(ep.id, { kind: 'retry', error: 'lease_expired' }, { expiredBefore: now })).toBeNull()
    await pg.sr_podcast_episode.update({ where: { id: ep.id }, data: { lease_until: new Date(Date.now() - 1000) } })
    expect((await episodes.listExpiredLeases(500)).some(r => r.id === ep.id)).toBe(true)
    expect(await episodes.finish(ep.id, { kind: 'retry', error: 'lease_expired' }, { expiredBefore: new Date() })).toBe('pending')
  })

  test('orphans: only episodes no podcast bookmark points at, untouched for the cutoff', async () => {
    const ep = await episodes.upsertFromInfo(source, info())
    const later = new Date(Date.now() + 60_000)
    expect((await episodes.listOrphans(later, 500)).some(r => r.id === ep.id)).toBe(true)
    await articles.linkBookmark({ bookmark_id: bookmarkBase + n, user_id: 1, source_id: source, source_hash: '' })
    expect((await episodes.listOrphans(later, 500)).some(r => r.id === ep.id)).toBe(false)
    expect(await episodes.deleteOrphan(ep.id, later)).toBe(false)
    await articles.unlinkBookmark(bookmarkBase + n)
    expect(await episodes.deleteOrphan(ep.id, new Date(Date.now() - 60_000))).toBe(false)
    expect(await episodes.deleteOrphan(ep.id, later)).toBe(true)
    expect(await episodes.findById(ep.id)).toBeNull()
  })

  test('refs: the transcript hash reaches every bookmark of the episode; podcast and YouTube stay apart', async () => {
    const b1 = bookmarkBase + 100 + n
    const b2 = bookmarkBase + 200 + n
    await articles.linkBookmark({ bookmark_id: b1, user_id: 1, source_id: source, source_hash: '' })
    await articles.linkBookmark({ bookmark_id: b2, user_id: 2, source_id: source, source_hash: '' })
    expect(await articles.setRefsHash(source, 'h9')).toBe(2)
    expect((await articles.listEpisodeRefs(source)).map(r => [r.bookmark_id, r.source_hash])).toEqual([
      [b1, 'h9'],
      [b2, 'h9']
    ])
    expect(await youtube.findRef(b1)).toBeNull()
    expect(await articles.findRef(b1)).toMatchObject({ media_kind: 'podcast' })

    const row = await articles.recordEvaluation({
      source_id: source,
      caption_key: 'k',
      caption_text_key: null,
      caption_language: 'en',
      caption_kind: 'publisher',
      source_hash: 'h9',
      target_language: 'en',
      prompt_version: 'v1',
      schema_version: 1,
      status: 'pending',
      eligibility: { decision: 'generate', reason_codes: [] }
    })
    expect(row.media_kind).toBe('podcast')
    expect(await youtube.findById(row.id)).toBeNull()
    expect(await youtube.findVersion(source, 'h9', 'en')).toBeNull()
    expect((await articles.findVersion(source, 'h9', 'en'))?.id).toBe(row.id)
    expect(await youtube.unlinkBookmark(b1)).toBe(0)
    expect(await articles.unlinkBookmark(b1)).toBe(1)
  })
})
