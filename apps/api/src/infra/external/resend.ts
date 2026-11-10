const RESEND_TIMEOUT_MS = 5000

type ResendEmail = {
  from: string
  to: string[]
  subject: string
  text: string
}

export async function resendDeliveryRejected(apiKey: string, requestId: string, email: ResendEmail, send: typeof fetch = (...args) => fetch(...args)): Promise<boolean> {
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
    // A timeout, idempotency conflict, or upstream error can follow acceptance.
    return !response.ok && response.status < 500 && response.status !== 408 && response.status !== 409
  } catch {
    return false
  }
}
