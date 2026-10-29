import { DOMParser } from 'linkedom'
import { hashSHA256 } from '@/utils/strings'

/**
 * Podcast sources: which links are podcast episodes, and how to read the episode (audio URL,
 * metadata, publisher transcripts) out of a 小宇宙 page, an Apple lookup answer, an RSS feed or a
 * direct audio link. Pure functions over text; the network calls live in CrawlService.
 * Ported from papears (sources/xiaoyuzhou.py, apple.py, rss.py, urlpolicy.py).
 */

export type PodcastSourceKind = 'xiaoyuzhou' | 'apple' | 'audio' | 'feed' | 'spotify' | 'pocketcasts'
export type PodcastLanguage = 'zh' | 'en'

export interface PodcastTranscriptRef {
  url: string
  type: string
  language: string | null
}

export interface PodcastEpisodeInfo {
  kind: PodcastSourceKind
  pageUrl: string
  /** Empty for Spotify: no audio is available, only the embed. */
  audioUrl: string
  embedUrl: string
  title: string
  showName: string
  author: string
  coverUrl: string
  durationSec: number | null
  language: PodcastLanguage | null
  /** The language as the source states it (for example "ja"), so an unsupported one is known before transcription. */
  languageTag: string | null
  shownotes: string
  publishedAt: Date | null
  transcripts: PodcastTranscriptRef[]
}

const XIAOYUZHOU_EPISODE_RE = /^https?:\/\/(?:www\.)?xiaoyuzhoufm\.com\/episode\/([A-Za-z0-9]+)/i
const APPLE_PODCAST_RE = /^https?:\/\/podcasts\.apple\.com\/[^?#]*\/id(\d+)/i
const SPOTIFY_EPISODE_RE = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?episode\/([A-Za-z0-9]+)/i
const AUDIO_EXT_RE = /\.(?:mp3|m4a|aac|ogg|oga|opus|wav)$/i
const FEED_EXT_RE = /\.(?:xml|rss)$/i

/**
 * Which podcast source a URL is, or null when it is not a podcast link. Apple show pages (no
 * episode id) are not episodes and stay null. Feed-like URLs count; the fetch fails when the feed
 * has no audio enclosure.
 */
export function classifyPodcastUrl(raw: string): PodcastSourceKind | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (XIAOYUZHOU_EPISODE_RE.test(raw)) return 'xiaoyuzhou'
  if (APPLE_PODCAST_RE.test(raw)) return url.searchParams.get('i') ? 'apple' : null
  if (SPOTIFY_EPISODE_RE.test(raw)) return 'spotify'
  if (isPocketCastsEpisode(url)) return 'pocketcasts'
  const path = url.pathname.toLowerCase()
  if (AUDIO_EXT_RE.test(path)) return 'audio'
  const host = url.hostname.toLowerCase()
  if (FEED_EXT_RE.test(path) || host.startsWith('feed.') || host.startsWith('feeds.') || /\/(?:feed|rss)(?:\/|$)/.test(path) || host === 'anchor.fm') return 'feed'
  return null
}

const POCKET_UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'

function isPocketCastsEpisode(url: URL): boolean {
  if (url.hostname === 'pca.st') return new RegExp(`^/episode/${POCKET_UUID}/?$`, 'i').test(url.pathname)
  if (!['pocketcasts.com', 'www.pocketcasts.com'].includes(url.hostname)) return false
  return new RegExp(`^/podcast/[^/]+/${POCKET_UUID}/[^/]+/${POCKET_UUID}/?$`, 'i').test(url.pathname)
}

