import { computed, type MaybeRef,reactive, ref, toValue } from 'vue'

import { request } from '~/utils/request'

import type { BookmarkForkMetadata, ForkBookmarkResponse } from '@slax-reader/contracts'
import { showLoginModal } from '~/components/Modal'
import Toast, { ToastType } from '~/components/Toast'
import { useUserStore } from '~/stores/user'

// Account/source keys isolate admission state; fresh metadata reconciles it on visits.
const forkStates = new WeakMap<object, ReturnType<typeof createForkState>>()
const createForkState = () => reactive({ requests: new Set<string>(), saved: new Set<string>(), revisions: new Map<string, number>() })
const forkState = (user: object) => {
  let state = forkStates.get(user)
  if (!state) {
    state = createForkState()
    forkStates.set(user, state)
  }
  return state
}

export function useBookmarkFork(source?: MaybeRef<string>) {
  const lastSource = ref('')
  const error = ref('')
  const user = useUserStore()
  const { t } = useI18n()
  const state = forkState(user)
  const key = computed(() => `${user.isLogin ? user.userInfo?.userId : 'anonymous'}:${source ? toValue(source) : lastSource.value}`)
  const pending = computed(() => state.requests.has(key.value))
  const saved = computed(() => state.saved.has(key.value))

  async function fork(sourceUuid: string): Promise<ForkBookmarkResponse | null> {
    const accountId = user.userInfo?.userId
    const key = `${accountId}:${sourceUuid}`
    lastSource.value = sourceUuid
    if (state.requests.has(key)) return null
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
    state.requests.add(key)
    try {
      const result = await request().post<ForkBookmarkResponse>({
        url: '/v1/bookmark/fork',
        body: { source_user_bookmark_uuid: sourceUuid },
        errorInterceptors: failure => {
          if (!user.isLogin || user.userInfo?.userId !== accountId || (source && toValue(source) !== sourceUuid)) return
          error.value = failure instanceof Error ? failure.message : t('bookmark_fork.failed')
          Toast.showToast({ text: error.value, type: ToastType.Error })
        }
      })
      if (!result) return null
      if (!user.isLogin || user.userInfo?.userId !== accountId) return null
      state.saved.add(key)
      state.revisions.set(key, (state.revisions.get(key) ?? 0) + 1)
      return result
    } catch {
      return null
    } finally {
      state.requests.delete(key)
    }
  }
  return { fork, pending, saved, error }
}

/** Per-component, per-account data. Nothing from this request enters shared SSR state. */
export function useBookmarkForkMetadata(uuid: Ref<string>) {
  const metadata = shallowRef<BookmarkForkMetadata | null>(null)
  const user = useUserStore()
  const state = forkState(user)
  const key = computed(() => `${user.isLogin ? user.userInfo?.userId : 'anonymous'}:${uuid.value}`)
  onMounted(() => {
    watch(
      [uuid, () => user.userInfo?.userId, () => user.isLogin, () => state.revisions.get(key.value)],
      async ([id], _previous, onCleanup) => {
        metadata.value = null
        const requestKey = key.value
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
          if (current) {
            metadata.value = result ?? null
            if (result?.viewer_fork_status === 'pending' || result?.viewer_fork_status === 'success') state.saved.add(requestKey)
            else state.saved.delete(requestKey)
          }
        } catch {
          if (current) metadata.value = null
        }
      },
      { immediate: true, flush: 'sync' }
    )
  })
  return metadata
}
