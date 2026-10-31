import { createMockMediaSnapshots } from '@test/helpers/mockFactory'
/**
 * PodcastService: visibility, starts after a save, the daily and budget limits, retries, writing
 * the article into bookmark bodies, moderation, translations, and the sweep. Repositories are
 * in-memory stand-ins with the same state rules; the SQL is covered by podcastRepo.integration.test.ts.
 * 来源: src/domain/podcast.ts, docs/podcast-article/spec.md 第 4、5、6 节、第 9 节
 */
import { describe, expect, test, vi } from 'vitest'
import { PodcastService, PODCAST_MAX_CONCURRENT } from '@/domain/podcast'
import { MediaBodyService } from '@/domain/mediaBody'
import type { podcastEpisodePO } from '@/infra/repository/dbPodcastArticle'
import type { mediaArticlePO, mediaArticleRefPO } from '@/infra/repository/dbMediaArticle'
import { resolveBookmarkReadAccess } from '@/utils/bookmarkAccess'
import { ErrorName } from '@/const/err'
import { createMockCtx } from '@test/helpers/mockFactory'
import { buildTranscriptDocument } from '@/utils/podcastTranscript'
import type { YoutubeArticleDocument } from '@/utils/youtubeArticle'

const OWNER = 7
const VISITOR = 8
const SOURCE = 's'.repeat(32)
const HASH = 'h'.repeat(64)
const BOOKMARK = 100
const UUID = 'ub-uuid-1'
const TRANSCRIPT_KEY = `podcast/canonical/transcripts/${SOURCE}/${HASH}.json`

function episodes() {
  const rows: podcastEpisodePO[] = []
  const running = (r: podcastEpisodePO) => r.transcript_status === 'transcribing'
  const repo = {
    rows,
    add(over: Partial<podcastEpisodePO> = {}): podcastEpisodePO {
      const row = {
        id: rows.length + 1,
        source_id: SOURCE,
        audio_url: 'https://cdn.example.com/ep.mp3',
        title: 'Ep',
        show_name: 'Show',
        author: '',
        cover_url: '',
        duration_sec: 600,
        language: 'en',
        shownotes: 'Notes',
        publisher_transcripts: [],
        transcript_status: 'pending',
        transcript_source: null,
        provider_job_id: null,
        transcript_key: null,
        transcript_hash: null,
        speakers: false,
        cost_usd: 0,
        retry_count: 0,
        run_id: null,
        lease_until: null,
        next_retry_at: null,
        error_message: null,
        created_at: new Date(),
        updated_at: new Date(),
        completed_at: null,
        ...over
      } as podcastEpisodePO
      rows.push(row)
      return row
    },
    findById: vi.fn(async (id: number) => rows.find(r => r.id === id) ?? null),
    findBySourceId: vi.fn(async (s: string) => rows.find(r => r.source_id === s) ?? null),
    defer: vi.fn(async (id: number, at: Date) => {
      const r = rows.find(x => x.id === id && x.transcript_status === 'pending')
      if (!r) return false
      r.next_retry_at = at
      return true
    }),
    requeue: vi.fn(async (id: number) => {
      const r = rows.find(x => x.id === id && x.transcript_status === 'failed')
      if (!r || /^(too_long|no_speech|language_unsupported|moderation|budget_exceeded|no_audio)/.test(r.error_message ?? '')) return false
      Object.assign(r, { transcript_status: 'pending', retry_count: 0, next_retry_at: new Date(), error_message: null })
      return true
    }),
    countRunning: vi.fn(async () => rows.filter(r => running(r) && r.lease_until && r.lease_until > new Date()).length),
    listRunnable: vi.fn(async (limit: number) => rows.filter(r => r.transcript_status === 'pending' && r.next_retry_at && r.next_retry_at <= new Date()).slice(0, limit)),
    listExpiredLeases: vi.fn(async () => rows.filter(r => running(r) && (!r.lease_until || r.lease_until < new Date()))),
    finish: vi.fn(async (id: number, o: { kind: string; error: string }) => {
      const r = rows.find(x => x.id === id)
      if (!r || !running(r)) return null
      r.retry_count++
      r.transcript_status = o.kind === 'retry' && r.retry_count < 3 ? 'pending' : 'failed'
      r.error_message = o.error
      return r.transcript_status
    }),
    listOrphans: vi.fn(async (_cutoff: Date) => [] as podcastEpisodePO[]),
    listRepublish: vi.fn(async (limit: number) => rows.filter(r => r.transcript_status === 'ready' && r.next_retry_at && r.next_retry_at <= new Date()).slice(0, limit)),
    deleteOrphan: vi.fn(async (id: number) => {
      const i = rows.findIndex(r => r.id === id)
      if (i < 0) return false
      rows.splice(i, 1)
      return true
    })
  }
  return repo
}

