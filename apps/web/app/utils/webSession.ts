type SessionWrite = { action: 'login'; token: string; state: string } | { action: 'refresh'; token: string; startingToken: string }

export const writeWebSession = async (input: SessionWrite, signal?: AbortSignal) => {
  const { action, token } = input
  const body = action === 'login' ? { action, token, state: input.state } : { action, token }
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(input.action === 'refresh' ? { Authorization: `Bearer ${input.startingToken}` } : {})
    },
    body: JSON.stringify(body),
    signal
  })
  if (response.status === 204 || (action === 'refresh' && response.status === 409)) return
  throw new Error(`Session cookie write failed (${response.status})`)
}
