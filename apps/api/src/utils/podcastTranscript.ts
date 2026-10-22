import { hashSHA256 } from '@/utils/strings'
import type { PodcastLanguage, PodcastTranscriptRef } from '@/utils/podcastSource'

/**
 * Podcast transcripts: publisher transcript files (VTT, SRT, Podcasting 2.0 JSON, timed plain text)
 * and speech-to-text output, turned into one cue document with timing and speakers. The cue shape
 * is the YouTube caption cue plus a speaker, so the article pipeline reads both.
 */

export const PODCAST_TRANSCRIPT_SCHEMA_VERSION = 1 as const

export interface TranscriptSegment {
  start_ms: number
  end_ms: number
  text: string
  speaker: string | null
}

export interface PodcastCue {
  id: string
  start_ms: number
  duration_ms: number
  text: string
  speaker?: string
}

export interface PodcastTranscriptDocument {
  schema_version: typeof PODCAST_TRANSCRIPT_SCHEMA_VERSION
  source: 'publisher' | 'assemblyai'
  language: PodcastLanguage
  speakers: boolean
  duration_ms: number
  cues: PodcastCue[]
}

/** Cue grouping (spec 3.3): cut at a sentence end once 8 s are reached, at 30 s, and at every speaker change. */
export const CUE_MIN_SENTENCE_MS = 8_000
export const CUE_MAX_MS = 30_000

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/
const SENTENCE_END_RE = /[.!?。！？…]["'”’)）]*$/

// ---------- choosing a publisher transcript ----------

function refFormat(ref: PodcastTranscriptRef): 'vtt' | 'srt' | 'json' | 'text' | null {
  const type = ref.type.toLowerCase()
  const path = ref.url.split('?')[0].toLowerCase()
  if (type.includes('vtt') || path.endsWith('.vtt')) return 'vtt'
  if (type.includes('subrip') || type.includes('srt') || path.endsWith('.srt')) return 'srt'
  if (type.includes('json') || path.endsWith('.json')) return 'json'
  if (type === 'text/plain' || path.endsWith('.txt')) return 'text'
  return null
}

const FORMAT_RANK = { vtt: 0, srt: 1, json: 2, text: 3 } as const

/** Publisher transcript to use: VTT, then SRT, then JSON, then timed plain text. HTML is skipped (no timing). */
export function chooseTranscriptRef(refs: PodcastTranscriptRef[]): { ref: PodcastTranscriptRef; format: 'vtt' | 'srt' | 'json' | 'text' } | null {
  const ranked = refs
    .map(ref => ({ ref, format: refFormat(ref) }))
    .filter((r): r is { ref: PodcastTranscriptRef; format: 'vtt' | 'srt' | 'json' | 'text' } => r.format !== null)
    .sort((a, b) => FORMAT_RANK[a.format] - FORMAT_RANK[b.format])
  return ranked[0] ?? null
}

// ---------- parsers ----------

/** "00:01:02.345", "01:02.345" or "00:01:02,345" → ms. */
function timestampMs(value: string): number {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim())
  if (!m) return NaN
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, '0'))
}

const TIMING_RE = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/

function cleanCueText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseVtt(text: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const timingIdx = lines.findIndex(l => TIMING_RE.test(l))
    if (timingIdx < 0) continue
    const [, a, b] = TIMING_RE.exec(lines[timingIdx])!
    const raw = lines.slice(timingIdx + 1).join(' ')
    const voice = /<v(?:\.[^ >]*)?\s+([^>]+)>/.exec(raw)?.[1]?.trim() ?? null
    const body = cleanCueText(raw)
    const start = timestampMs(a)
    const end = timestampMs(b)
    if (!body || Number.isNaN(start) || Number.isNaN(end)) continue
    out.push({ start_ms: start, end_ms: end, text: body, speaker: voice })
  }
  return out
}

const SRT_SPEAKER_RE = /^((?:SPEAKER_\d+)|(?:Speaker \d+)|(?:[A-Z][\w.'-]*(?: [A-Z][\w.'-]*){0,3})):\s+/

/**
 * SRT. A "Name: " prefix sets the speaker for this and the following cues until the next prefix.
 * Generic labels (SPEAKER_02, Speaker 1) always count; a name counts only when it opens two or more
 * cues, so a line such as "Note: ..." is not taken for a speaker.
 */
