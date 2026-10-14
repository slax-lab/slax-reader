import { getExtensionEventHeaders } from '../../utils/session'

import { FetchRequest } from '@commons/frontend-utils/request'
import { RESTMethodPath } from '@slax-reader/contracts/const'
import type { UserInfo } from '@slax-reader/contracts/interface'

export class LocaleUnauthorizedError extends Error {
  constructor() {
    super('Account locale session expired')
  }
}
const api = () =>
  new FetchRequest({
    baseUrl: process.env.EXTENSIONS_API_BASE_URL || '',
    responseInterceptors: response => {
      if (response?.status === 401 || response?.code === 401) throw new LocaleUnauthorizedError()
      if (response?.code !== 200 || !Object.hasOwn(response, 'data')) throw new Error('Account locale request failed')
      return response as never
    }
  })
export const readLocaleUserInfo = async (token: string, signal: AbortSignal): Promise<UserInfo> => {
  const result = await api().get<UserInfo>({ url: RESTMethodPath.ME, signal, headers: { ...(await getExtensionEventHeaders()), Authorization: `Bearer ${token}` } })
  if (!result || (!result.userId && !result.email) || typeof result.lang !== 'string') throw new Error('Invalid account locale response')
  return result
}