/** Read only rendered episode data. Page scripts and HTML transcript viewers are not transcript sources. */
export function parsePocketCastsPage(pageUrl: string, html: string): PodcastEpisodeInfo | null {
  if (classifyPodcastUrl(pageUrl) !== 'pocketcasts') return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const meta = (name: string) => doc.querySelector(`meta[property="${name}"]`)?.getAttribute('content') ?? ''
  const safeUrl = (raw: string | null | undefined): string => {
    if (!raw) return ''
    try {
      const url = new URL(raw, pageUrl).toString()
      return outboundUrlProblem(url) ? '' : url
    } catch {
      return ''
    }
  }
  // Structured audio first. A download anchor counts only when it names an audio file: the page
  // also offers other downloads. Each candidate is screened in turn, so a rejected one falls through.
  const structured = [meta('og:audio'), doc.querySelector('audio[src], audio source[src]')?.getAttribute('src')].map(safeUrl)
  const downloads = [...doc.querySelectorAll('a[download][href]')].map(a => safeUrl(a.getAttribute('href'))).filter(url => url && AUDIO_EXT_RE.test(new URL(url).pathname))
  const audioUrl = [...structured, ...downloads].find(Boolean) ?? ''
  if (!audioUrl) return null
  const info = emptyInfo('pocketcasts', pageUrl)
  info.audioUrl = audioUrl
  info.title = (meta('og:title') || doc.querySelector('h1')?.textContent || '').trim()
  info.showName = doc.querySelector('[data-testid="podcast-title"]')?.textContent?.trim() ?? ''
  info.author = info.showName
  info.coverUrl = safeUrl(meta('og:image'))
  info.shownotes = stripHtml(doc.querySelector('[class*="_showNotesWrapper_"]')?.innerHTML || meta('og:description'))
  const duration = doc.querySelector('.duration-text')?.textContent?.trim() ?? ''
  const units = /^(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?$/.exec(duration)
  info.durationSec = units ? Number(units[1] || 0) * 3600 + Number(units[2] || 0) * 60 + Number(units[3] || 0) || null : parseDuration(duration)
  for (const el of doc.querySelectorAll('link[rel="transcript"][href], a[rel="transcript"][href], track[kind="captions"][src]')) {
    const type = el.getAttribute('type') ?? (el.localName === 'track' ? 'text/vtt' : '')
    const url = safeUrl(el.getAttribute('href') || el.getAttribute('src'))
    if (url && ['text/vtt', 'application/x-subrip', 'application/srt', 'application/json'].includes(type)) {
      info.transcripts.push({ url, type, language: el.getAttribute('hreflang') || el.getAttribute('srclang') || null })
    }
  }
  return info
}

// ---------- outbound URL screen ----------

const BLOCKED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback'])
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa']

function ipv4Blocked(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  )
}

/**
 * Early outbound filter with a readable reason (papears urlpolicy): http(s) only, default ports,
 * no credentials, no localhost or private/reserved IP literals. Not a security boundary: hostnames
 * are not resolved, so DNS tricks are out of scope. Returns null when the URL passes.
 */
export function outboundUrlProblem(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return 'unparsable'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'scheme'
  if (url.username || url.password) return 'credentials'
  if (url.port && url.port !== '80' && url.port !== '443') return 'port'
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some(s => host.endsWith(s))) return 'local_host'
  if (ipv4Blocked(host)) return 'private_ip'
  if (host.includes(':')) {
    // IPv6 literal: allow only global unicast (2000::/3). This also rejects every IPv4-mapped
    // literal (::ffff:...), private or not
    if (!/^[23]/.test(host)) return 'private_ip'
  }
  return null
}

// ---------- shared helpers ----------

