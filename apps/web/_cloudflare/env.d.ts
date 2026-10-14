/// <reference types="../worker-configuration.d.ts" />
// Migration: describe the Web-facing RPC surface without importing a sibling checkout.
interface ContentBackend {
  fetch: Fetcher['fetch']
  getBookmarkUserUuidByShareCode(code: string): Promise<string | undefined>
  trackEvent(input: {
    event: string
    target: string
    token?: string
    visitorId?: string
    userAgent?: string
    durationMs?: number
    statusCode?: number
    isOwner?: boolean
    extra?: Record<string, unknown>
  }): Promise<void>
}

interface Env {
  OSS: R2Bucket
  BACKEND: ContentBackend
}

declare module 'h3' {
  interface H3EventContext {
    cf: CfProperties
    cloudflare: {
      request: Request
      env: Env
      context: ExecutionContext
    }
  }
}

export {}
