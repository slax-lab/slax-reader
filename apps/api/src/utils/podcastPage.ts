import { DOMParser } from 'linkedom'
import { classifyPodcastUrl, emptyInfo, outboundUrlProblem, parseDuration, podcastLanguage, stripHtml, type PodcastEpisodeInfo, type PodcastFeed } from './podcastSource'
import { extractYoutubeVideoId } from './platformDetector'

/** Public episode markup only. Never execute scripts or use an audio preview. */
export function parsePublicPodcastPage(pageUrl: string, html: string): { info: PodcastEpisodeInfo; feedUrl: string } | null {
  const kind = classifyPodcastUrl(pageUrl)
  if (!kind) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const url = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim()) return ''
    try {
      const resolved = new URL(value, pageUrl).toString()
      return outboundUrlProblem(resolved) ? '' : resolved
    } catch {
      return ''
    }
  }
  const meta = (name: string) => doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') || ''
  const nodes: any[] = []
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const value = JSON.parse(script.textContent || '')
      for (const item of Array.isArray(value) ? value : [value]) nodes.push(...(Array.isArray(item?.['@graph']) ? item['@graph'] : [item]))
    } catch {
      /* Invalid publisher JSON does not identify an episode. */
    }
  }
  const episodes = nodes.filter(x => ([] as any[]).concat(x?.['@type'] ?? []).includes('PodcastEpisode'))
  const episode = episodes.find(x => url(x.url || x['@id']) === pageUrl) ?? (episodes.length === 1 ? episodes[0] : undefined)
  const info = emptyInfo(kind, pageUrl)
  info.title = String(episode?.name || meta('og:title') || doc.querySelector('h1')?.textContent || '').trim()
  info.showName = String(episode?.partOfSeries?.name || '').trim()
  info.shownotes = stripHtml(String(episode?.description || meta('og:description') || ''))
  info.coverUrl = url(typeof episode?.image === 'string' ? episode.image : episode?.image?.url) || url(meta('og:image'))
  info.languageTag = episode?.inLanguage || doc.documentElement?.getAttribute('lang') || null
  info.language = podcastLanguage(info.languageTag)
  const date = episode?.datePublished || meta('article:published_time')
  if (date && Number.isFinite(Date.parse(date))) info.publishedAt = new Date(date)
  const duration = String(episode?.duration || episode?.timeRequired || '')
  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(duration)
  info.durationSec = iso ? Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0) : parseDuration(duration)
  const audioEntries = ([] as any[]).concat(episode?.associatedMedia || [], episode?.audio || [])
  const restrictedAudio = audioEntries.some(x => x?.isPreview || x?.isAccessibleForFree === false || x?.isAccessibleForFree === 'false')
  const restricted = restrictedAudio || episode?.isAccessibleForFree === false || episode?.isAccessibleForFree === 'false'
  if (!restricted) {
    const audio = ([] as any[])
      .concat(episode?.associatedMedia || [], episode?.audio || [])
      .find((x: any) => x?.['@type'] === 'AudioObject' && !x?.isPreview && x?.isAccessibleForFree !== false && x?.isAccessibleForFree !== 'false')
    info.audioUrl = url(audio?.contentUrl) || url(doc.querySelector('audio:not([data-preview]) source[src], audio:not([data-preview])[src]')?.getAttribute('src'))
    // Explicit podcast audio metadata excludes Spotify's preview fields.
    if (!info.audioUrl && kind !== 'spotify') info.audioUrl = url(meta('og:audio'))
  }
  for (const link of doc.querySelectorAll('link[rel="alternate"][type], a[rel="transcript"][type]')) {
    const type = link.getAttribute('type') || ''
    const href = url(link.getAttribute('href'))
    if (href && /vtt|subrip|srt|json|text\/plain/.test(type)) info.transcripts.push({ url: href, type, language: info.language })
  }
  const videos = ([] as any[]).concat(episode?.video || [], episode?.associatedMedia || [], episode?.subjectOf || [], episode?.sameAs || [])
  for (const video of videos) {
    const raw = typeof video === 'string' ? video : video?.embedUrl || video?.contentUrl || video?.url
    const safe = url(raw)
    const id = safe && extractYoutubeVideoId(safe)
    if (id) {
      info.transcripts.push({ url: `https://www.youtube.com/watch?v=${id}`, type: 'application/x-youtube-captions', language: info.language })
      break
    }
  }
  const feedUrl = url(doc.querySelector('link[rel="alternate"][type="application/rss+xml"]')?.getAttribute('href'))
  return { info, feedUrl }
}

/** A title alone must never select an episode from a show feed. */
export function exactPodcastFeedItem(info: PodcastEpisodeInfo, feed: PodcastFeed) {
  if (info.audioUrl) {
    const matches = feed.items.filter(item => item.audioUrl === info.audioUrl)
    return matches.length === 1 ? matches[0] : null
  }
  if (!info.title || !info.publishedAt || info.durationSec == null) return null
  const matches = feed.items.filter(
    item =>
      item.title.trim() === info.title.trim() &&
      item.publishedAt?.toISOString().slice(0, 10) === info.publishedAt!.toISOString().slice(0, 10) &&
      item.durationSec != null &&
      Math.abs(item.durationSec - info.durationSec!) <= 2
  )
  return matches.length === 1 ? matches[0] : null
}
