/**
 * YouTube caption normalization: immutable caption document, compat cues for the
 * existing HTML, rolling-caption dedupe for the plain text, and the source hash.
 * 来源: src/utils/youtubeCaption.ts
 */
import { describe, expect, test } from 'vitest'
import {
  YOUTUBE_CAPTION_SCHEMA_VERSION,
  buildYoutubeCaptionDocument,
  captionPlainText,
  captionSourceHash,
  dedupeRollingCues,
  toCompatCues,
  youtubeCaptionKeys,
  type YoutubeCaptionCue
} from '@/utils/youtubeCaption'
import type { TikHubYoutubeCaptionTrack, TikHubYoutubeJson3Event } from '@/const/moreapi/youtube'

const manualEn: TikHubYoutubeCaptionTrack = { language_code: 'en', language_name: 'English', kind: '', is_translatable: true, base_url: '' }
const asrEn: TikHubYoutubeCaptionTrack = { language_code: 'a.en', language_name: 'English (auto-generated)', kind: 'asr', is_translatable: true, base_url: '' }

const events: TikHubYoutubeJson3Event[] = [
  { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
  { tStartMs: 1500, dDurationMs: 800, segs: [{ utf8: '\n' }] },
  { tStartMs: 1600, dDurationMs: 900, segs: [{ utf8: 'second\nline' }] },
  { tStartMs: 2400, segs: [{ utf8: 'third' }] },
  { tStartMs: 3000 }
]

describe('buildYoutubeCaptionDocument', () => {
  test('keeps milliseconds, duration, track metadata and stable cue ids', () => {
    const doc = buildYoutubeCaptionDocument('vid123', manualEn, events)
    expect(doc.schema_version).toBe(YOUTUBE_CAPTION_SCHEMA_VERSION)
    expect(doc.video_id).toBe('vid123')
    expect(doc.language).toBe('en')
    expect(doc.language_name).toBe('English')
    expect(doc.kind).toBe('manual')
    expect(doc.source_track).toBe('en')
    expect(doc.cues).toEqual([
      { id: 'c0000', start_ms: 0, duration_ms: 1500, text: 'Hello world' },
      { id: 'c0001', start_ms: 1600, duration_ms: 900, text: 'second line' },
      { id: 'c0002', start_ms: 2400, text: 'third' }
    ])
  })

  test('marks auto captions as asr and strips the a. prefix from the language', () => {
    const doc = buildYoutubeCaptionDocument('vid123', asrEn, events)
    expect(doc.kind).toBe('asr')
    expect(doc.language).toBe('en')
    expect(doc.source_track).toBe('a.en')
  })

  test('language keeps the region tag but lowercases it', () => {
    const track = { ...manualEn, language_code: 'pt-BR' }
    expect(buildYoutubeCaptionDocument('v', track, events).language).toBe('pt-br')
  })
})

describe('toCompatCues', () => {
  test('matches the legacy shape: whole seconds, same-second cues merged with a space', () => {
    const doc = buildYoutubeCaptionDocument('v', manualEn, events)
    expect(toCompatCues(doc.cues)).toEqual([
      { t: 0, text: 'Hello world' },
      { t: 1, text: 'second line' },
      { t: 2, text: 'third' }
    ])
  })

  test('merges cues that start inside the same second', () => {
    const cues: YoutubeCaptionCue[] = [
      { id: 'c0000', start_ms: 10200, text: 'a' },
      { id: 'c0001', start_ms: 10900, text: 'b' },
      { id: 'c0002', start_ms: 11000, text: 'c' }
    ]
    expect(toCompatCues(cues)).toEqual([
      { t: 10, text: 'a b' },
      { t: 11, text: 'c' }
    ])
  })
})

describe('dedupeRollingCues', () => {
  const cue = (i: number, text: string): YoutubeCaptionCue => ({ id: `c${i}`, start_ms: i * 1000, text })

  test('removes the overlapping word run that rolling auto captions repeat', () => {
    const out = dedupeRollingCues([cue(0, 'we are going to talk about'), cue(1, 'talk about the new model today'), cue(2, 'model today and tomorrow')])
    expect(out.map(c => c.text)).toEqual(['we are going to talk about', 'the new model today', 'and tomorrow'])
  })

  test('drops a cue that is entirely a repeat of the previous tail', () => {
    const out = dedupeRollingCues([cue(0, 'one two three four'), cue(1, 'three four'), cue(2, 'five')])
    expect(out.map(c => c.id)).toEqual(['c0', 'c2'])
  })

  test('a single repeated word is not treated as overlap', () => {
    const out = dedupeRollingCues([cue(0, 'and then the'), cue(1, 'the end')])
    expect(out.map(c => c.text)).toEqual(['and then the', 'the end'])
  })

  test('ignores case and trailing punctuation when matching', () => {
    const out = dedupeRollingCues([cue(0, 'Hello World.'), cue(1, 'hello world again')])
    expect(out.map(c => c.text)).toEqual(['Hello World.', 'again'])
  })

  test('CJK text without spaces is matched character by character', () => {
    const out = dedupeRollingCues([cue(0, '今天我们来聊一聊大模型'), cue(1, '聊一聊大模型的训练成本')])
    expect(out.map(c => c.text)).toEqual(['今天我们来聊一聊大模型', '的训练成本'])
  })

  test('keeps raw cues untouched', () => {
    const raw = [cue(0, 'a b c'), cue(1, 'b c d')]
    dedupeRollingCues(raw)
    expect(raw[1].text).toBe('b c d')
  })
})

describe('captionPlainText', () => {
  test('joins deduped cues with single spaces', () => {
    const doc = buildYoutubeCaptionDocument('v', asrEn, [
      { tStartMs: 0, segs: [{ utf8: 'the quick brown' }] },
      { tStartMs: 900, segs: [{ utf8: 'quick brown fox' }] },
      { tStartMs: 1800, segs: [{ utf8: '  jumps  ' }] }
    ])
    expect(captionPlainText(doc)).toBe('the quick brown fox jumps')
  })
})

describe('captionSourceHash', () => {
  test('is stable for equal input and 64 hex chars', async () => {
    const a = await captionSourceHash(buildYoutubeCaptionDocument('v', manualEn, events))
    const b = await captionSourceHash(buildYoutubeCaptionDocument('v', manualEn, events))
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  test('changes when the text, the timing or the track changes', async () => {
    const base = await captionSourceHash(buildYoutubeCaptionDocument('v', manualEn, events))
    const text = await captionSourceHash(buildYoutubeCaptionDocument('v', manualEn, [{ ...events[0], segs: [{ utf8: 'Hello there' }] }, ...events.slice(1)]))
    const timing = await captionSourceHash(buildYoutubeCaptionDocument('v', manualEn, [{ ...events[0], tStartMs: 5 }, ...events.slice(1)]))
    const track = await captionSourceHash(buildYoutubeCaptionDocument('v', asrEn, events))
    expect(new Set([base, text, timing, track]).size).toBe(4)
  })

  test('a video without captions still gets a deterministic hash', async () => {
    const a = await captionSourceHash(null, 'vid123')
    const b = await captionSourceHash(null, 'vid123')
    const other = await captionSourceHash(null, 'vid999')
    expect(a).toBe(b)
    expect(a).not.toBe(other)
  })
})

describe('youtubeCaptionKeys', () => {
  test('canonical per video and hash, shared by every bookmark of the video', () => {
    expect(youtubeCaptionKeys('dQw4w9WgXcQ', 'abc')).toEqual({
      captionKey: 'youtube/canonical/captions/dQw4w9WgXcQ/abc.json',
      captionTextKey: 'youtube/canonical/captions/dQw4w9WgXcQ/abc.txt'
    })
  })
})
