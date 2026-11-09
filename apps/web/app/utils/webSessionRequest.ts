type SessionRequest = { action: 'login'; code: string; state: string } | { action: 'refresh' }

export function postWebSession(body: SessionRequest, headers: Record<string, string>, signal: AbortSignal) {
  return fetch('/api/auth/session', {
    method: 'POST',
    mode: 'cors',
    credentials: 'same-origin',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })
}
