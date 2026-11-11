import { deriveAccountKey } from '~/utils/accountContext'

import { FetchRequest } from '@commons/frontend-utils/request'

export class AccountEmailAuthStaleError extends Error {}

export const createAccountEmailAuthRequest = (accountKey: string) => {
  const assertCurrentAccount = () => {
    const token = getUserToken()
    if (!token || deriveAccountKey(token) !== accountKey) throw new AccountEmailAuthStaleError()
    return token
  }

  const api = new FetchRequest({
    baseUrl: String(useRuntimeConfig().public.DWEB_API_BASE_URL),
    requestInterceptors: options => ({
      ...options,
      headers: {
        ...getClientEventHeaders(),
        ...options.headers,
        Authorization: `Bearer ${assertCurrentAccount()}`
      }
    }),
    responseInterceptors: response => {
      assertCurrentAccount()
      if (response.status === 401) throw new AccountEmailAuthStaleError()
      return response as never
    }
  })

  return { api, assertCurrentAccount }
}

export type AccountEmailAuthRequest = ReturnType<typeof createAccountEmailAuthRequest>
