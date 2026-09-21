import { plainRequest as request } from '@/utils/request'
import type { FetchOptions } from '@commons/utils/request'

import type { IHttpClient } from '@slax-reader/selection/adapters'

/**
 * Extensions端HTTP客户端
 *
 * 使用全局request实例
 */
export class ExtensionsHttpClient implements IHttpClient {
  async post<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    return await request.post<T>(options)
  }

  async get<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    return await request.get<T>(options)
  }

  async put<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    return await request.put<T>(options)
  }

  async delete<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    return await request.delete<T>(options)
  }
}
