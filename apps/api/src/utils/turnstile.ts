import { UnknownStripePriceId } from '@/const/err'
import { MultiLangError } from '@/utils/multiLangError'

export async function turnstileAuth(ip: string, token: string, serverKey: string, error: MultiLangError): Promise<void> {
  let formData = new FormData()
  formData.append('secret', serverKey)
  formData.append('response', token)
  formData.append('remoteip', ip)
  formData.append('idempotency_key', crypto.randomUUID())
  if (!token) {
    console.log('Turnstile auth failed, token is empty')
    throw UnknownStripePriceId()
  }
  const resp = (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    body: formData,
    method: 'POST'
  })) as Response

  if (!resp.ok) {
    console.log('Turnstile auth failed, status:', resp.status, 'statusText:', resp.statusText)
    throw error
  }

  const data = await resp.json()
  if (!data.success) {
    console.log('Turnstile auth failed, response:', data)
    throw error
  }
}
