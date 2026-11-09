type SessionWrite = { action: 'login'; token: string; state: string } | { action: 'refresh'; token: string; startingToken: string }

export type WebSessionWriteResult = 'handled' | 'unavailable'

export const writeWebSession = async (input: SessionWrite, signal?: AbortSignal): Promise<WebSessionWriteResult> => {
  const { action, token } = input
  const body = action === 'login' ? { action, token, state: input.state } : { action, token }
  let response: Response
  try {
    response = await fetch('/api/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        ...(input.action === 'refresh' ? { Authorization: `Bearer ${input.startingToken}` } : {})
      },
      body: JSON.stringify(body),
      signal
    })
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof TypeError) return 'unavailable'
    throw error
  }
  if (response.status === 204 || (action === 'refresh' && response.status === 409)) return 'handled'
  if ([404, 405, 503, 504].includes(response.status)) return 'unavailable'
  throw new Error(`Session cookie write failed (${response.status})`)
}
