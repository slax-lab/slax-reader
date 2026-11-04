import { computed, onScopeDispose, type Ref, ref, useId, watch } from 'vue'

import { tokenFingerprint } from '~/utils/accountContext'

export const useSnapshotSessionRecoveryPending = () => useState<string | null>('snapshot-session-recovery-pending', () => null)
export const useSnapshotSessionNavigation = () => useState<string | null>('snapshot-session-navigation', () => null)

export function useSnapshotSessionRecovery(error: Ref<{ statusCode?: number } | null | undefined>, rejectedTokenVersion: Ref<string | null>, snapshotPath: string) {
  const nuxtApp = useNuxtApp()
  const auth = useAuth()
  const attempted = ref(false)
  const recovering = ref(false)
  const pending = computed(() => recovering.value || (!attempted.value && error.value?.statusCode === 401 && !!rejectedTokenVersion.value))
  const sharedPending = useSnapshotSessionRecoveryPending()
  const owner = useId()
  watch(pending, value => {
    if (value) sharedPending.value = owner
    else if (sharedPending.value === owner) sharedPending.value = null
  }, { immediate: true, flush: 'sync' })
  const navigation = useSnapshotSessionNavigation()
  if (navigation.value === snapshotPath) navigation.value = null
  let ready = false
  let active = true
  onScopeDispose(() => {
    active = false
    if (import.meta.client && pending.value && sharedPending.value === owner) sharedPending.value = null
  })

  const recover = async () => {
    if (!ready || !active || attempted.value || !pending.value) return
    recovering.value = true
    attempted.value = true
    const currentVersion = nuxtApp.runWithContext(() => tokenFingerprint(getUserToken()))
    if (currentVersion !== rejectedTokenVersion.value) {
      recovering.value = false
      return
    }

    try {
      await nuxtApp.runWithContext(() => auth.clearAuth())
    } catch {
      // Failed cleanup leaves the existing page error visible, without a reload loop.
      recovering.value = false
      return
    }
    if (active && !navigation.value && !nuxtApp.runWithContext(() => getUserToken())) {
      window.location.reload()
    } else {
      recovering.value = false
    }
  }

  if (import.meta.client) {
    onNuxtReady(() => {
      ready = true
      void recover()
    })
    watch([error, rejectedTokenVersion], () => { void recover() })
  }
  return { pending }
}