function articles() {
  const rows: mediaArticlePO[] = []
  const refs: mediaArticleRefPO[] = []
  const running = (r: mediaArticlePO) => r.status === 'generating' || r.status === 'validating'
  const repo = {
    rows,
    refs,
    add(over: Partial<mediaArticlePO>): mediaArticlePO {
      const row = {
        id: rows.length + 50,
        media_kind: 'podcast',
        source_id: SOURCE,
        source_hash: HASH,
        target_language: 'en',
        status: 'pending',
        article_key: null,
        article_text_key: null,
        prompt_version: 'v1',
        schema_version: 1,
        retry_count: 0,
        cost_usd: 0,
        run_id: null,
        lease_until: null,
        next_retry_at: null,
        error_message: null,
        updated_at: new Date(),
        ...over
      } as mediaArticlePO
      rows.push(row)
      return row
    },
    findRef: vi.fn(async (b: number) => refs.find(r => r.bookmark_id === b) ?? null),
    setRefsHash: vi.fn(async () => 1),
    listEpisodeRefs: vi.fn(async (s: string) => refs.filter(r => r.source_id === s)),
    findVersion: vi.fn(async (s: string, h: string, l: string) => rows.find(r => r.source_id === s && r.source_hash === h && r.target_language === l) ?? null),
    listForSource: vi.fn(async (s: string, h: string) => rows.filter(r => r.source_id === s && r.source_hash === h)),
    recordEvaluation: vi.fn(async (input: { source_id: string; source_hash: string; target_language: string }) => {
      const found = rows.find(r => r.source_id === input.source_id && r.source_hash === input.source_hash && r.target_language === input.target_language)
      if (found) {
        if (found.status === 'skipped') found.status = 'pending'
        return found
      }
      return repo.add({ source_id: input.source_id, source_hash: input.source_hash, target_language: input.target_language })
    }),
    requeue: vi.fn(async (id: number) => {
      const r = rows.find(x => x.id === id && x.status === 'failed')
      if (!r || /^(too_long|budget_exceeded)/.test(r.error_message ?? '')) return false
      Object.assign(r, { status: 'pending', retry_count: 0, next_retry_at: new Date(), error_message: null })
      return true
    }),
    defer: vi.fn(async (id: number, at: Date) => {
      const r = rows.find(x => x.id === id && x.status === 'pending')
      if (!r) return false
      r.next_retry_at = at
      return true
    }),
    countRunning: vi.fn(async () => rows.filter(r => running(r) && r.lease_until && r.lease_until > new Date()).length),
    listRunnable: vi.fn(async (limit: number) => rows.filter(r => r.status === 'pending' && r.next_retry_at && r.next_retry_at <= new Date()).slice(0, limit)),
    listExpiredLeases: vi.fn(async () => rows.filter(r => running(r) && (!r.lease_until || r.lease_until < new Date()))),
    finishAttempt: vi.fn(async (id: number, o: { kind: string; error: string }) => {
      const r = rows.find(x => x.id === id)
      if (!r || !running(r)) return null
      r.retry_count++
      r.status = o.kind === 'retry' && r.retry_count < 3 ? 'pending' : 'failed'
      r.error_message = o.error
      return r.status
    }),
    listOrphans: vi.fn(async () => [] as mediaArticlePO[]),
    deleteOrphan: vi.fn(async () => true)
  }
  return repo
}

function memRedis() {
  const store = new Map<string, number>()
  const op = (key: string) => ({
    get: async () => (store.has(key) ? store.get(key)! : null),
    incrWithExpire: async () => {
      store.set(key, (store.get(key) ?? 0) + 1)
      return store.get(key)!
    },
    incrBy: async (n: number) => {
      store.set(key, (store.get(key) ?? 0) + n)
      return store.get(key)!
    },
    expire: async () => {},
    setIfAbsent: async (v: number) => {
      if (store.has(key)) return false
      store.set(key, v)
      return true
    }
  })
  return {
    store,
    podcastDaily: (u: number, d: string) => op(`podcast:${u}:${d}`),
    podcastCost: (d: string) => op(`podcast_cost:${d}`),
    podcastStartLock: (i: number) => op(`podcast_start:${i}`),
    podcastBudgetAlert: (d: string) => op(`podcast_budget_alert:${d}`)
  }
}

const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

function articleDoc(lang: 'en' | 'zh'): YoutubeArticleDocument {
  return {
    schema_version: 1,
    language: lang,
    format: 'dialogue',
    lede: lang === 'zh' ? '导读。' : 'Lede.',
    sections: [
      {
        heading: lang === 'zh' ? '标题' : 'Heading',
        start_ms: 0,
        end_ms: 20_000,
        paragraphs: [{ speaker: 'A', text: lang === 'zh' ? '第二句。' : 'Second.', source_cue_ids: ['c0002'] }]
      }
    ]
  }
}

