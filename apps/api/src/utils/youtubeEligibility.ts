import type { YoutubeCaptionCue, YoutubeCaptionKind } from '@/utils/youtubeCaption'

/**
 * Zero-cost gate for the YouTube AI article.
 *
 * The question it answers is not "are there captions" but "can this transcript stand on its
 * own as readable text without the picture". Length and video type are only auxiliary
 * features; the recorded scores (standalone_readability, information_density,
 * visual_dependency, transcript_quality) and reason codes are what P1 will act on.
 *
 * P0 runs it in shadow mode: results are stored, nothing is generated.
 */
export const YOUTUBE_ELIGIBILITY_RULES_VERSION = 1 as const

export type YoutubeEligibilityDecision = 'generate' | 'skip' | 'review'

export interface YoutubeEligibilityInput {
  title: string
  language: string
  kind: YoutubeCaptionKind
  /** Raw cues from the caption document. */
  cues: YoutubeCaptionCue[]
  /** Cleaned transcript (rolling duplicates removed). */
  plainText: string
}

export interface YoutubeEligibilityFeatures {
  cue_count: number
  total_chars: number
  duration_sec: number
  chars_per_min: number
  fragment_ratio: number
  repeat_ratio: number
  noise_ratio: number
  deixis_ratio: number
  title_hints: string[]
  cjk: boolean
}

export interface YoutubeEligibilityResult {
  rules_version: typeof YOUTUBE_ELIGIBILITY_RULES_VERSION
  decision: YoutubeEligibilityDecision
  standalone_readability: number
  information_density: number
  visual_dependency: number
  transcript_quality: number
  reason_codes: string[]
  features: YoutubeEligibilityFeatures
}

export const YOUTUBE_ELIGIBILITY_THRESHOLDS = {
  minDurationSec: 90,
  minChars: 800,
  /** Spoken Chinese/Japanese/Korean carries fewer characters per minute than spaced languages. */
  minCharsPerMin: { cjk: 60, other: 200 },
  typicalCharsPerMin: { cjk: 250, other: 750 },
  maxNoiseRatio: 0.3,
  maxFragmentRatio: 0.5,
  maxRepeatRatio: 0.3,
  skipVisualDependency: 0.6,
  generateMaxVisualDependency: 0.35,
  generateMinReadability: 0.6,
  generateMinQuality: 0.5,
  skipMaxReadability: 0.4,
  maxAutoDurationSec: 4 * 3600,
  /** Only languages the team can check the output of are generated automatically; others go to review. */
  autoLanguages: ['en', 'zh']
} as const

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/
const NOISE_WHOLE_RE = /^\s*[[(（【][^\])）】]*[\])）】]\s*$/
const NOISE_TAG_RE = /[[【(（](music|applause|laughter|cheering|singing|音乐|掌声|笑声|歌声)[\])）】]/i
const NOISE_NOTE_RE = /♪|♫/

/** Phrases that point at the picture instead of describing it. */
const DEIXIS_RE =
  /\b(as you can see|you can see|look at (this|that|these|those)|take a look|check this out|right here|over here|over there|this one|that one|let me show you|on the screen|look at the)\b|(大家看|你们看|可以看到|看一下|看这个|看这里|看那边|这个地方|给大家看)/i

/** Title words that usually mean the picture carries the video. */
const TITLE_HINTS: { re: RegExp; code: string }[] = [
  { re: /\bvlog\b|vlog/i, code: 'vlog' },
  { re: /\bunboxing\b|开箱/i, code: 'unboxing' },
  { re: /\bhaul\b/i, code: 'haul' },
  { re: /\basmr\b/i, code: 'asmr' },
  { re: /\b(walking|walk|driving|drive|cycling) tour\b|\bwalking\b|城市漫步|街拍|实拍/i, code: 'walk' },
  { re: /\b4k\b|\b8k\b|\bhdr\b/i, code: '4k' },
  { re: /\b(scenery|timelapse|time-lapse|drone|aerial)\b|风景|航拍|延时/i, code: 'scenery' },
  { re: /\b(official (music )?video|lyrics?|mv|live performance|concert)\b|演唱会|歌词|舞蹈|跳舞/i, code: 'music_video' },
  { re: /\b(gameplay|playthrough|speedrun)\b|试玩|实况/i, code: 'gameplay' },
  { re: /\bpov\b/i, code: 'pov' },
  { re: /\b(tour|travel|trip)\b|旅行|旅游|探店|游记/i, code: 'travel' },
  { re: /\b(day in (the|my) life)\b|沉浸式/i, code: 'day_in_life' }
]

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isFragment(text: string, cjk: boolean): boolean {
  if (cjk && CJK_RE.test(text)) return text.replace(/\s/g, '').length <= 4
  return text.split(/\s+/).filter(Boolean).length <= 2
}

function isNoise(text: string): boolean {
  return NOISE_WHOLE_RE.test(text) || NOISE_TAG_RE.test(text) || NOISE_NOTE_RE.test(text)
}

function titleHints(title: string): string[] {
  const hits: string[] = []
  for (const hint of TITLE_HINTS) {
    if (hint.re.test(title) && !hits.includes(hint.code)) hits.push(hint.code)
  }
  return hits
}

