import { getRequestHeader, getRequestURL, readBody, setCookie, setResponseHeader, setResponseStatus } from 'h3'

// WebKit caps cookies written through document.cookie to 1 or 7 days, so the login cookie
// is issued in an HTTP response. The exact Origin check stops other sites from setting a session.
export default defineEventHandler(async event => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const url = getRequestURL(event)
  const token = getRequestHeader(event, 'origin') === url.origin ? (await readBody(event).catch(() => null))?.token : null
  if (typeof token !== 'string' || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
    setResponseStatus(event, 400)
    return null
  }
  const config = useRuntimeConfig(event).public
  setCookie(event, config.COOKIE_TOKEN_NAME as string, token, {
    domain: (config.COOKIE_DOMAIN as string) || undefined,
    maxAge: 60 * 24 * 60 * 60,
    sameSite: 'lax',
    secure: url.protocol === 'https:'
  })
  setResponseStatus(event, 204)
  return null
})
