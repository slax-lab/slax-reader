import { useCookies } from '@vueuse/integrations/useCookies'

type CookieReader = ReturnType<typeof useCookies>

export const configuredCookieName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const name = value.trim()
  return name ? name : undefined
}

export const requireConfiguredCookieName = (value: unknown): string => {
  const name = configuredCookieName(value)
  if (!name) throw new Error('Invalid auth cookie configuration: COOKIE_TOKEN_NAME must be a non-empty string')
  return name
}

export const readStringCookie = (name: unknown, cookies: CookieReader = useCookies()): string | undefined => {
  const validName = configuredCookieName(name)
  if (!validName) return undefined

  const value = cookies.get<unknown>(validName, { doNotParse: true })
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const setAuthCookie = (cookies: CookieReader, name: unknown, domain: unknown, token: string) => {
  const cookieName = requireConfiguredCookieName(name)
  cookies.set(cookieName, token, {
    path: '/',
    expires: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    ...(typeof domain === 'string' && domain ? { domain } : {})
  })
}