function wire(opts: { users?: Record<number, { ai_lang: string; lang: string }>; labOn?: number[] } = {}) {
  const eps = episodes()
  const arts = articles()
  const redis = memRedis()
  const users = opts.users ?? { [OWNER]: { ai_lang: '', lang: 'en' }, [VISITOR]: { ai_lang: 'zh', lang: 'zh' } }
  const labOn = new Set(opts.labOn ?? [OWNER])
  const ub = { user_id: OWNER, deleted_at: null as Date | null, metadata: { share: { is_enable: true } } as unknown, moderation_result: 0 }
  const bookmarks = new Map<number, { title: string; content_key: string | null; content_md_key: string | null; moderation_result: number }>([
    [BOOKMARK, { title: 'Ep', content_key: 'html/body/u1.html', content_md_key: 'text/body/u1.txt', moderation_result: 0 }]
  ])
  const bookmarkService = {
    getUserBookmarkByUuidWithDetail: vi.fn(async (uuid: string) =>
      uuid === UUID
        ? {
            uuid,
            user_id: ub.user_id,
            bookmark_id: BOOKMARK,
            deleted_at: ub.deleted_at,
            metadata: ub.metadata,
            alias_title: '',
            bookmark: { title: 'Ep', moderation_result: ub.moderation_result }
          }
        : null
    ),
    getBookmarkById: vi.fn(async (id: number) => bookmarks.get(id) ?? null),
    updateBookmarkModerationResult: vi.fn(async () => ({})),
    disableBookmarkShare: vi.fn(async () => ({})),
    // The real access rule; the share record comes from ub.metadata.share
    getBookmarkReadAccess: vi.fn(async (ctx: { getUserId(): number }, uuid: string) =>
      resolveBookmarkReadAccess(
        {
          getUserBookmarkByUuidWithDetail: (id: string) => bookmarkService.getUserBookmarkByUuidWithDetail(id),
          getBookmarkShareByBookmarkId: async () => (ub.metadata as { share?: { is_enable: boolean } } | null)?.share ?? null
        } as any,
        userRepo as any,
        ctx.getUserId(),
        uuid
      )
    )
  }
  const bookmarkRepo = { updateBookmarkWordCount: vi.fn(async () => ({})), deleteBookmarkSummary: vi.fn(async () => ({})) }
  const forkRepo = { claimWrite: vi.fn(async () => true), releaseWrite: vi.fn(async () => true), failWrite: vi.fn(async () => true), publishRevision: vi.fn(async () => true) }
  const searchService = { addSearchRecord: vi.fn(async () => [{ status: 'fulfilled', value: [] }]) }
  const labService = {
    isEnabled: vi.fn(async (userId: number) => labOn.has(userId)),
    disabledError: vi.fn(() => Object.assign(new Error('lab'), { name: ErrorName.LAB_FEATURE_DISABLED }))
  }
  const userRepo = {
    getInfoByUserId: vi.fn(async (id: number) => {
      const u = users[id]
      if (!u) throw new Error('no user')
      return { snapshot_sharing: true, ...u }
    })
  }
  const objects = new Map<string, string>([['html/body/u1.html', '<p>Show notes</p>']])
  const bucket = {
    R2Bucket: {
      get: vi.fn(async (k: string) => (objects.has(k) ? { body: new ReadableStream(), text: async () => objects.get(k)! } : null)),
      put: vi.fn(async (k: string, v: string) => {
        objects.set(k, v)
        return { key: k }
      }),
      delete: vi.fn(async (k: string | string[]) => {
        for (const key of Array.isArray(k) ? k : [k]) objects.delete(key)
      }),
      list: vi.fn(async ({ prefix }: { prefix: string }) => ({ objects: [...objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false }))
    }
  }
  const alertBot = { crawl: { pushMessage: vi.fn(async () => {}) } }
  const markRepo = { bodyHasMarks: vi.fn(async () => false) }
  const service = new (PodcastService as any)(
    eps,
    arts,
    bookmarkService,
    new MediaBodyService(
      bookmarkService as any,
      bookmarkRepo as any,
      searchService as any,
      markRepo as any,
      (() => bucket) as any,
      forkRepo as any
    ),
    labService,
    userRepo,
    () => redis,
    () => bucket,
    alertBot,
    createMockMediaSnapshots()
  ) as PodcastService
  const create = vi.fn(async () => ({}))
  const ctx = (userId: number) => {
    const c = createMockCtx({ userId })
    c.env.PODCAST_WORKFLOW = { create }
    return c
  }
  arts.refs.push({ id: 1, bookmark_id: BOOKMARK, user_id: OWNER, media_kind: 'podcast', source_id: SOURCE, source_hash: '', created_at: new Date(), updated_at: new Date() })

  /** A transcribed episode with a ready original article (and its objects in R2). */
  const readyEpisode = (over: Partial<podcastEpisodePO> = {}) => {
    const ep = eps.add({ transcript_status: 'ready', transcript_hash: HASH, transcript_key: TRANSCRIPT_KEY, transcript_source: 'publisher', ...over })
    arts.refs.forEach(r => (r.source_hash = HASH))
    const transcript = buildTranscriptDocument('publisher', 'en', [
      { start_ms: 0, end_ms: 9_000, text: 'First.', speaker: 'SPEAKER_00' },
      { start_ms: 12_000, end_ms: 20_000, text: 'Second.', speaker: 'SPEAKER_00' }
    ])
    objects.set(TRANSCRIPT_KEY, JSON.stringify(transcript))
    const en = arts.add({ target_language: 'en', status: 'ready', article_key: 'podcast/canonical/articles/x/en.json' })
    objects.set(en.article_key!, JSON.stringify(articleDoc('en')))
    return { ep, en }
  }
  return { service, markRepo, eps, arts, redis, ub, bookmarks, bookmarkService, bookmarkRepo, forkRepo, searchService, labOn, objects, create, ctx, alertBot, readyEpisode }
}

describe('triggerAfterCrawl', () => {
  test('Labs off or no reference: nothing happens', async () => {
    const w = wire({ labOn: [] })
    w.eps.add()
    await w.service.triggerAfterCrawl(w.ctx(OWNER), BOOKMARK, OWNER)
    expect(w.create).not.toHaveBeenCalled()
    const w2 = wire()
    await w2.service.triggerAfterCrawl(w2.ctx(OWNER), 999, OWNER)
    expect(w2.create).not.toHaveBeenCalled()
  })

  test('a new episode counts against the day and starts the workflow', async () => {
    const w = wire()
    const ep = w.eps.add()
    await w.service.triggerAfterCrawl(w.ctx(OWNER), BOOKMARK, OWNER)
    expect(w.create).toHaveBeenCalledWith({ id: expect.stringMatching(new RegExp(`^pod-${SOURCE}-`)), params: { episodeId: ep.id, sourceId: SOURCE, trigger: 'crawl' } })
    expect(w.redis.store.get(`podcast:${OWNER}:${today()}`)).toBe(1)
  })

  test('the sixth new episode of the day does not start; status says limit_reached and offers retry', async () => {
    const w = wire()
    w.eps.add()
    w.redis.store.set(`podcast:${OWNER}:${today()}`, 5)
    await w.service.triggerAfterCrawl(w.ctx(OWNER), BOOKMARK, OWNER)
    expect(w.create).not.toHaveBeenCalled()
    expect(w.redis.store.get(`podcast:${OWNER}:${today()}`)).toBe(5)
    expect(await w.service.getStatus(w.ctx(OWNER), UUID)).toMatchObject({ transcript: 'pending', reason: 'limit_reached', can_retry: true })
    const retried = await w.service.retry(w.ctx(OWNER), UUID)
    expect(retried).toMatchObject({ reason: 'limit_reached', can_retry: false })
    expect(w.create).not.toHaveBeenCalled()
  })

  test('an episode that is already done: the body is copied at once, no workflow, no daily count', async () => {
    const w = wire()
    w.readyEpisode()
    await w.service.triggerAfterCrawl(w.ctx(OWNER), BOOKMARK, OWNER)
    expect(w.objects.get('html/body/u1.html')).toContain('<article class="slax-pod-article"')
    expect(w.objects.get('text/body/u1.txt')).toContain('Second.')
    expect(w.forkRepo.publishRevision).toHaveBeenCalledWith(BOOKMARK, 'html/body/u1.html', expect.objectContaining({ content_word_count: expect.any(Number) }), expect.anything())
    expect(w.searchService.addSearchRecord).toHaveBeenCalledWith(expect.anything(), BOOKMARK, 'Ep', expect.stringContaining('Second.'))
    // the overview made from the show notes is dropped, so it is made again from the article
    expect(w.bookmarkRepo.deleteBookmarkSummary).toHaveBeenCalledWith(BOOKMARK, OWNER)
    expect(w.create).not.toHaveBeenCalled()
    expect(w.redis.store.get(`podcast:${OWNER}:${today()}`)).toBeUndefined()
  })

  test('a reader of another language gets a translation row and a start', async () => {
    const w = wire({ users: { [OWNER]: { ai_lang: 'zh', lang: 'zh' } } })
    w.readyEpisode()
    await w.service.triggerAfterCrawl(w.ctx(OWNER), BOOKMARK, OWNER)
    expect(w.arts.rows.map(r => [r.target_language, r.status])).toEqual([
      ['en', 'ready'],
      ['zh', 'pending']
    ])
    expect(w.create).toHaveBeenCalledTimes(1)
  })
})

describe('getStatus and getTranslation', () => {
  test('owner while transcribing; visitor sees no detail', async () => {
    const w = wire()
    w.eps.add({ transcript_status: 'transcribing' })
    expect(await w.service.getStatus(w.ctx(OWNER), UUID)).toMatchObject({ transcript: 'transcribing', article: 'unavailable', body_ready: false, can_retry: false })
    expect(await w.service.getStatus(w.ctx(VISITOR), UUID)).toMatchObject({ transcript: 'pending', can_retry: false, translation: null })
  })

  test('keeps ready articles readable with Labs disabled and hides flagged articles', async () => {
    const w = wire()
    w.readyEpisode()
    const zh = w.arts.add({ target_language: 'zh', status: 'ready', article_key: 'podcast/canonical/articles/x/zh.json' })
    w.objects.set(zh.article_key!, JSON.stringify(articleDoc('zh')))
    expect((await w.service.getStatus(w.ctx(OWNER), UUID)).body_ready).toBe(false)
    await w.service.publishBodies(w.ctx(OWNER), SOURCE)
    expect(await w.service.getStatus(w.ctx(OWNER), UUID)).toMatchObject({ transcript: 'ready', article: 'ready', body_ready: true, language: 'en', translation: null })
    const visitor = await w.service.getStatus(w.ctx(VISITOR), UUID)
    expect(visitor.translation).toEqual({ status: 'ready', language: 'zh', version: `${HASH.slice(0, 12)}-zh-1-v1` })

    const t = await w.service.getTranslation(w.ctx(VISITOR), UUID, visitor.translation!.version!)
    expect(t).toEqual({
      version: visitor.translation!.version,
      language: 'zh',
      lede: '导读。',
      sections: [{ heading: '标题', start_ms: 0, paragraphs: [{ speaker: '说话人 A', text: '第二句。', start_ms: 12_000 }] }]
    })
    await expect(w.service.getTranslation(w.ctx(VISITOR), UUID, `${HASH.slice(0, 12)}-en-1-v1`)).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })

    w.ub.moderation_result = 1
    expect((await w.service.getStatus(w.ctx(OWNER), UUID)).transcript).toBe('unavailable')
    await expect(w.service.getStatus(w.ctx(VISITOR), UUID)).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
    w.ub.moderation_result = 0
    w.labOn.clear()
    expect(await w.service.getStatus(w.ctx(OWNER), UUID)).toMatchObject({ transcript: 'ready', can_retry: false })
    expect((await w.service.getTranslation(w.ctx(VISITOR), UUID, visitor.translation!.version!)).language).toBe('zh')
  })

  test('a share that is turned off hides everything from visitors', async () => {
    const w = wire()
    w.readyEpisode()
    w.ub.metadata = { share: { is_enable: false } }
    await expect(w.service.getStatus(w.ctx(VISITOR), UUID)).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
  })

  test('visitors: a failed episode is unavailable, a running one is pending', async () => {
    const w = wire()
    const ep = w.eps.add({ transcript_status: 'failed', error_message: 'asr_timeout' })
    expect((await w.service.getStatus(w.ctx(VISITOR), UUID)).transcript).toBe('unavailable')
    ep.transcript_status = 'transcribing'
    expect((await w.service.getStatus(w.ctx(VISITOR), UUID)).transcript).toBe('pending')
  })

  test('visitors: an article that failed or was skipped is unavailable, with no reason; a running one shows no reason', async () => {
    const w = wire()
    const { en } = w.readyEpisode()
    en.status = 'skipped'
    en.error_message = 'too_long'
    expect(await w.service.getStatus(w.ctx(OWNER), UUID)).toMatchObject({ article: 'skipped', reason: 'too_long' })
    expect(await w.service.getStatus(w.ctx(VISITOR), UUID)).toMatchObject({ transcript: 'unavailable', article: 'unavailable', reason: null })
    en.status = 'failed'
    expect(await w.service.getStatus(w.ctx(VISITOR), UUID)).toMatchObject({ article: 'unavailable', reason: null })
    en.status = 'generating'
    expect(await w.service.getStatus(w.ctx(VISITOR), UUID)).toMatchObject({ transcript: 'ready', article: 'generating', reason: null, can_retry: false })
  })

  test('Labs off: a transcript that is not ready is unavailable to the owner, with no retry', async () => {
    const w = wire()
    w.labOn.clear()
    w.eps.add({ transcript_status: 'failed', error_message: 'asr_error:Download error' })
    expect(await w.service.getStatus(w.ctx(OWNER), UUID)).toMatchObject({ transcript: 'unavailable', can_retry: false })
  })
  test('skipped episodes report the reason without retry for final ones', async () => {
    const w = wire()
    w.eps.add({ transcript_status: 'skipped', error_message: 'too_long' })
    expect(await w.service.getStatus(w.ctx(OWNER), UUID)).toMatchObject({ transcript: 'skipped', reason: 'too_long', can_retry: false })
  })
})

