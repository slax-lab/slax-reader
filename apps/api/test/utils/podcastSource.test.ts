/**
 * Podcast sources against real pages and feeds saved on 2026-10-14 (test/fixtures/podcast):
 * a 小宇宙 episode page, an iTunes lookup answer for The Daily, and a Buzzsprout feed that
 * carries Podcasting 2.0 transcript tags.
 * 来源: src/utils/podcastSource.ts, docs/podcast-article/spec.md 第 2 节
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  classifyPodcastUrl,
  parsePocketCastsPage,
  directAudioInfo,
  enrichFromFeed,
  findFeedItem,
  latestFeedEpisode,
  outboundUrlProblem,
  parseAppleUrl,
  parseDuration,
  parsePodcastFeed,
  parseXiaoyuzhouPage,
  pickAppleEpisode,
  podcastLanguage,
  podcastSourceId,
  spotifyInfo,
  stripHtml
} from '@/utils/podcastSource'

const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures/podcast', name), 'utf8')

describe('classifyPodcastUrl', () => {
  test.each([
    ['https://www.xiaoyuzhoufm.com/episode/6ac821ae848a38b151b0d593', 'xiaoyuzhou'],
    ['https://xiaoyuzhoufm.com/episode/6ac821ae848a38b151b0d593?s=abc', 'xiaoyuzhou'],
    ['https://podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1000796109623', 'apple'],
    ['https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk', 'spotify'],
    ['https://open.spotify.com/intl-de/episode/4rOoJ6Egrf8K2IrywzwOMk?si=x', 'spotify'],
    ['https://cdn.example.com/show/ep1.mp3', 'audio'],
    ['https://cdn.example.com/show/ep1.M4A?token=1', 'audio'],
    ['https://feeds.buzzsprout.com/1004689.rss', 'feed'],
    ['https://example.com/podcast/feed', 'feed'],
    ['https://feed.xyz.fm/show', 'feed'],
    ['https://anchor.fm/s/abc/podcast/rss', 'feed']
  ])('%s → %s', (url, kind) => {
    expect(classifyPodcastUrl(url)).toBe(kind)
  })

  test.each([
    'https://podcasts.apple.com/us/podcast/the-daily/id1200361736',
    'https://www.xiaoyuzhoufm.com/podcast/5e5c52c9418a84a04625e6cc',
    'https://example.com/blog/post',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'ftp://example.com/a.mp3',
    'not a url'
  ])('%s is not a podcast episode', url => {
    expect(classifyPodcastUrl(url)).toBeNull()
  })
})

describe('outboundUrlProblem', () => {
  test.each([
    ['https://media.xyzcdn.net/a.mp3', null],
    ['http://example.com:80/a.mp3', null],
    ['file:///etc/passwd', 'scheme'],
    ['https://user:pass@example.com/a.mp3', 'credentials'],
    ['https://example.com:8443/a.mp3', 'port'],
    ['http://localhost/a.mp3', 'local_host'],
    ['http://printer.local/a.mp3', 'local_host'],
    ['http://127.0.0.1/a.mp3', 'private_ip'],
    ['http://10.1.2.3/a.mp3', 'private_ip'],
    ['http://172.20.0.1/a.mp3', 'private_ip'],
    ['http://192.168.1.1/a.mp3', 'private_ip'],
    ['http://169.254.169.254/latest/meta-data', 'private_ip'],
    ['http://100.64.0.1/a.mp3', 'private_ip'],
    ['http://[::1]/a.mp3', 'private_ip'],
    ['http://[::ffff:10.0.0.1]/a.mp3', 'private_ip'],
    ['http://[2606:4700::1111]/a.mp3', null],
    ['nonsense', 'unparsable']
  ])('%s → %s', (url, problem) => {
    expect(outboundUrlProblem(url)).toBe(problem)
  })
})

describe('helpers', () => {
  test('parseDuration', () => {
    expect(parseDuration('01:02:03')).toBe(3723)
    expect(parseDuration('62:03')).toBe(3723)
    expect(parseDuration('4121')).toBe(4121)
    expect(parseDuration('2773')).toBe(2773)
    expect(parseDuration(1931.6)).toBe(1932)
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
  })

  test('podcastLanguage keeps only zh and en', () => {
    expect(podcastLanguage('en-us')).toBe('en')
    expect(podcastLanguage('zh-CN')).toBe('zh')
    expect(podcastLanguage('ZH')).toBe('zh')
    expect(podcastLanguage('ja')).toBeNull()
    expect(podcastLanguage(null)).toBeNull()
  })

  test('stripHtml folds tags and entities and caps the length', () => {
    expect(stripHtml('<p>A &amp; B</p><p>C&nbsp;&#8217;s</p>')).toBe('A & B\nC ’s')
    expect(stripHtml('a&#xff0c;b&#XFF0C;c')).toBe('a，b，c')
    expect(stripHtml('x'.repeat(5000)).length).toBe(4000)
  })

  test('podcastSourceId is stable, ignores host case and fragments, and differs by path', async () => {
    const a = await podcastSourceId('https://Media.Example.com/a.mp3#t=10')
    expect(a).toBe(await podcastSourceId('https://media.example.com/a.mp3'))
    expect(a).toHaveLength(32)
    expect(a).not.toBe(await podcastSourceId('https://media.example.com/b.mp3'))
  })
})

describe('小宇宙 page', () => {
  const url = 'https://www.xiaoyuzhoufm.com/episode/6ac821ae848a38b151b0d593?s=share'
  test('reads audio, title, show, duration, notes and date from the Next.js data blob', () => {
    const info = parseXiaoyuzhouPage(url, fixture('xiaoyuzhou-episode.html'))
    expect(info).toMatchObject({
      kind: 'xiaoyuzhou',
      pageUrl: 'https://www.xiaoyuzhoufm.com/episode/6ac821ae848a38b151b0d593',
      title: 'E255｜模型越来越强，为什么用户没感觉？再访阿里国际站总裁张阔',
      showName: '硅谷101',
      durationSec: 2773,
      language: 'zh'
    })
    expect(info.audioUrl).toMatch(/^https:\/\/media\.xyzcdn\.net\/5e5c52c9418a84a04625e6cc\/.+\.(mp3|m4a)$/)
    expect(info.shownotes.length).toBeGreaterThan(100)
    expect(info.shownotes).not.toMatch(/<[a-z]/i)
    expect(info.publishedAt?.toISOString()).toBe('2026-10-08T23:00:00.000Z')
  })

  test('falls back to og:audio when the data blob is missing', () => {
    const info = parseXiaoyuzhouPage(url, '<meta property="og:audio" content="https://media.xyzcdn.net/x.m4a"><meta property="og:title" content="T">')
    expect(info).toMatchObject({ audioUrl: 'https://media.xyzcdn.net/x.m4a', title: 'T', language: 'zh' })
  })

  test('no audio at all → empty audioUrl (the caller fails the fetch)', () => {
    expect(parseXiaoyuzhouPage(url, '<html></html>').audioUrl).toBe('')
  })
})

describe('Apple Podcasts', () => {
  const url = 'https://podcasts.apple.com/us/podcast/when-a-i-comes/id1200361736?i=1000796109623'
  test('parseAppleUrl', () => {
    expect(parseAppleUrl(url)).toEqual({ showId: '1200361736', episodeId: '1000796109623' })
    expect(parseAppleUrl('https://podcasts.apple.com/us/podcast/the-daily/id1200361736')).toBeNull()
  })

  test('picks the episode out of the show lookup, with the feed URL', () => {
    const picked = pickAppleEpisode(url, JSON.parse(fixture('apple-lookup.json')), '1000796109623')
    expect(picked?.feedUrl).toBe('https://feeds.simplecast.com/Sl5CSM3S')
    expect(picked?.info).toMatchObject({ kind: 'apple', showName: 'The Daily', durationSec: 1997 })
    expect(picked?.info.audioUrl).toMatch(/^https:\/\/dts\.podtrac\.com\//)
    expect(picked?.info.title.length).toBeGreaterThan(5)
  })

  test('an episode not in the lookup → null', () => {
    expect(pickAppleEpisode(url, JSON.parse(fixture('apple-lookup.json')), '999')).toBeNull()
  })
})

describe('RSS feed', () => {
  const feed = parsePodcastFeed(fixture('buzzsprout-feed.xml'))

  test('reads show, language and items with audio, duration and transcript refs', () => {
    expect(feed.language).toBe('en')
    expect(feed.languageTag).toBe('en-us')
    expect(feed.items).toHaveLength(2)
    const item = feed.items[0]
    expect(item.audioUrl).toMatch(/\.mp3$/)
    expect(item.durationSec).toBe(4121)
    expect(item.guid).toBe('Buzzsprout-19917599')
    expect(item.transcripts.map(t => t.type)).toEqual(['text/html', 'application/json', 'application/x-subrip', 'text/vtt'])
    expect(item.description).not.toMatch(/<p>/)
  })

  test('latestFeedEpisode picks the newest item with audio', () => {
    const info = latestFeedEpisode('https://feeds.buzzsprout.com/1004689.rss', feed)
    expect(info).toMatchObject({ kind: 'feed', language: 'en', showName: feed.title })
    expect(info?.transcripts).toHaveLength(4)
  })

  test('a feed without audio enclosures has no episode', () => {
    const blog = parsePodcastFeed('<rss><channel><title>Blog</title><item><title>Post</title><link>https://x</link></item></channel></rss>')
    expect(latestFeedEpisode('https://x/feed', blog)).toBeNull()
  })

  test('not RSS → throws', () => {
    expect(() => parsePodcastFeed('<html><body>hi</body></html>')).toThrow('not an RSS feed')
  })

  test('findFeedItem matches by guid, audio file name or title; enrichFromFeed fills the gaps', () => {
    const item = feed.items[1]
    expect(findFeedItem(feed, { guid: item.guid })).toBe(item)
    expect(findFeedItem(feed, { audioUrl: `https://tracker.example/redirect/${item.audioUrl.replace(/^https:\/\//, '')}` })).toBe(item)
    expect(findFeedItem(feed, { title: `  ${item.title.toUpperCase()} ` })).toBe(item)
    expect(findFeedItem(feed, { title: 'nope' })).toBeNull()

    const base = directAudioInfo('https://cdn.example.com/ep.mp3')
    const enriched = enrichFromFeed(base, feed, item)
    expect(enriched.language).toBe('en')
    expect(enriched.languageTag).toBe('en-us')
    expect(enriched.transcripts).toHaveLength(4)
    expect(enriched.durationSec).toBe(item.durationSec)
  })
})

describe('direct audio and Spotify', () => {
  test('direct audio uses the file name as title', () => {
    expect(directAudioInfo('https://cdn.example.com/shows/my-great_episode.mp3')).toMatchObject({
      kind: 'audio',
      title: 'my great episode',
      audioUrl: 'https://cdn.example.com/shows/my-great_episode.mp3'
    })
  })

  test('Spotify has an embed and no audio', () => {
    expect(spotifyInfo('https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk?si=1', { title: 'Ep', thumbnail_url: 'https://i.scdn.co/x' })).toMatchObject({
      kind: 'spotify',
      audioUrl: '',
      embedUrl: 'https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk',
      title: 'Ep',
      coverUrl: 'https://i.scdn.co/x'
    })
  })
})

describe('Pocket Casts', () => {
  const short = 'https://pca.st/episode/f7269801-ce3f-48fc-9e57-3783fdbbe7d2'
  const canonical = 'https://pocketcasts.com/podcast/show/642bf450-e9fa-013a-da18-0acc26574db2/episode/f7269801-ce3f-48fc-9e57-3783fdbbe7d2'
  const html = () => fixture('20261027-pocket-casts.html')

  test.each([short, canonical, canonical + '?utm_source=share'])('recognizes %s', url => {
    expect(classifyPodcastUrl(url)).toBe('pocketcasts')
  })

  test.each([
    'https://pocketcasts.com/podcast/show/642bf450-e9fa-013a-da18-0acc26574db2',
    'https://pca.st/podcast/123',
    'https://pca.st.evil.test/episode/f7269801-ce3f-48fc-9e57-3783fdbbe7d2'
  ])('rejects non-episode %s', url => {
    expect(classifyPodcastUrl(url)).toBeNull()
  })

  test('reads rendered metadata without treating the site language as the audio language', async () => {
    const info = parsePocketCastsPage(short, html())!
    expect(info).toMatchObject({
      kind: 'pocketcasts',
      audioUrl: 'https://media.example.com/episode.m4a',
      showName: '高能量',
      durationSec: 5160,
      language: null,
      languageTag: null,
      shownotes: 'Episode notes.',
      transcripts: []
    })
    expect(await podcastSourceId(info.audioUrl)).toBe(await podcastSourceId(parsePocketCastsPage(canonical, html())!.audioUrl))
  })

  test.each(['http://127.0.0.1/private.mp3', 'https://user:pass@example.com/episode.mp3', 'javascript:alert(1)', 'file:///episode.mp3'])('rejects unsafe media %s', url => {
    expect(parsePocketCastsPage(short, html().replace('https://media.example.com/episode.m4a', url))).toBeNull()
  })

  test('reads typed publisher transcripts and ignores the HTML viewer', () => {
    const page = html().replace('</head>', '<link rel="transcript" type="text/vtt" href="https://publisher.example/episode.vtt" hreflang="zh"><link rel="transcript" href="https://publisher.example/viewer"></head>')
    expect(parsePocketCastsPage(short, page)!.transcripts).toEqual([{ url: 'https://publisher.example/episode.vtt', type: 'text/vtt', language: 'zh' }])
  })

  test('missing audio remains a normal page', () => {
    expect(parsePocketCastsPage(short, '<html><h1>Episode</h1></html>')).toBeNull()
  })

  test('reads the captured rendered page, so markup drift fails here first', () => {
    const resolved = 'https://pocketcasts.com/podcast/%E9%AB%98%E8%83%BD%E9%87%8F/642bf450-e9fa-013a-da18-0acc26574db2/vol238/f7269801-ce3f-48fc-9e57-3783fdbbe7d2'
    const info = parsePocketCastsPage(resolved, fixture('20261027-pocket-casts-rendered.html'))!
    expect(info).toMatchObject({
      kind: 'pocketcasts',
      audioUrl: 'https://dts-api.xiaoyuzhoufm.com/track/62c6ae08c4eaa82b112b9c84/6ad73cbbef67611cac7972a7/media.xyzcdn.net/62c6ae08c4eaa82b112b9c84/lptdvCfn8Elgq5cwD6ZgmqO5zmdS.m4a',
      title: 'Vol.238 宏观漫谈112｜全球资本市场，集体“缺钱”？',
      showName: '高能量',
      coverUrl: 'https://static.pocketcasts.com/discover/images/webp/480/642bf450-e9fa-013a-da18-0acc26574db2.webp',
      durationSec: 5160,
      transcripts: []
    })
    expect(info.shownotes).toContain('【内容索引】')
    expect(info.shownotes).not.toContain('<')
  })

  test('the og:description fallback decodes the hex entities the real page carries', () => {
    const resolved = 'https://pocketcasts.com/podcast/show/642bf450-e9fa-013a-da18-0acc26574db2/episode/f7269801-ce3f-48fc-9e57-3783fdbbe7d2'
    const html = fixture('20261027-pocket-casts-rendered.html').replace(/class="[^"]*_showNotesWrapper_[^"]*"/, 'class="notes"')
    const info = parsePocketCastsPage(resolved, html)!
    expect(info.shownotes).toContain('《宏观漫谈》，《高能量》首档专栏节目')
    expect(info.shownotes).not.toContain('&#')
  })

  test('skips download anchors that are not audio, and rejected candidates fall through', () => {
    const audio = '<a download href="https://media.example.com/episode.m4a">Download</a>'
    const page = html().replace(audio, '<a download href="/transcript.pdf">PDF</a><a download href="http://127.0.0.1/first.m4a">LAN</a>' + audio)
    expect(parsePocketCastsPage(short, page)!.audioUrl).toBe('https://media.example.com/episode.m4a')
    expect(parsePocketCastsPage(short, html().replace(audio, '<a download href="/transcript.pdf">PDF</a>'))).toBeNull()
  })

  test('structured audio comes before download anchors; an unsafe one falls through', () => {
    const og = (url: string) => html().replace('</head>', `<meta property="og:audio" content="${url}"></head>`)
    expect(parsePocketCastsPage(short, og('https://cdn.example.com/structured.mp3'))!.audioUrl).toBe('https://cdn.example.com/structured.mp3')
    expect(parsePocketCastsPage(short, og('https://user:pass@cdn.example.com/structured.mp3'))!.audioUrl).toBe('https://media.example.com/episode.m4a')
  })
})
