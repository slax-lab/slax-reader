import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekClient, DeepSeekError } from '@/infra/external/deepseekClient'

const config = { maxOutputTokens: 4000, responseSchema: { type: 'object', properties: { text: { type: 'string' } } } }
const input = [{ role: 'user', parts: [{ text: 'Public source passage' }] }]
const options = { systemInstruction: 'Translate faithfully. Return JSON.' }
const reply = (content: unknown = '{"text":"译文"}', finish = 'stop', usage: unknown = { prompt_tokens: 100, completion_tokens: 30 }) =>
  Response.json({ choices: [{ message: { content }, finish_reason: finish }], usage })

afterEach(() => vi.unstubAllGlobals())

describe('DeepSeek article client', () => {
  it('uses the fixed endpoint without Gemini parameters', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply())
    vi.stubGlobal('fetch', fetcher)
    const signal = AbortSignal.timeout(1000)
    const result = await new DeepSeekClient({ DEEPSEEK_API_KEY: 'test-key' }).chat(input, { ...config, abortSignal: signal }, options)
    const [url, request] = fetcher.mock.calls[0]
    expect(url.href).toBe('https://api.deepseek.com/chat/completions')
    expect(request).toMatchObject({ method: 'POST', redirect: 'manual', signal, headers: { Authorization: 'Bearer test-key' } })
    const body = JSON.parse(request.body)
    expect(body).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 4000, stream: false })
    expect(body).not.toHaveProperty('thinkingConfig')
    expect(body.messages[0].content).toContain('Return only JSON')
    expect(result).toEqual({ text: '{"text":"译文"}', finishReason: 'STOP', usage: { inputTokens: 100, outputTokens: 30, thoughtTokens: 0 } })
  })

  it('uses the approved default endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply())
    vi.stubGlobal('fetch', fetcher)
    await new DeepSeekClient({ DEEPSEEK_API_KEY: 'test-key' }).chat(input, config, options)
    expect(fetcher.mock.calls[0][0].href).toBe('https://api.deepseek.com/chat/completions')
  })

  it.each(['', '   ', null])('preserves billed usage for empty content %j', async content => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(content)))
    const result = await new DeepSeekClient({ DEEPSEEK_API_KEY: 'test-key' }).chat(input, config, options)
    expect(result.text.trim()).toBe('')
    expect(result.usage?.outputTokens).toBe(30)
  })

  it('reports truncation before content acceptance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('{"text":', 'length')))
    expect(await new DeepSeekClient({ DEEPSEEK_API_KEY: 'test-key' }).chat(input, config, options)).toMatchObject({ finishReason: 'MAX_TOKENS', usage: { outputTokens: 30 } })
  })

  it.each([undefined, { prompt_tokens: -1, completion_tokens: 3 }, { prompt_tokens: 1, completion_tokens: '3' }])('does not invent usage for %j', async usage => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [], usage })))
    expect((await new DeepSeekClient({ DEEPSEEK_API_KEY: 'test-key' }).chat(input, config, options)).usage).toBeUndefined()
  })

  it.each([301, 302, 303, 307, 308, 401, 429, 500])('exposes HTTP %i without response content', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-key and source text', { status })))
    await expect(new DeepSeekClient({ DEEPSEEK_API_KEY: 'test-key' }).chat(input, config, options)).rejects.toMatchObject({
      message: `deepseek_http:${status}`,
      providerStatus: status
    })
  })

  it('sanitizes transport failures and honors cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, request) => {
        request.signal.throwIfAborted()
      })
    )
    await expect(new DeepSeekClient({ DEEPSEEK_API_KEY: 'test-key' }).chat(input, { ...config, abortSignal: controller.signal }, options)).rejects.toThrow('deepseek_transport')
  })

  it('rejects malformed response bodies without leaking them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private payload')))
    await expect(new DeepSeekClient({ DEEPSEEK_API_KEY: 'test-key' }).chat(input, config, options)).rejects.toThrow('deepseek_response')
  })

  it.each([{}, { DEEPSEEK_API_KEY: '' }, { DEEPSEEK_API_KEY: '   ' }])('rejects invalid configuration before a network call', async env => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(new DeepSeekClient(env).chat(input, config, options)).rejects.toBeInstanceOf(DeepSeekError)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