describe('retry', () => {
  test('a failed transcript goes back to pending and starts; a final one is refused', async () => {
    const w = wire()
    const ep = w.eps.add({ transcript_status: 'failed', error_message: 'asr_error:Download error' })
    expect((await w.service.getStatus(w.ctx(OWNER), UUID)).can_retry).toBe(true)
    await w.service.retry(w.ctx(OWNER), UUID)
    expect(ep.transcript_status).toBe('pending')
    expect(w.create).toHaveBeenCalledWith(expect.objectContaining({ params: { episodeId: ep.id, sourceId: SOURCE, trigger: 'retry' } }))
    ep.transcript_status = 'failed'
    ep.error_message = 'too_long'
    await expect(w.service.retry(w.ctx(OWNER), UUID)).rejects.toMatchObject({ name: ErrorName.ERROR_PARAM })
  })

  test('a failed article is requeued; visitors cannot retry', async () => {
    const w = wire()
    const { en } = w.readyEpisode()
    Object.assign(en, { status: 'failed', error_message: 'quality:length_ratio' })
    await w.service.retry(w.ctx(OWNER), UUID)
    expect(en.status).toBe('pending')
    expect(w.create).toHaveBeenCalledTimes(1)
    await expect(w.service.retry(w.ctx(VISITOR), UUID)).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
  })
})

