import { describe, expect, test, vi } from 'vitest'
import { SearchController } from '../../../src/handler/http/searchController'
import type { HybridSearchOrchestrator } from '../../../src/domain/orchestrator/hybridSearch'
import { ContextManager } from '../../../src/utils/context'
import { Hashid } from '../../../src/utils/hashids'
import type { HybridSearchEvent, HybridSearchHit } from '@slax-reader/contracts'

const USER = 7
const hit: HybridSearchHit = {
  type: 'collection',
  id: 'collection:30',
  collection_id: 30,
  collection_code: 'code',
  owner_id: 8,
  title: 'Collection',
  matched_channels: ['titles'],
  evidence: [{ channel: 'titles', rank: 1 }],
  rrf_score: 1 / 61
}

const partial: HybridSearchEvent = {
  type: 'partial',
  channel: 'titles',
  results: [hit],
  outcome: { status: 'ok', count: 1, coverage: { exhausted: true, truncated: false, reasons: [] } }
}

const complete: HybridSearchEvent = {
  type: 'complete',
  results: [hit],
  channels: {
    titles: { status: 'ok', count: 1, coverage: { exhausted: true, truncated: false, reasons: [] } },
    fulltext: { status: 'empty', count: 0, coverage: { exhausted: true, truncated: false, reasons: [] } },
    article_vector: { status: 'empty', count: 0, coverage: { exhausted: true, truncated: false, reasons: [] } },
    collection_vector: { status: 'empty', count: 0, coverage: { exhausted: true, truncated: false, reasons: [] } }
  },
  incomplete: false,
  replaces_partials: true
}

function execution() {
  const pending: Promise<unknown>[] = []
  const ctx = { waitUntil: vi.fn((work: Promise<unknown>) => pending.push(work)), passThroughOnException: vi.fn() } as unknown as ExecutionContext
  return { ctx, pending }
}

const hashEnv = { HASH_IDS_SALT: 'controller-search-salt' } as Env

function context(userId = USER) {
  const runtime = execution()
  const ctx = new ContextManager(runtime.ctx, hashEnv)
  ctx.setUserInfo(userId, userId * 100, '', 'en')
  ctx.setHashIds(new Hashid(hashEnv, userId))
  return { ctx, runtime }
}

function controller(stream: ConstructorParameters<typeof HybridSearchOrchestrator>[0] extends never ? never : any) {
  return Object.assign(Object.create(SearchController.prototype), { search: { stream } })
}

