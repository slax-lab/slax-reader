import { getTokenUserId } from '~/utils/sessionOwner'

export type AccountContextStatus = 'empty' | 'local' | 'ready' | 'stale'

export type AccountContext = {
  accountKey: string | null
  sessionOwner: string | null
  serverUserId: number | null
  source: 'local' | 'server' | null
  status: AccountContextStatus
  generation: number
}

type TokenClaims = {
  id?: string | number
  user_id?: string | number
  uid?: string | number
  sub?: string | number
  email?: string
}

const decodeClaims = (token: string | null | undefined): TokenClaims | null => {
  if (!token) return null
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(atob(padded)) as TokenClaims
  } catch {
    return null
  }
}

const fnv1a64 = (value: string) => {
  let hash = 0xcbf29ce484222325n
  for (const char of value) {
    hash ^= BigInt(char.codePointAt(0) ?? 0)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export const tokenFingerprint = (token: string | null | undefined) => (token ? fnv1a64(token) : null)

/** Stable local namespace. It never returns the raw JWT or email claim. */
export const deriveAccountKey = (token: string | null | undefined): string | null => {
  const claims = decodeClaims(token)
  const identity = claims?.id ?? claims?.user_id ?? claims?.uid ?? claims?.sub ?? claims?.email
  if (identity == null || String(identity).length === 0) return null
  return `acct_${fnv1a64(String(identity))}`
}

export const isValidServerUserId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0

export const accountSnapshot = (token: string | null | undefined) => ({
  accountKey: deriveAccountKey(token),
  sessionOwner: getTokenUserId(token),
  token
})

export const accountSnapshotMatches = (
  snapshot: { accountKey: string | null; sessionOwner: string | null; token: string | null | undefined },
  token: string | null | undefined
) => {
  const current = accountSnapshot(token)
  return snapshot.token === current.token && snapshot.accountKey === current.accountKey && snapshot.sessionOwner === current.sessionOwner
}

export const accountServerAliasKey = (accountKey: string) => `slax_account_server_alias_v1_${accountKey}`

export const readAccountServerAlias = (accountKey: string | null): number | null => {
  if (!accountKey || typeof localStorage === 'undefined') return null
  try {
    const value = Number(localStorage.getItem(accountServerAliasKey(accountKey)))
    return isValidServerUserId(value) ? value : null
  } catch {
    return null
  }
}

export const writeAccountServerAlias = (accountKey: string | null, serverUserId: unknown) => {
  if (!accountKey || !isValidServerUserId(serverUserId) || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(accountServerAliasKey(accountKey), String(serverUserId))
  } catch {
    /* Storage is optional; in-memory account context remains authoritative. */
  }
}