describe('bodies, moderation, translations', () => {
  test('publishBodies writes every bookmark of this transcript; skips flagged and stale ones', async () => {
    const w = wire()
    w.readyEpisode()
    w.bookmarks.set(101, { title: 'Ep', content_key: 'html/body/u2.html', content_md_key: 'text/body/u2.txt', moderation_result: 1 })
    w.bookmarks.set(102, { title: 'Ep', content_key: 'html/body/u3.html', content_md_key: 'text/body/u3.txt', moderation_result: 0 })
    w.arts.refs.push({ id: 2, bookmark_id: 101, user_id: 9, media_kind: 'podcast', source_id: SOURCE, source_hash: HASH, created_at: new Date(), updated_at: new Date() })
    w.arts.refs.push({ id: 3, bookmark_id: 102, user_id: 9, media_kind: 'podcast', source_id: SOURCE, source_hash: 'old', created_at: new Date(), updated_at: new Date() })
    expect(await w.service.publishBodies(w.ctx(0), SOURCE)).toBe(1)
    expect(w.objects.has('html/body/u1.html')).toBe(true)
    expect(w.objects.has('html/body/u2.html')).toBe(false)
    expect(w.objects.has('html/body/u3.html')).toBe(false)
    expect(w.objects.get('html/body/u1.html')).toContain('data-media-seek="12000"')
  })

  test('nothing to publish before the article is ready', async () => {
    const w = wire()
    const { en } = w.readyEpisode()
    en.status = 'generating'
    expect(await w.service.publishBodies(w.ctx(0), SOURCE)).toBe(0)
  })

  test('flagBookmarks flags every bookmark of the episode and turns its share off', async () => {
    const w = wire()
    w.arts.refs.push({ id: 2, bookmark_id: 101, user_id: 9, media_kind: 'podcast', source_id: SOURCE, source_hash: '', created_at: new Date(), updated_at: new Date() })
    expect(await w.service.flagBookmarks(SOURCE, 1)).toBe(2)
    expect(w.bookmarkService.updateBookmarkModerationResult).toHaveBeenCalledWith(101, 1)
    expect(w.bookmarkService.disableBookmarkShare).toHaveBeenCalledWith(BOOKMARK, OWNER)
    expect(w.alertBot.crawl.pushMessage).toHaveBeenCalledTimes(1)
  })

  test('translationTargets: languages of readers with the switch on, minus the original', async () => {
    const w = wire({ users: { [OWNER]: { ai_lang: '', lang: 'en' }, 9: { ai_lang: 'zh', lang: 'zh' }, 10: { ai_lang: 'zh', lang: 'zh' } }, labOn: [OWNER, 9] })
    w.arts.refs.push({ id: 2, bookmark_id: 101, user_id: 9, media_kind: 'podcast', source_id: SOURCE, source_hash: '', created_at: new Date(), updated_at: new Date() })
    w.arts.refs.push({ id: 3, bookmark_id: 102, user_id: 10, media_kind: 'podcast', source_id: SOURCE, source_hash: '', created_at: new Date(), updated_at: new Date() })
    expect(await w.service.translationTargets(SOURCE, 'en')).toEqual(['zh'])
    expect(await w.service.translationTargets(SOURCE, 'zh')).toEqual(['en'])
  })
})

