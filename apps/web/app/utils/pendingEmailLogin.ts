import type { EmailCodeChallenge } from '@slax-reader/contracts/email-auth'

const prefix = 'slax:email-login:'

export type PendingEmailLogin = Pick<EmailCodeChallenge, 'request_id'> & {
  email: string
  expiresAt: number
  resendAt: number
}

export function readPendingEmailLogin(key: string): PendingEmailLogin | undefined {
  try {
    const raw = sessionStorage.getItem(prefix + key)
    if (!raw) return
    const entry = JSON.parse(raw)
    if (typeof entry?.email === 'string' && entry.email && typeof entry.request_id === 'string' && entry.request_id &&
        Number.isFinite(entry.expiresAt) && entry.expiresAt > Date.now() && Number.isFinite(entry.resendAt)) return entry
    sessionStorage.removeItem(prefix + key)
  } catch {
    // Unavailable storage or a malformed entry must leave manual sign-in usable.
  }
}

export function writePendingEmailLogin(key: string, entry?: PendingEmailLogin) {
  try {
    if (entry) sessionStorage.setItem(prefix + key, JSON.stringify(entry))
    else sessionStorage.removeItem(prefix + key)
  } catch {
    // The current form remains usable when tab storage is unavailable.
  }
}

export function clearPendingEmailLogins() {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(prefix)) sessionStorage.removeItem(key)
    }
  } catch {
    // An unavailable convenience store must not interrupt successful authentication.
  }
}
