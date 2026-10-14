/**
 * Real Postgres through YoutubeArticleRepo: one row per (video, caption hash, language, prompt),
 * the compare-and-set state changes the workflow relies on, and the sweep queries.
 * Runs only with RUN_PG_INTEGRATION_TESTS=1 after migrations.
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

import { YoutubeArticleRepo, type YoutubeArticleEvaluation } from '@/infra/repository/dbYoutubeArticle'

const describePg = process.env.RUN_PG_INTEGRATION_TESTS === '1' ? describe : describe.skip

describePg('YoutubeArticleRepo on Postgres', () => {
  let pg: HyperdrivePrismaClient
  let repo: YoutubeArticleRepo
  const token = randomUUID().slice(0, 8)
  let n = 0
  let video = ''
  const bookmarkBase = 900_000_000 + Math.floor(Math.random() * 1_000_000)

  const evaluation = (over: Partial<YoutubeArticleEvaluation> = {}): YoutubeArticleEvaluation => ({
    source_id: video,
    caption_key: `youtube/canonical/captions/${video}/h1.json`,
    caption_text_key: `youtube/canonical/captions/${video}/h1.txt`,
    caption_language: 'en',
    caption_kind: 'manual',
    source_hash: 'h1',
    target_language: 'en',
    prompt_version: 'v1',
    schema_version: 1,
    status: 'pending',
    eligibility: { decision: 'generate', reason_codes: [] },
    ...over
  })

  beforeAll(async () => {
    pg = new HyperdrivePrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.HYPERDRIVE_DATABASE_URL, max: 1 })) })
    repo = new (YoutubeArticleRepo as any)(() => pg) as YoutubeArticleRepo
  })

  beforeEach(() => {
    video = `t${token}${++n}`
  })

  afterAll(async () => {
    await pg.sr_media_article.deleteMany({ where: { source_id: { startsWith: `t${token}` } } })
    await pg.sr_media_article_ref.deleteMany({ where: { source_id: { startsWith: `t${token}` } } })
    await pg.$disconnect()
  })

  test('one row per target language; re-evaluation refreshes only pending/skipped rows', async () => {
    const en = await repo.recordEvaluation(evaluation())
    const zh = await repo.recordEvaluation(evaluation({ target_language: 'zh', status: 'skipped' }))
    expect(en.id).not.toBe(zh.id)
    expect([en.target_language, zh.target_language]).toEqual(['en', 'zh'])

    const again = await repo.recordEvaluation(evaluation({ status: 'skipped', eligibility: { decision: 'skip', reason_codes: ['x'] } }))
    expect(again.id).toBe(en.id)
    expect(again.status).toBe('skipped')

    await pg.sr_media_article.update({ where: { id: en.id }, data: { status: 'ready', updated_at: new Date(Date.now() - 30 * 86_400_000) } })
    const kept = await repo.recordEvaluation(evaluation())
    expect(kept.status).toBe('ready')
    // a new save marks the row as used, so the orphan sweep cannot delete it under the new ref
    expect(kept.updated_at.getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  test('ensureLanguageRow copies the gate result; a concurrent second call returns the same row', async () => {
    const base = await repo.recordEvaluation(evaluation())
    const [a, b] = await Promise.all([repo.ensureLanguageRow(base, 'zh'), repo.ensureLanguageRow(base, 'zh')])
    expect(a.id).toBe(b.id)
    expect(a).toMatchObject({ target_language: 'zh', status: 'pending', caption_key: base.caption_key, eligibility_json: { decision: 'generate', reason_codes: [] } })

    const skippedBase = await repo.recordEvaluation(evaluation({ source_hash: 'h2', eligibility: { decision: 'review', reason_codes: ['non_en_zh_language'] }, status: 'skipped' }))
    expect((await repo.ensureLanguageRow(skippedBase, 'zh')).status).toBe('skipped')
  })

  test('one run wins the claim; the winning claim is idempotent; only the winner renews and publishes', async () => {
    const row = await repo.recordEvaluation(evaluation())
    const claims = await Promise.all([repo.claim(row.id, 'run-a', 60_000), repo.claim(row.id, 'run-b', 60_000), repo.claim(row.id, 'run-c', 60_000)])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const winner = ['run-a', 'run-b', 'run-c'][claims.indexOf(true)]!
    const loser = ['run-a', 'run-b', 'run-c'].find(r => r !== winner)!
    expect(await repo.claim(row.id, winner, 60_000)).toBe(true)
    expect(await repo.claim(row.id, loser, 60_000)).toBe(false)
    expect(await repo.countRunning()).toBeGreaterThanOrEqual(1)
    expect(await repo.renewLease(row.id, loser, 60_000)).toBe(false)
    expect(await repo.renewLease(row.id, winner, 60_000, 'validating')).toBe(true)

    const data = { article_key: 'a.json', article_text_key: 'a.txt', model: 'm', quality: { passed: true } }
    expect(await repo.publish(row.id, winner, 'other-hash', 'en', data)).toBe(false)
    expect(await repo.publish(row.id, winner, 'h1', 'zh', data)).toBe(false)
    expect(await repo.publish(row.id, loser, 'h1', 'en', data)).toBe(false)
    expect(await repo.publish(row.id, winner, 'h1', 'en', data)).toBe(true)
    // a retried publish step after the update committed
    expect(await repo.publish(row.id, winner, 'h1', 'en', data)).toBe(true)
    expect(await repo.publish(row.id, winner, 'h1', 'en', { ...data, article_key: 'b.json' })).toBe(false)
    const ready = await repo.findById(row.id)
    expect(ready).toMatchObject({ status: 'ready', article_key: 'a.json', lease_until: null, run_id: winner })
    expect(ready?.completed_at).toBeInstanceOf(Date)
    expect(await repo.renewLease(row.id, winner, 60_000)).toBe(false)
  })

  test('cost adds up on the row across calls', async () => {
    const row = await repo.recordEvaluation(evaluation())
    expect(await repo.addCost(row.id, 0.012)).toBeCloseTo(0.012)
    expect(await repo.addCost(row.id, 0.03)).toBeCloseTo(0.042)
  })

  test('retryable failures go back to pending with a delay, then stay failed after 3 attempts', async () => {
    const row = await repo.recordEvaluation(evaluation())
    for (const [i, expected] of ['pending', 'pending', 'failed'].entries()) {
      await pg.sr_media_article.update({ where: { id: row.id }, data: { next_retry_at: null } })
      expect(await repo.claim(row.id, `run-${i}`, 60_000)).toBe(true)
      expect(await repo.finishAttempt(row.id, { kind: 'retry', error: 'rate_limited' }, { runId: 'someone-else' })).toBeNull()
      expect(await repo.finishAttempt(row.id, { kind: 'retry', error: 'rate_limited' }, { runId: `run-${i}` })).toBe(expected)
    }
    const failed = await repo.findById(row.id)
    expect(failed).toMatchObject({ status: 'failed', retry_count: 3, error_message: 'rate_limited' })
    expect(await repo.finishAttempt(row.id, { kind: 'retry', error: 'late' })).toBeNull()
  })

  test('the sweep only finishes a lease that really ran out', async () => {
    const row = await repo.recordEvaluation(evaluation())
    await repo.claim(row.id, 'run-1', 60_000)
    expect(await repo.finishAttempt(row.id, { kind: 'retry', error: 'lease_expired' }, { expiredBefore: new Date() })).toBeNull()
    await pg.sr_media_article.update({ where: { id: row.id }, data: { lease_until: new Date(Date.now() - 1000) } })
    expect(await repo.finishAttempt(row.id, { kind: 'retry', error: 'lease_expired', retryDelayMs: 60_000 }, { expiredBefore: new Date() })).toBe('pending')
    expect((await repo.findById(row.id))!.next_retry_at!.getTime()).toBeGreaterThan(Date.now() + 50_000)
  })

  test('non-retryable failure and skip; quality is kept', async () => {
    const row = await repo.recordEvaluation(evaluation())
    await repo.claim(row.id, 'run-1', 60_000)
    expect(await repo.finishAttempt(row.id, { kind: 'failed', error: 'budget_exceeded', quality: { failed: ['x'] } }, { runId: 'run-1' })).toBe('failed')
    expect((await repo.findById(row.id))?.quality_json).toEqual({ failed: ['x'] })

    const other = await repo.recordEvaluation(evaluation({ source_hash: 'h9' }))
    await repo.claim(other.id, 'run-2', 60_000)
    expect(await repo.finishAttempt(other.id, { kind: 'skipped', error: 'too_long' }, { runId: 'run-2' })).toBe('skipped')
    expect((await repo.findById(other.id))?.retry_count).toBe(0)
  })

  test('requeue: generate takes skipped/failed, retry takes failed only; both mark the row as requested; never after the budget ran out', async () => {
    const row = await repo.recordEvaluation(evaluation({ status: 'skipped' }))
    expect(await repo.requeue(row.id, true)).toBe(false)
    expect(await repo.requeue(row.id, false)).toBe(true)
    expect((await repo.findById(row.id))?.next_retry_at).toBeInstanceOf(Date)
    expect(await repo.requeue(row.id, false)).toBe(false)

    await pg.sr_media_article.update({ where: { id: row.id }, data: { status: 'failed', retry_count: 3, error_message: 'quality:length_ratio' } })
    expect(await repo.requeue(row.id, true)).toBe(true)
    expect(await repo.findById(row.id)).toMatchObject({ status: 'pending', retry_count: 0, error_message: null })

    await pg.sr_media_article.update({ where: { id: row.id }, data: { status: 'failed', error_message: 'budget_exceeded' } })
    expect(await repo.requeue(row.id, true)).toBe(false)
    expect(await repo.requeue(row.id, false)).toBe(false)
    await pg.sr_media_article.update({ where: { id: row.id }, data: { status: 'skipped', error_message: 'too_long' } })
    expect(await repo.requeue(row.id, false)).toBe(false)
  })

  test('runnable rows are only deferred requests whose delay is over; expired leases are listed', async () => {
    const ready = await repo.recordEvaluation(evaluation())
    const later = await repo.recordEvaluation(evaluation({ source_hash: 'h2' }))
    const neverAsked = await repo.recordEvaluation(evaluation({ source_hash: 'h3' }))
    expect(await repo.defer(ready.id, new Date(Date.now() - 1000))).toBe(true)
    expect(await repo.defer(later.id, new Date(Date.now() + 3_600_000))).toBe(true)
    const runnable = (await repo.listRunnable(1000)).map(r => r.id)
    expect(runnable).toContain(ready.id)
    expect(runnable).not.toContain(later.id)
    expect(runnable).not.toContain(neverAsked.id)

    await repo.claim(ready.id, 'run-1', -1000)
    expect((await repo.listExpiredLeases(1000)).map(r => r.id)).toContain(ready.id)
  })

  test('orphans: only rows no bookmark points at, older than the cutoff and idle', async () => {
    const linked = await repo.recordEvaluation(evaluation())
    const orphan = await repo.recordEvaluation(evaluation({ source_hash: 'old' }))
    const running = await repo.recordEvaluation(evaluation({ source_hash: 'busy' }))
    await repo.claim(running.id, 'run-1', 60_000)
    await repo.linkBookmark({ bookmark_id: bookmarkBase + n, user_id: 1, source_id: video, source_hash: 'h1' })
    await pg.sr_media_article.updateMany({ where: { source_id: video }, data: { updated_at: new Date(Date.now() - 8 * 86_400_000) } })

    const ids = (await repo.listOrphans(new Date(Date.now() - 7 * 86_400_000), 1000)).map(r => r.id)
    expect(ids).toContain(orphan.id)
    expect(ids).not.toContain(linked.id)
    expect(ids).not.toContain(running.id)
    const cutoff = new Date(Date.now() - 7 * 86_400_000)
    expect(await repo.deleteOrphan(linked.id, cutoff)).toBe(false)
    // touched again after the sweep listed it (a re-save): kept
    await pg.sr_media_article.update({ where: { id: orphan.id }, data: { updated_at: new Date() } })
    expect(await repo.deleteOrphan(orphan.id, cutoff)).toBe(false)
    await pg.sr_media_article.update({ where: { id: orphan.id }, data: { updated_at: new Date(Date.now() - 8 * 86_400_000) } })
    expect(await repo.deleteOrphan(orphan.id, cutoff)).toBe(true)
    expect(await repo.findById(orphan.id)).toBeNull()

    expect(await repo.countRowsUsingKey('caption_key', linked.caption_key!)).toBe(2)
    expect(await repo.unlinkBookmark(bookmarkBase + n)).toBe(1)
    expect(await repo.findRef(bookmarkBase + n)).toBeNull()
  })

  test('takedown clears pointers, blocks new rows of the video and survives re-evaluation', async () => {
    const row = await repo.recordEvaluation(evaluation())
    await pg.sr_media_article.update({ where: { id: row.id }, data: { status: 'ready', article_key: 'a.json' } })
    expect(await repo.takedownVideo(video)).toBe(1)
    expect(await repo.isTakedown(video)).toBe(true)
    expect(await repo.findById(row.id)).toMatchObject({ status: 'takedown', article_key: null, caption_key: null })

    expect((await repo.recordEvaluation(evaluation())).status).toBe('takedown')
    expect((await repo.recordEvaluation(evaluation({ source_hash: 'new' }))).status).toBe('takedown')
    const base = (await repo.findVersion(video, 'h1', 'en', 'v1'))!
    expect((await repo.ensureLanguageRow(base, 'zh')).status).toBe('takedown')
  })

  test('takedown script marks rows (or adds a marker); the sweep sees it; orphans never delete the marker', async () => {
    const { takedownVideo } = await import('../../script/youtube-article-takedown')
    const { Client } = await import('pg')
    const client = new Client({ connectionString: process.env.HYPERDRIVE_DATABASE_URL })
    await client.connect()
    try {
      const vid = `tk${token}${n}`.slice(0, 11).padEnd(11, '_')
      const row = await repo.recordEvaluation(evaluation({ source_id: vid }))
      expect(await takedownVideo(client, vid, false)).toEqual({ video_id: vid, rows: 1, marked: 0, applied: false })
      expect((await repo.findById(row.id))?.status).toBe('pending')
      expect(await takedownVideo(client, vid, true)).toMatchObject({ rows: 1, marked: 1, applied: true })
      expect(await repo.findById(row.id)).toMatchObject({ status: 'takedown', caption_key: row.caption_key })
      expect(await repo.listTakedownsToClean(1000)).toContain(vid)
      await repo.takedownVideo(vid)
      expect(await repo.listTakedownsToClean(1000)).not.toContain(vid)

      await pg.sr_media_article.updateMany({ where: { source_id: vid }, data: { updated_at: new Date(Date.now() - 30 * 86_400_000) } })
      expect((await repo.listOrphans(new Date(), 1000)).map(r => r.source_id)).not.toContain(vid)
      expect(await repo.deleteOrphan(row.id, new Date())).toBe(false)

      const fresh = `tm${token}${n}`.slice(0, 11).padEnd(11, '_')
      expect(await takedownVideo(client, fresh, true)).toMatchObject({ rows: 0, marked: 1 })
      expect(await repo.isTakedown(fresh)).toBe(true)
      await expect(takedownVideo(client, 'bad id!', true)).rejects.toThrow('11-character')
      await pg.sr_media_article.deleteMany({ where: { source_id: { in: [vid, fresh] } } })
    } finally {
      await client.end()
    }
  })

  test('backfill candidates: YouTube bookmarks of Labs users without a ref, newest first, cursor works', async () => {
    const now = new Date()
    const labUser = await pg.sr_user.create({ data: { email: `yt-lab-${token}@example.test`, lang: 'zh', last_login_at: now, created_at: now } })
    const otherUser = await pg.sr_user.create({ data: { email: `yt-off-${token}@example.test`, last_login_at: now, created_at: now } })
    await pg.sr_user_lab_feature.create({ data: { user_id: labUser.id, feature: 'youtube_article', enabled: true } })
    const mk = async (userId: number, url: string, site = '') => {
      const b = await pg.sr_bookmark.create({ data: { target_url: url, site_name: site, private_user: userId, created_at: now, updated_at: now, published_at: now } })
      const ub = await pg.sr_user_bookmark.create({ data: { user_id: userId, bookmark_id: b.id, updated_at: now } })
      return { b, ub }
    }
    const yt1 = await mk(labUser.id, `https://www.youtube.com/watch?v=${token}aa1`)
    const yt2 = await mk(labUser.id, `https://youtu.be/${token}aa2`)
    const linked = await mk(labUser.id, `https://www.youtube.com/watch?v=${token}aa3`, 'YouTube')
    const notYt = await mk(labUser.id, `https://example.com/${token}`)
    const offUser = await mk(otherUser.id, `https://www.youtube.com/watch?v=${token}aa4`)
    await repo.linkBookmark({ bookmark_id: linked.b.id, user_id: labUser.id, source_id: video, source_hash: 'h1' })
    try {
      const all = (await repo.listBackfillCandidates(1000)).filter(r => [yt1, yt2, linked, notYt, offUser].some(x => x.ub.id === r.user_bookmark_id))
      expect(all.map(r => r.bookmark_id)).toEqual([yt2.b.id, yt1.b.id])
      expect(all[0]).toMatchObject({ user_id: labUser.id, lang: 'zh', target_url: `https://youtu.be/${token}aa2` })
      const after = (await repo.listBackfillCandidates(1000, yt2.ub.id)).map(r => r.bookmark_id)
      expect(after).toContain(yt1.b.id)
      expect(after).not.toContain(yt2.b.id)
    } finally {
      await repo.unlinkBookmark(linked.b.id)
      const ids = [yt1, yt2, linked, notYt, offUser]
      await pg.sr_user_bookmark.deleteMany({ where: { id: { in: ids.map(x => x.ub.id) } } })
      await pg.sr_bookmark.deleteMany({ where: { id: { in: ids.map(x => x.b.id) } } })
      await pg.sr_user_lab_feature.deleteMany({ where: { user_id: labUser.id } })
      await pg.sr_user.deleteMany({ where: { id: { in: [labUser.id, otherUser.id] } } })
    }
  })

  test('findForBookmark follows the bookmark ref to the language row', async () => {
    const row = await repo.recordEvaluation(evaluation({ target_language: 'zh' }))
    const bookmarkId = bookmarkBase + 500_000 + n
    await repo.linkBookmark({ bookmark_id: bookmarkId, user_id: 7, source_id: video, source_hash: 'h1' })
    expect((await repo.findForBookmark(bookmarkId, 'zh'))?.id).toBe(row.id)
    expect(await repo.findForBookmark(bookmarkId, 'en')).toBeNull()
    expect((await repo.findAnyRef(video, 'h1'))?.bookmark_id).toBe(bookmarkId)
    await repo.linkBookmark({ bookmark_id: bookmarkId + 1, user_id: 8, source_id: video, source_hash: 'h2' })
    expect((await repo.listRefs(video, 'h1')).map(r => r.bookmark_id)).toEqual([bookmarkId])
    expect((await repo.listRefs(video)).map(r => r.bookmark_id)).toEqual([bookmarkId, bookmarkId + 1])
    await repo.unlinkBookmark(bookmarkId)
    await repo.unlinkBookmark(bookmarkId + 1)
  })
})