describe('limits and sweep', () => {
  test('over the site budget: deferred an hour, one alert', async () => {
    const w = wire()
    const ep = w.eps.add()
    w.redis.store.set(`podcast_cost:${today()}`, 30 * 1_000_000)
    await w.service.triggerAfterCrawl(w.ctx(OWNER), BOOKMARK, OWNER)
    expect(w.create).not.toHaveBeenCalled()
    expect(ep.next_retry_at!.getTime()).toBeGreaterThan(Date.now() + 50 * 60 * 1000)
    expect(w.alertBot.crawl.pushMessage).toHaveBeenCalledTimes(1)
  })

  test('too many runs: deferred a minute', async () => {
    const w = wire()
    for (let i = 0; i < PODCAST_MAX_CONCURRENT; i++) w.eps.add({ source_id: `other${i}`, transcript_status: 'transcribing', lease_until: new Date(Date.now() + 60_000) })
    const ep = w.eps.add()
    await w.service.triggerAfterCrawl(w.ctx(OWNER), BOOKMARK, OWNER)
    expect(w.create).not.toHaveBeenCalled()
    expect(ep.next_retry_at).not.toBeNull()
  })

  test('sweep: an expired run goes back to pending; deferred episodes and article rows start; orphans are deleted', async () => {
    const w = wire()
    const dead = w.eps.add({ source_id: 'dead', transcript_status: 'transcribing', lease_until: new Date(Date.now() - 1000) })
    const deferred = w.eps.add({ source_id: 'deferred', next_retry_at: new Date(Date.now() - 1000) })
    const done = w.eps.add({ source_id: 'done', transcript_status: 'ready', transcript_hash: HASH })
    w.arts.add({ source_id: 'done', status: 'pending', next_retry_at: new Date(Date.now() - 1000) })
    const republish = w.eps.add({ source_id: 'republish', transcript_status: 'ready', transcript_hash: HASH, next_retry_at: new Date(Date.now() - 1000) })
    const orphan = w.eps.add({ source_id: 'orphan', transcript_status: 'ready' })
    w.objects.set('podcast/canonical/transcripts/orphan/x.json', '{}')
    w.eps.listOrphans.mockResolvedValueOnce([orphan])
    const res = await w.service.sweep(w.ctx(0))
    expect(dead.transcript_status).toBe('pending')
    expect(res).toMatchObject({ expired: 1, deleted: 1 })
    const started = w.create.mock.calls.map(c => (c[0] as { params: { episodeId: number } }).params.episodeId)
    expect(started).toEqual(expect.arrayContaining([deferred.id, done.id, republish.id]))
    expect(w.objects.has('podcast/canonical/transcripts/orphan/x.json')).toBe(false)
  })
})

