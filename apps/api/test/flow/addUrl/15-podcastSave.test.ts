import { createMockMediaSnapshots } from '@test/helpers/mockFactory'
/**
 * /add_url Layer 15: podcast links. Reading the episode from each source with the real pages and
 * feeds saved on 2026-10-14, the first body (player and notes), the episode row and the reference.
 * 来源: crawl.ts fetchPodcastData / parseAndSavePodcast / savePodcastEpisode; spec 第 2 节、第 4.1 节
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CrawlService } from '@/domain/crawl'
import { FetchError, SlaxFetch } from '@/infra/external/remoteFetcher'
import { podcastSourceId } from '@/utils/podcastSource'
import { createMockCtx, createMockBucketClient, createMockBookmarkRepo, createMockLogsService, createMockAlertBot } from '@test/helpers/mockFactory'

const fixture = (name: string) => readFileSync(join(__dirname, '../../fixtures/podcast', name), 'utf8')

function wire() {
  const { factory: bc, putIfKeyExists } = createMockBucketClient()
  const br = createMockBookmarkRepo()
  const episodes = { upsertFromInfo: vi.fn().mockResolvedValue({ id: 3, transcript_hash: null, transcript_status: 'pending' }) }
  const articles = { linkBookmark: vi.fn().mockResolvedValue({ id: 1 }) }
  const svc = new (CrawlService as any)()
  svc.snapshots = createMockMediaSnapshots(putIfKeyExists, br.updateBookmark)
  Object.assign(svc, {
    bucketClient: bc,
    bookmarkRepo: br,
    logsService: createMockLogsService(),
    alertBot: createMockAlertBot(),
    podcastEpisodeRepo: episodes,
    markRepo: { bodyHasMarks: vi.fn().mockResolvedValue(false) },
    podcastArticleRepo: articles
  })
  return { svc: svc as CrawlService, putIfKeyExists, br, episodes, articles }
}

/** Fake network: URL → body, by prefix. Records every requested URL. */
function stubFetch(routes: Record<string, string | { status: number; location?: string }>) {
  const seen: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      seen.push(url)
      const key = Object.keys(routes).find(k => url.startsWith(k))
      const hit = key ? routes[key] : { status: 404 }
      if (typeof hit === 'string') return new Response(hit, { status: 200 })
      return new Response('', { status: hit.status, headers: hit.location ? { location: hit.location } : {} })
    })
  )
  return seen
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchPodcastData', () => {
  const ctx = createMockCtx()
  const xiaoyuzhouUrl = 'https://www.xiaoyuzhoufm.com/episode/6ac821ae848a38b151b0d593'
  const xiaoyuzhouFixture = () => ({ content: fixture('xiaoyuzhou-episode.html'), url: xiaoyuzhouUrl, title: '' })

  test('小宇宙: the page always comes from Zyte browser mode, then audio, show and notes are parsed', async () => {
    const { svc } = wire()
    const page = vi.fn().mockResolvedValue(xiaoyuzhouFixture())
    ;(svc as any).fetchPodcastPage = page
    const info = await svc.fetchPodcastData(xiaoyuzhouUrl, ctx)
    expect(info).toMatchObject({ kind: 'xiaoyuzhou', showName: '硅谷101', language: 'zh', durationSec: 2773 })
    expect(page).toHaveBeenCalledWith(expect.anything(), xiaoyuzhouUrl)
  })

  test('fetchPodcastPage asks Zyte for browser-rendered HTML', async () => {
    const zyte = vi.spyOn(SlaxFetch.prototype, 'zyte').mockResolvedValue(xiaoyuzhouFixture())
    try {
      const svc = wire().svc
      expect(await svc.fetchPodcastPage(ctx, xiaoyuzhouUrl)).toMatchObject({ content: expect.any(String), url: xiaoyuzhouUrl })
      expect(zyte).toHaveBeenCalledWith(xiaoyuzhouUrl, true)
    } finally {
      zyte.mockRestore()
    }
  })

  test('fetchPodcastPage falls back to ScrapingBot browser mode on a Zyte API error', async () => {
    const zyte = vi.spyOn(SlaxFetch.prototype, 'zyte').mockRejectedValue(new FetchError(429, 'ZYTE API Error: 429 Too Many Requests'))
    const bot = vi.spyOn(SlaxFetch.prototype, 'scrapingBot').mockResolvedValue(xiaoyuzhouFixture())
    try {
      expect(await wire().svc.fetchPodcastPage(ctx, xiaoyuzhouUrl)).toMatchObject({ content: expect.any(String), url: xiaoyuzhouUrl })
      expect(bot).toHaveBeenCalledWith(xiaoyuzhouUrl, true)
    } finally {
      zyte.mockRestore()
      bot.mockRestore()
    }
  })

  test('fetchPodcastPage keeps a Zyte target 4xx terminal', async () => {
    const zyte = vi.spyOn(SlaxFetch.prototype, 'zyte').mockRejectedValue(new FetchError(403, 'ZYTE target fetch failed: 403'))
    const bot = vi.spyOn(SlaxFetch.prototype, 'scrapingBot').mockResolvedValue(xiaoyuzhouFixture())
    try {
      await expect(wire().svc.fetchPodcastPage(ctx, xiaoyuzhouUrl)).rejects.toThrow('ZYTE target fetch failed: 403')
      expect(bot).not.toHaveBeenCalled()
    } finally {
      zyte.mockRestore()
      bot.mockRestore()
    }
  })

  test('fetchPodcastPage falls back to a direct public fetch when both providers fail', async () => {
    const zyte = vi.spyOn(SlaxFetch.prototype, 'zyte').mockRejectedValue(new FetchError(500, 'ZYTE API Error: 500'))
    const bot = vi.spyOn(SlaxFetch.prototype, 'scrapingBot').mockRejectedValue(new FetchError(500, 'SCRAPING BOT API Error: 500'))
    stubFetch({ 'https://www.xiaoyuzhoufm.com/episode/': fixture('xiaoyuzhou-episode.html') })
    try {
      expect((await wire().svc.fetchPodcastPage(ctx, xiaoyuzhouUrl)).content).toBe(fixture('xiaoyuzhou-episode.html'))
    } finally {
      zyte.mockRestore()
      bot.mockRestore()
    }
  })

  test('小宇宙: a terminal Zyte target 4xx saves the link as a page', async () => {
    const { svc } = wire()
    ;(svc as any).fetchPodcastPage = vi.fn().mockRejectedValue(new FetchError(403, 'ZYTE target fetch failed: 403'))
    expect(await svc.fetchPodcastData(xiaoyuzhouUrl, ctx)).toBeNull()
  })

  test('小宇宙: a Zyte API 4xx (rate limit or bad key) retries instead of saving a page', async () => {
    const { svc } = wire()
    ;(svc as any).fetchPodcastPage = vi.fn().mockRejectedValue(new FetchError(429, 'ZYTE API Error: 429 Too Many Requests'))
    await expect(svc.fetchPodcastData(xiaoyuzhouUrl, ctx)).rejects.toThrow('ZYTE API Error: 429')
  })

  test('Apple: lookup, then the feed adds transcripts and the language tag', async () => {
    const lookup = JSON.parse(fixture('apple-lookup.json'))
    const episode = lookup.results.find((r: { trackId?: number }) => String(r.trackId) === '1000796109623')
    // The Daily's feed is not saved; give the Buzzsprout feed the same episode title so it matches
    const feed = fixture('buzzsprout-feed.xml').replaceAll('Brazil’s Data Center Boom is Enabled by Renewables Firms w/ Laís Martins', episode.trackName.replace(/&/g, '&amp;'))
    const seen = stubFetch({ 'https://itunes.apple.com/lookup': JSON.stringify(lookup), 'https://feeds.simplecast.com/': feed })
    const info = await wire().svc.fetchPodcastData('https://podcasts.apple.com/us/podcast/x/id1200361736?i=1000796109623', ctx)
    expect(seen[0]).toBe('https://itunes.apple.com/lookup?id=1200361736&entity=podcastEpisode&limit=300')
    expect(info).toMatchObject({ kind: 'apple', showName: 'The Daily', language: 'en', languageTag: 'en-us' })
    expect(info!.transcripts.map(t => t.type)).toContain('text/vtt')
  })

  test('Apple: a feed that fails keeps the lookup data', async () => {
    stubFetch({ 'https://itunes.apple.com/lookup': fixture('apple-lookup.json'), 'https://feeds.simplecast.com/': { status: 500 } })
    const info = await wire().svc.fetchPodcastData('https://podcasts.apple.com/us/podcast/x/id1200361736?i=1000796109623', ctx)
    expect(info).toMatchObject({ kind: 'apple', durationSec: 1997 })
  })

  test('Apple: an episode the lookup does not list → null (saved as a page)', async () => {
    stubFetch({ 'https://itunes.apple.com/lookup': fixture('apple-lookup.json') })
    expect(await wire().svc.fetchPodcastData('https://podcasts.apple.com/us/podcast/x/id1200361736?i=1', ctx)).toBeNull()
  })

  test('feed: the newest episode; a blog feed or a non-feed page → null', async () => {
    stubFetch({
      'https://feeds.buzzsprout.com/': fixture('buzzsprout-feed.xml'),
      'https://example.com/blog/feed': '<rss><channel><title>B</title><item><title>P</title></item></channel></rss>',
      'https://example.com/rss': '<html></html>'
    })
    const svc = wire().svc
    expect(await svc.fetchPodcastData('https://feeds.buzzsprout.com/1004689.rss', ctx)).toMatchObject({ kind: 'feed', language: 'en' })
    expect(await svc.fetchPodcastData('https://example.com/blog/feed', ctx)).toBeNull()
    expect(await svc.fetchPodcastData('https://example.com/rss', ctx)).toBeNull()
  })

  test('direct audio needs no request; Spotify reads oembed and has no audio', async () => {
    const seen = stubFetch({ 'https://open.spotify.com/oembed': JSON.stringify({ title: 'Ep', thumbnail_url: 'https://i.scdn.co/x' }) })
    const svc = wire().svc
    expect(await svc.fetchPodcastData('https://cdn.example.com/ep.mp3', ctx)).toMatchObject({ kind: 'audio', audioUrl: 'https://cdn.example.com/ep.mp3' })
    expect(seen).toEqual([])
    expect(await svc.fetchPodcastData('https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk', ctx)).toMatchObject({ kind: 'spotify', audioUrl: '', title: 'Ep' })
  })

  test('errors that will repeat save the link as a page (null): private redirect, 4xx, bad JSON', async () => {
    const { svc } = wire()
    const seen = stubFetch({ 'https://feeds.example.com/': { status: 302, location: 'http://169.254.169.254/latest' } })
    expect(await svc.fetchPodcastData('https://feeds.example.com/show.rss', ctx)).toBeNull()
    expect(seen).toEqual(['https://feeds.example.com/show.rss'])
    ;(svc as any).fetchPodcastPage = vi.fn().mockRejectedValue(new FetchError(404, 'ZYTE target fetch failed: 404'))
    expect(await svc.fetchPodcastData('https://www.xiaoyuzhoufm.com/episode/abc', ctx)).toBeNull()
    stubFetch({ 'https://itunes.apple.com/lookup': '<html>' })
    expect(await svc.fetchPodcastData('https://podcasts.apple.com/us/podcast/x/id1?i=2', ctx)).toBeNull()
  })

  test('errors that can pass (5xx) are thrown, so the crawl step retries', async () => {
    const { svc } = wire()
    ;(svc as any).fetchPodcastPage = vi.fn().mockRejectedValue(new FetchError(503, 'ZYTE target fetch failed: 503'))
    await expect(svc.fetchPodcastData('https://www.xiaoyuzhoufm.com/episode/abc', ctx)).rejects.toThrow('ZYTE target fetch failed: 503')
  })
})

