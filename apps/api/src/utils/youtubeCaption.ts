import type { TikHubYoutubeCaptionTrack, TikHubYoutubeJson3Event } from '@/const/moreapi/youtube'
import type { YoutubeCue } from '@/utils/htmlBuilder'
import { hashSHA256 } from '@/utils/strings'

/**
 * Immutable, normalized caption document for one YouTube video.
 * It is the source for the AI article pipeline; the legacy `YoutubeCue` (whole seconds, text)
 * used by the player HTML is derived from it and must stay byte-identical to the old output.
 */
export const YOUTUBE_CAPTION_SCHEMA_VERSION = 1 as const

export type YoutubeCaptionKind = 'manual' | 'asr' | 'translated' | 'unknown'

export interface YoutubeCaptionCue {
  id: string
  start_ms: number
  duration_ms?: number
  text: string
}

export interface YoutubeCaptionDocument {
  schema_version: typeof YOUTUBE_CAPTION_SCHEMA_VERSION
  video_id: string
  language: string
  language_name?: string
  kind: YoutubeCaptionKind
  source_track: string
  cues: YoutubeCaptionCue[]
}

/** `a.en` → `en`, `pt-BR` → `pt-br`. */
export function captionBaseLanguage(languageCode: string): string {
  return languageCode.replace(/^a\./, '').toLowerCase()
}

export function captionKindFromTrack(track: TikHubYoutubeCaptionTrack): YoutubeCaptionKind {
  if (track.kind === 'asr') return 'asr'
  return 'manual'
}

/** Same text cleaning the legacy cue parser applied: join segments, newlines to spaces, trim. */
function eventText(e: TikHubYoutubeJson3Event): string {
  if (!e.segs) return ''
  return e.segs
    .map(s => s.utf8 ?? '')
    .join('')
    .replace(/\n/g, ' ')
    .trim()
}

export function buildYoutubeCaptionDocument(videoId: string, track: TikHubYoutubeCaptionTrack, events: TikHubYoutubeJson3Event[]): YoutubeCaptionDocument {
  const cues: YoutubeCaptionCue[] = []
  for (const e of events) {
    const text = eventText(e)
    if (!text) continue
    const cue: YoutubeCaptionCue = { id: `c${String(cues.length).padStart(4, '0')}`, start_ms: e.tStartMs ?? 0, text }
    if (typeof e.dDurationMs === 'number') cue.duration_ms = e.dDurationMs
    cues.push(cue)
  }
  const doc: YoutubeCaptionDocument = {
    schema_version: YOUTUBE_CAPTION_SCHEMA_VERSION,
    video_id: videoId,
    language: captionBaseLanguage(track.language_code),
    kind: captionKindFromTrack(track),
    source_track: track.language_code,
    cues
  }
  if (track.language_name) doc.language_name = track.language_name
  return doc
}

/**
 * Legacy cues for `data-cues` and the transcript HTML: whole seconds, cues that start in the
 * same second merged with a space. Must not change, the frontend and old bookmarks depend on it.
 */
export function toCompatCues(cues: YoutubeCaptionCue[]): YoutubeCue[] {
  const out: YoutubeCue[] = []
  for (const cue of cues) {
    const t = Math.floor(cue.start_ms / 1000)
    const last = out[out.length - 1]
    if (last && last.t === t) {
      last.text = `${last.text} ${cue.text}`.trim()
    } else {
      out.push({ t, text: cue.text })
    }
  }
  return out
}

const MIN_OVERLAP_WORDS = 2
const MIN_OVERLAP_CHARS = 4
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/

interface TokenizedCue {
  tokens: string[]
  keys: string[]
  joiner: string
}

function tokenize(text: string): TokenizedCue {
  const byWords = /\s/.test(text.trim()) || !CJK_RE.test(text)
  const tokens = byWords ? text.split(/\s+/).filter(Boolean) : Array.from(text.trim())
  const keys = tokens.map(t => t.toLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ''))
  return { tokens, keys, joiner: byWords ? ' ' : '' }
}

function overlapLength(prev: TokenizedCue, curr: TokenizedCue): number {
  const min = prev.joiner === ' ' || curr.joiner === ' ' ? MIN_OVERLAP_WORDS : MIN_OVERLAP_CHARS
  const max = Math.min(prev.keys.length, curr.keys.length)
  for (let n = max; n >= min; n--) {
    let same = true
    for (let i = 0; i < n; i++) {
      const a = prev.keys[prev.keys.length - n + i]
      const b = curr.keys[i]
      if (!a || a !== b) {
        same = false
        break
      }
    }
    if (same) return n
  }
  return 0
}

/**
 * Auto captions scroll: each cue often repeats the tail of the previous one. Strip the repeated
 * prefix (word level, or character level for CJK without spaces) and drop cues that were only a
 * repeat. Raw cues are left untouched; the caller keeps them for audit and seeking.
 */
export function dedupeRollingCues(cues: YoutubeCaptionCue[]): YoutubeCaptionCue[] {
  const out: YoutubeCaptionCue[] = []
  let prev: TokenizedCue | null = null
  for (const cue of cues) {
    const curr = tokenize(cue.text)
    const k = prev ? overlapLength(prev, curr) : 0
    prev = curr
    const rest = curr.tokens.slice(k)
    if (!rest.length) continue
    out.push({ ...cue, text: rest.join(curr.joiner) })
  }
  return out
}

/** Cleaned plain text for search, gating and AI input. */
export function captionPlainText(doc: YoutubeCaptionDocument): string {
  return dedupeRollingCues(doc.cues)
    .map(c => c.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Identity of the caption source: canonical cues plus track metadata plus schema version.
 * Different tracks, edited captions or a schema change all produce a new hash.
 * A video without captions hashes its id only, so the "no caption" state is still addressable.
 */
export async function captionSourceHash(doc: YoutubeCaptionDocument | null, videoId?: string): Promise<string> {
  const canonical = doc
    ? {
        v: doc.schema_version,
        video_id: doc.video_id,
        source_track: doc.source_track,
        language: doc.language,
        kind: doc.kind,
        cues: doc.cues.map(c => [c.start_ms, c.duration_ms ?? null, c.text])
      }
    : { v: YOUTUBE_CAPTION_SCHEMA_VERSION, video_id: videoId ?? '', cues: [] }
  return hashSHA256(JSON.stringify(canonical))
}

/**
 * Canonical caption keys, shared by every bookmark of the video. The hash makes the object
 * immutable: a changed caption gets a new key, and two crawls of the same captions write the
 * same bytes to the same key. R2 keys carry no permission; readers go through the bookmark.
 */
export function youtubeCaptionKeys(videoId: string, sourceHash: string) {
  const base = `youtube/canonical/captions/${videoId}/${sourceHash}`
  return { captionKey: `${base}.json`, captionTextKey: `${base}.txt` }
}
