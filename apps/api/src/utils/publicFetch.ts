import { publicTarget, PublicTargetError } from './publicTargetPolicy'

export interface PublicFetchOptions {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  followRedirects?: boolean
}

export type PublicTransport = (url: string, init: RequestInit) => Promise<Response>

const redirectStatuses = new Set([301, 302, 303, 307, 308])
const crossOriginHeaders = new Set(['accept', 'accept-language', 'accept-encoding', 'user-agent', 'range', 'if-range'])

// Production requires Workers global_fetch_strictly_public. URL checks cannot pin DNS or prevent rebinding.
export const createPublicFetch =
  (transport: PublicTransport) =>
  async (input: string | URL, init: RequestInit = {}, options: PublicFetchOptions = {}): Promise<Response> => {
    let target = publicTarget(input)
    const controller = new AbortController()
    const maxBytes = options.maxBytes ?? 10 * 1024 * 1024
    const timeoutMs = options.timeoutMs ?? 30_000
    let timedOut: (reason: Error) => void = () => {}
    const deadline = new Promise<never>((_, reject) => {
      timedOut = reject
    })
    // The deadline also bounds transports/readers that do not honor AbortSignal.
    void deadline.catch(() => {})
    const abort = () => {
      const error = new Error('Public fetch aborted or timed out')
      controller.abort(error)
      timedOut(error)
    }
    const timer = setTimeout(abort, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      init.signal?.removeEventListener('abort', abort)
    }
    init.signal?.addEventListener('abort', abort, { once: true })
    if (init.signal?.aborted) abort()
    let headers = new Headers(init.headers)
    let method = init.method ?? 'GET'
    let body = init.body
    try {
      for (let hop = 0; ; hop++) {
        const response = await Promise.race([transport(target.href, { ...init, method, body, headers, redirect: 'manual', signal: controller.signal }), deadline])
        try {
          if (response.url) publicTarget(response.url)
        } catch (error) {
          void response.body?.cancel().catch(() => {})
          throw error
        }
        if (response.redirected) {
          void response.body?.cancel().catch(() => {})
          throw new PublicTargetError('Transport must not automatically follow redirects')
        }
        const location = response.headers.get('Location')
        if (redirectStatuses.has(response.status) && location) {
          let next: URL
          try {
            next = publicTarget(new URL(location, target))
          } catch (error) {
            void response.body?.cancel().catch(() => {})
            throw error
          }
          void response.body?.cancel().catch(() => {})
          if (options.followRedirects === false) {
            cleanup()
            const headers = new Headers(response.headers)
            headers.set('Location', next.href)
            headers.delete('content-length')
            headers.delete('content-encoding')
            headers.delete('transfer-encoding')
            const result = new Response(null, { status: response.status, statusText: response.statusText, headers })
            Object.defineProperty(result, 'url', { value: target.href })
            return result
          }
          if (hop >= (options.maxRedirects ?? 5)) throw new PublicTargetError('Too many redirects')
          if (next.origin !== target.origin) headers = new Headers([...headers].filter(([name]) => crossOriginHeaders.has(name)))
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && method.toUpperCase() === 'POST')) {
            method = 'GET'
            body = undefined
            headers.delete('content-type')
            headers.delete('content-length')
          } else if (body && next.origin !== target.origin) {
            throw new PublicTargetError('Cross-origin request body redirect is not allowed')
          }
          target = next
          continue
        }
        if (!response.body) {
          cleanup()
          return response
        }
        const reader = response.body.getReader()
        let size = 0
        let finished = false
        const cancel = (reason?: unknown) => {
          if (finished) return
          finished = true
          cleanup()
          void reader.cancel(reason).catch(() => {})
        }
        const stream = new ReadableStream<Uint8Array>(
          {
            start(streamController) {
              void deadline.catch(error => {
                if (!finished) {
                  cancel(error)
                  streamController.error(error)
                }
              })
            },
            async pull(streamController) {
              try {
                const { done, value } = await Promise.race([reader.read(), deadline])
                if (finished) return
                if (done) {
                  finished = true
                  cleanup()
                  reader.releaseLock()
                  streamController.close()
                  return
                }
                size += value.byteLength
                if (size > maxBytes) throw new Error('Public fetch body exceeds byte budget')
                streamController.enqueue(value)
              } catch (error) {
                if (!finished) {
                  cancel(error)
                  controller.abort(error)
                  streamController.error(error)
                }
              }
            },
            cancel
          },
          { highWaterMark: 0 }
        )
        const result = new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers })
        Object.defineProperty(result, 'url', { value: target.href })
        return result
      }
    } catch (error) {
      controller.abort(error)
      cleanup()
      throw error
    }
  }

export const publicFetch = createPublicFetch((url, init) => fetch(url, init))