describe('private podcast requests', () => {
  test('an owner retry reuses a ready canonical article without requeuing it', async () => {
    const w = wire()
    w.readyEpisode()
    const snapshots = (w.service as any).snapshots
    snapshots.load.mockResolvedValue({
      media: {
        kind: 'podcast',
        mode: 'capture',
        revision: 'r',
        sourceId: SOURCE,
        sourceHash: HASH,
        defaultLanguage: 'en',
        transcript: 'ready',
        bodyLanguage: null,
        player: { language: 'en' },
        variants: { en: { status: 'failed' } }
      }
    })
    await w.service.retry(w.ctx(OWNER), UUID)
    expect(snapshots.openRequest).toHaveBeenCalledWith(BOOKMARK, 'en')
    expect(w.arts.requeue).not.toHaveBeenCalled()
    expect(w.create).not.toHaveBeenCalled()
  })

  test('a pending private transcript held by the daily limit offers an explicit retry', async () => {
    const w = wire()
    w.eps.add()
    w.redis.store.set(`podcast:${OWNER}:${today()}`, 5)
    const snapshots = (w.service as any).snapshots
    snapshots.load.mockResolvedValue({
      media: {
        kind: 'podcast',
        mode: 'capture',
        revision: 'r',
        sourceId: SOURCE,
        sourceHash: '',
        defaultLanguage: 'en',
        transcript: 'pending',
        bodyLanguage: null,
        player: { language: 'en' },
        variants: { en: { status: 'pending' } }
      }
    })
    expect(await w.service.getStatus(w.ctx(OWNER), UUID)).toMatchObject({ reason: 'limit_reached', can_retry: true })
    expect(w.create).not.toHaveBeenCalled()
  })
})

