/** Public handoff data contains a challenge and opaque state, never a verifier or session. */
export interface DesktopAuthIntent {client: 'mac'; code_challenge: string; state: string}
export interface DesktopCodeRequest {code_challenge: string; state: string}
export interface DesktopCodeResponse {code: string; expires_at: string}
export interface DesktopExchangeRequest {code: string; code_verifier: string; state: string}
export interface DesktopAuthUser {uuid: string; name: string; email: string; picture: string; lang: string}
export interface DesktopExchangeResponse {token: string; expires_at: string; user: DesktopAuthUser}
export const DESKTOP_AUTH_PATHS = {code: '/v1/auth/desktop/code', exchange: '/v1/auth/desktop/exchange'} as const
export const DESKTOP_CODE_LIFETIME_SECONDS = 120
export type DesktopEnvironment = 'local' | 'preview' | 'beta' | 'main'
export const DESKTOP_CALLBACK_SCHEMES: Record<DesktopEnvironment, string> = {
  local: 'slaxreader-mac-local', preview: 'slaxreader-mac-preview', beta: 'slaxreader-mac-beta', main: 'slaxreader-mac'
}
/** Select from trusted Web build configuration, never a query-supplied redirect or environment. */
export function desktopEnvironmentForWeb(value: unknown): DesktopEnvironment | null {
  switch (value) {
    case 'development': return 'local'
    case 'preview': return 'preview'
    case 'beta': return 'beta'
    case 'production': return 'main'
    default: return null
  }
}
const opaque = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const fields = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.prototype.hasOwnProperty.call(value, name))
export const isDesktopOpaque = (value: unknown): value is string => typeof value === 'string' && opaque.test(value)
export function parseDesktopCodeRequest(value: unknown): DesktopCodeRequest | null {
  return object(value) && fields(value, ['code_challenge', 'state']) && isDesktopOpaque(value.code_challenge) && isDesktopOpaque(value.state)
    ? {code_challenge: value.code_challenge, state: value.state} : null
}
export function parseDesktopExchangeRequest(value: unknown): DesktopExchangeRequest | null {
  return object(value) && fields(value, ['code', 'code_verifier', 'state']) && isDesktopOpaque(value.code) && isDesktopOpaque(value.state)
    && typeof value.code_verifier === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value.code_verifier)
    ? {code: value.code, code_verifier: value.code_verifier, state: value.state} : null
}
export function parseDesktopAuthIntent(query: Record<string, unknown>): DesktopAuthIntent | null {
  if (query.client !== 'mac' || (query.code_challenge_method !== undefined && query.code_challenge_method !== 'S256')) return null
  const value = parseDesktopCodeRequest({code_challenge: query.code_challenge, state: query.state})
  return value ? {client: 'mac', ...value} : null
}
const queryString = (fields: Record<string, string>) => Object.entries(fields).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
export function desktopConsentPath(intent: DesktopAuthIntent): string {
  return '/login?' + queryString({client: intent.client, code_challenge: intent.code_challenge, state: intent.state})
}
export function desktopCallback(code: string, state: string, environment: DesktopEnvironment = 'main'): string {
  if (!isDesktopOpaque(code) || !isDesktopOpaque(state) || !Object.hasOwn(DESKTOP_CALLBACK_SCHEMES, environment)) throw new Error('Invalid desktop authorization')
  return DESKTOP_CALLBACK_SCHEMES[environment] + '://auth?' + queryString({code, state})
}
