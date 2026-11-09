import { digestOAuthState, normalizeOAuthContext, oauthCookieName, oauthCookieOptions, oauthRedirectUri, readOAuthState } from '../../../shared/utils/oauthState'
import { isIssuedWebToken, requestWebLogin, setWebSession, webSessionConfig } from '../../utils/webSession'

import { defineEventHandler, deleteCookie, getCookie, getHeader, type H3Event, readRawBody, setResponseHeader, setResponseStatus } from 'h3'
import { z } from 'zod'

const loginRequest = z.object({
  action: z.literal('login'),
  code: z.string().min(1),
  state: z.string().min(1)
})

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
  const login = loginRequest.safeParse(body)
  if (!login.success) return reject(event, 400, 'request')

  const { code, state } = login.data
  const attempt = readOAuthState(state)
  if (!attempt) return reject(event, 400, 'state')

  const secure = reader.protocol === 'https:'
  const bindingName = oauthCookieName(attempt.nonce, secure)
  if (getCookie(event, bindingName) !== await digestOAuthState(state)) return reject(event, 400, 'state')

  const context = normalizeOAuthContext(attempt, reader.origin)
  const clientId = context.platform === 'apple' ? config.APPLE_OAUTH_CLIENT_ID : config.GOOGLE_OAUTH_CLIENT_ID
  const requestSignal: AbortSignal | undefined = event.context.cloudflare?.request?.signal ?? event.web?.request?.signal
  const response = event.node.res
  const disconnect = new AbortController()
  const onClose = () => disconnect.abort()
  if (response.destroyed) onClose()
  response.once('close', onClose)
  const deadline = AbortSignal.timeout(20_000)
  const signal = AbortSignal.any(requestSignal ? [requestSignal, disconnect.signal, deadline] : [disconnect.signal, deadline])
  let token: unknown
  try {
    signal.throwIfAborted()
    const upstream = await requestWebLogin(event, {
      signal,
      body: JSON.stringify({
        code,
        type: context.platform,
        client_id: clientId,
        redirect_uri: oauthRedirectUri(String(config.AUTH_BASE_URL)),
        aff_code: context.affCode,
        auth_attribution: context.auth_attribution
      })
    })
    if (upstream.status === 200) {
      const result = await upstream.json() as { code?: number; data?: { token?: unknown } } | null
      if (result?.code === 200) token = result.data?.token
    }
    signal.throwIfAborted()
  } catch {
    if (requestSignal?.aborted || disconnect.signal.aborted) return reject(event, 499, 'canceled')
    if (deadline.aborted) return reject(event, 504, 'timeout')
    return reject(event, 502, 'exchange')
  } finally {
    response.off('close', onClose)
  }

  if (!isIssuedWebToken(token)) return reject(event, 502, 'exchange')
  setWebSession(event, token)
  deleteCookie(event, bindingName, oauthCookieOptions(secure))
  return { target: context.target }
})
