/**
 * Zero-cost eligibility rules for the YouTube AI article. Shadow mode in P0: the result is
 * recorded, nothing is generated. The core question is whether the transcript can stand on
 * its own as readable text, so "has captions" and "is long" must never be enough on their own.
 * 来源: src/utils/youtubeEligibility.ts
 */
import { describe, expect, test } from 'vitest'
import { YOUTUBE_ELIGIBILITY_RULES_VERSION, evaluateYoutubeEligibility, type YoutubeEligibilityInput } from '@/utils/youtubeEligibility'
import type { YoutubeCaptionCue } from '@/utils/youtubeCaption'

const LECTURE_LINES = [
  'the transformer architecture replaces recurrence with attention so every token can attend to every other token in one step',
  'this matters because training parallelizes across the sequence and long range dependencies no longer decay through a hidden state',
  'the cost is quadratic in sequence length which is why later work spends so much effort on sparse and linear attention variants',
  'positional encodings restore order information since attention by itself is permutation invariant',
  'in practice you stack six to ninety six of these blocks and the residual connections keep the gradients healthy'
]

const TRAVEL_LINES = [
  'okay so look at this view over here it is absolutely stunning',
  'as you can see the water is so clear right here',
  'check this out you can see the whole bay from this spot',
  'let me show you the little market down there',
  'look at that one wow this one is my favorite'
]

const CJK_LECTURE_LINES = [
  '今天我们讲一下大语言模型的训练成本是怎么构成的，主要分为算力、数据和人力三部分',
  '算力这一块最大的开销是显卡，一张显卡的采购价格加上电费和机房折旧，一年下来大概是这个数',
  '数据的成本经常被低估，清洗、去重和标注的人力投入其实不比算力便宜多少',
  '所以当我们比较两个模型的时候，不能只看参数量，还要看它背后的数据质量'
]

/** Real transcripts rarely repeat a line verbatim, so each cue gets a running number unless `vary: false`. */
function cuesFrom(lines: string[], opts: { count: number; intervalMs?: number; durationMs?: number; vary?: boolean }): YoutubeCaptionCue[] {
  const interval = opts.intervalMs ?? 6000
  const vary = opts.vary ?? true
  return Array.from({ length: opts.count }, (_, i) => ({
    id: `c${i}`,
    start_ms: i * interval,
    duration_ms: opts.durationMs ?? interval - 200,
    text: vary ? `${lines[i % lines.length]} ${i}` : lines[i % lines.length]
  }))
}

function input(cues: YoutubeCaptionCue[], overrides: Partial<YoutubeEligibilityInput> = {}): YoutubeEligibilityInput {
  return {
    title: 'How transformers work',
    language: 'en',
    kind: 'manual',
    cues,
    plainText: cues.map(c => c.text).join(' '),
    ...overrides
  }
}