/** Plain text from shownotes HTML: tags out, entities decoded, whitespace folded, capped. */
export function stripHtml(html: string, max = 4000): string {
  if (!html) return ''
  const text = html
    .replace(/<(?:br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
  return text.length > max ? text.slice(0, max) : text
}

/** "01:02:03", "62:03", "3723" or "3723.5" → seconds; null when unreadable. */
export function parseDuration(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null
  const v = value.trim()
  if (/^\d+(?:\.\d+)?$/.test(v)) return Math.round(Number(v)) || null
  const parts = v.split(':').map(Number)
  if (parts.some(n => !Number.isFinite(n))) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0) || null
}

/** Feed or metadata language → zh / en, or null for anything else or unknown. */
export function podcastLanguage(value: string | null | undefined): PodcastLanguage | null {
  const v = (value ?? '').trim().toLowerCase()
  if (v.startsWith('zh') || v.startsWith('cmn') || v.startsWith('yue')) return 'zh'
  if (v.startsWith('en')) return 'en'
  return null
}

/**
 * Stable id of an episode across bookmarks: SHA-256 of the audio URL with the host lowercased and
 * the fragment dropped. Different tracking prefixes for the same file give different ids; that only
 * costs a second transcription, never a wrong one.
 */
export async function podcastSourceId(audioUrl: string): Promise<string> {
  let normalized = audioUrl.trim()
  try {
    const u = new URL(normalized)
    u.hash = ''
    u.hostname = u.hostname.toLowerCase()
    normalized = u.toString()
  } catch {
    // keep the raw string
  }
  return (await hashSHA256(normalized)).slice(0, 32)
}

function emptyInfo(kind: PodcastSourceKind, pageUrl: string): PodcastEpisodeInfo {
  return {
    kind,
    pageUrl,
    audioUrl: '',
    embedUrl: '',
    title: '',
    showName: '',
    author: '',
    coverUrl: '',
    durationSec: null,
    language: null,
    languageTag: null,
    shownotes: '',
    publishedAt: null,
    transcripts: []
  }
}

function parseDate(value: unknown): Date | null {
  if (!value) return null
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

// ---------- 小宇宙 ----------

const NEXT_DATA_RE = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
const META_RE = /<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"/g

/** A 小宇宙 episode page: the Next.js data blob first, og: meta tags as the fallback. Always Chinese. */
export function parseXiaoyuzhouPage(pageUrl: string, html: string): PodcastEpisodeInfo {
  const id = XIAOYUZHOU_EPISODE_RE.exec(pageUrl)?.[1]
  const info = emptyInfo('xiaoyuzhou', id ? `https://www.xiaoyuzhoufm.com/episode/${id}` : pageUrl)
  let ep: Record<string, any> = {}
  const nd = NEXT_DATA_RE.exec(html)
  if (nd) {
    try {
      ep = JSON.parse(nd[1])?.props?.pageProps?.episode ?? {}
    } catch {
      ep = {}
    }
  }
  const meta: Record<string, string> = {}
  for (const m of html.matchAll(META_RE)) meta[m[1]] = m[2]
  info.audioUrl = ep.enclosure?.url || ep.media?.source?.url || meta['og:audio'] || ''
  info.title = String(ep.title || meta['og:title'] || '').trim()
  info.showName = String(ep.podcast?.title || '').trim()
  info.author = String(ep.podcast?.author || '').trim()
  info.coverUrl = ep.image?.picUrl || ep.podcast?.image?.picUrl || meta['og:image'] || ''
  info.durationSec = parseDuration(ep.duration)
  info.shownotes = stripHtml(ep.shownotes || ep.description || meta['og:description'] || '')
  info.publishedAt = parseDate(ep.pubDate)
  info.language = 'zh'
  info.languageTag = 'zh'
  return info
}

// ---------- Apple Podcasts ----------

/** Show id and episode id of an Apple Podcasts episode URL. */
export function parseAppleUrl(raw: string): { showId: string; episodeId: string } | null {
  const show = APPLE_PODCAST_RE.exec(raw)?.[1]
  let episode = ''
  try {
    episode = new URL(raw).searchParams.get('i') ?? ''
  } catch {
    return null
  }
  return show && episode ? { showId: show, episodeId: episode } : null
}

export function appleLookupUrl(showId: string): string {
  return `https://itunes.apple.com/lookup?id=${encodeURIComponent(showId)}&entity=podcastEpisode&limit=300`
}

/**
 * The episode out of the iTunes lookup answer for its show (the lookup API does not answer episode
 * ids directly). Returns the episode and the show's feed URL, or null when the episode is not among
 * the latest 300.
 */
export function pickAppleEpisode(pageUrl: string, lookup: { results?: Record<string, any>[] }, episodeId: string): { info: PodcastEpisodeInfo; feedUrl: string } | null {
  const results = lookup.results ?? []
  const show = results.find(r => r.wrapperType === 'track') ?? {}
  const ep = results.find(r => String(r.trackId) === episodeId)
  if (!ep) return null
  const info = emptyInfo('apple', ep.trackViewUrl || pageUrl)
  info.audioUrl = ep.episodeUrl || ''
  info.title = String(ep.trackName || '').trim()
  info.showName = String(ep.collectionName || show.collectionName || '').trim()
  info.author = String(show.artistName || '').trim()
  info.coverUrl = ep.artworkUrl600 || ep.artworkUrl160 || show.artworkUrl600 || ''
  info.durationSec = ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 1000) : null
  info.shownotes = stripHtml(ep.description || ep.shortDescription || '')
  info.publishedAt = parseDate(ep.releaseDate)
  return { info, feedUrl: ep.feedUrl || show.feedUrl || '' }
}

// ---------- RSS ----------

export interface PodcastFeedItem {
  guid: string
  title: string
  audioUrl: string
  durationSec: number | null
  publishedAt: Date | null
  description: string
  coverUrl: string
  transcripts: PodcastTranscriptRef[]
}

export interface PodcastFeed {
  title: string
  author: string
  coverUrl: string
  language: PodcastLanguage | null
  languageTag: string | null
  items: PodcastFeedItem[]
}

const AUDIO_TYPE_RE = /^audio\//i

function textOf(el: Element | null | undefined, tag: string): string {
  return el?.getElementsByTagName(tag)[0]?.textContent?.trim() ?? ''
}

/** Parse an RSS 2.0 podcast feed. Items without an audio enclosure keep an empty audioUrl. */
export function parsePodcastFeed(xml: string): PodcastFeed {
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
  const channel = doc.getElementsByTagName('channel')[0]
  if (!channel) throw new Error('not an RSS feed')
  const channelImage = channel.getElementsByTagName('itunes:image')[0]?.getAttribute('href') || textOf(channel.getElementsByTagName('image')[0], 'url')
  const items = [...doc.getElementsByTagName('item')].map(item => {
    const enclosures = [...item.getElementsByTagName('enclosure')]
    const audio = enclosures.find(e => AUDIO_TYPE_RE.test(e.getAttribute('type') ?? '') || AUDIO_EXT_RE.test((e.getAttribute('url') ?? '').split('?')[0]))
    const transcripts = [...item.getElementsByTagName('podcast:transcript')]
      .map(t => ({ url: t.getAttribute('url') ?? '', type: (t.getAttribute('type') ?? '').toLowerCase(), language: t.getAttribute('language') }))
      .filter(t => t.url)
    return {
      guid: textOf(item, 'guid'),
      title: textOf(item, 'title'),
      audioUrl: audio?.getAttribute('url') ?? '',
      durationSec: parseDuration(textOf(item, 'itunes:duration')),
      publishedAt: parseDate(textOf(item, 'pubDate')),
      description: stripHtml(textOf(item, 'content:encoded') || textOf(item, 'description') || textOf(item, 'itunes:summary')),
      coverUrl: item.getElementsByTagName('itunes:image')[0]?.getAttribute('href') ?? '',
      transcripts
    }
  })
  return {
    title: textOf(channel, 'title'),
    author: textOf(channel, 'itunes:author'),
    coverUrl: channelImage ?? '',
    language: podcastLanguage(textOf(channel, 'language')),
    languageTag: textOf(channel, 'language').toLowerCase() || null,
    items
  }
}

/** The newest item with audio: what saving a feed URL means. */
export function latestFeedEpisode(feedUrl: string, feed: PodcastFeed): PodcastEpisodeInfo | null {
  const withAudio = feed.items.filter(i => i.audioUrl)
  if (withAudio.length === 0) return null
  const item = [...withAudio].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))[0]
  return feedItemToInfo('feed', feedUrl, feed, item)
}

