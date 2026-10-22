import type { BookmarkForkMetadata, ForkBookmarkResponse } from '@slax-reader/contracts'
import { useUserStore } from '~/stores/user'
import { showLoginModal } from '~/components/Modal'
import { request } from '~/utils/request'
import Toast, { ToastType } from '~/components/Toast'

export function useBookmarkFork() {
  const pending = ref(false)
  const error = ref('')
  const user = useUserStore()
  const { t } = useI18n()

  async function fork(sourceUuid: string): Promise<ForkBookmarkResponse | null> {
    if (pending.value) return null
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
    pending.value = true
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
      await navigateTo(`/b/${result.bookmark_uid}`)
      return result
    } catch {
      return null
    } finally {
      pending.value = false
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