describe('evaluateYoutubeEligibility', () => {
  test('no captions → skip with no_caption and zero scores', () => {
    const r = evaluateYoutubeEligibility(input([]))
    expect(r.rules_version).toBe(YOUTUBE_ELIGIBILITY_RULES_VERSION)
    expect(r.decision).toBe('skip')
    expect(r.reason_codes).toContain('no_caption')
    expect(r.standalone_readability).toBe(0)
    expect(r.visual_dependency).toBe(0)
  })

  test('a dense twenty minute lecture with manual captions → generate', () => {
    const r = evaluateYoutubeEligibility(input(cuesFrom(LECTURE_LINES, { count: 200 })))
    expect(r.decision).toBe('generate')
    expect(r.standalone_readability).toBeGreaterThanOrEqual(0.6)
    expect(r.visual_dependency).toBeLessThan(0.35)
    expect(r.features.duration_sec).toBeGreaterThan(1000)
    expect(r.reason_codes).toEqual([])
  })

  test('a dense CJK lecture is judged with CJK density norms → generate', () => {
    const r = evaluateYoutubeEligibility(input(cuesFrom(CJK_LECTURE_LINES, { count: 150, intervalMs: 8000 }), { title: '大模型训练成本拆解', language: 'zh' }))
    expect(r.decision).toBe('generate')
  })

  test('a language outside the auto list is never auto generated: review with language_not_auto', () => {
    const r = evaluateYoutubeEligibility(input(cuesFrom(LECTURE_LINES, { count: 200 }), { language: 'ja' }))
    expect(r.decision).toBe('review')
    expect(r.reason_codes).toEqual(['language_not_auto'])
    expect(evaluateYoutubeEligibility(input(cuesFrom(LECTURE_LINES, { count: 200 }), { language: 'zh-Hans' })).decision).toBe('generate')
    expect(evaluateYoutubeEligibility(input(cuesFrom(LECTURE_LINES, { count: 200 }), { language: 'en-US' })).decision).toBe('generate')
  })

  test('the same lecture as ASR still generates, with a lower transcript quality', () => {
    const manual = evaluateYoutubeEligibility(input(cuesFrom(LECTURE_LINES, { count: 200 })))
    const asr = evaluateYoutubeEligibility(input(cuesFrom(LECTURE_LINES, { count: 200 }), { kind: 'asr' }))
    expect(asr.decision).toBe('generate')
    expect(asr.transcript_quality).toBeLessThan(manual.transcript_quality)
  })

  test('long captions are not enough: a travel vlog full of "look at this" → skip as visual', () => {
    const r = evaluateYoutubeEligibility(input(cuesFrom(TRAVEL_LINES, { count: 200 }), { title: 'Santorini 4K walking tour vlog' }))
    expect(r.decision).toBe('skip')
    expect(r.reason_codes).toContain('visual_dependent')
    expect(r.visual_dependency).toBeGreaterThanOrEqual(0.6)
    expect(r.features.total_chars).toBeGreaterThan(5000)
  })

  test('a title hint alone puts a normal transcript into review, not skip', () => {
    const r = evaluateYoutubeEligibility(input(cuesFrom(LECTURE_LINES, { count: 200 }), { title: 'My week in Tokyo vlog' }))
    expect(r.decision).toBe('review')
    expect(r.features.title_hints).toEqual(['vlog'])
  })

  test('music and applause cues → skip as mostly_noise', () => {
    const noise = cuesFrom(['[Music]', '[Applause]', '♪ la la la ♪', 'thank you'], { count: 120, vary: false })
    const r = evaluateYoutubeEligibility(input(noise, { title: 'Live at the arena' }))
    expect(r.decision).toBe('skip')
    expect(r.reason_codes).toContain('mostly_noise')
  })

  test('too little text → skip as caption_too_short', () => {
    const r = evaluateYoutubeEligibility(input(cuesFrom(['hi there'], { count: 10, intervalMs: 20000 })))
    expect(r.decision).toBe('skip')
    expect(r.reason_codes).toContain('caption_too_short')
  })

  test('a very short video → skip as video_too_short', () => {
    const r = evaluateYoutubeEligibility(input(cuesFrom(LECTURE_LINES, { count: 12, intervalMs: 4000 })))
    expect(r.decision).toBe('skip')
    expect(r.reason_codes).toContain('video_too_short')
  })

  test('sparse speech over a long runtime → skip as low_speech_density', () => {
    const r = evaluateYoutubeEligibility(input(cuesFrom(['and here we go'], { count: 60, intervalMs: 60000 })))
    expect(r.decision).toBe('skip')
    expect(r.reason_codes).toContain('low_speech_density')
  })

  test('word-level fragments and repeated cues lower transcript quality', () => {
    const fragments = cuesFrom(['so', 'yeah', 'okay', 'right', 'um'], { count: 800, intervalMs: 1500, vary: false })
    const r = evaluateYoutubeEligibility(input(fragments))
    expect(r.transcript_quality).toBeLessThan(0.5)
    expect(r.decision).not.toBe('generate')
    expect(r.reason_codes).toEqual(expect.arrayContaining(['fragmented_captions', 'repetitive_captions']))
  })

  test('a very long video is never auto generated: review with very_long_video', () => {
    const r = evaluateYoutubeEligibility(input(cuesFrom(LECTURE_LINES, { count: 2500 })))
    expect(r.decision).toBe('review')
    expect(r.reason_codes).toContain('very_long_video')
  })

  test('features are recorded for every decision', () => {
    const r = evaluateYoutubeEligibility(input(cuesFrom(LECTURE_LINES, { count: 200 })))
    expect(r.features).toEqual(
      expect.objectContaining({
        cue_count: 200,
        total_chars: expect.any(Number),
        duration_sec: expect.any(Number),
        chars_per_min: expect.any(Number),
        fragment_ratio: expect.any(Number),
        repeat_ratio: expect.any(Number),
        noise_ratio: expect.any(Number),
        deixis_ratio: expect.any(Number),
        title_hints: []
      })
    )
  })
})
