import { ref } from 'vue'

import type { BookmarkForkInfo } from '@commons/frontend-types/models'
import { RESTMethodPath } from '@slax-reader/contracts/const'

export interface BookmarkForkResult {
  bookmark_uid: string
  write_mode: 'created' | 'overwritten'
  fork_info: BookmarkForkInfo | null
}

export const useBookmarkFork = () => {
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const pendingKeys = new Map<string, string>()

  const fork = async (bookmarkUid: string): Promise<BookmarkForkResult | null> => {
    if (loading.value) return null

    const key = pendingKeys.get(bookmarkUid) ?? crypto.randomUUID()
    pendingKeys.set(bookmarkUid, key)
    loading.value = true
    error.value = null

    try {
      const result = await request().post<BookmarkForkResult>({
        url: RESTMethodPath.BOOKMARK_FORK,
        body: { bookmark_uid: bookmarkUid },
        headers: { 'Idempotency-Key': key }
      })
      if (!result?.bookmark_uid) throw new Error('Fork did not return a destination bookmark')
      pendingKeys.delete(bookmarkUid)
      return result
    } catch (cause) {
      error.value = cause instanceof Error ? cause : new Error(String(cause))
      throw error.value
    } finally {
      loading.value = false
    }
  }

  return { loading, error, fork }
}
