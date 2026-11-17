import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AigcService } from '@/domain/aigc'
import { BookmarkService } from '@/domain/bookmark'
import { BookmarkOrchestrator } from '@/domain/orchestrator/bookmark'
import { AIProviderError } from '@/infra/external/vertexAIClient'
import { setGlobalLanguage } from '@/utils/multiLangError'
import { createMockCtx } from '@test/helpers/mockFactory'

/**
 * Outline/summary persistence on failure.
 *
 * The defect these cover: a failed or interrupted generation was persisted as the user's cached
 * outline (an empty string, or the part streamed before the failure), and every later read served
 * that row as a cache hit, so the outline never generated again.
 */

type DeltaStream = (contents: unknown, config: unknown, options: { onTextDelta?: (text: string) => Promise<void> }) => Promise<void>

const providerFailure = () => new AIProviderError('provider call failed', { providerStatus: 503, timedOut: false })

const streamDeltas =
  (deltas: string[], failAfter = false): DeltaStream =>
  async (_contents, _config, options) => {
    for (const delta of deltas) await options.onTextDelta?.(delta)
    if (failAfter) throw providerFailure()
  }

const captureWriter = () => {
  const frames: string[] = []
  const state = { closed: false }
  const writer = new WritableStream<Uint8Array>({
    write(chunk) {
      frames.push(new TextDecoder().decode(chunk))
    },
    close() {
      state.closed = true
    }
  })
  return { frames, state, writer }
}

const serviceWith = (chatStream: DeltaStream) => new AigcService((() => ({ chatStream: vi.fn(chatStream) })) as never, (() => ({})) as never, {} as never, {} as never)

const ctx = { get: vi.fn(() => 'zh'), env: {} }

beforeEach(() => {
  setGlobalLanguage('en')
})

describe('bookmarkSummary persists only a complete, non-empty generation', () => {
  test('a provider failure before any output is not persisted', async () => {
    const save = vi.fn()
    const stream = captureWriter()

    await serviceWith(streamDeltas([], true)).bookmarkSummary(ctx as never, 'article', stream.writer, save)

    expect(save).not.toHaveBeenCalled()
    expect(stream.state.closed).toBe(true)
    expect(stream.frames.join('').length).toBeGreaterThan(0)
  })

  test('a failure after partial output does not persist the partial outline', async () => {
    const save = vi.fn()
    const stream = captureWriter()

    await serviceWith(streamDeltas(['# Title\n', '- point [1](#unfinished'], true)).bookmarkSummary(ctx as never, 'article', stream.writer, save)

    expect(save).not.toHaveBeenCalled()
    expect(stream.state.closed).toBe(true)
  })

  test('a successful generation with no text is not persisted', async () => {
    const save = vi.fn()
    const stream = captureWriter()

    await serviceWith(streamDeltas(['', '  \n'])).bookmarkSummary(ctx as never, 'article', stream.writer, save)

    expect(save).not.toHaveBeenCalled()
  })

  test('a complete generation persists exactly what was streamed', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const stream = captureWriter()

    await serviceWith(streamDeltas(['# Title\n', '- point [1](#source)\n'])).bookmarkSummary(ctx as never, 'article', stream.writer, save)

    expect(stream.frames.join('')).toBe('# Title\n- point [1](#source)\n')
    expect(save).toHaveBeenCalledWith({ provider: 'google', model: 'gemini-3-flash-preview', response: '# Title\n- point [1](#source)\n' })
  })

  test('a client that cancels the stream does not leave a stored summary', async () => {
    const save = vi.fn()
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    await readable.cancel('client closed')

    await serviceWith(streamDeltas(['# Title\n'])).bookmarkSummary(ctx as never, 'article', writable, save)

    expect(save).not.toHaveBeenCalled()
  })
})

describe('generateOutline reports whether generation completed', () => {
  test('completed is false when the provider fails mid-stream', async () => {
    const chunks: unknown[] = []
    const result = await serviceWith(streamDeltas(['# Partial'], true)).generateOutline(ctx as never, 'article', async chunk => {
      chunks.push(chunk)
    })

    expect(result.completed).toBe(false)
    expect(chunks).toContainEqual({ content: '# Partial' })
  })

  test('completed is true for a full stream', async () => {
    const result = await serviceWith(streamDeltas(['# Done'])).generateOutline(ctx as never, 'article', async () => {})

    expect(result).toEqual({ model: 'gemini-3-flash-preview', completed: true })
  })
})

