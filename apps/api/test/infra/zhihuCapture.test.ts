import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fetchZhihuByUrl, ZhihuCaptureUnavailableError } from '@/infra/external/zhihu'
import { SocialMediaApi } from '@/infra/external/socialMedia'

const env = { TIKHUB_TOKEN: 'private-test-token' } as unknown as Env
const questionUrl = 'https://www.zhihu.com/question/2092104476844999911'
const answerId = '2009268855286022590'
const answerUrl = `https://www.zhihu.com/question/2092104476844999911/answer/${answerId}`
const answer = { id: answerId, content: '<p>Answer body</p>', question: { title: 'Question from answer' }, author: { name: 'Author' } }
const success = (data: unknown) => new Response(JSON.stringify({ code: 200, data }), { status: 200 })
const upstreamFailure = () =>
  new Response(
    JSON.stringify({
      detail: {
        code: 400,
        request_id: 'request-123',
        message: 'Request failed. Please retry. Check the docs below to verify your parameters.',
        message_zh: '请求失败，请重试。请查看下方文档核对参数。'
      }
    }),
    { status: 400 }
  )
const endpoint = (input: unknown) => new URL(String(input)).pathname.split('/').pop()

async function settle<T>(promise: Promise<T>) {
  const result = promise.then(
    value => ({ value, error: undefined }),
    error => ({ value: undefined, error })
  )
  await vi.runAllTimersAsync()
  return result
}

