export const oauthAttemptCookie = (secure: boolean) => secure ? '__Host-slax_oauth_attempt' : 'slax_oauth_attempt'
export const oauthAttemptMaxAge = 600

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')

export const createOAuthNonce = () => hex(crypto.getRandomValues(new Uint8Array(16)))

export const oauthStateDigest = async (state: string) =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state))))
