import type { AppLocale } from '@commons/frontend-types/locale'
import { FetchRequest } from '@commons/frontend-utils/request'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { UserInfo } from '@slax-reader/contracts/interface'

export class AccountLocaleUnauthorizedError extends Error {
  constructor() {
    super('Account session expired')
  }
}
export class AccountLocaleStaleError extends Error {
  constructor() {
    super('Account locale request superseded')
  }
}
export class AccountLocaleDisplayError extends Error {
  constructor(cause: unknown) {
    super('Language saved; display update failed', { cause })
  }
}
export interface AccountLocaleRequest {
  readUser(token: string): Promise<UserInfo>
  saveLanguage(token: string, locale: AppLocale): Promise<void>
  refreshToken(token: string, signal: AbortSignal): Promise<string>
}
export const createAccountLocaleRequest = (config?: { baseUrl: string; headers: Record<string, string> }): AccountLocaleRequest => {
  const options = config ?? { baseUrl: useRuntimeConfig().public.DWEB_API_BASE_URL as string, headers: getClientEventHeaders() }
  const api = new FetchRequest({
    baseUrl: options.baseUrl,
    responseInterceptors: response => {
      if (response?.status === 401 || response?.code === 401) throw new AccountLocaleUnauthorizedError()
      if (response?.code !== 200 || !Object.hasOwn(response, 'data')) throw new Error('Account locale request failed')
      return response as never
    }
  })
  const headers = (token: string) => ({ ...options.headers, Authorization: `Bearer ${token}` })
  return {
    async readUser(token) {
      const data = await api.get<UserInfo>({ url: RESTMethodPath.ME, headers: headers(token) })
      if (!data || (!data.userId && !data.email)) throw new Error('refresh user info failed')
      return data
    },
    async saveLanguage(token, locale) {
      await api.post({ url: RESTMethodPath.USER_INFO_SETTING, headers: headers(token), body: { key: 'lang', value: locale } })
    },
    async refreshToken(token, signal) {
      const data = await api.post<{ token: string }>({ url: RESTMethodPath.TOKEN_REFRESH, headers: headers(token), signal })
      if (typeof data?.token !== 'string' || !data.token.trim()) throw new Error('Invalid refreshed token')
      return data.token
    }
  }
}
