import type { ContextManager } from '@/utils/context'
import { DESKTOP_AUTH_PATHS } from '@slax-reader/contracts/desktop-auth'
import { DesktopAuthError } from '@/domain/desktopAuthPolicy'
import { desktopDeployment, isLocalDesktopDeployment } from '@/domain/desktopAuthConfig'
import { corsHeader } from './cors'

// Wrangler development may not have a deployed rate-limit binding. Keep a bounded
// per-isolate limiter for the loopback development environment only.
const localWindows = new Map<string, { count: number; reset: number }>()
function limitLocal(key: string): void {
  const now = Date.now()
  for (const [id, value] of localWindows) if (value.reset <= now) localWindows.delete(id)
  let window = localWindows.get(key)
  if (!window) {
    if (localWindows.size >= 1024) throw new DesktopAuthError(429, 'DESKTOP_AUTH_RATE_LIMITED')
    window = { count: 0, reset: now + 60000 }
    localWindows.set(key, window)
  }
  if (++window.count > 20) throw new DesktopAuthError(429, 'DESKTOP_AUTH_RATE_LIMITED')
}

export async function limitDesktopAuth(request: Request, ctx: ContextManager): Promise<void> {
  const path = new URL(request.url).pathname
  if (path !== DESKTOP_AUTH_PATHS.code && path !== DESKTOP_AUTH_PATHS.exchange) return
  desktopDeployment(ctx.env)
  if (request.method !== 'POST') throw new DesktopAuthError(405, 'DESKTOP_AUTH_METHOD')
  const limiter = ctx.env.DESKTOP_AUTH_RATE_LIMITER
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const key = path === DESKTOP_AUTH_PATHS.code ? `desktop-code:${ctx.getUserId()}:${ip}` : `desktop-exchange:${ip}`
  if (!limiter) {
    if (!isLocalDesktopDeployment(ctx.env)) throw new DesktopAuthError(503, 'DESKTOP_AUTH_UNAVAILABLE')
    limitLocal(key)
    return
  }
  if (!(await limiter.limit({ key })).success) throw new DesktopAuthError(429, 'DESKTOP_AUTH_RATE_LIMITED')
}
export const desktopAuthHeaders = { ...corsHeader, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' }
export function desktopAuthResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, code: status, message: status === 200 ? 'ok' : 'Desktop authorization failed' }), { status, headers: desktopAuthHeaders })
}
export async function desktopAuthBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.split(';')[0].trim().toLowerCase().endsWith('/json')) throw new DesktopAuthError(400, 'DESKTOP_AUTH_INVALID')
  const reader = request.body?.getReader()
  if (!reader) throw new DesktopAuthError(400, 'DESKTOP_AUTH_INVALID')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 2048) {
        await reader.cancel()
        throw new DesktopAuthError(413, 'DESKTOP_AUTH_INVALID')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
    const keys = [...text.matchAll(/"(?:\\.|[^"\\])*"\s*:/g)].map(match => JSON.parse(match[0].slice(0, match[0].lastIndexOf(':')).trim()) as string)
    if (new Set(keys).size !== keys.length) throw new DesktopAuthError(400, 'DESKTOP_AUTH_INVALID')
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof DesktopAuthError) throw error
    throw new DesktopAuthError(400, 'DESKTOP_AUTH_INVALID')
  } finally {
    reader.releaseLock()
  }
}
