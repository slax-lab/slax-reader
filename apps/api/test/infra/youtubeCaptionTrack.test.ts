/**
 * YouTube caption track selection and the TikHub fetch that returns both the legacy cues
 * and the normalized caption document.
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

const pick = (tracks: TikHubYoutubeCaptionTrack[], userLang = 'en') => (SocialMediaApi as any).rankYoutubeCaptionTracks(tracks, userLang)[0]?.language_code ?? null
const fetchTikHub = vi.spyOn(SocialMediaApi as any, 'fetchTikHub')
const ok = (data: unknown) => ({ code: 200, message: 'ok', data })
const json3 = { events: [{ tStartMs: 1000, segs: [{ utf8: 'Caption sample' }] }] }

describe('YouTube caption track selection', () => {
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

  test('manual-only lists prefer the user language, English, or the sole language', () => {
    expect(pick([track('fr'), track('zh-Hans'), track('en')], 'zh')).toBe('zh-Hans')
    expect(pick([track('fr'), track('en-US'), track('de')], 'zh')).toBe('en-US')
    expect(pick([track('fr'), track('de')], 'zh')).toBeNull()
    expect(pick([track('ja')], 'zh')).toBe('ja')
  })

  test('many manual translations sorted by name do not pick the first one (en0GuyhieQk)', () => {
    // TikHub list for en0GuyhieQk: 21 manual tracks, no ASR track, no kind, sorted by language name.
    const tracks = ['ar', 'bn', 'nl', 'en', 'fr', 'de', 'iw', 'hi', 'ja', 'ko', 'es'].map(code => ({ ...track(code), kind: undefined as unknown as string }))
    expect(pick(tracks, 'zh')).toBe('en')
  })

  test('user language is ignored when the original language is known', () => {
    expect(pick([track('zh-Hans'), track('a.en', 'asr')], 'zh')).toBe('a.en')
  })

  test('multiple automatic languages prefer the user language regardless of provider order', () => {
    const tracks = [track('a.ar'), track('en-US', 'asr'), track('A.zh-Hant')]
    for (const order of [tracks, tracks.toReversed()]) {
      expect(pick(order, 'zh')).toBe('A.zh-Hant')
      expect(pick(order, 'en')).toBe('en-US')
      expect(pick(order, 'ar')).toBe('en-US')
      expect(pick([...order, track('zh-Hans')], 'zh')).toBe('zh-Hans')
    }
  })

  test('a Chinese capture falls back to available English subtitles for y1-9yeYLJUo', () => {
    const tracks = [track('a.ar'), track('a.en')]
    expect(pick(tracks, 'zh')).toBe('a.en')
    expect(pick([...tracks, track('en')], 'zh')).toBe('en')
    expect(pick([track('a.ar'), track('a.ja')], 'zh')).toBeNull()
  })

  test('automatic variants in one language still use the single-language rule', () => {
    const tracks = [track('a.en-US'), track('a.en-GB'), track('a.en-US'), track('zh')]
    expect(pick(tracks, 'zh')).toBe('a.en-GB')
    expect(pick(tracks.toReversed(), 'zh')).toBe('a.en-GB')
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

  test('fetches only eligible tracks and keeps the same time budget for the English fallback', async () => {
    fetchTikHub
      .mockResolvedValueOnce(ok({ video_id: 'y1-9yeYLJUo', captions: [track('a.ar'), track('a.en'), track('a.zh-Hant')] }))
      .mockResolvedValueOnce(ok({ language_code: 'a.ar', content: json3 }))
      .mockResolvedValueOnce(ok({ language_code: 'en-US', content: json3 }))

    const result = await SocialMediaApi.fetchYoutubeCaption({} as Env, 'y1-9yeYLJUo', 'zh')

    expect(result.caption).toMatchObject({ video_id: 'y1-9yeYLJUo', language: 'en', kind: 'asr', source_track: 'a.en' })
    const requests = fetchTikHub.mock.calls.map(([, , options]) => options)
    expect(requests.map(options => options.searchParams.language_code)).toEqual([undefined, 'a.zh-Hant', 'a.en'])
    expect(requests.every(options => options.signal === requests[0].signal)).toBe(true)
  })

  test('bounds fallback to one attempt and omits provider data from diagnostics', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const providerUrl = 'https://signed.example/track'
    try {
      fetchTikHub
        .mockResolvedValueOnce(ok({ captions: [track('en'), track('en-GB'), track('a.en'), track('a.ar')] }))
        .mockResolvedValueOnce(ok({ video_id: 'other-video', language_code: 'en', content: json3 }))
        .mockResolvedValueOnce(ok({ language_code: providerUrl, content: json3 }))

      await expect(SocialMediaApi.fetchYoutubeCaption({} as Env, 'v1', 'en')).rejects.toThrow('language_mismatch')
      expect(fetchTikHub).toHaveBeenCalledTimes(3)
      const entries = output.mock.calls.map(([entry]) => JSON.parse(entry))
      expect(entries).toEqual([
        expect.objectContaining({ reason: 'video_mismatch', selected_language_code: 'en', returned_language_code: 'en' }),
        expect.objectContaining({ reason: 'language_mismatch', selected_language_code: 'en-GB' })
      ])
      expect(JSON.stringify(entries)).not.toContain(providerUrl)
      expect(JSON.stringify(entries)).not.toContain('Caption sample')
    } finally {
      output.mockRestore()
    }
  })

  test('rejects empty and untimed cues', async () => {
    fetchTikHub
      .mockResolvedValueOnce(ok({ captions: [track('en')] }))
      .mockResolvedValueOnce(ok({ content: { events: [{ segs: [{ utf8: 'Untimed' }] }, { tStartMs: 0, segs: [{ utf8: ' ' }] }] } }))
    await expect(SocialMediaApi.fetchYoutubeCaption({} as Env, 'v1')).rejects.toThrow('no_timed_cues')
  })
})

describe('YouTube asynchronous caption jobs', () => {
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

  test.each([
    ['zh', 'a.ar', null],
    ['zh', 'a.en', 'en'],
    ['zh', 'a.zh-Hant', 'zh-hant'],
    ['en', 'a.zh-Hant', null]
  ])('applies locale %s to direct content labelled %s', async (userLang, languageCode, expectedLanguage) => {
    fetchTikHub.mockResolvedValueOnce(ok({ status: 'completed', video_id: 'v1', language_code: languageCode, content: json3 }))
    const result = await SocialMediaApi.fetchYoutubeCaption({} as Env, 'v1', userLang)
    expect(result.caption?.language ?? null).toBe(expectedLanguage)
    expect(fetchTikHub).toHaveBeenCalledTimes(1)
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