describe('fixed body reference filtering', () => {
  test('only inspected legacy references advance to a new transcript hash', async () => {
    const w = wire()
    w.readyEpisode()
    w.arts.refs.push(...[201, 202].map(bookmark_id => ({ bookmark_id, user_id: OWNER, source_id: SOURCE, source_hash: HASH }) as any))
    ;(w.service as any).snapshots.load.mockImplementation(async (id: number) => {
      if (id === 201) return { managed: true }
      if (id === 202) throw new Error('broken manifest')
      return { managed: false, raw: { id, updated_at: new Date('2026-10-23T00:00:00Z'), content_key: 'html/body/u1.html', status: 'success' } }
    })
    await w.service.setRefsHash(SOURCE, 'new-hash')
    expect(w.arts.setRefsHash).toHaveBeenCalledWith(SOURCE, 'new-hash', [{ bookmarkId: BOOKMARK, updatedAt: new Date('2026-10-23T00:00:00Z'), contentKey: 'html/body/u1.html' }])
  })

  test('a broken reference cannot prevent publication to a later legacy bookmark', async () => {
    const w = wire()
    w.readyEpisode()
    w.arts.refs.unshift({ bookmark_id: 201, user_id: OWNER, source_id: SOURCE, source_hash: HASH } as any)
    ;(w.service as any).snapshots.load.mockImplementation(async (id: number) => {
      if (id === 201) throw new Error('broken manifest')
      return null
    })
    await expect(w.service.publishBodies(w.ctx(OWNER), SOURCE)).rejects.toThrow('Media body publication incomplete')
    expect(w.objects.get('html/body/u1.html')).toContain('slax-pod-article')
  })
})


test('publication preserves an annotated legacy body and reports it as unpublished', async () => {
  const w = wire()
  w.readyEpisode()
  w.markRepo.bodyHasMarks.mockResolvedValue(true)
  const before = w.objects.get('html/body/u1.html')
  expect(await w.service.publishBodies(w.ctx(OWNER), SOURCE)).toBe(0)
  expect(w.objects.get('html/body/u1.html')).toBe(before)
  expect((await w.service.getStatus(w.ctx(OWNER), UUID)).body_ready).toBe(false)
})

test('an annotated body keeps its notes and offers the original article below it', async () => {
  const w = wire()
  w.readyEpisode()
  w.markRepo.bodyHasMarks.mockResolvedValue(true)
  await w.service.publishBodies(w.ctx(OWNER), SOURCE)
  const version = `${HASH.slice(0, 12)}-en-1-v1`
  for (const viewer of [OWNER, VISITOR]) {
    expect(await w.service.getStatus(w.ctx(viewer), UUID)).toMatchObject({ article: 'ready', body_ready: false, body_mode: 'transcript', article_version: version })
    const article = await w.service.getTranslation(w.ctx(viewer), UUID, version)
    expect(article).toMatchObject({ version, language: 'en', lede: 'Lede.' })
    expect(article.sections[0].paragraphs[0]).toMatchObject({ text: 'Second.', start_ms: 12_000 })
  }
})

test('a published or unmarked body offers no article below it', async () => {
  const w = wire()
  w.readyEpisode()
  expect(await w.service.getStatus(w.ctx(OWNER), UUID)).toMatchObject({ body_ready: false, body_mode: 'article', article_version: null })
  await w.service.publishBodies(w.ctx(OWNER), SOURCE)
  expect(await w.service.getStatus(w.ctx(OWNER), UUID)).toMatchObject({ body_ready: true, body_mode: 'article', article_version: null })
  await expect(w.service.getTranslation(w.ctx(VISITOR), UUID, `${HASH.slice(0, 12)}-en-1-v1`)).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
})

test('a body with an older article keeps showing it, with no article below', async () => {
  const w = wire()
  const { en } = w.readyEpisode()
  await w.service.publishBodies(w.ctx(OWNER), SOURCE)
  w.markRepo.bodyHasMarks.mockResolvedValue(true)
  en.prompt_version = 'v2'
  const version = `${HASH.slice(0, 12)}-en-1-v2`
  expect(await w.service.getStatus(w.ctx(OWNER), UUID)).toMatchObject({ body_ready: false, body_mode: 'article', article_version: null })
  await expect(w.service.getTranslation(w.ctx(OWNER), UUID, version)).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
})