describe('parseAndSavePodcast', () => {
  const info = {
    kind: 'feed' as const,
    pageUrl: 'https://feeds.example.com/show.rss',
    audioUrl: 'https://cdn.example.com/ep.mp3',
    embedUrl: '',
    title: 'Ep 1',
    showName: 'Show',
    author: 'Host',
    coverUrl: '',
    durationSec: 600,
    language: 'en' as const,
    languageTag: 'en-us',
    shownotes: 'What we talk about.',
    publishedAt: new Date('2026-10-01T00:00:00Z'),
    transcripts: []
  }

  test('player body, episode row and a reference with an empty hash', async () => {
    const { svc, putIfKeyExists, br, episodes, articles } = wire()
    const ctx = createMockCtx({ userId: 5 })
    const result = await svc.parseAndSavePodcast(ctx, info, 10, 'ub-10')
    expect(result.contentKey).toBe('snapshots/ub-10/test/body.html')
    const html = putIfKeyExists.mock.calls.find(c => c[0] === 'snapshots/ub-10/test/body.html')![1] as string
    expect(html).toContain('<slax-media data-kind="audio" data-src="https://cdn.example.com/ep.mp3"')
    expect(html).toContain('<h2>Show notes</h2>')
    expect(br.updateBookmark).toHaveBeenCalledWith(10, expect.objectContaining({ title: 'Ep 1', site_name: 'Show', byline: 'Host', status: 'success' }))
    const sourceId = await podcastSourceId(info.audioUrl)
    expect(episodes.upsertFromInfo).toHaveBeenCalledWith(sourceId, info)
    expect(articles.linkBookmark).not.toHaveBeenCalled()
    expect((svc as any).snapshots.capture.mock.calls[0][4]).toMatchObject({ sourceId, sourceHash: '' })
  })

  test('an episode already transcribed: the reference points at its transcript', async () => {
    const { svc, episodes, articles } = wire()
    episodes.upsertFromInfo.mockResolvedValue({ id: 3, transcript_hash: 'abc', transcript_status: 'ready' })
    await svc.parseAndSavePodcast(createMockCtx({ userId: 5 }), info, 10, 'ub-10')
    expect((svc as any).snapshots.capture.mock.calls[0][4].sourceHash).toBe('abc')
  })

  test('Spotify: embed body, no episode row; a database error never fails the save', async () => {
    const { svc, putIfKeyExists, episodes } = wire()
    await svc.parseAndSavePodcast(createMockCtx(), { ...info, kind: 'spotify', audioUrl: '', embedUrl: 'https://open.spotify.com/embed/episode/x' }, 10, 'ub-10')
    expect(putIfKeyExists.mock.calls.find(c => c[0] === 'snapshots/ub-10/test/body.html')![1]).toContain('slax-pod-embed')
    expect(episodes.upsertFromInfo).not.toHaveBeenCalled()

    episodes.upsertFromInfo.mockRejectedValue(new Error('pg down'))
    await expect(svc.parseAndSavePodcast(createMockCtx(), info, 11, 'ub-11')).resolves.toMatchObject({ contentKey: 'snapshots/ub-11/test/body.html' })
  })
})

