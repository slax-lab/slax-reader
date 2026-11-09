import { describe, expect, test } from 'vitest'
import { evaluateYoutubeEligibility } from '@/utils/youtubeEligibility'

describe('caption presence admission', () => {
  test.each([
    ['Short', 'en', 'Hi', 1000],
    ['4K walking tour vlog', 'ja', 'look at this', 7200000],
    ['Live music', 'zh', '[Music] ♪', 90000],
    ['Interview', 'fr', 'oui oui oui', 40000]
  ])('accepts nonempty captions: %s', (title, language, text, duration_ms) => {
    const result = evaluateYoutubeEligibility({ title, language, kind: 'asr', cues: [{ id: 'c0', start_ms: 0, duration_ms, text }], plainText: text })
    expect(result.decision).toBe('generate')
    expect(result.reason_codes).toEqual([])
    expect(result.features).toMatchObject({ cue_count: 1, total_chars: text.replace(/\s/g, '').length })
  })
  test.each(['', '  '])('rejects empty captions (%s)', text => {
    expect(
      evaluateYoutubeEligibility({ title: 'T', language: 'en', kind: 'manual', cues: [{ id: 'c0', start_ms: 0, duration_ms: 1000, text }], plainText: text }).reason_codes
    ).toEqual(['no_caption'])
  })
})
