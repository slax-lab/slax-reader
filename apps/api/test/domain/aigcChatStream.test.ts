import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AigcService } from '@/domain/aigc'
import { AIProviderError, type AIProviderFailure } from '@/infra/external/vertexAIClient'
import { ErrorName, AIError, AIProviderAuthError, AIProviderUnavailableError, AIRateLimitError } from '@/const/err'
import { setGlobalLanguage } from '@/utils/multiLangError'

/**
 * Stream termination and error-frame delivery for the bookmark chat stream.
 *
 * The defect these cover: the handler used to return from several paths without closing the
 * writable side, and collapsed every provider failure into one opaque assistant sentence, so
 * the client saw neither content nor an error and spun forever.
 */

type CapturedStream = {
  frames: string[]
  closed: boolean
  writer: WritableStream<Uint8Array>
}

/** Captures what the handler writes and whether it closed the stream, without a real pipeline. */
const captureStream = (): CapturedStream => {
  const state: CapturedStream = { frames: [], closed: false, writer: undefined as never }
  const decoder = new TextDecoder()

  state.writer = {
    getWriter: () => ({
      write: async (chunk: Uint8Array) => {
        state.frames.push(decoder.decode(chunk))
      },
      close: async () => {
        state.closed = true
      }
    })
  } as unknown as WritableStream<Uint8Array>

  return state
}

/** The envelope-shaped error frames, which are the only bare JSON lines on the stream. */
const errorEnvelopes = (stream: CapturedStream) =>
  stream.frames
    .flatMap(frame => frame.split('\n'))
    .map(line => line.trim())
    .filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line) as { data: string; message: string; code: number })

const runChat = async (chatStream: (...args: any[]) => Promise<void>, messages: any[], rawContent = 'article body') => {
  const client = { registerTools: vi.fn(), chatStream: vi.fn(chatStream) }
  const service = new AigcService((() => client) as never)
  const stream = captureStream()
  const ctx = { get: vi.fn(() => undefined), env: {} }

  await service.bookmarkChat(ctx as never, 'Title', rawContent, messages, stream.writer, [])

  return stream
}

const providerFailure = (failure: Partial<AIProviderFailure>) => new AIProviderError('provider call failed', { timedOut: false, ...failure })

const throwProvider = (failure: Partial<AIProviderFailure>) => async () => {
  throw providerFailure(failure)
}

const userMessage = [{ role: 'user', parts: [{ text: 'hello' }] }] as any

beforeEach(() => {
  setGlobalLanguage('en')
})

describe('bookmarkChat terminates the stream on every failure', () => {
  test.each<[string, Partial<AIProviderFailure>, ErrorName]>([
    ['provider 5xx', { providerStatus: 503 }, ErrorName.AI_PROVIDER_UNAVAILABLE],
    ['provider overloaded', { overloaded: true }, ErrorName.AI_PROVIDER_UNAVAILABLE],
    ['provider unreachable (no status)', {}, ErrorName.AI_PROVIDER_UNAVAILABLE],
    ['first-byte timeout', { timedOut: true }, ErrorName.AI_PROVIDER_UNAVAILABLE],
    ['provider 401', { providerStatus: 401 }, ErrorName.AI_PROVIDER_AUTH],
    ['provider 403', { providerStatus: 403 }, ErrorName.AI_PROVIDER_AUTH],
    ['provider 429', { providerStatus: 429 }, ErrorName.AI_RATE_LIMIT],
    ['provider 400', { providerStatus: 400 }, ErrorName.AI_ERROR]
  ])('%s → one %s frame and a closed stream', async (_label, failure, expected) => {
    const stream = await runChat(throwProvider(failure), userMessage)

    expect(stream.closed).toBe(true)
    const envelopes = errorEnvelopes(stream)
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]!.data).toBe(expected)
    expect(envelopes[0]!.code).toBeGreaterThanOrEqual(400)
    expect(envelopes[0]!.message.length).toBeGreaterThan(0)
  })

  test('an unexpected error still terminates the stream with a generic frame', async () => {
    const stream = await runChat(async () => {
      throw new Error('boom')
    }, userMessage)

    expect(stream.closed).toBe(true)
    expect(errorEnvelopes(stream).map(f => f.data)).toEqual([ErrorName.AI_ERROR])
  })

  test('failure is not disguised as assistant content', async () => {
    const stream = await runChat(throwProvider({ providerStatus: 503 }), userMessage)

    expect(stream.frames.join('')).not.toContain('Failed to generate question')
  })
})