export function parseSrt(text: string): TranscriptSegment[] {
  const blocks: { start: number; end: number; body: string }[] = []
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const timingIdx = lines.findIndex(l => TIMING_RE.test(l))
    if (timingIdx < 0) continue
    const [, a, b] = TIMING_RE.exec(lines[timingIdx])!
    blocks.push({ start: timestampMs(a), end: timestampMs(b), body: cleanCueText(lines.slice(timingIdx + 1).join(' ')) })
  }
  const counts = new Map<string, number>()
  for (const b of blocks) {
    const label = SRT_SPEAKER_RE.exec(b.body)?.[1]
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const isSpeaker = (label: string) => /^(?:SPEAKER_\d+|Speaker \d+)$/.test(label) || (counts.get(label) ?? 0) >= 2
  const out: TranscriptSegment[] = []
  let speaker: string | null = null
  for (const b of blocks) {
    let body = b.body
    const m = SRT_SPEAKER_RE.exec(body)
    if (m && isSpeaker(m[1])) {
      speaker = m[1]
      body = body.slice(m[0].length)
    }
    if (!body || Number.isNaN(b.start) || Number.isNaN(b.end)) continue
    out.push({ start_ms: b.start, end_ms: b.end, text: body, speaker })
  }
  return out
}

/** Podcasting 2.0 JSON transcript: segments with startTime/endTime in seconds, word or sentence level. */
export function parsePodcastJson(text: string): TranscriptSegment[] {
  const data = JSON.parse(text) as { segments?: { speaker?: string; startTime?: number; endTime?: number; body?: string }[] }
  return (data.segments ?? [])
    .filter(s => typeof s.startTime === 'number' && typeof s.body === 'string' && s.body.trim())
    .map(s => ({
      start_ms: Math.round(s.startTime! * 1000),
      end_ms: Math.round((typeof s.endTime === 'number' ? s.endTime : s.startTime!) * 1000),
      text: s.body!.trim(),
      speaker: s.speaker?.trim() || null
    }))
}

const PLAIN_NAMED_RE = /^(.{1,40}?)\s*\((\d{1,2}:\d{2}(?::\d{2})?)\):\s*(.+)$/
const PLAIN_STAMPED_RE = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+(.+)$/

function clockMs(value: string): number {
  return value.split(':').reduce((acc, n) => acc * 60 + Number(n), 0) * 1000
}

/** Plain text with a time on each turn ("Name (12:34): text" or "[12:34] text"). Untimed text is useless here: []. */
export function parsePlainTimed(text: string): TranscriptSegment[] {
  const rows: TranscriptSegment[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const named = PLAIN_NAMED_RE.exec(line.trim())
    const stamped = named ? null : PLAIN_STAMPED_RE.exec(line.trim())
    if (named) rows.push({ start_ms: clockMs(named[2]), end_ms: 0, text: named[3].trim(), speaker: named[1].trim() })
    else if (stamped) rows.push({ start_ms: clockMs(stamped[1]), end_ms: 0, text: stamped[2].trim(), speaker: null })
  }
  rows.forEach((r, i) => (r.end_ms = rows[i + 1]?.start_ms ?? r.start_ms + 5_000))
  return rows
}

export function parsePublisherTranscript(format: 'vtt' | 'srt' | 'json' | 'text', text: string): TranscriptSegment[] {
  if (format === 'vtt') return parseVtt(text)
  if (format === 'srt') return parseSrt(text)
  if (format === 'json') return parsePodcastJson(text)
  return parsePlainTimed(text)
}

// ---------- AssemblyAI ----------

export interface AssemblyWord {
  text: string
  start: number
  end: number
  speaker?: string | null
}

/** AssemblyAI words (ms, with speaker letters when speaker_labels was on) → segments. */
export function assemblyWordsToSegments(words: AssemblyWord[]): TranscriptSegment[] {
  return words.filter(w => w.text?.trim()).map(w => ({ start_ms: w.start, end_ms: w.end, text: w.text.trim(), speaker: w.speaker ?? null }))
}

// ---------- cues ----------

function joinText(a: string, b: string): string {
  if (!a) return b
  if (CJK_RE.test(a.slice(-1)) || CJK_RE.test(b[0] ?? '')) return a + b
  return `${a} ${b}`
}

/**
 * Speaker labels from a provider ("SPEAKER_02", "A", "Speaker 1") become A, B, C... in order of
 * appearance; real names from a publisher transcript stay as they are.
 */
export function normalizeSpeakers(segments: TranscriptSegment[]): TranscriptSegment[] {
  const generic = /^(?:SPEAKER_?\d+|Speaker \d+|[A-Z])$/i
  const map = new Map<string, string>()
  return segments.map(s => {
    if (!s.speaker) return s
    if (!generic.test(s.speaker)) return s
    if (!map.has(s.speaker)) map.set(s.speaker, String.fromCharCode(65 + (map.size % 26)))
    return { ...s, speaker: map.get(s.speaker)! }
  })
}

