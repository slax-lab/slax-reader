import { digestOAuthState, normalizeOAuthContext, oauthCookieName, oauthCookieOptions, oauthRedirectUri, readOAuthState } from '../../../shared/utils/oauthState'
import { readIssuedWebToken, requestWebSession, sessionCookieName, setWebSession, webSessionConfig } from '../../utils/webSession'

import { RESTMethodPath } from '@slax-reader/contracts/const'
import { defineEventHandler, deleteCookie, getCookie, getHeader, type H3Event, readRawBody, sendNoContent, setResponseHeader, setResponseStatus } from 'h3'
import { z } from 'zod'

const sessionRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('login'), code: z.string().min(1), state: z.string().min(1) }),
  z.strictObject({ action: z.literal('refresh') })
])

type Exchange =
  | { action: 'login'; body: string; bindingName: string; target: string }
  | { action: 'refresh'; authorization: string; account: string }

function reject(event: H3Event, status: number, error: string) {
  setResponseStatus(event, status)
  return { error }
}

export default defineEventHandler(async event => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const config = webSessionConfig(event)
  const reader = new URL(String(config.PUBLIC_BASE_URL))
  if (getHeader(event, 'origin') !== reader.origin) return reject(event, 403, 'origin')

  const media = getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  if (media !== 'application/json') return reject(event, 415, 'content-type')

  const raw = await readRawBody(event)
  let body: unknown
  try {
    body = JSON.parse(raw ?? '')
  } catch {
    return reject(event, 400, 'request')
  }
  const parsed = sessionRequest.safeParse(body)
  if (!parsed.success) return reject(event, 400, 'request')

  const secure = reader.protocol === 'https:'
  let exchange: Exchange
  if (parsed.data.action === 'login') {
    const { code, state } = parsed.data
    const attempt = readOAuthState(state)
    if (!attempt) return reject(event, 400, 'state')

    const bindingName = oauthCookieName(attempt.nonce, secure)
    if (getCookie(event, bindingName) !== await digestOAuthState(state)) return reject(event, 400, 'state')

    const context = normalizeOAuthContext(attempt, reader.origin)
    exchange = {
      action: 'login',
      bindingName,
      target: context.target,
      body: JSON.stringify({
        code,
        type: context.platform,
        client_id: context.platform === 'apple' ? config.APPLE_OAUTH_CLIENT_ID : config.GOOGLE_OAUTH_CLIENT_ID,
        redirect_uri: oauthRedirectUri(String(config.AUTH_BASE_URL)),
        aff_code: context.affCode,
        auth_attribution: context.auth_attribution
      })
    }
  } else {
    const cookie = getCookie(event, sessionCookieName(event))
    const authorization = getHeader(event, 'authorization')
    if (!cookie || authorization !== `Bearer ${cookie}`) return reject(event, 409, 'session-changed')
    const current = readIssuedWebToken(cookie)
    if (!current) return reject(event, 401, 'unauthorized')
    exchange = { action: 'refresh', authorization, account: current.account }
  }

  const requestSignal: AbortSignal | undefined = event.context.cloudflare?.request?.signal ?? event.web?.request?.signal
  const response = event.node.res
  const disconnect = new AbortController()
  const onClose = () => disconnect.abort()
  if (response.destroyed) onClose()
  response.once('close', onClose)
  const deadline = AbortSignal.timeout(exchange.action === 'login' ? 20_000 : 5_000)
  const signal = AbortSignal.any(requestSignal ? [requestSignal, disconnect.signal, deadline] : [disconnect.signal, deadline])
  let token: unknown
  try {
    signal.throwIfAborted()
    const upstream = exchange.action === 'login'
      ? await requestWebSession(event, RESTMethodPath.LOGIN, { signal, body: exchange.body })
      : await requestWebSession(event, RESTMethodPath.TOKEN_REFRESH, { signal, headers: { Authorization: exchange.authorization } })
    const result = upstream.status === 200
      ? await upstream.json() as { code?: number; data?: { token?: unknown } } | null
      : null
    signal.throwIfAborted()
    if (exchange.action === 'refresh' && (upstream.status === 401 || result?.code === 401)) return reject(event, 401, 'unauthorized')
    if (result?.code === 200) token = result.data?.token
  } catch {
    if (requestSignal?.aborted || disconnect.signal.aborted) return reject(event, 499, 'canceled')
    if (deadline.aborted) return reject(event, 504, 'timeout')
    return reject(event, 502, 'exchange')
  } finally {
    response.off('close', onClose)
  }

  const issued = readIssuedWebToken(token)
  if (!issued || (exchange.action === 'refresh' && issued.account !== exchange.account)) return reject(event, 502, 'exchange')

  setWebSession(event, issued.token)
  if (exchange.action === 'refresh') return sendNoContent(event)
  deleteCookie(event, exchange.bindingName, oauthCookieOptions(secure))
  return { target: exchange.target }
})
