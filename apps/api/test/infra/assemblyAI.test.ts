/**
 * AssemblyAI client against a fake fetch: request shape (from the API reference checked on
 * 2026-10-14), job states, the speaker-label fallback and error classes.
 * 来源: src/infra/external/assemblyAI.ts, docs/podcast-article/spec.md 第 3.4 节
 */
import { describe, expect, test } from 'vitest'
import { AssemblyAIClient, AssemblyAIError, assemblyCostUsd } from '@/infra/external/assemblyAI'

type Call = { url: string; init: RequestInit }

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = []
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const next = responses.shift()!
    return new Response(JSON.stringify(next.body), { status: next.status })
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe('AssemblyAIClient.submit', () => {
  test('does not bind fetch to the client instance', async () => {
    const fetcher = async function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation')
      return Response.json({ id: 'job-context', status: 'queued' })
    }
    await expect(new AssemblyAIClient('key', fetcher as typeof fetch).submit('https://cdn.example.com/a.mp3', 'zh')).resolves.toBe('job-context')
  })

  test('sends the audio URL, models, speaker labels and the known language', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { id: 'job1', status: 'queued' } }])
    expect(await new AssemblyAIClient('key', fn).submit('https://cdn.example.com/a.mp3', 'zh')).toBe('job1')
    expect(calls[0].url).toBe('https://api.assemblyai.com/v2/transcript')
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('key')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      audio_url: 'https://cdn.example.com/a.mp3',
      speech_models: ['universal-2'],
      punctuate: true,
      format_text: true,
      speaker_labels: true,
      language_code: 'zh'
    })
  })

  test('unknown language → language_detection, no language_code', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { id: 'job2' } }])
    await new AssemblyAIClient('key', fn).submit('https://cdn.example.com/a.mp3', null)
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.language_detection).toBe(true)
    expect(body).not.toHaveProperty('language_code')
  })

  test('speaker labels refused → sent again without them', async () => {
    const { fn, calls } = fakeFetch([
      { status: 400, body: { error: 'speaker_labels is not available for this language' } },
      { status: 200, body: { id: 'job3' } }
    ])
    expect(await new AssemblyAIClient('key', fn).submit('https://cdn.example.com/a.mp3', 'zh')).toBe('job3')
    expect(JSON.parse(calls[1].init.body as string)).not.toHaveProperty('speaker_labels')
  })

  test('other 4xx is final, 429 and 5xx are not; no key is final', async () => {
    const run = async (status: number) => {
      const { fn } = fakeFetch([{ status, body: { error: 'x' } }])
      return new AssemblyAIClient('key', fn).submit('https://a/b.mp3', 'en').catch(e => e as AssemblyAIError)
    }
    expect(await run(400)).toMatchObject({ status: 400, final: true })
    expect(await run(429)).toMatchObject({ status: 429, final: false })
    expect(await run(503)).toMatchObject({ status: 503, final: false })
    await expect(new AssemblyAIClient('').submit('https://a/b.mp3', 'en')).rejects.toMatchObject({ final: true })
  })
})

describe('AssemblyAIClient.get', () => {
  test('queued and processing are pending', async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: { id: 'j', status: 'queued' } },
      { status: 200, body: { id: 'j', status: 'processing' } }
    ])
    const client = new AssemblyAIClient('key', fn)
    expect(await client.get('j')).toEqual({ status: 'pending' })
    expect(await client.get('j')).toEqual({ status: 'pending' })
    expect(calls[0].url).toBe('https://api.assemblyai.com/v2/transcript/j')
  })

  test('completed → segments in ms with speakers, duration and cost', async () => {
    const { fn } = fakeFetch([
      {
        status: 200,
        body: {
          id: 'j',
          status: 'completed',
          language_code: 'en',
          audio_duration: 3600,
          words: [
            { text: 'Hello', start: 100, end: 400, confidence: 0.9, speaker: 'A' },
            { text: 'there.', start: 400, end: 800, confidence: 0.9, speaker: 'A' }
          ]
        }
      }
    ])
    expect(await new AssemblyAIClient('key', fn).get('j')).toEqual({
      status: 'completed',
      language: 'en',
      durationSec: 3600,
      costUsd: 0.17,
      segments: [
        { start_ms: 100, end_ms: 400, text: 'Hello', speaker: 'A' },
        { start_ms: 400, end_ms: 800, text: 'there.', speaker: 'A' }
      ]
    })
  })

  test('error status → error with the provider message', async () => {
    const { fn } = fakeFetch([{ status: 200, body: { id: 'j', status: 'error', error: 'Download error, unable to download' } }])
    expect(await new AssemblyAIClient('key', fn).get('j')).toEqual({ status: 'error', error: 'Download error, unable to download' })
  })

  test('cost rounds per audio hour', () => {
    expect(assemblyCostUsd(1800)).toBe(0.085)
    expect(assemblyCostUsd(0)).toBe(0)
  })
})
