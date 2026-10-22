/**
 * Podcast transcripts: publisher files saved from a real Buzzsprout episode on 2026-10-14
 * (test/fixtures/podcast/buzzsprout.*), AssemblyAI word output, cue grouping and speech checks.
 * 来源: src/utils/podcastTranscript.ts, docs/podcast-article/spec.md 第 3.3 节
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  assemblyWordsToSegments,
  buildTranscriptDocument,
  chooseTranscriptRef,
  CUE_MAX_MS,
  detectTranscriptLanguage,
  groupSegments,
  moderationSlices,
  normalizeSpeakers,
  parsePlainTimed,
  parsePodcastJson,
  parsePublisherTranscript,
  parseSrt,
  parseVtt,
  speechDensity,
  transcriptHash,
  transcriptPlainText,
  type TranscriptSegment
} from '@/utils/podcastTranscript'

const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures/podcast', name), 'utf8')

describe('chooseTranscriptRef', () => {
  const ref = (url: string, type: string) => ({ url, type, language: null })
  test('prefers VTT, then SRT, then JSON, then plain text; skips HTML', () => {
    const refs = [
      ref('https://x/t.html', 'text/html'),
      ref('https://x/t.json', 'application/json'),
      ref('https://x/t.srt', 'application/x-subrip'),
      ref('https://x/t.vtt', 'text/vtt')
    ]
    expect(chooseTranscriptRef(refs)).toEqual({ ref: refs[3], format: 'vtt' })
    expect(chooseTranscriptRef(refs.slice(0, 3))?.format).toBe('srt')
    expect(chooseTranscriptRef(refs.slice(0, 2))?.format).toBe('json')
    expect(chooseTranscriptRef([ref('https://x/t.txt?a=1', 'text/plain')])?.format).toBe('text')
    expect(chooseTranscriptRef([refs[0]])).toBeNull()
    expect(chooseTranscriptRef([])).toBeNull()
  })

  test('falls back to the file extension when the type is generic', () => {
    expect(chooseTranscriptRef([ref('https://x/a.vtt', 'application/octet-stream')])?.format).toBe('vtt')
  })
})

describe('publisher parsers on the real Buzzsprout files', () => {
  test('VTT: timing, voice tags, text without markup', () => {
    const segs = parseVtt(fixture('buzzsprout.vtt'))
    expect(segs.length).toBeGreaterThan(20)
    expect(segs[0]).toEqual({
      start_ms: 160,
      end_ms: 7440,
      text: 'We were able to track that 60% of the requests to install data centers in Brazil come from renewable energy companies.',
      speaker: 'SPEAKER_02'
    })
    expect(segs.some(s => s.speaker === 'SPEAKER_00')).toBe(true)
    expect(segs.every(s => !s.text.includes('<'))).toBe(true)
    expect(segs[segs.length - 1].end_ms).toBe(180159)
  })

  test('SRT: the speaker prefix carries over to the following cues', () => {
    const segs = parseSrt(fixture('buzzsprout.srt'))
    expect(segs[0]).toMatchObject({ start_ms: 160, end_ms: 3680, text: 'We were able to track that 60% of the requests', speaker: 'SPEAKER_02' })
    expect(segs[1]).toMatchObject({ text: 'to install data centers in Brazil come from renewable', speaker: 'SPEAKER_02' })
    expect(segs.some(s => s.speaker === 'SPEAKER_00')).toBe(true)
    expect(segs.every(s => !/^SPEAKER_\d+:/.test(s.text))).toBe(true)
  })

  test('SRT: a one-off "Note:" line is text, a repeated name is a speaker', () => {
    const srt = [
      '1\n00:00:00,000 --> 00:00:02,000\nNote: this is said once.',
      '2\n00:00:02,000 --> 00:00:04,000\nKara Swisher: Hello there.',
      '3\n00:00:04,000 --> 00:00:06,000\nAnd more.',
      '4\n00:00:06,000 --> 00:00:08,000\nKara Swisher: Bye.'
    ].join('\n\n')
    const segs = parseSrt(srt)
    expect(segs.map(s => [s.speaker, s.text])).toEqual([
      [null, 'Note: this is said once.'],
      ['Kara Swisher', 'Hello there.'],
      ['Kara Swisher', 'And more.'],
      ['Kara Swisher', 'Bye.']
    ])
  })

  test('Podcasting 2.0 JSON: word-level segments in seconds', () => {
    const segs = parsePodcastJson(fixture('buzzsprout.json'))
    expect(segs).toHaveLength(105)
    expect(segs[0]).toEqual({ start_ms: 160, end_ms: 400, text: 'We', speaker: 'SPEAKER_02' })
  })

  test('plain text with a time per turn; untimed text gives nothing', () => {
    const segs = parsePlainTimed('Host (00:00): Welcome.\nGuest (1:05): Thanks for having me.\n\n[02:10] Next part.')
    expect(segs).toEqual([
      { start_ms: 0, end_ms: 65_000, text: 'Welcome.', speaker: 'Host' },
      { start_ms: 65_000, end_ms: 130_000, text: 'Thanks for having me.', speaker: 'Guest' },
      { start_ms: 130_000, end_ms: 135_000, text: 'Next part.', speaker: null }
    ])
    expect(parsePlainTimed('Just a paragraph of text.\nAnother one.')).toEqual([])
  })

  test('parsePublisherTranscript dispatches by format', () => {
    expect(parsePublisherTranscript('vtt', fixture('buzzsprout.vtt'))).toEqual(parseVtt(fixture('buzzsprout.vtt')))
    expect(() => parsePublisherTranscript('json', 'not json')).toThrow()
  })
})

describe('cues', () => {
  test('the three Buzzsprout formats give the same speakers and close cue starts', () => {
    const vtt = buildTranscriptDocument('publisher', 'en', parseVtt(fixture('buzzsprout.vtt')))
    const srt = buildTranscriptDocument('publisher', 'en', parseSrt(fixture('buzzsprout.srt')))
    const json = buildTranscriptDocument('publisher', 'en', parsePodcastJson(fixture('buzzsprout.json')))
    for (const doc of [vtt, srt, json]) {
      expect(doc.speakers).toBe(true)
      expect(doc.cues[0]).toMatchObject({ id: 'c0001', start_ms: 160, speaker: 'A' })
      expect(doc.cues.every(c => c.duration_ms <= CUE_MAX_MS + 8_000)).toBe(true)
    }
    // The first speaker turn ends at 23.76 s; the second speaker (B) starts at 48.72 s in all three.
    expect(vtt.cues.find(c => c.speaker === 'B')?.start_ms).toBe(48719)
    expect(json.cues.find(c => c.speaker === 'B')?.start_ms).toBe(48720)
    // Word-level JSON becomes sentences, not single words.
    expect(json.cues.length).toBeLessThan(10)
    expect(json.cues[0].text).toMatch(/^We were able to track that 60% of the requests/)
  })

  test('cut at a sentence end once 8 s are reached, at 30 s, and at a speaker change', () => {
    const seg = (start: number, end: number, text: string, speaker: string | null = null): TranscriptSegment => ({ start_ms: start, end_ms: end, text, speaker })
    const cues = groupSegments([
      seg(0, 3_000, 'Short.'),
      seg(3_000, 9_000, 'Now long enough.'),
      seg(9_000, 20_000, 'no end'),
      seg(20_000, 31_000, 'still no end'),
      seg(31_000, 33_000, 'Other voice.', 'B')
    ])
    expect(cues.map(c => c.text)).toEqual(['Short. Now long enough.', 'no end still no end', 'Other voice.'])
    expect(cues[1]).toMatchObject({ start_ms: 9_000, duration_ms: 22_000 })
    expect(cues[2].speaker).toBe('B')
  })

  test('Chinese words join without spaces', () => {
    const cues = groupSegments(
      assemblyWordsToSegments([
        { text: '今天', start: 0, end: 400 },
        { text: '我们', start: 400, end: 800 },
        { text: '聊 AI', start: 800, end: 1500 },
        { text: 'agent。', start: 1500, end: 9000 }
      ])
    )
    expect(cues).toEqual([{ start_ms: 0, duration_ms: 9000, text: '今天我们聊 AI agent。' }])
  })

  test('generic speaker labels become A, B, C; real names stay', () => {
    const out = normalizeSpeakers([
      { start_ms: 0, end_ms: 1, text: 'a', speaker: 'SPEAKER_02' },
      { start_ms: 1, end_ms: 2, text: 'b', speaker: 'SPEAKER_00' },
      { start_ms: 2, end_ms: 3, text: 'c', speaker: 'SPEAKER_02' },
      { start_ms: 3, end_ms: 4, text: 'd', speaker: 'Kara Swisher' },
      { start_ms: 4, end_ms: 5, text: 'e', speaker: null }
    ])
    expect(out.map(s => s.speaker)).toEqual(['A', 'B', 'A', 'Kara Swisher', null])
  })

  test('no speaker labels → speakers false, no speaker field on cues', () => {
    const doc = buildTranscriptDocument('assemblyai', 'en', [{ start_ms: 0, end_ms: 9_000, text: 'Hello world.', speaker: null }], 600_000)
    expect(doc).toMatchObject({ speakers: false, duration_ms: 600_000, schema_version: 1, source: 'assemblyai' })
    expect(doc.cues[0]).not.toHaveProperty('speaker')
  })
})

describe('hash, text and checks', () => {
  const doc = buildTranscriptDocument('publisher', 'en', parseVtt(fixture('buzzsprout.vtt')))

  test('transcriptHash is stable and changes with the text', async () => {
    const h = await transcriptHash(doc)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(await transcriptHash(structuredClone(doc))).toBe(h)
    const changed = structuredClone(doc)
    changed.cues[0].text += ' x'
    expect(await transcriptHash(changed)).not.toBe(h)
  })

  test('plain text and language detection', () => {
    expect(transcriptPlainText(doc)).toMatch(/^We were able to track/)
    expect(detectTranscriptLanguage(transcriptPlainText(doc))).toBe('en')
    expect(detectTranscriptLanguage('今天我们来聊一聊大模型在企业里的落地情况，以及为什么很多用户觉得模型越来越强却没有感觉。这是第二句话，继续说一些内容。')).toBe('zh')
    expect(detectTranscriptLanguage('Bonjour')).toBeNull()
    expect(detectTranscriptLanguage('これは日本語の文章です。'.repeat(10))).toBeNull()
  })

  test('speech density: normal talk passes, a music episode fails', () => {
    expect(speechDensity(doc).enough).toBe(true)
    const music = buildTranscriptDocument('assemblyai', 'en', [{ start_ms: 0, end_ms: 5_000, text: 'Yeah yeah.', speaker: null }], 30 * 60_000)
    expect(speechDensity(music)).toEqual({ perMinute: 0, enough: false })
    const zh = buildTranscriptDocument('assemblyai', 'zh', [{ start_ms: 0, end_ms: 60_000, text: '说'.repeat(200), speaker: null }], 60_000)
    expect(speechDensity(zh)).toEqual({ perMinute: 200, enough: true })
  })
})

describe('moderationSlices', () => {
  test('short text whole; long text in evenly spread slices covering start and end', () => {
    expect(moderationSlices('abc')).toEqual(['abc'])
    expect(moderationSlices('   ')).toEqual([])
    const long = Array.from({ length: 50_000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
    const slices = moderationSlices(long)
    expect(slices).toHaveLength(6)
    expect(slices.every(s => s.length === 4000)).toBe(true)
    expect(slices[0]).toBe(long.slice(0, 4000))
    expect(slices[5]).toBe(long.slice(-4000))
    expect(moderationSlices('x'.repeat(9000))).toHaveLength(3)
  })
})
