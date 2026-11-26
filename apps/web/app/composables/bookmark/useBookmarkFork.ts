import { computed, type MaybeRef, reactive, ref, toValue, watch } from 'vue'

import { startSnapshotSave, submitBookmarkFork } from '~/utils/bookmarkFork'

import type { AddBookmarkResponse, BookmarkForkMetadata } from '@slax-reader/contracts'
import { showLoginModal } from '~/components/Modal'
import Toast, { ToastType } from '~/components/Toast'
import { useAccountContext } from '~/composables/useAccountContext'
import { useUserStore } from '~/stores/user'

// Account/source keys isolate admission state; fresh metadata reconciles it on visits.
const forkStates = new WeakMap<object, ReturnType<typeof createForkState>>()
const createForkState = () => reactive({ requests: new Set<string>(), saved: new Set<string>() })
const forkState = (user: object) => {
  let state = forkStates.get(user)
  if (!state) {
    state = createForkState()
    forkStates.set(user, state)
  }
  return state
}

export function useBookmarkFork(source?: MaybeRef<string>, status?: MaybeRef<BookmarkForkMetadata['viewer_fork_status'] | undefined>) {
  const lastSource = ref('')
  const error = ref('')
  const user = useUserStore()
  const account = useAccountContext()
  const { t } = useI18n()
  const state = forkState(user)
  const key = computed(() => `${user.isLogin ? user.userInfo?.userId : 'anonymous'}:${source ? toValue(source) : lastSource.value}`)
  const pending = computed(() => state.requests.has(key.value))
  const saved = computed(() => state.saved.has(key.value))
  if (source && status) watch([key, () => toValue(status)], ([current, value]) => {
    if (value === undefined) return
    if (value === 'pending' || value === 'success') state.saved.add(current)
    else state.saved.delete(current)
  }, { immediate: true, flush: 'sync' })

  async function fork(sourceUuid: string): Promise<AddBookmarkResponse | null> {
    account.sync()
    const generation = account.context.value.generation
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
      showLoginModal({
        ...startSnapshotSave(sourceUuid),
        authAttribution: {
          source_screen: 'detail',
          presentation: 'modal',
          trigger_element_id: 'snapshot_save_button',
          source_bookmark_id: sourceUuid
        }
      })
      return null
    }
    state.requests.add(key)
    try {
      const result = await submitBookmarkFork(sourceUuid, {
        errorInterceptors: failure => {
          if (account.context.value.generation !== generation || !user.isLogin || user.userInfo?.userId !== accountId || (source && toValue(source) !== sourceUuid)) return
          error.value = failure instanceof Error ? failure.message : t('bookmark_fork.failed')
          Toast.showToast({ text: error.value, type: ToastType.Error })
        }
      })
      if (!result) return null
      account.sync()
      if (account.context.value.generation !== generation || !user.isLogin || user.userInfo?.userId !== accountId || (source && toValue(source) !== sourceUuid)) return null
      state.saved.add(key)
      return result
    } catch {
      return null
    } finally {
      state.requests.delete(key)
    }
  }
  return { fork, pending, saved, error }
}