describe('Zhihu partial capture', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('keeps answers when question detail exhausts retries without fetching successful answers again', async () => {
    fetchMock.mockImplementation((input: unknown) => (endpoint(input) === 'fetch_question_detail' ? upstreamFailure() : success({ data: [{ target: answer }] })))
    const { value, error } = await settle(SocialMediaApi.fetchZhihuByUrl(env, questionUrl))
    expect(error).toBeUndefined()
    expect(value?.title).toBe('Question from answer')
    expect(value?.content).toContain('Answer body')
    expect(fetchMock.mock.calls.filter(([url]) => endpoint(url) === 'fetch_question_detail')).toHaveLength(4)
    expect(fetchMock.mock.calls.filter(([url]) => endpoint(url) === 'fetch_question_answers')).toHaveLength(1)
  })

  test('keeps question description when answers exhaust retries', async () => {
    fetchMock.mockImplementation((input: unknown) =>
      endpoint(input) === 'fetch_question_detail' ? success({ title: 'Question', detail: '<p>Question description</p>' }) : upstreamFailure()
    )
    const { value, error } = await settle(fetchZhihuByUrl(env, questionUrl))
    expect(error).toBeUndefined()
    expect(value?.title).toBe('Question')
    expect(value?.content).toContain('Question description')
    expect(fetchMock.mock.calls.filter(([url]) => endpoint(url) === 'fetch_question_detail')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => endpoint(url) === 'fetch_question_answers')).toHaveLength(4)
  })

  test('assembles description first and valid answers in provider order', async () => {
    fetchMock.mockImplementation((input: unknown) =>
      endpoint(input) === 'fetch_question_detail'
        ? success({ title: 'Question', detail: '<p>Description first</p>' })
        : success({
            data: [
              null,
              { target: null },
              { target: { ...answer, content: '<script>not content</script>' } },
              { target: answer },
              { target: { ...answer, id: '123', content: '<p>Second answer</p>' } }
            ]
          })
    )
    const result = await fetchZhihuByUrl(env, questionUrl)
    expect(result?.content.indexOf('Description first')).toBeLessThan(result!.content.indexOf('Answer body'))
    expect(result?.content.indexOf('Answer body')).toBeLessThan(result!.content.indexOf('Second answer'))
    expect(result?.content).not.toContain('not content')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('uses bounded exponential backoff and stops after recovery', async () => {
    const times: number[] = []
    fetchMock.mockImplementation(() => {
      times.push(Date.now())
      return times.length < 4 ? upstreamFailure() : success(answer)
    })
    const { value, error } = await settle(fetchZhihuByUrl(env, answerUrl))
    expect(error).toBeUndefined()
    expect(value?.content).toContain('Answer body')
    expect(times.map(time => time - times[0])).toEqual([0, 1000, 3000, 7000])
  })

  test('preserves the exact selected answer ID and never substitutes a question list', async () => {
    fetchMock.mockImplementation(() => upstreamFailure())
    const { error } = await settle(fetchZhihuByUrl(env, answerUrl))
    expect(error).toBeInstanceOf(ZhihuCaptureUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    for (const [input] of fetchMock.mock.calls) {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/api/v1/zhihu/web/fetch_answer_detail')
      expect(url.searchParams.get('answer_id')).toBe(answerId)
    }
  })

  test.each([401, 402, 403, 404, 422, 429])('does not retry terminal HTTP %i', async status => {
    fetchMock.mockImplementation(() => new Response(JSON.stringify({ detail: { code: status, message: 'Request failed. Please retry.' } }), { status }))
    const { error } = await settle(fetchZhihuByUrl(env, answerUrl))
    expect(error).toBeInstanceOf(ZhihuCaptureUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test.each([401, 402, 403, 404, 422, 429])('does not retry nested provider code %i in HTTP 200', async code => {
    fetchMock.mockImplementation(() => new Response(JSON.stringify({ code: 200, detail: { code, message: 'Request failed. Please retry.' } })))
    const { error } = await settle(fetchZhihuByUrl(env, answerUrl))
    expect(error).toBeInstanceOf(ZhihuCaptureUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test.each(['Invalid parameter: answer_id', '参数错误', 'The answer does not exist', '回答已删除'])('does not retry explicit invalid or missing content: %s', async message => {
    fetchMock.mockImplementation(() => new Response(JSON.stringify({ detail: { code: 400, message } }), { status: 400 }))
    const { error } = await settle(fetchZhihuByUrl(env, answerUrl))
    expect(error).toBeInstanceOf(ZhihuCaptureUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test.each([408, 500, 502, 503])('retries transient HTTP %i', async status => {
    fetchMock.mockImplementationOnce(() => new Response(JSON.stringify({ code: status }), { status })).mockImplementation(() => success(answer))
    const { value } = await settle(fetchZhihuByUrl(env, answerUrl))
    expect(value?.content).toContain('Answer body')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test.each(['invalid-json', 'null', '{}', '{"code":200,"data":{}}'])('retries malformed JSON or envelope: %s', async body => {
    fetchMock.mockImplementationOnce(() => new Response(body)).mockImplementation(() => success(answer))
    const { value } = await settle(fetchZhihuByUrl(env, answerUrl))
    expect(value?.content).toContain('Answer body')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('retries transport failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network unavailable')).mockImplementation(() => success(answer))
    const { value } = await settle(fetchZhihuByUrl(env, answerUrl))
    expect(value?.content).toContain('Answer body')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('applies the 20-second timeout through response body consumption', async () => {
    fetchMock
      .mockImplementationOnce((_input: unknown, init: RequestInit) => ({
        ok: true,
        status: 200,
        text: () => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
      }))
      .mockImplementation(() => success(answer))
    const started = Date.now()
    const { value } = await settle(fetchZhihuByUrl(env, answerUrl))
    expect(value?.content).toContain('Answer body')
    expect(Date.now() - started).toBe(21000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('does not retry valid empty parts and rejects an empty question', async () => {
    fetchMock.mockImplementation((input: unknown) => (endpoint(input) === 'fetch_question_detail' ? success({ title: 'Only a title', detail: '<p> </p>' }) : success({ data: [] })))
    const { error } = await settle(fetchZhihuByUrl(env, questionUrl))
    expect(error).toBeInstanceOf(ZhihuCaptureUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('uses a neutral title when retained answers provide none', async () => {
    fetchMock.mockImplementation((input: unknown) =>
      endpoint(input) === 'fetch_question_detail' ? success({ title: '', detail: '' }) : success({ data: [{ target: { ...answer, question: undefined } }] })
    )
    const result = await fetchZhihuByUrl(env, questionUrl)
    expect(result?.title).toBe('知乎问题')
    expect(result?.content).toContain('Answer body')
  })

  test.each([
    '<p>x</p>',
    '<img src="https://example.com/image.jpg">',
    '<img data-actualsrc="https://example.com/image.jpg">',
    '<video src="https://example.com/video.mp4"></video>'
  ])('accepts short text or supported media bodies: %s', async content => {
    fetchMock.mockImplementation(() => success({ ...answer, content }))
    const result = await fetchZhihuByUrl(env, answerUrl)
    expect(result?.content).toContain(content)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test.each(['', '<p> &nbsp; </p>', '<script>only script</script><style>body{}</style>', '<img src="javascript:void(0)">'])(
    'rejects title-only or unusable body without retries: %s',
    async content => {
      fetchMock.mockImplementation(() => success({ ...answer, content }))
      const { error } = await settle(fetchZhihuByUrl(env, answerUrl))
      expect(error).toBeInstanceOf(ZhihuCaptureUnavailableError)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  test.each([
    ['https://zhuanlan.zhihu.com/p/2090206127770359347', 'fetch_column_article_detail', 'article_id', '2090206127770359347'],
    ['https://www.zhihu.com/appview/p/2090206127770359347', 'fetch_column_article_detail', 'article_id', '2090206127770359347'],
    ['https://www.zhihu.com/pin/2102475323891888247', 'fetch_pin_detail', 'pin_id', '2102475323891888247']
  ])('preserves route and exact ID for %s', async (url, expectedEndpoint, parameter, id) => {
    fetchMock
      .mockImplementationOnce(() => upstreamFailure())
      .mockImplementation(() =>
        success(expectedEndpoint === 'fetch_pin_detail' ? { content: [{ type: 'text', content: '<p>Pin body</p>' }] } : { title: 'Article', content: '<p>Article body</p>' })
      )
    const { value, error } = await settle(fetchZhihuByUrl(env, url))
    expect(error).toBeUndefined()
    expect(value?.content).toContain(expectedEndpoint === 'fetch_pin_detail' ? 'Pin body' : 'Article body')
    for (const [input] of fetchMock.mock.calls) {
      expect(endpoint(input)).toBe(expectedEndpoint)
      expect(new URL(String(input)).searchParams.get(parameter)).toBe(id)
    }
  })

  test('filters malformed pin blocks but retains image-only content', async () => {
    fetchMock.mockImplementation(() => success({ content: [null, {}, { type: 'text', content: '  ' }, { type: 'image', url: 'https://example.com/image.jpg' }] }))
    const result = await fetchZhihuByUrl(env, 'https://www.zhihu.com/pin/123')
    expect(result?.content).toContain('https://example.com/image.jpg')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['https://zhuanlan.zhihu.com/p/123', { title: 'Title', content: '' }],
    ['https://www.zhihu.com/pin/123', { content: [] }]
  ])('does not save empty article or pin: %s', async (url, data) => {
    fetchMock.mockImplementation(() => success(data))
    const { error } = await settle(fetchZhihuByUrl(env, url))
    expect(error).toBeInstanceOf(ZhihuCaptureUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('records bounded diagnostics without response messages, token, headers, or raw body', async () => {
    fetchMock.mockImplementation(
      () =>
        new Response(
          JSON.stringify({
            detail: {
              code: 400,
              request_id: 'safe-request-id',
              message: 'Request failed. Please retry. secret-message',
              headers: { Authorization: 'private-test-token' },
              payload: '<p>private body</p>'
            }
          }),
          { status: 400 }
        )
    )
    const { error } = await settle(fetchZhihuByUrl(env, answerUrl))
    expect(error).toBeInstanceOf(ZhihuCaptureUnavailableError)
    const diagnostics = JSON.stringify([error.message, vi.mocked(console.warn).mock.calls])
    expect(diagnostics).toContain('safe-request-id')
    expect(diagnostics).toContain('400')
    expect(diagnostics).not.toContain('secret-message')
    expect(diagnostics).not.toContain('private-test-token')
    expect(diagnostics).not.toContain('private body')
    expect(diagnostics).not.toContain('Authorization')
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  test('returns null for unsupported paths without a provider request', async () => {
    expect(await fetchZhihuByUrl(env, 'https://www.zhihu.com/people/someone')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
