import { hashSHA256 } from './strings'
import type { YoutubeArticleDocument, YoutubeArticleLanguage } from './youtubeArticle'
import type { PodcastPlayerInfo } from './podcastArticle'
import type { YoutubeCaptionCue } from './youtubeCaption'

export interface PodcastSnapshotInput {
  sourceId: string
  fingerprint: string
  transcriptHash: string | null
}

/** Lease, cost and scheduling updates do not change generation inputs. */
export function podcastInputFingerprint(ep: {
  audio_url: string
  title: string
  show_name: string
  shownotes: string
  duration_sec: number | null
  publisher_transcripts: unknown
}) {
  return hashSHA256(JSON.stringify([ep.audio_url, ep.title, ep.show_name, ep.shownotes, ep.duration_sec, ep.publisher_transcripts]))
}

export type MediaLanguage = YoutubeArticleLanguage
export type PrivateMediaState = 'pending' | 'ready' | 'failed' | 'skipped' | 'unavailable'
export interface PrivateMediaContent {
  language: MediaLanguage
  format: 'article' | 'dialogue'
  lede: string
  sections: { heading: string; start_ms: number; paragraphs: { speaker: string | null; text: string; start_ms: number }[] }[]
}
export interface PrivateMediaVariant {
  status: PrivateMediaState
  content?: PrivateMediaContent
  document?: YoutubeArticleDocument
  eligibility?: { decision: 'generate' | 'skip' | 'review'; reason_codes: string[] }
  reason?: string
}
export interface MediaSnapshot {
  schema: 1
  kind: 'youtube' | 'podcast'
  mode: 'capture' | 'fork'
  revision: string
  sourceId: string
  sourceHash: string
  inputFingerprint: string
  defaultLanguage: MediaLanguage
  transcript: PrivateMediaState
  bodyLanguage: MediaLanguage | null
  policyDenied?: boolean
  transcriptReason?: string
  variants: Partial<Record<MediaLanguage, PrivateMediaVariant>>
  cues?: YoutubeCaptionCue[]
  player?: PodcastPlayerInfo
}

export function privateMediaVersion(snapshot: MediaSnapshot, language: MediaLanguage) {
  return `${snapshot.revision}-${language}`
}

/** Pending work belongs to one capture; copying it never creates a subscription. */
export function freezeMediaSnapshot(source: MediaSnapshot, revision: string): MediaSnapshot {
  const copy = structuredClone(source)
  copy.mode = 'fork'
  copy.revision = revision
  if (copy.transcript !== 'ready') copy.transcript = 'unavailable'
  for (const language of ['en', 'zh'] as const) {
    if (copy.variants[language]?.status !== 'ready') copy.variants[language] = { status: 'unavailable' }
  }
  return copy
}

export function canSettleMedia(snapshot: MediaSnapshot, language: MediaLanguage, fingerprint: string) {
  return snapshot.mode === 'capture' && snapshot.inputFingerprint === fingerprint && snapshot.variants[language]?.status === 'pending'
}

/** A managed pointer without its manifest is broken, never an invitation to read shared data. */
export function parseMediaSnapshot(value: unknown): MediaSnapshot | null {
  if (!value || typeof value !== 'object') throw new Error('Invalid private snapshot manifest')
  const data = value as MediaSnapshot | { schema: 1; kind: 'html' }
  if (data.schema !== 1) throw new Error('Unsupported private snapshot schema')
  if (data.kind === 'html') return null
  if (
    !['youtube', 'podcast'].includes(data.kind) ||
    !['capture', 'fork'].includes(data.mode) ||
    typeof data.revision !== 'string' ||
    typeof data.sourceId !== 'string' ||
    typeof data.sourceHash !== 'string' ||
    typeof data.inputFingerprint !== 'string' ||
    !['en', 'zh'].includes(data.defaultLanguage) ||
    !['pending', 'ready', 'failed', 'skipped', 'unavailable'].includes(data.transcript) ||
    !data.variants ||
    (data.bodyLanguage !== null && !['en', 'zh'].includes(data.bodyLanguage))
  )
    throw new Error('Invalid private media snapshot')
  for (const [language, variant] of Object.entries(data.variants)) {
    if (
      !['en', 'zh'].includes(language) ||
      !variant ||
      !['pending', 'ready', 'failed', 'skipped', 'unavailable'].includes(variant.status) ||
      (variant.status === 'ready' &&
        (!variant.content || variant.content.language !== language || typeof variant.content.lede !== 'string' || !Array.isArray(variant.content.sections)))
    )
      throw new Error('Invalid private media variant')
  }
  return data
}

export function normalizedMediaContent(doc: YoutubeArticleDocument, cues: YoutubeCaptionCue[]): PrivateMediaContent {
  const starts = new Map(cues.map(c => [c.id, c.start_ms]))
  return {
    language: doc.language,
    format: doc.format === 'dialogue' ? 'dialogue' : 'article',
    lede: doc.lede,
    sections: doc.sections.map(section => ({
      heading: section.heading,
      start_ms: section.start_ms,
      paragraphs: section.paragraphs.map(p => {
        const times = p.source_cue_ids.map(id => starts.get(id)).filter((n): n is number => n !== undefined)
        return { speaker: p.speaker, text: p.text, start_ms: times.length ? Math.min(...times) : section.start_ms }
      })
    }))
  }
}
