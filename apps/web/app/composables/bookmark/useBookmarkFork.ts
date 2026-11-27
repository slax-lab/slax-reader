import { computed, type MaybeRef, reactive, ref, toValue, watch } from 'vue'

import { startSnapshotSave, submitBookmarkFork } from '~/utils/bookmarkFork'

import type { AddBookmarkResponse, BookmarkForkMetadata } from '@slax-reader/contracts'
import { showLoginModal } from '~/components/Modal'
import Toast, { ToastType } from '~/components/Toast'
import { useAccountContext } from '~/composables/useAccountContext'
import { useUserStore } from '~/stores/user'

// Account and source keys isolate in-flight requests and accepted copies.
const forkStates = new WeakMap<object, ReturnType<typeof createForkState>>()
const createForkState = () => reactive({ requests: new Set<string>(), accepted: new Set<string>() })
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
  const loginOpen = ref(false)
  const user = useUserStore()
  const account = useAccountContext()
  const { t } = useI18n()
  const state = forkState(user)
  const key = computed(() => `${account.context.value.generation}:${user.isLogin ? user.userInfo?.userId : 'anonymous'}:${source ? toValue(source) : lastSource.value}`)
  const pending = computed(() => state.requests.has(key.value))
  const persisted = computed(() => status && toValue(status))
  const saved = computed(() => persisted.value === 'success')
  const processing = computed(() => persisted.value === 'pending' || state.accepted.has(key.value))
  if (source && status) watch([key, () => toValue(status)], ([current, value]) => {
    if (value === undefined) return
    if (value !== null) state.accepted.delete(current)
  }, { immediate: true, flush: 'sync' })

  watch(key, () => { error.value = '' }, { flush: 'sync' })

  async function fork(sourceUuid: string): Promise<AddBookmarkResponse | null> {
    account.sync()
    const generation = account.context.value.generation
    const accountId = user.userInfo?.userId
    const key = `${generation}:${accountId}:${sourceUuid}`
    lastSource.value = sourceUuid
    if (state.requests.has(key)) return null
    error.value = ''
    if (!navigator.onLine) {
      error.value = t('bookmark_fork.offline')
      Toast.showToast({ text: error.value, type: ToastType.Error })
      return null
    }
    if (!user.isLogin) {
      if (loginOpen.value) return null
      const intent = startSnapshotSave(sourceUuid)
      loginOpen.value = true
      showLoginModal({
        ...intent,
        onDismiss: () => {
          loginOpen.value = false
          intent.onDismiss()
        },
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
          if (!source) Toast.showToast({ text: error.value, type: ToastType.Error })
        }
      }, Boolean(source))
      if (!result) return null
      account.sync()
      if (account.context.value.generation !== generation || !user.isLogin || user.userInfo?.userId !== accountId || (source && toValue(source) !== sourceUuid)) return null
      if (source && persisted.value !== 'pending' && persisted.value !== 'success') state.accepted.add(key)
      return result
    } catch {
      if (account.context.value.generation === generation && (!source || toValue(source) === sourceUuid) && !error.value) error.value = t('bookmark_fork.failed')
      return null
    } finally {
      state.requests.delete(key)
    }
  }
  function reconcile(status: BookmarkForkMetadata['viewer_fork_status']) {
    if (status) state.accepted.delete(key.value)
  }

  return { fork, pending, processing, saved, error, loginOpen, reconcile }
}
