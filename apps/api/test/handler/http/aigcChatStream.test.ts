import { describe, expect, test, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))
vi.mock('@/decorators/controller', () => ({ Controller: () => (target: any) => target }))
vi.mock('@/decorators/route', () => ({
  Get: () => (_t: any, _k: string, desc: PropertyDescriptor) => desc,
  Post: () => (_t: any, _k: string, desc: PropertyDescriptor) => desc
}))

import { AigcService } from '@/domain/aigc'
import { AIProviderError } from '@/infra/external/vertexAIClient'
import { createMockCtx } from '@test/helpers/mockFactory'

/**
 * The user-visible defect, at the HTTP boundary: the handler returned the event stream
 * immediately and ran the model call in the background, so a provider failure left the
 * response body open forever and the client never learned that anything went wrong.
 * These cover the whole path: controller → real service → provider client → response body.
 */

const mockReq = (body: any) => {
  const payload = { json: () => Promise.resolve(body), url: 'https://api.test/v1/aigc/chat', cf: {}, headers: { get: () => '' } }
  return { ...payload, clone: () => payload } as unknown as Request
}

const wire = async (chatStream: (...args: any[]) => Promise<void>) => {
  const { AigcController } = await import('@/handler/http/aigcController')
  const client = { registerTools: vi.fn(), chatStream: vi.fn(chatStream) }
  const aigcService = new AigcService((() => client) as never)

  const ctrl = new (AigcController as any)()
  ;(ctrl as any).aigcService = aigcService
  ;(ctrl as any).userService = {
    getUserInfo: vi.fn().mockResolvedValue({ ai_lang: 'en', lang: 'en' }),
    getUserSubscriptionInfo: vi.fn().mockResolvedValue({ subscription_end_at: new Date('2099-01-01T00:00:00Z') })
  }
  ;(ctrl as any).bookmarkService = {
    getBookmarkTitleContent: vi.fn().mockResolvedValue({ title: 'Title', content: 'article body', bmId: 42, moderationResult: 0 })
  }
  ;(ctrl as any).logsSvc = { track: vi.fn().mockResolvedValue(undefined) }

  return { ctrl }
}

/** Runs the handler, drains the body, and resolves once the background task has settled. */
const callChat = async (ctrl: any) => {
  const ctx = createMockCtx({ userId: 7 })
  ctx.get = vi.fn((key: string) => (key === 'ai_lang' ? 'en' : undefined))

  let background: Promise<unknown> = Promise.resolve()
  ctx.execution.waitUntil = vi.fn((task: Promise<unknown>) => {
    background = task.catch(() => undefined)
    return background
  })

  const response = (await ctrl.handleCompletionsRequest(
    ctx,
    mockReq({ messages: [{ role: 'user', content: 'hi' }], raw_content: 'article body' })
  )) as Response

  // Drain concurrently: the TransformStream applies backpressure, so a write only settles
  // once the body is being read.
  const body = response.text()
  await background

  return { response, body: await body }
}

/** Reassembles the assistant text the client would render from the streamed SSE frames. */
const assistantContent = (body: string) =>
  body
    .split('\n')
    .filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map(line => JSON.parse(line.slice('data: '.length)))
    .flatMap(chunk => chunk.choices ?? [])
    .flatMap((choice: any) => choice.delta ?? [])
    .map((delta: any) => delta.content ?? '')
    .join('')

describe('POST /v1/aigc/chat response stream', () => {
  test('a provider failure ends the body and carries the error frame', async () => {
    const { ctrl } = await wire(async () => {
      throw new AIProviderError('provider down', { providerStatus: 503, timedOut: false })
    })

    const { response, body } = await callChat(ctrl)

    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    expect(body).toContain('AI_PROVIDER_UNAVAILABLE')
  })

  test('the error frame is the API envelope shape the client parses', async () => {
    const { ctrl } = await wire(async () => {
      throw new AIProviderError('provider down', { providerStatus: 401, timedOut: false })
    })

    const { body } = await callChat(ctrl)
    const frames = body
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('{'))

    expect(frames).toHaveLength(1)
    expect(JSON.parse(frames[0]!)).toMatchObject({ data: 'AI_PROVIDER_AUTH', code: 500 })
  })

  test('a successful answer streams its content and still ends', async () => {
    const { ctrl } = await wire(async (_contents: any, _config: any, options: any) => {
      await options.onTextDelta('hello world')
    })

    const { body } = await callChat(ctrl)

    expect(assistantContent(body)).toBe('hello world')
    expect(body).toContain('data: [DONE]')
  })
})
