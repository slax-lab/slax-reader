import type { FetchOptions } from '@commons/frontend-utils/request'
import { request } from '~/utils/request'

import { RESTMethodPath } from '@commons/contracts/const'
import type { IHttpClient } from '@slax-reader/selection/adapters'

/**
 * Dweb端HTTP客户端
 *
 * 使用request()组合式函数
 */
export class DwebHttpClient implements IHttpClient {
  private withSilentErrorToast(options: FetchOptions): FetchOptions {
    if (options.url !== RESTMethodPath.ADD_MARK) return options

    return {
      ...options,
      // Selection/MarkManager owns the user-facing error toast. Avoid showing
      // the same request error once more in the global request interceptor.
      errorInterceptors: options.errorInterceptors ?? (() => {})
    }
  }

  async post<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    return await request().post<T>(this.withSilentErrorToast(options))
  }

  async get<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    return await request().get<T>(this.withSilentErrorToast(options))
  }

  async put<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    return await request().put<T>(this.withSilentErrorToast(options))
  }

  async delete<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    return await request().delete<T>(this.withSilentErrorToast(options))
  }
}
