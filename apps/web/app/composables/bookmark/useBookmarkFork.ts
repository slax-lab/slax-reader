import { computed, reactive, ref, toValue, type MaybeRef } from 'vue'
import type { BookmarkForkMetadata, ForkBookmarkResponse } from '@slax-reader/contracts'
import { useUserStore } from '~/stores/user'
import { showLoginModal } from '~/components/Modal'
import { request } from '~/utils/request'
import Toast, { ToastType } from '~/components/Toast'

// Store identity keeps request state local to this Nuxt application; account IDs
// prevent an old account's request from blocking or navigating the next account.
const forkRequests = new WeakMap<object, Set<string>>()

export function useBookmarkFork(source?: MaybeRef<string>) {
  const lastSource = ref('')
  const error = ref('')
  const user = useUserStore()
  const { t } = useI18n()
  const requests = forkRequests.get(user) ?? reactive(new Set<string>())
  forkRequests.set(user, requests)
  const pending = computed(() => requests.has(`${user.userInfo?.userId}:${source ? toValue(source) : lastSource.value}`))

  async function fork(sourceUuid: string): Promise<ForkBookmarkResponse | null> {
    const accountId = user.userInfo?.userId
    const key = `${accountId}:${sourceUuid}`
    lastSource.value = sourceUuid
    if (requests.has(key)) return null
    error.value = ''
    if (!navigator.onLine) {
      error.value = t('bookmark_fork.offline')
      Toast.showToast({ text: error.value, type: ToastType.Error })
      return null
    }
    if (!user.isLogin) {
      showLoginModal({ redirect: location.href })
      return null
    }
    requests.add(key)
    try {
      const result = await request().post<ForkBookmarkResponse>({
        url: '/v1/bookmark/fork',
        body: { source_user_bookmark_uuid: sourceUuid },
        errorInterceptors: failure => {
          error.value = failure instanceof Error ? failure.message : t('bookmark_fork.failed')
          Toast.showToast({ text: error.value, type: ToastType.Error })
        }
      })
      if (!result) return null
      if (!user.isLogin || user.userInfo?.userId !== accountId) return null
      await navigateTo(`/b/${result.bookmark_uid}`)
      return result
    } catch {
      return null
    } finally {
      requests.delete(key)
    }
  }
  return { fork, pending, error }
}

/** Per-component, per-account data. Nothing from this request enters shared SSR state. */
export function useBookmarkForkMetadata(uuid: Ref<string>) {
  const metadata = shallowRef<BookmarkForkMetadata | null>(null)
  const user = useUserStore()
  onMounted(() => {
    watch(
      [uuid, () => user.userInfo?.userId, () => user.isLogin],
      async ([id], _previous, onCleanup) => {
        metadata.value = null
        let current = true
        onCleanup(() => {
          current = false
        })
        if (!id || !navigator.onLine) return
        try {
          const result = await request().get<BookmarkForkMetadata>({
            url: '/v1/bookmark/fork_metadata',
            query: { bookmark_uid: id },
            errorInterceptors: () => {}
          })
          if (current) metadata.value = result ?? null
        } catch {
          if (current) metadata.value = null
        }
      },
      { immediate: true, flush: 'sync' }
    )
  })
  return metadata
}
