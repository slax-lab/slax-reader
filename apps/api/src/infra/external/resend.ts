const RESEND_TIMEOUT_MS = 5000

type ResendEmail = {
  from: string
  to: string[]
  subject: string
  text: string
}

export async function sendResendEmail(
  apiKey: string,
  requestId: string,
  email: ResendEmail,
  send: typeof fetch = (...args) => fetch(...args)
): Promise<Pick<Response, 'ok' | 'status'> | undefined> {
  const request: RequestInit = {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': requestId
    },
    body: JSON.stringify(email)
  }

  try {
    const response = await send('https://api.resend.com/emails', request)
    return { ok: response.ok, status: response.status }
  } catch {
    return undefined
  }
}
