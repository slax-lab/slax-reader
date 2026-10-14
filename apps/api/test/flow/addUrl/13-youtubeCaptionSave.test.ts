/**
 * /add_url Layer 13: YouTube caption artifacts next to the untouched player HTML.
 * The normalized caption goes to its own R2 keys, the eligibility gate runs in shadow mode and
 * writes one job row. None of it may change the html/body + text/body output or fail the bookmark.
 * 来源: crawl.ts fetchYoutubeData / parseAndSaveYoutube / saveYoutubeCaptionArtifacts
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CrawlService, type YoutubeFetched } from '@/domain/crawl'
import { SocialMediaApi } from '@/infra/external/socialMedia'
import { YOUTUBE_ARTICLE_PROMPT_VERSION } from '@/infra/repository/dbYoutubeArticle'
import { buildYoutubeCaptionDocument } from '@/utils/youtubeCaption'
import { createMockCtx, createMockBucketClient, createMockBookmarkRepo, createMockLogsService, createMockAlertBot } from '@test/helpers/mockFactory'

function wire() {
  const { factory: bc, putIfKeyExists } = createMockBucketClient()
  const br = createMockBookmarkRepo()
  const repo = { recordEvaluation: vi.fn().mockResolvedValue({ id: 1 }), linkBookmark: vi.fn().mockResolvedValue({ id: 1 }) }
  const svc = new (CrawlService as any)()
  ;(svc as any).bucketClient = bc
  ;(svc as any).bookmarkRepo = br
  ;(svc as any).logsService = createMockLogsService()
  ;(svc as any).alertBot = createMockAlertBot()
  ;(svc as any).youtubeArticleRepo = repo
  return { svc: svc as CrawlService, putIfKeyExists, br, repo }
}

const LINE = 'the transformer replaces recurrence with attention so every token attends to every other token in a single step'
const track = { language_code: 'en', language_name: 'English', kind: '', is_translatable: true, base_url: '' }
const events = Array.from({ length: 200 }, (_, i) => ({ tStartMs: i * 6000, dDurationMs: 5800, segs: [{ utf8: `${LINE} ${i}` }] }))
const caption = buildYoutubeCaptionDocument('dQw4w9WgXcQ', track, events)

function fetched(overrides: Partial<YoutubeFetched> = {}): YoutubeFetched {
  return {
    videoId: 'dQw4w9WgXcQ',
    title: 'How attention works',
    author: 'Lecturer',
    authorUrl: 'https://youtube.com/@lecturer',
    thumbnail: '',
    cues: caption.cues.map(c => ({ t: Math.floor(c.start_ms / 1000), text: c.text })),
    caption,
    hasCaption: true,
    ...overrides
  }
}

const putKeys = (put: ReturnType<typeof vi.fn>) => put.mock.calls.map(c => c[0] as string)

describe('parseAndSaveYoutube with captions', () => {
  test('writes player HTML + TXT as before, plus caption JSON/TXT under a canonical hashed key', async () => {
    const { svc, putIfKeyExists, br } = wire()
    const result = await svc.parseAndSaveYoutube(createMockCtx(), fetched(), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 10, 'ub-10')

    expect(result.contentKey).toBe('html/body/ub-10.html')
    expect(br.updateBookmark).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ status: 'success', site_name: 'YouTube', content_key: 'html/body/ub-10.html', content_md_key: 'text/body/ub-10.txt' })
    )

    const keys = putKeys(putIfKeyExists)
    expect(keys).toHaveLength(4)
    expect(keys).toContain('text/body/ub-10.txt')
    expect(keys).toContain('html/body/ub-10.html')
    const captionKey = keys.find(k => k.endsWith('.json'))!
    const captionTextKey = keys.find(k => k.startsWith('youtube/canonical/') && k.endsWith('.txt'))!
    expect(captionKey).toMatch(/^youtube\/canonical\/captions\/dQw4w9WgXcQ\/[0-9a-f]{64}\.json$/)
    expect(captionTextKey).toBe(captionKey.replace(/\.json$/, '.txt'))

    const html = putIfKeyExists.mock.calls.find(c => c[0] === 'html/body/ub-10.html')![1] as string
    expect(html).toContain('<youtube-player data-video-id="dQw4w9WgXcQ" data-cues=')
    expect(html).toContain('class="slax-yt-transcript"')
    expect(html).not.toContain('start_ms')

    const captionJson = JSON.parse(putIfKeyExists.mock.calls.find(c => c[0] === captionKey)![1] as string)
    expect(captionJson).toMatchObject({ schema_version: 1, video_id: 'dQw4w9WgXcQ', language: 'en', kind: 'manual', source_track: 'en' })
    expect(captionJson.cues[0]).toEqual({ id: 'c0000', start_ms: 0, duration_ms: 5800, text: `${LINE} 0` })

    const captionText = putIfKeyExists.mock.calls.find(c => c[0] === captionTextKey)![1] as string
    expect(captionText.startsWith(`${LINE} 0 ${LINE} 1`)).toBe(true)
  })

  test('records the shadow eligibility result as a pending canonical row and links the bookmark to it', async () => {
    const { svc, repo } = wire()
    await svc.parseAndSaveYoutube(createMockCtx(), fetched(), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 10, 'ub-10')

    expect(repo.recordEvaluation).toHaveBeenCalledTimes(1)
    const row = repo.recordEvaluation.mock.calls[0][0]
    expect(row).not.toHaveProperty('bookmark_id')
    expect(row).toMatchObject({
      video_id: 'dQw4w9WgXcQ',
      caption_language: 'en',
      caption_kind: 'manual',
      prompt_version: YOUTUBE_ARTICLE_PROMPT_VERSION,
      schema_version: 1,
      status: 'pending'
    })
    expect(row.caption_key).toBe(`youtube/canonical/captions/dQw4w9WgXcQ/${row.source_hash}.json`)
    expect(row.caption_text_key).toBe(`youtube/canonical/captions/dQw4w9WgXcQ/${row.source_hash}.txt`)
    expect(row.eligibility).toMatchObject({ rules_version: 1, decision: 'generate', reason_codes: [] })

    expect(repo.linkBookmark).toHaveBeenCalledTimes(1)
    expect(repo.linkBookmark).toHaveBeenCalledWith({ bookmark_id: 10, user_id: 1, video_id: 'dQw4w9WgXcQ', source_hash: row.source_hash })
    expect(repo.linkBookmark.mock.invocationCallOrder[0]).toBeGreaterThan(repo.recordEvaluation.mock.invocationCallOrder[0])
  })

  test('a visual video is recorded as skipped with its reason codes', async () => {
    const { svc, repo } = wire()
    await svc.parseAndSaveYoutube(createMockCtx(), fetched({ title: 'My week in Tokyo vlog' }), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 10, 'ub-10')
    const row = repo.recordEvaluation.mock.calls[0][0]
    expect(row.status).toBe('skipped')
    expect(row.eligibility.decision).toBe('review')
    expect(row.eligibility.reason_codes).toContain('title_suggests_visual')
  })

  test('two users saving the same captions share one hash, one key and one canonical row', async () => {
    const a = wire()
    const b = wire()
    await a.svc.parseAndSaveYoutube(createMockCtx({ userId: 1 }), fetched(), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 10, 'ub-10')
    await b.svc.parseAndSaveYoutube(createMockCtx({ userId: 2 }), fetched(), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 11, 'ub-11')
    expect(a.repo.recordEvaluation.mock.calls[0][0]).toEqual(b.repo.recordEvaluation.mock.calls[0][0])
    expect(putKeys(a.putIfKeyExists).filter(k => k.startsWith('youtube/'))).toEqual(putKeys(b.putIfKeyExists).filter(k => k.startsWith('youtube/')))
    expect(a.repo.linkBookmark.mock.calls[0][0]).toMatchObject({ bookmark_id: 10, user_id: 1 })
    expect(b.repo.linkBookmark.mock.calls[0][0]).toMatchObject({ bookmark_id: 11, user_id: 2 })
  })
})

describe('parseAndSaveYoutube without captions', () => {
  test('only the two legacy objects are written and the row says no_caption', async () => {
    const { svc, putIfKeyExists, repo, br } = wire()
    await svc.parseAndSaveYoutube(createMockCtx(), fetched({ cues: [], caption: null, hasCaption: false }), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 10, 'ub-10')

    expect(putKeys(putIfKeyExists)).toEqual(expect.arrayContaining(['text/body/ub-10.txt', 'html/body/ub-10.html']))
    expect(putIfKeyExists).toHaveBeenCalledTimes(2)
    expect(br.updateBookmark).toHaveBeenCalledWith(10, expect.objectContaining({ status: 'success' }))
    const row = repo.recordEvaluation.mock.calls[0][0]
    expect(row).toMatchObject({ caption_key: null, caption_text_key: null, caption_language: null, caption_kind: null, status: 'skipped' })
    expect(row.eligibility.reason_codes).toEqual(['no_caption'])
    expect(row.source_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(repo.linkBookmark).toHaveBeenCalledWith(expect.objectContaining({ bookmark_id: 10, source_hash: row.source_hash }))
  })
})

describe('failures never touch the bookmark', () => {
  test('job row write failing → bookmark still success', async () => {
    const { svc, repo, br } = wire()
    repo.recordEvaluation.mockRejectedValueOnce(new Error('pg down'))
    const result = await svc.parseAndSaveYoutube(createMockCtx(), fetched(), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 10, 'ub-10')
    expect(result.contentKey).toBe('html/body/ub-10.html')
    expect(br.updateBookmark).toHaveBeenCalledWith(10, expect.objectContaining({ status: 'success' }))
  })

  test('bookmark link failing → bookmark still success', async () => {
    const { svc, repo, br } = wire()
    repo.linkBookmark.mockRejectedValueOnce(new Error('pg down'))
    await expect(svc.parseAndSaveYoutube(createMockCtx(), fetched(), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 10, 'ub-10')).resolves.toBeTruthy()
    expect(br.updateBookmark).toHaveBeenCalledWith(10, expect.objectContaining({ status: 'success' }))
  })

  test('caption object write failing → bookmark still success, no job row', async () => {
    const { svc, putIfKeyExists, repo, br } = wire()
    putIfKeyExists.mockImplementation(async (key: string) => {
      if (key.startsWith('youtube/canonical/')) throw new Error('r2 down')
    })
    await expect(svc.parseAndSaveYoutube(createMockCtx(), fetched(), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 10, 'ub-10')).resolves.toBeTruthy()
    expect(br.updateBookmark).toHaveBeenCalledWith(10, expect.objectContaining({ status: 'success' }))
    expect(repo.recordEvaluation).not.toHaveBeenCalled()
  })
})

describe('fetchYoutubeData', () => {
  const fetchCaption = vi.spyOn(SocialMediaApi, 'fetchYoutubeCaption')
  afterEach(() => {
    fetchCaption.mockReset()
    vi.unstubAllGlobals()
  })

  test('passes the user language as the track fallback and keeps the caption document', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ title: 'T', author_name: 'A', author_url: 'u', thumbnail_url: 'th' }) }))
    fetchCaption.mockResolvedValue({ cues: [{ t: 0, text: 'x' }], caption })
    const { svc } = wire()
    const res = await svc.fetchYoutubeData(createMockCtx({ lang: 'zh' }), 'https://youtu.be/dQw4w9WgXcQ')
    expect(fetchCaption).toHaveBeenCalledWith(expect.anything(), 'dQw4w9WgXcQ', 'zh')
    expect(res.caption).toBe(caption)
    expect(res.hasCaption).toBe(true)
  })

  test('caption fetch failing → plain player, caption null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ title: 'T' }) }))
    fetchCaption.mockRejectedValue(new Error('tikhub down'))
    const { svc } = wire()
    const res = await svc.fetchYoutubeData(createMockCtx(), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(res).toMatchObject({ videoId: 'dQw4w9WgXcQ', cues: [], caption: null, hasCaption: false, captionFetchFailed: true })
  })
})

test('provider failures do not overwrite canonical no-caption evaluations', async () => {
  const svc = Object.create(CrawlService.prototype)
  svc.youtubeArticleRepo = { recordEvaluation: vi.fn(), linkBookmark: vi.fn() }
  await svc.saveYoutubeCaptionArtifacts(createMockCtx(), { videoId: 'v1', caption: null, captionFetchFailed: true }, 10)
  expect(svc.youtubeArticleRepo.recordEvaluation).not.toHaveBeenCalled()
  expect(svc.youtubeArticleRepo.linkBookmark).not.toHaveBeenCalled()
})
