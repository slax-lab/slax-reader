import { isClient, isServer } from '@commons/frontend-utils/is'
import { type FetchOptions, FetchRequest, type FetchResult, RequestError, RequestMethodType } from '@commons/frontend-utils/request'

import { useCookies } from '@vueuse/integrations/useCookies'
import Toast, { ToastType } from '~/components/Toast'

let requestInstance: FetchRequest | null = null
let clientDeviceId = ''

class ServerRequest extends FetchRequest {
  override async fetchRequest(options: FetchOptions) {
    const { url, query, body, headers, method, stream } = options
    if (method !== RequestMethodType.get || stream) {
      throw Error('Server not support other method')
    }

    const result = await fetch(this.combineUrlWithQuery(url, query), {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: body ? (body instanceof File ? body : JSON.stringify(body)) : undefined
    })

    return result
  }
}

export const request = () => {
  if (!requestInstance) {
    const baseUrl = useRuntimeConfig().public.DWEB_API_BASE_URL as string
    requestInstance = new (isClient ? FetchRequest : ServerRequest)({
      baseUrl,
      requestInterceptors: async options => {
        const token = getUserToken()
        options.headers = {
          ...getClientEventHeaders(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers ?? {})
        }
        return options
      },
      responseInterceptors: async <T = unknown>(response: FetchResult<unknown>) => {
        if (response.status === 401) {
          await useAuth().clearAuth()
          await navigateTo('/login')
        }

        return response as FetchResult<T>
      },
      errorInterceptors: error => {
        if (isServer) {
          return error
        }

        if (error instanceof RequestError && error.message) {
          Toast.showToast({
            text: error.message,
            type: ToastType.Error
          })
        } else {
          Toast.showToast({
            text: `${error}`,
            type: ToastType.Error
          })
        }
      }
    })
  }

  return requestInstance
}

const getRequestCookie = (name: string): string | undefined => {
  const header: string | undefined = useRequestHeaders(['cookie']).cookie
  const cookie = header
    ?.split(';')
    .map(item => item.trim())
    .find(item => item.startsWith(`${name}=`))
    ?.slice(name.length + 1)
  if (!cookie) return undefined
  try {
    return decodeURIComponent(cookie)
  } catch {
    return cookie
  }
}

export const getDeviceId = (): string => {
  if (!isClient) return getRequestCookie('_su') || ''

  const createId = () => (clientDeviceId ||= `${crypto.randomUUID().replaceAll('-', '')}.${Date.now()}`)
  try {
    const cookies = useCookies()
    const existing = cookies.get('_su', { doNotParse: true })
    if (typeof existing === 'string' && existing.trim()) return (clientDeviceId = existing)
    cookies.set('_su', createId(), {
      path: '/',
      maxAge: 31536000,
      sameSite: 'lax',
      secure: location.protocol === 'https:'
    })
  } catch {
    // Cookie storage can be unavailable; keep one identity for this page's requests.
  }
  return createId()
}

export const getClientEventHeaders = (): Record<string, string> => {
  const config = useRuntimeConfig().public
  const deviceId = getDeviceId()
  const incoming = isServer ? useRequestHeaders(['x-client-locale', 'accept-language', 'x-client-version']) : {}
  // The active app locale is ready before useHead writes <html lang>, including hydration.
  const activeLocale = tryUseNuxtApp()?.$i18n?.locale?.value
  const locale =
    activeLocale || (isClient ? document.documentElement.lang || navigator.language : incoming['x-client-locale'] || incoming['accept-language']?.split(',')[0]) || 'en'
  return {
    ...(deviceId ? { 'X-Device-ID': deviceId } : {}),
    'X-CLIENT-TYPE': 'web',
    'X-CLIENT-VERSION': String(incoming['x-client-version'] || config.appVersion || 'unknown'),
    'X-CLIENT-LOCALE': locale.trim().toLowerCase().replaceAll('_', '-').split('-')[0] || 'en'
  }
}

export const getUserToken = () => {
  const COOKIE_TOKEN_NAME = useRuntimeConfig().public.COOKIE_TOKEN_NAME

  const getUserTokenClient = () => {
    const cookies = useCookies()
    return cookies.get(COOKIE_TOKEN_NAME)
  }
  const getUserTokenServer = () => {
    return getRequestCookie(COOKIE_TOKEN_NAME)
  }
  return isClient ? getUserTokenClient() : getUserTokenServer()
}

export const haveRequestToken = () => {
  return !!getUserToken()
}
