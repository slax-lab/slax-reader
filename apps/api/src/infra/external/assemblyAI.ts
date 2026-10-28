import type { PodcastLanguage } from '@/utils/podcastSource'
import { assemblyWordsToSegments, type AssemblyWord, type TranscriptSegment } from '@/utils/podcastTranscript'

/**
 * AssemblyAI speech-to-text for podcast episodes without a publisher transcript. The audio stays on
 * the publisher's host: AssemblyAI fetches `audio_url` itself, so the Worker never downloads audio.
 * The workflow submits once and polls with step.sleep (docs/podcast-article/spec.md 第 3.4 节).
 * API: https://www.assemblyai.com/docs/api-reference/transcripts (checked 2026-10-14).
 */

export const ASSEMBLYAI_BASE_URL = 'https://api.assemblyai.com'
// Universal-2 only: it is the model the price below (and every cost cap) is based on
export const ASSEMBLYAI_SPEECH_MODELS = ['universal-2'] as const
// debt: list price per audio hour, not checked against the account's contract; the real bill can differ.
// Upgrade: read the price from config once the contract is signed.
export const ASSEMBLYAI_USD_PER_HOUR = 0.17

export type AssemblyJobState =
  | { status: 'pending' }
  | { status: 'completed'; segments: TranscriptSegment[]; language: string | null; durationSec: number; costUsd: number }
  | { status: 'error'; error: string }

interface AssemblyTranscriptResponse {
  id?: string
  status?: 'queued' | 'processing' | 'completed' | 'error'
  error?: string
  language_code?: string | null
  audio_duration?: number | null
  words?: AssemblyWord[] | null
}

export class AssemblyAIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** 4xx other than 429: the same request will fail again. */
    public readonly final: boolean
  ) {
    super(message)
  }
}

export function assemblyCostUsd(durationSec: number): number {
  return Math.round((durationSec / 3600) * ASSEMBLYAI_USD_PER_HOUR * 10_000) / 10_000
}

export class AssemblyAIClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private async call(path: string, init: RequestInit = {}): Promise<AssemblyTranscriptResponse> {
    if (!this.apiKey) throw new AssemblyAIError('ASSEMBLYAI_API_KEY is not set', 0, true)
    const fetcher = this.fetcher
    const resp = await fetcher(`${ASSEMBLYAI_BASE_URL}${path}`, {
      ...init,
      headers: { authorization: this.apiKey, 'content-type': 'application/json' }
    })
    const body = (await resp.json().catch(() => ({}))) as AssemblyTranscriptResponse
    if (!resp.ok) {
      const final = resp.status >= 400 && resp.status < 500 && resp.status !== 429
      throw new AssemblyAIError(`assemblyai ${resp.status}: ${body.error ?? 'request failed'}`, resp.status, final)
    }
    return body
  }

  /**
   * Start a transcription job; returns the job id. A known language goes in as `language_code`,
   * otherwise AssemblyAI detects it (the two cannot be combined). If speaker labels are refused for
   * the language, the job is sent again without them: a transcript without speakers is still usable.
   */
  public async submit(audioUrl: string, language: PodcastLanguage | null): Promise<string> {
    const body: Record<string, unknown> = {
      audio_url: audioUrl,
      speech_models: ASSEMBLYAI_SPEECH_MODELS,
      punctuate: true,
      format_text: true,
      speaker_labels: true,
      ...(language ? { language_code: language } : { language_detection: true })
    }
    try {
      return this.jobId(await this.call('/v2/transcript', { method: 'POST', body: JSON.stringify(body) }))
    } catch (err) {
      if (!(err instanceof AssemblyAIError) || err.status !== 400 || !/speaker/i.test(err.message)) throw err
      delete body.speaker_labels
      return this.jobId(await this.call('/v2/transcript', { method: 'POST', body: JSON.stringify(body) }))
    }
  }

  private jobId(res: AssemblyTranscriptResponse): string {
    if (!res.id) throw new AssemblyAIError('assemblyai: no job id in the response', 200, false)
    return res.id
  }

  public async get(jobId: string): Promise<AssemblyJobState> {
    const res = await this.call(`/v2/transcript/${encodeURIComponent(jobId)}`)
    if (res.status === 'error') return { status: 'error', error: res.error || 'transcription failed' }
    if (res.status !== 'completed') return { status: 'pending' }
    const durationSec = Math.round(res.audio_duration ?? 0)
    return {
      status: 'completed',
      segments: assemblyWordsToSegments(res.words ?? []),
      language: res.language_code ?? null,
      durationSec,
      costUsd: assemblyCostUsd(durationSec)
    }
  }
}
