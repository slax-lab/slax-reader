import type { DesktopCodeRequest, DesktopCodeResponse, DesktopExchangeRequest, DesktopExchangeResponse, DesktopAuthUser } from '@slax-reader/contracts/desktop-auth'

export class DesktopAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code)
    this.name = 'DesktopAuthError'
  }
}
export const invalidDesktopAuth = () => new DesktopAuthError(400, 'DESKTOP_AUTH_INVALID')
export interface DesktopCodeBinding {
  codeHash: string
  challenge: string
  stateHash: string
  deployment: string
}
export interface DesktopCodeAccount extends DesktopAuthUser {
  id: number
}
export interface DesktopCodeStore {
  issue(binding: DesktopCodeBinding, userId: number): Promise<Date | null>
  consume(binding: DesktopCodeBinding): Promise<DesktopCodeAccount | null>
  cleanup(): Promise<void>
}
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}
export async function desktopDigest(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}
export async function issueDesktopCode(store: DesktopCodeStore, input: DesktopCodeRequest, userId: number, deployment: string): Promise<DesktopCodeResponse> {
  const code = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const expires = await store.issue({ codeHash: await desktopDigest(code), challenge: input.code_challenge, stateHash: await desktopDigest(input.state), deployment }, userId)
  if (!expires) throw invalidDesktopAuth()
  return { code, expires_at: expires.toISOString() }
}
export async function redeemDesktopCode(
  store: DesktopCodeStore,
  input: DesktopExchangeRequest,
  deployment: string,
  sign: (account: DesktopCodeAccount) => Promise<Pick<DesktopExchangeResponse, 'token' | 'expires_at'>>
): Promise<DesktopExchangeResponse> {
  const account = await store.consume({
    codeHash: await desktopDigest(input.code),
    challenge: await desktopDigest(input.code_verifier),
    stateHash: await desktopDigest(input.state),
    deployment
  })
  if (!account) throw invalidDesktopAuth()
  // Consume before signing. A failure cannot turn a code into a replayable token response.
  const session = await sign(account)
  const { id: _id, ...user } = account
  return { ...session, user }
}
