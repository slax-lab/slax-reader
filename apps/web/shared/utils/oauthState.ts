import { isAcquisitionAuthAttribution } from '@slax-reader/contracts/events'
import { z } from 'zod'

const attribution = z.union([
  z.object({
    collection_id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9]+$/),
    source_screen: z.literal('collection'),
    presentation: z.literal('modal'),
    trigger_element_id: z.literal('collection_subscribe_button')
  }),
  z.object({
    source: z.literal('hackerlinks'),
    medium: z.enum(['header', 'resource_detail']),
    campaign: z.literal('mvp')
  })
]).optional().catch(undefined)

const context = z.object({
  platform: z.enum(['google', 'apple']).default('google'),
  target: z.string().default('/bookmarks'),
  affCode: z.string().default(''),
  auth_attribution: attribution
})

const state = context.extend({ nonce: z.string().regex(/^[a-f0-9]{32}$/) })

export const oauthRedirectUri = (authBaseUrl: string) => authBaseUrl + '/auth'
export const oauthCookieName = (nonce: string, secure: boolean) => (secure ? '__Host-' : '') + 'reader-oauth-' + nonce
export const oauthCookieOptions = (secure: boolean) => ({ path: '/', sameSite: 'lax' as const, secure })

const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

export const createOAuthNonce = () => toHex(crypto.getRandomValues(new Uint8Array(16)))

export async function digestOAuthState(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return toHex(new Uint8Array(digest))
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

export function readOAuthState(value: string) {
  const parsed = state.safeParse(parseJson(value))
  return parsed.success ? parsed.data : undefined
}

export function normalizeOAuthContext(data: z.infer<typeof context>, origin: string) {
  const authAttribution = data.platform === 'apple' && !isAcquisitionAuthAttribution(data.auth_attribution) ? undefined : data.auth_attribution
  let target = '/bookmarks'
  try {
    const url = new URL(data.target || target, origin)
    if (url.origin === origin && !url.username && !url.password && !url.pathname.startsWith('//')) {
      target = url.pathname + url.search + url.hash
    }
  } catch {
    // Invalid return URLs use the normal bookmarks destination.
  }
  return { platform: data.platform, affCode: data.affCode, target, auth_attribution: authAttribution }
}
