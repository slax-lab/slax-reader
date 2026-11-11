import { useCookies } from '@vueuse/integrations/useCookies'

type CookieReader = ReturnType<typeof useCookies>

export const configuredCookieName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const name = value.trim()
  return name ? name : undefined
}

export const readStringCookie = (name: unknown, cookies: CookieReader = useCookies()): string | undefined => {
  const validName = configuredCookieName(name)
  if (!validName) return undefined

  const value = cookies.get<unknown>(validName, { doNotParse: true })
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const persistSessionCookie = (token: string, signal?: AbortSignal): Promise<boolean> =>
  fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    signal
  }).then(
    r => r.ok,
    () => false
  )
