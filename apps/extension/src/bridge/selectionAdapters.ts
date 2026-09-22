import { getCurrentSessionToken, requireInteractiveLogin } from '@/utils/session'
import type { FetchOptions } from '@commons/frontend-utils/request'

import { request } from './request'
import { RESTMethodPath } from '@commons/contracts/const'
import { NOT_LOGIN_ERROR } from '@commons/frontend-types/error'
import type { IBookmarkProvider } from '@slax-reader/selection/adapters'

export class BridgeBookmarkProvider implements IBookmarkProvider {
  constructor(private readonly bookmarkUidQuery: () => string | undefined) {}

  async getBookmarkId(): Promise<number> {
    return 1
  }

  getBookmarkUid() {
    return this.bookmarkUidQuery()
  }

  getShareCode = undefined
  getCollectionInfo = undefined
  getOwnerUserId = undefined
}

export class BridgeHttpClient {
  constructor(private readonly bookmarkUidQuery: () => string | undefined) {}

  async post<T = unknown>(options: FetchOptions): Promise<T | undefined> {
    if (options.url === RESTMethodPath.ADD_MARK || options.url === RESTMethodPath.DELETE_MARK) {
      if (!(await getCurrentSessionToken())) {
        await requireInteractiveLogin()
        throw NOT_LOGIN_ERROR
      }
      const bookmarkUid = this.bookmarkUidQuery()
      const sourceBody = { ...((options.body as Record<string, unknown> | undefined) ?? {}) }
      const body = bookmarkUid ? { ...sourceBody, bookmark_uid: bookmarkUid } : sourceBody
      if (bookmarkUid) delete body.bm_id
      const operation = options.url === RESTMethodPath.ADD_MARK ? 'create' : 'delete'
      const response = (await browser.runtime.sendMessage({ target: 'slax-background', method: 'bridge-mark', operation, body })) as
        | { success?: boolean; data?: T; error?: string; authRequired?: boolean }
        | undefined
      if (!response?.success) {
        if (response?.authRequired || !(await getCurrentSessionToken())) await requireInteractiveLogin()
        throw new Error(response?.error || `bridge mark ${operation} failed`)
      }
      return response.data
    }
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
