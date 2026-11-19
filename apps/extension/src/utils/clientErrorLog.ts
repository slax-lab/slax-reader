import { createErrorCollector, installGlobalErrorCapture, type ErrorCollector } from '@commons/frontend-utils/errorLog'

import type { App } from 'vue'

export type ExtensionErrorContext = 'background' | 'offscreen' | 'page'

const tokenUserId = (token: string | null): string | undefined => {
  if (!token) return undefined
  try {
    const payload = token.split('.')[1]
    if (!payload) return undefined
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as { id?: unknown }
    return typeof claims.id === 'number' || typeof claims.id === 'string' ? String(claims.id) : undefined
  } catch {
    return undefined
  }
}

// Loaded on first delivery so entry points without Vue (background, offscreen) do not import it at startup.
const readIdentity = async () => {
  const { getCurrentSessionToken, getExtensionDeviceId } = await import('./session')
  const [token, deviceId] = await Promise.all([getCurrentSessionToken().catch(() => null), getExtensionDeviceId().catch(() => undefined)])
  return { userId: tokenUserId(token), deviceId }
}

let collector: ErrorCollector | undefined

/** The context's error collector; a disabled no-op when the build has no ingestion endpoint. */
export const getClientErrorLog = (context: ExtensionErrorContext = 'page'): ErrorCollector =>
  (collector ||= createErrorCollector({
    endpoint: process.env.CLIENT_ERROR_INGEST_URL,
    app: 'extension',
    release: process.env.VERSION || '',
    env: process.env.SLAX_ENV || '',
    baseProperties: { context },
    getContext: () => readIdentity().catch(() => ({}))
  }))

/** Installs uncaught-error and rejection capture for an extension service worker, offscreen document, or page. */
export const installClientErrorLog = (context: ExtensionErrorContext): ErrorCollector => {
  const errors = getClientErrorLog(context)
  // A service worker has no document, so its queue drains on the flush timer rather than on page hide.
  if (errors.enabled) installGlobalErrorCapture(errors)
  return errors
}

/** Records Vue errors in an extension page while preserving the console output Vue would otherwise produce. */
export const captureVueErrors = (app: App): void => {
  const errors = getClientErrorLog()
  if (!errors.enabled) return
  const previous = app.config.errorHandler
  app.config.errorHandler = (error, instance, info) => {
    errors.capture('vue', error, { source: 'vue', info, component: instance?.$options?.name || instance?.$options?.__name })
    if (previous) previous(error, instance, info)
    else console.error(error)
  }
}
