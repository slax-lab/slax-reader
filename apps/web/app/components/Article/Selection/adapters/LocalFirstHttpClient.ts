import type { FetchOptions } from '@commons/frontend-utils/request'

import { type AddMarkBody,useLocalMarks } from '@/composables/bookmark/useLocalMarks'
import { RESTMethodPath } from '@commons/types/const'
import type { IHttpClient } from '@slax-reader/selection/adapters'
import { DwebHttpClient } from '~/components/Article/Selection/adapters/DwebHttpClient'

export class LocalFirstHttpClient implements IHttpClient {
  private fallback = new DwebHttpClient()

  constructor(private bookmarkUuid: string) {}

  async post<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    const { url, body } = options
    const local = useLocalMarks()

    if (url === RESTMethodPath.ADD_MARK) {
      const res = await local.addMark(this.bookmarkUuid, body as AddMarkBody)
      return res as T
    }

    if (url === RESTMethodPath.DELETE_MARK) {
      const { mark_uid: markUid } = (body ?? {}) as { mark_uid?: string }
      if (markUid) await local.deleteMark(markUid)
      return { ok: true } as T
    }

    return await this.fallback.post<T>(options)
  }

  async get<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    return await this.fallback.get<T>(options)
  }

  async put<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    return await this.fallback.put<T>(options)
  }

  async delete<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    return await this.fallback.delete<T>(options)
  }
}
