import {parseDesktopAuthIntent, desktopConsentPath, type DesktopAuthIntent} from '@slax-reader/contracts/desktop-auth'

const STORAGE_KEY = 'slax.desktop.oauth.v1'
const LIFETIME = 10 * 60 * 1000
interface Pending {intent: DesktopAuthIntent; nonce: string; provider: 'google' | 'apple'; redirectUri: string; createdAt: number}
export function desktopIntentFromPath(path: string): DesktopAuthIntent | null {
  if (!path.startsWith('/login?')) return null
  const url = new URL(path, 'https://desktop-intent.invalid')
  if (url.pathname !== '/login' || url.hash) return null
  const query: Record<string, unknown> = {}
  for (const key of url.searchParams.keys()) query[key] = url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : null
  return parseDesktopAuthIntent(query)
}
export function startDesktopOAuth(path: string, provider: 'google' | 'apple', redirectUri: string,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = sessionStorage, now = Date.now()): Record<string, unknown> | null {
  const intent = desktopIntentFromPath(path)
  if (!intent) {storage.removeItem(STORAGE_KEY); return null}
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('')
  storage.setItem(STORAGE_KEY, JSON.stringify({intent, nonce, provider, redirectUri, createdAt: now} satisfies Pending))
  return {nonce, desktop: 1, platform: provider}
}
export function takeDesktopOAuth(state: unknown, storage: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage, now = Date.now()): Pending {
  const pendingRaw = storage.getItem(STORAGE_KEY)
  if (!pendingRaw || !state || typeof state !== 'object') throw new Error('Invalid desktop authorization')
  const incoming = state as Record<string, unknown>
  let pending: Pending
  try {pending = JSON.parse(pendingRaw) as Pending} catch {throw new Error('Invalid desktop authorization')}
  if (incoming.nonce !== pending.nonce) throw new Error('Invalid desktop authorization')
  storage.removeItem(STORAGE_KEY)
  if (incoming.desktop !== 1 || incoming.platform !== pending.provider || !parseDesktopAuthIntent({...pending.intent})
    || !Number.isFinite(pending.createdAt) || pending.createdAt > now || now - pending.createdAt >= LIFETIME
    || typeof pending.redirectUri !== 'string') throw new Error('Expired desktop authorization')
  return pending
}
export function clearDesktopOAuth(storage: Pick<Storage, 'removeItem'> = sessionStorage): void {storage.removeItem(STORAGE_KEY)}
export {desktopConsentPath}

export const hasDesktopOAuth = (storage: Pick<Storage, 'getItem'> = sessionStorage): boolean => storage.getItem(STORAGE_KEY) !== null
