import { isServerTimingEnabled } from './serverTiming'
import { createError, getCookie, getResponseHeader, type H3Event, setResponseHeader } from 'h3'

export interface ContentResult {
  metadata: ContentMeta
  body: string | null
}

type ContentMeta = { content_key?: string | null; [key: string]: unknown }

function elapsedMs(startedAt: number): number {
  return performance.now() - startedAt
}

function appendServerTiming(event: H3Event, step: string, durationMs: number): void {
  const metric = `front_${step};dur=${Math.max(0, durationMs).toFixed(1)}`
  const current = getResponseHeader(event, 'Server-Timing')

  setResponseHeader(event, 'Server-Timing', current ? `${String(current)}, ${metric}` : metric)
}

export async function loadContent(event: H3Event, uuid: string): Promise<ContentResult> {
  const totalStartedAt = performance.now()
  const timingEnabled = isServerTimingEnabled(event)
  const timings: Record<string, number> = {}
  // 窄化取 OSS/BACKEND，绕开 cloudflare.env 递归类型
  const { OSS, BACKEND } = event.context.cloudflare.env as unknown as {
    OSS: { get: (key: string) => Promise<{ text: () => Promise<string> } | null> }
    BACKEND: { fetch: (input: string, init?: RequestInit) => Promise<Response> }
  }
  const config = useRuntimeConfig(event)
  const token = getCookie(event, config.public.COOKIE_TOKEN_NAME as string)

  const backendHeaders: Record<string, string> = {}
  if (token) backendHeaders.Authorization = `Bearer ${token}`

  const bodyPromise = (async (): Promise<string | null> => {
    const startedAt = performance.now()
    const contentBody = await OSS.get(`html/body/${uuid}.html`).finally(() => {
      timings['r2-get'] = elapsedMs(startedAt)
    })

    if (!contentBody) return null

    const bodyStartedAt = performance.now()
    try {
      return await contentBody.text()
    } finally {
      timings['r2-body'] = elapsedMs(bodyStartedAt)
    }
  })()

  const backendPromise = (async (): Promise<ContentMeta | null> => {
    const fetchStartedAt = performance.now()
    const response = await BACKEND.fetch(`https://content.internal/content/meta?uuid=${encodeURIComponent(uuid)}`, {
      headers: backendHeaders
    })
    timings['backend-fetch'] = elapsedMs(fetchStartedAt)

    const serverTiming = response.headers.get('Server-Timing')
    if (timingEnabled && serverTiming) setResponseHeader(event, 'Server-Timing', serverTiming)

    if (response.status === 404) return null
    if (!response.ok) throw new Error(`content meta returned ${response.status}`)

    const parseStartedAt = performance.now()
    try {
      return (await response.json()) as ContentMeta
    } finally {
      timings['backend-json'] = elapsedMs(parseStartedAt)
    }
  })()

  try {
    const [bodyResult, metaResult] = await Promise.allSettled([bodyPromise, backendPromise])

    if (metaResult.status === 'rejected') {
      console.error(`[content] get ${uuid} failed to load metadata from BACKEND:`, metaResult.reason)
      throw createError({ statusCode: 500, message: 'content service error' })
    }
    const metadata = metaResult.value
    if (!metadata) {
      throw createError({ statusCode: 404, message: 'not found' })
    }

    let body = bodyResult.status === 'fulfilled' ? bodyResult.value : null
    if (bodyResult.status === 'rejected') {
      console.error(`[content] get ${uuid} failed to load body from R2:`, bodyResult.reason)
    }

    if (!body && metadata.content_key) {
      try {
        const fallbackStartedAt = performance.now()
        const contentBody = await OSS.get(metadata.content_key)
        timings['r2-fallback-get'] = elapsedMs(fallbackStartedAt)
        if (contentBody) {
          const fallbackBodyStartedAt = performance.now()
          body = await contentBody.text()
          timings['r2-fallback-body'] = elapsedMs(fallbackBodyStartedAt)
        }
      } catch (error) {
        console.error(`[content] get ${uuid} failed to load body from content_key ${metadata.content_key}:`, error)
      }
    }

    return { metadata, body }
  } finally {
    if (timingEnabled) {
      timings.total = elapsedMs(totalStartedAt)
      for (const [step, duration] of Object.entries(timings)) appendServerTiming(event, step, duration)
    }
  }
}
