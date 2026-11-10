import { oauthAttemptCookie, oauthStateDigest } from '../../../app/utils/oauthAttempt'

import { defineEventHandler, deleteCookie, getCookie, getHeader, readRawBody, sendNoContent, setCookie, setHeader } from 'h3'
import { z } from 'zod'

const jwt = z.string().regex(/^[\w-]+\.[\w-]+\.[\w-]+$/).refine(token => token.split('.').every(segment => segment.length % 4 !== 1))
const sessionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('login'), token: jwt, state: z.string().min(1) }),
  z.object({ action: z.literal('refresh'), token: jwt })
])

const tokenAccount = (token: string) => {
  try {
    const [, payload] = token.split('.')
    if (!payload) return undefined
    const part = payload.replace(/-/g, '+').replace(/_/g, '/')
    const { id, exp } = JSON.parse(atob(part))
    return typeof id === 'string' && /^[0-9]+$/.test(id) && Number.isFinite(exp) && exp > Date.now() / 1000 ? id : undefined
  } catch {
    return undefined
  }
}

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  const config = useRuntimeConfig(event).public
  const origin = new URL(String(config.PUBLIC_BASE_URL))
  if (getHeader(event, 'origin') !== origin.origin) return sendNoContent(event, 403)
  if (getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return sendNoContent(event, 415)

  const body = await readRawBody(event).then(raw => sessionBody.safeParse(JSON.parse(raw ?? ''))).catch(() => undefined)
  if (!body?.success) return sendNoContent(event, 400)
  const input = body.data
  const account = tokenAccount(input.token)
  if (!account) return sendNoContent(event, 400)

  const secure = origin.protocol === 'https:'
  const attempt = oauthAttemptCookie(secure)
  const cookieName = typeof config.COOKIE_TOKEN_NAME === 'string' ? config.COOKIE_TOKEN_NAME.trim() : ''
  if (!cookieName) return sendNoContent(event, 500)
  if (input.action === 'login') {
    const binding = getCookie(event, attempt)
    if (!binding || binding !== await oauthStateDigest(input.state)) return sendNoContent(event, 400)
  } else {
    const current = getCookie(event, cookieName)
    if (!current || getHeader(event, 'authorization') !== `Bearer ${current}` || tokenAccount(current) !== account) return sendNoContent(event, 409)
  }

  setCookie(event, cookieName, input.token, {
    path: '/',
    domain: config.COOKIE_DOMAIN || undefined,
    expires: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    secure
  })
  if (input.action === 'login') deleteCookie(event, attempt, { path: '/', secure, sameSite: 'lax' })
  return sendNoContent(event)
})
