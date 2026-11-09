import type { YoutubeCaptionCue, YoutubeCaptionKind } from '@/utils/youtubeCaption'

export const YOUTUBE_ELIGIBILITY_RULES_VERSION = 1 as const
export type YoutubeEligibilityDecision = 'generate' | 'skip' | 'review'

export interface YoutubeEligibilityInput {
  title: string
  language: string
  kind: YoutubeCaptionKind
  cues: YoutubeCaptionCue[]
  plainText: string
}

export interface YoutubeEligibilityResult {
  rules_version: typeof YOUTUBE_ELIGIBILITY_RULES_VERSION
  decision: YoutubeEligibilityDecision
  reason_codes: string[]
  features: { cue_count: number; total_chars: number; duration_sec: number }
}

/** Content presence is the only admission check; these counts are diagnostic. */
export function evaluateYoutubeEligibility(input: YoutubeEligibilityInput): YoutubeEligibilityResult {
  const present = input.cues.some(cue => cue.text.trim()) && !!input.plainText.trim()
  const last = input.cues.at(-1)
  return {
    rules_version: YOUTUBE_ELIGIBILITY_RULES_VERSION,
    decision: present ? 'generate' : 'skip',
    reason_codes: present ? [] : ['no_caption'],
    features: {
      cue_count: input.cues.length,
      total_chars: input.plainText.replace(/\s/g, '').length,
      duration_sec: last ? Math.max(0, (last.start_ms + (last.duration_ms ?? 0)) / 1000) : 0
    }
  }
}
