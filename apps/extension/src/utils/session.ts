type SessionTokenResponse = { success?: boolean; token?: string | null; deviceId?: string }

let fallbackDeviceId: Promise<string> | undefined

const localDeviceId = (): Promise<string> =>
  (fallbackDeviceId ||= (async () => {
    let id = ''
    try {
      id = ((await browser.storage.local.get('deviceId')).deviceId as string) || ''
    } catch {}
    if (typeof id === 'string' && id.trim()) return id
    id = crypto.randomUUID()
    try {
      await browser.storage.local.set({ deviceId: id })
    } catch {}
    return id
  })())

export const getExtensionDeviceId = async (): Promise<string> => {
  const cookies = (browser as typeof browser & { cookies?: typeof browser.cookies }).cookies
  try {
    if (cookies) {
      const cookie = await cookies.get({ url: process.env.PUBLIC_BASE_URL || '', name: '_su' })
      if (cookie?.value?.trim()) return cookie.value
    } else {
      const response = (await browser.runtime.sendMessage({ target: 'slax-background', method: 'current-session-token' })) as SessionTokenResponse | undefined
      if (response?.deviceId) return response.deviceId
    }
  } catch {}
  return localDeviceId()
}

export const getExtensionEventHeaders = async (): Promise<Record<string, string>> => ({
  'X-Device-ID': await getExtensionDeviceId(),
  'X-CLIENT-TYPE': 'extension',
  'X-CLIENT-VERSION': process.env.VERSION || browser.runtime.getManifest().version,
  'X-CLIENT-LOCALE': (browser.i18n.getUILanguage() || 'en').toLowerCase().replaceAll('_', '-').split('-')[0]
})

export const getCurrentSessionToken = async (): Promise<string | null> => {
  let token: string | null = null
  const cookies = (browser as typeof browser & { cookies?: typeof browser.cookies }).cookies
  if (cookies) {
    const cookie = await cookies.get({
      url: process.env.PUBLIC_BASE_URL || '',
      name: process.env.COOKIE_TOKEN_NAME || ''
    })
    token = cookie?.value || null
  } else {
    const response = (await browser.runtime.sendMessage({ target: 'slax-background', method: 'current-session-token' })) as SessionTokenResponse | undefined
    token = response?.success ? response.token || null : null
  }

  if (!token) return null
  try {
    const payload = token.split('.')[1]
    if (!payload) return token
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as { exp?: number }
    return typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now() ? null : token
  } catch {
    return token
  }
}

export const expireCurrentSession = async (): Promise<void> => {
  await browser.runtime.sendMessage({ target: 'slax-background', method: 'session-expired' }).catch(() => undefined)
}

export const requireInteractiveLogin = async (): Promise<void> => {
  await browser.runtime.sendMessage({ target: 'slax-background', method: 'interactive-auth-required' }).catch(() => undefined)
}