function durationSec(cues: YoutubeCaptionCue[]): number {
  const last = cues[cues.length - 1]
  if (!last) return 0
  return Math.max(1, (last.start_ms + (last.duration_ms ?? 0)) / 1000)
}

export function evaluateYoutubeEligibility(input: YoutubeEligibilityInput): YoutubeEligibilityResult {
  const T = YOUTUBE_ELIGIBILITY_THRESHOLDS
  const cjk = /^(zh|ja|ko)/i.test(input.language) || CJK_RE.test(input.plainText.slice(0, 2000))
  const hints = titleHints(input.title)

  if (!input.cues.length || !input.plainText.trim()) {
    return {
      rules_version: YOUTUBE_ELIGIBILITY_RULES_VERSION,
      decision: 'skip',
      standalone_readability: 0,
      information_density: 0,
      visual_dependency: 0,
      transcript_quality: 0,
      reason_codes: ['no_caption'],
      features: {
        cue_count: input.cues.length,
        total_chars: 0,
        duration_sec: durationSec(input.cues),
        chars_per_min: 0,
        fragment_ratio: 0,
        repeat_ratio: 0,
        noise_ratio: 0,
        deixis_ratio: 0,
        title_hints: hints,
        cjk
      }
    }
  }

  const cueCount = input.cues.length
  const totalChars = input.plainText.replace(/\s/g, '').length
  const duration = durationSec(input.cues)
  const charsPerMin = totalChars / (duration / 60)

  let fragments = 0
  let noise = 0
  let deixis = 0
  const seen = new Map<string, number>()
  for (const cue of input.cues) {
    if (isFragment(cue.text, cjk)) fragments++
    if (isNoise(cue.text)) noise++
    if (DEIXIS_RE.test(cue.text)) deixis++
    const key = normalizeKey(cue.text)
    if (key) seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const repeats = Array.from(seen.values()).reduce((acc, n) => acc + (n - 1), 0)

  const features: YoutubeEligibilityFeatures = {
    cue_count: cueCount,
    total_chars: totalChars,
    duration_sec: round(duration),
    chars_per_min: round(charsPerMin),
    fragment_ratio: round(fragments / cueCount),
    repeat_ratio: round(repeats / cueCount),
    noise_ratio: round(noise / cueCount),
    deixis_ratio: round(deixis / cueCount),
    title_hints: hints,
    cjk
  }

  const norms = cjk ? 'cjk' : 'other'
  const informationDensity = clamp01(charsPerMin / T.typicalCharsPerMin[norms])
  const transcriptQuality = clamp01(1 - features.fragment_ratio * 0.6 - features.repeat_ratio * 0.8 - features.noise_ratio - (input.kind === 'asr' ? 0.1 : 0))
  const visualDependency = clamp01(0.25 * Math.min(hints.length, 3) + Math.min(0.6, features.deixis_ratio * 4))
  const standaloneReadability = clamp01(0.45 * transcriptQuality + 0.35 * informationDensity + 0.2 * (1 - visualDependency))

  const hard: string[] = []
  const soft: string[] = []
  if (duration < T.minDurationSec) hard.push('video_too_short')
  if (totalChars < T.minChars) hard.push('caption_too_short')
  if (charsPerMin < T.minCharsPerMin[norms]) hard.push('low_speech_density')
  if (features.noise_ratio > T.maxNoiseRatio) hard.push('mostly_noise')
  if (visualDependency >= T.skipVisualDependency) hard.push('visual_dependent')
  if (features.fragment_ratio > T.maxFragmentRatio) soft.push('fragmented_captions')
  if (features.repeat_ratio > T.maxRepeatRatio) soft.push('repetitive_captions')
  if (hints.length) soft.push('title_suggests_visual')
  if (duration > T.maxAutoDurationSec) soft.push('very_long_video')
  const languageBase = input.language.toLowerCase().split(/[-_]/)[0]
  if (!(T.autoLanguages as readonly string[]).includes(languageBase)) soft.push('language_not_auto')

  let decision: YoutubeEligibilityDecision
  const reasonCodes = [...hard, ...soft]
  if (hard.length) {
    decision = 'skip'
  } else if (soft.includes('very_long_video') || soft.includes('title_suggests_visual') || soft.includes('language_not_auto')) {
    decision = 'review'
  } else if (standaloneReadability >= T.generateMinReadability && visualDependency <= T.generateMaxVisualDependency && transcriptQuality >= T.generateMinQuality) {
    decision = 'generate'
  } else if (standaloneReadability < T.skipMaxReadability) {
    decision = 'skip'
    reasonCodes.push('low_standalone_value')
  } else {
    decision = 'review'
    reasonCodes.push('uncertain')
  }

  return {
    rules_version: YOUTUBE_ELIGIBILITY_RULES_VERSION,
    decision,
    standalone_readability: round(standaloneReadability),
    information_density: round(informationDensity),
    visual_dependency: round(visualDependency),
    transcript_quality: round(transcriptQuality),
    reason_codes: reasonCodes,
    features
  }
}
