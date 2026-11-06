import { parseHybridSearchRequest, type HybridSearchEvent } from '@slax-reader/contracts'
import { Controller } from '@/decorators/controller'
import { inject } from '@/decorators/di'
import { Post } from '@/decorators/route'
import { ErrorParam, UnauthorizedError } from '@/const/err'
import { HybridSearchOrchestrator } from '@/domain/orchestrator/hybridSearch'
import { ContextManager } from '@/utils/context'
import { Failed } from '@/utils/responseUtils'
import { corsHeader } from '@/middleware/cors'

export const MAX_SEARCH_BODY_BYTES = 16 * 1024

@Controller('/v1/search')
export class SearchController {
  constructor(@inject(HybridSearchOrchestrator) private search: HybridSearchOrchestrator) {}

  @Post('')
  public async searchStream(ctx: ContextManager, request: Request) {
    const userId = ctx.getUserId()
    if (!Number.isSafeInteger(userId) || userId <= 0) return Failed(UnauthorizedError())
    if (new URL(request.url).search || Number(request.headers.get('content-length') || 0) > MAX_SEARCH_BODY_BYTES) return Failed(ErrorParam())
    let body: unknown
    try {
      const reader = request.body?.getReader()
      if (!reader) return Failed(ErrorParam())
      const decoder = new TextDecoder()
      let text = ''
      let bytes = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > MAX_SEARCH_BODY_BYTES) {
            await reader.cancel()
            return Failed(ErrorParam())
          }
          text += decoder.decode(value, { stream: true })
        }
      } finally {
        reader.releaseLock()
      }
      body = JSON.parse(text + decoder.decode())
    } catch {
      return Failed(ErrorParam())
    }
    const input = parseHybridSearchRequest(body)
    if (!input) return Failed(ErrorParam())

    const abort = new AbortController()
    const encoder = new TextEncoder()
    let work: Promise<void> = Promise.resolve()
    let closed = false
    let stop: () => void = () => abort.abort()
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        const close = () => {
          if (closed) return
          closed = true
          try {
            controller.close()
          } catch {}
        }
        stop = () => {
          abort.abort()
          close()
        }
        const emit = (event: HybridSearchEvent) => {
          if (closed || abort.signal.aborted) return
          try {
            const payload: HybridSearchEvent =
              event.type === 'channel_error'
                ? event
                : {
                    ...event,
                    results: event.results.map(hit =>
                      hit.type === 'article'
                        ? {
                            ...hit,
                            origins: hit.origins.map(origin => (origin.kind === 'collection' ? { ...origin, cb_id: ctx.hashIds.encodeId(origin.cb_id) } : origin))
                          }
                        : hit
                    )
                  }
            controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`))
          } catch {
            stop()
          }
        }
        request.signal.addEventListener('abort', stop, { once: true })
        if (request.signal.aborted) stop()
        work = this.search
          .stream(ctx, input, abort.signal, emit)
          .catch(() => {
            if (!closed) {
              closed = true
              controller.error(new Error('search_stream_failed'))
            }
            abort.abort()
          })
          .finally(() => {
            request.signal.removeEventListener('abort', stop)
            close()
          })
      },
      cancel: () => {
        closed = true
        stop()
        return work
      }
    })
    ctx.deferCleanupUntil(work)
    return new Response(stream, {
      headers: {
        ...corsHeader,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'private, no-store, no-transform',
        'X-Accel-Buffering': 'no'
      }
    })
  }
}
