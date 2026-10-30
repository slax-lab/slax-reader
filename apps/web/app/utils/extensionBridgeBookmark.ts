import type { BookmarkExistsResponse } from '@slax-reader/contracts'
import { requestExtensionBridgeSession } from './extensionBridgeSession'
import { getTokenUserId } from './sessionOwner'

type ReaderLookupOptions = {
  apiBaseUrl: string
  targetUrl: string
  userKey: string | null
  getUserKey: () => string | null
  sessionPolicy: Parameters<typeof requestExtensionBridgeSession>[0]
}

/** The offscreen frame cannot rely on Web cookies or redirect to the Web login page. */
export async function lookupExtensionReaderBookmark(options: ReaderLookupOptions): Promise<BookmarkExistsResponse | null> {
  const token = await requestExtensionBridgeSession(options.sessionPolicy)
  const sameOwner = () => !!options.userKey && options.getUserKey() === options.userKey
  if (!token || !sameOwner() || getTokenUserId(token) !== options.userKey) return null

  const response = await fetch(`${options.apiBaseUrl.replace(/\/$/, '')}/v1/bookmark/exists`, {
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ target_url: options.targetUrl }),
    signal: AbortSignal.timeout(8_000)
  })
  if (!response.ok || !sameOwner()) return null
  const result = await response.json() as { code: number; data?: BookmarkExistsResponse }
  return sameOwner() && result.code === 200 ? result.data ?? null : null
}