function request(body: unknown = { keyword: 'reader' }, init: { path?: string; headers?: Record<string, string>; rawBody?: string } = {}) {
  return new Request(`https://api-reader.slax.com/v1/search${init.path ?? ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.rawBody ?? JSON.stringify(body)
  })
}

const frames = (body: string) =>
  body
    .split('\n\n')
    .filter(Boolean)
    .map(frame => {
      const event = /^event: (.+)$/m.exec(frame)?.[1]
      const data = /^data: (.+)$/m.exec(frame)?.[1]
      return { event, data: data ? JSON.parse(data) : null }
    })

describe('SearchController HTTP boundary', () => {
  test('ordinary authentication is required and no refresh secret is consulted', async () => {
    const stream = vi.fn()
    const { ctx } = context(0)
    const response = await controller(stream).searchStream(ctx, request())
    expect(response.status).toBe(401)
    expect(stream).not.toHaveBeenCalled()
  })

  test.each([
    ['query parameters', { path: '?x=1' }],
    ['oversized declared body', { headers: { 'content-length': '17000' } }],
    ['invalid JSON', { rawBody: '{' }],
    ['empty keyword', {}, { keyword: '   ' }],
    ['missing keyword', {}, { limit: 10 }],
    ['extra field', {}, { keyword: 'reader', extra: true }],
    ['obsolete limit zero', {}, { keyword: 'reader', limit: 0 }],
    ['obsolete limit one', {}, { keyword: 'reader', limit: 1 }],
    ['obsolete limit over one hundred', {}, { keyword: 'reader', limit: 101 }],
    ['array body', {}, [{ keyword: 'reader' }]]
  ] as const)('rejects %s before starting the orchestrator', async (_label, init, body) => {
    const stream = vi.fn()
    const { ctx } = context()
    const response = await controller(stream).searchStream(ctx, request(body ?? { keyword: 'reader' }, init ?? {}))
    expect(response.status).toBe(400)
    expect(stream).not.toHaveBeenCalled()
  })

  test('returns SSE headers with CORS and private no-store caching', async () => {
    const stream = vi.fn(async (_ctx, _input, _signal, emit) => {
      emit(partial)
      emit(complete)
    })
    const { ctx } = context()
    const response = await controller(stream).searchStream(ctx, request())
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(response.headers.get('cache-control')).toBe('private, no-store, no-transform')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    expect(response.headers.get('server')).toBeTruthy()
  })

  test('encodes Collection origin cb_id from the owner relation without mutating or double-encoding internal events', async () => {
    const collectionOrigin = { kind: 'collection' as const, collection_id: 30, collection_code: 'code', owner_id: 8, cb_id: 88, bookmark_uuid: 'owner-uuid', title: 'Shared alias' }
    const articleHit: HybridSearchHit = {
      type: 'article',
      id: 'article:10',
      bookmark_id: 10,
      title: 'Article',
      target_url: 'https://example.com/10',
      origins: [{ kind: 'own', bookmark_user_uuid: 'own-uuid', title: 'Article' }, collectionOrigin],
      matched_channels: ['titles'],
      evidence: [{ channel: 'titles', rank: 1 }],
      rrf_score: 1 / 61
    }
    const partialArticle: HybridSearchEvent = {
      type: 'partial',
      channel: 'titles',
      results: [articleHit],
      outcome: { status: 'ok', count: 1, coverage: { exhausted: true, truncated: false, reasons: [] } }
    }
    const completeArticle: HybridSearchEvent = {
      ...complete,
      results: [articleHit]
    }
    const stream = vi.fn(async (_ctx, _input, _signal, emit) => {
      emit(partialArticle)
      emit(completeArticle)
    })
    const { ctx } = context()
    const response = await controller(stream).searchStream(ctx, request())
    const parsed = frames(await response.text())
    const decodedPartial = parsed[0].data.results[0]
    const decodedComplete = parsed[1].data.results[0]
    const hashid = new Hashid(hashEnv, USER)
    for (const hit of [decodedPartial, decodedComplete]) {
      const origin = hit.origins.find((candidate: { kind: string }) => candidate.kind === 'collection')
      expect(typeof origin.cb_id).toBe('number')
      expect(hashid.decodeId(origin.cb_id)).toBe(88)
      expect(origin.bookmark_uuid).toBe('owner-uuid')
    }
    expect(decodedPartial.origins[1].cb_id).toBe(decodedComplete.origins[1].cb_id)
    expect(articleHit.origins[1].cb_id).toBe(88)
  })

  test('frames partial and complete events and defers cleanup until the stream work settles', async () => {
    const stream = vi.fn(async (_ctx, input, _signal, emit) => {
      expect(input).toEqual({ keyword: 'reader' })
      emit(partial)
      emit(complete)
    })
    const { ctx } = context()
    const response = await controller(stream).searchStream(ctx, request())
    expect(stream).toHaveBeenCalledOnce()
    const body = await response.text()
    expect(frames(body)).toEqual([
      { event: 'partial', data: partial },
      { event: 'complete', data: complete }
    ])
  })

  test('the first partial reaches the reader before a delayed completion is released', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const stream = vi.fn(async (_ctx, _input, _signal, emit) => {
      emit(partial)
      await gate
      emit(complete)
    })
    const { ctx } = context()
    const response = await controller(stream).searchStream(ctx, request())
    const reader = response.body!.getReader()
    const first = await reader.read()
    const firstText = new TextDecoder().decode(first.value)
    expect(firstText).toContain('event: partial')
    expect(firstText).not.toContain('event: complete')
    release()
    let rest = ''
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      rest += new TextDecoder().decode(chunk.value)
    }
    expect(rest).toContain('event: complete')
  })

  test('cancelling the reader aborts the orchestrator signal and closes the stream', async () => {
    let received: AbortSignal | undefined
    const stream = vi.fn(async (_ctx, _input, signal) => {
      received = signal
      await new Promise<void>(resolve => signal.addEventListener('abort', resolve, { once: true }))
    })
    const { ctx } = context()
    const response = await controller(stream).searchStream(ctx, request())
    const reader = response.body!.getReader()
    await reader.cancel()
    expect(received?.aborted).toBe(true)
    expect(stream).toHaveBeenCalledOnce()
  })
})

describe('deferred ContextManager cleanup', () => {
  test('does not release database resources until the response stream work settles', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const stream = vi.fn(async (_ctx, _input, _signal, emit) => {
      emit(partial)
      await gate
      emit(complete)
    })
    const { ctx, runtime } = context()
    const cleanup = vi.fn(async () => undefined)
    ctx.onCleanup(cleanup)
    const response = await controller(stream).searchStream(ctx, request())
    await ctx.cleanup()
    expect(cleanup).not.toHaveBeenCalled()
    expect(runtime.ctx.waitUntil).toHaveBeenCalledOnce()
    release()
    await response.text()
    await Promise.all(runtime.pending)
    expect(cleanup).toHaveBeenCalledOnce()
  })

  test('deferred cleanup preserves the caller error handler and releases resources once', async () => {
    const { ctx, runtime } = context()
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    const failure = new Error('cleanup unavailable')
    const cleanup = vi.fn(async () => {
      throw failure
    })
    const onError = vi.fn()
    ctx.onCleanup(cleanup)
    ctx.deferCleanupUntil(gate)
    await ctx.cleanup(onError)
    await ctx.cleanup(onError)
    expect(cleanup).not.toHaveBeenCalled()
    expect(runtime.ctx.waitUntil).toHaveBeenCalledOnce()
    release()
    await Promise.all(runtime.pending)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure)
    await ctx.cleanup(onError)
    expect(cleanup).toHaveBeenCalledOnce()
  })

  test('cancellation still releases cleanup after the aborted work settles', async () => {
    const stream = vi.fn(async (_ctx, _input, signal) => {
      await new Promise<void>(resolve => signal.addEventListener('abort', resolve, { once: true }))
    })
    const { ctx, runtime } = context()
    const cleanup = vi.fn(async () => undefined)
    ctx.onCleanup(cleanup)
    const response = await controller(stream).searchStream(ctx, request())
    await response.body!.getReader().cancel()
    await ctx.cleanup()
    await Promise.all(runtime.pending)
    expect(cleanup).toHaveBeenCalledOnce()
  })
})