/** The feed item of a known episode: same audio URL first, then the same title. */
export function findFeedItem(feed: PodcastFeed, match: { audioUrl?: string; title?: string; guid?: string }): PodcastFeedItem | null {
  const strip = (u: string) =>
    u
      .split('?')[0]
      .replace(/^https?:\/\//, '')
      .toLowerCase()
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase()
  return (
    (match.guid && feed.items.find(i => i.guid === match.guid)) ||
    (match.audioUrl && feed.items.find(i => i.audioUrl && (i.audioUrl === match.audioUrl || strip(i.audioUrl).endsWith(strip(match.audioUrl!).split('/').slice(-1)[0])))) ||
    (match.title && feed.items.find(i => norm(i.title) === norm(match.title!))) ||
    null
  )
}

export function feedItemToInfo(kind: PodcastSourceKind, pageUrl: string, feed: PodcastFeed, item: PodcastFeedItem): PodcastEpisodeInfo {
  const info = emptyInfo(kind, pageUrl)
  info.audioUrl = item.audioUrl
  info.title = item.title
  info.showName = feed.title
  info.author = feed.author
  info.coverUrl = item.coverUrl || feed.coverUrl
  info.durationSec = item.durationSec
  info.language = feed.language
  info.languageTag = feed.languageTag
  info.shownotes = item.description
  info.publishedAt = item.publishedAt
  info.transcripts = item.transcripts
  return info
}

/** Fill gaps in an Apple episode with what its feed knows: transcripts, language, fuller notes. */
export function enrichFromFeed(info: PodcastEpisodeInfo, feed: PodcastFeed, item: PodcastFeedItem | null): PodcastEpisodeInfo {
  return {
    ...info,
    language: info.language ?? feed.language,
    languageTag: info.languageTag ?? feed.languageTag,
    transcripts: item?.transcripts.length ? item.transcripts : info.transcripts,
    shownotes: item?.description && item.description.length > info.shownotes.length ? item.description : info.shownotes,
    durationSec: info.durationSec ?? item?.durationSec ?? null,
    coverUrl: info.coverUrl || item?.coverUrl || feed.coverUrl
  }
}

// ---------- direct audio and Spotify ----------

export function directAudioInfo(url: string): PodcastEpisodeInfo {
  const info = emptyInfo('audio', url)
  info.audioUrl = url
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '').replace(AUDIO_EXT_RE, '')
  info.title = name.replace(/[-_]+/g, ' ').trim() || 'Audio'
  return info
}

export function spotifyEpisodeId(url: string): string | null {
  return SPOTIFY_EPISODE_RE.exec(url)?.[1] ?? null
}

export function spotifyInfo(url: string, oembed: { title?: string; thumbnail_url?: string } | null): PodcastEpisodeInfo {
  const id = spotifyEpisodeId(url)
  const info = emptyInfo('spotify', id ? `https://open.spotify.com/episode/${id}` : url)
  info.embedUrl = id ? `https://open.spotify.com/embed/episode/${id}` : ''
  info.title = String(oembed?.title ?? '').trim() || 'Spotify'
  info.coverUrl = oembed?.thumbnail_url ?? ''
  return info
}
