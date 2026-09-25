import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '@google/genai'
import {
  AIProviderError,
  CHAT_FIRST_BYTE_TIMEOUT_MS,
  classifyProviderError,
  toProviderFailure,
  VertexAIClient,
  type AIProviderFailure
} from '@/infra/external/vertexAIClient'
import { ErrorName } from '@/const/err'

/**
 * Provider failure detail and the first-byte budget.
 *
 * The defect these cover: `chatStream` replaced every provider failure with one opaque error,
 * discarding the status/code/reference the operator needs, and awaited the SDK with no bound,
 * so an unresponsive provider hung instead of failing.
 */

const contents = [{ role: 'user', parts: [{ text: 'hi' }] }] as any

const makeClient = (generateContentStream: (params: any) => Promise<AsyncGenerator<any>>) => {
  const client = new VertexAIClient({ VERTEX_API_KEY: 'test-key' } as never)
  ;(client as unknown as { getAIClient: () => Promise<unknown> }).getAIClient = async () => ({
    models: { generateContentStream: vi.fn(generateContentStream) }
  })
  return client
}

/** A provider that rejects immediately, the way the SDK surfaces an HTTP error. */
const failingClient = (sdkError: unknown) =>
  makeClient(async () => {
    throw sdkError
  })

afterEach(() => {
  vi.useRealTimers()
})

describe('toProviderFailure', () => {
  test('keeps status, code, reference and the overload flag from an SDK error', () => {
    const sdkError = Object.assign(new Error('got status: 500. {"error":{"code":500}} internal error; reference = cm46tqe5bj490abfkrmsinlh'), {
      name: 'ApiError',
      status: 503,
      code: 500,
      overloaded: true
    })

    expect(toProviderFailure(sdkError)).toEqual({
      providerStatus: 503,
      providerCode: 500,
      reference: 'cm46tqe5bj490abfkrmsinlh',
      overloaded: true,
      timedOut: false
    })
  })

  test('a plain error yields no provider detail and no timeout flag', () => {
    expect(toProviderFailure(new Error('network down'))).toEqual({
      providerStatus: undefined,
      providerCode: undefined,
      reference: undefined,
      overloaded: false,
      timedOut: false
    })
  })
})

describe('classifyProviderError', () => {
  test.each<[string, Partial<AIProviderFailure>, ErrorName]>([
    ['provider 401', { providerStatus: 401 }, ErrorName.AI_PROVIDER_AUTH],
    ['provider 403', { providerStatus: 403 }, ErrorName.AI_PROVIDER_AUTH],
    ['provider 429', { providerStatus: 429 }, ErrorName.AI_RATE_LIMIT],
    ['provider 500', { providerStatus: 500 }, ErrorName.AI_PROVIDER_UNAVAILABLE],
    ['provider 503', { providerStatus: 503 }, ErrorName.AI_PROVIDER_UNAVAILABLE],
    ['overloaded provider', { overloaded: true }, ErrorName.AI_PROVIDER_UNAVAILABLE],
    ['provider unreachable', {}, ErrorName.AI_PROVIDER_UNAVAILABLE],
    ['provider 400', { providerStatus: 400 }, ErrorName.AI_ERROR]
  ])('%s → %s', (_label, failure, expected) => {
    const error = new AIProviderError('provider call failed', { timedOut: false, ...failure })

    expect(classifyProviderError(error).name).toBe(expected)
  })

  test('an initiated timeout is classified as transient unavailability', () => {
    const error = new AIProviderError('provider call failed', { timedOut: true, providerStatus: 400 })

    expect(classifyProviderError(error).name).toBe(ErrorName.AI_PROVIDER_UNAVAILABLE)
  })

  test('a non-provider error falls back to the generic AI error', () => {
    expect(classifyProviderError(new Error('boom')).name).toBe(ErrorName.AI_ERROR)
  })

  test('classifies the real SDK ApiError shape, not only a hand-built object', () => {
    // The classification depends on the SDK exposing a numeric status. Using the library's own
    // ApiError pins that assumption against the real class rather than a mock shaped to match it.
    const classify = (status: number) => classifyProviderError(new AIProviderError('failed', toProviderFailure(new ApiError({ message: `got status: ${status}.`, status }))))

    expect(classify(401).name).toBe(ErrorName.AI_PROVIDER_AUTH)
    expect(classify(403).name).toBe(ErrorName.AI_PROVIDER_AUTH)
    expect(classify(429).name).toBe(ErrorName.AI_RATE_LIMIT)
    expect(classify(503).name).toBe(ErrorName.AI_PROVIDER_UNAVAILABLE)
  })
})

describe('VertexAIClient.chatStream provider failures', () => {
  test('keeps the provider detail on the thrown error instead of discarding it', async () => {
    const sdkError = Object.assign(new Error('got status: 500. internal error; reference = ref-123'), { name: 'ApiError', status: 503, overloaded: true })
    const error = await failingClient(sdkError)
      .chatStream(contents, { model: 'gemini-test' }, {})
      .catch(e => e)

    expect(error).toBeInstanceOf(AIProviderError)
    expect((error as AIProviderError).providerStatus).toBe(503)
    expect((error as AIProviderError).reference).toBe('ref-123')
    expect((error as AIProviderError).overloaded).toBe(true)
    expect((error as AIProviderError).originalError).toBe(sdkError)
    expect(classifyProviderError(error).name).toBe(ErrorName.AI_PROVIDER_UNAVAILABLE)
  })

  test('a provider auth failure is distinguishable from an outage', async () => {
    const sdkError = Object.assign(new Error('got status: 403.'), { name: 'ApiError', status: 403 })
    const error = await failingClient(sdkError)
      .chatStream(contents, { model: 'gemini-test' }, {})
      .catch(e => e)

    expect(classifyProviderError(error).name).toBe(ErrorName.AI_PROVIDER_AUTH)
  })
})

describe('VertexAIClient.chatStream first-byte budget', () => {
  test('a provider that never produces a first chunk is aborted at the budget', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined

    const client = makeClient(async (params: any) => {
      signal = params.config.abortSignal
      return (async function* () {
        await new Promise<never>((_, reject) => {
          params.config.abortSignal.addEventListener('abort', () => reject(new Error('The operation was aborted')))
        })
      })()
    })

    const settled = client.chatStream(contents, { model: 'gemini-test' }, {}).catch(e => e)
    await vi.advanceTimersByTimeAsync(CHAT_FIRST_BYTE_TIMEOUT_MS)
    const error = await settled

    expect(signal?.aborted).toBe(true)
    expect(error).toBeInstanceOf(AIProviderError)
    expect((error as AIProviderError).timedOut).toBe(true)
    expect(classifyProviderError(error).name).toBe(ErrorName.AI_PROVIDER_UNAVAILABLE)
  })

  test('a prompt first chunk clears the budget, so a long answer is not aborted', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined

    const client = makeClient(async (params: any) => {
      signal = params.config.abortSignal
      return (async function* () {
        yield { text: 'hello' }
      })()
    })

    await client.chatStream(contents, { model: 'gemini-test' }, {})
    await vi.advanceTimersByTimeAsync(CHAT_FIRST_BYTE_TIMEOUT_MS * 2)

    expect(signal?.aborted).toBe(false)
  })
})