describe('outline stream persists only a completed outline', () => {
  const orchestratorWith = (generateOutline: AigcService['generateOutline']) => {
    const bookmarkService = {
      getBookmarkId: vi.fn().mockResolvedValue(42),
      getUserBookmarkSummary: vi.fn().mockResolvedValue(null),
      getBookmarkById: vi.fn().mockResolvedValue({ id: 42, content_key: 'k', content_md_key: 'md', target_url: 'https://example.com/a', moderation_result: 0 }),
      getUserBookmark: vi.fn().mockResolvedValue({ id: 1 }),
      getBookmarkContent: vi.fn().mockResolvedValue('article'),
      saveSummary: vi.fn().mockResolvedValue(undefined)
    }
    const userService = { getUserInfo: vi.fn().mockResolvedValue({ ai_lang: 'zh' }) }
    const orchestrator = new BookmarkOrchestrator(
      bookmarkService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { generateOutline } as never,
      userService as never,
      (() => ({})) as never
    )
    return { orchestrator, bookmarkService }
  }

  const run = async (orchestrator: BookmarkOrchestrator) => {
    const stream = captureWriter()
    await orchestrator.generateBookmarkOutlineStream(createMockCtx({ userId: 7 }) as never, {
      bmId: 42,
      writer: stream.writer.getWriter(),
      encoder: new TextEncoder(),
      isForce: false
    })
    return stream
  }

  test.each(['', '  \n'])('a stored empty outline %j is treated as a miss and generated again', async stored => {
    const generateOutline = vi.fn(async (_ctx: unknown, _content: string, callback: (chunk: { content: string }) => Promise<void>) => {
      await callback({ content: '# Fresh' })
      return { model: 'gemini-3-flash-preview', completed: true }
    })
    const { orchestrator, bookmarkService } = orchestratorWith(generateOutline as never)
    bookmarkService.getUserBookmarkSummary.mockResolvedValue({ content: stored })

    await run(orchestrator)

    expect(generateOutline).toHaveBeenCalled()
    expect(bookmarkService.saveSummary).toHaveBeenCalledWith(expect.anything(), 42, 'gemini-3-flash-preview', '# Fresh', 'gemini-3-flash-preview')
  })

  test('a failed generation streams its progress but is not saved', async () => {
    const { orchestrator, bookmarkService } = orchestratorWith(async (_ctx, _content, callback) => {
      await callback({ content: '# Partial' })
      return { model: 'gemini-3-flash-preview', completed: false }
    })

    await run(orchestrator)

    expect(bookmarkService.saveSummary).not.toHaveBeenCalled()
  })

  test('a completed outline is saved', async () => {
    const { orchestrator, bookmarkService } = orchestratorWith(async (_ctx, _content, callback) => {
      await callback({ content: '# Full' })
      return { model: 'gemini-3-flash-preview', completed: true }
    })

    await run(orchestrator)

    expect(bookmarkService.saveSummary).toHaveBeenCalledWith(expect.anything(), 42, 'gemini-3-flash-preview', '# Full', 'gemini-3-flash-preview')
  })
})

describe('stored empty summaries are not served as results', () => {
  test('the summary list omits empty rows so the client generates again', async () => {
    const service = Object.create(BookmarkService.prototype) as BookmarkService
    ;(service as any).bookmarkRepo = {
      getBookmarkSummariesRaw: vi.fn().mockResolvedValue([
        { user_id: 7, content: '', updated_at: null },
        { user_id: 9, content: '# Shared', updated_at: null }
      ])
    }

    const list = await service.getBookmarkSummaries(createMockCtx({ userId: 7, lang: 'zh' }) as never, 42)

    expect(list).toEqual([{ content: '# Shared', updated_at: null, is_self: false }])
  })

  test('the summary list is empty when only an empty row exists', async () => {
    const service = Object.create(BookmarkService.prototype) as BookmarkService
    ;(service as any).bookmarkRepo = { getBookmarkSummariesRaw: vi.fn().mockResolvedValue([{ user_id: 7, content: '', updated_at: null }]) }

    expect(await service.getBookmarkSummaries(createMockCtx({ userId: 7, lang: 'zh' }) as never, 42)).toEqual([])
  })

  test('a whitespace-only owner outline is not served', async () => {
    const service = Object.create(BookmarkService.prototype) as BookmarkService
    ;(service as any).bookmarkRepo = { getBookmarkOutline: vi.fn().mockResolvedValue({ content: '  \n' }) }

    expect(await service.getBookmarkOutline(42, 7)).toBeNull()
  })

  test('the owner outline lookup skips empty rows', async () => {
    const { BookmarkRepo } = await import('@/infra/repository/dbBookmark')
    const findFirst = vi.fn().mockResolvedValue(null)
    const repo = new BookmarkRepo({} as never, (() => ({ sr_bookmark_summary: { findFirst } })) as never)

    await repo.getBookmarkOutline(42, 7)

    expect(findFirst).toHaveBeenCalledWith({ where: { bookmark_id: 42, user_id: 7, content: { not: '' } }, orderBy: { id: 'desc' } })
  })
})

