import { digestOAuthState, normalizeOAuthContext, oauthCookieName, oauthCookieOptions, oauthRedirectUri, readOAuthState } from '../../shared/utils/oauthState'
import { resolveVisitorId } from '../utils/visitor'
import { isIssuedWebToken, requestWebLogin, setWebSession, webSessionConfig } from '../utils/webSession'

import { defineEventHandler, deleteCookie, getCookie, getHeader, getQuery, getRequestURL, sendNoContent, sendRedirect, setResponseHeaders } from 'h3'

export default defineEventHandler(async event => {
  if (event.method !== 'GET') return
  const url = getRequestURL(event)
  if (url.pathname !== '/auth') return
  const query = getQuery(event)
  setResponseHeaders(event, { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  if (query.platform === 'android' || query.result === 'failed' || query.result === 'timeout') return

  const config = webSessionConfig(event)
  const origin = new URL(String(config.PUBLIC_BASE_URL)).origin
  if (url.origin !== origin || !query.code) return sendRedirect(event, '/login', 302)
  if (typeof query.code !== 'string' || typeof query.state !== 'string') return sendRedirect(event, '/auth?result=failed#', 302)

  const state = readOAuthState(query.state)
  if (!state) return sendRedirect(event, '/auth?result=failed#', 302)
  const secure = url.protocol === 'https:'
  const bindingName = oauthCookieName(state.nonce, secure)
  if (getCookie(event, bindingName) !== await digestOAuthState(query.state)) return sendRedirect(event, '/auth?result=failed#', 302)
  deleteCookie(event, bindingName, oauthCookieOptions(secure))

  const context = normalizeOAuthContext(state, origin)
  const clientId = context.platform === 'apple' ? config.APPLE_OAUTH_CLIENT_ID : config.GOOGLE_OAUTH_CLIENT_ID
  const clientSignal: AbortSignal | undefined = event.context.cloudflare?.request?.signal
  const response = event.node.res
  if (clientSignal?.aborted || response.destroyed) return sendNoContent(event, 499)

  const controller = new AbortController()
  let abandoned = false
  const abandon = () => {
    abandoned = true
    controller.abort()
  }
  clientSignal?.addEventListener('abort', abandon, { once: true })
  response.once('close', abandon)
  const deadline = setTimeout(() => controller.abort(), 20_000)
  try {
    const abort = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
    })
    const exchange = async () => {
      const response = await requestWebLogin(event, {
        signal: controller.signal,
        headers: {
          'X-Device-ID': resolveVisitorId(event),
          'X-Client-Version': String(config.appVersion || 'unknown'),
          'X-Client-Locale': state.clientLocale ?? (getHeader(event, 'accept-language')?.split(/[-,;]/)[0]?.trim().toLowerCase() || 'en')
        },
        body: JSON.stringify({
          code: query.code,
          type: context.platform,
          client_id: clientId,
          redirect_uri: oauthRedirectUri(String(config.AUTH_BASE_URL)),
          aff_code: context.affCode,
          auth_attribution: context.auth_attribution
        })
      })
      const result = await response.json() as { code?: number; data?: { token?: string } }
      if (response.status !== 200 || result?.code !== 200 || !result.data?.token || !isIssuedWebToken(result.data.token)) throw new Error('Login exchange rejected')
      return result.data.token
    }
    const token = await Promise.race([exchange(), abort])
    controller.signal.throwIfAborted()
    setWebSession(event, token)
    return sendRedirect(event, context.target, 302)
  } catch {
    if (abandoned) return sendNoContent(event, 499)
    const result = controller.signal.aborted ? 'timeout' : 'failed'
    console.warn('[auth] callback ' + result, { phase: 'login' })
    return sendRedirect(event, '/auth?result=' + result + '#recovery=' + encodeURIComponent(JSON.stringify(context)), 302)
  } finally {
    clearTimeout(deadline)
    clientSignal?.removeEventListener('abort', abandon)
    response.off('close', abandon)
  }
})
