import { expireCurrentSession, getCurrentSessionToken, getExtensionEventHeaders, requireInteractiveLogin } from '@/utils/session'
import { type FetchOptions, FetchRequest } from '@commons/frontend-utils/request'

import { RESTMethodPath } from '@slax-reader/contracts/const'
import { NOT_LOGIN_ERROR } from '@commons/frontend-types/error'

let bridgeBookmarkUid: string | null = null

export const setBridgeBookmarkUid = (bookmarkUid?: string | null) => {
  bridgeBookmarkUid = bookmarkUid || null
}

const UUID_REQUEST_PATHS = new Set<string>([
  RESTMethodPath.BOOKMARK_BRIEF,
  RESTMethodPath.BOOKMARK_MARK_LIST,
  RESTMethodPath.BOOKMARK_AI_SUMMARIES,
  RESTMethodPath.BOOKMARK_AI_SUMMARIES_LIST,
  RESTMethodPath.BOOKMARK_OVERVIEW,
  RESTMethodPath.BOOKMARK_ARCHIVE,
  RESTMethodPath.BOOKMARK_STAR,
  RESTMethodPath.BOOKMARK_ALIAS_TITLE,
  RESTMethodPath.BOT_CHAT,
  RESTMethodPath.ADD_BOOKMARK_TAG,
  RESTMethodPath.DELETE_BOOKMARK_TAG
])

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

const adaptOptions = (options: FetchOptions): FetchOptions => {
  if (!bridgeBookmarkUid || !UUID_REQUEST_PATHS.has(options.url)) return options

  const query = options.query ? { ...options.query } : undefined
  const body = isRecord(options.body) ? { ...options.body } : options.body
  const replace = (value: Record<string, unknown> | undefined) => {
    if (!value) return
    if ('bookmark_id' in value || 'bm_id' in value) {
      delete value.bookmark_id
      delete value.bm_id
      value.bookmark_uid = bridgeBookmarkUid
    }
  }

  replace(query as Record<string, unknown> | undefined)
  replace(body as Record<string, unknown> | undefined)
  return { ...options, query, body }
}

class BridgeAwareRequest extends FetchRequest {
  override async fetchRequest(options: FetchOptions) {
    const response = (await super.fetchRequest(options)) as Response
    if (response.status === 401) {
      if (typeof window !== 'undefined') await requireInteractiveLogin()
      else await expireCurrentSession()
      throw NOT_LOGIN_ERROR
    }
    return response
  }

  override async get<T = unknown>(options: FetchOptions) {
    return await super.get<T>(adaptOptions(options))
  }

  override async post<T = unknown>(options: FetchOptions) {
    if (bridgeBookmarkUid && options.url === RESTMethodPath.ADD_BOOKMARK_TAGS && isRecord(options.body)) {
      const tags = Array.isArray(options.body.tags) ? options.body.tags : []
      const added = await Promise.all(
        tags.map(tag => {
          const item = isRecord(tag) ? tag : {}
          return super.post({
            ...options,
            url: RESTMethodPath.ADD_BOOKMARK_TAG,
            body: {
              bookmark_uid: bridgeBookmarkUid,
              tag_name: item.name,
              tag_id: item.id
            }
          })
        })
      )
      return added.filter(Boolean) as T
    }

    return await super.post<T>(adaptOptions(options))
  }

  override async put<T = unknown>(options: FetchOptions) {
    return await super.put<T>(adaptOptions(options))
  }

  override async delete<T = unknown>(options: FetchOptions) {
    return await super.delete<T>(adaptOptions(options))
  }

  override async stream(options: FetchOptions) {
    return await super.stream(adaptOptions(options))
  }
}

export const request = new BridgeAwareRequest({
  baseUrl: `${process.env.EXTENSIONS_API_BASE_URL}`,
  requestInterceptors: async options => {
    const token = await getCurrentSessionToken()
    if (!token) {
      if (typeof window !== 'undefined') await requireInteractiveLogin()
      throw NOT_LOGIN_ERROR
    }
    options.headers = {
      ...(await getExtensionEventHeaders()),
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {})
    }
    return options
  }
})