describe('POST /v1/aigc/summaries recovers after a failed generation', () => {
  /** The real controller and service over real streams; only the provider and storage are faked. */
  const wire = async (chatStream: { current: DeltaStream }) => {
    const { AigcController } = await import('@/handler/http/aigcController')
    const stored = new Map<string, string>()
    const bookmarkService = {
      getUserBookmarkSummary: vi.fn(async () => (stored.has('42') ? { content: stored.get('42')! } : null)),
      getBookmarkTitleContent: vi.fn(async () => ({ title: 'T', content: 'article', bmId: 42, targetUrl: '', moderationResult: 0 })),
      saveSummary: vi.fn(async (_ctx: unknown, bmId: number, _provider: string, content: string) => {
        stored.set(String(bmId), content)
      })
    }
    const aigcService = new AigcService(
      (() => ({ chatStream: (...args: Parameters<DeltaStream>) => chatStream.current(...args) })) as never,
      (() => ({})) as never,
      {} as never,
      {} as never
    )
    const userService = { getUserInfo: vi.fn().mockResolvedValue({ ai_lang: 'zh', lang: 'zh' }) }
    const controller = new AigcController(aigcService, userService as never, bookmarkService as never, {} as never)
    return { controller, stored, bookmarkService }
  }

  const request = () =>
    ({
      json: () => Promise.resolve({ bookmark_uid: 'bm-uuid', force: false }),
      clone() {
        return this
      },
      url: 'https://api.test/v1/aigc/summaries',
      cf: {},
      headers: { get: () => '' }
    }) as unknown as Request

  const call = async (controller: { handleSummariesRequest: (ctx: never, req: Request) => Promise<Response> }) => {
    const pending: Promise<unknown>[] = []
    const ctx = { ...createMockCtx({ userId: 7 }), execution: { waitUntil: (p: Promise<unknown>) => pending.push(p) } }
    const response = await controller.handleSummariesRequest(ctx as never, request())
    const body = await response.text()
    await Promise.all(pending)
    return body
  }

  test('a failed first request leaves nothing cached, and the next request generates and caches', async () => {
    const chatStream = { current: streamDeltas(['# Partial'], true) }
    const { controller, stored, bookmarkService } = await wire(chatStream)

    const failedBody = await call(controller)
    expect(failedBody).toContain('# Partial')
    expect(stored.size).toBe(0)

    chatStream.current = streamDeltas(['# Outline\n', '- point [1](#source)\n'])
    const freshBody = await call(controller)

    expect(freshBody).toBe('# Outline\n- point [1](#source)\n')
    expect(stored.get('42')).toBe(freshBody)
    expect(bookmarkService.getBookmarkTitleContent).toHaveBeenCalledTimes(2)

    // The next request is served from the cache without generating again
    expect(await call(controller)).toBe(freshBody)
    expect(bookmarkService.getBookmarkTitleContent).toHaveBeenCalledTimes(2)
  })

  test('a previously stored empty row is regenerated and replaced', async () => {
    const chatStream = { current: streamDeltas(['# Outline\n']) }
    const { controller, stored } = await wire(chatStream)
    stored.set('42', '')

    expect(await call(controller)).toBe('# Outline\n')
    expect(stored.get('42')).toBe('# Outline\n')
  })
})