describe('bookmarkChat terminates the stream on validation exits', () => {
  test('no messages → invalid-parameter frame and a closed stream', async () => {
    const stream = await runChat(async () => {}, [])

    expect(stream.closed).toBe(true)
    expect(errorEnvelopes(stream).map(f => f.data)).toEqual([ErrorName.ERROR_PARAM])
  })

  test('unknown function call → invalid-parameter frame and a closed stream', async () => {
    const stream = await runChat(async () => {}, [{ role: 'model', parts: [{ functionCall: { name: 'notATool' } }] }] as any)

    expect(stream.closed).toBe(true)
    expect(errorEnvelopes(stream).map(f => f.data)).toEqual([ErrorName.ERROR_PARAM])
  })

  test('a throw before dispatch still closes the stream', async () => {
    // A malformed body that makes message inspection throw before the try used to begin.
    const stream = await runChat(async () => {}, [null] as any)

    expect(stream.closed).toBe(true)
    expect(errorEnvelopes(stream)).toHaveLength(1)
  })

  test('exactly one frame is written even when the failure is observed once', async () => {
    const stream = await runChat(throwProvider({ providerStatus: 500 }), userMessage)

    expect(errorEnvelopes(stream)).toHaveLength(1)
  })
})

describe('bookmarkChat awaits termination before the background task settles', () => {
  /**
   * The original defect: the terminal write and the close were both `void`-ed inside the
   * `waitUntil` task, so the task's promise settled before the stream had actually closed and
   * the runtime could tear the isolate down mid-close. A "was it closed" assertion cannot catch
   * that — the old code did call close, just without waiting for it. Only the ordering can.
   */
  const orderedStream = (options: { closeDelayMs?: number; gateClose?: boolean } = {}) => {
    const events: string[] = []
    let releaseClose: (() => void) | undefined

    const writer = {
      getWriter: () => ({
        write: async (chunk: Uint8Array) => {
          const text = new TextDecoder().decode(chunk)
          events.push(text.trimStart().startsWith('{') ? 'error-frame' : 'content')
        },
        close: async () => {
          if (options.gateClose) await new Promise<void>(resolve => (releaseClose = resolve))
          else if (options.closeDelayMs) await new Promise(resolve => setTimeout(resolve, options.closeDelayMs))
          events.push('close')
        }
      })
    } as unknown as WritableStream<Uint8Array>

    return { events, writer, releaseClose: () => releaseClose?.() }
  }

  const runOrdered = (options: { closeDelayMs?: number; gateClose?: boolean } = {}) => {
    const client = { registerTools: vi.fn(), chatStream: vi.fn(throwProvider({ providerStatus: 503 })) }
    const service = new AigcService((() => client) as never)
    const stream = orderedStream(options)
    const ctx = { get: vi.fn(() => undefined), env: {} }

    return { ...stream, task: service.bookmarkChat(ctx as never, 'Title', 'article body', userMessage, stream.writer, []) }
  }

  test('writes the error frame, then closes, then settles', async () => {
    const { events, task } = runOrdered({ closeDelayMs: 5 })

    await task
    events.push('task-settled')

    expect(events).toEqual(['error-frame', 'close', 'task-settled'])
  })

  test('a pending close keeps the task pending, proving the close is awaited', async () => {
    const { events, task: rawTask, releaseClose } = runOrdered({ gateClose: true })

    let settled = false
    const task = rawTask.then(() => {
      settled = true
    })

    // Give the task every chance to settle early; with an awaited close it must not.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settled).toBe(false)

    releaseClose()
    await task

    expect(settled).toBe(true)
    expect(events).toEqual(['error-frame', 'close'])
  })
})

describe('bookmarkChat success path is unchanged', () => {
  test('a successful short-circuit writes content and closes without an error frame', async () => {
    const stream = await runChat(async () => {}, userMessage, '')

    expect(stream.closed).toBe(true)
    expect(errorEnvelopes(stream)).toHaveLength(0)
    expect(stream.frames.join('')).toContain('data: ')
  })

  test('a provider error frame is a plain JSON line, not an SSE frame', async () => {
    const stream = await runChat(throwProvider({ providerStatus: 503 }), userMessage)
    const raw = stream.frames.join('')

    // An SSE-framed error would be parsed as a chat chunk by the client and swallowed.
    expect(raw.startsWith('{')).toBe(true)
    expect(raw.trim().endsWith('}')).toBe(true)
  })
})

describe('AI provider error copy', () => {
  test('no user-facing AI error message claims a backup provider switch', () => {
    const messages = [AIError(), AIProviderUnavailableError(), AIProviderAuthError(), AIRateLimitError()]

    for (const message of messages) {
      const text = message.getMessage.toLowerCase()
      expect(text).not.toContain('backup provider')
      expect(text).not.toContain('备用')
    }
  })

  test('the transient-unavailable message points the user at retrying', () => {
    expect(AIProviderUnavailableError().getMessage.toLowerCase()).toContain('try again')
  })

  test('the misconfiguration message states the cause and that retrying will not fix it', () => {
    const text = AIProviderAuthError().getMessage.toLowerCase()

    expect(text).toContain('configuration')
    expect(text).toContain('will not help')
    expect(text).not.toContain('try again')
  })
})
