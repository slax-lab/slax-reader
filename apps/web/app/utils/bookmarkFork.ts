import { tokenFingerprint } from '~/utils/accountContext'
import { request } from '~/utils/request'

import type { FetchOptions } from '@commons/frontend-utils/request'
import type { AddBookmarkResponse } from '@slax-reader/contracts'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import { isSnapshotAuthAttribution, SNAPSHOT_BOOKMARK_ID_PATTERN, type WebAuthAttribution } from '@slax-reader/contracts/events'
import { useCookies } from '@vueuse/integrations/useCookies'

export function submitBookmarkFork(sourceUuid: string, options: Pick<FetchOptions, 'errorInterceptors' | 'headers' | 'signal'>, snapshotSave = false) {
  return request().post<AddBookmarkResponse>({
    url: RESTMethodPath.ADD_URL_BOOKMARK,
    body: { target_url: new URL(`/b/${sourceUuid}`, String(useRuntimeConfig().public.PUBLIC_BASE_URL)).href, tags: [], ...(snapshotSave ? { snapshot_save: true } : {}) },
    ...options
  })
}

const returnKey = 'slax_save'
const cookieName = (attempt: string) => `slax_save_${attempt}`
const cookieOptions = () => ({
  path: '/',
  domain: String(useRuntimeConfig().public.COOKIE_DOMAIN || '') || undefined,
  sameSite: 'lax' as const,
  secure: location.protocol === 'https:'
})

const feedbackCookieName = (source: string) => `slax_save_feedback_${source}`

export function consumeSnapshotSaveFeedback(source: string, token: string | null | undefined) {
  const cookies = useCookies()
  const name = feedbackCookieName(source)
  const value = cookies.get(name, { doNotParse: true })
  if (!value) return false
  cookies.remove(name, cookieOptions())
  return value === tokenFingerprint(token)
}

// The reader and the provider callback can run on different session-sharing hosts.
export function startSnapshotSave(sourceUuid: string) {
  const attempt = crypto.randomUUID()
  const cookies = useCookies()
  const options = cookieOptions()
  const target = new URL(location.href)
  cookies.set(cookieName(attempt), sourceUuid, { ...options, maxAge: 15 * 60 })
  target.searchParams.delete('save_failed')
  target.searchParams.set(returnKey, attempt)
  return { redirect: target.href, onDismiss: () => cookies.remove(cookieName(attempt), options) }
}

export async function finishSnapshotSave(target: string, attribution: WebAuthAttribution | undefined, token: string, signal: AbortSignal) {
  if (!isSnapshotAuthAttribution(attribution)) return target
  const url = new URL(target, location.origin)
  const attempt = url.searchParams.get(returnKey)
  if (!attempt || !SNAPSHOT_BOOKMARK_ID_PATTERN.test(attempt)) return target
  url.searchParams.delete(returnKey)
  const cookies = useCookies()
  const key = cookieName(attempt)
  if (cookies.get(key, { doNotParse: true }) !== attribution.source_bookmark_id) {
    url.searchParams.set('save_failed', '1')
    return url.href
  }
  cookies.remove(key, cookieOptions())
  signal.throwIfAborted()
  const admission = new AbortController()
  const abort = () => admission.abort()
  const timeout = setTimeout(abort, 20_000)
  signal.addEventListener('abort', abort, { once: true })
  try {
    const accepted = await submitBookmarkFork(attribution.source_bookmark_id, {
      headers: { Authorization: `Bearer ${token}` },
      signal: admission.signal,
      errorInterceptors: () => {}
    }, true)
    if (accepted) cookies.set(feedbackCookieName(attribution.source_bookmark_id), tokenFingerprint(token), { ...cookieOptions(), maxAge: 5 * 60 })
    else url.searchParams.set('save_failed', '1')
  } catch {
    signal.throwIfAborted()
    url.searchParams.set('save_failed', '1')
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
  return url.href
}

export function bindSnapshotEmail(requestId: string, target: string, attribution?: WebAuthAttribution) {
  if (!isSnapshotAuthAttribution(attribution)) return
  const attempt = new URL(target, location.origin).searchParams.get(returnKey)
  if (!attempt || !SNAPSHOT_BOOKMARK_ID_PATTERN.test(attempt)) return
  const cookies = useCookies()
  const key = cookieName(attempt)
  if (cookies.get(key, { doNotParse: true }) !== attribution.source_bookmark_id) return
  const options = { ...cookieOptions(), maxAge: 15 * 60 }
  cookies.set(key, attribution.source_bookmark_id, options)
  cookies.set(`slax_save_email_${requestId}`, attempt, options)
}

export async function finishSnapshotEmail(requestId: string, token: string, signal: AbortSignal) {
  const cookies = useCookies()
  const key = `slax_save_email_${requestId}`
  const attempt = cookies.get(key, { doNotParse: true })
  if (!attempt || !SNAPSHOT_BOOKMARK_ID_PATTERN.test(attempt)) return '/bookmarks'
  cookies.remove(key, cookieOptions())
  const source = cookies.get(cookieName(attempt), { doNotParse: true })
  if (!source || !SNAPSHOT_BOOKMARK_ID_PATTERN.test(source)) return '/bookmarks'
  const target = new URL(`/b/${source}`, String(useRuntimeConfig().public.PUBLIC_BASE_URL))
  target.searchParams.set(returnKey, attempt)
  return finishSnapshotSave(target.href, {
    source_screen: 'detail', presentation: 'modal', trigger_element_id: 'snapshot_save_button', source_bookmark_id: source
  }, token, signal)
}
