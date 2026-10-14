/**
 * YoutubeArticleService: who sees which article version, the three ways a generation starts, the
 * daily and budget limits, the sweep and takedown. The repository is an in-memory stand-in with
 * the same compare-and-set rules; the real SQL is covered by youtubeArticleRepo.integration.test.ts.
 * 来源: src/domain/youtubeArticle.ts, docs/youtube-article/spec.md 9 节、13 节
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { YoutubeArticleService, YOUTUBE_ARTICLE_DAILY_LIMITS } from '@/domain/youtubeArticle'
import { eligibilityDecision, type youtubeArticlePO, type youtubeArticleRefPO } from '@/infra/repository/dbYoutubeArticle'
import { resolveBookmarkReadAccess } from '@/utils/bookmarkAccess'
import { ErrorName } from '@/const/err'
import { createMockCtx } from '@test/helpers/mockFactory'

const OWNER = 7
const VISITOR = 8
const VIDEO = 'dQw4w9WgXcQ'
const HASH = 'f'.repeat(64)
const BOOKMARK = 100
const UUID = 'ub-uuid-1'

// ---------- in-memory repository with the same state rules ----------

function memRepo() {
  const rows: youtubeArticlePO[] = []
  const refs: youtubeArticleRefPO[] = []
  let id = 0
  const now = () => new Date()
  const running = (r: youtubeArticlePO) => r.status === 'generating' || r.status === 'validating'
  const repo = {
    rows,
    refs,
    add(over: Partial<youtubeArticlePO>): youtubeArticlePO {
      const row: youtubeArticlePO = {
        id: ++id,
        source_id: VIDEO,
        caption_key: `youtube/canonical/captions/${VIDEO}/${HASH}.json`,
        caption_text_key: `youtube/canonical/captions/${VIDEO}/${HASH}.txt`,
        caption_language: 'en',
        caption_kind: 'manual',
        source_hash: HASH,
        target_language: 'en',
        eligibility_json: { decision: 'generate', reason_codes: [] },
        status: 'pending',
        article_key: null,
        article_text_key: null,
        model: null,
        prompt_version: 'v1',
        schema_version: 1,
        quality_json: null,
        retry_count: 0,
        lease_until: null,
        next_retry_at: null,
        error_message: null,
        created_at: now(),
        updated_at: now(),
        started_at: null,
        completed_at: null,
        ...over
      }
      rows.push(row)
      return row
    },
    findRef: vi.fn(async (bookmarkId: number) => refs.find(r => r.bookmark_id === bookmarkId) ?? null),
    findAnyRef: vi.fn(async (v: string, h: string) => refs.find(r => r.source_id === v && r.source_hash === h) ?? null),
    findById: vi.fn(async (rid: number) => rows.find(r => r.id === rid) ?? null),
    findVersion: vi.fn(async (v: string, h: string, lang: string) => rows.find(r => r.source_id === v && r.source_hash === h && r.target_language === lang) ?? null),
    listForSource: vi.fn(async (v: string, h: string) => rows.filter(r => r.source_id === v && r.source_hash === h)),
    ensureLanguageRow: vi.fn(async (base: youtubeArticlePO, lang: string) => {
      const existing = rows.find(r => r.source_id === base.source_id && r.source_hash === base.source_hash && r.target_language === lang)
      if (existing) return existing
      const status = base.status === 'takedown' ? 'takedown' : eligibilityDecision(base) === 'generate' ? 'pending' : 'skipped'
      return repo.add({ ...base, id: undefined as any, target_language: lang, status, article_key: null, retry_count: 0, next_retry_at: null })
    }),
    requeue: vi.fn(async (rid: number, reset: boolean) => {
      const r = rows.find(x => x.id === rid)
      if (!r || !(reset ? ['failed'] : ['skipped', 'failed']).includes(r.status)) return false
      if (['budget_exceeded', 'too_long'].some(c => (r.error_message ?? '').startsWith(c))) return false
      Object.assign(r, { status: 'pending', next_retry_at: now(), error_message: null }, reset ? { retry_count: 0 } : {})
      return true
    }),
    defer: vi.fn(async (rid: number, at: Date) => {
      const r = rows.find(x => x.id === rid && x.status === 'pending')
      if (!r) return false
      r.next_retry_at = at
      return true
    }),
    countRunning: vi.fn(async () => rows.filter(r => running(r) && r.lease_until && r.lease_until > now()).length),
    listRunnable: vi.fn(async (limit: number) => rows.filter(r => r.status === 'pending' && r.next_retry_at && r.next_retry_at <= now()).slice(0, limit)),
    listExpiredLeases: vi.fn(async () => rows.filter(r => running(r) && (!r.lease_until || r.lease_until < now()))),
    finishAttempt: vi.fn(async (rid: number, o: { kind: string; error: string; retryDelayMs?: number }, guard: { expiredBefore?: Date } = {}) => {
      const r = rows.find(x => x.id === rid)
      if (!r || !running(r)) return null
      if (guard.expiredBefore && r.lease_until && r.lease_until >= guard.expiredBefore) return null
      r.retry_count++
      r.status = o.kind === 'retry' && r.retry_count < 3 ? 'pending' : 'failed'
      r.next_retry_at = r.status === 'pending' ? new Date(Date.now() + (o.retryDelayMs ?? 600_000)) : null
      r.error_message = o.error
      return r.status
    }),
    listOrphans: vi.fn(async (olderThan: Date) =>
      rows.filter(r => !running(r) && r.status !== 'takedown' && r.updated_at < olderThan && !refs.some(f => f.source_id === r.source_id && f.source_hash === r.source_hash))
    ),
    deleteOrphan: vi.fn(async (rid: number, olderThan: Date) => {
      const i = rows.findIndex(r => r.id === rid && r.updated_at < olderThan)
      if (i < 0) return false
      rows.splice(i, 1)
      return true
    }),
    countRowsUsingKey: vi.fn(async (col: 'caption_key' | 'caption_text_key', key: string) => rows.filter(r => r[col] === key).length),
    listForVideo: vi.fn(async (v: string) => rows.filter(r => r.source_id === v)),
    listTakedownsToClean: vi.fn(async () => [...new Set(rows.filter(r => r.status === 'takedown' && (r.caption_key || r.article_key)).map(r => r.source_id))]),
    takedownVideo: vi.fn(async (v: string) => {
      const hit = rows.filter(r => r.source_id === v)
      hit.forEach(r => Object.assign(r, { status: 'takedown', article_key: null, article_text_key: null, caption_key: null, caption_text_key: null }))
      return hit.length
    }),
    unlinkBookmark: vi.fn(async () => 1),
    listBackfillCandidates: vi.fn(async (_limit: number, _before?: number): Promise<any[]> => [])
  }
  return repo
}

// ---------- other collaborators ----------

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
  const client = {
    store,
    youtubeArticleDaily: (u: number, d: string, k: string) => op(`yt_article:${u}:${d}:${k}`),
    youtubeArticleCost: (d: string) => op(`yt_article_cost:${d}`),
    youtubeArticleStartLock: (i: number) => op(`yt_article_start:${i}`),
    youtubeArticleBudgetAlert: (d: string) => op(`yt_article_budget_alert:${d}`)
  }
  return client
}

interface Bookmark {
  user_id: number
  deleted_at: Date | null
  metadata: unknown
  moderation_result: number
}

function wire(opts: { users?: Record<number, { ai_lang: string; lang: string; snapshot_sharing?: boolean }>; labOn?: number[] } = {}) {
  const repo = memRepo()
  const redis = memRedis()
  const users = opts.users ?? { [OWNER]: { ai_lang: '', lang: 'en' }, [VISITOR]: { ai_lang: 'zh', lang: 'zh' } }
  const labOn = new Set(opts.labOn ?? [OWNER])
  const bookmark: Bookmark = { user_id: OWNER, deleted_at: null, metadata: { share: { is_enable: true } }, moderation_result: 0 }
  const bookmarkService = {
    getUserBookmarkByUuidWithDetail: vi.fn(async (uuid: string) =>
      uuid === UUID
        ? {
            uuid,
            user_id: bookmark.user_id,
            bookmark_id: BOOKMARK,
            deleted_at: bookmark.deleted_at,
            metadata: bookmark.metadata,
            alias_title: '',
            bookmark: { title: 'Attention', moderation_result: bookmark.moderation_result }
          }
        : null
    ),
    getBookmarkById: vi.fn(async () => ({ title: 'Attention' })),
    // The real access rule; the share record comes from bookmark.metadata.share
    getBookmarkReadAccess: vi.fn(async (ctx: { getUserId(): number }, uuid: string) =>
      resolveBookmarkReadAccess(
        {
          getUserBookmarkByUuidWithDetail: (id: string) => bookmarkService.getUserBookmarkByUuidWithDetail(id),
          getBookmarkShareByBookmarkId: async () => (bookmark.metadata as { share?: { is_enable: boolean } } | null)?.share ?? null
        } as any,
        userRepo as any,
        ctx.getUserId(),
        uuid
      )
    )
  }
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
  const objects = new Map<string, string>()
  const bucket = {
    R2Bucket: {
      get: vi.fn(async (k: string) => (objects.has(k) ? { text: async () => objects.get(k)! } : null)),
      delete: vi.fn(async (k: string | string[]) => {
        for (const key of Array.isArray(k) ? k : [k]) objects.delete(key)
      }),
      list: vi.fn(async ({ prefix }: { prefix: string }) => ({ objects: [...objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false }))
    }
  }
  const alertBot = { crawl: { pushMessage: vi.fn(async () => {}) } }
  const crawlService = {
    fetchYoutubeData: vi.fn(async (_ctx: any, url: string) => ({ videoId: url.slice(-11), caption: null, cues: [] })),
    saveYoutubeCaptionArtifacts: vi.fn(async (ctx: any, fetched: { videoId: string }, bookmarkId: number) => {
      repo.refs.push({ id: 99, bookmark_id: bookmarkId, user_id: ctx.getUserId(), source_id: fetched.videoId, source_hash: 'h', created_at: new Date(), updated_at: new Date() })
    })
  }
  const service = new (YoutubeArticleService as any)(
    repo,
    bookmarkService,
    labService,
    userRepo,
    () => redis,
    () => bucket,
    alertBot,
    crawlService
  ) as YoutubeArticleService
  const create = vi.fn(async () => ({}))
  const ctx = (userId: number) => {
    const c = createMockCtx({ userId })
    c.env.YOUTUBE_ARTICLE_WORKFLOW = { create }
    return c
  }
  repo.refs.push({ id: 1, bookmark_id: BOOKMARK, user_id: OWNER, source_id: VIDEO, source_hash: HASH, created_at: new Date(), updated_at: new Date() })
  return { service, repo, redis, bookmark, labOn, users, objects, create, ctx, alertBot, crawlService }
}

const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

// ---------- tests ----------

describe('owner opens a bookmark', () => {
  let w: ReturnType<typeof wire>
  beforeEach(() => {
    w = wire()
  })

  test('the eligible pending row in their language starts once and counts once', async () => {
    w.repo.add({})
    const res = await w.service.getStatus(w.ctx(OWNER), UUID)
    expect(res).toMatchObject({ status: 'pending', language: 'en', requested_language: 'en', can_generate: false, article_url: null })
    expect(w.create).toHaveBeenCalledTimes(1)
    expect(w.create.mock.calls[0][0]).toMatchObject({ params: { articleId: 1, videoId: VIDEO, sourceHash: HASH, targetLanguage: 'en', title: 'Attention', trigger: 'open' } })
    expect((w.create.mock.calls[0][0] as any).id).toMatch(/^yta-dQw4w9WgXcQ-ffffffffffff-en-v1-[0-9a-z]+$/)
    expect(w.redis.store.get(`yt_article:${OWNER}:${today()}:auto`)).toBe(1)

    // a second poll while the start lock is held starts nothing and gives the count back
    await w.service.getStatus(w.ctx(OWNER), UUID)
    expect(w.create).toHaveBeenCalledTimes(1)
    expect(w.redis.store.get(`yt_article:${OWNER}:${today()}:auto`)).toBe(1)
  })

  test('a missing language version is created from the gate result of a sibling and started', async () => {
    w.repo.add({ target_language: 'en', status: 'ready', article_key: 'a.json' })
    w.users[OWNER] = { ai_lang: 'zh', lang: 'en' }
    const res = await w.service.getStatus(w.ctx(OWNER), UUID)
    expect(res).toMatchObject({ status: 'pending', language: 'zh', requested_language: 'zh' })
    expect(w.repo.rows.map(r => r.target_language)).toEqual(['en', 'zh'])
    expect(w.create).toHaveBeenCalledTimes(1)
    expect(w.create.mock.calls[0][0]).toMatchObject({ params: { targetLanguage: 'zh' } })
  })

  test('switching back to a language that is ready reads it and starts nothing', async () => {
    w.repo.add({ target_language: 'en', status: 'ready', article_key: `youtube/canonical/articles/${VIDEO}/${HASH}-en-1-v1.json` })
    w.repo.add({ target_language: 'zh', status: 'ready', article_key: `youtube/canonical/articles/${VIDEO}/${HASH}-zh-1-v1.json` })
    w.users[OWNER] = { ai_lang: 'zh', lang: 'en' }
    expect(await w.service.getStatus(w.ctx(OWNER), UUID)).toMatchObject({ status: 'ready', language: 'zh', version: 'ffffffffffff-zh-1-v1' })
    w.users[OWNER] = { ai_lang: 'en', lang: 'en' }
    const res = await w.service.getStatus(w.ctx(OWNER), UUID)
    expect(res).toMatchObject({ status: 'ready', language: 'en', version: 'ffffffffffff-en-1-v1', format: 'article' })
    expect(res.article_url).toBe(`/v1/youtube_article/content?bookmark_uid=${UUID}&version=ffffffffffff-en-1-v1`)
    expect(w.create).not.toHaveBeenCalled()
  })

  test('skipped by the gate: no start, manual generate offered', async () => {
    w.repo.add({ status: 'skipped', eligibility_json: { decision: 'skip', reason_codes: ['high_visual_dependency'] } })
    const res = await w.service.getStatus(w.ctx(OWNER), UUID)
    expect(res).toMatchObject({ status: 'skipped', can_generate: true, can_retry: false, eligibility: { decision: 'skip', reason_codes: ['high_visual_dependency'] } })
    expect(w.create).not.toHaveBeenCalled()
  })

  test('the 21st automatic start of the day returns limit_reached and starts nothing', async () => {
    w.redis.store.set(`yt_article:${OWNER}:${today()}:auto`, YOUTUBE_ARTICLE_DAILY_LIMITS.auto)
    w.repo.add({})
    const res = await w.service.getStatus(w.ctx(OWNER), UUID)
    expect(res.status).toBe('limit_reached')
    expect(w.create).not.toHaveBeenCalled()
    expect(w.redis.store.get(`yt_article:${OWNER}:${today()}:auto`)).toBe(YOUTUBE_ARTICLE_DAILY_LIMITS.auto)
  })

  test('too many running rows: the row is deferred for the sweeper and keeps its count', async () => {
    for (let i = 0; i < 4; i++) w.repo.add({ source_id: `other${i}`, status: 'generating', lease_until: new Date(Date.now() + 60_000) })
    const row = w.repo.add({})
    await w.service.getStatus(w.ctx(OWNER), UUID)
    expect(w.create).not.toHaveBeenCalled()
    expect(row.next_retry_at).toBeInstanceOf(Date)
    // the sweep will run it later, so the start is counted now; further polls do not count again
    expect(w.redis.store.get(`yt_article:${OWNER}:${today()}:auto`)).toBe(1)
    await w.service.getStatus(w.ctx(OWNER), UUID)
    expect(w.redis.store.get(`yt_article:${OWNER}:${today()}:auto`)).toBe(1)
  })

  test('over the site-wide daily budget: deferred, one alert per day', async () => {
    w.redis.store.set(`yt_article_cost:${today()}`, 20_000_001)
    const row = w.repo.add({})
    await w.service.getStatus(w.ctx(OWNER), UUID)
    await w.service.getStatus(w.ctx(OWNER), UUID)
    expect(w.create).not.toHaveBeenCalled()
    expect(row.next_retry_at).toBeInstanceOf(Date)
    expect(w.alertBot.crawl.pushMessage).toHaveBeenCalledTimes(1)
  })

  test('Labs switch off: unavailable, nothing created or started', async () => {
    w.labOn.clear()
    w.repo.add({})
    expect((await w.service.getStatus(w.ctx(OWNER), UUID)).status).toBe('unavailable')
    expect(w.create).not.toHaveBeenCalled()
  })

  test('bookmark saved before P0 (no ref): unavailable', async () => {
    w.repo.refs.length = 0
    expect((await w.service.getStatus(w.ctx(OWNER), UUID)).status).toBe('unavailable')
  })

  test('flagged by moderation: unavailable for the owner too, nothing started, no manual generate', async () => {
    w.repo.add({})
    w.bookmark.moderation_result = 2
    expect((await w.service.getStatus(w.ctx(OWNER), UUID)).status).toBe('unavailable')
    expect(w.create).not.toHaveBeenCalled()
    await expect(w.service.request(w.ctx(OWNER), UUID, 'generate')).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
  })

  test('takedown: unavailable', async () => {
    w.repo.add({ status: 'takedown' })
    expect((await w.service.getStatus(w.ctx(OWNER), UUID)).status).toBe('unavailable')
  })
})

describe('sharing between users', () => {
  test('a second user with the same AI language reads the same version and starts nothing', async () => {
    const w = wire({ labOn: [OWNER, VISITOR], users: { [OWNER]: { ai_lang: 'zh', lang: 'zh' }, [VISITOR]: { ai_lang: 'zh', lang: 'zh' } } })
    w.repo.add({ target_language: 'zh', status: 'ready', article_key: 'x.json' })
    // the second user's own bookmark of the same video and caption version
    w.repo.refs.push({ id: 2, bookmark_id: 200, user_id: VISITOR, source_id: VIDEO, source_hash: HASH, created_at: new Date(), updated_at: new Date() })
    const base = (w.service as any).bookmarkService.getUserBookmarkByUuidWithDetail.getMockImplementation()
    ;(w.service as any).bookmarkService.getUserBookmarkByUuidWithDetail.mockImplementation(async (uuid: string) =>
      uuid === 'ub-uuid-2'
        ? { uuid, user_id: VISITOR, bookmark_id: 200, deleted_at: null, metadata: {}, alias_title: '', bookmark: { title: 'Attention', moderation_result: 0 } }
        : base(uuid)
    )
    const first = await w.service.getStatus(w.ctx(OWNER), UUID)
    const second = await w.service.getStatus(w.ctx(VISITOR), 'ub-uuid-2')
    expect(second).toMatchObject({ status: 'ready', language: 'zh', version: first.version })
    expect(w.repo.rows).toHaveLength(1)
    expect(w.create).not.toHaveBeenCalled()
  })
})

describe('permission matrix', () => {
  test('visitor sees only a ready article: theirs, else the owner language; never starts anything', async () => {
    const w = wire()
    w.repo.add({ target_language: 'en', status: 'ready', article_key: 'x.json' })
    const res = await w.service.getStatus(w.ctx(VISITOR), UUID)
    expect(res).toMatchObject({ status: 'ready', language: 'en', requested_language: 'zh', can_generate: false, can_retry: false })
    expect(w.repo.rows).toHaveLength(1)

    w.repo.rows[0].status = 'pending'
    expect((await w.service.getStatus(w.ctx(VISITOR), UUID)).status).toBe('unavailable')
    expect(w.create).not.toHaveBeenCalled()
  })

  test('anonymous visitor reads in the owner language', async () => {
    const w = wire()
    w.users[OWNER] = { ai_lang: 'zh', lang: 'zh' }
    w.repo.add({ target_language: 'zh', status: 'ready', article_key: 'x.json' })
    expect(await w.service.getStatus(w.ctx(0), UUID)).toMatchObject({ status: 'ready', language: 'zh', requested_language: 'zh' })
  })

  test.each([
    ['share turned off', (b: Bookmark) => (b.metadata = { share: { is_enable: false } })],
    ['bookmark trashed', (b: Bookmark) => (b.deleted_at = new Date())],
    ['flagged by moderation', (b: Bookmark) => (b.moderation_result = 1)]
  ])('visitor is refused when %s', async (_, change) => {
    const w = wire()
    w.repo.add({ status: 'ready', article_key: 'x.json' })
    change(w.bookmark)
    await expect(w.service.getStatus(w.ctx(VISITOR), UUID)).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
  })

  test('the owner still reads when the share is off or the bookmark is trashed', async () => {
    const w = wire()
    w.repo.add({ status: 'ready', article_key: 'x.json' })
    w.bookmark.metadata = { share: { is_enable: false } }
    w.bookmark.deleted_at = new Date()
    expect((await w.service.getStatus(w.ctx(OWNER), UUID)).status).toBe('ready')
  })

  test('no share record: the owner default decides', async () => {
    const w = wire()
    w.repo.add({ status: 'ready', article_key: 'x.json' })
    w.bookmark.metadata = null
    w.users[OWNER] = { ai_lang: '', lang: 'en', snapshot_sharing: false }
    await expect(w.service.getStatus(w.ctx(VISITOR), UUID)).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
    w.users[OWNER] = { ai_lang: '', lang: 'en', snapshot_sharing: true }
    expect((await w.service.getStatus(w.ctx(VISITOR), UUID)).status).toBe('ready')
  })

  test('unknown uuid → not found; empty uuid → bad request', async () => {
    const w = wire()
    await expect(w.service.getStatus(w.ctx(OWNER), 'nope')).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
    await expect(w.service.getStatus(w.ctx(OWNER), '')).rejects.toMatchObject({ name: ErrorName.ERROR_PARAM })
  })

  test('only the owner may generate or retry', async () => {
    const w = wire()
    w.repo.add({ status: 'failed' })
    await expect(w.service.request(w.ctx(VISITOR), UUID, 'retry')).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
    await expect(w.service.request(w.ctx(0), UUID, 'generate')).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
  })
})

describe('content', () => {
  test('returns the structured article of a ready version the bookmark can see, without cue ids', async () => {
    const w = wire()
    const key = `youtube/canonical/articles/${VIDEO}/${HASH}-en-1-v1.json`
    w.repo.add({ status: 'ready', article_key: key })
    const doc = {
      schema_version: 1,
      language: 'en',
      format: 'dialogue',
      lede: 'Lede <b>',
      sections: [{ heading: 'H', start_ms: 420000, end_ms: 500000, paragraphs: [{ speaker: 'Ann', text: 'Hi', source_cue_ids: ['c0001'] }] }]
    }
    w.objects.set(key, JSON.stringify(doc))
    expect(await w.service.getContent(w.ctx(VISITOR), UUID, 'ffffffffffff-en-1-v1')).toEqual({
      version: 'ffffffffffff-en-1-v1',
      language: 'en',
      format: 'dialogue',
      lede: 'Lede <b>',
      sections: [{ heading: 'H', start_ms: 420000, paragraphs: [{ speaker: 'Ann', text: 'Hi' }] }]
    })
  })

  test('a version of another video, a guessed version or a not-ready row is not found', async () => {
    const w = wire()
    w.repo.add({ source_id: 'otherVideo1', status: 'ready', article_key: 'o.json' })
    w.repo.add({ status: 'generating' })
    await expect(w.service.getContent(w.ctx(OWNER), UUID, 'ffffffffffff-en-1-v1')).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
    await expect(w.service.getContent(w.ctx(OWNER), UUID, '../../secret')).rejects.toMatchObject({ name: ErrorName.BOOKMARK_NOT_FOUND })
  })
})

describe('manual generate and retry', () => {
  test('generate runs a skipped version and counts against the manual limit', async () => {
    const w = wire()
    const row = w.repo.add({ status: 'skipped', eligibility_json: { decision: 'review', reason_codes: ['non_en_zh_language'] } })
    const res = await w.service.request(w.ctx(OWNER), UUID, 'generate')
    expect(row.status).toBe('pending')
    expect(w.create).toHaveBeenCalledTimes(1)
    expect(w.create.mock.calls[0][0]).toMatchObject({ params: { trigger: 'manual' } })
    expect(res.status).toBe('pending')
    expect(w.redis.store.get(`yt_article:${OWNER}:${today()}:manual`)).toBe(1)
  })

  test('the 6th manual generate of the day is refused', async () => {
    const w = wire()
    w.redis.store.set(`yt_article:${OWNER}:${today()}:manual`, YOUTUBE_ARTICLE_DAILY_LIMITS.manual)
    const row = w.repo.add({ status: 'skipped' })
    const res = await w.service.request(w.ctx(OWNER), UUID, 'generate')
    expect(res.status).toBe('limit_reached')
    expect(row.status).toBe('skipped')
    expect(w.create).not.toHaveBeenCalled()
    expect((await w.service.getStatus(w.ctx(OWNER), UUID)).can_generate).toBe(false)
  })

  test('a version skipped for length offers no generate button', async () => {
    const w = wire()
    w.repo.add({ status: 'skipped', error_message: 'too_long' })
    expect((await w.service.getStatus(w.ctx(OWNER), UUID)).can_generate).toBe(false)
  })

  test('a version that ran out of budget can not be retried', async () => {
    const w = wire()
    w.repo.add({ status: 'failed', error_message: 'budget_exceeded' })
    expect((await w.service.getStatus(w.ctx(OWNER), UUID)).can_retry).toBe(false)
    await expect(w.service.request(w.ctx(OWNER), UUID, 'retry')).rejects.toMatchObject({ name: ErrorName.ERROR_PARAM })
    expect(w.create).not.toHaveBeenCalled()
  })

  test('a requested row whose start is blocked by the lock is deferred, so the sweep still runs it', async () => {
    const w = wire()
    const row = w.repo.add({ status: 'skipped' })
    w.redis.store.set(`yt_article_start:${row.id}`, 1)
    await w.service.request(w.ctx(OWNER), UUID, 'generate')
    expect(row.status).toBe('pending')
    expect(w.create).not.toHaveBeenCalled()
    expect(row.next_retry_at).toBeInstanceOf(Date)
  })

  test('retry needs a failed row, resets attempts and does not count', async () => {
    const w = wire()
    const row = w.repo.add({ status: 'failed', retry_count: 3 })
    await w.service.request(w.ctx(OWNER), UUID, 'retry')
    expect(row).toMatchObject({ status: 'pending', retry_count: 0 })
    expect(w.create.mock.calls[0][0]).toMatchObject({ params: { trigger: 'retry' } })
    expect(w.redis.store.get(`yt_article:${OWNER}:${today()}:manual`)).toBeUndefined()

    row.status = 'ready'
    await expect(w.service.request(w.ctx(OWNER), UUID, 'retry')).rejects.toMatchObject({ name: ErrorName.ERROR_PARAM })
  })

  test('generate on a ready or running row changes nothing', async () => {
    const w = wire()
    w.repo.add({ status: 'ready', article_key: 'x.json' })
    expect((await w.service.request(w.ctx(OWNER), UUID, 'generate')).status).toBe('ready')
    expect(w.create).not.toHaveBeenCalled()
  })

  test('Labs off → the Labs error', async () => {
    const w = wire()
    w.labOn.clear()
    w.repo.add({ status: 'skipped' })
    await expect(w.service.request(w.ctx(OWNER), UUID, 'generate')).rejects.toMatchObject({ name: ErrorName.LAB_FEATURE_DISABLED })
  })
})

describe('after the crawl', () => {
  test('starts the saver language version and counts it as an automatic start', async () => {
    const w = wire()
    w.repo.add({})
    await w.service.triggerAfterCrawl(w.ctx(OWNER), BOOKMARK, OWNER, 'Attention')
    expect(w.create).toHaveBeenCalledTimes(1)
    expect(w.create.mock.calls[0][0]).toMatchObject({ params: { trigger: 'crawl', title: 'Attention' } })
    expect(w.redis.store.get(`yt_article:${OWNER}:${today()}:auto`)).toBe(1)
  })

  test('a save over the daily automatic limit starts nothing and keeps the row pending', async () => {
    const w = wire()
    w.redis.store.set(`yt_article:${OWNER}:${today()}:auto`, YOUTUBE_ARTICLE_DAILY_LIMITS.auto)
    const row = w.repo.add({})
    await w.service.triggerAfterCrawl(w.ctx(OWNER), BOOKMARK, OWNER, 'Attention')
    expect(w.create).not.toHaveBeenCalled()
    expect(row.status).toBe('pending')
    expect(w.redis.store.get(`yt_article:${OWNER}:${today()}:auto`)).toBe(YOUTUBE_ARTICLE_DAILY_LIMITS.auto)
  })

  test('does nothing when Labs is off, the gate said skip, or there is no ref; never throws', async () => {
    const off = wire()
    off.labOn.clear()
    off.repo.add({})
    await off.service.triggerAfterCrawl(off.ctx(OWNER), BOOKMARK, OWNER, 't')

    const skip = wire()
    skip.repo.add({ status: 'skipped', eligibility_json: { decision: 'skip', reason_codes: [] } })
    await skip.service.triggerAfterCrawl(skip.ctx(OWNER), BOOKMARK, OWNER, 't')

    const noRef = wire()
    noRef.repo.refs.length = 0
    await noRef.service.triggerAfterCrawl(noRef.ctx(OWNER), BOOKMARK, OWNER, 't')

    const broken = wire()
    broken.repo.findRef.mockRejectedValue(new Error('pg down'))
    await expect(broken.service.triggerAfterCrawl(broken.ctx(OWNER), BOOKMARK, OWNER, 't')).resolves.toBeUndefined()

    expect([off, skip, noRef, broken].every(x => x.create.mock.calls.length === 0)).toBe(true)
  })
})

describe('sweep', () => {
  test('expired leases go back to pending with a delay, then the next sweep starts them; never-requested rows stay idle', async () => {
    const w = wire()
    const dead = w.repo.add({ status: 'generating', lease_until: new Date(Date.now() - 1000) })
    const idle = w.repo.add({ source_id: 'idleVideo01' })
    expect(await w.service.sweep(w.ctx(0))).toMatchObject({ expired: 1, started: 0 })
    expect(dead).toMatchObject({ status: 'pending', retry_count: 1, error_message: 'lease_expired' })
    expect(w.create).not.toHaveBeenCalled()

    dead.next_retry_at = new Date(Date.now() - 1)
    expect(await w.service.sweep(w.ctx(0))).toMatchObject({ started: 1 })
    expect(w.create.mock.calls[0]![0]).toMatchObject({ params: { articleId: dead.id, trigger: 'sweep', title: 'Attention' } })
    expect(idle.status).toBe('pending')
  })

  test('a lease renewed after the sweep listed it is left alone', async () => {
    const w = wire()
    const row = w.repo.add({ status: 'generating', lease_until: new Date(Date.now() - 1000) })
    w.repo.listExpiredLeases.mockImplementationOnce(async () => {
      const listed = [{ ...row }]
      row.lease_until = new Date(Date.now() + 60_000)
      return listed
    })
    expect((await w.service.sweep(w.ctx(0))).expired).toBe(0)
    expect(row.status).toBe('generating')
  })

  test('the sweep starts no more rows than the free slots', async () => {
    const w = wire()
    for (let i = 0; i < 2; i++) w.repo.add({ source_id: `busy${i}`, status: 'generating', lease_until: new Date(Date.now() + 60_000) })
    for (let i = 0; i < 5; i++) w.repo.add({ source_id: `wait${i}`, next_retry_at: new Date(Date.now() - 1000) })
    expect((await w.service.sweep(w.ctx(0))).started).toBe(2)
    expect(w.create).toHaveBeenCalledTimes(2)
  })

  test('unreferenced rows older than 7 days are deleted with their objects; a shared caption goes with the last row', async () => {
    const w = wire()
    w.repo.refs.length = 0
    const old = new Date(Date.now() - 8 * 86_400_000)
    const en = w.repo.add({ status: 'ready', article_key: 'a-en.json', article_text_key: 'a-en.txt', updated_at: old })
    w.repo.add({ target_language: 'zh', status: 'skipped', updated_at: new Date() })
    for (const k of ['a-en.json', 'a-en.html', 'a-en.txt', en.caption_key!, en.caption_text_key!, `youtube/canonical/chunks/${VIDEO}/${HASH}-en-v1/0.json`]) w.objects.set(k, 'x')
    const res = await w.service.sweep(w.ctx(0))
    expect(res.deleted).toBe(1)
    expect([...w.objects.keys()].sort()).toEqual([en.caption_key!, en.caption_text_key!].sort())
  })
})

describe('backfill', () => {
  test('fetches and stores captions per bookmark as its owner, counts failures, returns the cursor', async () => {
    const w = wire()
    w.repo.listBackfillCandidates.mockResolvedValue([
      { user_bookmark_id: 30, bookmark_id: 300, user_id: 5, target_url: 'https://youtu.be/aaaaaaaaaaa', lang: 'zh', ai_lang: '' },
      { user_bookmark_id: 20, bookmark_id: 200, user_id: 6, target_url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', lang: 'en', ai_lang: '' }
    ])
    w.crawlService.fetchYoutubeData.mockImplementationOnce(async () => {
      throw new Error('tikhub down')
    })
    const res = await w.service.backfill(w.ctx(1), 2)
    expect(res).toEqual({ processed: 2, linked: 1, failed: 1, next_before_id: 20 })
    expect(w.repo.listBackfillCandidates).toHaveBeenCalledWith(2, undefined)
    const [ctxArg, fetched, bookmarkId] = w.crawlService.saveYoutubeCaptionArtifacts.mock.calls[0]!
    expect([ctxArg.getUserId(), ctxArg.getlang(), fetched.videoId, bookmarkId]).toEqual([6, 'en', 'bbbbbbbbbbb', 200])
    expect(w.create).not.toHaveBeenCalled()
  })

  test('a short batch means done; the batch size is capped at 50', async () => {
    const w = wire()
    expect(await w.service.backfill(w.ctx(1), 500, 10)).toEqual({ processed: 0, linked: 0, failed: 0, next_before_id: null })
    expect(w.repo.listBackfillCandidates).toHaveBeenCalledWith(50, 10)
  })
})

describe('takedown and delete', () => {
  test('the sweep deletes the objects of a video the script marked, once', async () => {
    const w = wire()
    w.repo.add({ status: 'takedown', article_key: 'a.json', article_text_key: 'a.txt' })
    for (const k of ['a.json', 'a.html', 'a.txt', `youtube/canonical/chunks/${VIDEO}/y/0.json`]) w.objects.set(k, 'x')
    expect((await w.service.sweep(w.ctx(0))).takenDown).toBe(1)
    expect(w.objects.size).toBe(0)
    expect(w.repo.rows[0]).toMatchObject({ status: 'takedown', article_key: null, caption_key: null })
    expect((await w.service.sweep(w.ctx(0))).takenDown).toBe(0)
  })

  test('takedown marks every row and deletes captions, articles and chunks of the video', async () => {
    const w = wire()
    w.repo.add({ status: 'ready', article_key: 'a.json', article_text_key: 'a.txt' })
    w.repo.add({ target_language: 'zh', status: 'pending' })
    for (const k of ['a.json', 'a.html', 'a.txt', `youtube/canonical/captions/${VIDEO}/x.json`, `youtube/canonical/chunks/${VIDEO}/y/0.json`, 'unrelated']) w.objects.set(k, 'x')
    const res = await w.service.takedown(VIDEO)
    expect(res.rows).toBe(2)
    expect(w.repo.rows.every(r => r.status === 'takedown')).toBe(true)
    expect([...w.objects.keys()]).toEqual(['unrelated'])
  })
})