/** Group segments (words or short subtitle lines) into cues of a sentence or two. */
export function groupSegments(segments: TranscriptSegment[]): Omit<PodcastCue, 'id'>[] {
  const cues: Omit<PodcastCue, 'id'>[] = []
  let cur: { start: number; end: number; text: string; speaker: string | null } | null = null
  const flush = () => {
    if (cur && cur.text.trim()) {
      const cue: Omit<PodcastCue, 'id'> = { start_ms: cur.start, duration_ms: Math.max(0, cur.end - cur.start), text: cur.text.trim() }
      if (cur.speaker) cue.speaker = cur.speaker
      cues.push(cue)
    }
    cur = null
  }
  for (const seg of [...segments].sort((a, b) => a.start_ms - b.start_ms)) {
    if (cur && (seg.speaker ?? null) !== cur.speaker) flush()
    if (!cur) cur = { start: seg.start_ms, end: seg.end_ms, text: seg.text, speaker: seg.speaker ?? null }
    else {
      cur.text = joinText(cur.text, seg.text)
      cur.end = Math.max(cur.end, seg.end_ms)
    }
    const length = cur.end - cur.start
    if (length >= CUE_MAX_MS || (length >= CUE_MIN_SENTENCE_MS && SENTENCE_END_RE.test(cur.text))) flush()
  }
  flush()
  return cues
}

export function buildTranscriptDocument(
  source: PodcastTranscriptDocument['source'],
  language: PodcastLanguage,
  segments: TranscriptSegment[],
  durationMs?: number
): PodcastTranscriptDocument {
  const normalized = normalizeSpeakers(segments)
  const cues = groupSegments(normalized).map((c, i) => ({ id: `c${String(i + 1).padStart(4, '0')}`, ...c }))
  const last = cues[cues.length - 1]
  return {
    schema_version: PODCAST_TRANSCRIPT_SCHEMA_VERSION,
    source,
    language,
    speakers: cues.some(c => c.speaker),
    duration_ms: durationMs ?? (last ? last.start_ms + last.duration_ms : 0),
    cues
  }
}

/** Identity of a transcript version: a new transcript of the same episode gets a new hash. */
export async function transcriptHash(doc: PodcastTranscriptDocument): Promise<string> {
  return hashSHA256(
    JSON.stringify({ v: doc.schema_version, source: doc.source, language: doc.language, cues: doc.cues.map(c => [c.start_ms, c.duration_ms, c.speaker ?? null, c.text]) })
  )
}

export function transcriptPlainText(doc: PodcastTranscriptDocument): string {
  return doc.cues
    .map(c => c.text)
    .join(doc.language === 'zh' ? '' : ' ')
    .trim()
}

/** zh when most letters are CJK, en when Latin letters dominate, null otherwise (or too little text). */
export function detectTranscriptLanguage(text: string): PodcastLanguage | null {
  const cjk = text.match(/[一-鿿]/g)?.length ?? 0
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0
  const kanaHangul = text.match(/[぀-ヿ가-힯]/g)?.length ?? 0
  if (cjk + latin < 50) return null
  // Japanese and Korean share Han characters with Chinese; their own scripts rule them out.
  if (kanaHangul > (cjk + latin) * 0.05) return null
  if (cjk / (cjk + latin) > 0.5) return 'zh'
  if (latin / (cjk + latin) > 0.9) return 'en'
  return null
}

/**
 * Spoken words per minute: Chinese characters, or English words. Below the floor (60 characters or
 * 40 words a minute) the episode is mostly music or silence and is skipped as no_speech.
 */
export function speechDensity(doc: PodcastTranscriptDocument): { perMinute: number; enough: boolean } {
  const minutes = Math.max(doc.duration_ms / 60_000, 1)
  const text = transcriptPlainText(doc)
  const units = doc.language === 'zh' ? (text.match(/[一-鿿]/g)?.length ?? 0) : text.split(/\s+/).filter(Boolean).length
  const perMinute = units / minutes
  return { perMinute: Math.round(perMinute), enough: perMinute >= (doc.language === 'zh' ? 60 : 40) }
}

/**
 * Moderation reads at most 4,000 characters per request. A long transcript is checked in up to
 * `count` slices spread evenly over it; a short one is checked whole.
 */
export function moderationSlices(text: string, count: number = 6, size: number = 4_000): string[] {
  if (text.length <= size) return text.trim() ? [text] : []
  const slices = Math.min(count, Math.ceil(text.length / size))
  const step = (text.length - size) / Math.max(1, slices - 1)
  return Array.from({ length: slices }, (_, i) => text.slice(Math.round(i * step), Math.round(i * step) + size))
}
