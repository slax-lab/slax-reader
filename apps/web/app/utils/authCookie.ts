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
