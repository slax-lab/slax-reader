/**
 * YouTube caption track selection and the TikHub fetch that returns both the legacy cues
 * and the normalized caption document. Original language first, user language as fallback.
 * 来源: src/infra/external/socialMedia.ts
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SocialMediaApi } from '@/infra/external/socialMedia'
import type { TikHubYoutubeCaptionTrack } from '@/const/moreapi/youtube'

const track = (language_code: string, kind = ''): TikHubYoutubeCaptionTrack => ({
  language_code,
  language_name: language_code,
  kind,
  is_translatable: true,
  base_url: ''
})

const pick = (tracks: TikHubYoutubeCaptionTrack[], userLang?: string) => (SocialMediaApi as any).pickYoutubeCaptionTrack(tracks, userLang)?.language_code ?? null
const fetchTikHub = vi.spyOn(SocialMediaApi as any, 'fetchTikHub')

describe('pickYoutubeCaptionTrack', () => {
  test('no tracks → null', () => {
    expect(pick([])).toBeNull()
  })

  test('the ASR track tells the original language; a manual track in that language wins', () => {
    expect(pick([track('en'), track('ja'), track('a.ja', 'asr')], 'en')).toBe('ja')
  })

  test('without a manual track in the original language the ASR track wins over the user language', () => {
    expect(pick([track('en'), track('a.ja', 'asr')], 'en')).toBe('a.ja')
  })

  test('region tags do not break the original-language match', () => {
    expect(pick([track('pt-BR'), track('a.pt', 'asr')], 'en')).toBe('pt-BR')
  })

  test('without an ASR track the user language wins, then the first track', () => {
    expect(pick([track('fr'), track('zh-Hans'), track('en')], 'zh')).toBe('zh-Hans')
    expect(pick([track('fr'), track('de')], 'zh')).toBe('fr')
  })

  test('user language is ignored when the original language is known', () => {
    expect(pick([track('zh-Hans'), track('a.en', 'asr')], 'zh')).toBe('a.en')
  })
})

describe('fetchYoutubeCaption', () => {
  afterEach(() => {
    fetchTikHub.mockReset()
    vi.useRealTimers()
  })

  test('returns legacy cues and the caption document from one json3 fetch', async () => {
    fetchTikHub.mockResolvedValueOnce({ code: 200, message: 'ok', data: { video_id: 'v1', captions: [track('a.en', 'asr')] } }).mockResolvedValueOnce({
      code: 200,
      message: 'ok',
      data: JSON.stringify({
        video_id: 'v1',
        language_code: 'a.en',
        language_name: 'English (auto)',
        format: 'json3',
        content: {
          events: [
            { tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: 'hello world' }] },
            { tStartMs: 1200, dDurationMs: 800, segs: [{ utf8: 'world again' }] }
          ]
        }
      })
    })

    const result = await SocialMediaApi.fetchYoutubeCaption({ TIKHUB_TOKEN: 't' } as any, 'v1', 'zh')
    expect(result.cues).toEqual([
      { t: 0, text: 'hello world' },
      { t: 1, text: 'world again' }
    ])
    expect(result.caption).toMatchObject({ video_id: 'v1', language: 'en', kind: 'asr', source_track: 'a.en' })
    expect(result.caption?.cues).toEqual([
      { id: 'c0000', start_ms: 0, duration_ms: 1200, text: 'hello world' },
      { id: 'c0001', start_ms: 1200, duration_ms: 800, text: 'world again' }
    ])
    expect(fetchTikHub).toHaveBeenNthCalledWith(2, expect.anything(), '/api/v1/youtube/web_v2/get_video_captions', {
      searchParams: { video_id: 'v1', language_code: 'a.en', format: 'json3' },
      signal: expect.any(AbortSignal)
    })
  })

  test('no tracks → empty cues and a null document, without a second request', async () => {
    fetchTikHub.mockResolvedValueOnce({ code: 200, message: 'ok', data: { video_id: 'v1', captions: [] } })
    const result = await SocialMediaApi.fetchYoutubeCaption({ TIKHUB_TOKEN: 't' } as any, 'v1', 'en')
    expect(result).toEqual({ cues: [], caption: null })
    expect(fetchTikHub).toHaveBeenCalledTimes(1)
  })

  test('the legacy fetchYoutubeCaptionCues still returns only cues', async () => {
    fetchTikHub.mockResolvedValueOnce({ code: 200, message: 'ok', data: { video_id: 'v1', captions: [track('en')] } }).mockResolvedValueOnce({
      code: 200,
      message: 'ok',
      data: { video_id: 'v1', language_code: 'en', language_name: 'English', format: 'json3', content: { events: [{ tStartMs: 500, segs: [{ utf8: 'x' }] }] } }
    })
    expect(await SocialMediaApi.fetchYoutubeCaptionCues({ TIKHUB_TOKEN: 't' } as any, 'v1')).toEqual([{ t: 0, text: 'x' }])
  })
})

describe('YouTube asynchronous caption jobs', () => {
  const ok = (data: unknown) => ({ code: 200, message: 'ok', data })
  const content = { language_code: 'en', content: JSON.stringify({ events: [{ tStartMs: 1000, segs: [{ utf8: 'Long lecture' }] }] }) }
  afterEach(() => {
    fetchTikHub.mockReset()
    vi.useRealTimers()
  })

  test.each([true, false])('polls queued/active jobs and keeps json3 content (async list=%s)', async asyncList => {
    vi.useFakeTimers()
    if (!asyncList) fetchTikHub.mockResolvedValueOnce(ok({ captions: [track('en')] }))
    fetchTikHub
      .mockResolvedValueOnce(ok(JSON.stringify({ status: 'processing', job_id: 'caption-job' })))
      .mockResolvedValueOnce(ok({ status: 'queued' }))
      .mockResolvedValueOnce(ok({ status: 'active' }))
      .mockResolvedValueOnce(ok({ status: 'completed', ...content }))
    const result = SocialMediaApi.fetchYoutubeCaption({} as any, 'v1')
    await vi.runAllTimersAsync()
    expect((await result).cues).toEqual([{ t: 1, text: 'Long lecture' }])
    const polls = fetchTikHub.mock.calls.filter(([, path]) => String(path).endsWith('_result'))
    expect(polls).toHaveLength(3)
    expect(polls.every(([, , options]) => JSON.stringify(options.searchParams) === JSON.stringify({ job_id: 'caption-job', format: 'json3' }))).toBe(true)
  })

  test.each([{ status: 'processing' }, { status: 'failed' }, {}, null, 'bad json'])('invalid/error responses are not classified as no captions: %j', async data => {
    fetchTikHub.mockResolvedValueOnce(ok(data))
    await expect(SocialMediaApi.fetchYoutubeCaption({} as any, 'v1')).rejects.toBeDefined()
  })

  test('bounds polling and reports timeouts as failures', async () => {
    vi.useFakeTimers()
    fetchTikHub.mockResolvedValue(ok({ status: 'processing', job_id: 'caption-job' }))
    const result = expect(SocialMediaApi.fetchYoutubeCaption({} as any, 'v1')).rejects.toThrow('timed out')
    await vi.runAllTimersAsync()
    await result
    expect(fetchTikHub).toHaveBeenCalledTimes(21)
  })
})