describe('Pocket Casts capture and recovery', () => {
  const url = 'https://pca.st/episode/f7269801-ce3f-48fc-9e57-3783fdbbe7d2'
  test('uses browser fetching and saves the player for the existing bookmark', async () => {
    const { svc, putIfKeyExists, episodes } = wire()
    const ctx = createMockCtx()
    const page = vi.spyOn(svc, 'fetchPodcastPage').mockResolvedValue({ content: fixture('20261027-pocket-casts.html'), url })
    const info = await svc.fetchPodcastData(url, ctx)
    expect(page).toHaveBeenCalledWith(ctx, url)
    expect(info?.kind).toBe('pocketcasts')
    await svc.parseAndSavePodcast(ctx, info!, 42, 'existing-uuid')
    expect(episodes.upsertFromInfo).toHaveBeenCalledWith(await podcastSourceId(info!.audioUrl), info)
    expect(putIfKeyExists.mock.calls.some(call => String(call[1]).includes('slax-media'))).toBe(true)
  })

  test('a resolved page URL that is not an episode link is logged, then saved as a page', async () => {
    const { svc } = wire()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      vi.spyOn(svc, 'fetchPodcastPage').mockResolvedValue({ content: fixture('20261027-pocket-casts.html'), url: 'https://pocketcasts.com/podcast/show/642bf450-e9fa-013a-da18-0acc26574db2' })
      expect(await svc.fetchPodcastData(url, createMockCtx())).toBeNull()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('not an episode link'))
    } finally {
      warn.mockRestore()
    }
  })

  test('keepsAnnotatedBody: only a bookmark with a body and marks keeps it', async () => {
    const { svc, br } = wire()
    const ctx = createMockCtx({ userId: 5 })
    const marks = (svc as any).markRepo.bodyHasMarks
    marks.mockResolvedValue(true)

    // First capture: no body yet, so there is nothing to protect and marks are not consulted
    br.getBookmarkById.mockResolvedValue({ id: 42, content_key: '' })
    expect(await svc.keepsAnnotatedBody(ctx, 42)).toBe(false)
    expect(marks).not.toHaveBeenCalled()

    br.getBookmarkById.mockResolvedValue({ id: 42, content_key: 'html/body/existing-uuid.html' })
    expect(await svc.keepsAnnotatedBody(ctx, 42)).toBe(true)
    expect(marks).toHaveBeenCalledWith(42, 5)

    marks.mockResolvedValue(false)
    expect(await svc.keepsAnnotatedBody(ctx, 42)).toBe(false)
  })
})
